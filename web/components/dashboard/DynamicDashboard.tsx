"use client";

// The per-user dashboard, rebuilt as a live deck. A bank of ~50 cards is derived from the feeds on every
// data change (cardBank.ts); the spec Orion wrote for the user's last ask is pinned first, the rest are
// ranked against it, and exactly ten show at a time. The bottom of the deck rotates every few seconds and
// fresh data pushes in at its rank, so the page reads as generated live. No card fetches anything.

import type { ActivityResponse, DashboardSpec, GraphResponse, PublicNode, Widget } from "@/lib/orion";
import { cardHint, useDemo } from "@/lib/demo";
import { cn } from "@/lib/utils";
import { openNode } from "@/lib/viewer";
import { LayoutGrid, Sparkles, UserRound } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityFeed } from "./ActivityFeed";
import { type Bank, buildBank, type Card, DECK_SIZE, LIVE_KINDS, specKey, specTerms } from "./cardBank";
import { ChangeCard, ClusterCard, NodeCard, PersonCard } from "./cards";
import { Constellation, prefetchSky, useSkySnapshot } from "./Constellation";
import { ago, applyFilter, hasFilter, Quiet, sourceMatches, useNow, WidgetCard } from "./shared";
import { DomainBreakdown, Gaps, Kpi, METRIC_LABEL, NodeList, Note, People, StatusBreakdown } from "./widgets";

export { ActivityFeed } from "./ActivityFeed";
export { Constellation } from "./Constellation";

const EASE = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: "spring", visualDuration: 0.2, bounce: 0.12 } as const;
const ROTATE_MS = 6000;
const GLOW_MS = 1500;

// Static strings so Tailwind can see every class. 4 columns from md, 1 on mobile.
const SPAN: Record<Widget["size"], string> = {
  sm: "col-span-1",
  md: "col-span-1 md:col-span-2",
  lg: "col-span-1 md:col-span-3",
  full: "col-span-1 md:col-span-4",
};

const ORIGIN = {
  role: { label: "Role", icon: UserRound },
  chat: { label: "Orion", icon: Sparkles },
  default: { label: "Default", icon: LayoutGrid },
} as const;

export function DynamicDashboard({
  spec,
  graph,
  activity,
  orgId,
  highlightIds,
  onSelectNode,
  renderMap,
}: {
  spec: DashboardSpec;
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  orgId: string;
  highlightIds: string[];
  onSelectNode: (id: string) => void;
  renderMap: () => React.ReactNode;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    // Warm the constellation (and the topic cards that read its cache) before anything mounts.
    if (orgId) prefetchSky(orgId).catch(() => {});
  }, [orgId]);
  const sky = useSkySnapshot(orgId);
  const terms = useMemo(() => specTerms(spec), [spec]);
  const bank = useMemo(() => buildBank(spec, terms, graph, activity, sky), [spec, terms, graph, activity, sky]);
  const key = specKey(spec);
  const paused = useRef(false);
  const { ids, fresh } = useDeck(bank, key, paused);

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const selectRef = useRef(onSelectNode);
  useLayoutEffect(() => {
    selectRef.current = onSelectNode;
  });
  const select = useCallback((id: string) => {
    selectRef.current(id);
    openNode(id);
  }, []);
  const hi = useMemo(() => new Set(highlightIds), [highlightIds]);
  const now = useNow(30000);
  const demo = useDemo();

  const cards = useMemo(() => {
    const rank = new Map(bank.ranked.map((c, i) => [c.id, i]));
    const byId = new Map(bank.ranked.map((c) => [c.id, c]));
    const rest = ids.map((id) => byId.get(id)).filter((c): c is Card => !!c);
    rest.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return [...bank.pinned, ...rest];
  }, [bank, ids]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-8 md:py-6">
      <Header spec={spec} activity={activity} />

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong">
          <Quiet title="Ask Orion what to watch" className="py-16" />
        </div>
      ) : (
        <LayoutGroup id="dashboard">
          <div
            className="grid grid-flow-row-dense grid-cols-1 gap-3 md:grid-cols-4"
            onPointerEnter={() => (paused.current = true)}
            onPointerLeave={() => (paused.current = false)}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {cards.map((c, i) => (
                <motion.div
                  key={c.id}
                  layout={reduce ? false : "position"}
                  initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1, transition: { ...SPRING, delay: reduce ? 0 : Math.min(i, 9) * 0.015 } }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: { duration: 0.12, ease: EASE } }}
                  transition={SPRING}
                  className={cn("group/card relative min-w-0", SPAN[c.size] ?? SPAN.sm)}
                  data-demo-card={c.kind === "widget" ? c.widget.kind : c.kind}
                >
                  {demo.on && <DemoHint text={cardHint(c.kind, c.kind === "widget" ? c.widget.kind : undefined)} />}
                  <CardView
                    card={c}
                    graph={graph}
                    activity={activity}
                    orgId={orgId}
                    highlightIds={highlightIds}
                    on={c.kind === "node" && hi.has(c.node.id)}
                    onSelectNode={select}
                    renderMap={c.kind === "widget" && c.widget.kind === "map" ? renderMap : undefined}
                    nodeById={nodeById}
                    now={now}
                  />
                  {fresh.has(c.id) && !reduce && (
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-ink/40 shadow-[0_0_28px_rgba(237,237,237,0.16)]"
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: GLOW_MS / 1000, ease: "easeOut" }}
                    />
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

/** Demo mode only: a one-line plain-English label that floats above a card on hover. */
function DemoHint({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-3 z-30 mb-1.5 w-max max-w-[min(340px,calc(100%-24px))] rounded-lg border border-line-strong bg-black/90 px-2.5 py-1.5 text-[12px] leading-snug text-muted opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-md transition-opacity duration-150 group-hover/card:opacity-100 group-hover/card:delay-300"
    >
      {text}
    </span>
  );
}

// ---- Deck ------------------------------------------------------------------------------

/**
 * Which non-pinned bank cards are on screen. Resets to the top of the ranking when the spec changes,
 * lets fresh live data push in at its rank, and rotates the lowest ones on a timer unless paused.
 */
function useDeck(bank: Bank, key: string, paused: React.RefObject<boolean>) {
  const [ids, setIds] = useState<string[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const bankRef = useRef(bank);
  const visRef = useRef<string[]>([]);
  const keyRef = useRef<string | null>(null);
  const readyRef = useRef(0);
  const sigRef = useRef<Map<string, string> | null>(null);
  const cursor = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const glow = useCallback((add: string[]) => {
    if (!add.length) return;
    setFresh((prev) => {
      const n = new Set(prev);
      for (const id of add) n.add(id);
      return n;
    });
    for (const id of add) {
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setFresh((prev) => {
            if (!prev.has(id)) return prev;
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        }, GLOW_MS),
      );
    }
  }, []);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => clearTimeout(x));
  }, []);

  const commit = useCallback((next: string[]) => {
    visRef.current = next;
    setIds(next);
  }, []);

  // Reconcile before paint so a spec change never flashes more than ten cards.
  useLayoutEffect(() => {
    bankRef.current = bank;
    const slots = Math.max(0, DECK_SIZE - bank.pinned.length);
    const rank = new Map(bank.ranked.map((c, i) => [c.id, i]));
    const prevSig = sigRef.current;
    sigRef.current = new Map(bank.ranked.map((c) => [c.id, c.sig]));
    const cur = visRef.current;
    // Data readiness: the first real graph or activity payload re-ranks too, without glowing everything.
    const ready = bank.ranked.length >= DECK_SIZE ? 2 : bank.ranked.length > 0 ? 1 : 0;
    const readyChanged = ready !== readyRef.current;
    readyRef.current = ready;

    if (keyRef.current !== key || readyChanged) {
      const asked = keyRef.current !== null && keyRef.current !== key;
      keyRef.current = key;
      cursor.current = 0;
      const next = bank.ranked.slice(0, slots).map((c) => c.id);
      commit(next);
      if (asked) glow(next.filter((id) => !cur.includes(id)));
      return;
    }

    let next = cur.filter((id) => rank.has(id));
    const entering: string[] = [];
    const worstLight = () => {
      let worst: string | null = null;
      for (const id of next) {
        const c = bank.ranked[rank.get(id)!];
        if (c.heavy) continue;
        if (worst === null || rank.get(id)! > rank.get(worst)!) worst = id;
      }
      return worst;
    };
    if (prevSig && prevSig.size) {
      const arrivals = bank.ranked.filter((c) => LIVE_KINDS.has(c.kind) && prevSig.get(c.id) !== c.sig).slice(0, 2);
      for (const a of arrivals) {
        if (next.includes(a.id)) {
          entering.push(a.id);
          continue;
        }
        if (next.length < slots) {
          next.push(a.id);
          entering.push(a.id);
          continue;
        }
        const worst = worstLight();
        if (worst && rank.get(a.id)! < rank.get(worst)!) {
          next = next.filter((id) => id !== worst).concat(a.id);
          entering.push(a.id);
        }
      }
    }
    for (const c of bank.ranked) {
      if (next.length >= slots) break;
      if (!next.includes(c.id)) next.push(c.id);
    }
    if (next.length > slots) next = [...next].sort((a, b) => rank.get(a)! - rank.get(b)!).slice(0, slots);
    if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) commit(next);
    glow(entering.filter((id) => next.includes(id)));
  }, [bank, key, commit, glow]);

  // Rotate the bottom of the deck: 1 then 2 cards, alternating.
  useEffect(() => {
    let two = false;
    const t = setInterval(() => {
      if (paused.current || document.hidden) return;
      const b = bankRef.current;
      const cur = visRef.current;
      const vis = new Set(cur);
      const pool = b.ranked.filter((c) => !vis.has(c.id) && !c.heavy);
      if (!pool.length) return;
      const rank = new Map(b.ranked.map((c, i) => [c.id, i]));
      const light = cur.filter((id) => rank.has(id) && !b.ranked[rank.get(id)!].heavy);
      two = !two;
      const n = Math.min(two ? 2 : 1, pool.length, Math.max(0, light.length - 1));
      if (n <= 0) return;
      const out = new Set([...light].sort((a, z) => rank.get(z)! - rank.get(a)!).slice(0, n));
      const ins: string[] = [];
      for (let k = 0; k < pool.length && ins.length < n; k++) {
        const id = pool[cursor.current++ % pool.length].id;
        if (!ins.includes(id)) ins.push(id);
      }
      commit(cur.filter((id) => !out.has(id)).concat(ins));
      glow(ins);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, commit, glow]);

  return { ids, fresh };
}

// ---- Header ----------------------------------------------------------------------------

const Header = memo(function Header({ spec, activity }: { spec: DashboardSpec; activity: ActivityResponse | null }) {
  const reduce = useReducedMotion();
  const now = useNow(15000);
  const origin = ORIGIN[spec.origin] ?? ORIGIN.default;
  const OriginIcon = origin.icon;
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${spec.title}|${spec.updatedAt}`}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
          transition={{ duration: 0.16, ease: EASE }}
          className="flex min-w-0 items-center gap-2.5"
        >
          <h1 className="truncate text-[24px] leading-tight font-semibold tracking-[-0.035em] md:text-[28px]">{spec.title}</h1>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[9.5px] tracking-[0.08em] uppercase",
              spec.origin === "chat" ? "border-ink/40 text-ink" : "border-line-strong text-faint",
            )}
          >
            <OriginIcon className="size-2.5" strokeWidth={1.75} />
            {origin.label}
            {spec.updatedAt && <span className="text-faint normal-case">{ago(spec.updatedAt, now)}</span>}
          </span>
        </motion.div>
      </AnimatePresence>
      <Live activity={activity} />
    </header>
  );
});

// ---- Cards -----------------------------------------------------------------------------

const CardView = memo(function CardView({
  card: c,
  graph,
  activity,
  orgId,
  highlightIds,
  on,
  onSelectNode,
  renderMap,
  nodeById,
  now,
}: {
  card: Card;
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  orgId: string;
  highlightIds: string[];
  on: boolean;
  onSelectNode: (id: string) => void;
  renderMap?: () => React.ReactNode;
  nodeById: Map<string, PublicNode>;
  now: number;
}) {
  switch (c.kind) {
    case "node":
      return <NodeCard node={c.node} now={now} on={on} wide={c.size !== "sm"} onSelect={onSelectNode} />;
    case "person":
      return <PersonCard name={c.name} count={c.count} lastAt={c.lastAt} latest={c.latest} now={now} />;
    case "cluster":
      return <ClusterCard label={c.label} count={c.count} top={c.top} onSelect={onSelectNode} />;
    case "change":
      return <ChangeCard source={c.source} change={c.change} now={now} />;
    case "widget":
      return (
        <WidgetView
          widget={c.widget}
          size={c.size}
          graph={graph}
          activity={activity}
          orgId={orgId}
          highlightIds={highlightIds}
          onSelectNode={onSelectNode}
          renderMap={renderMap}
          nodeById={nodeById}
        />
      );
  }
});

function WidgetView({
  widget: w,
  size,
  graph,
  activity,
  orgId,
  highlightIds,
  onSelectNode,
  renderMap,
  nodeById,
}: {
  widget: Widget;
  size: Widget["size"];
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  orgId: string;
  highlightIds: string[];
  onSelectNode: (id: string) => void;
  renderMap?: () => React.ReactNode;
  nodeById: Map<string, PublicNode>;
}) {
  const filtered = hasFilter(w.filter);
  const nodes = useMemo(() => applyFilter(graph?.nodes ?? [], w.filter), [graph, w.filter]);
  const big = size === "lg" || size === "full";
  const loadingGraph = <Quiet title="Loading" />;

  switch (w.kind) {
    case "kpi":
      return <Kpi widget={w} nodes={nodes} graph={graph} activity={activity} filtered={filtered} />;

    case "status_breakdown":
      return (
        <WidgetCard title={w.title || "By status"} note={graph ? nodes.length : undefined}>
          {graph ? <StatusBreakdown nodes={nodes} /> : loadingGraph}
        </WidgetCard>
      );

    case "domain_breakdown":
      return (
        <WidgetCard title={w.title || "By domain"} note={graph ? nodes.length : undefined}>
          {graph ? <DomainBreakdown nodes={nodes} /> : loadingGraph}
        </WidgetCard>
      );

    case "node_list":
      return (
        <WidgetCard title={w.title || "Nodes"} note={graph ? `${nodes.length}` : undefined} flush>
          {graph ? <NodeList nodes={nodes} highlightIds={highlightIds} onSelectNode={onSelectNode} tall={big} /> : loadingGraph}
        </WidgetCard>
      );

    case "activity": {
      const all = activity?.sources ?? [];
      const ids = new Set(nodes.map((n) => n.id));
      // A card about commits or pull requests shows code changes only, newest first.
      const codeOnly = /commit|code|pull request|\bprs?\b|git|merge/i.test(`${w.title} ${w.filter?.query ?? ""}`);
      const sources = codeOnly
        ? all.filter((s) => s.kind === "code")
        : filtered
          ? all.filter((s) => sourceMatches(s, ids, w.filter))
          : all;
      return (
        <WidgetCard title={w.title || "Activity"} note={<LiveDot on={!!activity} label={activity ? `${activity.counts.lastHour}/hr` : "…"} />} flush>
          <div className={cn("thin-scroll overflow-auto", big ? "max-h-[460px]" : "max-h-[300px]")}>
            <ActivityFeed
              sources={sources}
              orgId={orgId}
              limit={big ? 16 : 6}
              loading={!activity}
              highlightIds={highlightIds}
              onSelectNode={onSelectNode}
            />
          </div>
        </WidgetCard>
      );
    }

    case "constellation":
      return (
        <div className={cn("overflow-hidden rounded-2xl border border-line", big ? "h-[420px]" : size === "md" ? "h-[320px]" : "h-[260px]")}>
          <Constellation orgId={orgId} highlightIds={highlightIds} onSelect={onSelectNode} graph={graph} />
        </div>
      );

    case "map":
      return (
        <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-bg", big ? "h-[440px]" : "h-[340px]")}>
          {renderMap?.()}
        </div>
      );

    case "gaps": {
      const gaps = (graph?.gaps ?? []).filter((g) => !filtered || nodes.some((n) => n.id === g.nodeId));
      return (
        <WidgetCard title={w.title || "Gaps"} note={graph ? `${gaps.length}` : undefined} flush>
          {graph ? <Gaps gaps={gaps} nodes={nodeById} onSelectNode={onSelectNode} /> : loadingGraph}
        </WidgetCard>
      );
    }

    case "people":
      return (
        <WidgetCard title={w.title || "People"} note={activity ? activity.counts.people : undefined}>
          {activity ? <People people={activity.people} /> : <Quiet title="Listening" />}
        </WidgetCard>
      );

    case "note":
      return (
        <WidgetCard title={w.title || "Note"}>
          <Note text={w.text} />
        </WidgetCard>
      );

    default:
      return (
        <WidgetCard title={w.title || METRIC_LABEL.total_nodes}>
          <Quiet title="Unsupported" />
        </WidgetCard>
      );
  }
}

function Live({ activity }: { activity: ActivityResponse | null }) {
  return (
    <div className="flex items-center gap-4 font-mono text-[11px] tracking-wide text-faint uppercase">
      <LiveDot on={!!activity} label={activity ? "Live" : "Connecting"} />
      {activity && (
        <span className="tabular-nums">
          {activity.counts.nodes} nodes · {activity.counts.sources} src
        </span>
      )}
    </div>
  );
}

function LiveDot({ on, label }: { on: boolean; label: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex size-1.5">
        {on && !reduce && (
          <motion.span
            className="absolute inset-0 rounded-full bg-ink"
            animate={{ scale: [1, 2.6], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span className={cn("relative size-1.5 rounded-full", on ? "bg-ink" : "bg-faint")} />
      </span>
      {label}
    </span>
  );
}

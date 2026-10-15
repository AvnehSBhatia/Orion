"use client";

// The per-user dashboard, rebuilt as a live deck. A bank of ~50 cards is derived from the feeds on every
// data change (cardBank.ts); the spec Orion wrote for the user's last ask is pinned first, the rest are
// ranked against it, and exactly ten show at a time. The bottom of the deck rotates every few seconds and
// fresh data pushes in at its rank, so the page reads as generated live. No card fetches anything.

import { Quiet } from "@/components/ui/Quiet";
import type { ActivityResponse, DashboardSpec, GraphResponse, Widget } from "@/lib/api/types";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { openNode } from "@/lib/viewer";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { DemoCardHint } from "orion-demo";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { buildBank, type Card, specKey, specTerms } from "./cardBank";
import { prefetchSky, useSkySnapshot } from "./constellation/sky";
import { DashboardHeader, StaleContext } from "./DashboardHeader";
import { GLOW_MS, useDeck } from "./useDeck";
import { CardView } from "./WidgetView";

const EASE = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: "spring", visualDuration: 0.2, bounce: 0.12 } as const;

// Static strings so Tailwind can see every class. 4 columns from md, 1 on mobile.
const SPAN: Record<Widget["size"], string> = {
  sm: "col-span-1",
  md: "col-span-1 md:col-span-2",
  lg: "col-span-1 md:col-span-3",
  full: "col-span-1 md:col-span-4",
};

export function DynamicDashboard({
  spec,
  graph,
  activity,
  orgId,
  highlightIds,
  onSelectNode,
  renderMap,
  stale = false,
}: {
  spec: DashboardSpec;
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  orgId: string;
  highlightIds: string[];
  onSelectNode: (id: string) => void;
  renderMap: () => React.ReactNode;
  /** Polls are failing: live indicators say "Reconnecting". */
  stale?: boolean;
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

  const cards = useMemo(() => {
    const rank = new Map(bank.ranked.map((c, i) => [c.id, i]));
    const byId = new Map(bank.ranked.map((c) => [c.id, c]));
    const rest = ids.map((id) => byId.get(id)).filter((c): c is Card => !!c);
    rest.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return [...bank.pinned, ...rest];
  }, [bank, ids]);

  return (
    <StaleContext.Provider value={stale}>
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 md:px-8 md:py-6">
      <DashboardHeader spec={spec} activity={activity} />

      {!graph && !activity ? (
        <DashboardSkeleton />
      ) : cards.length === 0 ? (
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
                  <DemoCardHint kind={c.kind} widgetKind={c.kind === "widget" ? c.widget.kind : undefined} />
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
    </StaleContext.Provider>
  );
}

/** The deck's shape while the first graph and activity load: four stat tiles and two wide cards. */
function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4" aria-busy aria-label="Loading your dashboard">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[116px] animate-pulse rounded-2xl border border-line bg-panel" />
      ))}
      <div className="h-[340px] animate-pulse rounded-2xl border border-line bg-panel md:col-span-3" />
      <div className="h-[340px] animate-pulse rounded-2xl border border-line bg-panel" />
      <div className="h-[220px] animate-pulse rounded-2xl border border-line bg-panel md:col-span-2" />
      <div className="h-[220px] animate-pulse rounded-2xl border border-line bg-panel md:col-span-2" />
    </div>
  );
}

"use client";

// One component per WidgetKind. Each takes the already-filtered nodes plus the raw feeds,
// so the dashboard decides what is in view and the widget only decides how it looks.

import type { ActivityResponse, Gap, GraphResponse, PublicNode, Status, Widget, WidgetMetric } from "@/lib/orion";
import { cn } from "@/lib/utils";
import { openNode } from "@/lib/viewer";
import { ArrowUpRight, Tag, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  ago,
  byAttention,
  DOMAIN_LABEL,
  DOMAIN_TINT,
  DOMAINS,
  initials,
  Mark,
  Quiet,
  STATUS_LABEL,
  STATUS_TONE,
  STATUSES,
  useNow,
} from "./shared";

const EASE = [0.23, 1, 0.32, 1] as const;

export const METRIC_LABEL: Record<WidgetMetric, string> = {
  total_nodes: "Nodes",
  blocked: "Blocked",
  at_risk: "At risk",
  on_track: "On track",
  done: "Done",
  sellable: "Sellable",
  sources_total: "Captures",
  sources_last_hour: "This hour",
  active_people: "Active people",
  gaps: "Gaps",
};

// ---- KPI -----------------------------------------------------------------------------

export function Kpi({
  widget,
  nodes,
  graph,
  activity,
  filtered,
}: {
  widget: Widget;
  nodes: PublicNode[];
  graph: GraphResponse | null;
  activity: ActivityResponse | null;
  filtered: boolean;
}) {
  const metric = widget.metric ?? "total_nodes";
  const reduce = useReducedMotion();
  const ids = new Set(nodes.map((n) => n.id));
  const count = (s: Status) => nodes.filter((n) => n.status === s).length;
  const fromGraph = metric !== "sources_total" && metric !== "sources_last_hour" && metric !== "active_people";
  const ready = fromGraph ? !!graph : !!activity;

  let value = 0;
  let detail = "";
  switch (metric) {
    case "total_nodes":
      value = nodes.length;
      detail = `${count("blocked")} blocked · ${count("at_risk")} risk`;
      break;
    case "blocked":
    case "at_risk":
    case "on_track":
    case "done":
      value = count(metric);
      detail = `of ${nodes.length}`;
      break;
    case "sellable":
      value = nodes.filter((n) => n.sellable).length;
      detail = "";
      break;
    case "sources_total":
      value = activity?.counts.sources ?? 0;
      detail = `${activity?.counts.lastHour ?? 0} / hr`;
      break;
    case "sources_last_hour":
      value = activity?.counts.lastHour ?? 0;
      detail = `${activity?.counts.sources ?? 0} total`;
      break;
    case "active_people":
      value = activity?.counts.people ?? 0;
      detail = activity?.people.slice(0, 3).map((p) => p.name.split(" ")[0]).join(", ") || "";
      break;
    case "gaps":
      value = (graph?.gaps ?? []).filter((g) => !filtered || ids.has(g.nodeId)).length;
      detail = "";
      break;
  }

  // Remember the last value so a change can announce itself.
  const prev = useRef<number | null>(null);
  const [delta, setDelta] = useState<{ d: number; at: number } | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prev.current !== null && prev.current !== value) setDelta({ d: value - prev.current, at: Date.now() });
    prev.current = value;
  }, [value, ready]);
  useEffect(() => {
    if (!delta) return;
    const t = setTimeout(() => setDelta(null), 4000);
    return () => clearTimeout(t);
  }, [delta]);

  const spark = metric === "sources_last_hour" || metric === "sources_total" ? captureBins(activity) : null;
  const loud = (metric === "blocked" || metric === "gaps" || metric === "at_risk") && value > 0;

  return (
    <div className="flex h-full min-h-[116px] flex-col justify-between rounded-2xl border border-line bg-panel p-4">
      <p className="flex items-center gap-2 text-[13px] text-muted">
        {(metric === "blocked" || metric === "at_risk" || metric === "on_track" || metric === "done") && <Mark status={metric} size={10} />}
        <span className="truncate">{widget.title || METRIC_LABEL[metric]}</span>
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={ready ? value : "pending"}
              initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, filter: "blur(4px)" }}
              transition={{ duration: 0.2, ease: EASE }}
              className={cn("text-[34px] leading-none font-semibold tracking-[-0.035em] tabular-nums", !ready && "text-faint", loud && "text-white")}
            >
              {ready ? value.toLocaleString() : "—"}
            </motion.span>
          </AnimatePresence>
          <AnimatePresence>
            {delta && (
              <motion.span
                key={delta.at}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-0.5 rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-ink"
              >
                {delta.d > 0 && <ArrowUpRight className="size-3" />}
                {delta.d > 0 ? "+" : ""}
                {delta.d}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {spark && <Spark bins={spark} />}
      </div>
      {ready && detail && <p className="mt-1 truncate font-mono text-[11px] text-faint">{detail}</p>}
    </div>
  );
}

/** Captures per 5-minute bin over the last hour, oldest first. */
function captureBins(activity: ActivityResponse | null) {
  if (!activity) return null;
  const bins = new Array(12).fill(0) as number[];
  const now = Date.now();
  for (const s of activity.sources) {
    const age = now - Date.parse(s.createdAt);
    if (age < 0 || age >= 3_600_000) continue;
    bins[11 - Math.floor(age / 300_000)]++;
  }
  return bins;
}

function Spark({ bins }: { bins: number[] }) {
  const max = Math.max(1, ...bins);
  return (
    <svg width={72} height={28} viewBox="0 0 72 28" className="shrink-0" role="img" aria-label="Captures per five minutes, last hour">
      {bins.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * 26) : 1;
        return <rect key={i} x={i * 6} y={28 - h} width={4} height={h} rx={1} fill={i === bins.length - 1 ? "#ededed" : v ? "#6a6a6a" : "#262626"} />;
      })}
    </svg>
  );
}

// ---- Breakdowns ------------------------------------------------------------------------

export function StatusBreakdown({ nodes }: { nodes: PublicNode[] }) {
  if (nodes.length === 0) return <Quiet title="Nothing here yet" />;
  const rows = STATUSES.map((s) => ({ s, n: nodes.filter((x) => x.status === s).length })).filter((r) => r.n > 0 || r.s !== "unknown");
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Nodes by status">
        {rows
          .filter((r) => r.n > 0)
          .map((r) => (
            <motion.span
              key={r.s}
              layout
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ backgroundColor: STATUS_TONE[r.s], flexGrow: r.n, flexBasis: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            />
          ))}
      </div>
      <ul className="mt-4 space-y-2 text-[14px]">
        {rows.map((r) => (
          <li key={r.s} className="flex items-center gap-3">
            <Mark status={r.s} size={11} />
            <span className="flex-1 text-muted">{STATUS_LABEL[r.s]}</span>
            <span className="font-mono tabular-nums">{r.n}</span>
            <span className="w-10 text-right font-mono text-[13px] text-faint tabular-nums">{Math.round((r.n / nodes.length) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DomainBreakdown({ nodes }: { nodes: PublicNode[] }) {
  if (nodes.length === 0) return <Quiet title="Nothing here yet" />;
  const rows = DOMAINS.map((d) => {
    const items = nodes.filter((n) => n.domain === d);
    return { d, n: items.length, blocked: items.filter((n) => n.status === "blocked").length, risk: items.filter((n) => n.status === "at_risk").length };
  }).filter((r) => r.n > 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.d}>
          <div className="flex items-baseline gap-2 text-[14px]">
            <span className="size-2 translate-y-[-1px] rounded-full" style={{ backgroundColor: DOMAIN_TINT[r.d] }} />
            <span className="flex-1">{DOMAIN_LABEL[r.d]}</span>
            {(r.blocked > 0 || r.risk > 0) && (
              <span className="font-mono text-[11px] text-faint">
                {[r.blocked && `${r.blocked} blocked`, r.risk && `${r.risk} at risk`].filter(Boolean).join(" · ")}
              </span>
            )}
            <span className="w-6 text-right font-mono tabular-nums">{r.n}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-raised">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: DOMAIN_TINT[r.d], opacity: 0.7 }}
              initial={false}
              animate={{ width: `${(r.n / max) * 100}%` }}
              transition={{ duration: 0.25, ease: EASE }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Lists ---------------------------------------------------------------------------

export function NodeList({
  nodes,
  highlightIds,
  onSelectNode,
  tall,
}: {
  nodes: PublicNode[];
  highlightIds: string[];
  onSelectNode: (id: string) => void;
  tall: boolean;
}) {
  const now = useNow(15000);
  const reduce = useReducedMotion();
  if (nodes.length === 0) return <Quiet title="Nothing matches yet" />;
  const hi = new Set(highlightIds);
  // Highlighted nodes float to the top; then whatever needs attention most.
  const sorted = [...nodes].sort((a, b) => Number(hi.has(b.id)) - Number(hi.has(a.id)) || byAttention(a, b));
  return (
    <ul className={cn("thin-scroll overflow-auto", tall ? "max-h-[520px]" : "max-h-[360px]")}>
      <AnimatePresence initial={false}>
        {sorted.map((n) => {
          const on = hi.has(n.id);
          return (
            <motion.li
              key={n.id}
              layout={reduce ? false : "position"}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
              className="border-b border-line last:border-0"
            >
              <button
                type="button"
                onClick={() => {
                  onSelectNode(n.id);
                  openNode(n.id);
                }}
                className={cn(
                  "group relative flex w-full items-start gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-raised",
                  on && "bg-raised/60",
                )}
              >
                {on && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-px bg-ink shadow-[0_0_8px_#ededed]" />}
                <span className="mt-1">
                  <Mark status={n.status} size={11} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className={cn("font-medium", on && "text-white")}>{n.label}</span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-faint uppercase">
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: DOMAIN_TINT[n.domain] }} />
                      {DOMAIN_LABEL[n.domain]} · {STATUS_LABEL[n.status]}
                    </span>
                    {n.sellable && (
                      <span className="flex items-center gap-1 rounded border border-line-strong px-1 font-mono text-[10px] tracking-wide text-muted uppercase">
                        <Tag className="size-2.5" />
                        Sellable
                      </span>
                    )}
                  </span>
                  {n.todo ? (
                    <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted">
                      <span className="text-faint">To do · </span>
                      {n.todo}
                    </span>
                  ) : (
                    <span className="mt-0.5 line-clamp-1 block text-[13px] text-faint">{n.summary}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    title={n.owner ?? "No owner"}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full font-mono text-[10px]",
                      n.owner ? "bg-raised text-ink" : "border border-dashed border-line-strong text-faint",
                    )}
                  >
                    {n.owner ? initials(n.owner) : "?"}
                  </span>
                  <span className="font-mono text-[10.5px] text-faint tabular-nums">{ago(n.updatedAt, now)}</span>
                </span>
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

export function Gaps({
  gaps,
  nodes,
  onSelectNode,
}: {
  gaps: Gap[];
  nodes: Map<string, PublicNode>;
  onSelectNode: (id: string) => void;
}) {
  if (gaps.length === 0) return <Quiet title="No gaps" />;
  return (
    <ul className="thin-scroll max-h-[360px] overflow-auto">
      {gaps.map((g) => {
        const n = nodes.get(g.nodeId);
        return (
          <li key={g.nodeId + g.kind} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => {
                onSelectNode(g.nodeId);
                openNode(g.nodeId);
              }}
              className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-raised"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{n?.label ?? g.nodeId}</span>
                  <span className="font-mono text-[11px] tracking-wide text-faint uppercase">{g.kind.replace(/_/g, " ")}</span>
                </span>
                <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted">{g.message}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function People({ people }: { people: ActivityResponse["people"] }) {
  const now = useNow(10000);
  if (people.length === 0) return <Quiet title="Nobody active yet" />;
  const max = Math.max(1, ...people.map((p) => p.count));
  return (
    <ul className="space-y-3">
      {people.slice(0, 8).map((p) => (
        <li key={p.authorId ?? p.name} className="flex items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-[10.5px]">{initials(p.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2 text-[14px]">
              <span className="truncate">{p.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-faint tabular-nums">{ago(p.lastAt, now)}</span>
            </span>
            <span className="mt-1 flex items-center gap-2">
              <span className="h-1 flex-1 rounded-full bg-raised">
                <motion.span
                  className="block h-full rounded-full bg-muted"
                  initial={false}
                  animate={{ width: `${(p.count / max) * 100}%` }}
                  transition={{ duration: 0.25, ease: EASE }}
                />
              </span>
              <span className="w-6 text-right font-mono text-[12px] tabular-nums">{p.count}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Note({ text }: { text: string | null }) {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <p className="font-display text-[21px] leading-[1.35] text-ink/95">{text || "—"}</p>
      <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-wide text-faint uppercase">
        <svg width={12} height={12} viewBox="0 0 18 18" aria-hidden>
          <circle cx={9} cy={9} r={3} fill="#8f8f8f" />
          <circle cx={9} cy={9} r={7.5} fill="none" stroke="#5a5a5a" />
        </svg>
        From Orion
      </p>
    </div>
  );
}

"use client";

// Dependency chains: walk graph.edges from each root and draw the paths, so a blocked node shows
// everything downstream that is waiting on it (the ripple). Gaps ride along as callouts.

import { Quiet } from "@/components/ui/Quiet";
import { Mark } from "@/components/ui/StatusMark";
import type { Edge, Gap, GraphResponse, PublicNode } from "@/lib/api/types";
import { DOMAIN_TINT } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { CircleAlert } from "lucide-react";
import { Fragment, useMemo } from "react";
import { SectionHead, Shell } from "./Section";
import { openNode } from "@/lib/viewer";

const RELATION_LABEL: Record<string, string> = {
  blocks: "blocks",
  feeds: "feeds",
  part_of: "part of",
  governs: "governs",
  influences: "influences",
};

const MAX_DEPTH = 6;
const MAX_CHAINS = 8;

type Step = { node: PublicNode; via: Edge | null };
type Chain = { steps: Step[]; risk: number };

const troubled = (n: PublicNode) => n.status === "blocked" || n.status === "at_risk";

function buildChains(nodes: Map<string, PublicNode>, edges: Edge[]): Chain[] {
  const out = new Map<string, Edge[]>();
  const indeg = new Map<string, number>();
  for (const e of edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target) || e.source === e.target) continue;
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const involved = new Set([...out.keys(), ...indeg.keys()]);
  // Roots: nothing points at them. Cycles with no root get seeded from any unvisited member.
  const roots = [...involved].filter((id) => !indeg.get(id));
  const chains: Chain[] = [];
  const covered = new Set<string>();

  const walk = (path: Step[], seen: Set<string>) => {
    const tail = path[path.length - 1].node.id;
    const next = (out.get(tail) ?? []).filter((e) => !seen.has(e.target));
    if (next.length === 0 || path.length >= MAX_DEPTH) {
      path.forEach((s) => s.via && covered.add(s.via.id));
      chains.push({ steps: path, risk: 0 });
      return;
    }
    for (const e of next) {
      seen.add(e.target);
      walk([...path, { node: nodes.get(e.target)!, via: e }], seen);
      seen.delete(e.target);
      if (chains.length > 200) return;
    }
  };
  for (const r of roots) walk([{ node: nodes.get(r)!, via: null }], new Set([r]));
  for (const e of edges) {
    if (covered.has(e.id) || !nodes.has(e.source) || !nodes.has(e.target) || e.source === e.target) continue;
    walk([{ node: nodes.get(e.source)!, via: null }], new Set([e.source]));
  }

  // Score: a troubled node with anything after it is the ripple we care about most.
  for (const c of chains) {
    const first = c.steps.findIndex((s) => troubled(s.node));
    const downstream = first >= 0 ? c.steps.length - 1 - first : 0;
    c.risk = (first >= 0 ? 10 : 0) + downstream * 3 + c.steps.filter((s) => s.node.status === "blocked").length * 2;
  }
  // Drop chains that are strict sub-paths of a longer kept chain.
  const keyOf = (c: Chain) => `>${c.steps.map((s) => s.node.id).join(">")}>`;
  const sorted = chains.sort((a, b) => b.risk - a.risk || b.steps.length - a.steps.length);
  const kept: Chain[] = [];
  const keys: string[] = [];
  const shown = new Set<string>();
  for (const c of sorted) {
    const k = keyOf(c);
    if (keys.some((other) => other.includes(k))) continue;
    // Siblings that only differ in their last hop repeat the same story: keep a chain only if half its links are new.
    const links = c.steps.flatMap((s) => (s.via ? [s.via.id] : []));
    const fresh = links.filter((id) => !shown.has(id)).length;
    if (links.length && fresh * 2 < links.length) continue;
    links.forEach((id) => shown.add(id));
    kept.push(c);
    keys.push(k);
    if (kept.length >= MAX_CHAINS) break;
  }
  return kept;
}

export function Chains({ graph, scope }: { graph: GraphResponse | null; scope: Set<string> | null }) {
  const { chains, gaps, affected, nodeById } = useMemo(() => {
    const nodeById = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
    const edges = graph?.edges ?? [];
    let chains = buildChains(nodeById, edges);
    if (scope) chains = chains.filter((c) => c.steps.some((s) => scope.has(s.node.id)));
    const affected = new Set<string>();
    for (const c of chains) {
      const first = c.steps.findIndex((s) => troubled(s.node));
      if (first >= 0) c.steps.slice(first + 1).forEach((s) => affected.add(s.node.id));
    }
    const gaps = new Map<string, Gap[]>();
    for (const g of graph?.gaps ?? []) {
      if (scope && !scope.has(g.nodeId)) continue;
      (gaps.get(g.nodeId) ?? gaps.set(g.nodeId, []).get(g.nodeId)!).push(g);
    }
    return { chains, gaps, affected, nodeById };
  }, [graph, scope]);

  const gapList = [...gaps.entries()].filter(([id]) => nodeById.has(id));
  const rippling = chains.filter((c) => c.risk >= 10).length;

  return (
    <section>
      <SectionHead title="Dependencies" note={chains.length ? `${chains.length} chains · ${rippling} at risk` : undefined} />
      {!graph ? (
        <Shell><Quiet title="Loading the graph…" /></Shell>
      ) : chains.length === 0 ? (
        <Shell><Quiet title="No links yet." detail="Chains appear when captures mention what blocks or feeds what." /></Shell>
      ) : (
        <Shell>
          <ul className="divide-y divide-line">
            {chains.map((c) => (
              <li key={c.steps.map((s) => s.node.id).join(">")} className="relative px-4 py-3.5 md:px-5">
                {c.risk >= 10 && <span aria-hidden className="absolute top-3 bottom-3 left-0 w-px bg-ink shadow-[0_0_8px_#ededed]" />}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                  {c.steps.map((s, i) => (
                    <Fragment key={s.node.id}>
                      {s.via && <Relation relation={s.via.relation} hot={troubled(c.steps[i - 1].node)} />}
                      <NodeChip node={s.node} affected={affected.has(s.node.id)} gaps={gaps.get(s.node.id)?.length ?? 0} />
                    </Fragment>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Shell>
      )}
      {gapList.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {gapList.slice(0, 10).map(([id, gs]) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => openNode(id)}
                className="flex items-center gap-2 rounded-full border border-line-strong bg-panel py-1 pr-3 pl-2 text-[13px] transition-colors duration-150 hover:bg-raised"
              >
                <CircleAlert className="size-3.5 text-muted" />
                <span className="max-w-[18ch] truncate">{nodeById.get(id)!.label}</span>
                <span className="text-faint">{gs.map((g) => g.message || g.kind).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NodeChip({ node, affected, gaps }: { node: PublicNode; affected: boolean; gaps: number }) {
  return (
    <button
      type="button"
      onClick={() => openNode(node.id)}
      title={`${node.label}${node.owner ? ` · ${node.owner}` : ""}${affected ? " · waiting on trouble upstream" : ""}`}
      className={cn(
        "flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1 text-[13px] transition-colors duration-150 hover:bg-raised",
        troubled(node) ? "border-ink/60 text-ink" : affected ? "border-dashed border-muted/70 text-ink" : "border-line-strong text-muted",
      )}
    >
      <Mark status={node.status} size={10} />
      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: DOMAIN_TINT[node.domain] }} />
      <span className="truncate">{node.label}</span>
      {gaps > 0 && <CircleAlert className="size-3 shrink-0 text-faint" aria-label="Has gaps" />}
    </button>
  );
}

function Relation({ relation, hot }: { relation: string; hot: boolean }) {
  return (
    <span className={cn("flex items-center gap-1 font-mono text-[11px] tracking-wide uppercase", hot ? "text-muted" : "text-faint")}>
      <svg width={14} height={8} viewBox="0 0 14 8" aria-hidden>
        <path d="M0 4h12M9 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray={hot ? "2 1.5" : undefined} />
      </svg>
      {RELATION_LABEL[relation] ?? relation.replace(/_/g, " ")}
      <svg width={14} height={8} viewBox="0 0 14 8" aria-hidden>
        <path d="M0 4h12M9 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray={hot ? "2 1.5" : undefined} />
      </svg>
    </span>
  );
}

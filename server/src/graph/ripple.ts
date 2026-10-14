import type { Edge, PublicNode, Relation, Status } from "@/contract/types";

const CARRIES_RISK: ReadonlySet<Relation> = new Set(["blocks", "feeds"]);
const TROUBLED: ReadonlySet<Status> = new Set(["blocked", "at_risk"]);
const CAN_DEGRADE: ReadonlySet<Status> = new Set(["on_track", "unknown"]);

export type RippleChange = { nodeId: string; from: Status; to: "at_risk"; causeId: string };

/**
 * A blocked or at-risk node pushes `at_risk` downstream along `blocks` and `feeds` edges,
 * transitively. Done, blocked, and already at-risk nodes keep their status.
 */
export function ripple(nodes: PublicNode[], edges: Edge[]): RippleChange[] {
  const status = new Map(nodes.map((n) => [n.id, n.status]));
  const downstream = new Map<string, string[]>();
  for (const e of edges) {
    if (!CARRIES_RISK.has(e.relation)) continue;
    const list = downstream.get(e.source) ?? [];
    list.push(e.target);
    downstream.set(e.source, list);
  }

  const changes: RippleChange[] = [];
  const queue = nodes.filter((n) => TROUBLED.has(n.status)).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const target of downstream.get(id) ?? []) {
      const from = status.get(target);
      if (!from || !CAN_DEGRADE.has(from)) continue;
      status.set(target, "at_risk");
      changes.push({ nodeId: target, from, to: "at_risk", causeId: id });
      queue.push(target);
    }
  }
  return changes;
}

export function applyRipple(nodes: PublicNode[], changes: RippleChange[]): PublicNode[] {
  const to = new Map(changes.map((c) => [c.nodeId, c.to]));
  return nodes.map((n) => (to.has(n.id) ? { ...n, status: to.get(n.id)! } : n));
}

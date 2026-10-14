import type { Edge } from "@/contract/types";
import type { Store } from "@/db/store";
import { readGraph } from "@/graph/view";

export type NeighborNode = {
  id: string;
  label: string;
  type: string;
  status: string;
  owner: string | null;
  summary: string;
  todo: string | null;
  hops: number;
};
export type Neighborhood = { center: string; nodes: NeighborNode[]; edges: { from: string; relation: Edge["relation"]; to: string }[] };

/** Items within `depth` hops of `id` over every relation, with effective (rippled) statuses. Null when the id is unknown. */
export function neighborhood(store: Store, id: string, depth = 1): Neighborhood | null {
  const graph = readGraph(store);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!byId.has(id)) return null;
  const hops = new Map([[id, 0]]);
  let frontier = new Set([id]);
  for (let d = 1; d <= depth && frontier.size; d++) {
    const next = new Set<string>();
    for (const e of graph.edges) {
      for (const [a, b] of [
        [e.source, e.target],
        [e.target, e.source],
      ]) {
        if (frontier.has(a) && !hops.has(b) && byId.has(b)) {
          hops.set(b, d);
          next.add(b);
        }
      }
    }
    frontier = next;
  }
  const nodes = [...hops]
    .map(([nid, h]) => {
      const n = byId.get(nid)!;
      return { id: n.id, label: n.label, type: n.type, status: n.status, owner: n.owner, summary: n.summary, todo: n.todo, hops: h };
    })
    .sort((a, b) => a.hops - b.hops);
  const edges = graph.edges
    .filter((e) => hops.has(e.source) && hops.has(e.target))
    .map((e) => ({ from: e.source, relation: e.relation, to: e.target }));
  return { center: id, nodes, edges };
}

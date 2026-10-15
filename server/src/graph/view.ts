import type { GraphResponse, PublicNode } from "@/contract/types";
import { toPublicNode, type Store } from "@/db/store";
import { applyGapTodos, findGaps } from "./gaps";
import { applyRipple, ripple } from "./ripple";

/** What every reader sees: embeddings stripped, ripple statuses applied, gap todos filled. */
export function readGraph(store: Store): GraphResponse {
  const edges = store.listEdges();
  const raw = store.listNodes().map(toPublicNode);
  const rippled = applyRipple(raw, ripple(raw, edges));
  const gaps = findGaps(rippled, edges);
  return { nodes: applyGapTodos(rippled, gaps), edges, gaps };
}

/** Effective public versions of the given ids, in the given order. */
export function publicNodesById(store: Store, ids: string[]): PublicNode[] {
  const byId = new Map(readGraph(store).nodes.map((n) => [n.id, n]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

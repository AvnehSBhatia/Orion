import type { ContextResponse } from "@/contract/types";
import type { Store } from "@/db/store";
import type { Embedder } from "@/llm/embed";
import { buildContext, findNodes } from "./context";
import { isEmptyFilter, type NodeFilter } from "./filters";

/**
 * GET /api/context. Without filters: the same context the built-in assistant gets (for you, best for `q`, latest,
 * neighbors, and the documents behind them). With filters: only matching nodes, ranked for the person, plus the
 * newest document behind each.
 */
export async function contextFor(
  store: Store,
  embedder: Embedder,
  query: { userId: string; q?: string; k: number },
  filter: NodeFilter,
): Promise<ContextResponse> {
  if (isEmptyFilter(filter)) {
    const ctx = await buildContext(store, embedder, { userId: query.userId, q: query.q ?? "", k: query.k });
    return {
      nodes: ctx.items.map(({ why: _why, ...n }) => n),
      sources: ctx.sources.map(({ why: _why, ...s }) => s),
    };
  }
  const items = await findNodes(store, embedder, { userId: query.userId, q: query.q, k: query.k, filter });
  const sourceIds = [...new Set(items.flatMap((n) => store.sourceIdsForNode(n.id, 1)))];
  return {
    nodes: items.map(({ why: _why, ...n }) => n),
    sources: sourceIds.flatMap((id) => {
      const s = store.getSource(id);
      return s ? [store.toPublicSource(s)] : [];
    }),
  };
}

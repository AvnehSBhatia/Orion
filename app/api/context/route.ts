import type { NextRequest } from "next/server";
import { contextQuery } from "@/contract/schemas";
import type { ContextResponse } from "@/contract/types";
import { getEmbedder, getStore, requireUser } from "@/server/deps";
import { preflight, route } from "@/server/http";
import { buildContext, findNodes } from "@/steer/context";
import { filterParams, isEmptyFilter } from "@/steer/filters";

export const runtime = "nodejs";

/**
 * Without filters: the same context the built-in assistant gets (for you, best for `q`, latest,
 * neighbors, and the documents behind them). With filters: only matching nodes, ranked for the person,
 * plus the newest document behind each.
 */
export const GET = route(async (req: NextRequest): Promise<ContextResponse> => {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const query = contextQuery.parse(params);
  const filter = filterParams.parse(params);
  const store = getStore(query.orgId);
  const embedder = getEmbedder();
  requireUser(store, query.userId);

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
});

export const OPTIONS = preflight;

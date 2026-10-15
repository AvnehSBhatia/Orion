import type { NextRequest } from "next/server";
import { contextQuery } from "@/contract/schemas";
import type { ContextResponse } from "@/contract/types";
import { getEmbedder, getStore, requireUser } from "@/http/deps";
import { preflight, principalOf, route, scopedQuery } from "@/http/route";
import { maskImages } from "@/orgs/visibility";
import { contextFor } from "@/retrieval/contextResponse";
import { filterParams } from "@/retrieval/filters";

export const runtime = "nodejs";

/** The context for a person (see `retrieval/contextResponse.ts`), optionally filtered. Another person takes an admin. */
export const GET = route(async (req: NextRequest): Promise<ContextResponse> => {
  const params = scopedQuery(req, { user: true });
  const query = contextQuery.parse(params);
  const filter = filterParams.parse(params);
  const store = getStore(query.orgId);
  requireUser(store, query.userId);
  const out = await contextFor(store, getEmbedder(), query, filter);
  return { ...out, sources: maskImages(principalOf(req), store, out.sources) };
});

export const OPTIONS = preflight;

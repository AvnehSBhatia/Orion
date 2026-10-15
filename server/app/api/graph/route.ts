import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import { readGraph } from "@/graph/view";
import { getStore, requireUser } from "@/http/deps";
import { actingAs, preflight, route, scopedQuery } from "@/http/route";

export const runtime = "nodejs";

/** The org's graph. An optional `userId` (viewing as someone else) takes an admin. */
export const GET = route(async (req: NextRequest) => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const store = getStore(orgId);
  const userId = req.nextUrl.searchParams.get("userId");
  if (userId) {
    actingAs(req, userId);
    requireUser(store, userId);
  }
  return readGraph(store);
});

export const OPTIONS = preflight;

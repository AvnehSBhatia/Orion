import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import { readGraph } from "@/graph/view";
import { getStore, requireUser } from "@/server/deps";
import { preflight, route, scopedQuery } from "@/server/http";

export const runtime = "nodejs";

export const GET = route(async (req: NextRequest) => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const store = getStore(orgId);
  const userId = req.nextUrl.searchParams.get("userId");
  if (userId) requireUser(store, userId);
  return readGraph(store);
});

export const OPTIONS = preflight;

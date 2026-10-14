import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import type { SourceResponse } from "@/contract/types";
import { getStore } from "@/server/deps";
import { HttpError, preflight, route, scopedQuery } from "@/server/http";

export const runtime = "nodejs";

export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/sources/[id]">): Promise<SourceResponse> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const { id } = await ctx.params;
  const found = getStore(orgId).readDocument(id);
  if (!found) throw new HttpError(404, `unknown source "${id}"`);
  return found;
});

export const OPTIONS = preflight;

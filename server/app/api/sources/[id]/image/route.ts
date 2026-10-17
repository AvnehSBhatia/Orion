import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { orgQuery } from "@/contract/schemas";
import { getStore } from "@/http/deps";
import { preflight, principalOf, route, scopedQuery } from "@/http/route";
import { screenshotResponse } from "@/orgs/visibility";

export const runtime = "nodejs";

/** A document's screenshot. 403 unless the caller wrote it, is an admin, or the org shows screenshots org-wide. */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/sources/[id]/image">) => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const { id } = await ctx.params;
  const p = principalOf(req);
  return screenshotResponse(p, getStore(orgId), id, p ? getAuthDb() : undefined);
});

export const OPTIONS = preflight;

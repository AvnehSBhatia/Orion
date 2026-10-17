import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { orgQuery } from "@/contract/schemas";
import { getStore } from "@/http/deps";
import { adminOnly, preflight, principalOf, route, scopedQuery } from "@/http/route";
import { exportPerson, exportResponse } from "@/orgs/export";

export const runtime = "nodejs";

/** An admin downloads everything Orion holds about one person in their org (an access request). Audited. */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/users/[userId]/export">) => {
  adminOnly(req);
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const { userId } = await ctx.params;
  return exportResponse(exportPerson(getAuthDb(), getStore(orgId), principalOf(req), orgId, userId));
});

export const OPTIONS = preflight;

import type { NextRequest } from "next/server";
import { orgId as orgIdSchema } from "@/contract/schemas";
import { getStore } from "@/http/deps";
import { adminOnly, preflight, route, sameOrg } from "@/http/route";
import { usageReport, type UsageReport } from "@/usage";

export const runtime = "nodejs";

/** This month's model spend against the budget, captures, and storage. Admins of the org only. */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]/usage">): Promise<UsageReport> => {
  const id = orgIdSchema.parse((await ctx.params).orgId);
  sameOrg(req, id);
  adminOnly(req);
  return usageReport(getStore(id));
});

export const OPTIONS = preflight;

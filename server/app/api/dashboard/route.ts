import type { NextRequest } from "next/server";
import { dashboardQuery, dashboardRequest } from "@/contract/schemas";
import type { DashboardResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getLlm, getStore, requireUser } from "@/http/deps";
import { preflight, route, scopedBody, scopedQuery } from "@/http/route";
import { resolveDashboard } from "@/dashboard/compose";
import { saveOrResetDashboard } from "@/dashboard/save";
import { withUsage } from "@/usage";

export const runtime = "nodejs";
// Composing a dashboard from a role is one model call; only the first visit per person waits on it.
export const maxDuration = 60;

/** The person's dashboard: the saved one, else composed from their role and saved. Another person takes an admin. */
export const GET = route(async (req: NextRequest): Promise<DashboardResponse> => {
  const { orgId, userId } = dashboardQuery.parse(scopedQuery(req, { user: true }));
  const store = getStore(orgId);
  const user = toPublicUser(requireUser(store, userId));
  return withUsage(store, async () => ({ dashboard: await resolveDashboard(store, user, { llm: getLlm() }) }));
});

/** Save an edited dashboard, or `reset: true` to recompose it from the person's role. */
export const POST = route(async (req: NextRequest): Promise<DashboardResponse> => {
  const body = dashboardRequest.parse(await scopedBody(req, { user: true }));
  const store = getStore(body.orgId);
  const user = toPublicUser(requireUser(store, body.userId));
  return withUsage(store, async () => ({ dashboard: await saveOrResetDashboard(store, user, body, { llm: getLlm() }) }));
});

export const OPTIONS = preflight;

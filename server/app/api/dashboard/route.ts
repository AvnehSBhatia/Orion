import type { NextRequest } from "next/server";
import { dashboardQuery, dashboardRequest } from "@/contract/schemas";
import type { DashboardResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getLlm, getStore, requireUser } from "@/http/deps";
import { HttpError } from "@/http/error";
import { actingAs, preflight, route, scopedBody, scopedQuery } from "@/http/route";
import { resolveDashboard, sanitizeDashboard } from "@/steer/dashboard";

export const runtime = "nodejs";
// Composing a dashboard from a role is one model call; only the first visit per person waits on it.
export const maxDuration = 60;

/** The person's dashboard: the saved one, else composed from their role and saved. */
export const GET = route(async (req: NextRequest): Promise<DashboardResponse> => {
  const { orgId, userId } = dashboardQuery.parse(scopedQuery(req, { user: true }));
  const store = getStore(orgId);
  const user = toPublicUser(requireUser(store, userId));
  return { dashboard: await resolveDashboard(store, user, { llm: getLlm() }) };
});

/** Save an edited dashboard, or `reset: true` to recompose it from the person's role. */
export const POST = route(async (req: NextRequest): Promise<DashboardResponse> => {
  const body = dashboardRequest.parse(await scopedBody(req, { user: true }));
  actingAs(req, body.userId);
  const store = getStore(body.orgId);
  const user = toPublicUser(requireUser(store, body.userId));
  if (body.reset) {
    store.deleteDashboard(user.id);
    return { dashboard: await resolveDashboard(store, user, { llm: getLlm() }) };
  }
  const known = new Set(store.listNodes().map((n) => n.id));
  const dashboard = sanitizeDashboard(body.dashboard, { origin: body.dashboard!.origin, allowedIds: known });
  if (!dashboard) throw new HttpError(400, "dashboard needs at least one valid widget");
  store.saveDashboard(user.id, dashboard);
  return { dashboard };
});

export const OPTIONS = preflight;

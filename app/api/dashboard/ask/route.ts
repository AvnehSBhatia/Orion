import type { NextRequest } from "next/server";
import { dashboardAskRequest } from "@/contract/schemas";
import type { DashboardAskResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getLlm, getStore, requireUser } from "@/server/deps";
import { actingAs, preflight, route, scopedBody } from "@/server/http";
import { askAndSaveDashboard } from "@/steer/dashboard";

export const runtime = "nodejs";
export const maxDuration = 30;

/** One fast model call: the reshaped dashboard (saved), or null when the message was not a layout request. */
export const POST = route(async (req: NextRequest): Promise<DashboardAskResponse> => {
  const body = dashboardAskRequest.parse(await scopedBody(req, { user: true }));
  actingAs(req, body.userId);
  const store = getStore(body.orgId);
  const user = toPublicUser(requireUser(store, body.userId));
  return { dashboard: await askAndSaveDashboard(store, user, body.message, { llm: getLlm() }) };
});

export const OPTIONS = preflight;

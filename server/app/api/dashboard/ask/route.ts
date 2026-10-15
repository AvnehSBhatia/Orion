import type { NextRequest } from "next/server";
import { dashboardAskRequest } from "@/contract/schemas";
import type { DashboardAskResponse, DashboardSpec } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getLlm, getStore, requireUser } from "@/http/deps";
import { preflight, route, scopedBody } from "@/http/route";
import { ndjsonResponse } from "@/http/stream";
import { askAndSaveDashboard, type AskTrace } from "@/dashboard/ask";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Reshapes the person's dashboard from one message and saves it. The instant draft is built with no model;
 * at most one fast model call refines it. `dashboard` is null when the message was not a layout request.
 *
 * With `?stream=1` the answer is NDJSON: `{"draft":spec}` the moment the draft exists (usually a few ms),
 * then `{"dashboard":spec|null,"trace":{...}}` when the refinement lands. Without it, one JSON body.
 */
export const POST = route(
  async (req: NextRequest): Promise<DashboardAskResponse | Response> => {
    const body = dashboardAskRequest.parse(await scopedBody(req, { user: true }));
    const store = getStore(body.orgId);
    const user = toPublicUser(requireUser(store, body.userId));
    const trace: AskTrace = { draft: false, modelCalls: 0, promptChars: 0, ms: 0 };
    if (req.nextUrl.searchParams.get("stream") !== "1") {
      return { dashboard: await askAndSaveDashboard(store, user, body.message, { llm: getLlm() }, trace) };
    }
    return ndjsonResponse(
      async (send) => {
        const onDraft = (draft: DashboardSpec) => send({ draft });
        const dashboard = await askAndSaveDashboard(store, user, body.message, { llm: getLlm(), onDraft }, trace);
        send({ dashboard, trace });
      },
      { onError: (error) => ({ dashboard: null, error }) },
    );
  },
  { limit: "ask" },
);

export const OPTIONS = preflight;

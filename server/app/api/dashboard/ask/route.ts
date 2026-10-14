import type { NextRequest } from "next/server";
import { dashboardAskRequest } from "@/contract/schemas";
import type { DashboardAskResponse, DashboardSpec } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getLlm, getStore, requireUser } from "@/http/deps";
import { actingAs, preflight, route, scopedBody } from "@/http/route";
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
export const POST = route(async (req: NextRequest): Promise<DashboardAskResponse | Response> => {
  const body = dashboardAskRequest.parse(await scopedBody(req, { user: true }));
  actingAs(req, body.userId);
  const store = getStore(body.orgId);
  const user = toPublicUser(requireUser(store, body.userId));
  const trace: AskTrace = { draft: false, modelCalls: 0, promptChars: 0, ms: 0 };
  if (req.nextUrl.searchParams.get("stream") !== "1") {
    return { dashboard: await askAndSaveDashboard(store, user, body.message, { llm: getLlm() }, trace) };
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (v: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(v)}\n`));
      try {
        const dashboard = await askAndSaveDashboard(
          store,
          user,
          body.message,
          { llm: getLlm(), onDraft: (draft: DashboardSpec) => send({ draft }) },
          trace,
        );
        send({ dashboard, trace });
      } catch (err) {
        send({ dashboard: null, error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
});

export const OPTIONS = preflight;

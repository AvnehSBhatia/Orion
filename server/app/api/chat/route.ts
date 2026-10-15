import type { NextRequest } from "next/server";
import { answerChat } from "@/chat/answer";
import { chatRequest } from "@/contract/schemas";
import type { ChatResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getStore, requireUser } from "@/http/deps";
import { preflight, route, scopedBody } from "@/http/route";
import { sseResponse } from "@/http/stream";
import { assertBudget, withUsage } from "@/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One model call over context retrieved up front (see `chat/answer.ts`). With `?stream=1` the answer comes as
 * server-sent events (`delta` {text} chunks, `timing`, then `done` with the full ChatResponse); otherwise one JSON
 * ChatResponse. Another person's userId takes an admin.
 */
export const POST = route(
  async (req: NextRequest): Promise<ChatResponse | Response> => {
    const body = chatRequest.parse(await scopedBody(req, { user: true }));
    const store = getStore(body.orgId);
    const user = toPublicUser(requireUser(store, body.userId));
    assertBudget(store);
    // Model calls inside are billed to the org; the stream is made inside so its start() runs in that context.
    return withUsage(store, () => {
      if (req.nextUrl.searchParams.get("stream") !== "1") return answerChat(store, user, body);
      return sseResponse(
        async (send) => send("done", await answerChat(store, user, body, (text) => send("delta", { text }), (t) => send("timing", t))),
        { fallbackError: "chat failed" },
      );
    });
  },
  { limit: "ask" },
);

export const OPTIONS = preflight;

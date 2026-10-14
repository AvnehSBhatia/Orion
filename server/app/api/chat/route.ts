import type { NextRequest } from "next/server";
import { chatRequest } from "@/contract/schemas";
import type { ChatResponse } from "@/contract/types";
import { toPublicUser, type Store } from "@/db/store";
import { readGraph } from "@/graph/view";
import { LlmChat, MAX_ITEMS, type ChatModel, type OnDelta } from "@/llm/chat";
import { getChat, getEmbedder, getLlm, getStore, requireUser } from "@/http/deps";
import { HttpError } from "@/http/error";
import { actingAs, preflight, route, scopedBody } from "@/http/route";
import { buildContext } from "@/retrieval/context";
import { askAndSaveDashboard } from "@/steer/dashboard";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One model call over context retrieved up front. With `?stream=1` the answer comes as server-sent events
 * (`delta` {text} chunks, then `done` with the full ChatResponse); otherwise one JSON ChatResponse.
 * `history` (the last 6 turns) goes into the messages so follow-ups resolve; `actions` ride in `done`.
 * Unless `skipDashboard`, the dashboard fast path runs alongside, so `npm run ask` still reshapes it.
 */
// The local embedder queues behind swarm ingest; past this budget, answer from a lexical pick instead of waiting.
const CONTEXT_BUDGET_MS = 1_200;

/** Context without embeddings: nodes and recent sources ranked by word overlap, risk, and freshness. */
function quickContext(store: Store, q: string): Awaited<ReturnType<typeof buildContext>> {
  const words = new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const overlap = (text: string) => (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => words.has(w)).length;
  const risk = { blocked: 2, at_risk: 1.5, on_track: 0, done: 0, unknown: 0.5 } as const;
  const items = readGraph(store)
    .nodes.map((n) => ({ n, score: overlap(`${n.label} ${n.summary}`) * 3 + (risk[n.status] ?? 0) + Date.parse(n.updatedAt) / 1e13 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS)
    .map(({ n }) => ({ ...n, why: "matches the question" }));
  const sources = store
    .listSources(undefined, 60)
    .map((s) => store.toPublicSource(s))
    .map((s, i) => ({ s, score: overlap(`${s.title} ${s.excerpt}`) - i / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ s }) => ({ ...s, why: "recent" }));
  return { items, sources } as Awaited<ReturnType<typeof buildContext>>;
}

// The deps cache survives dev hot reloads, so a cached chat can be an instance of the old class.
let fresh: LlmChat | null = null;
const chatModel = (): ChatModel => {
  const cached = getChat();
  return cached instanceof LlmChat ? cached : (fresh ??= new LlmChat());
};

export const POST = route(async (req: NextRequest): Promise<ChatResponse | Response> => {
  const body = chatRequest.parse(await scopedBody(req, { user: true }));
  actingAs(req, body.userId);
  const store = getStore(body.orgId);
  const embedder = getEmbedder();
  const user = toPublicUser(requireUser(store, body.userId));

  const answer = async (onDelta?: OnDelta, onTiming?: (t: Record<string, number>) => void): Promise<ChatResponse> => {
    const dashboardP = body.skipDashboard ? Promise.resolve(null) : askAndSaveDashboard(store, user, body.message, { llm: getLlm() });
    const t0 = Date.now();
    // A follow-up like "how would you fix this?" retrieves with the question it follows.
    const prev = body.history?.findLast((t) => t.role === "user")?.text;
    const q = prev ? `${prev}\n${body.message}` : body.message;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const context =
      (await Promise.race([
        buildContext(store, embedder, { userId: user.id, q, k: MAX_ITEMS }),
        new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), CONTEXT_BUDGET_MS))),
      ]).finally(() => clearTimeout(timer))) ?? quickContext(store, q);
    onTiming?.({ contextMs: Date.now() - t0 });
    const [res, dashboard] = await Promise.all([
      chatModel().reply(
        {
          user,
          org: store.getOrg(),
          message: body.message,
          history: body.history,
          context,
          currentView: body.currentView,
          knownIds: new Set(store.listNodes().map((n) => n.id)),
        },
        onDelta,
      ),
      dashboardP,
    ]);
    return { ...res, dashboard };
  };

  if (req.nextUrl.searchParams.get("stream") !== "1") return answer();

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      // Flush headers now so the client can show the answer the moment the first token lands.
      controller.enqueue(enc.encode(": open\n\n"));
      try {
        send("done", await answer((text) => send("delta", { text }), (t) => send("timing", t)));
      } catch (err) {
        send("error", { error: err instanceof HttpError ? err.message : "chat failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" } });
});

export const OPTIONS = preflight;

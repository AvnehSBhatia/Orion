import type { z } from "zod";
import type { chatRequest } from "@/contract/schemas";
import type { ChatResponse, User } from "@/contract/types";
import type { Store } from "@/db/store";
import { readGraph } from "@/graph/view";
import { askAndSaveDashboard } from "@/dashboard/ask";
import { getChat, getEmbedder, getLlm } from "@/http/deps";
import { buildContext } from "@/retrieval/context";
import { LlmChat, MAX_ITEMS, type ChatModel, type OnDelta } from "./model";

// The local embedder can queue behind a burst of ingest; past this budget, answer from a lexical pick instead of waiting.
const CONTEXT_BUDGET_MS = 1_200;

type Context = Awaited<ReturnType<typeof buildContext>>;

/** Context without embeddings: nodes and recent sources ranked by word overlap, risk, and freshness. */
export function quickContext(store: Store, q: string): Context {
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
  return { items, sources } as Context;
}

// The deps cache survives dev hot reloads, so a cached chat can be an instance of the old class.
let fresh: LlmChat | null = null;
const chatModel = (): ChatModel => {
  const cached = getChat();
  return cached instanceof LlmChat ? cached : (fresh ??= new LlmChat());
};

/**
 * One model call over context retrieved up front. `history` (the last 6 turns) goes into the messages so
 * follow-ups resolve. Unless `skipDashboard`, the dashboard fast path runs alongside, so a layout request in chat
 * still reshapes the dashboard.
 */
export async function answerChat(
  store: Store,
  user: User,
  body: z.infer<typeof chatRequest>,
  onDelta?: OnDelta,
  onTiming?: (t: Record<string, number>) => void,
): Promise<ChatResponse> {
  const dashboardP = body.skipDashboard ? Promise.resolve(null) : askAndSaveDashboard(store, user, body.message, { llm: getLlm() });
  const t0 = Date.now();
  // A follow-up like "how would you fix this?" retrieves with the question it follows.
  const prev = body.history?.findLast((t) => t.role === "user")?.text;
  const q = prev ? `${prev}\n${body.message}` : body.message;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const context =
    (await Promise.race([
      buildContext(store, getEmbedder(), { userId: user.id, q, k: MAX_ITEMS }),
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
}

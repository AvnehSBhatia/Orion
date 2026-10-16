import type { z } from "zod";
import { config } from "@/config";
import type { chatRequest } from "@/contract/schemas";
import type { ChatResponse, PublicNode, User } from "@/contract/types";
import type { Store } from "@/db/store";
import { readGraph } from "@/graph/view";
import { askAndSaveDashboard, looksLikeLayoutRequest } from "@/dashboard/ask";
import { getChat, getEmbedder, getLlm } from "@/http/deps";
import { MAX_OPTIONS, decide as openRouterDecide, type Decide } from "@/llm/decisions";
import { hiddenSourceIds, type Viewer } from "@/orgs/visibility";
import { buildContext } from "@/retrieval/context";
import { BudgetExceededError } from "@/usage";
import { LlmChat, MAX_ITEMS, type ChatModel, type OnDelta } from "./model";
import { jevAnswer, routeMessage, type Routed } from "./router";

// The local embedder can queue behind a burst of ingest; past this budget, answer from a lexical pick instead of waiting.
const CONTEXT_BUDGET_MS = 1_200;
// Recent documents searched for the one that last changed each item Jev answers about.
const JEV_SOURCES = 200;

type Context = Awaited<ReturnType<typeof buildContext>>;

/** Every node, ranked by word overlap with the question, risk, and freshness. */
function rankNodes(store: Store, q: string): PublicNode[] {
  const words = new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const overlap = (text: string) => (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => words.has(w)).length;
  const risk = { blocked: 2, at_risk: 1.5, on_track: 0, done: 0, unknown: 0.5 } as const;
  return readGraph(store)
    .nodes.map((n) => ({ n, score: overlap(`${n.label} ${n.summary}`) * 3 + (risk[n.status] ?? 0) + Date.parse(n.updatedAt) / 1e13 }))
    .sort((a, b) => b.score - a.score)
    .map(({ n }) => n);
}

/** Context without embeddings: nodes and recent sources ranked by word overlap, risk, and freshness. */
export function quickContext(store: Store, q: string, viewer: Viewer = null): Context {
  const hidden = hiddenSourceIds(store, viewer);
  const words = new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const overlap = (text: string) => (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => words.has(w)).length;
  const items = rankNodes(store, q)
    .slice(0, MAX_ITEMS)
    .map((n) => ({ ...n, why: "matches the question" }));
  const sources = store
    .listSources(undefined, 60)
    .filter((s) => !hidden.has(s.id))
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

/** Overridable in tests. */
export const routerDeps: { decide: Decide } = { decide: openRouterDecide };

/** The router's pick, or the chat model when the router is off or fails: a router never stops an answer. */
async function route(store: Store, user: User, message: string, prev: string | undefined): Promise<Routed> {
  if (!config.routerOn) return { to: "llm", why: "router" };
  try {
    return await routeMessage(routerDeps.decide, {
      user,
      message,
      prev,
      nodes: rankNodes(store, prev ? `${prev}\n${message}` : message).slice(0, MAX_OPTIONS),
      dashboardTitle: store.getDashboard(user.id)?.title,
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    console.error("Jev router failed, answering with the chat model:", err instanceof Error ? err.message : err);
    return { to: "llm", why: "router" };
  }
}

/**
 * The Jev router first (see `chat/router.ts`): a lookup is answered from the item cards and a layout request reshapes
 * the dashboard, with no chat model call. Everything else is one model call over context retrieved up front, which
 * runs alongside the router so the chat path waits on nothing extra. `history` (the last 6 turns) goes into the
 * messages so follow-ups resolve. Unless `skipDashboard`, the dashboard fast path runs alongside, so a layout request
 * in chat still reshapes the dashboard.
 */
export async function answerChat(
  store: Store,
  user: User,
  body: z.infer<typeof chatRequest>,
  onDelta?: OnDelta,
  onTiming?: (t: Record<string, number>) => void,
  viewer: Viewer = null,
): Promise<ChatResponse> {
  const dashboardP = body.skipDashboard ? Promise.resolve(null) : askAndSaveDashboard(store, user, body.message, { llm: getLlm() });
  const t0 = Date.now();
  // A follow-up like "how would you fix this?" retrieves with the question it follows.
  const prev = body.history?.findLast((t) => t.role === "user")?.text;
  const q = prev ? `${prev}\n${body.message}` : body.message;
  const routedP = route(store, user, body.message, prev).then((r) => (onTiming?.({ routeMs: Date.now() - t0, jev: r.to === "jev" ? 1 : 0 }), r));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const contextP = Promise.race([
    buildContext(store, getEmbedder(), { userId: user.id, q, k: MAX_ITEMS, viewer }),
    new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), CONTEXT_BUDGET_MS))),
  ]).finally(() => clearTimeout(timer));
  // A failed retrieval surfaces only if the chat model needs it.
  contextP.catch(() => {});

  const routed = await routedP;
  if (routed.to === "jev") {
    const res = await jevReply(store, user, body, routed, dashboardP, viewer);
    if (res) {
      onDelta?.(res.reply);
      return res;
    }
  }

  const context = (await contextP) ?? quickContext(store, q, viewer);
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

/** Jev's reply, or null when it has nothing to say and the chat model should answer instead. */
async function jevReply(
  store: Store,
  user: User,
  body: z.infer<typeof chatRequest>,
  routed: Extract<Routed, { to: "jev" }>,
  dashboardP: Promise<Awaited<ReturnType<typeof askAndSaveDashboard>>>,
  viewer: Viewer,
): Promise<ChatResponse | null> {
  if (routed.task === "answer") {
    const hidden = hiddenSourceIds(store, viewer);
    const sources = store
      .listSources(undefined, JEV_SOURCES)
      .filter((s) => !hidden.has(s.id))
      .map((s) => store.toPublicSource(s));
    return { ...jevAnswer(routed.items, sources), dashboard: await dashboardP };
  }
  // The web app reshapes on its own for words that read as a layout request (skipDashboard); otherwise Jev's call is
  // what reshapes it, even when the words alone would not have.
  if (body.skipDashboard && looksLikeLayoutRequest(body.message)) {
    return { reply: "Updating your dashboard now.", viewCommand: null, dashboard: null, sources: [], actions: [] };
  }
  const dashboard = body.skipDashboard
    ? await askAndSaveDashboard(store, user, body.message, { llm: getLlm(), force: true })
    : ((await dashboardP) ?? (await askAndSaveDashboard(store, user, body.message, { llm: getLlm(), force: true })));
  if (!dashboard) return null;
  return { reply: `Your dashboard now shows ${dashboard.title}.`, viewCommand: null, dashboard, sources: [], actions: [] };
}

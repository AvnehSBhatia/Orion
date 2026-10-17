// Reshapes a dashboard from one message in two steps. `parseAsk` and `draftDashboard` build an instant draft with no
// model. One small model call then refines the draft, and only when the parser left words it did not understand. A
// refinement that drops a filter the parser was sure of is rejected, so "blocked marketing" can never come back as
// all of marketing.
import type { DashboardSpec, GraphResponse, User, Widget } from "@/contract/types";
import type { Store } from "@/db/store";
import { readGraph } from "@/graph/view";
import { config } from "@/config";
import { completeJson } from "@/llm/openrouter";
import type { ComposeDeps } from "./compose";
import { draftDashboard, enforceOnly, keepsFilters } from "./draft";
import { heuristicDashboard } from "./heuristic";
import { parseAsk, uniq, type AskIntent } from "./parse";
import { DASHBOARD_JSON_SCHEMA, WIDGET_GUIDE, sanitizeDashboard } from "./widgets";
import { BudgetExceededError } from "@/usage";

const ASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["change", "dashboard"],
  properties: {
    change: { type: "boolean", description: "true when the message asks to see, track, or change the dashboard, or states the person's role." },
    dashboard: DASHBOARD_JSON_SCHEMA,
  },
} as const;

const ASK_PROMPT = `You edit one person's dashboard from their message. Set change true when they ask to see, show, track, add, remove, or rebuild anything, or say who they are; then return the full new dashboard. Set change false for plain questions.
When a draft is given, it already has the filters the message names: keep them, fix titles, add what the message asks for that the draft missed, and drop what it did not ask for. Without a draft, start from the current dashboard and change only what was asked.
"Only X" or "just X": every widget is about X, plus at most one activity widget.
${WIDGET_GUIDE}
Filters: domains, statuses, owner (a name), query (words in label or summary), sinceHours (today 24, this week 168), source (tool it was captured from, like google ads, hubspot, code). Never use nodeIds. Use at most 8 widgets. The board title says what it shows, never the person's name. Titles are a few plain words in sentence case. No em dashes or exclamation marks. Reply with compact JSON on one line, no indentation.`;

// Words that mean a layout request. Anything else that reads as a plain question skips the model.
const LAYOUT_WORDS =
  /\b(show|dashboard|board|focus|track|view|only|just|add|remove|put|switch|rebuild|replace|swap|hide|pin|widgets?|chart|kpi|layout|display|see|watch|monitor|i am|i'm|im a|as a|my role)\b/i;
const QUESTION = /\?\s*$|^\s*(what|who|why|how|when|where|which|is|are|does|do|did|can|could|should|will|would)\b/i;

/** Cheap pre-check: true unless the message is clearly a plain question with no layout words. */
export function looksLikeLayoutRequest(message: string): boolean {
  return LAYOUT_WORDS.test(message);
}

/** A layout request, or a bare filter phrase like "blocked marketing work" that is not a question. */
function isAsk(message: string, intent: AskIntent): boolean {
  if (looksLikeLayoutRequest(message)) return true;
  return !QUESTION.test(message) && intent.groups.some((g) => g.domains || g.owner || g.source || g.statuses);
}

const ASK_TIMEOUT_MS = 8_000;
const ASK_LABELS = 30;

/** Non-null filter fields only, so the prompt stays small. */
function compactWidgets(widgets: Widget[]) {
  return widgets.map((w) => {
    const f = w.filter ? Object.fromEntries(Object.entries(w.filter).filter(([, v]) => v !== null && v !== undefined)) : null;
    return { kind: w.kind, title: w.title, size: w.size, ...(w.metric ? { metric: w.metric } : {}), ...(f && Object.keys(f).length ? { filter: f } : {}), ...(w.text ? { text: w.text } : {}) };
  });
}

function sourceHosts(graph: Pick<GraphResponse, "nodes">): string[] {
  const hosts = graph.nodes.map((n) => {
    if (n.sourceKind === "code") return "code";
    try {
      return new URL(n.sourceRef).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  });
  return uniq(hosts.filter((h): h is string => !!h)).slice(0, 12);
}

export type AskDeps = ComposeDeps & {
  /** Called with the instant draft before the model is asked, so the UI can show it right away. */
  onDraft?: (spec: DashboardSpec) => void;
  /** Reshape even when the words do not read as a layout request (the Jev router already decided it is one). */
  force?: boolean;
};

export type AskTrace = { draft: boolean; modelCalls: number; promptChars: number; ms: number };

/**
 * Reshapes the dashboard for one message: the instant draft (handed to `onDraft`), then at most one
 * model call to refine it. Returns the final spec, or null when the message did not ask for a change.
 * Node ids are limited to the real graph.
 */
export async function askDashboard(
  user: User,
  message: string,
  current: DashboardSpec,
  graph: Pick<GraphResponse, "nodes">,
  { llm, model = config.fastModel, now = new Date(), onDraft, force }: AskDeps,
  trace?: AskTrace,
): Promise<DashboardSpec | null> {
  const t0 = Date.now();
  const intent = parseAsk(message, user, graph);
  if (!force && !isAsk(message, intent)) return null;
  const parsed = draftDashboard(user, message, current, graph, now, intent);
  const draft = parsed && intent.only ? enforceOnly(parsed) : parsed;
  if (trace) trace.draft = !!draft;
  if (draft) onDraft?.(draft);
  // Everything in the message was understood: the draft is the answer, no model needed.
  if (draft && !intent.leftover.length) {
    if (trace) trace.ms = Date.now() - t0;
    return draft;
  }

  const owners = uniq(graph.nodes.flatMap((n) => (n.owner ? [n.owner] : []))).slice(0, 12);
  const userMsg = [
    `Person: ${user.name}. Role: ${user.role}`,
    `Owners: ${owners.join(", ") || "none"}. Sources: ${sourceHosts(graph).join(", ") || "none"}.`,
    draft
      ? `Draft: ${JSON.stringify({ title: draft.title, widgets: compactWidgets(draft.widgets) })}`
      : `Current dashboard: ${JSON.stringify({ title: current.title, widgets: compactWidgets(current.widgets) })}\nSome work: ${graph.nodes
          .slice(0, ASK_LABELS)
          .map((n) => n.label)
          .join("; ")}`,
    `Message: ${message}`,
  ].join("\n");
  if (trace) {
    trace.modelCalls = 1;
    trace.promptChars = ASK_PROMPT.length + userMsg.length;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ASK_TIMEOUT_MS}ms`)), ASK_TIMEOUT_MS);
    });
    const raw = (await Promise.race([
      completeJson(llm, { model, name: "dashboard_edit", schema: ASK_SCHEMA, system: ASK_PROMPT, user: userMsg, maxTokens: 2000 }),
      timeout,
    ])) as { change?: unknown; dashboard?: unknown } | null;
    if (!raw || raw.change !== true) return draft;
    let spec = sanitizeDashboard(raw.dashboard, { origin: "chat", allowedIds: new Set(graph.nodes.map((n) => n.id)), now });
    if (!spec) return draft;
    if (draft && !keepsFilters(intent.groups, spec)) {
      console.error(`Dashboard ask for ${user.id}: the model dropped a filter, keeping the draft`);
      return draft;
    }
    if (intent.only) spec = enforceOnly(spec);
    return spec;
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    console.error(`Dashboard ask for ${user.id} failed:`, err instanceof Error ? err.message : err);
    return draft;
  } finally {
    clearTimeout(timer);
    if (trace) trace.ms = Date.now() - t0;
  }
}

/**
 * askDashboard against the store: the draft is saved (and handed to `onDraft`) the moment it exists, and
 * the refined spec replaces it when the model returns, so the person's board survives a reload either way.
 */
export async function askAndSaveDashboard(store: Store, user: User, message: string, deps: AskDeps, trace?: AskTrace): Promise<DashboardSpec | null> {
  const graph = readGraph(store);
  const current = store.getDashboard(user.id) ?? heuristicDashboard(user, graph, deps.now);
  const next = await askDashboard(
    user,
    message,
    current,
    graph,
    {
      ...deps,
      onDraft: (draft) => {
        store.saveDashboard(user.id, draft);
        deps.onDraft?.(draft);
      },
    },
    trace,
  );
  if (next) store.saveDashboard(user.id, next);
  return next;
}

import type { ChatAction, ChatTurn, Source } from "@/lib/api/types";

export type Message = {
  role: "user" | "assistant";
  text: string;
  /** Documents the reply cites as [1], [2] (or [S1]), in order. */
  sources?: Source[];
  /** The reply is still streaming in; `text` fills token by token. */
  pending?: boolean;
  /** Suggested next steps under the reply. */
  actions?: ChatAction[];
  /** The personal briefing Orion opens with, not an answer to a question. */
  brief?: boolean;
  /** The answer failed; `text` is friendly copy and the question can be sent again. */
  failed?: { question: string };
};

export const MAX_HISTORY = 6;
export const HISTORY_CHARS = 600;

/** The last 6 turns with text, trimmed to what the backend accepts. */
export const toHistory = (turns: ChatTurn[]): ChatTurn[] =>
  turns
    .filter((t) => t.text.trim())
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, text: t.text.slice(0, HISTORY_CHARS) }));

/** Hides the scope prefix the project panel adds ("About \"X\": ") when showing a question back. */
export const plainQuestion = (text: string) => text.replace(/^About "[^"]*":\s*/, "");

// Mirrors the backend's pre-check: only these messages can reshape the dashboard, so only they show the pill.
const LAYOUT_ASK =
  /\b(show|dashboard|board|focus|track|view|only|just|add|remove|put|switch|rebuild|replace|swap|hide|pin|widgets?|chart|kpi|layout|display|see|watch|monitor|i am|i'm|im a|as a|my role)\b/i;
// A bare filter phrase ("blocked marketing work") reshapes too, unless it reads as a question.
const FILTER_ASK = /\b(blocked|at risk|on track|done|shipped|marketing|sales|engineering|ops|deals?|campaigns?|google ads|hubspot|commits?|today|this week|mine)\b/i;
const QUESTION_ASK = /\?\s*$|^\s*(what|who|why|how|when|where|which|is|are|does|do|did|can|could|should|will|would)\b/i;
export const isLayoutAsk = (text: string) => LAYOUT_ASK.test(text) || (FILTER_ASK.test(text) && !QUESTION_ASK.test(text));

// First match wins, so the broadest seats (founders, execs) are checked before the functions they span.
const ROLE_PROMPTS: { match: RegExp; prompts: string[] }[] = [
  {
    match: /\b(founder|co-founder|ceo|coo|chief|head of|director|vp|executive)\b/i,
    prompts: ["What changed in the last hour?", "Where are we at risk this week?", "Build me a dashboard for a board update"],
  },
  {
    match: /\b(sales|account exec\w*|ae|sdr|revenue|deals?|customer success|partnerships?)\b/i,
    prompts: ["What can I promise customers this week?", "Which deals are blocked, and on what?", "Rebuild my dashboard around what I can sell"],
  },
  {
    match: /\b(marketing|marketer|growth|brand|content|campaigns?|seo)\b/i,
    prompts: ["What shipped that I can announce?", "What changed in campaigns today?", "Show me only sellable work on my dashboard"],
  },
  {
    match: /\b(ops|operations|security|compliance|finance|legal|hr|recruiting)\b/i,
    prompts: ["What is blocked on ops right now?", "Where are the ownership gaps?", "Focus my dashboard on risks and gaps"],
  },
  {
    match: /\b(engineer\w*|developer|dev|platform|infra\w*|backend|frontend|cto|ml|data)\b/i,
    prompts: ["What did the team commit in the last hour?", "What is blocked in engineering?", "Rebuild my dashboard around code changes"],
  },
];

export function promptsForRole(role: string | null | undefined) {
  const hit = role ? ROLE_PROMPTS.find((item) => item.match.test(role)) : undefined;
  return hit?.prompts ?? ["What changed today?", "What is blocked this week?", "Focus my dashboard on blocked work"];
}

// The Jev router: every chat message goes first to Drex, a yes/no decision model, which says whether it is a lookup
// Jev can handle from the work items or needs the chat model. Jev, a general decision model, then reads up to 255 item
// cards at once and picks the task (answer from the cards, or change the dashboard) and the items it is about.
// Neither writes text, so a Jev answer is built from the cards themselves: no chat model call at all.
import { config } from "@/config";
import type { ChatAction, ChatResponse, PublicNode, Source, User, ViewCommand } from "@/contract/types";
import { clamp, plain } from "@/lib/text";
import { MAX_OPTIONS, type Decide } from "@/llm/decisions";

/** Least share of Jev's item vote that puts an item in the answer, and that the top item needs for Jev to answer. */
const ITEM_MIN = 0.15;
const TOP_ITEM_MIN = 0.3;
const MAX_ANSWER_ITEMS = 3;
const NONE = "none";

export type Routed =
  | { to: "llm"; why: "router" | "jev" | "no item" }
  | { to: "jev"; task: "answer"; items: PublicNode[] }
  | { to: "jev"; task: "dashboard" };

export type RouteInput = {
  user: Pick<User, "name" | "role">;
  message: string;
  /** The question this one follows, so "and who owns it?" routes like its question. */
  prev?: string;
  /** Item cards, most relevant first; the first 254 go to Jev. */
  nodes: PublicNode[];
  dashboardTitle?: string;
};

const DREX_ROUTE = {
  type: "choice",
  instructions: "Pick who handles this message from a teammate in a work tool.",
  criteria: {
    jev: "A lookup: the status, owner, blocker, or latest update of team work items, or a request to change what the dashboard shows. Answerable by pointing at items.",
    llm: "Needs writing or reasoning: drafting text, explaining, advising, planning, comparing, or anything beyond looking up items.",
  },
} as const;

const JEV_TASK = {
  type: "choice",
  instructions: "What should be done for this message?",
  criteria: {
    answer: "Answer it by pointing at one to three of the work items: their status, owner, blocker, or latest update.",
    dashboard: "Change what the person's dashboard shows: add, remove, focus, or filter what is on it.",
    llm: "Needs a written explanation, advice, a plan, or a summary of many items that pointing at items cannot give.",
  },
} as const;

const card = (n: PublicNode) =>
  clamp(`${n.label} (${n.domain}, ${n.status.replace("_", " ")}${n.owner ? `, ${n.owner}` : ""}, updated ${n.updatedAt.slice(0, 10)}): ${n.summary}`, 240);

/** Drex decides, then Jev, only when Drex sent the message its way. Throws when a model fails; the caller falls back. */
export async function routeMessage(decide: Decide, input: RouteInput): Promise<Routed> {
  const { user, message, prev, nodes } = input;
  const state = { message, ...(prev && { earlierQuestion: prev }) };
  const drex = await decide({ model: config.routerModel, state, questions: { route: DREX_ROUTE } });
  if ((drex.route.probabilities.jev ?? 0) < config.routerJevMin) return { to: "llm", why: "router" };

  const shown = nodes.slice(0, MAX_OPTIONS - 1);
  const criteria: Record<string, string> = { [NONE]: "None of these items is what the message is about." };
  shown.forEach((n, i) => (criteria[`i${i}`] = card(n)));
  const jev = await decide({
    model: config.jevModel,
    state: { ...state, asking: `${user.name}, ${clamp(user.role, 200)}`, ...(input.dashboardTitle && { dashboard: input.dashboardTitle }) },
    questions: { task: JEV_TASK, item: { type: "choice", instructions: "Which work item is the message about?", criteria } },
  });
  const task = jev.task.choice;
  if (task === "dashboard") return { to: "jev", task: "dashboard" };
  if (task !== "answer") return { to: "llm", why: "jev" };
  const votes = Object.entries(jev.item.probabilities)
    .filter(([k]) => k !== NONE)
    .sort((a, b) => b[1] - a[1]);
  if (!votes.length || votes[0][1] < TOP_ITEM_MIN) return { to: "llm", why: "no item" };
  const items = votes
    .filter(([, p]) => p >= ITEM_MIN)
    .slice(0, MAX_ANSWER_ITEMS)
    .map(([k]) => shown[Number(k.slice(1))])
    .filter((n): n is PublicNode => !!n)
    // Newest first: when two items disagree, the latest update is the answer.
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return items.length ? { to: "jev", task: "answer", items } : { to: "llm", why: "no item" };
}

const STATUS: Record<PublicNode["status"], string> = { blocked: "blocked", at_risk: "at risk", on_track: "on track", done: "done", unknown: "of unknown status" };

const firstSentence = (text: string) => clamp(plain(text).match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? plain(text), 160);

/**
 * Jev's answer, written from the item cards: one sentence per item, newest first, each citing the latest document that
 * changed it. `sources` are the documents the person may see, newest first.
 */
export function jevAnswer(items: PublicNode[], sources: Source[]): ChatResponse {
  const cited: Source[] = [];
  const sentences = items.map((n) => {
    const src = sources.find((s) => s.changes.some((c) => c.nodeId === n.id));
    let ref = "";
    if (src) {
      if (!cited.includes(src)) cited.push(src);
      ref = ` [${cited.indexOf(src) + 1}]`;
    }
    const summary = firstSentence(n.summary).replace(/[.!?]$/, "");
    return `${n.label} is ${STATUS[n.status]}${n.owner ? `, with ${n.owner}` : ""}${summary ? `: ${summary}` : ""}.${ref}`;
  });
  const ids = items.map((n) => n.id);
  const viewCommand: ViewCommand = { focusNodeIds: ids, highlightNodeIds: ids, visibleDomains: null, layout: "clusters", caption: "" };
  const actions: ChatAction[] = items.map((n) => ({ kind: "open", label: `Open ${n.label}`.split(/\s+/).slice(0, 4).join(" "), value: n.id, target: "node" }));
  return { reply: sentences.join(" "), viewCommand, dashboard: null, sources: cited, actions };
}

import { config } from "@/config";
import { viewCommand as viewCommandSchema } from "@/contract/schemas";
import type { ChatAction, ChatResponse, ChatTurn, Org, PublicNode, Source, User, ViewCommand } from "@/contract/types";
import { clamp, plain } from "@/lib/text";
import { HttpError } from "@/server/http";
import { OpenRouterClient, type ChatMessage, type CompletionRequest, type LlmClient } from "./openrouter";

type Why = { why?: string };

export type ChatInput = {
  user: User;
  /** The org profile, so answers use the org's own names for things. */
  org?: Pick<Org, "name" | "description" | "context"> | null;
  message: string;
  /** Earlier turns, oldest first (at most 6), so follow-ups resolve "this" and "it". */
  history?: ChatTurn[];
  /** Retrieved before the model runs (buildContext), so one model call is enough. */
  context: { items: (PublicNode & Why)[]; sources: (Source & Why)[] };
  currentView: ViewCommand | null;
  /** Every node id in the graph, so the view can only point at real stars. */
  knownIds: ReadonlySet<string>;
  now?: Date;
};

/** Called with each chunk of reply text as the model writes it (raw, citations not yet renumbered). */
export type OnDelta = (text: string) => void;

export interface ChatModel {
  reply(input: ChatInput, onDelta?: OnDelta): Promise<ChatResponse>;
}

/** Streams one completion's text, calling onDelta per chunk; resolves with the whole text. */
export type Streamer = (req: CompletionRequest, onDelta: OnDelta) => Promise<string>;

/**
 * The model for interactive answers and dashboard edits. Measured on OpenRouter (8 items, 200 tokens):
 * gemini-2.5-flash-lite starts in about 0.5s, deepseek-v4-flash in about 1.6 to 2.1s.
 */
export const FAST_MODEL = process.env.OPENROUTER_FAST_MODEL || "google/gemini-2.5-flash-lite";

export const MAX_ITEMS = 8;
export const MAX_SOURCES = 5;
const EXCERPT_CHARS = 300;
// Room for two sentences plus the ACTIONS line; the answer text comes first, so first-token time is unchanged.
const MAX_TOKENS = 300;
export const MAX_ACTIONS = 3;
const ACTION_TAIL = "ACTIONS:";

// Some models (DeepSeek) occasionally write tool markup into the text; never show it.
const LEAKED_CALL = /<\/?\s*[｜|]\s*(?:DSML|tool[▁_ ]?call)/i;
const stripLeaked = (text: string) => {
  const at = text.search(LEAKED_CALL);
  return (at < 0 ? text : text.slice(0, at)).trim();
};

/** Recovers tool calls a model wrote as DSML markup. */
export function parseLeakedCalls(text: string): { name: string; args: Record<string, unknown> }[] {
  const tag = String.raw`<\/?\s*[｜|]\s*DSML\s*[｜|]\s*`;
  const out: { name: string; args: Record<string, unknown> }[] = [];
  for (const block of text.split(new RegExp(`${tag}invoke\\s+name="`)).slice(1)) {
    const name = block.match(/^([\w-]+)"/)?.[1];
    if (!name) continue;
    const args: Record<string, unknown> = {};
    const param = new RegExp(`${tag}parameter\\s+name="([\\w-]+)"(?:\\s+string="(true|false)")?\\s*>([\\s\\S]*?)(?=${tag}parameter\\s*>|${tag}parameter\\s+name=|${tag}invoke|$)`, "g");
    for (const m of block.matchAll(param)) {
      const raw = m[3].trim();
      if (m[2] === "true") args[m[1]] = raw;
      else {
        try {
          args[m[1]] = JSON.parse(raw);
        } catch {
          args[m[1]] = raw;
        }
      }
    }
    out.push({ name, args });
  }
  return out;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The system prompt: the person's own chief of staff, framed by the role they wrote for themselves. */
export function chatPrompt(user: Pick<User, "name" | "role">, org?: Pick<Org, "name"> | null): string {
  const first = firstName(user.name);
  return `You are ${first}'s personal chief of staff${org ? ` at ${org.name}` : ""}. ${first}'s role, in their words: "${clamp(user.role, 300)}".
Talk to ${first} directly, in second person: warm, direct, no filler, never "As an AI". Use the role to decide what matters to them and frame the answer for it (for a seller, "For your sales call: ...").
Answer in at most 2 short sentences, 45 words total, unless they ask for detail. No preamble, no lists, no headings. Lead with the answer.
Use only the items and sources below, which teammates captured and committed. For open questions like what to work on, lead with items whose why starts with "for you". When two things disagree, trust the newer one.
Cite every factual claim with the handle of the source behind it, in brackets right after the claim, like [S2] or [S1, S3]; at most 3 sources in total. Only S handles are citations: never put item ids or names in brackets. If the context does not answer the question, say so in one sentence.
Earlier messages are the conversation so far; resolve "this", "it", and "that" from them.
Use the items' own names. Plain words, sentence case, no em dashes, no exclamation marks. Sellable false means sales must not mention it to customers yet.
Then end with one line of up to 3 next steps ${first} would take, each with a 2 to 4 word label in parentheses:
${ACTION_TAIL} open:S2 (Read the launch plan) | ask:How do we unblock voice mode? (How to unblock) | show:blocked engineering work (Show blockers)
open takes a source handle or an item id, ask takes a follow-up question in ${first}'s words, show takes a dashboard view to build. Leave the line out if nothing fits.`;
}

function compactNode(n: PublicNode & Why) {
  return { id: n.id, label: n.label, domain: n.domain, status: n.status, owner: n.owner, sellable: n.sellable, summary: n.summary, updatedAt: n.updatedAt, why: n.why };
}

export function sanitizeView(raw: unknown, knownIds: ReadonlySet<string>): ViewCommand | null {
  const parsed = viewCommandSchema.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  const real = (ids: string[]) => [...new Set(ids)].filter((id) => knownIds.has(id));
  return {
    focusNodeIds: real(v.focusNodeIds),
    highlightNodeIds: real(v.highlightNodeIds),
    visibleDomains: v.visibleDomains?.length ? [...new Set(v.visibleDomains)] : null,
    layout: v.layout,
    caption: clamp(v.caption, 120),
  };
}

/** Gives every document the model sees a short stable handle (S1, S2, ...) for citations. */
export class Handles {
  private byId = new Map<string, string>();
  readonly sources = new Map<string, Source>();

  add(s: Source): string {
    let h = this.byId.get(s.id);
    if (!h) {
      h = `S${this.byId.size + 1}`;
      this.byId.set(s.id, h);
      this.sources.set(h, s);
    }
    return h;
  }

  brief(s: Source & Why) {
    return {
      handle: this.add(s),
      title: s.title,
      author: s.authorName,
      createdAt: s.createdAt,
      why: s.why,
      excerpt: clamp(s.excerpt ?? "", EXCERPT_CHARS),
      changes: s.changes.slice(0, 4).map((c) => `${c.label}: ${c.change}${c.statusFrom && c.statusFrom !== c.statusTo ? `, ${c.statusFrom} to ${c.statusTo}` : ""}`),
    };
  }

  /** Renumbers cited handles in order of first use: [S4] then [S2] become [1] and [2]. */
  cite(reply: string): { reply: string; sources: Source[] } {
    const order: string[] = [];
    const text = reply.replace(/(\s*)\[(S\d+(?:\s*,\s*S\d+)*)\]/g, (_m, space: string, list: string) => {
      const nums = list.split(/\s*,\s*/).flatMap((h) => {
        if (!this.sources.has(h)) return [];
        if (!order.includes(h)) order.push(h);
        return [order.indexOf(h) + 1];
      });
      return nums.length ? `${space}[${nums.join(", ")}]` : "";
    });
    // Models sometimes cite node ids instead of handles; drop any other bracketed tag.
    // Item ids and labels too, even with spaces, like [general-release] or [launch announcement].
    return { reply: text.replace(/\s*\[(?!\d)[^[\]\n]{1,60}\]/g, ""), sources: order.map((h) => this.sources.get(h)!) };
  }
}

export const MAX_CITATIONS = 3;

/** At most 3 cited sources: citations past the third distinct source are dropped. */
export function capCitations(reply: string, cited: Source[], max = MAX_CITATIONS): { reply: string; sources: Source[] } {
  const sources = cited.slice(0, max);
  const text = reply.replace(/\s*\[(\d+(?:\s*,\s*\d+)*)\]/g, (_m, list: string) => {
    const keep = list.split(/\s*,\s*/).filter((n) => Number(n) <= sources.length);
    return keep.length ? ` [${keep.join(", ")}]` : "";
  });
  return { reply: text, sources };
}

/** Lights the stars the answer talks about: items named in the reply, else nodes the cited sources changed. */
function viewFor(reply: string, items: PublicNode[], cited: Source[], knownIds: ReadonlySet<string>): ViewCommand | null {
  const lower = reply.toLowerCase();
  let ids = items.filter((n) => n.label.length > 2 && lower.includes(n.label.toLowerCase())).map((n) => n.id);
  if (!ids.length) ids = cited.flatMap((s) => s.changes.map((c) => c.nodeId));
  ids = [...new Set(ids)].filter((id) => knownIds.has(id)).slice(0, 6);
  if (!ids.length) return null;
  return { focusNodeIds: ids.slice(0, 3), highlightNodeIds: ids, visibleDomains: null, layout: "clusters", caption: "" };
}

/** Where the visible answer ends: before the ACTIONS line, holding back a partial "ACTIO" and trailing whitespace. */
export function visibleEnd(text: string): number {
  const at = text.indexOf(ACTION_TAIL);
  if (at >= 0) return text.slice(0, at).trimEnd().length;
  // Trailing whitespace waits too, so the line break before ACTIONS never streams.
  for (let n = Math.min(ACTION_TAIL.length - 1, text.length); n > 0; n--) {
    if (ACTION_TAIL.startsWith(text.slice(-n))) return text.slice(0, -n).trimEnd().length;
  }
  return text.trimEnd().length;
}

/** Splits the reply from its ACTIONS line. */
export function splitActions(text: string): { body: string; tail: string } {
  const at = text.indexOf(ACTION_TAIL);
  return at < 0 ? { body: text, tail: "" } : { body: text.slice(0, at).replace(/[\s*_]+$/, ""), tail: text.slice(at + ACTION_TAIL.length) };
}

const words = (text: string, n: number) => text.replace(/["'`*]/g, "").replace(/[?.:,;]+$/, "").trim().split(/\s+/).filter(Boolean).slice(0, n).join(" ");

/** Parses `open:S2 (Label) | ask:question (Label) | show:request (Label)` into at most 3 actions that point at real things. */
export function parseActions(
  tail: string,
  { sources, items, knownIds }: { sources: ReadonlyMap<string, Source>; items: readonly PublicNode[]; knownIds: ReadonlySet<string> },
): ChatAction[] {
  const out: ChatAction[] = [];
  for (const part of tail.split(/\s*\|\s*|\n+/)) {
    const m = part.trim().match(/^[-*\s]*(open|ask|show)\s*:\s*(.+?)\s*(?:\(([^()]*)\))?\s*$/i);
    if (!m) continue;
    const kind = m[1].toLowerCase() as ChatAction["kind"];
    const value = clamp(plain(m[2].replace(/^["']|["']$/g, "")), 200);
    let label = words(plain(m[3] ?? ""), 4);
    if (!value) continue;
    let action: ChatAction;
    if (kind === "open") {
      const handle = value.replace(/^\[|\]$/g, "").toUpperCase();
      const source = sources.get(handle);
      const node = knownIds.has(value) ? value : null;
      if (source) action = { kind, label: label || words(`Open ${source.title}`, 4), value: source.id, target: "source" };
      else if (node) action = { kind, label: label || words(`Open ${items.find((n) => n.id === node)?.label ?? node}`, 4), value: node, target: "node" };
      else continue;
    } else {
      if (!label) label = kind === "show" ? words(`Show ${value}`, 4) : words(value, 4);
      action = { kind, label, value };
    }
    if (label.split(/\s+/).length < 2 && kind !== "open") action.label = words(`${kind === "show" ? "Show" : "Ask"} ${label}`, 4);
    if (out.some((a) => a.kind === action.kind && a.value === action.value)) continue;
    out.push(action);
    if (out.length === MAX_ACTIONS) break;
  }
  return out;
}

/** Drops the citation chips' numbers from an earlier answer, so they are not mistaken for this turn's handles. */
const uncite = (text: string) => text.replace(/\s*\[\s*S?\d+(?:\s*,\s*S?\d+)*\s*\]/g, "").trim();

/** OpenRouter with stream: true, read as server-sent events. */
export const openRouterStream: Streamer = async (req, onDelta) => {
  const key = config.openRouterKey;
  if (!key) throw new HttpError(503, "OPENROUTER_API_KEY is not set on the backend");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Orion" },
    // Reasoning would spend the small token budget before the answer starts.
    body: JSON.stringify({ ...req, stream: true, reasoning: { enabled: false } }),
  }).catch((err) => {
    console.error("OpenRouter unreachable", err);
    throw new HttpError(502, "model provider failed");
  });
  if (!res.ok || !res.body) {
    console.error(`OpenRouter ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
    throw new HttpError(res.status === 429 ? 429 : 502, "model provider failed");
  }
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          if (!LEAKED_CALL.test(full)) onDelta(delta);
        }
      } catch {
        // keep-alive comments and partial lines
      }
    }
  }
  return full;
};

/** One model call, no tools: the context is retrieved up front, so the answer can start at once. */
export class LlmChat implements ChatModel {
  constructor(
    private readonly llm: LlmClient = new OpenRouterClient(),
    private readonly model = FAST_MODEL,
    private readonly streamer: Streamer | null = llm instanceof OpenRouterClient ? openRouterStream : null,
  ) {}

  async reply(input: ChatInput, onDelta?: OnDelta): Promise<ChatResponse> {
    const { user, org, message, history = [], context, knownIds, now = new Date() } = input;
    const handles = new Handles();
    const items = context.items.slice(0, MAX_ITEMS);
    const req: CompletionRequest = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: chatPrompt(user, org) },
        ...history.slice(-6).map(
          (t): ChatMessage =>
            t.role === "assistant" ? { role: "assistant", content: clamp(uncite(t.text), 600) } : { role: "user", content: clamp(t.text, 600) },
        ),
        {
          role: "user",
          content: [
            `Now: ${now.toISOString()}`,
            ...(org ? [`Organization: ${org.name}. ${org.description}`] : []),
            `Asking: ${user.name}, ${user.role}`,
            `Items:\n${JSON.stringify(items.map(compactNode))}`,
            `Sources:\n${JSON.stringify(context.sources.slice(0, MAX_SOURCES).map((s) => handles.brief(s)))}`,
            `Question: ${message}`,
          ].join("\n\n"),
        },
      ],
    };

    // Stream only the answer: the ACTIONS line is held back and parsed instead.
    let seen = "";
    let sent = 0;
    const guarded: OnDelta | undefined =
      onDelta &&
      ((delta) => {
        seen += delta;
        const end = visibleEnd(seen);
        if (end > sent) {
          onDelta(seen.slice(sent, end));
          sent = end;
        }
      });

    let text: string;
    if (guarded && this.streamer) text = await this.streamer(req, guarded);
    else {
      text = (await this.llm.complete(req)).choices[0].message.content ?? "";
      if (guarded && text) guarded(stripLeaked(text));
    }
    const { body, tail } = splitActions(stripLeaked(text));
    const cited = handles.cite(plain(body) || "I could not find that in what your team captured.");
    const { reply, sources } = capCitations(cited.reply, cited.sources);
    // A follow-up that repeats the question is no next step.
    const same = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "");
    const actions = parseActions(tail, { sources: handles.sources, items, knownIds }).filter((a) => a.kind !== "ask" || same(a.value) !== same(message));
    return { reply, viewCommand: viewFor(reply, items, sources, knownIds), dashboard: null, sources, actions };
  }
}

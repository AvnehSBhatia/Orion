// The built-in assistant's model call: one completion over context retrieved up front, no tools.
import { config } from "@/config";
import { viewCommand as viewCommandSchema } from "@/contract/schemas";
import type { ChatResponse, ChatTurn, Org, PublicNode, Source, User, ViewCommand } from "@/contract/types";
import { clamp, firstName, plain } from "@/lib/text";
import { OpenRouterClient, streamCompletion, type ChatMessage, type CompletionRequest, type LlmClient } from "@/llm/openrouter";
import { ACTION_TAIL, parseActions, splitActions, visibleEnd } from "./actions";
import { Handles, capCitations, uncite } from "./citations";
import { LEAKED_CALL, stripLeaked } from "./leaked";

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
type Streamer = (req: CompletionRequest, onDelta: OnDelta) => Promise<string>;

export const MAX_ITEMS = 8;
const MAX_SOURCES = 5;
// Room for two sentences plus the ACTIONS line; the answer text comes first, so first-token time is unchanged.
const MAX_TOKENS = 300;

/** The system prompt: the person's own chief of staff, framed by the role they wrote for themselves. */
function chatPrompt(user: Pick<User, "name" | "role">, org?: Pick<Org, "name"> | null): string {
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

/** A view command from untrusted input, limited to node ids that exist. Null when it does not parse. */
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

/** Lights the stars the answer talks about: items named in the reply, else nodes the cited sources changed. */
function viewFor(reply: string, items: PublicNode[], cited: Source[], knownIds: ReadonlySet<string>): ViewCommand | null {
  const lower = reply.toLowerCase();
  let ids = items.filter((n) => n.label.length > 2 && lower.includes(n.label.toLowerCase())).map((n) => n.id);
  if (!ids.length) ids = cited.flatMap((s) => s.changes.map((c) => c.nodeId));
  ids = [...new Set(ids)].filter((id) => knownIds.has(id)).slice(0, 6);
  if (!ids.length) return null;
  return { focusNodeIds: ids.slice(0, 3), highlightNodeIds: ids, visibleDomains: null, layout: "clusters", caption: "" };
}

export class LlmChat implements ChatModel {
  constructor(
    private readonly llm: LlmClient = new OpenRouterClient(),
    private readonly model = config.fastModel,
    private readonly streamer: Streamer | null = llm instanceof OpenRouterClient ? streamCompletion : null,
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
    if (guarded && this.streamer) {
      // Once leaked tool markup starts, nothing more streams.
      let full = "";
      text = await this.streamer(req, (delta) => {
        full += delta;
        if (!LEAKED_CALL.test(full)) guarded(delta);
      });
    } else {
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

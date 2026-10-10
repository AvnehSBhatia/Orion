import { z } from "zod";
import { config } from "@/config";
import { viewCommand as viewCommandSchema } from "@/contract/schemas";
import {
  DOMAINS,
  LAYOUTS,
  NODE_TYPES,
  STATUSES,
  type ChatResponse,
  type Org,
  type PublicNode,
  type Source,
  type User,
  type ViewCommand,
} from "@/contract/types";
import { clamp, plain } from "@/lib/text";
import { nodeFilter, type NodeFilter } from "@/steer/filters";
import { OpenRouterClient, nullable, tool, type ChatMessage, type LlmClient } from "./openrouter";

export type FindArgs = { q: string | null; filter: NodeFilter; limit: number };
export type SourceSearchArgs = { q: string | null; sinceHours: number | null; limit: number };
type Why = { why?: string };

export type ChatInput = {
  user: User;
  /** The org profile, so answers use the org's own names for things. */
  org?: Pick<Org, "name" | "description" | "context"> | null;
  message: string;
  context: { items: (PublicNode & Why)[]; sources: (Source & Why)[] };
  currentView: ViewCommand | null;
  /** Every node id in the graph, so the view can only point at real stars. */
  knownIds: ReadonlySet<string>;
  /** Structured lookup over the graph, ranked by this person's gravity. */
  find: (args: FindArgs) => Promise<(PublicNode & Why)[]>;
  /** Vector search over captured documents, ranked by this person's gravity. */
  findSources: (args: SourceSearchArgs) => Promise<(Source & Why)[]>;
  /** Full text of one document, or null if unknown. */
  readSource: (id: string) => { source: Source; text: string; ocrText?: string } | null;
  now?: Date;
};

export interface ChatModel {
  reply(input: ChatInput): Promise<ChatResponse>;
}

const MAX_TURNS = 5;
const READ_CHARS = 4_000;

const SET_VIEW_TOOL = tool("set_view", "Reshape the map the user is looking at.", {
  type: "object",
  additionalProperties: false,
  required: ["focusNodeIds", "highlightNodeIds", "visibleDomains", "layout", "caption"],
  properties: {
    focusNodeIds: { type: "array", items: { type: "string" }, description: "Node ids to zoom to." },
    highlightNodeIds: { type: "array", items: { type: "string" }, description: "Node ids to ring and keep at full opacity." },
    visibleDomains: {
      ...nullable({ type: "array", items: { type: "string", enum: [...DOMAINS] } }),
      description: "Domains to show, or null for all.",
    },
    layout: { type: "string", enum: [...LAYOUTS], description: "timeline for questions about time, list for short answers." },
    caption: { type: "string", description: "One plain sentence shown on the map." },
  },
});

const FIND_NODES_TOOL = tool(
  "find_nodes",
  "Filter the work map by status, sellable, domain, type, or recency, ranked for this person. Status includes risk passed down from blocked work.",
  {
    type: "object",
    additionalProperties: false,
    required: ["query", "statuses", "sellable", "domains", "types", "updatedWithinHours", "limit"],
    properties: {
      query: { ...nullable({ type: "string" }), description: "Topic to rank by, or null to rank by what matters to this person." },
      statuses: nullable({ type: "array", items: { type: "string", enum: [...STATUSES] } }),
      sellable: { ...nullable({ type: "boolean" }), description: "true for what sales may tell customers." },
      domains: nullable({ type: "array", items: { type: "string", enum: [...DOMAINS] } }),
      types: nullable({ type: "array", items: { type: "string", enum: [...NODE_TYPES] } }),
      updatedWithinHours: { ...nullable({ type: "number" }), description: "24 for today, 168 for this week." },
      limit: { ...nullable({ type: "integer" }), description: "Default 10, at most 25." },
    },
  },
);

const SEARCH_SOURCES_TOOL = tool(
  "search_sources",
  "Search the documents people captured or committed (pages, screenshots, code changes), ranked for this person.",
  {
    type: "object",
    additionalProperties: false,
    required: ["query", "sinceHours", "limit"],
    properties: {
      query: { ...nullable({ type: "string" }), description: "What to look for, or null for what matters to this person." },
      sinceHours: { ...nullable({ type: "number" }), description: "Only documents from the last N hours, or null for any time." },
      limit: { ...nullable({ type: "integer" }), description: "Default 5, at most 10." },
    },
  },
);

const READ_SOURCE_TOOL = tool("read_source", "Read the full text of one document by its handle, like S2.", {
  type: "object",
  additionalProperties: false,
  required: ["handle"],
  properties: { handle: { type: "string" } },
});

const findArgs = nodeFilter.extend({ query: z.string().nullable(), limit: z.number().int().nullable() });
const sourceArgs = z.object({ query: z.string().nullable(), sinceHours: z.number().positive().nullable(), limit: z.number().int().nullable() });
const readArgs = z.object({ handle: z.string() });

const CHAT_PROMPT = `You are the work assistant for one person in an organization. You answer from what their teammates captured and committed. Answer in two to five plain sentences.
The context holds the top items for this person (why starts with "for you"), the best matches for the question, the latest changes that matter to them, and source documents labeled S1, S2, and so on.
For open questions like what to work on, lead with the "for you" items. Each item has updatedAt and a why. When two things disagree, trust the newer one, and say how recent it is when timing matters.
When the question is about status (blocked, at risk, done), what sales can promise (sellable), one domain or type, or what changed recently, call find_nodes with those filters. When you need the original document or a detail not in the excerpt, call search_sources or read_source.
Cite the documents you used with their handle in brackets, like [S2], right after the claim. Only use what the context and tools return. If they do not answer the question, say so plainly.
If the user wants to see something, call set_view with node ids from those results.
Never use em dashes. No exclamation marks. Sentence case. Short words.
Sellable false means sales must not mention it to customers yet.`;

function compactNode(n: PublicNode & Why) {
  const { readLinks: _links, sourceRef: _ref, ...rest } = n;
  return rest;
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
class Handles {
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
    const { changes, ...rest } = s;
    return {
      handle: this.add(s),
      ...rest,
      changes: changes.map((c) => `${c.label}: ${c.change}${c.statusFrom && c.statusFrom !== c.statusTo ? `, ${c.statusFrom} to ${c.statusTo}` : ""}`),
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
    return { reply: text, sources: order.map((h) => this.sources.get(h)!) };
  }
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class LlmChat implements ChatModel {
  constructor(
    private readonly llm: LlmClient = new OpenRouterClient(),
    private readonly model = config.chatModel,
  ) {}

  async reply(input: ChatInput): Promise<ChatResponse> {
    const { user, org, message, context, currentView, knownIds, now = new Date() } = input;
    const handles = new Handles();
    const messages: ChatMessage[] = [
      { role: "system", content: CHAT_PROMPT },
      {
        role: "user",
        content: [
          `Now: ${now.toISOString()}`,
          ...(org ? [`Organization: ${org.name}. What it does: ${org.description}${org.context ? ` ${org.context}` : ""}`] : []),
          `Asking: ${user.name}. Their role, in their words: ${user.role}${user.teamDescription ? ` ${user.teamDescription}` : ""}`,
          `Items:\n${JSON.stringify(context.items.map(compactNode))}`,
          `Sources:\n${JSON.stringify(context.sources.map((s) => handles.brief(s)))}`,
          `Current view: ${JSON.stringify(currentView)}`,
          `User: ${message}`,
        ].join("\n\n"),
      },
    ];
    const tools = [FIND_NODES_TOOL, SEARCH_SOURCES_TOOL, READ_SOURCE_TOOL, SET_VIEW_TOOL];

    let view: ViewCommand | null = null;
    let reply = "";
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const last = turn === MAX_TURNS - 1;
      const res = await this.llm.complete({
        model: this.model,
        max_tokens: 1500,
        temperature: 0.2,
        messages,
        tools,
        tool_choice: last ? "none" : "auto",
      });
      const msg = res.choices[0].message;
      reply = msg.content?.trim() || reply;
      const calls = msg.tool_calls ?? [];
      if (!calls.length) break;

      messages.push(msg);
      for (const call of calls) {
        const args = parseArgs(call.function.arguments);
        let content: string;
        switch (call.function.name) {
          case "set_view":
            view = sanitizeView(args, knownIds) ?? view;
            content = "View applied.";
            break;
          case "find_nodes": {
            const p = findArgs.safeParse(args);
            if (!p.success) {
              content = JSON.stringify({ error: "invalid filters" });
              break;
            }
            const { query, limit, ...filter } = p.data;
            const nodes = await input.find({ q: query, filter, limit: Math.min(Math.max(limit ?? 10, 1), 25) });
            content = JSON.stringify({ nodes: nodes.map(compactNode) });
            break;
          }
          case "search_sources": {
            const p = sourceArgs.safeParse(args);
            if (!p.success) {
              content = JSON.stringify({ error: "invalid arguments" });
              break;
            }
            const found = await input.findSources({
              q: p.data.query,
              sinceHours: p.data.sinceHours,
              limit: Math.min(Math.max(p.data.limit ?? 5, 1), 10),
            });
            content = JSON.stringify({ sources: found.map((s) => handles.brief(s)) });
            break;
          }
          case "read_source": {
            const p = readArgs.safeParse(args);
            const s = p.success ? handles.sources.get(p.data.handle.trim()) : undefined;
            const doc = s ? input.readSource(s.id) : null;
            content = doc
              ? JSON.stringify({
                  handle: p.data!.handle,
                  title: doc.source.title,
                  ref: doc.source.ref,
                  text: doc.text.slice(0, READ_CHARS),
                  ...(doc.ocrText ? { screenshotText: doc.ocrText.slice(0, READ_CHARS / 2) } : {}),
                  ...(doc.source.members ? { mergedFrom: doc.source.members.map((m) => `${m.title} (${m.ref})`) } : {}),
                })
              : JSON.stringify({ error: "unknown handle" });
            break;
          }
          default:
            content = JSON.stringify({ error: "unknown tool" });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }

    const cited = handles.cite(plain(reply) || "Here is what I found.");
    return { reply: cited.reply, viewCommand: view, sources: cited.sources };
  }
}

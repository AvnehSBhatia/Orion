import { z } from "zod";
import { config } from "@/config";
import { DOMAINS, NODE_TYPES, RELATIONS, STATUSES, type FeatureCard, type NodeType, type Org } from "@/contract/types";
import type { ExtractedNode, GraphUpdate, StoredNode } from "@/db/store";
import { HttpError } from "@/server/http";
import { completeJson, nullable, OpenRouterClient, type LlmClient } from "./openrouter";

/** The page as visible text; the screenshot goes to the embedder, not the extractor. */
export type CaptureInput = { url: string; title: string; text: string };
export type CodeInput = { repo: string; commitSha: string; files: { path: string; diff: string }[]; cards?: FeatureCard[] };
export type KnownNode = Pick<StoredNode, "id" | "label" | "type" | "domain">;
/** Who the org is and who sent the document, so the model can tell this org's work from everything else. */
export type ExtractContext = { org: Org | null; author: { name: string; role: string } | null };

export interface Extractor {
  fromCapture(input: CaptureInput, known: KnownNode[], about?: ExtractContext): Promise<GraphUpdate>;
  fromCode(input: CodeInput, known: KnownNode[], about?: ExtractContext): Promise<GraphUpdate>;
}

const hostIn = (url: string, sites: string[]) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return sites.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
};

/** The org profile and author, as the first lines of the model's input. Empty when nothing is known. */
export function aboutLines(about: ExtractContext | undefined, url?: string): string {
  const lines: string[] = [];
  const org = about?.org;
  if (org) {
    lines.push(`Organization: ${org.name}. What it does: ${org.description}`);
    if (org.websites.length) lines.push(`Websites it works on: ${org.websites.join(", ")}`);
    if (org.context) lines.push(`More about it: ${org.context}`);
    if (url && org.websites.length) {
      lines.push(hostIn(url, org.websites) ? "This page is on one of those websites." : "This page is not on one of those websites.");
    }
  }
  if (about?.author) lines.push(`Sent by: ${about.author.name}. Their role, in their words: ${about.author.role}`);
  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

const MAX_CAPTURE_NODES = 8;
const MAX_CODE_NODES = 8;
const MAX_KNOWN_IN_PROMPT = 200;


const nodeProps = {
  label: { type: "string", description: "Short name, at most 40 characters. Reuse a known label exactly when it is the same thing." },
  type: { type: "string", enum: [...NODE_TYPES] },
  domain: { type: "string", enum: [...DOMAINS] },
  summary: { type: "string", description: "At most 140 characters, plain language a teammate in any role understands." },
  todo: { ...nullable({ type: "string" }), description: "What a teammate needs to do about this, or null." },
  readLinks: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["title", "url"],
      properties: { title: { type: "string" }, url: { type: "string" } },
    },
  },
  owner: { ...nullable({ type: "string" }), description: "Full name of the responsible person if shown, else null." },
  status: { type: "string", enum: [...STATUSES] },
};

const edgesSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["source", "target", "relation"],
    properties: {
      source: { type: "string", description: "Upstream node label (from this update or the known list)." },
      target: { type: "string", description: "Downstream node label (from this update or the known list)." },
      relation: { type: "string", enum: [...RELATIONS] },
    },
  },
};

const BUILD_UPDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nodes", "edges"],
  properties: {
    nodes: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: Object.keys(nodeProps), properties: nodeProps },
    },
    edges: edgesSchema,
  },
};

const CODE_TYPES: NodeType[] = ["feature", "task", "milestone", "decision", "risk"];
const codeNodeProps = {
  ...nodeProps,
  type: { type: "string", enum: CODE_TYPES },
  release: { type: "string", enum: ["shipped", "in_beta", "in_progress"] },
  sellable: { type: "boolean", description: "True only if shipped or in beta and safe for sales to mention." },
};
const { domain: _domain, ...codeNodePropsNoDomain } = codeNodeProps;

const FEATURE_CARDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nodes", "edges"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(codeNodePropsNoDomain),
        properties: codeNodePropsNoDomain,
      },
    },
    edges: edgesSchema,
  },
};

const EXTRACT_PROMPT = `You read the visible text of a page someone in an organization had open. Output the few things a teammate would need to know changed: projects, campaigns, budgets, deals, owners, dates, statuses, decisions.
Use the organization profile, when given, to judge what is this organization's work and to name things the way it does. A page on one of its websites is usually work. Personal pages (personal email, shopping, social media, news, school) and anything unrelated to the organization return empty lists.
Never invent values. Skip navigation, menus, and ads. At most ${MAX_CAPTURE_NODES} nodes.
When something on the page is already in the known nodes list, reuse that label exactly so it updates instead of duplicating. Add edges only when the page shows the relationship.
Write in plain sentences. Never use em dashes or exclamation marks.
Answer with JSON matching the schema. If nothing useful is on the page, return empty lists.`;

const CODE_PROMPT = `You read a code change and write feature cards that anyone on the team, including sales, can understand and repeat.
For each meaningful change: a label, a plain-language summary of what a customer or teammate gets (not how the code works), status, release, and sellable.
release is shipped, in_beta, or in_progress. sellable is true only when release is shipped or in_beta. Skip refactors, tests, and tooling unless they change what users get. At most ${MAX_CODE_NODES} cards.
Reuse a known label exactly when the change extends an existing feature. Add edges for what blocks or feeds what.
When the author wrote feature cards for the change, keep their labels, summaries, and release status unless the diff contradicts them, and add anything they missed.
Write in plain sentences. Never use em dashes or exclamation marks.
Answer with JSON matching the schema. If nothing user facing changed, return empty lists.`;

/** The author's cards as text for the model and for the stored source. */
export function cardLines(cards: FeatureCard[] | undefined): string {
  if (!cards?.length) return "";
  return cards.map((c) => `- ${c.label} [${c.status}]: ${c.summary}${c.paths.length ? ` (${c.paths.join(", ")})` : ""}`).join("\n");
}

/** The author's cards as graph nodes, for when the model is unavailable. */
export function cardsToUpdate(cards: FeatureCard[]): GraphUpdate {
  return {
    nodes: cards.map((c) => ({
      label: c.label,
      type: "feature",
      domain: "engineering",
      summary: c.summary,
      todo: null,
      readLinks: [],
      owner: null,
      status: c.status === "shipped" ? "done" : "on_track",
      sellable: c.status !== "in_progress",
    })),
    edges: [],
  };
}

const linkOut = z.object({ title: z.string(), url: z.string() });
const nodeOut = z.object({
  label: z.string(),
  type: z.enum(NODE_TYPES),
  domain: z.enum(DOMAINS),
  summary: z.string(),
  todo: z.string().nullable(),
  readLinks: z.array(linkOut),
  owner: z.string().nullable(),
  status: z.enum(STATUSES),
});
const edgeOut = z.object({ source: z.string(), target: z.string(), relation: z.enum(RELATIONS) });
const captureOut = z.object({ nodes: z.array(nodeOut), edges: z.array(edgeOut) });
const codeOut = z.object({
  nodes: z.array(
    nodeOut.omit({ domain: true }).extend({
      release: z.enum(["shipped", "in_beta", "in_progress"]),
      sellable: z.boolean(),
    }),
  ),
  edges: z.array(edgeOut),
});

function parseModelOutput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const res = schema.safeParse(raw);
  if (res.success) return res.data;
  console.error("Model output did not match the contract", res.error.issues.slice(0, 3));
  throw new HttpError(422, "model output did not match the contract");
}

function knownList(known: KnownNode[]): string {
  if (!known.length) return "Known nodes: none yet.";
  const lines = known.slice(0, MAX_KNOWN_IN_PROMPT).map((n) => `- [${n.type}, ${n.domain}] ${n.label}`);
  return `Known nodes:\n${lines.join("\n")}`;
}

/** Graph extraction through an OpenAI-compatible model (DeepSeek on OpenRouter by default). */
export class LlmExtractor implements Extractor {
  constructor(
    private readonly llm: LlmClient = new OpenRouterClient(),
    private readonly model = config.extractModel,
  ) {}

  async fromCapture(input: CaptureInput, known: KnownNode[], about?: ExtractContext): Promise<GraphUpdate> {
    const raw = await completeJson(this.llm, {
      model: this.model,
      name: "build_update",
      schema: BUILD_UPDATE_SCHEMA,
      system: EXTRACT_PROMPT,
      user: `${aboutLines(about, input.url)}${knownList(known)}\n\nURL: ${input.url}\nTitle: ${input.title}\nPage text:\n${input.text}`,
    });
    const out = parseModelOutput(captureOut, raw);
    const nodes: ExtractedNode[] = out.nodes.slice(0, MAX_CAPTURE_NODES).map((n) => ({ ...n, sellable: null }));
    return { nodes, edges: out.edges };
  }

  async fromCode(input: CodeInput, known: KnownNode[], about?: ExtractContext): Promise<GraphUpdate> {
    const files = input.files.map((f) => `--- ${f.path}\n${f.diff}`).join("\n\n");
    const raw = await completeJson(this.llm, {
      model: this.model,
      name: "feature_cards",
      schema: FEATURE_CARDS_SCHEMA,
      system: CODE_PROMPT,
      user:
        `${aboutLines(about)}${knownList(known)}\n\nRepo: ${input.repo}\nCommit: ${input.commitSha}` +
        (input.cards?.length ? `\nFeature cards from the author:\n${cardLines(input.cards)}` : "") +
        `\nChanged files:\n\n${files || "(only cards were sent)"}`,
    });
    const out = parseModelOutput(codeOut, raw);
    const nodes: ExtractedNode[] = out.nodes.slice(0, MAX_CODE_NODES).map(({ release, sellable, ...n }) => ({
      ...n,
      domain: "engineering",
      status: n.status === "unknown" && release === "shipped" ? "done" : n.status,
      sellable: sellable && release !== "in_progress",
    }));
    return { nodes, edges: out.edges };
  }
}

import { createHash } from "node:crypto";
import { config } from "@/config";
import { HttpError } from "@/http/error";
import { normalize } from "@/lib/vector";
import { GemmaEmbedder } from "./gemma";

/**
 * Queries and documents embed differently (EmbeddingGemma uses asymmetric task prefixes).
 * A document may carry one image (base64 jpeg/png/webp, no data: prefix), embedded together with its text.
 * `context` is a person's role: the asker's for a query, the author's for a document. It biases the vector
 * toward where in the org the text comes from or is needed.
 */
export type EmbedInput =
  | { kind: "query"; text: string; context?: string | null }
  | { kind: "document"; title: string | null; text: string; image?: string | null; context?: string | null };

export interface Embedder {
  /** Stored alongside every vector so a model or dimension change triggers a re-embed. */
  readonly model: string;
  embed(inputs: EmbedInput[]): Promise<Float32Array[]>;
}

export const query = (text: string, context: string | null = null): EmbedInput => ({ kind: "query", text, context });
export const doc = (
  title: string | null,
  text: string,
  image: string | null = null,
  context: string | null = null,
): EmbedInput => ({ kind: "document", title, text, image, context });

/** The text with its role context, in the form both providers embed. */
export function withContext(input: EmbedInput): string {
  if (!input.context) return input.text;
  return input.kind === "query" ? `asked by: ${input.context} | ${input.text}` : `author role: ${input.context}\n${input.text}`;
}

function plainText(input: EmbedInput): string {
  const text = withContext(input);
  return input.kind === "document" && input.title ? `${input.title}. ${text}` : text;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
const BATCH = 64;

export class OpenRouterEmbedder implements Embedder {
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
    private readonly dimensions: number,
  ) {
    this.model = `${modelId}@${dimensions}`;
  }

  async embed(inputs: EmbedInput[]): Promise<Float32Array[]> {
    const texts = inputs.map(plainText);
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await this.embedBatch(texts.slice(i, i + BATCH))));
    }
    return out;
  }

  private async embedBatch(input: string[]): Promise<Float32Array[]> {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.modelId, input, dimensions: this.dimensions }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`OpenRouter embeddings ${res.status}: ${body.slice(0, 500)}`);
      throw new HttpError(502, "embedding provider failed");
    }
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return [...json.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => normalize(Float32Array.from(d.embedding.slice(0, this.dimensions))));
  }
}

/**
 * Deterministic feature-hashing embedder: word unigrams and bigrams into signed buckets.
 * Only for offline dev and tests, where it gives lexical overlap rather than meaning.
 */
export class LocalHashEmbedder implements Embedder {
  readonly model: string;

  constructor(private readonly dimensions = 768) {
    this.model = `local-hash@${dimensions}`;
  }

  async embed(inputs: EmbedInput[]): Promise<Float32Array[]> {
    return inputs.map((i) => this.embedOne(plainText(i)));
  }

  private embedOne(text: string): Float32Array {
    const v = new Float32Array(this.dimensions);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const terms = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
    for (const term of terms) {
      const h = createHash("sha1").update(term).digest();
      const bucket = h.readUInt32LE(0) % this.dimensions;
      v[bucket] += h[4] & 1 ? 1 : -1;
    }
    return normalize(v);
  }
}

export function createEmbedder(): Embedder {
  switch (config.embedProvider) {
    case "gemma":
      return new GemmaEmbedder();
    case "openrouter": {
      const key = config.openRouterKey;
      if (!key) throw new Error("EMBED_PROVIDER=openrouter needs OPENROUTER_API_KEY");
      return new OpenRouterEmbedder(key, config.embedModel, config.embedDimensions);
    }
    case "local":
      console.warn("Using the local hashing embedder. Lexical only, for offline dev and tests.");
      return new LocalHashEmbedder(config.embedDimensions);
  }
}

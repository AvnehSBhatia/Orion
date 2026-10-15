import { createHash } from "node:crypto";
import { config } from "@/config";
import { HttpError } from "@/http/error";
import { logJson } from "@/jobs/log";
import { normalize } from "@/lib/vector";
import { afterModelCall, readUsage } from "@/usage";
import { fetchWithRetry, providerPrefs } from "./http";
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
  /** For /api/health: a local model is "loading" until its weights are in memory. Absent means always ready. */
  status?(): EmbedderStatus;
}

export type EmbedderStatus = "ready" | "loading" | "error";

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
/** Inputs per embeddings request. */
export const EMBED_BATCH = 64;
/** Request body bytes per embeddings request; OpenRouter rejects above 8MB, so stay well under. */
export const EMBED_BATCH_BYTES = 6 * 1024 * 1024;

/**
 * Splits texts into consecutive batches of at most `maxCount` items and `maxBytes` of JSON-encoded input each.
 * A single text over `maxBytes` is cut to fit (it would be rejected whole).
 */
export function chunkByBytes(texts: string[], maxCount = EMBED_BATCH, maxBytes = EMBED_BATCH_BYTES): string[][] {
  const out: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  const overhead = 1024; // model id, dimensions, provider settings, brackets
  for (let text of texts) {
    let size = Buffer.byteLength(JSON.stringify(text)) + 1;
    if (size + overhead > maxBytes) {
      // Cut by characters until the encoded form fits; JSON escaping can grow a string, so measure again.
      let keep = Math.floor(text.length * ((maxBytes - overhead) / size));
      do {
        text = text.slice(0, keep);
        size = Buffer.byteLength(JSON.stringify(text)) + 1;
        keep = Math.floor(keep * 0.9);
      } while (size + overhead > maxBytes && keep > 0);
    }
    if (batch.length && (batch.length >= maxCount || bytes + size + overhead > maxBytes)) {
      out.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(text);
    bytes += size;
  }
  if (batch.length) out.push(batch);
  return out;
}

export class OpenRouterEmbedder implements Embedder {
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
    private readonly dimensions: number,
  ) {
    this.model = `${modelId}@${dimensions}`;
  }

  status(): EmbedderStatus {
    return "ready";
  }

  async embed(inputs: EmbedInput[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const batch of chunkByBytes(inputs.map(plainText))) out.push(...(await this.embedBatch(batch)));
    return out;
  }

  private async embedBatch(input: string[]): Promise<Float32Array[]> {
    const { res } = await fetchWithRetry(
      OPENROUTER_URL,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.modelId, input, dimensions: this.dimensions, provider: providerPrefs() }),
      },
      { purpose: "embed", label: "embeddings" },
    );
    if (!res.ok) {
      logJson("error", "openrouter embeddings failed", { status: res.status, detail: (await res.text().catch(() => "")).slice(0, 300) });
      throw new HttpError(502, "embedding provider failed");
    }
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[]; usage?: unknown };
    if (!json.data || json.data.length !== input.length) {
      logJson("error", "openrouter embeddings returned the wrong count", { sent: input.length, got: json.data?.length ?? 0 });
      throw new HttpError(502, "embedding provider failed");
    }
    // Recorded (embeddings are cheap and every feature needs them) but never blocked by the budget.
    const usage = readUsage(json.usage);
    if (usage) afterModelCall({ model: this.modelId, kind: "embed", ...usage });
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

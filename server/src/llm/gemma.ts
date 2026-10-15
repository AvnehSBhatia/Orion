import path from "node:path";
import { config } from "@/config";
import { withContext, type EmbedInput, type Embedder, type EmbedderStatus } from "./embed";

function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

type Encoded = Record<string, unknown>;
type Embedding = { data: Float32Array; dims: number[] };

type Loaded = {
  processor: (texts: string[], images: unknown[][]) => Promise<Encoded>;
  tokenizer: {
    (texts: string[], opts: Record<string, unknown>): Encoded;
    encode(text: string, opts: { add_special_tokens: boolean }): number[];
    decode(ids: number[], opts: { skip_special_tokens: boolean }): string;
  };
  model: (inputs: Encoded) => Promise<{ sentence_embedding: Embedding }>;
  decodeImage: (base64: string) => Promise<unknown>;
};

const BATCH = 16;
const MAX_LENGTH = 2048;
const MAX_SOFT_TOKENS = 280;
// An image expands to <|image> + MAX_SOFT_TOKENS soft tokens + <image|>; keep the whole sequence within MAX_LENGTH.
const IMAGE_TEXT_BUDGET = MAX_LENGTH - MAX_SOFT_TOKENS - 8;

function rows({ data, dims: [n, dim] }: Embedding): Float32Array[] {
  return Array.from({ length: n }, (_, r) => normalize(Float32Array.from(data.subarray(r * dim, (r + 1) * dim))));
}

// Literal media placeholders in user text would be counted as soft-token slots and fail the forward pass.
const escapeMedia = (s: string) => s.replace(/<\|(image|audio|video)\|>/g, "<$1>");

/** Model card prefixes. Queries and documents are asymmetric for retrieval. */
export function gemmaText(input: EmbedInput): string {
  const text = escapeMedia(withContext(input));
  if (input.kind === "query") return `task: search result | query: ${text}`;
  const title = escapeMedia(input.title ?? "").replace(/\|/g, "/").trim() || "none";
  return `title: ${title} | text: ${text}`;
}

/**
 * EmbeddingGemma 2 in process through Transformers.js and onnxruntime-node, text and vision encoders (audio not loaded).
 * A document's image is placed after its prefixed text, so both land in one mean-pooled, L2-normalized 768d vector.
 */
export class GemmaEmbedder implements Embedder {
  readonly model: string;
  private loading: Promise<Loaded> | null = null;
  private state: EmbedderStatus | "idle" = "idle";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly modelId = config.gemmaModel,
    private readonly dtype = config.gemmaDtype,
  ) {
    this.model = `${modelId}:${dtype}+vision@768`;
  }

  /** "loading" also before the first load starts: the model is not usable yet either way. */
  status(): EmbedderStatus {
    return this.state === "idle" ? "loading" : this.state;
  }

  warm(): Promise<Loaded> {
    if (this.loading) return this.loading;
    this.state = "loading";
    return (this.loading = this.load().then(
      (loaded) => {
        this.state = "ready";
        return loaded;
      },
      (err) => {
        this.loading = null;
        this.state = "error";
        throw err;
      },
    ));
  }

  private async load(): Promise<Loaded> {
    const tf = await import("@huggingface/transformers");
    tf.env.cacheDir = path.resolve(config.modelCacheDir);
    const cfg = await tf.AutoConfig.from_pretrained(this.modelId);
    (cfg as unknown as { audio_config: unknown }).audio_config = null;
    const dtype = this.dtype as "q8";
    const [processor, model] = await Promise.all([
      tf.AutoProcessor.from_pretrained(this.modelId),
      tf.AutoModel.from_pretrained(this.modelId, {
        config: cfg,
        device: "cpu",
        dtype: { model: dtype, vision_encoder: dtype },
      }),
    ]);
    (processor.image_processor as unknown as { max_soft_tokens: number }).max_soft_tokens = MAX_SOFT_TOKENS;
    return {
      processor: processor as unknown as Loaded["processor"],
      tokenizer: processor.tokenizer as unknown as Loaded["tokenizer"],
      model: model as unknown as Loaded["model"],
      decodeImage: (base64) => tf.RawImage.fromBlob(new Blob([Buffer.from(base64, "base64")])),
    };
  }

  async embed(inputs: EmbedInput[]): Promise<Float32Array[]> {
    if (!inputs.length) return [];
    const loaded = await this.warm();
    // onnxruntime sessions are not re-entrant; serialize calls from concurrent requests.
    const run = this.queue.then(async () => {
      const out = new Array<Float32Array>(inputs.length);
      const textOnly: number[] = [];
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const v = input.kind === "document" && input.image ? await this.embedWithImage(loaded, input, input.image) : null;
        if (v) out[i] = v;
        else textOnly.push(i);
      }
      for (let b = 0; b < textOnly.length; b += BATCH) {
        const idx = textOnly.slice(b, b + BATCH);
        const texts = idx.map((i) => gemmaText(inputs[i]));
        const encoded = loaded.tokenizer(texts, { padding: true, truncation: true, max_length: MAX_LENGTH });
        const vectors = rows((await loaded.model(encoded)).sentence_embedding);
        idx.forEach((i, r) => (out[i] = vectors[r]));
      }
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** One document at a time: batching images gave no real speedup and roughly 400 MB more peak memory per image. */
  private async embedWithImage(
    { processor, tokenizer, model, decodeImage }: Loaded,
    input: EmbedInput & { kind: "document" },
    image: string,
  ): Promise<Float32Array | null> {
    try {
      const raw = await decodeImage(image.replace(/^data:[^,]*,/, ""));
      let text = gemmaText(input);
      const ids = tokenizer.encode(text, { add_special_tokens: false });
      if (ids.length > IMAGE_TEXT_BUDGET) {
        text = tokenizer.decode(ids.slice(0, IMAGE_TEXT_BUDGET), { skip_special_tokens: true });
      }
      const { sentence_embedding } = await model(await processor([`${text} <|image|>`], [[raw]]));
      return rows(sentence_embedding)[0];
    } catch (err) {
      const label = input.title ?? input.text.slice(0, 40);
      console.warn(`Gemma image embed failed for "${label}", using text only: ${(err as Error).message}`);
      return null;
    }
  }
}

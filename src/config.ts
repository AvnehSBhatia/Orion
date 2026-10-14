export const config = {
  /** Built-in assistant. Needs tools and structured outputs on OpenRouter. */
  get chatModel(): string {
    return process.env.OPENROUTER_CHAT_MODEL || "deepseek/deepseek-v4-flash";
  },
  /** Turns captured pages and commits into graph nodes. */
  get extractModel(): string {
    return process.env.OPENROUTER_EXTRACT_MODEL || "deepseek/deepseek-v4-flash";
  },
  get openRouterKey(): string | undefined {
    return process.env.OPENROUTER_API_KEY || undefined;
  },
  get embedModel(): string {
    return process.env.OPENROUTER_EMBED_MODEL || "google/gemini-embedding-2";
  },
  get embedDimensions(): number {
    return Number(process.env.EMBED_DIMENSIONS) || 768;
  },
  get embedProvider(): "gemma" | "openrouter" | "local" {
    const p = process.env.EMBED_PROVIDER;
    if (p === "local" || p === "openrouter" || p === "gemma") return p;
    return "gemma";
  },
  get gemmaModel(): string {
    return process.env.GEMMA_MODEL || "onnx-community/embeddinggemma-2-ONNX";
  },
  /** q8 on CPU by default. Never fp16: EmbeddingGemma 2 overflows it and returns silent garbage. */
  get gemmaDtype(): "q8" | "q4" | "fp32" {
    const d = process.env.GEMMA_DTYPE;
    return d === "q4" || d === "fp32" ? d : "q8";
  },
  get modelCacheDir(): string {
    return process.env.MODEL_CACHE_DIR || ".cache/models";
  },
  /** One SQLite file per org: `${dataDir}/orgs/${orgId}.db`. */
  get dataDir(): string {
    return process.env.DATA_DIR || "data";
  },
  /** light (default): keep a shrunk screenshot, skip OCR and pruning, which ate the server's CPU. full: OCR and prune every capture. */
  get ingestImages(): "light" | "full" {
    return process.env.INGEST_IMAGES === "full" ? "full" : "light";
  },
  get uiOrigins(): string[] {
    return (process.env.UI_ORIGIN || "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
};

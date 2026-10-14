/** Every environment setting the server reads, with its default. Getters, so tests can change env between cases. */
export const config = {
  /** Composes each person's default dashboard from their role. Needs structured outputs on OpenRouter. */
  get chatModel(): string {
    return process.env.OPENROUTER_CHAT_MODEL || "deepseek/deepseek-v4-flash";
  },
  /**
   * Interactive answers, the brief, and dashboard edits. Measured on OpenRouter (8 items, 200 tokens):
   * gemini-2.5-flash-lite starts in about 0.5s, deepseek-v4-flash in about 1.6 to 2.1s.
   */
  get fastModel(): string {
    return process.env.OPENROUTER_FAST_MODEL || "google/gemini-2.5-flash-lite";
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
  /**
   * When a source's screenshot goes into its embedding. An image embed costs about 14x a text embed (about 1.9s
   * of CPU and 2GB of peak memory with Gemma). auto (default): only when the capture has little text, like a
   * desktop window or a screen; tabs embed their page text and keep the screenshot for viewing. always: every
   * kept screenshot. never: text only.
   */
  get embedScreenshots(): "auto" | "always" | "never" {
    const v = process.env.EMBED_SCREENSHOTS;
    return v === "always" || v === "never" ? v : "auto";
  },
  /** In auto, a capture with less visible text than this embeds its screenshot. */
  get screenshotTextMin(): number {
    return Number(process.env.SCREENSHOT_TEXT_MIN) || 400;
  },
  get uiOrigins(): string[] {
    return (process.env.UI_ORIGIN || "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  /** Dev only: skip sign-in on every route (the local demo flow). Never set this on a public box. */
  get authDisabled(): boolean {
    return process.env.AUTH_DISABLED === "true";
  },
  /** POST /api/auth/signup creates a new org and its admin. Off by default. */
  get allowSignup(): boolean {
    return process.env.ALLOW_SIGNUP === "true";
  },
  /** Mark the session cookie Secure (set this behind HTTPS). */
  get cookieSecure(): boolean {
    return process.env.COOKIE_SECURE === "true";
  },
  /** Read the client IP from X-Forwarded-For (only behind a proxy that sets it). */
  get trustProxy(): boolean {
    return process.env.TRUST_PROXY === "true";
  },
  /** Chrome extension ids allowed by CORS. Empty: any extension. */
  get extensionIds(): string[] {
    return (process.env.EXTENSION_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
};

/** Every environment setting the server reads, with its default. Getters, so tests can change env between cases. */
export const config = {
  /** Composes each person's default dashboard from their role. Needs structured outputs on OpenRouter. */
  get chatModel(): string {
    return process.env.OPENROUTER_CHAT_MODEL || "deepseek/deepseek-v4.1-flash";
  },
  /**
   * Interactive answers, the brief, and dashboard edits. deepseek-v4.1-flash starts in about 0.9s (gemini-2.5-flash-lite
   * 0.5s) but costs less on our prompts: they are mostly input, at $0.018 per million tokens against $0.10.
   */
  get fastModel(): string {
    return process.env.OPENROUTER_FAST_MODEL || "deepseek/deepseek-v4.1-flash";
  },
  /** The Jev router in chat: off sends every message to the chat model. */
  get routerOn(): boolean {
    return process.env.ROUTER !== "off" && !!this.openRouterKey;
  },
  /** Decides whether a message goes to Jev or the chat model. A yes/no decision model. */
  get routerModel(): string {
    return process.env.ROUTER_MODEL || "nace-ai/drex-v2.0";
  },
  /** Handles what the router sends it: picks the task and the work items, from up to 255 item cards at once. */
  get jevModel(): string {
    return process.env.JEV_MODEL || "~typesafe/jev-latest";
  },
  /** Least router probability that sends a message to Jev. Drex rates lookups 0.35 to 0.8 and writing under 0.01. */
  get routerJevMin(): number {
    const n = Number(process.env.ROUTER_JEV_MIN);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.25;
  },
  /** Drex checks each capture for work before extraction; off extracts everything. */
  get workGateOn(): boolean {
    return process.env.WORK_GATE !== "off" && !!this.openRouterKey;
  },
  /** Least Drex probability of work that lets a capture through to extraction. Low: a missed capture is lost work. */
  get workGateMin(): number {
    const n = Number(process.env.WORK_GATE_MIN);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.1;
  },
  get routerTimeoutMs(): number {
    return Number(process.env.ROUTER_TIMEOUT_MS) || 3_000;
  },
  /**
   * Turns captures and commits into graph nodes; also labels areas and writes digests in the background. Claude
   * Haiku 5.5, about $0.00066 a capture. On 59 captures the cheaper models found well under its items: the closest,
   * deepseek-v4.1-flash, matched 60% at $0.00052; upstage/solar-mini4 51% at $0.00022.
   */
  get extractModel(): string {
    return process.env.OPENROUTER_EXTRACT_MODEL || "anthropic/claude-haiku-5.5";
  },
  /** Mac work blocks from one person extracted per model call. 1 sends each on its own. */
  get extractBatch(): number {
    const n = Number(process.env.EXTRACT_BATCH);
    return Number.isInteger(n) && n > 0 ? Math.min(n, 10) : 5;
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
  /** The seeded "demo" org: on in development and tests, off in production unless DEMO_ORG=on. */
  get demoOrg(): boolean {
    const v = process.env.DEMO_ORG;
    return v === "on" || (v !== "off" && process.env.NODE_ENV !== "production");
  },
  /** One SQLite file per org: `${dataDir}/orgs/${orgId}.db`. */
  get dataDir(): string {
    return process.env.DATA_DIR || "data";
  },
  /** The codebase agent as one file (`npm run build` in codebase-agent/), served for GitHub Actions to run. */
  get agentBundle(): string {
    return process.env.CODEBASE_AGENT_BUNDLE || `${process.cwd()}/../codebase-agent/dist/ctx-sync.mjs`;
  },
  /** Built Mac app releases served by /api/downloads/mac (see `downloads/mac.ts`). Not in the data backups. */
  get downloadsDir(): string {
    return process.env.DOWNLOADS_DIR || `${this.dataDir}/downloads`;
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
  /** Chrome extension ids allowed by CORS. Empty: no extension while auth is on (any with AUTH_DISABLED=true). Required in production. */
  get extensionIds(): string[] {
    return (process.env.EXTENSION_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  /** One JSON line per API request on stdout. On unless LOG_REQUESTS=false (and off under vitest). */
  get logRequests(): boolean {
    return process.env.LOG_REQUESTS !== "false" && !process.env.VITEST;
  },
  /** Per-token and per-IP rate limits on API routes. RATE_LIMIT=false turns them off (benchmarks, load tests). */
  get rateLimit(): boolean {
    return process.env.RATE_LIMIT !== "false";
  },
  /** Where links in invites and password resets point (the first UI_ORIGIN). */
  get appUrl(): string {
    return (this.uiOrigins[0] ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  /** Outgoing mail for invites and password resets, like smtps://user:pass@smtp.resend.com:465. Unset: no email. */
  get smtpUrl(): string | undefined {
    return process.env.SMTP_URL || undefined;
  },
  /** The From of every email, like "Orion <no-reply@acme.com>". The domain must be verified with the SMTP provider. */
  get mailFrom(): string {
    return process.env.MAIL_FROM || "Orion <no-reply@localhost>";
  },
  /** Invites and resets go out by email. Off: admins copy the links by hand and people ask them for resets. */
  get mailOn(): boolean {
    return !!this.smtpUrl;
  },
};

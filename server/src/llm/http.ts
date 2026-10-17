// Timeouts, retries and provider routing shared by every OpenRouter call (chat, streaming chat, embeddings).
import { HttpError } from "@/http/error";
import { logJson } from "@/jobs/log";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** What a call is for; picks its timeout. */
export type Purpose = "chat" | "extract" | "embed";

/** Every setting here is read per call, so tests and operators can change env without a restart of the module. */
export const llmEnv = {
  timeoutMs(purpose: Purpose): number {
    if (purpose === "extract") return num(process.env.OPENROUTER_TIMEOUT_EXTRACT_MS, 60_000);
    if (purpose === "embed") return num(process.env.OPENROUTER_TIMEOUT_EMBED_MS, 30_000);
    return num(process.env.OPENROUTER_TIMEOUT_CHAT_MS, 45_000);
  },
  /** Retries after the first attempt. */
  get maxRetries(): number {
    const n = Number(process.env.OPENROUTER_MAX_RETRIES);
    return Number.isInteger(n) && n >= 0 ? n : 3;
  },
  /** First backoff step; doubles per retry, plus up to as much again of random jitter. */
  get backoffBaseMs(): number {
    return num(process.env.OPENROUTER_BACKOFF_MS, 500);
  },
  /** A Retry-After longer than this is not waited out: the call fails instead of holding a request open. */
  get maxRetryAfterMs(): number {
    return num(process.env.OPENROUTER_MAX_RETRY_AFTER_MS, 20_000);
  },
  /** OpenRouter provider slugs allowed to serve requests (provider.only). Empty: any that denies data collection. */
  get providers(): string[] {
    return list(process.env.OPENROUTER_PROVIDERS);
  },
  /** Provider slugs never used (provider.ignore). */
  get ignoreProviders(): string[] {
    return list(process.env.OPENROUTER_IGNORE_PROVIDERS);
  },
  /** Chat and decision calls go only to providers that keep nothing (provider.zdr). OPENROUTER_ZDR=off lifts it. */
  get zdr(): boolean {
    return process.env.OPENROUTER_ZDR !== "off";
  },
  /** Each model family's hosts are pinned to MODEL_HOSTS unless OPENROUTER_PROVIDERS is set or OPENROUTER_PINS=off. */
  get pins(): boolean {
    return process.env.OPENROUTER_PINS !== "off";
  },
};

/**
 * The hosts each model family may run on: large providers outside China serving the full or fp8 model. DeepSeek V4.1
 * Flash had 35 hosts on OpenRouter (October 2026), among them DeepSeek, Baidu, Alibaba and SiliconFlow, and small
 * fp4 hosts. Drex (DeepInfra) and Jev (TypeSafe) have one host each and are not listed.
 */
export const MODEL_HOSTS: [prefix: string, hosts: string[]][] = [
  ["deepseek/", ["deepinfra", "together", "fireworks", "baseten", "cloudflare"]],
  ["anthropic/", ["anthropic", "amazon-bedrock", "google-vertex", "azure"]],
];

/**
 * OpenRouter provider routing: never a provider that stores or trains on prompts, only providers that honor every
 * parameter sent (strict JSON schemas), and the operator's allow and deny lists. With a `model` (chat and decision
 * calls), also zero data retention and that model's pinned hosts.
 */
export function providerPrefs(model?: string, { zdr = false }: { zdr?: boolean } = {}): Record<string, unknown> {
  const pinned = model && llmEnv.pins ? (MODEL_HOSTS.find(([prefix]) => model.startsWith(prefix))?.[1] ?? []) : [];
  const only = llmEnv.providers.length ? llmEnv.providers : pinned;
  const ignore = llmEnv.ignoreProviders;
  return {
    data_collection: "deny",
    require_parameters: true,
    ...((zdr || (model && llmEnv.zdr)) && { zdr: true }),
    ...(only.length ? { only } : {}),
    ...(ignore.length ? { ignore } : {}),
  };
}

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
// undici and Node network failures, including HTTP/2 stream resets like NGHTTP2_ENHANCE_YOUR_CALM.
const NETWORK_ERR = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|UND_ERR|NGHTTP2|ERR_HTTP2|socket hang up|fetch failed|terminated|other side closed/i;

export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** A transport-level failure worth another try (not a timeout: those already waited the whole budget). */
export function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error) || isTimeout(err)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const parts = [err.name, err.message, (err as { code?: string }).code];
  if (cause instanceof Error) parts.push(cause.name, cause.message, (cause as { code?: string }).code);
  else if (cause && typeof cause === "object") parts.push(String((cause as { code?: string }).code ?? ""));
  return NETWORK_ERR.test(parts.filter(Boolean).join(" "));
}

/** Retry-After as milliseconds (seconds or an HTTP date); null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Exponential backoff with full jitter on top: base * 2^attempt + random(0, base * 2^attempt). */
export function backoffMs(attempt: number, base = llmEnv.backoffBaseMs, random = Math.random): number {
  const step = base * 2 ** attempt;
  return Math.round(step + random() * step);
}

/** Overridable in tests so retries do not really wait. */
export const timing = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export type RetryOpts = {
  purpose: Purpose;
  /** For logs: "chat", "embeddings". */
  label: string;
  timeoutMs?: number;
  /** Retries after the first attempt; default OPENROUTER_MAX_RETRIES. */
  retries?: number;
  /** Log statuses only, never the provider's error body (zero-retention calls: a provider may echo the prompt). */
  quiet?: boolean;
  /**
   * Reads the body inside the same timeout and retry loop (a stream reset mid-body is retried too). Throw
   * `NoRetry` to stop retrying, for example once streamed text has been shown.
   */
  read?: (res: Response) => Promise<unknown>;
};

/** Wraps an error that must not be retried even though it looks transient. */
export class NoRetry extends Error {
  constructor(readonly inner: unknown) {
    super(inner instanceof Error ? inner.message : String(inner));
    this.name = "NoRetry";
  }
}

const providerFailed = (label: string) => new HttpError(502, label === "embeddings" ? "embedding provider failed" : "model provider failed");

/**
 * fetch with an AbortSignal timeout per attempt and up to `maxRetries` retries on 429, 5xx and network errors,
 * honoring Retry-After. Resolves with the ok Response (and what `read` returned), or throws an HttpError:
 * 504 on timeout, 429 when still rate limited, 502 otherwise. Non-retryable statuses (400, 401, 402, 403, 404)
 * come back as the Response for the caller to judge.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOpts,
): Promise<{ res: Response; body?: unknown }> {
  const timeoutMs = opts.timeoutMs ?? llmEnv.timeoutMs(opts.purpose);
  const max = opts.retries ?? llmEnv.maxRetries;
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= max;
    let wait: number | null = null;
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) {
        const body = opts.read ? await opts.read(res) : undefined;
        return { res, body };
      }
      if (!RETRY_STATUS.has(res.status)) return { res };
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      const after = retryAfterMs(res.headers.get("retry-after"));
      if (last || (after !== null && after > llmEnv.maxRetryAfterMs)) {
        logJson("error", "openrouter request failed", { call: opts.label, status: res.status, attempts: attempt + 1, ...(!opts.quiet && { detail }) });
        throw res.status === 429 ? new HttpError(429, "model provider is rate limited") : providerFailed(opts.label);
      }
      wait = after ?? backoffMs(attempt);
      logJson("warn", "openrouter retry", { call: opts.label, status: res.status, attempt: attempt + 1, waitMs: wait });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof NoRetry) throw err.inner;
      if (isTimeout(err)) {
        logJson("error", "openrouter timeout", { call: opts.label, timeoutMs, attempts: attempt + 1 });
        throw new HttpError(504, "model provider timed out");
      }
      if (!isRetryableNetworkError(err) || last) {
        logJson("error", "openrouter unreachable", { call: opts.label, attempts: attempt + 1, err });
        throw providerFailed(opts.label);
      }
      wait = backoffMs(attempt);
      logJson("warn", "openrouter retry", { call: opts.label, error: (err as Error).message, attempt: attempt + 1, waitMs: wait });
    }
    await timing.sleep(wait);
  }
}

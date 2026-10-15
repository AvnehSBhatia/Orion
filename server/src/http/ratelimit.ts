/**
 * Token buckets per caller, in memory. One process (`next start`) holds them all; a restart refills every bucket.
 * Each limit class has its own buckets, so a chatty dashboard poll never eats into a person's ingest budget.
 */
export type LimitClass = "ingest" | "ask" | "account" | "default";

/** perSec: refill rate. burst: bucket size. */
export const LIMITS: Record<LimitClass, { perSec: number; burst: number }> = {
  // The extension posts a changed source every few seconds; several tabs at once fit in the burst.
  ingest: { perSec: 2, burst: 20 },
  // Chat, dashboard asks, and MCP: each call can spend model money.
  ask: { perSec: 1, burst: 10 },
  // Public account endpoints (signup, reset, invite lookup and accept), keyed by IP.
  account: { perSec: 0.2, burst: 10 },
  // Reads and small writes: generous, so polling UIs never trip it.
  default: { perSec: 20, burst: 120 },
};

type Bucket = { tokens: number; at: number };

export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly limits: Record<string, { perSec: number; burst: number }> = LIMITS) {}

  /** Takes one token. Returns 0 when allowed, else the seconds until a token is free. */
  take(cls: string, key: string, now = Date.now()): number {
    const { perSec, burst } = this.limits[cls] ?? this.limits.default;
    const id = `${cls}|${key}`;
    const b = this.buckets.get(id) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSec);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(id, b);
      this.trim();
      return 0;
    }
    this.buckets.set(id, b);
    return Math.max(1, Math.ceil((1 - b.tokens) / perSec));
  }

  /** Keeps memory bounded under a spray of keys: drop the oldest entries. */
  private trim(): void {
    if (this.buckets.size <= 50_000) return;
    for (const k of [...this.buckets.keys()].slice(0, 10_000)) this.buckets.delete(k);
  }

  clear(): void {
    this.buckets.clear();
  }
}

const g = globalThis as typeof globalThis & { __orionBuckets?: TokenBuckets };
export const rateLimiter = (): TokenBuckets => (g.__orionBuckets ??= new TokenBuckets());

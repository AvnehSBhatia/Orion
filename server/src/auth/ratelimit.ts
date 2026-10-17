/** Counts failed logins per key (ip + username) in a sliding window. In memory: one process, resets on restart. */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    readonly max = 10,
    readonly windowMs = 15 * 60_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  /** Seconds until the key may try again, or 0 when it is not blocked. */
  blockedFor(key: string, now = Date.now()): number {
    const kept = this.recent(key, now);
    if (kept.length < this.max) return 0;
    return Math.max(1, Math.ceil((kept[kept.length - this.max] + this.windowMs - now) / 1000));
  }

  fail(key: string, now = Date.now()): void {
    const kept = this.recent(key, now);
    kept.push(now);
    this.failures.set(key, kept);
    // Keep memory bounded under a spray of usernames.
    if (this.failures.size > 50_000) for (const k of [...this.failures.keys()].slice(0, 10_000)) this.failures.delete(k);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

const g = globalThis as typeof globalThis & { __orionLoginLimiter?: LoginLimiter; __orionForgotLimiter?: LoginLimiter };
export const loginLimiter = (): LoginLimiter => (g.__orionLoginLimiter ??= new LoginLimiter());
/** Self-service reset emails per account: 3 an hour, so nobody can flood a person's inbox from many IPs. */
export const forgotLimiter = (): LoginLimiter => (g.__orionForgotLimiter ??= new LoginLimiter(3, 60 * 60_000));

// Retry timing for the upload queue: exponential backoff, or exactly what the
// server asked for with Retry-After.

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
// Never wait less than this, whatever Retry-After says, and never more than an hour.
const RETRY_AFTER_MIN_MS = 1_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;

/**
 * Retry-After as milliseconds from now. Accepts delta seconds ("120") or an
 * HTTP date, plus the `retryAfterSec` the server also puts in the JSON body.
 * Null when neither is usable.
 */
export function parseRetryAfter(header: string | null | undefined, bodySec?: unknown, now = Date.now()): number | null {
  const h = header?.trim();
  if (h) {
    if (/^\d+(\.\d+)?$/.test(h)) return Number(h) * 1000;
    const at = Date.parse(h);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  if (typeof bodySec === 'number' && Number.isFinite(bodySec) && bodySec >= 0) return bodySec * 1000;
  return null;
}

/**
 * How long to wait before the next attempt. attempt counts failures in a row,
 * starting at 1. With a Retry-After, that wins (clamped to 1s..1h). Otherwise
 * 5s, 10s, 20s ... up to 5 minutes, plus up to 25% jitter so many clients
 * coming back from the same outage do not retry in lockstep.
 */
export function backoffDelay(attempt: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  if (retryAfterMs !== null) return Math.min(Math.max(retryAfterMs, RETRY_AFTER_MIN_MS), RETRY_AFTER_MAX_MS);
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 20));
  return Math.round(exp * (1 + 0.25 * random()));
}

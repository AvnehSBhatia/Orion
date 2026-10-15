// The org's capture policy (GET /api/capture/policy) and the local privacy
// controls (pause, never-capture sites), combined into one "may we read this?" check.

import { hostMatches, hostOf } from './url.ts';

export type CapturePolicy = {
  captureEnabled: boolean;
  excludedHosts: string[];
  captureIntervalSec: number;
  consent: { required: boolean; version: number };
};

export const MIN_INTERVAL_SEC = 5;
export const MAX_INTERVAL_SEC = 3600;

export const DEFAULT_POLICY: CapturePolicy = {
  captureEnabled: true,
  excludedHosts: [],
  captureIntervalSec: 5,
  consent: { required: false, version: 0 },
};

/** Reads the server's JSON defensively: unknown or malformed fields fall back to defaults. */
export function parsePolicy(json: unknown): CapturePolicy {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const interval = Number(o.captureIntervalSec);
  const consent = (o.consent && typeof o.consent === 'object' ? o.consent : {}) as Record<string, unknown>;
  return {
    captureEnabled: o.captureEnabled !== false,
    excludedHosts: Array.isArray(o.excludedHosts) ? o.excludedHosts.filter((h): h is string => typeof h === 'string') : [],
    captureIntervalSec:
      o.captureIntervalSec !== undefined && Number.isFinite(interval)
        ? Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.round(interval)))
        : DEFAULT_POLICY.captureIntervalSec,
    consent: {
      required: consent.required === true,
      version: Number.isFinite(Number(consent.version)) ? Number(consent.version) : 0,
    },
  };
}

/** Pause "until I resume" is stored as this far-future time. */
export const PAUSE_FOREVER = Number.MAX_SAFE_INTEGER;

export function isPaused(pausedUntil: number | null | undefined, now = Date.now()): boolean {
  return typeof pausedUntil === 'number' && pausedUntil > now;
}

export type BlockReason = 'org_excluded' | 'user_blocked' | 'not_web';

/** Why this URL must not be read at all, or null when it may be captured. */
export function blockReason(
  url: string | undefined,
  policy: Pick<CapturePolicy, 'excludedHosts'>,
  blockedHosts: readonly string[],
): BlockReason | null {
  const host = hostOf(url);
  if (!host) return 'not_web';
  if (hostMatches(host, policy.excludedHosts)) return 'org_excluded';
  if (hostMatches(host, blockedHosts)) return 'user_blocked';
  return null;
}

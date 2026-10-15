// Maps a server answer to what the extension should do about it.

export type Outcome =
  | { kind: 'ok' }
  | { kind: 'signed_out' } // 401: the token is gone or revoked. Stop and ask to sign in again.
  | { kind: 'consent' } // 403 "consent required": show the monitoring notice.
  | { kind: 'paused_by_org' } // 403 "capture paused": the org turned capture off.
  | { kind: 'forbidden' } // any other 403: this account or extension may not send captures.
  | { kind: 'retry'; retryAfterMs: number | null } // 429, 5xx, 408, network: back off and try again.
  | { kind: 'budget' } // 402: the org's model budget is spent.
  | { kind: 'drop' }; // other 4xx: this capture will never be accepted, so do not resend it.

export function classifyResponse(status: number, error: string | undefined, retryAfterMs: number | null): Outcome {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 401) return { kind: 'signed_out' };
  if (status === 403) {
    const e = (error ?? '').toLowerCase();
    if (e.includes('consent')) return { kind: 'consent' };
    if (e.includes('paused') || e.includes('disabled')) return { kind: 'paused_by_org' };
    return { kind: 'forbidden' };
  }
  if (status === 402) return { kind: 'budget' };
  if (status === 408 || status === 425 || status === 429 || status >= 500) return { kind: 'retry', retryAfterMs };
  return { kind: 'drop' };
}

// POST /api/ingest/capture, and what to do with each kind of answer.

import { parseRetryAfter } from '../lib/backoff.ts';
import { classifyResponse, type Outcome } from '../lib/responses.ts';
import { stripQueryAndFragment } from '../lib/url.ts';
import { patchLocal } from '../privacy';
import { getSettings } from '../settings';
import type { CapturePayload, CaptureResponse, ErrorCode } from '../types';
import { apiFetch, errorBody, NetworkError } from './api';
import { handleSignedOut } from './account';
import { CaptureError } from './errors';
import { stopRecording } from './recorder';

// The server reads each capture with a model, which can take a while.
const REQUEST_TIMEOUT_MS = 18_000;

/** Sends one capture and classifies the answer. Never throws for HTTP or network failures. */
export async function postCapture(payload: CapturePayload): Promise<Outcome & { body?: CaptureResponse }> {
  const { orgId } = await getSettings();
  // Belt and braces: payloads are built with clean URLs, but never send a query string.
  const clean = { ...payload, url: stripQueryAndFragment(payload.url) };
  const body = JSON.stringify(orgId.trim() ? { ...clean, orgId: orgId.trim() } : clean);
  let res: Response;
  try {
    res = await apiFetch('/api/ingest/capture', { method: 'POST', body }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof NetworkError) return { kind: 'retry', retryAfterMs: null };
    throw err; // insecure_url
  }
  const { error, retryAfterSec } = await errorBody(res);
  const outcome = classifyResponse(res.status, error, parseRetryAfter(res.headers.get('Retry-After'), retryAfterSec));
  if (outcome.kind !== 'ok') {
    console.info('[orion] capture answered', res.status, error ?? '');
    return outcome;
  }
  const json = (await res.json().catch(() => ({}))) as Partial<CaptureResponse>;
  return { kind: 'ok', body: { nodesTouched: json.nodesTouched ?? [] } };
}

const STOP_CODES = {
  signed_out: 'signed_out',
  consent: 'consent',
  paused_by_org: 'paused_by_org',
  forbidden: 'forbidden',
} as const satisfies Partial<Record<Outcome['kind'], ErrorCode>>;

/** True for answers that end the session: 401, and 403 for consent, paused, or anything else. */
export function isStopOutcome(o: Outcome): o is { kind: keyof typeof STOP_CODES } {
  return o.kind in STOP_CODES;
}

/** Ends the session for a 401 or 403, leaving a clear reason for the popup. */
export async function stopFor(o: { kind: keyof typeof STOP_CODES }): Promise<ErrorCode> {
  const code = STOP_CODES[o.kind];
  if (o.kind === 'signed_out') {
    await handleSignedOut();
    return code;
  }
  if (o.kind === 'consent') await patchLocal({ attention: 'consent' });
  await stopRecording(code);
  return code;
}

/** The one-off "Hide something" send: post now, and turn any failure into an error the popup explains. */
export async function uploadCapture(payload: CapturePayload): Promise<CaptureResponse> {
  const outcome = await postCapture(payload);
  if (outcome.kind === 'ok') return outcome.body ?? { nodesTouched: [] };
  if (isStopOutcome(outcome)) throw new CaptureError(await stopFor(outcome));
  if (outcome.kind === 'budget') throw new CaptureError('budget');
  if (outcome.kind === 'retry') throw new CaptureError('backend');
  throw new CaptureError('unknown', 'capture rejected');
}

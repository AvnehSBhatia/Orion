// Every call to the Orion server goes through here, so the https rule is
// checked at send time, not only when the URL is saved.

import { isAllowedServerUrl } from '../lib/url.ts';
import { authHeaders, getSettings } from '../settings';
import { CaptureError } from './errors';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Thrown when the request never got an answer (offline, DNS, timeout). */
export class NetworkError extends Error {
  readonly timedOut: boolean;

  constructor(detail: string, timedOut: boolean) {
    super(detail);
    this.timedOut = timedOut;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const settings = await getSettings();
  if (!isAllowedServerUrl(settings.backendUrl)) {
    throw new CaptureError('insecure_url', `refusing to send to ${settings.backendUrl}`);
  }
  const url = settings.backendUrl.replace(/\/+$/, '') + path;
  try {
    return await fetch(url, {
      ...init,
      headers: { ...authHeaders(settings), ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'omit',
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new NetworkError(String(err), timedOut);
  }
}

/** The `{ error, retryAfterSec }` body of an error answer, or {} when there is none. */
export async function errorBody(res: Response): Promise<{ error?: string; retryAfterSec?: unknown }> {
  if (res.ok) return {};
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; retryAfterSec?: unknown };
  return { error: typeof body.error === 'string' ? body.error : undefined, retryAfterSec: body.retryAfterSec };
}

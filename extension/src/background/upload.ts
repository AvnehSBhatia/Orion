// Sends one capture to the Orion server. The upload runs in the service worker
// rather than a page, so it is not subject to CORS (host_permissions covers it).

import { authHeaders, getSettings } from '../settings';
import type { CapturePayload, CaptureResponse } from '../types';
import { CaptureError } from './errors';

// The server reads each capture with a model, which can take a while.
const REQUEST_TIMEOUT_MS = 18_000;

export async function uploadCapture(payload: CapturePayload): Promise<CaptureResponse> {
  const settings = await getSettings();
  const { backendUrl, orgId } = settings;
  const endpoint = backendUrl.replace(/\/+$/, '') + '/api/ingest/capture';
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify(orgId.trim() ? { ...payload, orgId: orgId.trim() } : payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new CaptureError('timeout');
    throw new CaptureError('backend', String(err));
  }
  if (!res.ok) throw new CaptureError('backend', `${res.status} ${await res.text()}`);

  const body = (await res.json()) as Partial<CaptureResponse>;
  return { nodesTouched: body.nodesTouched ?? [] };
}

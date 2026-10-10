// Service worker. Does the actual capture and upload so the request still
// finishes if the popup closes, and so the fetch is not subject to page CORS.

import { readPage, type PageData } from './content';
import { getSettings } from './settings';
import type { BgRequest, BgResult, CapturePayload, CaptureResponse, ErrorCode } from './types';

const MAX_SCREENSHOT_B64 = 2_000_000;
const REQUEST_TIMEOUT_MS = 18_000; // popup gives up at 20s
const CAPTURE_QUOTA_WAIT_MS = 600;
// Fallback re-encodes, tried in order, for screenshots over the size limit.
const SHRINK_STEPS: [scale: number, quality: number][] = [
  [0.75, 0.6],
  [0.5, 0.6],
  [0.35, 0.5],
];

class CaptureError extends Error {
  constructor(readonly code: ErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  handle(msg).then(
    (data) => sendResponse({ ok: true, data } satisfies BgResult<unknown>),
    (err) => {
      console.error('[constellation]', err);
      const code = err instanceof CaptureError ? err.code : 'unknown';
      sendResponse({ ok: false, code } satisfies BgResult<unknown>);
    },
  );
  return true; // keep the channel open for the async response
});

async function handle(msg: BgRequest): Promise<unknown> {
  switch (msg.type) {
    case 'screenshot':
      return takeScreenshot(msg.windowId);
    case 'capture':
      return capture(msg);
  }
}

async function capture(msg: Extract<BgRequest, { type: 'capture' }>): Promise<CaptureResponse> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');

  const tab = await chrome.tabs.get(msg.tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) throw new CaptureError('restricted', tab.url);

  const [screenshotDataUrl, page] = await Promise.all([
    msg.screenshotDataUrl ?? takeScreenshot(msg.windowId),
    readTab(msg.tabId),
  ]);

  const payload: CapturePayload = {
    userId: settings.userId.trim(),
    url: tab.url,
    title: tab.title ?? '',
    html: page.html,
    screenshotB64: await fitScreenshot(stripDataUrlPrefix(screenshotDataUrl)),
    redactions: msg.redactions ?? [],
  };

  const endpoint = settings.backendUrl.replace(/\/+$/, '') + '/api/ingest/capture';
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

async function takeScreenshot(windowId: number, retried = false): Promise<string> {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
  } catch (err) {
    // Chrome allows two captures per second. Wait out the quota once.
    if (!retried && String(err).includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
      await new Promise((r) => setTimeout(r, CAPTURE_QUOTA_WAIT_MS));
      return takeScreenshot(windowId, true);
    }
    throw new CaptureError('restricted', String(err));
  }
}

async function readTab(tabId: number): Promise<PageData> {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return injection.result as PageData;
  } catch (err) {
    // Chrome Web Store, PDF viewer, and similar pages refuse script injection.
    throw new CaptureError('restricted', String(err));
  }
}

function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

// High DPI screens can produce screenshots over the backend limit. Shrink until it fits.
async function fitScreenshot(b64: string): Promise<string> {
  if (b64.length <= MAX_SCREENSHOT_B64) return b64;

  const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
  const bitmap = await createImageBitmap(blob);
  for (const [scale, quality] of SHRINK_STEPS) {
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await blobToBase64(await canvas.convertToBlob({ type: 'image/jpeg', quality }));
    if (out.length <= MAX_SCREENSHOT_B64) return out;
  }
  throw new CaptureError('unknown', 'screenshot too large after shrinking');
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Service worker. While recording, sends a screenshot plus the page HTML of the
// active tab every few seconds. Lives here, not in the popup, so it keeps going
// after the popup closes and the fetch is not subject to page CORS.

import { readPage, type PageData } from './content';
import { getRecording, patchRecording } from './recording';
import { endpoint, getSettings } from './settings';
import type { BgRequest, BgResult, CapturePayload, CaptureResponse, ErrorCode, Rect } from './types';

const CAPTURE_INTERVAL_MS = 5_000;
const WATCHDOG_ALARM = 'capture-watchdog';
const WATCHDOG_PERIOD_MIN = 0.5; // the shortest period Chrome allows
const BADGE_COLOR = '#FF5C7A';
const icons = (live: boolean) =>
  Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/orion${live ? '-live' : ''}-${s}.png`]));
const MAX_SCREENSHOT_B64 = 2_000_000;
// The backend reads the page with an LLM and may take up to its 60 second route limit.
const REQUEST_TIMEOUT_MS = 60_000;
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

function codeOf(err: unknown): ErrorCode {
  const code = err instanceof CaptureError ? err.code : 'unknown';
  // Missing or unknown user ids and chrome:// pages are normal, not errors worth flagging.
  const expected = code === 'no_user' || code === 'unknown_user' || code === 'restricted';
  (expected ? console.info : console.error)('[orion]', err);
  return code;
}

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  handle(msg).then(
    (data) => sendResponse({ ok: true, data } satisfies BgResult<unknown>),
    (err) => sendResponse({ ok: false, code: codeOf(err) } satisfies BgResult<unknown>),
  );
  return true; // keep the channel open for the async response
});

async function handle(msg: BgRequest): Promise<unknown> {
  switch (msg.type) {
    case 'start':
      return startRecording();
    case 'stop':
      return stopRecording();
    case 'screenshot':
      return takeScreenshot(msg.windowId);
    case 'capture':
      return post(await buildPayload(await chrome.tabs.get(msg.tabId), msg));
  }
}

// Recording loop

let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let lastSent: CapturePayload | null = null;

// Chrome can stop an idle service worker. Pick the loop back up when it wakes,
// and keep an alarm running so it does wake while recording.
getRecording().then((s) => s.recording && startLoop());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) getRecording().then((s) => s.recording && startLoop());
});

async function startRecording(): Promise<void> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');
  await patchRecording({ recording: true, sent: 0, shared: 0, lastSentAt: null, lastError: null });
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: 'ON' });
  await chrome.action.setIcon({ path: icons(true) });
  startLoop();
}

async function stopRecording(): Promise<void> {
  clearInterval(timer);
  timer = undefined;
  lastSent = null;
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setIcon({ path: icons(false) });
  await patchRecording({ recording: false });
}

function startLoop() {
  if (timer) return;
  timer = setInterval(tick, CAPTURE_INTERVAL_MS);
  tick();
}

async function tick() {
  if (inFlight) return; // previous send is still going, skip this beat
  inFlight = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || (await isOrionPage(tab.url))) return;
    const payload = await buildPayload(tab);
    // A screen that has not changed encodes to the same bytes. Skip it so the
    // backend does not reprocess identical captures every 5 seconds.
    if (
      lastSent &&
      payload.url === lastSent.url &&
      payload.html === lastSent.html &&
      payload.screenshotB64 === lastSent.screenshotB64
    ) {
      return;
    }
    const res = await post(payload);
    lastSent = payload;
    const kept = !!res.sourceId && !res.duplicateOf && !res.notWork;
    const state = await getRecording();
    if (state.recording) {
      await patchRecording({ sent: state.sent + 1, shared: state.shared + (kept ? 1 : 0), lastSentAt: Date.now(), lastError: null });
    }
  } catch (err) {
    const code = codeOf(err);
    if ((await getRecording()).recording) await patchRecording({ lastError: code });
  } finally {
    inFlight = false;
  }
}

// Capture and send

// Orion's own pages would feed its answers back into itself.
async function isOrionPage(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL((await getSettings()).backendUrl).origin;
  } catch {
    return false;
  }
}

async function buildPayload(
  tab: chrome.tabs.Tab,
  hidden?: { screenshotDataUrl: string; redactions: Rect[] },
): Promise<CapturePayload> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');
  if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) {
    throw new CaptureError('restricted', tab.url);
  }

  const [screenshotDataUrl, page] = await Promise.all([
    hidden?.screenshotDataUrl ?? takeScreenshot(tab.windowId),
    readTab(tab.id),
  ]);

  return {
    orgId: settings.orgId.trim() || 'demo',
    userId: settings.userId.trim(),
    url: tab.url,
    title: tab.title ?? '',
    html: page.html,
    screenshotB64: await fitScreenshot(stripDataUrlPrefix(screenshotDataUrl)),
    redactions: hidden?.redactions ?? [],
  };
}

async function post(payload: CapturePayload): Promise<CaptureResponse> {
  const { backendUrl } = await getSettings();
  let res: Response;
  try {
    res = await fetch(endpoint(backendUrl, '/api/ingest/capture'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new CaptureError('timeout');
    throw new CaptureError('backend', String(err));
  }
  if (!res.ok) {
    const detail = `${res.status} ${await res.text()}`;
    throw new CaptureError(res.status === 404 && detail.includes('unknown userId') ? 'unknown_user' : 'backend', detail);
  }

  const body = (await res.json()) as Partial<CaptureResponse>;
  return { ...body, nodesTouched: body.nodesTouched ?? [] };
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

// HTML is best effort. Some pages refuse script injection; the screenshot still goes.
async function readTab(tabId: number): Promise<PageData> {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return (injection?.result as PageData | undefined) ?? { html: '', textOnly: true };
  } catch (err) {
    console.info('[orion] could not read page html', err);
    return { html: '', textOnly: true };
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

// Service worker. While recording, sends a frame of the whole screen every few
// seconds, plus the page HTML when a Chrome tab is in front. The screen share
// itself lives in capture.html; this worker runs the timer and does the upload,
// so it keeps going after the popup closes and the fetch is not subject to CORS.

import { readPage, type PageData } from './content';
import { getRecording, patchRecording } from './recording';
import { getSettings } from './settings';
import type {
  BgRequest,
  BgResult,
  CapturePayload,
  CaptureResponse,
  ErrorCode,
  Rect,
  ScreenFrame,
} from './types';

const CAPTURE_INTERVAL_MS = 5_000;
const CAPTURE_WINDOW = { width: 420, height: 240 };
// Placeholders when another app is in front and there is no tab to describe.
const DESKTOP_URL = 'desktop://screen';
const DESKTOP_TITLE = 'Desktop';
// A thumbnail pixel counts as changed past this grayscale delta, and the screen
// counts as changed past this share of pixels. Tuned so the cursor and the menu
// bar clock alone do not trigger a send.
const PIXEL_DELTA = 24;
const CHANGED_FRACTION = 0.002;
const WATCHDOG_ALARM = 'capture-watchdog';
const WATCHDOG_PERIOD_MIN = 0.5; // the shortest period Chrome allows
const BADGE_COLOR = '#FF5C7A';
const MAX_SCREENSHOT_B64 = 2_000_000;
const REQUEST_TIMEOUT_MS = 18_000;
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
  // Missing user id and chrome:// pages are normal, not errors worth flagging.
  const expected = code === 'no_user' || code === 'restricted';
  (expected ? console.info : console.error)('[constellation]', err);
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
    case 'screen-ended':
      return stopRecording();
    case 'screen-ready':
      return onScreenReady();
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
let lastThumb: number[] | null = null;

// Chrome can stop an idle service worker. Pick the loop back up when it wakes,
// and keep an alarm running so it does wake while recording.
getRecording().then((s) => s.recording && startLoop());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) getRecording().then((s) => s.recording && startLoop());
});

// Closing the capture window ends the screen share, so stop.
chrome.windows.onRemoved.addListener(async (windowId) => {
  if ((await getRecording()).captureWindowId === windowId) await stopRecording();
});

// Opens the capture window, which asks the user to pick a screen. Recording
// actually starts when that window reports 'screen-ready'.
async function startRecording(): Promise<void> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');

  const { captureWindowId } = await getRecording();
  if (captureWindowId !== null) {
    try {
      await chrome.windows.update(captureWindowId, { focused: true });
      return;
    } catch {
      // The window is gone. Open a new one.
    }
  }
  const win = await chrome.windows.create({ url: 'capture.html', type: 'popup', focused: true, ...CAPTURE_WINDOW });
  await patchRecording({ captureWindowId: win?.id ?? null });
}

async function onScreenReady(): Promise<void> {
  await patchRecording({ recording: true, sent: 0, lastSentAt: null, lastError: null });
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: 'ON' });
  startLoop();
}

async function stopRecording(): Promise<void> {
  clearInterval(timer);
  timer = undefined;
  lastSent = null;
  lastThumb = null;
  const { captureWindowId } = await getRecording();
  await patchRecording({ recording: false, captureWindowId: null });
  if (captureWindowId !== null) await chrome.windows.remove(captureWindowId).catch(() => {});
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await chrome.action.setBadgeText({ text: '' });
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
    const frame = await requestFrame();
    if (!frame) {
      // The capture window is gone or the share ended.
      await stopRecording();
      return;
    }
    const payload = await buildScreenPayload(frame, (await getRecording()).captureWindowId);
    // Skip near identical screens so the backend does not reprocess the same
    // thing every 5 seconds.
    if (
      lastSent &&
      payload.url === lastSent.url &&
      payload.html === lastSent.html &&
      !screenChanged(lastThumb, frame.thumb)
    ) {
      return;
    }
    await post(payload);
    lastSent = payload;
    lastThumb = frame.thumb;
    const state = await getRecording();
    if (state.recording) {
      await patchRecording({ sent: state.sent + 1, lastSentAt: Date.now(), lastError: null });
    }
  } catch (err) {
    const code = codeOf(err);
    if ((await getRecording()).recording) await patchRecording({ lastError: code });
  } finally {
    inFlight = false;
  }
}

// Capture and send

async function requestFrame(): Promise<ScreenFrame | null> {
  try {
    return await chrome.runtime.sendMessage<{ type: 'grab-frame' }, ScreenFrame | null>({ type: 'grab-frame' });
  } catch {
    return null; // no capture window listening
  }
}

function screenChanged(before: number[] | null, after: number[]): boolean {
  if (!before || before.length !== after.length) return true;
  let changed = 0;
  for (let i = 0; i < after.length; i++) {
    if (Math.abs(before[i] - after[i]) > PIXEL_DELTA) changed++;
  }
  return changed / after.length > CHANGED_FRACTION;
}

// The Chrome tab in front of the user, or null when another app (or our own
// capture window) has focus.
async function focusedChromeTab(captureWindowId: number | null): Promise<chrome.tabs.Tab | null> {
  const win = await chrome.windows.getLastFocused({ populate: true });
  if (!win.focused || win.id === captureWindowId) return null;
  return win.tabs?.find((t) => t.active) ?? null;
}

async function buildScreenPayload(frame: ScreenFrame, captureWindowId: number | null): Promise<CapturePayload> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');

  const tab = await focusedChromeTab(captureWindowId);
  const readable = tab?.id !== undefined && /^https?:/.test(tab.url ?? '');
  const page = readable ? await readTab(tab.id!) : { html: '' };

  return {
    userId: settings.userId.trim(),
    url: tab?.url || DESKTOP_URL,
    title: tab?.title || DESKTOP_TITLE,
    html: page.html,
    screenshotB64: await fitScreenshot(stripDataUrlPrefix(frame.dataUrl)),
    redactions: [],
    source: tab ? 'browser' : 'desktop',
  };
}

// One off tab capture, used by the "Hide something" flow.
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
    userId: settings.userId.trim(),
    url: tab.url,
    title: tab.title ?? '',
    html: page.html,
    screenshotB64: await fitScreenshot(stripDataUrlPrefix(screenshotDataUrl)),
    redactions: hidden?.redactions ?? [],
    source: 'browser',
  };
}

async function post(payload: CapturePayload): Promise<CaptureResponse> {
  const { backendUrl } = await getSettings();
  const endpoint = backendUrl.replace(/\/+$/, '') + '/api/ingest/capture';
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

// HTML is best effort. Some pages refuse script injection; the screenshot still goes.
async function readTab(tabId: number): Promise<PageData> {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return (injection?.result as PageData | undefined) ?? { html: '', textOnly: true };
  } catch (err) {
    console.info('[constellation] could not read page html', err);
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

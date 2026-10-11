// Service worker. While recording, every few seconds it sends one capture per
// source the user allowed: each shared app window or screen (frames come from
// capture.html, which holds the streams) and each ticked Chrome tab (screenshot
// plus HTML). Nothing outside those sources is read. This worker runs the timer
// and does the upload, so it keeps going after the popup closes and the fetch
// is not subject to CORS.

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
const CAPTURE_WINDOW = { width: 680, height: 860 };
// A thumbnail pixel counts as changed past this grayscale delta, and a window
// or screen counts as changed past this share of pixels. Tuned so the cursor and the menu
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
      return stopRecording();
    case 'sources-start':
      return onSourcesStart();
    case 'screenshot':
      return takeScreenshot(msg.windowId);
    case 'capture':
      return post(await buildPayload(await chrome.tabs.get(msg.tabId), msg));
    default:
      // Usually a page built from newer code than this worker. Fail loudly so
      // the page can tell the user to reload the extension.
      throw new CaptureError('unknown', `unknown message ${(msg as { type: string }).type}`);
  }
}

// Recording loop

let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
// What was last sent per source, so a source that has not changed is skipped.
const lastSent = new Map<string, { url: string; html: string; screenshotB64?: string; thumb?: number[] }>();

// Chrome can stop an idle service worker. Pick the loop back up when it wakes,
// and keep an alarm running so it does wake while recording.
getRecording().then((s) => s.recording && startLoop());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) getRecording().then((s) => s.recording && startLoop());
});

// Closing the capture window ends every window and screen share, so stop.
chrome.windows.onRemoved.addListener(async (windowId) => {
  if ((await getRecording()).captureWindowId === windowId) await stopRecording();
});

// Forget allowed tabs once they close.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { allowedTabIds } = await getRecording();
  if (allowedTabIds.includes(tabId)) {
    await patchRecording({ allowedTabIds: allowedTabIds.filter((id) => id !== tabId) });
  }
});

// Opens the capture window, where the user picks what to share. Recording
// actually starts when that window reports 'sources-start'.
async function startRecording(): Promise<void> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');

  const { captureWindowId } = await getRecording();
  if (captureWindowId !== null) {
    try {
      await chrome.windows.update(captureWindowId, { state: 'normal', focused: true });
      return;
    } catch {
      // The window is gone. Open a new one.
    }
  }
  const win = await chrome.windows.create({ url: 'capture.html', type: 'popup', focused: true, ...CAPTURE_WINDOW });
  await patchRecording({ captureWindowId: win?.id ?? null, allowedTabIds: [] });
}

async function onSourcesStart(): Promise<void> {
  await patchRecording({ recording: true, sent: 0, lastSentAt: null, lastError: null });
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: 'ON' });
  startLoop();

  // Get the chooser out of the way. It holds the window and screen shares, so
  // it is minimized rather than closed.
  const { captureWindowId } = await getRecording();
  if (captureWindowId !== null) {
    await chrome.windows.update(captureWindowId, { state: 'minimized' }).catch(() => {});
  }
  // Show the small toolbar popup so the user sees it is live and where to stop.
  // Chrome may refuse (no normal window in front); the ON badge still shows.
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (win?.id !== undefined) await chrome.action.openPopup({ windowId: win.id }).catch(() => {});
}

async function stopRecording(): Promise<void> {
  clearInterval(timer);
  timer = undefined;
  lastSent.clear();
  const { captureWindowId } = await getRecording();
  await patchRecording({ recording: false, captureWindowId: null, allowedTabIds: [] });
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
    const frames = await requestFrames();
    if (!frames) {
      // The capture window is gone.
      await stopRecording();
      return;
    }
    const { userId } = await getSettings();
    if (!userId.trim()) throw new CaptureError('no_user');

    const captures: { key: string; payload: CapturePayload; thumb?: number[] }[] = [];
    for (const frame of frames) {
      captures.push({ key: frame.sourceId, payload: await windowPayload(frame), thumb: frame.thumb });
    }
    for (const tabId of (await getRecording()).allowedTabIds) {
      const payload = await tabPayload(tabId);
      if (payload) captures.push({ key: `tab:${tabId}`, payload });
    }

    let sent = 0;
    for (const { key, payload, thumb } of captures) {
      // Skip sources that look the same as last time so the backend does not
      // reprocess them every 5 seconds.
      if (unchanged(key, payload, thumb)) continue;
      await post(payload);
      lastSent.set(key, {
        url: payload.url,
        html: payload.html,
        thumb,
        screenshotB64: thumb ? undefined : payload.screenshotB64,
      });
      sent++;
    }

    const state = await getRecording();
    if (state.recording && sent > 0) {
      await patchRecording({ sent: state.sent + sent, lastSentAt: Date.now(), lastError: null });
    }
  } catch (err) {
    const code = codeOf(err);
    if ((await getRecording()).recording) await patchRecording({ lastError: code });
  } finally {
    inFlight = false;
  }
}

// Capture and send

// One frame per shared window or screen, or null when no capture window is open.
async function requestFrames(): Promise<ScreenFrame[] | null> {
  try {
    const frames = await chrome.runtime.sendMessage<{ type: 'grab-frames' }, ScreenFrame[] | undefined>({
      type: 'grab-frames',
    });
    return frames ?? null;
  } catch {
    return null; // no capture window listening
  }
}

function unchanged(key: string, payload: CapturePayload, thumb?: number[]): boolean {
  const prev = lastSent.get(key);
  if (!prev || prev.url !== payload.url || prev.html !== payload.html) return false;
  return thumb ? !screenChanged(prev.thumb ?? null, thumb) : prev.screenshotB64 === payload.screenshotB64;
}

function screenChanged(before: number[] | null, after: number[]): boolean {
  if (!before || before.length !== after.length) return true;
  let changed = 0;
  for (let i = 0; i < after.length; i++) {
    if (Math.abs(before[i] - after[i]) > PIXEL_DELTA) changed++;
  }
  return changed / after.length > CHANGED_FRACTION;
}

// A shared app window or screen. There is no page to read, only the frame.
async function windowPayload(frame: ScreenFrame): Promise<CapturePayload> {
  const { userId } = await getSettings();
  return {
    userId: userId.trim(),
    url: `desktop://${frame.kind}/${frame.sourceId}`,
    title: frame.label,
    html: '',
    screenshotB64: await fitScreenshot(stripDataUrlPrefix(frame.dataUrl)),
    redactions: [],
    source: frame.kind,
  };
}

// An allowed Chrome tab. Chrome can only screenshot what is on screen, so the
// tab is captured only while it is the visible tab in a window that is not
// minimized. Returns null when it cannot be captured right now.
async function tabPayload(tabId: number): Promise<CapturePayload | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active || !tab.url || !/^https?:/.test(tab.url)) return null;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!win || win.state === 'minimized') return null;
  return buildPayload(tab).catch((err) => {
    if (err instanceof CaptureError && err.code === 'restricted') return null;
    throw err;
  });
}

// A Chrome tab: screenshot plus HTML. Used for allowed tabs and for the one off
// "Hide something" send.
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
    source: 'tab',
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

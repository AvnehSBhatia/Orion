// The recording session: opening the chooser window, the capture loop, and
// stopping. State that must outlive a service worker restart (on/off, counts,
// allowed tabs) lives in chrome.storage.session via ../recording.

import { getRecording, patchRecording } from '../recording';
import { getSettings } from '../settings';
import type { CapturePayload } from '../types';
import { forgetSent, isUnchanged, rememberSent } from './changes';
import { CaptureError, reportError } from './errors';
import { requestFrames, tabPayload, windowPayload } from './sources';
import { uploadCapture } from './upload';

const CAPTURE_INTERVAL_MS = 5_000;
const CHOOSER_WINDOW = { width: 680, height: 860 };
const BADGE_COLOR = '#FF5C7A';
// Chrome can stop an idle service worker, which kills the interval timer. This
// alarm wakes the worker so the loop can resume. 30 seconds is Chrome's minimum.
export const WATCHDOG_ALARM = 'capture-watchdog';
const WATCHDOG_PERIOD_MIN = 0.5;

let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;

/**
 * Opens the chooser window, where the user picks what to share, or focuses it
 * if it is already open. Recording starts only when the user presses start in
 * that window (see beginRecording).
 */
export async function openChooser(): Promise<void> {
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
  const win = await chrome.windows.create({ url: 'capture.html', type: 'popup', focused: true, ...CHOOSER_WINDOW });
  await patchRecording({ captureWindowId: win?.id ?? null, allowedTabIds: [] });
}

/** The user picked sources and pressed start in the chooser window. */
export async function beginRecording(): Promise<void> {
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

/** Stops everything: the loop, the chooser window (ending every share), and the badge. */
export async function stopRecording(): Promise<void> {
  clearInterval(timer);
  timer = undefined;
  forgetSent();
  const { captureWindowId } = await getRecording();
  await patchRecording({ recording: false, captureWindowId: null, allowedTabIds: [] });
  if (captureWindowId !== null) await chrome.windows.remove(captureWindowId).catch(() => {});
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await chrome.action.setBadgeText({ text: '' });
}

/** Restarts the loop after the service worker wakes, if a session was running. */
export async function resumeIfRecording(): Promise<void> {
  if ((await getRecording()).recording) startLoop();
}

function startLoop() {
  if (timer) return;
  timer = setInterval(tick, CAPTURE_INTERVAL_MS);
  tick();
}

// One beat: gather a payload per allowed source, send the ones that changed,
// and record progress for the popup.
async function tick() {
  if (inFlight) return; // previous send is still going, skip this beat
  inFlight = true;
  try {
    const frames = await requestFrames();
    if (!frames) {
      // The chooser window is gone, and with it every window and screen share.
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
      if (isUnchanged(key, payload, thumb)) continue;
      await uploadCapture(payload);
      rememberSent(key, payload, thumb);
      sent++;
    }

    const state = await getRecording();
    if (state.recording && sent > 0) {
      await patchRecording({ sent: state.sent + sent, lastSentAt: Date.now(), lastError: null });
    }
  } catch (err) {
    const code = reportError(err);
    if ((await getRecording()).recording) await patchRecording({ lastError: code });
  } finally {
    inFlight = false;
  }
}

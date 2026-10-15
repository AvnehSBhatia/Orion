// The recording session: opening the chooser window, the capture loop, and
// stopping. State that must outlive a service worker restart (on/off, counts,
// allowed tabs) lives in chrome.storage.session via ../recording; the user's
// pause, blocked sites, and the org policy live in chrome.storage.local via ../privacy.

import { isPaused } from '../lib/policy.ts';
import { isAllowedServerUrl } from '../lib/url.ts';
import { getLocal, patchLocal } from '../privacy';
import { getRecording, patchRecording } from '../recording';
import { getSettings } from '../settings';
import type { CapturePayload, ErrorCode } from '../types';
import { getConsentStatus } from './account';
import { refreshBadge } from './badge';
import { forgetSent, isUnchanged, rememberSent } from './changes';
import { CaptureError, reportError } from './errors';
import { POLICY_ALARM, POLICY_PERIOD_MIN, refreshPolicy } from './policy';
import { drain, enqueue, resetSender } from './sender';
import { requestFrames, tabPayload, windowPayload } from './sources';

const CHOOSER_WINDOW = { width: 680, height: 860 };
// Chrome can stop an idle service worker, which kills the interval timer. This
// alarm wakes the worker so the loop can resume. 30 seconds is Chrome's minimum.
export const WATCHDOG_ALARM = 'capture-watchdog';
const WATCHDOG_PERIOD_MIN = 0.5;

let timer: ReturnType<typeof setInterval> | undefined;
let timerMs = 0;
let inFlight = false;

/**
 * Checks everything that must hold before capturing: a user, an https
 * server, the org allowing capture, and the monitoring notice accepted.
 * Throws a CaptureError the popup explains.
 */
async function assertReady(): Promise<void> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');
  if (!isAllowedServerUrl(settings.backendUrl)) throw new CaptureError('insecure_url');
  if ((await getLocal()).attention === 'signed_out') throw new CaptureError('signed_out');
  const policy = await refreshPolicy();
  if (!policy.captureEnabled) throw new CaptureError('capture_disabled');
  if ((await getConsentStatus()).needed) throw new CaptureError('consent');
}

/**
 * Opens the chooser window, where the user picks what to share, or focuses it
 * if it is already open. Recording starts only when the user presses start in
 * that window (see beginRecording).
 */
export async function openChooser(): Promise<void> {
  const { captureWindowId, recording } = await getRecording();
  if (!recording) await assertReady();
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
  await assertReady();
  // Pressing start is an explicit resume.
  await patchLocal({ pausedUntil: null });
  resetSender();
  await patchRecording({ recording: true, sent: 0, lastSentAt: null, lastError: null, stopReason: null, queued: 0, retryAt: null });
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });
  await chrome.alarms.create(POLICY_ALARM, { periodInMinutes: POLICY_PERIOD_MIN });
  await refreshBadge();
  await startLoop();

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

/**
 * Stops everything: the loop, the queue, the chooser window (ending every
 * share), and the badge. reason is set when the stop was not the user's choice.
 */
export async function stopRecording(reason: ErrorCode | null = null): Promise<void> {
  clearInterval(timer);
  timer = undefined;
  timerMs = 0;
  forgetSent();
  resetSender();
  const { captureWindowId } = await getRecording();
  await patchRecording({ recording: false, captureWindowId: null, allowedTabIds: [], stopReason: reason, queued: 0, retryAt: null });
  if (captureWindowId !== null) await chrome.windows.remove(captureWindowId).catch(() => {});
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await chrome.alarms.clear(POLICY_ALARM);
  await refreshBadge();
}

/** Restarts the loop after the service worker wakes, if a session was running. */
export async function resumeIfRecording(): Promise<void> {
  if ((await getRecording()).recording) await startLoop();
}

/** The 5 minute policy alarm: refetch, then stop or retime the loop to match. */
export async function onPolicyAlarm(): Promise<void> {
  if (!(await getRecording()).recording) return;
  try {
    const policy = await refreshPolicy();
    if (!policy.captureEnabled) return stopRecording('capture_disabled');
    await startLoop(); // picks up a new captureIntervalSec
  } catch (err) {
    reportError(err);
  }
}

/** Starts the timer at the policy's interval, or retimes it if the interval changed. */
async function startLoop(): Promise<void> {
  const ms = (await getLocal()).policy.captureIntervalSec * 1000;
  if (timer && timerMs === ms) return;
  clearInterval(timer);
  timerMs = ms;
  timer = setInterval(tick, ms);
  tick();
}

// One beat: gather a payload per allowed source, queue the ones that changed,
// send what the server will take, and record progress for the popup.
async function tick() {
  if (inFlight) return; // previous beat is still going, skip this one
  inFlight = true;
  try {
    const local = await getLocal();
    await refreshBadge(); // a timed pause may have just ended
    // Paused: read nothing at all, not even the frames.
    if (isPaused(local.pausedUntil)) return;
    if (!local.policy.captureEnabled) return stopRecording('capture_disabled');

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

    for (const { key, payload, thumb } of captures) {
      if (isUnchanged(key, payload, thumb)) continue;
      enqueue(payload);
      rememberSent(key, payload, thumb);
    }

    const result = await drain();
    if (result.stopped) return;
    const state = await getRecording();
    if (!state.recording) return;
    await patchRecording({
      sent: state.sent + result.sent,
      lastSentAt: result.sent > 0 ? Date.now() : state.lastSentAt,
      lastError: result.lastError,
    });
  } catch (err) {
    const code = reportError(err);
    if (code === 'insecure_url') return stopRecording('insecure_url');
    if ((await getRecording()).recording) await patchRecording({ lastError: code });
  } finally {
    inFlight = false;
  }
}

// Turns each source the user allowed into a capture payload. Only sources the
// user picked in the chooser window reach this file; nothing else is read.
// Tabs on a site the org excludes or the user blocked are skipped before
// anything is read from them: no screenshot, no HTML.

import { blockReason, isPaused } from '../lib/policy.ts';
import { stripQueryAndFragment } from '../lib/url.ts';
import { getLocal } from '../privacy';
import { getSettings } from '../settings';
import type { CapturePayload, FrameRequest, Rect, ScreenFrame } from '../types';
import { CaptureError } from './errors';
import { fitScreenshot, stripDataUrlPrefix } from './images';

const SCREENSHOT_QUALITY = 70;
// Chrome allows two captureVisibleTab calls per second.
const CAPTURE_QUOTA_WAIT_MS = 600;

/**
 * One frame per shared window or screen, from the chooser window, which holds
 * the streams. Returns null when no chooser window is open to answer.
 */
export async function requestFrames(): Promise<ScreenFrame[] | null> {
  try {
    const frames = await chrome.runtime.sendMessage<FrameRequest, ScreenFrame[] | undefined>({
      type: 'grab-frames',
    });
    return frames ?? null;
  } catch {
    return null; // no chooser window listening
  }
}

// A shared app window or screen. There is no page to read, only the frame.
export async function windowPayload(frame: ScreenFrame): Promise<CapturePayload> {
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

/** Throws 'excluded' or 'restricted' when this tab must not be read at all, and 'paused' while paused. */
export async function assertCapturable(tab: chrome.tabs.Tab): Promise<void> {
  const { policy, blockedHosts, pausedUntil } = await getLocal();
  if (isPaused(pausedUntil)) throw new CaptureError('paused');
  const reason = blockReason(tab.url, policy, blockedHosts);
  if (reason === 'not_web') throw new CaptureError('restricted', tab.url);
  if (reason) throw new CaptureError('excluded', reason);
}

// An allowed Chrome tab. Chrome can only screenshot what is on screen, so the
// tab is captured only while it is the visible tab in a window that is not
// minimized. Returns null when it cannot or must not be captured right now.
export async function tabPayload(tabId: number): Promise<CapturePayload | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active) return null;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!win || win.state === 'minimized') return null;
  try {
    const payload = await buildTabPayload(tab);
    // The tab may have navigated while it was being read. Drop the capture if
    // it is now on another page, which may be one that must not be captured.
    const after = await chrome.tabs.get(tabId).catch(() => null);
    if (!after?.active || after.url !== tab.url) return null;
    return payload;
  } catch (err) {
    if (err instanceof CaptureError && ['restricted', 'excluded', 'paused'].includes(err.code)) return null;
    throw err;
  }
}

/**
 * A Chrome tab: screenshot plus cleaned HTML. Used for allowed tabs and for the
 * one off "Hide something" send, which brings its own screenshot with the
 * hidden areas already painted black.
 */
export async function buildTabPayload(
  tab: chrome.tabs.Tab,
  hidden?: { screenshotDataUrl: string; redactions: Rect[] },
): Promise<CapturePayload> {
  const settings = await getSettings();
  if (!settings.userId.trim()) throw new CaptureError('no_user');
  if (tab.id === undefined) throw new CaptureError('restricted');
  await assertCapturable(tab);

  const [screenshotDataUrl, html] = await Promise.all([
    hidden?.screenshotDataUrl ?? takeScreenshot(tab.windowId),
    readTabHtml(tab.id),
  ]);

  return {
    userId: settings.userId.trim(),
    url: stripQueryAndFragment(tab.url!),
    title: tab.title ?? '',
    html,
    screenshotB64: await fitScreenshot(stripDataUrlPrefix(screenshotDataUrl)),
    redactions: hidden?.redactions ?? [],
    source: 'tab',
  };
}

/** A JPEG data URL of the visible tab in a window. Callers check the tab with assertCapturable first. */
export async function takeScreenshot(windowId: number, retried = false): Promise<string> {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: SCREENSHOT_QUALITY });
  } catch (err) {
    // Wait out the per-second quota once.
    if (!retried && String(err).includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
      await new Promise((r) => setTimeout(r, CAPTURE_QUOTA_WAIT_MS));
      return takeScreenshot(windowId, true);
    }
    throw new CaptureError('restricted', String(err));
  }
}

// HTML is best effort. Some pages refuse script injection; the screenshot still goes.
// read-page.js defines __orionReadPage in the extension's isolated world, then a
// second injection calls it and returns the cleaned HTML.
async function readTabHtml(tabId: number): Promise<string> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['read-page.js'] });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as { __orionReadPage?: () => string }).__orionReadPage?.() ?? '',
    });
    return (injection?.result as string | undefined) ?? '';
  } catch (err) {
    console.info('[orion] could not read page html', err);
    return '';
  }
}

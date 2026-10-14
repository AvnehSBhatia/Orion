// Turns each source the user allowed into a capture payload. Only sources the
// user picked in the chooser window reach this file; nothing else is read.

import { getSettings } from '../settings';
import type { CapturePayload, FrameRequest, Rect, ScreenFrame } from '../types';
import { CaptureError } from './errors';
import { fitScreenshot, stripDataUrlPrefix } from './images';
import { readPage } from './read-page';

const SCREENSHOT_QUALITY = 70;
// Chrome allows two captureVisibleTab calls per second.
const CAPTURE_QUOTA_WAIT_MS = 600;

const isWebUrl = (url: string | undefined): url is string => !!url && /^https?:/.test(url);

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

// An allowed Chrome tab. Chrome can only screenshot what is on screen, so the
// tab is captured only while it is the visible tab in a window that is not
// minimized. Returns null when it cannot be captured right now.
export async function tabPayload(tabId: number): Promise<CapturePayload | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active || !isWebUrl(tab.url)) return null;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!win || win.state === 'minimized') return null;
  return buildTabPayload(tab).catch((err) => {
    if (err instanceof CaptureError && err.code === 'restricted') return null;
    throw err;
  });
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
  if (tab.id === undefined || !isWebUrl(tab.url)) {
    throw new CaptureError('restricted', tab.url);
  }

  const [screenshotDataUrl, html] = await Promise.all([
    hidden?.screenshotDataUrl ?? takeScreenshot(tab.windowId),
    readTabHtml(tab.id),
  ]);

  return {
    userId: settings.userId.trim(),
    url: tab.url,
    title: tab.title ?? '',
    html,
    screenshotB64: await fitScreenshot(stripDataUrlPrefix(screenshotDataUrl)),
    redactions: hidden?.redactions ?? [],
    source: 'tab',
  };
}

/** A JPEG data URL of the visible tab in a window. */
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
async function readTabHtml(tabId: number): Promise<string> {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return (injection?.result as string | undefined) ?? '';
  } catch (err) {
    console.info('[orion] could not read page html', err);
    return '';
  }
}

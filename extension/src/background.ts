// Service worker entry. While recording, every 5 seconds it sends one capture
// per source the user allowed: each shared app window or screen (frames come
// from the chooser window, capture.html, which holds the streams) and each
// ticked Chrome tab (screenshot plus HTML). Nothing outside those sources is
// read. The loop lives here rather than in a page so it keeps going after the
// popup closes.
//
//   background/recorder.ts  chooser window, capture loop, start and stop
//   background/sources.ts   builds a payload per window, screen, or tab
//   background/changes.ts   skips sources that have not changed
//   background/upload.ts    POST /api/ingest/capture
//
// Listeners are registered at the top level, as MV3 requires, so they survive
// the worker being stopped and restarted.

import { getRecording, patchRecording } from './recording';
import { CaptureError, reportError } from './background/errors';
import { WATCHDOG_ALARM, beginRecording, openChooser, resumeIfRecording, stopRecording } from './background/recorder';
import { buildTabPayload, takeScreenshot } from './background/sources';
import { uploadCapture } from './background/upload';
import type { BgRequest, BgResult } from './types';

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  handle(msg).then(
    (data) => sendResponse({ ok: true, data } satisfies BgResult<unknown>),
    (err) => sendResponse({ ok: false, code: reportError(err) } satisfies BgResult<unknown>),
  );
  return true; // keep the channel open for the async response
});

async function handle(msg: BgRequest): Promise<unknown> {
  switch (msg.type) {
    case 'start':
      return openChooser();
    case 'stop':
      return stopRecording();
    case 'sources-start':
      return beginRecording();
    case 'screenshot':
      return takeScreenshot(msg.windowId);
    case 'capture':
      return uploadCapture(await buildTabPayload(await chrome.tabs.get(msg.tabId), msg));
    default:
      // Usually a page built from newer code than this worker. Fail loudly so
      // the page can tell the user to reload the extension.
      throw new CaptureError('unknown', `unknown message ${(msg as { type: string }).type}`);
  }
}

// Pick the loop back up whenever the worker starts, and on each watchdog alarm.
resumeIfRecording();
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) resumeIfRecording();
});

// Closing the chooser window ends every window and screen share, so stop.
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

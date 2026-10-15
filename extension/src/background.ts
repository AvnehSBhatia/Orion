// Service worker entry. While recording, on the org's interval (5 seconds by
// default) it sends one capture per source the user allowed: each shared app
// window or screen (frames come from the chooser window, capture.html, which
// holds the streams) and each ticked Chrome tab (screenshot plus HTML).
// Nothing outside those sources is read, and nothing at all while paused.
//
//   background/recorder.ts  chooser window, capture loop, start and stop
//   background/sources.ts   builds a payload per window, screen, or tab
//   background/changes.ts   skips sources that have not changed
//   background/sender.ts    upload queue with backoff
//   background/upload.ts    POST /api/ingest/capture and what each answer means
//   background/policy.ts    GET /api/capture/policy
//   background/account.ts   sign-in state and the monitoring notice
//   background/badge.ts     toolbar icon and badge
//
// Listeners are registered at the top level, as MV3 requires, so they survive
// the worker being stopped and restarted.

import { getRecording, patchRecording } from './recording';
import { acceptConsent, getConsentStatus, handleSignedIn } from './background/account';
import { refreshBadge } from './background/badge';
import { CaptureError, reportError } from './background/errors';
import { POLICY_ALARM, refreshPolicy } from './background/policy';
import {
  WATCHDOG_ALARM,
  beginRecording,
  onPolicyAlarm,
  openChooser,
  resumeIfRecording,
  stopRecording,
} from './background/recorder';
import { assertCapturable, buildTabPayload, takeScreenshot } from './background/sources';
import { uploadCapture } from './background/upload';
import type { BgRequest, BgResult } from './types';

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  // The chooser's frame requests are answered by the chooser itself.
  if ((msg as { type: string }).type === 'grab-frames') return false;
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
    case 'screenshot': {
      const tab = await chrome.tabs.get(msg.tabId);
      await assertCapturable(tab);
      // "Hide something" sends a capture too, so the notice comes first here as well.
      if ((await getConsentStatus()).needed) throw new CaptureError('consent');
      return takeScreenshot(tab.windowId);
    }
    case 'capture':
      return uploadCapture(await buildTabPayload(await chrome.tabs.get(msg.tabId), msg));
    case 'consent-status':
      return getConsentStatus();
    case 'accept-consent':
      await acceptConsent(msg.version);
      return refreshBadge();
    case 'refresh-policy':
      return refreshPolicy();
    case 'signed-in':
      await handleSignedIn();
      await patchRecording({ stopReason: null });
      return refreshBadge();
    default:
      // Usually a page built from newer code than this worker. Fail loudly so
      // the page can tell the user to reload the extension.
      throw new CaptureError('unknown', `unknown message ${(msg as { type: string }).type}`);
  }
}

// Pick the loop back up whenever the worker starts, and on each watchdog alarm.
resumeIfRecording();
refreshBadge();
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) resumeIfRecording();
  if (alarm.name === POLICY_ALARM) onPolicyAlarm();
});

// Keep the badge in step with pause and sign-in changes made from the popup or options page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.privacy) refreshBadge();
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

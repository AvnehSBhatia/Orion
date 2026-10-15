// Shapes shared with the Orion server (see server/src/contract/types.ts and
// docs/api-additions.md) and between the popup, the chooser window, and the service worker.

export type Rect = { x: number; y: number; w: number; h: number };

// What the user allowed this capture to come from.
// 'tab': a Chrome tab they ticked. url, title, and html are that tab's.
// 'window': an app window they picked. html is empty.
// 'screen': a whole screen they picked. html is empty.
export type SourceKind = 'tab' | 'window' | 'screen';

export type CapturePayload = {
  userId: string;
  url: string; // query string and fragment already removed
  title: string;
  html: string; // empty when the page cannot be read or the source is not a tab
  screenshotB64: string;
  redactions?: Rect[];
  source?: SourceKind;
};

// A frame from one shared window or screen, plus a tiny grayscale copy used to
// tell whether it changed enough to be worth sending.
export type ScreenFrame = {
  sourceId: string;
  kind: 'window' | 'screen';
  label: string; // "Window 2", "Entire screen"
  dataUrl: string;
  thumb: number[];
};

export type CaptureResponse = { nodesTouched: string[] };

// orgId: which org's map captures land in. Empty means the backend's default org.
// token: an API token from Orion sign-in, sent as `Authorization: Bearer`.
// tokenId: that token's id, so sign-out can revoke it on the server.
export type Settings = { userId: string; backendUrl: string; orgId: string; token: string; tokenId: string };

export type ErrorCode =
  | 'no_user'
  | 'restricted' // chrome:// and other pages Chrome will not let it read
  | 'excluded' // the org or the user said never to capture this site
  | 'paused' // the user paused capture from the popup
  | 'timeout'
  | 'backend'
  | 'retrying' // server busy or unreachable; captures are queued and retried with backoff
  | 'signed_out' // 401: the token was revoked or expired
  | 'consent' // 403 "consent required": the monitoring notice must be accepted
  | 'paused_by_org' // 403 "capture paused"
  | 'capture_disabled' // policy captureEnabled: false
  | 'forbidden' // any other 403
  | 'budget' // 402
  | 'insecure_url' // the server URL is not https (localhost excepted)
  | 'no_permission' // the user declined Chrome's site access prompt
  | 'unknown';

// Lives in chrome.storage.session, so it survives service worker restarts but
// recording stops when the browser closes.
export type RecordingState = {
  recording: boolean;
  sent: number;
  lastSentAt: number | null;
  lastError: ErrorCode | null;
  stopReason: ErrorCode | null; // why the last session ended, when it was not the user's choice
  queued: number; // captures waiting for the server
  retryAt: number | null; // when the next upload attempt is due, while backing off
  captureWindowId: number | null; // the chooser window, where the user picks what to share
  allowedTabIds: number[]; // Chrome tabs the user ticked
};

/** The org's monitoring notice, from GET /api/auth/me. */
export type ConsentStatus = {
  needed: boolean;
  version: number;
  notice: string;
};

// Messages to the service worker. Every one is answered with a BgResult.
export type BgRequest =
  | { type: 'start' } // open the chooser window, or focus it if open
  | { type: 'sources-start' } // the user picked sources and pressed start
  | { type: 'stop' }
  | { type: 'screenshot'; tabId: number }
  | { type: 'consent-status' }
  | { type: 'accept-consent'; version: number }
  | { type: 'refresh-policy' }
  | { type: 'signed-in' } // the options page stored a new token
  | {
      // One off send from the "Hide something" flow, with black boxes already painted.
      type: 'capture';
      tabId: number;
      screenshotDataUrl: string;
      redactions: Rect[];
    };

export type BgResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode };

// The service worker asks the chooser window for one frame per shared window
// or screen. Answered with ScreenFrame[].
export type FrameRequest = { type: 'grab-frames' };

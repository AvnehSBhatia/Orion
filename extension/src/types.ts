// Shapes shared with the Orion server (see server/src/contract/types.ts) and
// between the popup, the chooser window, and the service worker.

export type Rect = { x: number; y: number; w: number; h: number };

// What the user allowed this capture to come from.
// 'tab': a Chrome tab they ticked. url, title, and html are that tab's.
// 'window': an app window they picked. html is empty.
// 'screen': a whole screen they picked. html is empty.
export type SourceKind = 'tab' | 'window' | 'screen';

export type CapturePayload = {
  userId: string;
  url: string;
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
// token: a session or API token from Orion sign-in, sent as `Authorization: Bearer`.
export type Settings = { userId: string; backendUrl: string; orgId: string; token: string };

export type ErrorCode = 'no_user' | 'restricted' | 'timeout' | 'backend' | 'unknown';

// Lives in chrome.storage.session, so it survives service worker restarts but
// recording stops when the browser closes.
export type RecordingState = {
  recording: boolean;
  sent: number;
  lastSentAt: number | null;
  lastError: ErrorCode | null;
  captureWindowId: number | null; // the chooser window, where the user picks what to share
  allowedTabIds: number[]; // Chrome tabs the user ticked
};

// Messages to the service worker. Every one is answered with a BgResult.
export type BgRequest =
  | { type: 'start' } // open the chooser window, or focus it if open
  | { type: 'sources-start' } // the user picked sources and pressed start
  | { type: 'stop' }
  | { type: 'screenshot'; windowId: number }
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

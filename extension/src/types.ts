// Shapes shared with the backend (spec section 1.3) and between popup, capture
// window, and service worker.

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

export type Settings = { userId: string; backendUrl: string };

export type ErrorCode = 'no_user' | 'restricted' | 'timeout' | 'backend' | 'unknown';

// Lives in chrome.storage.session, so it survives service worker restarts but
// recording stops when the browser closes.
export type RecordingState = {
  recording: boolean;
  sent: number;
  lastSentAt: number | null;
  lastError: ErrorCode | null;
  captureWindowId: number | null; // the window where the user picks what to share
  allowedTabIds: number[]; // Chrome tabs the user ticked
};

export type BgRequest =
  | { type: 'start' } // open the capture window
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

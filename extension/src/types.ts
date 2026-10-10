// Shapes shared with the backend (spec section 1.3) and between popup and service worker.

export type Rect = { x: number; y: number; w: number; h: number };

export type CapturePayload = {
  userId: string;
  url: string;
  title: string;
  html: string; // empty when the page cannot be read or another app is in front
  screenshotB64: string;
  redactions?: Rect[];
  // 'browser': Chrome was in front, url/title/html are that tab's.
  // 'desktop': another app was in front, the screenshot is all there is.
  source?: 'browser' | 'desktop';
};

// A frame from the screen share, plus a tiny grayscale copy used to tell
// whether the screen changed enough to be worth sending.
export type ScreenFrame = { dataUrl: string; thumb: number[] };

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
  captureWindowId: number | null; // the small window holding the screen share
};

export type BgRequest =
  | { type: 'start' }
  | { type: 'stop' }
  // From the capture window: the screen share started, or it ended.
  | { type: 'screen-ready' }
  | { type: 'screen-ended' }
  | { type: 'screenshot'; windowId: number }
  | {
      // One off send from the "Hide something" flow, with black boxes already painted.
      type: 'capture';
      tabId: number;
      screenshotDataUrl: string;
      redactions: Rect[];
    };

export type BgResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode };

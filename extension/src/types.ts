// Shapes shared with the backend (spec section 1.3) and between popup and service worker.

export type Rect = { x: number; y: number; w: number; h: number };

export type CapturePayload = {
  userId: string;
  url: string;
  title: string;
  html: string; // empty when the page cannot be read
  screenshotB64: string;
  redactions?: Rect[];
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
};

export type BgRequest =
  | { type: 'start' }
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

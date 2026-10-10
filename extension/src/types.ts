// Shapes shared with the backend (spec section 1.3) and between popup and service worker.

export type Rect = { x: number; y: number; w: number; h: number };

export type CapturePayload = {
  orgId: string;
  userId: string;
  url: string;
  title: string;
  html: string; // empty when the page cannot be read
  screenshotB64: string;
  redactions?: Rect[];
};

export type CaptureResponse = {
  nodesTouched: string[];
  sourceId?: string | null;
  imageStatus?: 'none' | 'text_only' | 'kept' | 'pruned';
  duplicateOf?: string; // the backend already had this exact page from you and stored nothing new
  notWork?: true; // the backend found no work on the page and stored nothing
};

export type Settings = {
  orgId: string;
  orgName: string;
  userId: string; // assigned by the backend when you join
  name: string;
  role: string; // one sentence, in your words
  backendUrl: string;
};

export type ErrorCode = 'no_user' | 'unknown_user' | 'restricted' | 'timeout' | 'backend' | 'unknown';

// Lives in chrome.storage.session, so it survives service worker restarts but
// recording stops when the browser closes.
export type RecordingState = {
  recording: boolean;
  sent: number;
  shared: number; // captures the backend kept: new work, not repeats or pages with no work on them
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

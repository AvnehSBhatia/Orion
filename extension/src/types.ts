// Shapes shared with the backend (spec section 1.3) and between popup and service worker.

export type Rect = { x: number; y: number; w: number; h: number };

export type CapturePayload = {
  userId: string;
  url: string;
  title: string;
  html: string;
  screenshotB64: string;
  redactions?: Rect[];
};

export type CaptureResponse = { nodesTouched: string[] };

export type Settings = { userId: string; backendUrl: string };

export type BgRequest =
  | { type: 'screenshot'; windowId: number }
  | {
      type: 'capture';
      tabId: number;
      windowId: number;
      // Set by the "Hide something" flow: an already blacked out screenshot.
      screenshotDataUrl?: string;
      redactions?: Rect[];
    };

export type ErrorCode = 'no_user' | 'restricted' | 'timeout' | 'backend' | 'unknown';

export type BgResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode };

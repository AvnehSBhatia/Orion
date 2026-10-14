// Change detection. A source that looks the same as the last time it was sent
// is skipped, so the server does not reprocess an idle window every 5 seconds.

import type { CapturePayload } from '../types';

// A thumbnail pixel counts as changed past this grayscale delta, and a window
// or screen counts as changed past this share of pixels. Tuned so the cursor
// and the menu bar clock alone do not trigger a send.
const PIXEL_DELTA = 24;
const CHANGED_FRACTION = 0.002;

type Sent = { url: string; html: string; screenshotB64?: string; thumb?: number[] };

// Keyed by source: the chooser's stream id for windows and screens, `tab:<id>` for tabs.
const lastSent = new Map<string, Sent>();

/**
 * Windows and screens (which come with a thumbnail) are compared by thumbnail,
 * since their JPEG bytes change with every frame. Tabs are compared by URL,
 * HTML, and exact screenshot.
 */
export function isUnchanged(key: string, payload: CapturePayload, thumb?: number[]): boolean {
  const prev = lastSent.get(key);
  if (!prev || prev.url !== payload.url || prev.html !== payload.html) return false;
  return thumb ? !thumbChanged(prev.thumb ?? null, thumb) : prev.screenshotB64 === payload.screenshotB64;
}

export function rememberSent(key: string, payload: CapturePayload, thumb?: number[]): void {
  lastSent.set(key, {
    url: payload.url,
    html: payload.html,
    thumb,
    screenshotB64: thumb ? undefined : payload.screenshotB64,
  });
}

export function forgetSent(): void {
  lastSent.clear();
}

function thumbChanged(before: number[] | null, after: number[]): boolean {
  if (!before || before.length !== after.length) return true;
  let changed = 0;
  for (let i = 0; i < after.length; i++) {
    if (Math.abs(before[i] - after[i]) > PIXEL_DELTA) changed++;
  }
  return changed / after.length > CHANGED_FRACTION;
}

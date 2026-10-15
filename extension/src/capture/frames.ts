// Turns a live window or screen stream into one JPEG frame plus a tiny
// grayscale thumbnail. The service worker compares thumbnails between beats to
// decide whether the source changed enough to send again.

import type { ScreenFrame } from '../types';

const JPEG_QUALITY = 0.7;
const THUMB_W = 160;
const THUMB_H = 90;
const GRAB_TIMEOUT_MS = 2_000; // a minimized window may never produce a frame

// Chrome ships ImageCapture, but TypeScript's DOM types do not include it.
declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
}

export type SharedSource = {
  id: string;
  kind: 'window' | 'screen';
  label: string; // "Window 2", "Screen 1"
  stream: MediaStream;
  track: MediaStreamTrack;
};

/** One frame per source. Sources that are ended or produce no frame in time are left out. */
export async function grabAll(sources: Iterable<SharedSource>): Promise<ScreenFrame[]> {
  const frames = await Promise.all([...sources].map((s) => grabFrame(s).catch(() => null)));
  return frames.filter((f): f is ScreenFrame => f !== null);
}

async function grabFrame(s: SharedSource): Promise<ScreenFrame | null> {
  if (s.track.readyState !== 'live') return null;
  const bitmap = await Promise.race([
    new ImageCapture(s.track).grabFrame(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no frame')), GRAB_TIMEOUT_MS)),
  ]);

  const full = new OffscreenCanvas(bitmap.width, bitmap.height);
  full.getContext('2d')!.drawImage(bitmap, 0, 0);
  const blob = await full.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });

  const small = new OffscreenCanvas(THUMB_W, THUMB_H);
  const ctx = small.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, THUMB_W, THUMB_H);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, THUMB_W, THUMB_H);
  const thumb = new Array<number>(THUMB_W * THUMB_H);
  for (let i = 0; i < thumb.length; i++) {
    // Rec. 601 luma from RGBA.
    thumb[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000 | 0;
  }

  return { sourceId: s.id, kind: s.kind, label: s.label, dataUrl: await blobToDataUrl(blob), thumb };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

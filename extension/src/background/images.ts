import { CaptureError } from './errors';

// The server rejects screenshots over this many base64 chars.
const MAX_SCREENSHOT_B64 = 2_000_000;
// Fallback re-encodes, tried in order, for screenshots over the size limit.
const SHRINK_STEPS: [scale: number, quality: number][] = [
  [0.75, 0.6],
  [0.5, 0.6],
  [0.35, 0.5],
];

export function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

// High DPI screens can produce screenshots over the server limit. Shrink until it fits.
export async function fitScreenshot(b64: string): Promise<string> {
  if (b64.length <= MAX_SCREENSHOT_B64) return b64;

  const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
  const bitmap = await createImageBitmap(blob);
  for (const [scale, quality] of SHRINK_STEPS) {
    const canvas = new OffscreenCanvas(
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    );
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await blobToBase64(await canvas.convertToBlob({ type: 'image/jpeg', quality }));
    if (out.length <= MAX_SCREENSHOT_B64) return out;
  }
  throw new CaptureError('unknown', 'screenshot too large after shrinking');
}

// Chunked, because String.fromCharCode(...bytes) overflows the call stack on
// a multi-megabyte array.
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

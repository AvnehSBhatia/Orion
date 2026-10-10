// Runs in the small "sharing your screen" window. Holds the screen share and
// hands the service worker a frame whenever it asks. The service worker owns
// the 5 second timer, because timers in a minimized window get throttled.

import type { BgRequest, ScreenFrame } from './types';

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const JPEG_QUALITY = 0.7;
const THUMB_W = 160;
const THUMB_H = 90;

// Chrome ships ImageCapture, but TypeScript's DOM types do not include it.
declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
}

const statusEl = document.getElementById('status')!;
const stopBtn = document.getElementById('stop')!;
let track: MediaStreamTrack | null = null;

function tell(msg: BgRequest) {
  return chrome.runtime.sendMessage(msg).catch(() => {});
}

chrome.desktopCapture.chooseDesktopMedia(['screen'], async (streamId) => {
  if (!streamId) {
    // Picker was cancelled.
    await tell({ type: 'screen-ended' });
    return window.close();
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId,
          maxWidth: MAX_WIDTH,
          maxHeight: MAX_HEIGHT,
        },
      },
    } as unknown as MediaStreamConstraints);
    track = stream.getVideoTracks()[0];
    // Fires when the user clicks "Stop sharing" in Chrome's bar.
    track.addEventListener('ended', () => tell({ type: 'screen-ended' }));
    statusEl.textContent = 'Sharing your screen every 5 seconds. Keep this window open. You can minimize it.';
    await tell({ type: 'screen-ready' });
  } catch (err) {
    console.error('[constellation]', err);
    statusEl.textContent = 'Could not start screen sharing.';
    await tell({ type: 'screen-ended' });
  }
});

chrome.runtime.onMessage.addListener((msg: { type: string }, _sender, sendResponse) => {
  if (msg.type !== 'grab-frame') return;
  grabFrame().then(sendResponse, (err) => {
    console.error('[constellation]', err);
    sendResponse(null);
  });
  return true; // keep the channel open for the async response
});

stopBtn.addEventListener('click', () => tell({ type: 'stop' }));

async function grabFrame(): Promise<ScreenFrame | null> {
  if (!track || track.readyState !== 'live') return null;
  const bitmap = await new ImageCapture(track).grabFrame();

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
    thumb[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000 | 0;
  }

  return { dataUrl: await blobToDataUrl(blob), thumb };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

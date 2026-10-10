// The window where the user picks what Constellation may see: any number of
// app windows or screens (through Chrome's picker, one pick at a time) and any
// Chrome tabs they tick. It holds the window and screen streams and hands the
// service worker one frame from each when asked. The service worker owns the
// 5 second timer, because timers in a minimized window get throttled.

import { getRecording, onRecordingChange, patchRecording } from './recording';
import type { BgRequest, BgResult, RecordingState, ScreenFrame } from './types';

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const JPEG_QUALITY = 0.7;
const THUMB_W = 160;
const THUMB_H = 90;
const GRAB_TIMEOUT_MS = 2_000; // a minimized window may never produce a frame

// Chrome ships ImageCapture, but TypeScript's DOM types do not include it.
declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
}

type Shared = {
  id: string;
  kind: 'window' | 'screen';
  label: string;
  stream: MediaStream;
  track: MediaStreamTrack;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const addBtn = $<HTMLButtonElement>('add');
const sharedList = $('shared');
const tabList = $('tabs');
const toggleBtn = $<HTMLButtonElement>('toggle');
const statusEl = $('status');

const shared = new Map<string, Shared>();
const counts = { window: 0, screen: 0 };
let nextId = 1;
let state: RecordingState | null = null;

// Windows and screens

addBtn.addEventListener('click', () => {
  chrome.desktopCapture.chooseDesktopMedia(['window', 'screen'], async (streamId) => {
    if (!streamId) return; // picker cancelled
    try {
      await addShared(streamId);
    } catch (err) {
      console.error('[constellation]', err);
      setStatus('Could not share that. Try again.');
    }
  });
});

async function addShared(streamId: string) {
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
  const track = stream.getVideoTracks()[0];
  const kind = surfaceKind(track);
  const id = `src-${nextId++}`;
  const label = `${kind === 'screen' ? 'Screen' : 'Window'} ${++counts[kind]}`;
  shared.set(id, { id, kind, label, stream, track });
  // Fires when the shared window closes or the user clicks "Stop sharing".
  track.addEventListener('ended', () => removeShared(id));
  renderShared();
}

function surfaceKind(track: MediaStreamTrack): 'window' | 'screen' {
  const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
  if (surface === 'monitor') return 'screen';
  if (surface === 'window') return 'window';
  return track.label.startsWith('screen') ? 'screen' : 'window';
}

function removeShared(id: string) {
  const s = shared.get(id);
  if (!s) return;
  s.stream.getTracks().forEach((t) => t.stop());
  shared.delete(id);
  renderShared();
}

function renderShared() {
  sharedList.replaceChildren(
    ...[...shared.values()].map((s) => {
      const row = document.createElement('div');
      row.className = 'item';
      const video = document.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = s.stream;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.label;
      const remove = document.createElement('button');
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => removeShared(s.id));
      row.append(video, name, remove);
      return row;
    }),
  );
  if (shared.size === 0) sharedList.append(emptyNote('None yet.'));
  renderControls();
}

// Chrome tabs

async function renderTabs() {
  const [tabs, current] = await Promise.all([chrome.tabs.query({}), getRecording()]);
  const allowed = new Set(current.allowedTabIds);
  const rows = tabs
    .filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ''))
    .map((t) => {
      const row = document.createElement('label');
      row.className = 'item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = allowed.has(t.id!);
      box.addEventListener('change', () => setTabAllowed(t.id!, box.checked));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.title || t.url!;
      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = new URL(t.url!).hostname;
      row.append(box, name, host);
      return row;
    });
  tabList.replaceChildren(...rows);
  if (rows.length === 0) tabList.append(emptyNote('No open web pages.'));
}

async function setTabAllowed(tabId: number, allowed: boolean) {
  const { allowedTabIds } = await getRecording();
  const next = allowedTabIds.filter((id) => id !== tabId);
  if (allowed) next.push(tabId);
  await patchRecording({ allowedTabIds: next });
}

chrome.tabs.onCreated.addListener(() => renderTabs());
chrome.tabs.onRemoved.addListener(() => renderTabs());
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.title || change.url) renderTabs();
});

// Start and stop

function sourceCount() {
  return shared.size + (state?.allowedTabIds.length ?? 0);
}

function renderControls() {
  const n = sourceCount();
  const recording = state?.recording ?? false;
  toggleBtn.textContent = recording ? 'Stop capturing' : 'Start capturing';
  toggleBtn.classList.toggle('stop', recording);
  toggleBtn.disabled = !recording && n === 0;
  if (recording) {
    setStatus(
      n === 0
        ? 'Nothing selected, so nothing is being sent.'
        : `Capturing ${n} ${n === 1 ? 'source' : 'sources'} every 5 seconds. You can minimize this window.`,
    );
  } else {
    setStatus(n === 0 ? 'Pick at least one window, screen, or tab.' : 'Press start when you are done choosing.');
  }
}

function setStatus(message: string) {
  statusEl.textContent = message;
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  const res = (await chrome.runtime
    .sendMessage<BgRequest, BgResult<unknown>>({ type: state?.recording ? 'stop' : 'sources-start' })
    .catch(() => undefined)) as BgResult<unknown> | undefined;
  toggleBtn.disabled = false;
  if (!res?.ok) setStatus('Could not start. Reload Constellation in chrome://extensions, then try again.');
});

function emptyNote(text: string) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

onRecordingChange((next) => {
  const tabsChanged = next.allowedTabIds.join() !== state?.allowedTabIds.join();
  state = next;
  if (tabsChanged) renderTabs();
  renderControls();
});

getRecording().then((s) => {
  state = s;
  renderShared();
  renderTabs();
});

// Frames for the service worker

chrome.runtime.onMessage.addListener((msg: { type: string }, _sender, sendResponse) => {
  if (msg.type !== 'grab-frames') return;
  grabAll().then(sendResponse, (err) => {
    console.error('[constellation]', err);
    sendResponse([]);
  });
  return true; // keep the channel open for the async response
});

async function grabAll(): Promise<ScreenFrame[]> {
  const frames = await Promise.all([...shared.values()].map((s) => grabFrame(s).catch(() => null)));
  return frames.filter((f): f is ScreenFrame => f !== null);
}

async function grabFrame(s: Shared): Promise<ScreenFrame | null> {
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

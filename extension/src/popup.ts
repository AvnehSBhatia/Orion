import { getRecording, onRecordingChange } from './recording';
import { getSettings, saveSettings } from './settings';
import type { BgRequest, BgResult, ErrorCode, Rect, RecordingState } from './types';

const POPUP_TIMEOUT_MS = 20_000;
const MIN_RECT_PX = 4;

const ERROR_COPY: Record<ErrorCode, string> = {
  no_user: 'Add your user id in settings first.',
  restricted: 'This page cannot be captured.',
  timeout: 'That took too long. Try again.',
  backend: 'Could not reach Orion. Try again.',
  unknown: 'Could not capture. Try again.',
};

// Shown under the button while recording, based on how the last attempt went.
const RECORDING_ERROR_COPY: Record<ErrorCode, string> = {
  no_user: 'Add your user id in settings.',
  restricted: 'Skipping this page. It cannot be captured.',
  timeout: 'Orion is slow to answer. Still trying.',
  backend: 'Could not reach Orion. Still trying.',
  unknown: 'Last capture failed. Still trying.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggleBtn = $<HTMLButtonElement>('toggle');
const statusEl = $('status');
const hideLink = $('hide');
const settingsLink = $('settings');
const canvas = $<HTMLCanvasElement>('shot');
const sendHiddenBtn = $<HTMLButtonElement>('send-hidden');
const undoBtn = $<HTMLButtonElement>('undo');
const cancelBtn = $<HTMLButtonElement>('cancel');
const setupForm = $<HTMLFormElement>('setup');
const userIdInput = $<HTMLInputElement>('user-id');
const changeLink = $('change');

function setStatus(message: string, tone: 'muted' | 'ok' | 'error' = 'muted') {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send<T>(req: BgRequest): Promise<BgResult<T>> {
  const timeout = new Promise<BgResult<T>>((resolve) =>
    setTimeout(() => resolve({ ok: false, code: 'timeout' }), POPUP_TIMEOUT_MS),
  );
  const call = chrome.runtime
    .sendMessage<BgRequest, BgResult<T>>(req)
    .catch((): BgResult<T> => ({ ok: false, code: 'unknown' }));
  return Promise.race([call, timeout]);
}

// Start and stop. The service worker owns the loop and writes its progress to
// session storage, which this popup renders.

let recording = false;

function render(state: RecordingState) {
  const wasRecording = recording;
  recording = state.recording;
  document.body.classList.toggle('recording', recording);
  toggleBtn.textContent = recording ? 'Stop capturing' : 'Start capturing';

  if (!recording) {
    if (wasRecording) setStatus('Stopped. Nothing is being sent.');
    return;
  }
  if (state.lastError) return setStatus(RECORDING_ERROR_COPY[state.lastError], 'error');
  setStatus('Capturing what you shared every 5 seconds.', 'ok');
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  const starting = !recording;
  const res = await send<void>({ type: recording ? 'stop' : 'start' });
  toggleBtn.disabled = false;
  if (res.ok) {
    if (starting) setStatus('Choose what to share in the window that opened.');
    return;
  }
  if (res.code === 'no_user') return showSetup();
  setStatus(ERROR_COPY[res.code], 'error');
});

// First run: ask for the user id right in the popup instead of sending
// people to the options page.

function showSetup() {
  document.body.classList.add('setup');
  setStatus('Add your user id once, then start capturing.');
  userIdInput.focus();
}

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = userIdInput.value.trim();
  if (!userId) return;
  await saveSettings({ ...(await getSettings()), userId });
  document.body.classList.remove('setup');
  setStatus('Saved. You can start capturing now.');
});

// "Hide something": a one off send while not recording. Show the screenshot,
// let the user drag black boxes over it, then send that painted screenshot.

const ctx = canvas.getContext('2d')!;
let shot: HTMLImageElement | null = null;
let rects: Rect[] = [];
let dragStart: { x: number; y: number } | null = null;

async function startHide() {
  const tab = await activeTab();
  if (!tab) return;
  const res = await send<string>({ type: 'screenshot', windowId: tab.windowId });
  if (!res.ok) return setStatus(ERROR_COPY[res.code], 'error');

  const img = new Image();
  img.src = res.data;
  await img.decode();
  shot = img;
  rects = [];
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  draw();
  document.body.classList.add('hiding');
  setStatus('Drag over anything you want blacked out.');
}

function stopHide() {
  document.body.classList.remove('hiding');
  shot = null;
  rects = [];
}

async function sendHidden() {
  const tab = await activeTab();
  if (tab?.id === undefined) return setStatus(ERROR_COPY.restricted, 'error');
  draw(); // make sure no drag preview is baked in
  sendHiddenBtn.disabled = true;
  setStatus('Sending...');
  const res = await send<unknown>({
    type: 'capture',
    tabId: tab.id,
    screenshotDataUrl: canvas.toDataURL('image/jpeg', 0.7),
    redactions: rects,
  });
  sendHiddenBtn.disabled = false;
  if (!res.ok) {
    if (res.code !== 'no_user') return setStatus(ERROR_COPY[res.code], 'error');
    stopHide();
    return showSetup();
  }
  stopHide();
  setStatus('Sent with hidden areas.', 'ok');
}

function draw(preview?: Rect) {
  if (!shot) return;
  ctx.drawImage(shot, 0, 0);
  ctx.fillStyle = '#000';
  for (const r of preview ? [...rects, preview] : rects) ctx.fillRect(r.x, r.y, r.w, r.h);
  undoBtn.disabled = rects.length === 0;
}

// Convert a pointer position from CSS pixels to screenshot pixels.
function toShotPx(e: PointerEvent) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - box.left) / box.width) * canvas.width,
    y: ((e.clientY - box.top) / box.height) * canvas.height,
  };
}

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const x1 = clamp(Math.min(a.x, b.x), canvas.width);
  const y1 = clamp(Math.min(a.y, b.y), canvas.height);
  const x2 = clamp(Math.max(a.x, b.x), canvas.width);
  const y2 = clamp(Math.max(a.y, b.y), canvas.height);
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  dragStart = toShotPx(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (dragStart) draw(rectFrom(dragStart, toShotPx(e)));
});
canvas.addEventListener('pointerup', (e) => {
  if (!dragStart) return;
  const r = rectFrom(dragStart, toShotPx(e));
  dragStart = null;
  if (r.w >= MIN_RECT_PX && r.h >= MIN_RECT_PX) rects.push(r);
  draw();
});

hideLink.addEventListener('click', (e) => {
  e.preventDefault();
  startHide();
});
// 'start' while recording brings the minimized chooser window back.
changeLink.addEventListener('click', (e) => {
  e.preventDefault();
  send<void>({ type: 'start' });
});
settingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
undoBtn.addEventListener('click', () => {
  rects.pop();
  draw();
});
cancelBtn.addEventListener('click', () => {
  stopHide();
  setStatus('');
});
sendHiddenBtn.addEventListener('click', sendHidden);

onRecordingChange(render);
getRecording().then(render);
getSettings().then((s) => {
  if (!s.userId.trim()) showSetup();
});

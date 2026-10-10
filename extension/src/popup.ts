import { getSettings, saveSettings } from './settings';
import type { BgRequest, BgResult, CaptureResponse, ErrorCode, Rect } from './types';

const POPUP_TIMEOUT_MS = 20_000;
const CLOSE_DELAY_MS = 1_500;
const MIN_RECT_PX = 4;

const ERROR_COPY: Record<ErrorCode, string> = {
  no_user: 'Add your user id in settings first.',
  restricted: 'This page cannot be captured.',
  timeout: 'That took too long. Try again.',
  backend: 'Could not capture. Try again.',
  unknown: 'Could not capture. Try again.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const captureBtn = $<HTMLButtonElement>('capture');
const statusEl = $('status');
const hideLink = $('hide');
const settingsLink = $('settings');
const canvas = $<HTMLCanvasElement>('shot');
const sendHiddenBtn = $<HTMLButtonElement>('send-hidden');
const undoBtn = $<HTMLButtonElement>('undo');
const cancelBtn = $<HTMLButtonElement>('cancel');
const setupForm = $<HTMLFormElement>('setup');
const userIdInput = $<HTMLInputElement>('user-id');

type State = 'idle' | 'capturing' | 'done' | 'error';

function setState(state: State, message = '') {
  document.body.dataset.state = state;
  captureBtn.disabled = state === 'capturing' || state === 'done';
  sendHiddenBtn.disabled = captureBtn.disabled;
  captureBtn.textContent = state === 'capturing' ? 'Capturing...' : 'Capture this page';
  statusEl.textContent = message;
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

async function runCapture(hidden?: { screenshotDataUrl: string; redactions: Rect[] }) {
  setState('capturing');
  const tab = await activeTab();
  if (tab?.id === undefined) return setState('error', ERROR_COPY.restricted);

  const res = await send<CaptureResponse>({
    type: 'capture',
    tabId: tab.id,
    windowId: tab.windowId,
    ...hidden,
  });
  if (!res.ok) {
    if (res.code === 'no_user') return showSetup();
    return setState('error', ERROR_COPY[res.code]);
  }

  const n = res.data.nodesTouched.length;
  setState('done', `Captured. Updated ${n} ${n === 1 ? 'item' : 'items'}.`);
  setTimeout(() => window.close(), CLOSE_DELAY_MS);
}

// First run: ask for the user id right in the popup instead of sending
// people to the options page.

function showSetup() {
  document.body.classList.add('setup');
  setState('idle', 'Add your user id once, then capture.');
  userIdInput.focus();
}

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = userIdInput.value.trim();
  if (!userId) return;
  await saveSettings({ ...(await getSettings()), userId });
  document.body.classList.remove('setup');
  setState('idle', 'Saved. You can capture now.');
});

// "Hide something": show the screenshot, let the user drag black boxes over it,
// then send that painted screenshot instead of taking a fresh one.

const ctx = canvas.getContext('2d')!;
let shot: HTMLImageElement | null = null;
let rects: Rect[] = [];
let dragStart: { x: number; y: number } | null = null;

async function startHide() {
  const tab = await activeTab();
  if (!tab) return;
  const res = await send<string>({ type: 'screenshot', windowId: tab.windowId });
  if (!res.ok) return setState('error', ERROR_COPY[res.code]);

  const img = new Image();
  img.src = res.data;
  await img.decode();
  shot = img;
  rects = [];
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  draw();
  document.body.classList.add('hiding');
  setState('idle', 'Drag over anything you want blacked out.');
}

function stopHide() {
  document.body.classList.remove('hiding');
  shot = null;
  rects = [];
  setState('idle');
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

captureBtn.addEventListener('click', () => runCapture());
hideLink.addEventListener('click', (e) => {
  e.preventDefault();
  startHide();
});
settingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
undoBtn.addEventListener('click', () => {
  rects.pop();
  draw();
});
cancelBtn.addEventListener('click', stopHide);
sendHiddenBtn.addEventListener('click', () => {
  draw(); // make sure no drag preview is baked in
  runCapture({ screenshotDataUrl: canvas.toDataURL('image/jpeg', 0.7), redactions: rects });
});

setState('idle');
getSettings().then((s) => {
  if (!s.userId.trim()) showSetup();
});

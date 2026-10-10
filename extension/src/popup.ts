import { logoSvg } from './logo';
import { countTo, enter, intro, nudge, pressable, ripple, setLive, swapText } from './motion';
import { getRecording, onRecordingChange } from './recording';
import { getSettings, join, lookupOrg } from './settings';
import type { BgRequest, BgResult, ErrorCode, Rect, RecordingState, Settings } from './types';

const POPUP_TIMEOUT_MS = 65_000; // a little over the service worker's 60 second request limit
const MIN_RECT_PX = 4;

const ERROR_COPY: Record<ErrorCode, string> = {
  no_user: 'Join your org first.',
  unknown_user: 'Your org does not know you yet. Join again.',
  restricted: 'This page cannot be captured.',
  timeout: 'That took too long. Try again.',
  backend: 'Could not reach Orion. Try again.',
  unknown: 'Could not capture. Try again.',
};

// Shown under the button while recording, based on how the last attempt went.
const RECORDING_ERROR_COPY: Record<ErrorCode, string> = {
  no_user: 'Join your org to keep capturing.',
  unknown_user: 'Your org does not know you yet. Join again.',
  restricted: 'Skipping this page. It cannot be captured.',
  timeout: 'Orion is slow right now. Still trying.',
  backend: 'Could not reach Orion. Still trying.',
  unknown: 'Last capture failed. Still trying.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logo = $('logo');
const who = $('who');
const pillText = $('pill-text');
const pillRing = document.querySelector('.dot .ring')!;
const toggleBtn = $<HTMLButtonElement>('toggle');
const toggleText = $('toggle-text');
const rippleEl = $('ripple');
const sentEl = $('sent');
const sharedEl = $('shared');
const lastEl = $('last');
const statusEl = $('status');
const hideLink = $('hide');
const settingsLink = $('settings');
const canvas = $<HTMLCanvasElement>('shot');
const sendHiddenBtn = $<HTMLButtonElement>('send-hidden');
const undoBtn = $<HTMLButtonElement>('undo');
const cancelBtn = $<HTMLButtonElement>('cancel');
const setupForm = $<HTMLFormElement>('setup-form');
const orgInput = $<HTMLInputElement>('org-id');
const orgHint = $('org-hint');
const nameInput = $<HTMLInputElement>('name');
const roleInput = $<HTMLTextAreaElement>('role');
const joinBtn = $<HTMLButtonElement>('join');

logo.innerHTML = logoSvg({ idPrefix: 'popup' });
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.body.classList.add('motion');
for (const b of document.querySelectorAll<HTMLButtonElement>('button')) pressable(b);

let settings: Settings;

function setStatus(message: string, tone: 'muted' | 'ok' | 'error' = 'muted') {
  statusEl.dataset.tone = tone;
  swapText(statusEl, message);
}

const revealIn = (selector: string) => Array.from(document.querySelectorAll(`${selector} .reveal`));

function showView(view: 'main' | 'setup' | 'hiding', animate = true) {
  document.body.classList.toggle('setup', view === 'setup');
  document.body.classList.toggle('hiding', view === 'hiding');
  if (animate && view !== 'hiding') enter(revealIn(view === 'setup' ? '#setup' : '#main'));
}

function showWho(s: Settings) {
  who.textContent = s.userId ? `${s.name || s.userId} · ${s.orgName || s.orgId}` : 'Not joined yet';
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

let recording: boolean | null = null;
let lastSentAt: number | null = null;

function ago(at: number | null): string {
  if (!at) return '--';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}
setInterval(() => (lastEl.textContent = ago(lastSentAt)), 1000);

function render(state: RecordingState) {
  const changed = recording !== null && recording !== state.recording;
  if (recording !== state.recording) setLive(logo, pillRing, state.recording);
  recording = state.recording;
  document.body.classList.toggle('recording', recording);
  pillText.textContent = recording ? 'Live' : 'Paused';
  toggleText.textContent = recording ? 'Stop capturing' : 'Start capturing';
  if (changed) ripple(rippleEl);

  countTo(sentEl, state.sent);
  countTo(sharedEl, state.shared ?? 0);
  lastSentAt = state.lastSentAt;
  lastEl.textContent = ago(lastSentAt);

  if (!recording) return setStatus(changed ? 'Stopped. Nothing is being sent.' : 'Capturing is off.');
  if (state.lastError === 'unknown_user') return showSetup('Your org does not know you yet. Join again.');
  if (state.lastError) return setStatus(RECORDING_ERROR_COPY[state.lastError], 'error');
  setStatus('Capturing this tab every 5 seconds.', 'ok');
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  const res = await send<void>({ type: recording ? 'stop' : 'start' });
  toggleBtn.disabled = false;
  if (res.ok) return;
  if (res.code === 'no_user' || res.code === 'unknown_user') return showSetup();
  setStatus(ERROR_COPY[res.code], 'error');
});

// First run: join the org right in the popup. Orion checks the org id, then
// adds you with your name and a sentence about what you do.

const JOIN_PROMPT = 'Join once, then start capturing.';

function showSetup(message = JOIN_PROMPT, animate = true) {
  orgInput.value ||= settings.orgId;
  nameInput.value ||= settings.name;
  roleInput.value ||= settings.role;
  showView('setup', animate && !document.body.classList.contains('setup'));
  setStatus(message, message === JOIN_PROMPT ? 'muted' : 'error');
  if (orgInput.value) checkOrg();
  (orgInput.value ? nameInput.value ? roleInput : nameInput : orgInput).focus();
}

let orgCheck = 0;
async function checkOrg(): Promise<boolean> {
  const id = orgInput.value.trim().toLowerCase();
  const mine = ++orgCheck;
  if (!id) {
    orgHint.textContent = '';
    joinBtn.textContent = 'Join';
    return false;
  }
  const res = await lookupOrg(settings.backendUrl, id);
  if (mine !== orgCheck) return res.ok;
  orgHint.dataset.tone = res.ok ? 'ok' : 'error';
  swapText(orgHint, res.ok ? res.name : res.message);
  joinBtn.textContent = res.ok ? `Join ${res.name}` : 'Join';
  return res.ok;
}

let orgTimer: ReturnType<typeof setTimeout> | undefined;
orgInput.addEventListener('input', () => {
  clearTimeout(orgTimer);
  orgTimer = setTimeout(checkOrg, 350);
});

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const orgId = orgInput.value.trim().toLowerCase();
  const name = nameInput.value.trim();
  const role = roleInput.value.trim();
  const missing = [!orgId && orgInput, !name && nameInput, !role && roleInput].find(Boolean);
  if (missing) {
    nudge(missing);
    missing.focus();
    return;
  }
  joinBtn.disabled = true;
  setStatus('Joining...');
  const sameOrg = orgId === settings.orgId;
  const res = await join({ orgId, name, role, backendUrl: settings.backendUrl, userId: sameOrg ? settings.userId : '' });
  joinBtn.disabled = false;
  if (!res.ok) {
    nudge(setupForm);
    return setStatus(res.message, 'error');
  }
  settings = res.settings;
  showWho(settings);
  showView('main');
  setStatus(`You are in ${settings.orgName}.`, 'ok');
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
  showView('hiding');
  enter([canvas]);
  setStatus('Drag over anything you want blacked out.');
}

function stopHide() {
  showView('main');
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
    if (res.code !== 'no_user' && res.code !== 'unknown_user') return setStatus(ERROR_COPY[res.code], 'error');
    shot = null;
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

// Pick the starting view before the intro plays, so it animates the right content.
Promise.all([getSettings(), getRecording()]).then(([s, state]) => {
  settings = s;
  showWho(s);
  const joined = !!s.userId.trim();
  document.body.classList.toggle('setup', !joined);
  render(state);
  onRecordingChange(render);
  const hidden = joined ? '#setup' : '#main';
  for (const el of revealIn(hidden)) (el as HTMLElement).style.opacity = '1';
  intro(logo, Array.from(document.querySelectorAll(`.reveal`)).filter((el) => !el.closest(hidden)));
  if (!joined) showSetup(JOIN_PROMPT, false);
});

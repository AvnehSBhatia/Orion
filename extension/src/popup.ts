import { blockReason, isPaused, PAUSE_FOREVER } from './lib/policy.ts';
import { hostOf } from './lib/url.ts';
import { getLocal, onLocalChange, patchLocal, setSiteBlocked, type LocalState } from './privacy';
import { DEFAULT_RECORDING, getRecording, onRecordingChange } from './recording';
import { getSettings, saveSettings } from './settings';
import type { BgRequest, BgResult, ConsentStatus, ErrorCode, Rect, RecordingState } from './types';

const POPUP_TIMEOUT_MS = 20_000;
const MIN_RECT_PX = 4;

// After a button press that failed.
const ERROR_COPY: Record<ErrorCode, string> = {
  no_user: 'Add your user id in settings first.',
  restricted: 'This page cannot be captured.',
  excluded: 'Orion never captures this site.',
  paused: 'Capturing is paused. Resume first.',
  timeout: 'That took too long. Try again.',
  backend: 'Could not reach Orion. Try again.',
  retrying: 'Could not reach Orion. Try again in a moment.',
  signed_out: 'Your Orion sign-in ended. Sign in again in settings.',
  consent: 'Review the monitoring notice first.',
  paused_by_org: 'Your organization has paused capturing.',
  capture_disabled: 'Your organization has turned capturing off.',
  forbidden: 'Orion refused captures from this account. Ask your admin.',
  budget: "Your organization's monthly Orion budget is used up.",
  insecure_url: 'The server URL must start with https://. Fix it in settings.',
  no_permission: 'Orion needs access to websites to capture tabs.',
  unknown: 'Could not capture. Try again.',
};

// Under the button while recording, based on how the last beat went.
const RECORDING_ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  no_user: 'Add your user id in settings.',
  timeout: 'Orion is slow to answer. Still trying.',
  backend: 'Orion turned down the last capture. Still capturing.',
  budget: "Your organization's monthly Orion budget is used up.",
  unknown: 'Last capture failed. Still trying.',
};

// When a session ended without the user pressing stop.
const STOP_COPY: Partial<Record<ErrorCode, string>> = {
  paused_by_org: 'Stopped: your organization has paused capturing.',
  capture_disabled: 'Stopped: your organization has turned capturing off.',
  forbidden: 'Stopped: Orion refused captures from this account. Ask your admin.',
  insecure_url: 'Stopped: the server URL must start with https://. Fix it in settings.',
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
const signInBtn = $<HTMLButtonElement>('sign-in-again');
const noticeEl = $('notice-text');
const acceptBtn = $<HTMLButtonElement>('accept');
const declineBtn = $<HTMLButtonElement>('decline');
const pausedText = $('paused-text');
const resumeBtn = $<HTMLButtonElement>('resume');
const siteText = $('site-text');
const siteBtn = $<HTMLButtonElement>('site-toggle');

function setStatus(message: string, tone: 'muted' | 'ok' | 'error' = 'muted') {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
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

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Start and stop. The service worker owns the loop and writes its progress to
// session storage; pause, blocked sites, and warnings live in local storage.
// This popup renders both.

let rec: RecordingState = DEFAULT_RECORDING;
let local: LocalState | null = null;
let wasRecording = false;

function render() {
  const recording = rec.recording;
  const paused = isPaused(local?.pausedUntil);
  document.body.classList.toggle('recording', recording);
  document.body.classList.toggle('paused', paused);
  document.body.classList.toggle('signed-out', local?.attention === 'signed_out');
  toggleBtn.textContent = recording ? 'Stop capturing' : 'Start capturing';

  if (paused && local?.pausedUntil) {
    pausedText.textContent =
      local.pausedUntil >= PAUSE_FOREVER ? 'Paused until you resume.' : `Paused until ${clock(local.pausedUntil)}.`;
  }

  if (local?.attention === 'signed_out') {
    setStatus('Your Orion sign-in ended, so capturing stopped. Sign in again to keep going.', 'error');
  } else if (!recording) {
    const why = rec.stopReason && STOP_COPY[rec.stopReason];
    if (why) setStatus(why, 'error');
    else if (wasRecording) setStatus('Stopped. Nothing is being sent.');
  } else if (paused) {
    setStatus('Nothing is read or sent while paused.');
  } else if (rec.lastError === 'retrying') {
    const waiting = rec.queued ? ` ${rec.queued} ${rec.queued === 1 ? 'capture' : 'captures'} waiting.` : '';
    const when = rec.retryAt ? ` Retrying at ${clock(rec.retryAt)}.` : ' Retrying.';
    setStatus(`Could not reach Orion.${waiting}${when}`, 'error');
  } else if (rec.lastError && RECORDING_ERROR_COPY[rec.lastError]) {
    setStatus(RECORDING_ERROR_COPY[rec.lastError]!, 'error');
  } else {
    const sec = local?.policy.captureIntervalSec ?? 5;
    setStatus(`Capturing what you shared every ${sec} seconds.`, 'ok');
  }
  wasRecording = recording;
  renderSite();
}

toggleBtn.addEventListener('click', async () => {
  toggleBtn.disabled = true;
  const starting = !rec.recording;
  const res = await send<void>({ type: rec.recording ? 'stop' : 'start' });
  toggleBtn.disabled = false;
  if (res.ok) {
    if (starting) setStatus('Choose what to share in the window that opened.');
    return;
  }
  if (res.code === 'no_user') return showSetup();
  if (res.code === 'consent') return showConsent();
  setStatus(ERROR_COPY[res.code], 'error');
});

signInBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// The monitoring notice. Shown before the first capture, and again whenever
// the org changes it or the server answers 403 "consent required".

let consentVersion = 0;

async function showConsent() {
  setStatus('Loading the notice...');
  const res = await send<ConsentStatus>({ type: 'consent-status' });
  if (!res.ok) return setStatus(ERROR_COPY[res.code], 'error');
  consentVersion = res.data.version;
  noticeEl.textContent = res.data.notice;
  document.body.classList.add('consent');
  setStatus('');
  acceptBtn.focus();
}

acceptBtn.addEventListener('click', async () => {
  acceptBtn.disabled = true;
  const res = await send<void>({ type: 'accept-consent', version: consentVersion });
  acceptBtn.disabled = false;
  if (!res.ok) return setStatus(ERROR_COPY[res.code], 'error');
  document.body.classList.remove('consent');
  setStatus('Thanks. Starting...', 'ok');
  toggleBtn.click();
});

declineBtn.addEventListener('click', () => {
  document.body.classList.remove('consent');
  setStatus('Nothing is captured until you accept the notice.');
});

// Pause for a while. Stored locally; the service worker reads nothing while paused.

document.querySelectorAll<HTMLButtonElement>('[data-pause]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const min = Number(btn.dataset.pause);
    await patchLocal({ pausedUntil: min > 0 ? Date.now() + min * 60_000 : PAUSE_FOREVER });
  });
});
resumeBtn.addEventListener('click', () => patchLocal({ pausedUntil: null }));

// "Never capture this site", for the tab the popup was opened on.

let siteHost: string | null = null;
let siteUrl: string | undefined;

function renderSite() {
  if (!local || !siteHost) {
    document.body.classList.remove('has-site');
    return;
  }
  document.body.classList.add('has-site');
  const reason = blockReason(siteUrl, local.policy, local.blockedHosts);
  siteBtn.hidden = reason === 'org_excluded';
  if (reason === 'org_excluded') {
    siteText.textContent = `Your organization never captures ${siteHost}.`;
  } else if (reason === 'user_blocked') {
    siteText.textContent = `You never capture ${siteHost}.`;
    siteBtn.textContent = 'Allow again';
  } else {
    siteText.textContent = siteHost;
    siteBtn.textContent = 'Never capture this site';
  }
}

siteBtn.addEventListener('click', async () => {
  if (!local || !siteUrl) return;
  const blocked = blockReason(siteUrl, local.policy, local.blockedHosts) === 'user_blocked';
  if (blocked) {
    // Unblock whichever listed entry covers this host (it may be a parent domain).
    const host = hostOf(siteUrl)!;
    const entry = local.blockedHosts.find((h) => host === h || host.endsWith(`.${h}`)) ?? host;
    await setSiteBlocked(entry, false);
  } else {
    await setSiteBlocked(siteUrl, true);
  }
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
  if (tab?.id === undefined) return;
  const res = await send<string>({ type: 'screenshot', tabId: tab.id });
  if (!res.ok) {
    if (res.code === 'consent') return showConsent();
    return setStatus(ERROR_COPY[res.code], 'error');
  }

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
    if (res.code === 'no_user' || res.code === 'consent') stopHide();
    if (res.code === 'no_user') return showSetup();
    if (res.code === 'consent') return showConsent();
    return setStatus(ERROR_COPY[res.code], 'error');
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

onRecordingChange((s) => {
  rec = s;
  render();
});
onLocalChange((s) => {
  local = s;
  render();
});
// A timed pause ends on its own; re-render so the popup notices.
setInterval(render, 15_000);

(async () => {
  const [r, l, settings, tab] = await Promise.all([getRecording(), getLocal(), getSettings(), activeTab()]);
  rec = r;
  local = l;
  wasRecording = r.recording;
  siteUrl = tab?.url;
  siteHost = hostOf(tab?.url);
  render();
  if (!settings.userId.trim()) showSetup();
  else if (l.attention === 'consent' && !r.recording) showConsent();
})();

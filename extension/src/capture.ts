// The chooser window (capture.html), where the user picks what Orion may see:
// any number of app windows or screens (through Chrome's picker, one pick at a
// time) and any Chrome tabs they tick. It holds the window and screen streams
// and hands the service worker one frame from each when asked. The service
// worker owns the 5 second timer, because timers in a minimized window get
// throttled. Closing this window ends every share and stops recording.

import { grabAll, type SharedSource } from './capture/frames';
import { blockReason, type BlockReason } from './lib/policy.ts';
import { getLocal, onLocalChange } from './privacy';
import { getRecording, onRecordingChange, patchRecording } from './recording';
import type { BgRequest, BgResult, ErrorCode, FrameRequest, RecordingState } from './types';

// Largest stream resolution requested from Chrome.
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const addBtn = $<HTMLButtonElement>('add');
const sharedList = $('shared');
const tabList = $('tabs');
const toggleBtn = $<HTMLButtonElement>('toggle');
const statusEl = $('status');
const tabAccess = $('tab-access');
const grantBtn = $<HTMLButtonElement>('grant-tabs');

const shared = new Map<string, SharedSource>();
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
      console.error('[orion]', err);
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

// Chrome reports the surface type in track settings; older builds only in the label.
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

// Chrome tabs. Listing and capturing tabs needs Chrome's "all sites" access,
// which is optional: it is asked for here, from a click, the first time
// someone wants to share a tab. Tabs on sites the org excludes or the user
// blocked are listed but cannot be ticked.

const TAB_ACCESS: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

const BLOCK_COPY: Record<Exclude<BlockReason, 'not_web'>, string> = {
  org_excluded: 'Excluded by your organization',
  user_blocked: 'You never capture this site',
};

async function renderTabs() {
  const hasAccess = await chrome.permissions.contains(TAB_ACCESS);
  tabAccess.hidden = hasAccess;
  if (!hasAccess) {
    tabList.replaceChildren();
    return;
  }
  const [tabs, current, local] = await Promise.all([chrome.tabs.query({}), getRecording(), getLocal()]);
  const allowed = new Set(current.allowedTabIds);
  const rows = tabs
    .filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ''))
    .map((t) => {
      const reason = blockReason(t.url, local.policy, local.blockedHosts);
      const row = document.createElement('label');
      row.className = 'item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !reason && allowed.has(t.id!);
      box.disabled = !!reason;
      box.addEventListener('change', () => setTabAllowed(t.id!, box.checked));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = t.title || t.url!;
      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = reason && reason !== 'not_web' ? BLOCK_COPY[reason] : new URL(t.url!).hostname;
      if (reason) row.classList.add('blocked');
      row.append(box, name, host);
      return row;
    });
  tabList.replaceChildren(...rows);
  if (rows.length === 0) tabList.append(emptyNote('No open web pages.'));
}

grantBtn.addEventListener('click', async () => {
  const granted = await chrome.permissions.request(TAB_ACCESS).catch(() => false);
  if (!granted) setStatus('Without site access Orion can still capture windows and screens, but not tabs.');
  renderTabs();
});

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
chrome.permissions.onAdded.addListener(() => renderTabs());
chrome.permissions.onRemoved.addListener(() => renderTabs());
onLocalChange(() => renderTabs());

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
        : `Capturing ${n} ${n === 1 ? 'source' : 'sources'}. Stop or pause from the Orion icon in your toolbar.`,
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
  if (!res) return setStatus('Could not start. Reload Orion in chrome://extensions, then try again.');
  if (!res.ok) setStatus(START_ERRORS[res.code] ?? 'Could not start. Open the Orion toolbar button for details.');
});

const START_ERRORS: Partial<Record<ErrorCode, string>> = {
  consent: 'Accept the monitoring notice first: open the Orion toolbar button.',
  signed_out: 'Your Orion sign-in ended. Sign in again in Orion settings.',
  capture_disabled: 'Your organization has turned capturing off.',
  insecure_url: 'The server URL must start with https://. Fix it in Orion settings.',
  retrying: 'Could not reach Orion. Try again in a moment.',
  no_user: 'Add your user id in Orion settings first.',
};

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

chrome.runtime.onMessage.addListener((msg: FrameRequest, _sender, sendResponse) => {
  if (msg.type !== 'grab-frames') return;
  grabAll(shared.values()).then(sendResponse, (err) => {
    console.error('[orion]', err);
    sendResponse([]);
  });
  return true; // keep the channel open for the async response
});

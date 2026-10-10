import { logoSvg } from './logo';
import { intro, nudge, pressable, swapText } from './motion';
import { getSettings, join, lookupOrg } from './settings';
import type { Settings } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const logo = $('logo');
const who = $('who');
const orgId = $<HTMLInputElement>('orgId');
const orgHint = $('org-hint');
const name = $<HTMLInputElement>('name');
const role = $<HTMLTextAreaElement>('role');
const backendUrl = $<HTMLInputElement>('backendUrl');
const saveBtn = $<HTMLButtonElement>('save');
const status = $('status');

logo.innerHTML = logoSvg({ idPrefix: 'options' });
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) document.body.classList.add('motion');
pressable(saveBtn);

let current: Settings;

function setStatus(text: string, tone: 'muted' | 'ok' | 'error' = 'muted') {
  status.dataset.tone = tone;
  swapText(status, text);
}

const showWho = (s: Settings) => (who.textContent = s.userId ? `${s.name || s.userId} · ${s.orgName || s.orgId}` : 'Settings');

let orgCheck = 0;
let orgTimer: ReturnType<typeof setTimeout> | undefined;
async function checkOrg() {
  const id = orgId.value.trim().toLowerCase();
  const mine = ++orgCheck;
  if (!id) return void (orgHint.textContent = '');
  const res = await lookupOrg(backendUrl.value.trim() || current.backendUrl, id);
  if (mine !== orgCheck) return;
  orgHint.dataset.tone = res.ok ? 'ok' : 'error';
  swapText(orgHint, res.ok ? res.name : res.message);
}
for (const el of [orgId, backendUrl]) {
  el.addEventListener('input', () => {
    clearTimeout(orgTimer);
    orgTimer = setTimeout(checkOrg, 350);
  });
}

getSettings().then((s) => {
  current = s;
  orgId.value = s.orgId;
  name.value = s.name;
  role.value = s.role;
  backendUrl.value = s.backendUrl;
  showWho(s);
  intro(logo, Array.from(document.querySelectorAll('.reveal')));
  if (s.orgId) checkOrg();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = {
    orgId: orgId.value.trim().toLowerCase(),
    name: name.value.trim(),
    role: role.value.trim(),
    backendUrl: backendUrl.value.trim(),
  };
  const missing = [!next.orgId && orgId, !next.name && name, !next.role && role, !next.backendUrl && backendUrl].find(Boolean);
  if (missing) {
    nudge(missing);
    missing.focus();
    return;
  }
  saveBtn.disabled = true;
  setStatus('Saving...');
  const res = await join({ ...next, userId: next.orgId === current.orgId ? current.userId : '' });
  saveBtn.disabled = false;
  if (!res.ok) return setStatus(res.message, 'error');
  current = res.settings;
  showWho(current);
  setStatus(`Saved. You are in ${current.orgName}.`, 'ok');
});

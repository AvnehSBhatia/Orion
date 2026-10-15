import { isAllowedServerUrl, normalizeServerUrl, originPattern } from './lib/url.ts';
import { getLocal, onLocalChange, setSiteBlocked } from './privacy';
import { BUILD_SERVER_URL, getSettings, saveSettings } from './settings';
import type { BgRequest } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const userId = $<HTMLInputElement>('userId');
const backendUrl = $<HTMLInputElement>('backendUrl');
const status = $('status');
const loginForm = $<HTMLFormElement>('login');
const username = $<HTMLInputElement>('username');
const password = $<HTMLInputElement>('password');
const loginStatus = $('loginStatus');
const signOut = $<HTMLButtonElement>('signOut');
const blockForm = $<HTMLFormElement>('block-form');
const blockInput = $<HTMLInputElement>('block-host');
const blockList = $('blocked');
const orgList = $('org-excluded');

const INSECURE = 'Use an https:// address. Plain http:// only works for localhost.';

async function showAccount() {
  const s = await getSettings();
  const { attention } = await getLocal();
  userId.value = s.userId;
  backendUrl.value = s.backendUrl;
  backendUrl.placeholder = BUILD_SERVER_URL;
  signOut.hidden = !s.token;
  if (s.token) loginStatus.textContent = `Signed in as ${s.userId}${s.orgId ? ` in ${s.orgId}` : ''}.`;
  else if (attention === 'signed_out') loginStatus.textContent = 'Your sign-in ended or was revoked. Sign in again to keep capturing.';
  else loginStatus.textContent = 'Not signed in.';
}

/**
 * The extension can always reach the server it was built for. Any other
 * server needs Chrome's site access, which can only be asked for from a click.
 */
async function ensureServerAccess(base: string): Promise<boolean> {
  const origins = [originPattern(base)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}

function readServerUrl(): string | null {
  const raw = backendUrl.value.trim() || BUILD_SERVER_URL;
  return normalizeServerUrl(raw);
}

backendUrl.addEventListener('input', () => {
  const raw = backendUrl.value.trim();
  backendUrl.setCustomValidity(raw && !isAllowedServerUrl(raw) ? INSECURE : '');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const base = readServerUrl();
  if (!base) {
    status.textContent = INSECURE;
    return;
  }
  if (!(await ensureServerAccess(base))) {
    status.textContent = 'Chrome did not allow access to that server.';
    return;
  }
  await saveSettings({ ...(await getSettings()), userId: userId.value.trim(), backendUrl: base });
  backendUrl.value = base;
  status.textContent = 'Saved.';
  setTimeout(() => (status.textContent = ''), 2000);
});

async function call<T>(base: string, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(base + path, { ...init, credentials: 'omit' });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `${path} returned ${res.status}`);
  return body;
}

// Signs in with username and password, trades the session for a long-lived API token, and stores that.
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const base = readServerUrl();
  if (!base) {
    loginStatus.textContent = INSECURE;
    return;
  }
  if (!(await ensureServerAccess(base))) {
    loginStatus.textContent = 'Chrome did not allow access to that server.';
    return;
  }
  loginStatus.textContent = 'Signing in...';
  try {
    const session = await call<{ token: string; orgId: string; userId: string }>(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value }),
    });
    const bearer = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` };
    const api = await call<{ id?: string; token: string }>(base, '/api/auth/tokens', {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ label: 'chrome extension' }),
    });
    await call(base, '/api/auth/logout', { method: 'POST', headers: bearer }).catch(() => {});
    await saveSettings({
      ...(await getSettings()),
      backendUrl: base,
      token: api.token,
      tokenId: api.id ?? '',
      userId: session.userId,
      orgId: session.orgId,
    });
    password.value = '';
    await chrome.runtime.sendMessage<BgRequest>({ type: 'signed-in' }).catch(() => {});
    await showAccount();
  } catch (err) {
    loginStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

// Signing out revokes the token on the server too, so a copy of it stops working.
signOut.addEventListener('click', async () => {
  const s = await getSettings();
  if (s.token && s.tokenId && isAllowedServerUrl(s.backendUrl)) {
    await fetch(`${s.backendUrl}/api/auth/tokens/${encodeURIComponent(s.tokenId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${s.token}` },
      credentials: 'omit',
    }).catch(() => {});
  }
  await saveSettings({ ...s, token: '', tokenId: '' });
  await showAccount();
});

// Sites never captured: the personal list (editable here and from the popup)
// and the org's list from the capture policy (read only).

async function renderBlocked() {
  const { blockedHosts, policy } = await getLocal();
  blockList.replaceChildren(
    ...blockedHosts.map((host) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = host;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Allow ${host} again`);
      remove.addEventListener('click', () => setSiteBlocked(host, false));
      li.append(name, remove);
      return li;
    }),
  );
  if (blockedHosts.length === 0) blockList.append(note('None. Use "Never capture this site" in the popup, or add one here.'));
  orgList.replaceChildren(
    ...policy.excludedHosts.map((host) => {
      const li = document.createElement('li');
      li.textContent = host;
      return li;
    }),
  );
  if (policy.excludedHosts.length === 0) orgList.append(note('None.'));
}

function note(text: string) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

blockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const host = await setSiteBlocked(blockInput.value, true);
  blockInput.setCustomValidity(host ? '' : 'Enter a site like bank.example.com');
  if (!host) return blockInput.reportValidity();
  blockInput.value = '';
});
blockInput.addEventListener('input', () => blockInput.setCustomValidity(''));

onLocalChange(() => {
  renderBlocked();
  showAccount();
});
showAccount();
renderBlocked();

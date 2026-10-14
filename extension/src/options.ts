import { getSettings, saveSettings } from './settings';

const form = document.getElementById('form') as HTMLFormElement;
const userId = document.getElementById('userId') as HTMLInputElement;
const backendUrl = document.getElementById('backendUrl') as HTMLInputElement;
const status = document.getElementById('status')!;
const loginForm = document.getElementById('login') as HTMLFormElement;
const username = document.getElementById('username') as HTMLInputElement;
const password = document.getElementById('password') as HTMLInputElement;
const loginStatus = document.getElementById('loginStatus')!;
const signOut = document.getElementById('signOut') as HTMLButtonElement;

async function showAccount() {
  const s = await getSettings();
  userId.value = s.userId;
  backendUrl.value = s.backendUrl;
  signOut.hidden = !s.token;
  loginStatus.textContent = s.token ? `Signed in as ${s.userId}${s.orgId ? ` in ${s.orgId}` : ''}.` : 'Not signed in.';
}

showAccount();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({ ...(await getSettings()), userId: userId.value.trim(), backendUrl: backendUrl.value.trim() });
  status.textContent = 'Saved.';
  setTimeout(() => (status.textContent = ''), 2000);
});

async function call<T>(base: string, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(base.replace(/\/+$/, '') + path, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `${path} returned ${res.status}`);
  return body;
}

// Signs in with username and password, trades the session for a long-lived API token, and stores that.
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const base = backendUrl.value.trim() || (await getSettings()).backendUrl;
  loginStatus.textContent = 'Signing in...';
  try {
    const session = await call<{ token: string; orgId: string; userId: string }>(base, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value.trim(), password: password.value }),
    });
    const bearer = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` };
    const api = await call<{ token: string }>(base, '/api/auth/tokens', { method: 'POST', headers: bearer, body: JSON.stringify({ label: 'chrome extension' }) });
    await call(base, '/api/auth/logout', { method: 'POST', headers: bearer }).catch(() => {});
    await saveSettings({ ...(await getSettings()), backendUrl: base, token: api.token, userId: session.userId, orgId: session.orgId });
    password.value = '';
    await showAccount();
  } catch (err) {
    loginStatus.textContent = err instanceof Error ? err.message : String(err);
  }
});

signOut.addEventListener('click', async () => {
  await saveSettings({ ...(await getSettings()), token: '' });
  await showAccount();
});

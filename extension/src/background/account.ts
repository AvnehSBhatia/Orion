// Sign-in state and the org's monitoring notice, as the service worker sees them.

import { getLocal, patchLocal } from '../privacy';
import { getSettings, saveSettings } from '../settings';
import type { ConsentStatus } from '../types';
import { apiFetch, errorBody, NetworkError } from './api';
import { CaptureError } from './errors';
import { stopRecording } from './recorder';

// Shown when the server does not send its own notice text.
export const DEFAULT_NOTICE = [
  'Your organization uses Orion to keep its shared work map up to date.',
  'While you are capturing, Orion sends screenshots of the windows, screens, and Chrome tabs you choose to your organization\'s Orion server, along with the page address (without query strings), title, and page text of chosen tabs. Passwords, payment card, and other sensitive form fields are never sent.',
  'Captured content is processed by an AI model to describe what you are working on, and the results are visible to people in your organization. Your administrator controls how long captures are kept.',
  'Capturing only runs when you start it. You can pause, stop, or exclude a site at any time from the Orion toolbar button.',
].join('\n\n');

/**
 * The token was revoked or expired (401). Forget it, stop capturing, and put
 * an amber "!" on the toolbar icon until the user signs in again.
 */
export async function handleSignedOut(): Promise<void> {
  const settings = await getSettings();
  await saveSettings({ ...settings, token: '', tokenId: '' });
  await patchLocal({ attention: 'signed_out' });
  await stopRecording('signed_out');
}

/** The options page stored a fresh token: clear the sign-in warning. */
export async function handleSignedIn(): Promise<void> {
  const { attention } = await getLocal();
  if (attention === 'signed_out') await patchLocal({ attention: null });
}

type MeConsent = {
  required?: unknown;
  version?: unknown;
  acceptedAt?: unknown;
  acceptedVersion?: unknown;
  notice?: unknown;
  text?: unknown;
};

/**
 * Whether the user must accept the org's monitoring notice before capturing,
 * from GET /api/auth/me. Servers without the consent field (older builds)
 * need none. A 403 "consent required" from a capture always shows the notice,
 * whatever this said.
 */
export async function getConsentStatus(): Promise<ConsentStatus> {
  const { attention } = await getLocal();
  let res: Response;
  try {
    res = await apiFetch('/api/auth/me');
  } catch (err) {
    if (err instanceof NetworkError) throw new CaptureError('retrying', err.message);
    throw err;
  }
  if (res.status === 401) {
    if ((await getSettings()).token) {
      await handleSignedOut();
      throw new CaptureError('signed_out');
    }
    // No token: a server with AUTH_DISABLED, or not signed in yet. Nothing to accept.
    return { needed: attention === 'consent', version: 0, notice: DEFAULT_NOTICE };
  }
  if (!res.ok) {
    if (res.status === 404) return { needed: attention === 'consent', version: 0, notice: DEFAULT_NOTICE };
    throw new CaptureError('backend', `${res.status} ${(await errorBody(res)).error ?? ''}`);
  }
  const me = (await res.json().catch(() => ({}))) as { consent?: MeConsent };
  const c = me.consent ?? {};
  const version = Number.isFinite(Number(c.version)) ? Number(c.version) : 0;
  const acceptedVersion = Number(c.acceptedVersion);
  const stale = Number.isFinite(acceptedVersion) && acceptedVersion < version;
  const needed = (c.required === true && (!c.acceptedAt || stale)) || attention === 'consent';
  const custom = typeof c.notice === 'string' ? c.notice : typeof c.text === 'string' ? c.text : '';
  return { needed, version, notice: custom.trim() || DEFAULT_NOTICE };
}

/** POST /api/auth/consent, then clear the "review the notice" warning. */
export async function acceptConsent(version: number): Promise<void> {
  let res: Response;
  try {
    res = await apiFetch('/api/auth/consent', { method: 'POST', body: JSON.stringify({ version }) });
  } catch (err) {
    if (err instanceof NetworkError) throw new CaptureError('retrying', err.message);
    throw err;
  }
  if (res.status === 401) {
    await handleSignedOut();
    throw new CaptureError('signed_out');
  }
  if (!res.ok) throw new CaptureError('backend', `${res.status} ${(await errorBody(res)).error ?? ''}`);
  const { attention } = await getLocal();
  if (attention === 'consent') await patchLocal({ attention: null });
}

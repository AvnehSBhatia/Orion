import { isAllowedServerUrl } from './lib/url.ts';
import type { Settings } from './types';

/** The server this build was made for (ORION_SERVER_URL at build time). */
export const BUILD_SERVER_URL: string = __ORION_SERVER_URL__;

export const DEFAULT_SETTINGS: Settings = {
  userId: '',
  orgId: '',
  backendUrl: BUILD_SERVER_URL,
  token: '',
  tokenId: '',
};

// The token stays on this device (storage.local); the rest syncs with the Chrome profile.
export async function getSettings(): Promise<Settings> {
  const { token: _token, tokenId: _tokenId, ...synced } = DEFAULT_SETTINGS;
  const [stored, local] = await Promise.all([
    chrome.storage.sync.get(synced),
    chrome.storage.local.get({ token: '', tokenId: '' }),
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...stored, token: String(local.token ?? ''), tokenId: String(local.tokenId ?? '') } as Settings;
  // A synced URL from an older build (or another profile) that is not https
  // falls back to this build's server rather than sending in cleartext.
  if (!isAllowedServerUrl(settings.backendUrl)) settings.backendUrl = BUILD_SERVER_URL;
  return settings;
}

/** Headers for a backend call: JSON, plus the bearer token once signed in. */
export function authHeaders(settings: Settings): Record<string, string> {
  const token = settings.token.trim();
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const { token, tokenId, ...synced } = settings;
  await Promise.all([chrome.storage.sync.set(synced), chrome.storage.local.set({ token, tokenId })]);
}

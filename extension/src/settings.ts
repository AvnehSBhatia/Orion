import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  userId: '',
  orgId: '',
  backendUrl: 'http://localhost:3000',
  token: '',
};

// The token stays on this device (storage.local); the rest syncs with the Chrome profile.
export async function getSettings(): Promise<Settings> {
  const { token: _token, ...synced } = DEFAULT_SETTINGS;
  const [stored, local] = await Promise.all([chrome.storage.sync.get(synced), chrome.storage.local.get({ token: '' })]);
  return { ...DEFAULT_SETTINGS, ...stored, token: String(local.token ?? '') } as Settings;
}

/** Headers for a backend call: JSON, plus the bearer token once signed in. */
export function authHeaders(settings: Settings): Record<string, string> {
  const token = settings.token.trim();
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const { token, ...synced } = settings;
  await Promise.all([chrome.storage.sync.set(synced), chrome.storage.local.set({ token })]);
}

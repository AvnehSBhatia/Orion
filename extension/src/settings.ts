import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  userId: '',
  orgId: '',
  backendUrl: 'http://localhost:3000',
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set(settings);
}

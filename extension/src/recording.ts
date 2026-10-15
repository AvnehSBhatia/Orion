import type { RecordingState } from './types';

const KEY = 'recordingState';

export const DEFAULT_RECORDING: RecordingState = {
  recording: false,
  sent: 0,
  lastSentAt: null,
  lastError: null,
  stopReason: null,
  queued: 0,
  retryAt: null,
  captureWindowId: null,
  allowedTabIds: [],
};

export async function getRecording(): Promise<RecordingState> {
  const stored = await chrome.storage.session.get(KEY);
  return { ...DEFAULT_RECORDING, ...(stored[KEY] as Partial<RecordingState> | undefined) };
}

export async function patchRecording(patch: Partial<RecordingState>): Promise<void> {
  await chrome.storage.session.set({ [KEY]: { ...(await getRecording()), ...patch } });
}

export function onRecordingChange(cb: (state: RecordingState) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[KEY]) return;
    cb({ ...DEFAULT_RECORDING, ...(changes[KEY].newValue as Partial<RecordingState> | undefined) });
  });
}

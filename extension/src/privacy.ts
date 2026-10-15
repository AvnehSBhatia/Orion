// Local, per-device privacy state in chrome.storage.local: the user's pause,
// the sites they never want captured, the last capture policy from the server,
// and anything the user must act on (sign in again, accept the notice).
// Shared by the service worker, popup, chooser, and options page.

import { DEFAULT_POLICY, isPaused, type CapturePolicy } from './lib/policy.ts';
import { normalizeHostEntry } from './lib/url.ts';

export type Attention = 'signed_out' | 'consent' | null;

export type LocalState = {
  pausedUntil: number | null;
  blockedHosts: string[];
  policy: CapturePolicy;
  policyFetchedAt: number | null;
  attention: Attention;
};

const KEY = 'privacy';

export const DEFAULT_LOCAL: LocalState = {
  pausedUntil: null,
  blockedHosts: [],
  policy: DEFAULT_POLICY,
  policyFetchedAt: null,
  attention: null,
};

export async function getLocal(): Promise<LocalState> {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_LOCAL, ...(stored[KEY] as Partial<LocalState> | undefined) };
}

export async function patchLocal(patch: Partial<LocalState>): Promise<LocalState> {
  const next = { ...(await getLocal()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onLocalChange(cb: (state: LocalState) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    cb({ ...DEFAULT_LOCAL, ...(changes[KEY].newValue as Partial<LocalState> | undefined) });
  });
}

export async function pausedNow(): Promise<boolean> {
  return isPaused((await getLocal()).pausedUntil);
}

/** Adds or removes a site from the personal never-capture list. Returns the normalized host. */
export async function setSiteBlocked(hostOrUrl: string, blocked: boolean): Promise<string | null> {
  const host = normalizeHostEntry(hostOrUrl);
  if (!host) return null;
  const { blockedHosts } = await getLocal();
  const next = blockedHosts.filter((h) => h !== host);
  if (blocked) next.push(host);
  await patchLocal({ blockedHosts: next.sort() });
  return host;
}

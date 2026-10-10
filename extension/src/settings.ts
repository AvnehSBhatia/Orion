import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  orgId: 'demo',
  orgName: '',
  userId: '',
  name: '',
  role: '',
  backendUrl: 'http://localhost:3001',
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set(settings);
}

export const endpoint = (backendUrl: string, path: string) => backendUrl.replace(/\/+$/, '') + path;

const errorOf = async (res: Response) => ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status}`;

export type OrgLookup = { ok: true; name: string } | { ok: false; message: string };

export async function lookupOrg(backendUrl: string, orgId: string): Promise<OrgLookup> {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(orgId)) return { ok: false, message: 'Org ids use lowercase letters, digits, and dashes.' };
  try {
    const res = await fetch(endpoint(backendUrl, `/api/orgs/${orgId}`), { signal: AbortSignal.timeout(5_000) });
    if (res.status === 404) return { ok: false, message: `No org called "${orgId}". Ask whoever set it up for the id.` };
    if (!res.ok) return { ok: false, message: await errorOf(res) };
    const { org } = (await res.json()) as { org: { name: string } };
    return { ok: true, name: org.name };
  } catch {
    return { ok: false, message: `Could not reach Orion at ${backendUrl}.` };
  }
}

export type JoinResult = { ok: true; settings: Settings } | { ok: false; message: string };

/**
 * Joins the org as this person and saves the result. Passing the current userId for the same org
 * updates that person instead of creating a new one, so editing your role keeps your history.
 */
export async function join(input: Pick<Settings, 'orgId' | 'name' | 'role' | 'backendUrl' | 'userId'>): Promise<JoinResult> {
  const org = await lookupOrg(input.backendUrl, input.orgId);
  if (!org.ok) return org;
  try {
    const res = await fetch(endpoint(input.backendUrl, '/api/users'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: input.orgId, id: input.userId || undefined, name: input.name, role: input.role }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, message: await errorOf(res) };
    const { user } = (await res.json()) as { user: { id: string } };
    const settings: Settings = { ...input, orgName: org.name, userId: user.id };
    await saveSettings(settings);
    return { ok: true, settings };
  } catch {
    return { ok: false, message: `Could not reach Orion at ${input.backendUrl}.` };
  }
}

// The org's capture policy, fetched on start and every 5 minutes while
// capturing. The last good copy is kept in local storage, so an outage does
// not lift the org's exclusions.

import { parsePolicy, type CapturePolicy } from '../lib/policy.ts';
import { getLocal, patchLocal } from '../privacy';
import { getSettings } from '../settings';
import { apiFetch, NetworkError } from './api';
import { handleSignedOut } from './account';
import { CaptureError } from './errors';

export const POLICY_ALARM = 'policy-refresh';
export const POLICY_PERIOD_MIN = 5;

/**
 * Fetches GET /api/capture/policy and stores it. Falls back to the stored copy
 * when the server is unreachable or too old to have the route (404).
 * Throws CaptureError('signed_out') on 401.
 */
export async function refreshPolicy(): Promise<CapturePolicy> {
  let res: Response;
  try {
    res = await apiFetch('/api/capture/policy');
  } catch (err) {
    if (err instanceof NetworkError) return (await getLocal()).policy;
    throw err;
  }
  if (res.status === 401 && (await getSettings()).token) {
    await handleSignedOut();
    throw new CaptureError('signed_out');
  }
  if (!res.ok) return (await getLocal()).policy;
  const policy = parsePolicy(await res.json().catch(() => ({})));
  await patchLocal({ policy, policyFetchedAt: Date.now() });
  return policy;
}

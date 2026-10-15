import type { z } from "zod";
import { audit } from "@/audit/log";
import { assertConsent, consentState } from "@/auth/consent";
import type { Account, AuthDb, Principal } from "@/auth/db";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { getOrgSettings, isExcludedUrl, saveOrgSettings, type OrgSettings, type orgSettingsPatch } from "./settings";

/** An admin changes org settings; the audit log records which keys changed. */
export function updateSettingsAs(db: AuthDb, store: Store, actor: Principal | null, orgId: string, patch: z.infer<typeof orgSettingsPatch>): OrgSettings {
  const before = getOrgSettings(store);
  const settings = saveOrgSettings(store, patch);
  const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k as keyof OrgSettings]) !== JSON.stringify(settings[k as keyof OrgSettings]));
  if (changed.length) audit(db, { orgId, actor: actor?.username ?? null, action: "settings_changed", target: orgId, detail: { changed } });
  return settings;
}

export type CapturePolicy = Pick<OrgSettings, "captureEnabled" | "excludedHosts" | "captureIntervalSec"> & { consent: { required: boolean; version: number } };

/** What the extension follows: polled on start and every few minutes. */
export function capturePolicy(store: Store, account: Account | null): CapturePolicy {
  const s = getOrgSettings(store);
  const { required, version } = consentState(account, store);
  return { captureEnabled: s.captureEnabled, excludedHosts: s.excludedHosts, captureIntervalSec: s.captureIntervalSec, consent: { required, version } };
}

/**
 * The org's rules for one capture, checked before anything is stored: 403 while capture is paused or the caller
 * has not accepted the monitoring notice; "excluded" when the page's host is on the org's exclusion list.
 */
export function captureGate(store: Store, account: Account | null, url: string): "excluded" | null {
  const s = getOrgSettings(store);
  if (!s.captureEnabled) throw new HttpError(403, "capture paused by your admin");
  assertConsent(account, store);
  return isExcludedUrl(s, url) ? "excluded" : null;
}

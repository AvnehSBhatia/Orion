// What a Mac follows (GET /v1/policy), the monitoring notice it shows, and the gates on everything it sends.
import { audit } from "@/audit/log";
import { consentState } from "@/auth/consent";
import type { AuthDb, Principal } from "@/auth/db";
import { noticeFor } from "@/auth/notice";
import type { Store } from "@/db/store";
import { getOrgSettings } from "@/orgs/settings";
import { v1Error } from "./http";

export type MacPolicy = {
  capture_enabled: boolean;
  excluded_hosts: string[];
  capture_interval_sec: number;
  browser_page_text: boolean;
  consent: { required: boolean; version: number; notice: string };
};

export function macPolicy(store: Store, p: Principal): MacPolicy {
  const s = getOrgSettings(store);
  const { required, version } = consentState(p, store);
  return {
    capture_enabled: s.captureEnabled,
    excluded_hosts: s.excludedHosts,
    capture_interval_sec: s.captureIntervalSec,
    browser_page_text: s.macBrowserPageText,
    consent: { required, version, notice: noticeFor(store.getOrg(), s) },
  };
}

/** POST /v1/consent: the person accepts the current notice; 409 for any other version. */
export function acceptConsent(db: AuthDb, store: Store, p: Principal, version: number): { accepted_at: string } {
  const current = getOrgSettings(store).consentVersion;
  if (version !== current) throw v1Error(409, "consent_version_mismatch", `the current notice is version ${current}; fetch /v1/policy and accept that one`);
  const account = db.setConsent(p.username, version)!;
  audit(db, { orgId: p.orgId, actor: p.username, action: "consent_accepted", target: p.userId, detail: { version, via: "mac" } });
  return { accepted_at: account.consentAt! };
}

/** 403 capture_paused while the org has capture off; 403 consent_required until the person accepted the notice. */
export function assertMayCapture(store: Store, p: Principal): void {
  if (!getOrgSettings(store).captureEnabled) throw v1Error(403, "capture_paused", "capture is paused by your company");
  if (consentState(p, store).required) throw v1Error(403, "consent_required", "accept your company's monitoring notice first");
}

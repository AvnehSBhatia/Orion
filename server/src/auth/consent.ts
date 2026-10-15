import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { getOrgSettings } from "@/orgs/settings";
import type { Account } from "./db";

export type ConsentState = { required: boolean; version: number; acceptedAt: string | null };

/**
 * Whether the account still has to accept the org's monitoring notice. `acceptedAt` is when they accepted the
 * current version, null while they have not (an older acceptance does not count once the admin bumps the version).
 */
export function consentState(account: Pick<Account, "consentVersion" | "consentAt"> | null, store: Store): ConsentState {
  const version = getOrgSettings(store).consentVersion;
  if (!account) return { required: false, version, acceptedAt: null };
  const accepted = account.consentVersion >= version;
  return { required: !accepted, version, acceptedAt: accepted ? account.consentAt : null };
}

/** 403 `consent required` until the caller accepted the current notice. No account (auth disabled): passes. */
export function assertConsent(account: Pick<Account, "consentVersion" | "consentAt"> | null, store: Store): void {
  if (consentState(account, store).required) throw new HttpError(403, "consent required");
}

import { HttpError } from "@/http/error";
import type { Principal } from "./db";

export const SIGN_IN_REQUIRED = "sign in required";

/**
 * Pins a query or body to the caller's org: a missing orgId becomes theirs, a different one is a 403.
 * With `user`, a missing userId becomes theirs too. A null principal (auth disabled) passes the input through.
 */
export function scopeInput<T>(p: Principal | null, raw: T, { user = false } = {}): T {
  if (!p || raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  if (o.orgId === undefined || o.orgId === null || o.orgId === "") o.orgId = p.orgId;
  else if (o.orgId !== p.orgId) throw new HttpError(403, `your account belongs to org "${p.orgId}", not "${String(o.orgId)}"`);
  if (user && (o.userId === undefined || o.userId === null || o.userId === "")) o.userId = p.userId;
  return o as T;
}

/** Same-org check for an org id taken from the path. */
export function assertOrg(p: Principal | null, orgId: string): void {
  if (p && p.orgId !== orgId) throw new HttpError(403, `your account belongs to org "${p.orgId}", not "${orgId}"`);
}

/** Writing as someone takes being them, or an admin of the org. */
export function assertActingAs(p: Principal | null, userId: string): void {
  if (p && !p.admin && p.userId !== userId) throw new HttpError(403, `you are signed in as "${p.userId}" and cannot act as "${userId}"`);
}

export function assertAdmin(p: Principal | null): void {
  if (p && !p.admin) throw new HttpError(403, "only an org admin can do this");
}

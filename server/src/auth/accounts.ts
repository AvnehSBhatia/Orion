import { z } from "zod";
import { audit } from "@/audit/log";
import { config } from "@/config";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { verifyPassword } from "./crypto";
import { normalizeUsername, type Account, type AuthDb, type Principal } from "./db";
import { assertEmailFree, emailSchema, passwordSchema } from "./service";

/** What an admin sees about an account. Never the password hash or tokens. */
export type AccountView = {
  username: string;
  userId: string;
  name: string;
  email: string | null;
  admin: boolean;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  consentAt: string | null;
};

export const toAccountView = (a: Account, store: Store): AccountView => ({
  username: a.username,
  userId: a.userId,
  name: store.getUser(a.userId)?.name ?? a.userId,
  email: a.email,
  admin: a.admin,
  disabled: a.disabled,
  createdAt: a.createdAt,
  lastSeenAt: a.lastSeenAt,
  consentAt: a.consentAt,
});

export const listAccountViews = (db: AuthDb, store: Store, orgId: string): AccountView[] => db.listAccounts(orgId).map((a) => toAccountView(a, store));

export const updateAccountRequest = z
  .object({ admin: z.boolean(), disabled: z.boolean(), email: emailSchema.nullable() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "send admin, disabled, or email");

/** The account, if it exists and belongs to the caller's org (404 otherwise, so other orgs' usernames stay hidden). */
export function accountInOrg(db: AuthDb, orgId: string, username: string): Account {
  const a = db.getAccount(username);
  if (!a || a.orgId !== orgId) throw new HttpError(404, `unknown account "${normalizeUsername(username)}"`);
  return a;
}

/**
 * An admin changes admin, disabled, or email. Disabling revokes every session and token. The org always keeps one
 * active admin: demoting or disabling the last one is refused.
 */
export function updateAccountAs(db: AuthDb, actor: Principal, username: string, patch: z.infer<typeof updateAccountRequest>): Account {
  const target = accountInOrg(db, actor.orgId, username);
  const losesAdmin = target.admin && !target.disabled && (patch.admin === false || patch.disabled === true);
  if (losesAdmin) {
    const others = db.activeAdmins(actor.orgId).filter((u) => u !== target.username);
    if (others.length === 0) throw new HttpError(409, "the org needs at least one active admin; promote someone else first");
  }
  if (patch.email) assertEmailFree(db, patch.email, target.username);
  const updated = db.updateAccount(target.username, patch)!;
  audit(db, { orgId: actor.orgId, actor: actor.username, action: "account_updated", target: target.username, detail: { ...patch } });
  return updated;
}

/** A one-time reset link (24h) an admin copies and sends to the person. */
export async function issueResetLink(db: AuthDb, actor: Principal, username: string): Promise<{ resetUrl: string; expiresAt: string }> {
  const target = accountInOrg(db, actor.orgId, username);
  const { token, expiresAt } = db.createReset(target.username);
  const resetUrl = `${config.appUrl}/reset/${token}`;
  audit(db, { orgId: actor.orgId, actor: actor.username, action: "password_reset", target: target.username, detail: "link issued" });
  return { resetUrl, expiresAt };
}

export const resetRequest = z.object({ token: z.string().min(1).max(200), password: passwordSchema });

/** Spends a reset link and sets the password. Every session of the account is signed out. */
export async function resetPassword(db: AuthDb, body: z.infer<typeof resetRequest>): Promise<void> {
  const username = db.consumeReset(body.token);
  const account = username ? db.getAccount(username) : null;
  if (!account) throw new HttpError(400, "this reset link is invalid or has expired. Request a new one or ask an admin.");
  await db.setPassword(account.username, body.password);
  audit(db, { orgId: account.orgId, actor: account.username, action: "password_reset", target: account.username, detail: "completed" });
}

export const changePasswordRequest = z.object({ current: z.string().min(1).max(200), next: passwordSchema });

/** The caller changes their own password. Their other sessions are signed out; this one stays. */
export async function changePassword(db: AuthDb, p: Principal, body: z.infer<typeof changePasswordRequest>): Promise<void> {
  const stored = db.passwordHash(p.username);
  if (!stored || !(await verifyPassword(body.current, stored))) throw new HttpError(403, "current password is wrong");
  await db.setPassword(p.username, body.next, p.kind === "session" ? p.tokenId : undefined);
  audit(db, { orgId: p.orgId, actor: p.username, action: "password_changed", target: p.username });
}

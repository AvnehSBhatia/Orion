import { z } from "zod";
import { audit } from "@/audit/log";
import { config } from "@/config";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import type { AuthDb, Invite, Principal } from "./db";
import { assertEmailFree, createAccountIn, emailSchema, newAccountRequest, type LoginResult } from "./service";

export const createInviteRequest = z.object({
  admin: z.boolean().default(false),
  role: z.string().trim().min(1).max(400).optional(),
  /** Stored on the invite so the sign-up form can fill it in. Nothing is emailed. */
  email: emailSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
});

export type InviteView = Pick<Invite, "id" | "admin" | "role" | "email" | "name" | "createdBy" | "createdAt" | "expiresAt" | "usedBy">;

const toView = ({ id, admin, role, email, name, createdBy, createdAt, expiresAt, usedBy }: Invite): InviteView => ({
  id,
  admin,
  role,
  email,
  name,
  createdBy,
  createdAt,
  expiresAt,
  usedBy,
});

export type CreatedInvite = { id: string; inviteUrl: string; expiresAt: string };

/**
 * A one-use invite link (7 days) into the admin's org. The admin copies the link. 409 when an account already uses the email.
 */
export function createInviteAs(
  db: AuthDb,
  actor: Principal,
  body: z.infer<typeof createInviteRequest>,
  _names: { orgName: string; inviterName: string },
): CreatedInvite {
  assertEmailFree(db, body.email);
  const { token, invite } = db.createInvite({ orgId: actor.orgId, admin: body.admin, role: body.role ?? null, email: body.email, name: body.name, createdBy: actor.username });
  const inviteUrl = `${config.appUrl}/invite/${token}`;
  audit(db, { orgId: actor.orgId, actor: actor.username, action: "invite_created", target: invite.id, detail: { admin: invite.admin } });
  return { id: invite.id, inviteUrl, expiresAt: invite.expiresAt };
}

export const listInviteViews = (db: AuthDb, orgId: string): InviteView[] => db.listInvites(orgId).map(toView);

/** Cancels an invite of the admin's org. 404 for another org's. */
export function revokeInviteAs(db: AuthDb, actor: Principal, id: string): void {
  const invite = db.inviteById(id);
  if (!invite || invite.orgId !== actor.orgId) throw new HttpError(404, `unknown invite "${id}"`);
  db.deleteInvite(id);
}

/** What the invite page shows before sign-up, with the name and email the admin gave to fill in. 404 when unknown, used, or expired. */
export function inviteInfo(
  db: AuthDb,
  token: string,
  orgName: (orgId: string) => string,
): { orgName: string; expiresAt: string; email: string | null; name: string | null } {
  const invite = db.openInvite(token);
  if (!invite) throw new HttpError(404, "this invite is invalid, used, or expired");
  return { orgName: orgName(invite.orgId), expiresAt: invite.expiresAt, email: invite.email, name: invite.name };
}

export const acceptInviteRequest = z.object({
  token: z.string().min(1).max(200),
  username: newAccountRequest.shape.username,
  password: newAccountRequest.shape.password,
  name: z.string().trim().min(1).max(80),
  // The contract lists role as required; an invite can carry one, so it falls back to that, then "Member".
  role: z.string().trim().min(1).max(400).optional(),
  email: emailSchema.optional(),
});

/** Spends an invite: creates the account and the person in the invite's org, and signs them in. The email defaults to the one it was sent to. */
export async function acceptInvite(db: AuthDb, store: (orgId: string) => Store, body: z.infer<typeof acceptInviteRequest>): Promise<LoginResult> {
  const invite = db.openInvite(body.token);
  if (!invite) throw new HttpError(404, "this invite is invalid, used, or expired");
  const { account } = await createAccountIn(db, store(invite.orgId), invite.orgId, {
    username: body.username,
    password: body.password,
    name: body.name,
    role: body.role ?? invite.role ?? undefined,
    admin: invite.admin,
    email: body.email ?? invite.email ?? undefined,
  });
  if (!db.useInvite(invite.id, account.username)) {
    // Someone spent it between the check and now: undo the account.
    db.deleteAccount(account.username);
    throw new HttpError(404, "this invite is invalid, used, or expired");
  }
  const { token } = db.issueToken(account.username, "session", "invite");
  audit(db, { orgId: invite.orgId, actor: account.username, action: "invite_accepted", target: invite.id, detail: { createdBy: invite.createdBy, admin: invite.admin } });
  return { token, orgId: account.orgId, userId: account.userId, admin: account.admin, username: account.username };
}

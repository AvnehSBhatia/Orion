import { z } from "zod";
import { audit } from "@/audit/log";
import { config } from "@/config";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { sendMail } from "@/mail/mail";
import { inviteMail } from "@/mail/templates";
import type { EmailStatus } from "./accounts";
import { INVITE_DAYS, type AuthDb, type Invite, type Principal } from "./db";
import { assertEmailFree, createAccountIn, emailSchema, newAccountRequest, type LoginResult } from "./service";

export const createInviteRequest = z.object({
  admin: z.boolean().default(false),
  role: z.string().trim().min(1).max(400).optional(),
  /** Who to email the link to. Without it the admin copies the link by hand. */
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

export type CreatedInvite = { id: string; inviteUrl: string; expiresAt: string; emailStatus: EmailStatus };

/**
 * A one-use invite link (7 days) into the admin's org, emailed to `email` when given. The link comes back either
 * way, so the admin can copy it when the email did not go out. 409 when an account already uses the email.
 */
export async function createInviteAs(
  db: AuthDb,
  actor: Principal,
  body: z.infer<typeof createInviteRequest>,
  names: { orgName: string; inviterName: string },
): Promise<CreatedInvite> {
  assertEmailFree(db, body.email);
  const { token, invite } = db.createInvite({ orgId: actor.orgId, admin: body.admin, role: body.role ?? null, email: body.email, name: body.name, createdBy: actor.username });
  const inviteUrl = `${config.appUrl}/invite/${token}`;
  audit(db, { orgId: actor.orgId, actor: actor.username, action: "invite_created", target: invite.id, detail: { admin: invite.admin } });
  let emailStatus: EmailStatus = null;
  if (invite.email) {
    emailStatus = await sendMail(inviteMail({ to: invite.email, name: invite.name, orgName: names.orgName, invitedBy: names.inviterName, url: inviteUrl, days: INVITE_DAYS }));
    if (emailStatus === "sent") audit(db, { orgId: actor.orgId, actor: actor.username, action: "invite_sent", target: invite.id });
  }
  return { id: invite.id, inviteUrl, expiresAt: invite.expiresAt, emailStatus };
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

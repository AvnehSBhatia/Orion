import { z } from "zod";
import { audit } from "@/audit/log";
import type { Store } from "@/db/store";
import { HttpError, tooManyRequests } from "@/http/error";
import { dummyHash, verifyPassword } from "./crypto";
import { MIN_PASSWORD, normalizeUsername, type Account, type AuthDb } from "./db";
import type { LoginLimiter } from "./ratelimit";

export const loginRequest = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(200) });

export const userIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "userId must be lowercase letters, digits, and dashes");
export const passwordSchema = z.string().min(MIN_PASSWORD, `password must be at least ${MIN_PASSWORD} characters`).max(200);
export const emailSchema = z.string().trim().toLowerCase().max(200).email("email must be a valid address");

export const newAccountRequest = z.object({
  username: z.string().trim().min(2).max(40),
  password: passwordSchema,
  userId: userIdSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  role: z.string().trim().max(400).optional(),
  admin: z.boolean().optional(),
  email: emailSchema.optional(),
});

export type LoginResult = { token: string; orgId: string; userId: string; admin: boolean; username: string };

/** The login response body (the same token is set as the session cookie). */
export const loginBody = (r: LoginResult) => ({ token: r.token, orgId: r.orgId, userId: r.userId, admin: r.admin, username: r.username });

/**
 * Checks the password and issues a session token. 429 after 10 failures per ip+username in 15 minutes; 403 for a
 * disabled account (only once the password is right, so the status leaks nothing to a guesser).
 */
export async function login(db: AuthDb, limiter: LoginLimiter, input: { username: string; password: string; ip: string }): Promise<LoginResult> {
  const username = normalizeUsername(input.username);
  const key = `${input.ip}|${username}`;
  const wait = limiter.blockedFor(key);
  if (wait) throw tooManyRequests(wait, `too many failed sign-ins. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  const stored = db.passwordHash(username);
  const ok = await verifyPassword(input.password, stored ?? (await dummyHash()));
  const account = stored ? db.getAccount(username) : null;
  if (!account || !ok) {
    limiter.fail(key);
    audit(db, { orgId: account?.orgId ?? null, actor: null, action: "login_failed", target: username });
    throw new HttpError(401, "wrong username or password");
  }
  limiter.reset(key);
  if (account.disabled) {
    audit(db, { orgId: account.orgId, actor: username, action: "login_failed", target: username, detail: "account disabled" });
    throw new HttpError(403, "this account is disabled. Ask an admin of your org.");
  }
  const { token } = db.issueToken(username, "session", "login");
  audit(db, { orgId: account.orgId, actor: username, action: "login", target: username });
  return { token, orgId: account.orgId, userId: account.userId, admin: account.admin, username };
}

/** Adds the person to the org if they are not in it yet. Returns true when it created them. */
export function ensurePerson(store: Store, userId: string, name?: string, role?: string): boolean {
  if (store.getUser(userId)) return false;
  store.saveUser({ id: userId, name: name || userId, role: role || "Member", teamDescription: "" });
  return true;
}

/** A userId free in the org (and in auth.db for it), from the username: "sam.k" becomes "sam-k", then "sam-k-2". */
function freeUserId(db: AuthDb, store: Store, orgId: string, username: string): string {
  const base = userIdSchema.parse(username.replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 36) || "user");
  let id = base;
  for (let i = 2; store.getUser(id) || db.accountsForUser(orgId, id).length; i++) id = `${base}-${i}`;
  return id;
}

/**
 * Creates an account in an org (and the person in it). Errors from the db become 400/409. An explicit `userId`
 * joins an existing person (an admin adding a second login); without one, a fresh id is picked, so a new account
 * never lands on someone else's data by accident.
 */
export async function createAccountIn(
  db: AuthDb,
  store: Store,
  orgId: string,
  body: z.infer<typeof newAccountRequest>,
): Promise<{ account: Account; created: boolean }> {
  const username = normalizeUsername(body.username);
  if (db.getAccount(username)) throw new HttpError(409, `username "${username}" is taken`);
  const userId = body.userId ?? freeUserId(db, store, orgId, username);
  let account: Account;
  try {
    account = await db.createAccount({ username, password: body.password, orgId, userId, admin: body.admin, email: body.email ?? null });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
  const created = ensurePerson(store, userId, body.name, body.role);
  return { account, created };
}

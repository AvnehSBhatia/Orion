import { z } from "zod";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { dummyHash, verifyPassword } from "./crypto";
import { MIN_PASSWORD, normalizeUsername, type Account, type AuthDb } from "./db";
import type { LoginLimiter } from "./ratelimit";

export const loginRequest = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(200) });

const userIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "userId must be lowercase letters, digits, and dashes");

export const newAccountRequest = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(MIN_PASSWORD, `password must be at least ${MIN_PASSWORD} characters`).max(200),
  userId: userIdSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  role: z.string().trim().max(400).optional(),
  admin: z.boolean().optional(),
});

export type LoginResult = { token: string; orgId: string; userId: string; admin: boolean; username: string };

/** Checks the password and issues a session token. 429 after 10 failures per ip+username in 15 minutes. */
export async function login(db: AuthDb, limiter: LoginLimiter, input: { username: string; password: string; ip: string }): Promise<LoginResult> {
  const username = normalizeUsername(input.username);
  const key = `${input.ip}|${username}`;
  const wait = limiter.blockedFor(key);
  if (wait) throw new HttpError(429, `too many failed sign-ins. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  const stored = db.passwordHash(username);
  const ok = await verifyPassword(input.password, stored ?? (await dummyHash()));
  if (!stored || !ok) {
    limiter.fail(key);
    throw new HttpError(401, "wrong username or password");
  }
  limiter.reset(key);
  const account = db.getAccount(username)!;
  const { token } = db.issueToken(username, "session", "login");
  return { token, orgId: account.orgId, userId: account.userId, admin: account.admin, username };
}

/** Adds the person to the org if they are not in it yet. Returns true when it created them. */
export function ensurePerson(store: Store, userId: string, name?: string, role?: string): boolean {
  if (store.getUser(userId)) return false;
  store.saveUser({ id: userId, name: name || userId, role: role || "Member", teamDescription: "" });
  return true;
}

/** Creates an account in an org (and the person in it). Errors from the db become 400/409. */
export async function createAccountIn(db: AuthDb, store: Store, orgId: string, body: z.infer<typeof newAccountRequest>): Promise<{ account: Account; created: boolean }> {
  const username = normalizeUsername(body.username);
  if (db.getAccount(username)) throw new HttpError(409, `username "${username}" is taken`);
  const userId = body.userId ?? userIdSchema.parse(username.replace(/[^a-z0-9-]/g, "-").slice(0, 40));
  let account: Account;
  try {
    account = await db.createAccount({ username, password: body.password, orgId, userId, admin: body.admin });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
  const created = ensurePerson(store, userId, body.name, body.role);
  return { account, created };
}

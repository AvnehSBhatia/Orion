import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/audit/log";
import { memoryStore } from "@/test/helpers";
import { saveOrgSettings } from "@/orgs/settings";
import { changePassword, issueResetLink, resetPassword, updateAccountAs } from "./accounts";
import { assertConsent, consentState } from "./consent";
import { AuthDb, type Principal } from "./db";
import { acceptInvite, createInviteAs, inviteInfo, revokeInviteAs } from "./invites";
import { LoginLimiter } from "./ratelimit";
import { createAccountIn, login } from "./service";
import { createApiToken, revokeTokenAs } from "./tokens";

const asPrincipal = (db: AuthDb, username: string, kind: "session" | "api" = "session"): Principal & { token: string } => {
  const { token } = db.issueToken(username, kind);
  return { ...db.resolveToken(token)!, token };
};

describe("auth.db migrations", () => {
  it("adds the new account columns to a file made before they existed, keeping its rows", () => {
    const raw = new Database(":memory:");
    raw.exec(`CREATE TABLE accounts (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
      admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      INSERT INTO accounts VALUES ('old', 'scrypt$x', 'acme', 'old', 1, '2026-01-01T00:00:00.000Z');`);
    const db = new AuthDb(raw);
    const cols = (raw.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["email", "disabled", "last_seen_at", "consent_version", "consent_at"]));
    expect(db.getAccount("old")).toMatchObject({ admin: true, email: null, disabled: false, consentVersion: 0, consentAt: null, lastSeenAt: null });
    // Opening twice is a no-op.
    expect(() => new AuthDb(raw)).not.toThrow();
  });
});

describe("accounts", () => {
  let db: AuthDb;
  beforeEach(async () => {
    db = AuthDb.open(":memory:");
    await db.createAccount({ username: "boss", password: "password1", orgId: "acme", userId: "boss", admin: true, email: "boss@acme.test" });
    await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
    await db.createAccount({ username: "zed", password: "password1", orgId: "other", userId: "zed", admin: true });
  });

  it("records last seen when a token is used", () => {
    expect(db.getAccount("devon")!.lastSeenAt).toBeNull();
    asPrincipal(db, "devon");
    expect(db.getAccount("devon")!.lastSeenAt).not.toBeNull();
  });

  it("disabling revokes every token, rejects tokens, and makes login 403", async () => {
    const boss = asPrincipal(db, "boss");
    const s = db.issueToken("devon", "session");
    const a = db.issueToken("devon", "api");
    updateAccountAs(db, boss, "devon", { disabled: true });
    expect(db.resolveToken(s.token)).toBeNull();
    expect(db.resolveToken(a.token)).toBeNull();
    expect(db.listTokens("devon")).toHaveLength(0);
    await expect(login(db, new LoginLimiter(), { username: "devon", password: "password1", ip: "x" })).rejects.toMatchObject({ status: 403 });
    // A wrong password still says 401, so the disabled state is not leaked to a guesser.
    await expect(login(db, new LoginLimiter(), { username: "devon", password: "nope", ip: "x" })).rejects.toMatchObject({ status: 401 });
    // A token issued while disabled is rejected too.
    expect(db.resolveToken(db.issueToken("devon", "api").token)).toBeNull();
    updateAccountAs(db, boss, "devon", { disabled: false });
    await expect(login(db, new LoginLimiter(), { username: "devon", password: "password1", ip: "x" })).resolves.toMatchObject({ userId: "devon" });
  });

  it("keeps one active admin and hides other orgs' accounts", async () => {
    const boss = asPrincipal(db, "boss");
    expect(() => updateAccountAs(db, boss, "boss", { admin: false })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => updateAccountAs(db, boss, "boss", { disabled: true })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => updateAccountAs(db, boss, "zed", { disabled: true })).toThrow(expect.objectContaining({ status: 404 }));
    updateAccountAs(db, boss, "devon", { admin: true, email: "devon@acme.test" });
    expect(db.getAccount("devon")).toMatchObject({ admin: true, email: "devon@acme.test" });
    // With a second admin, the first may step down.
    expect(updateAccountAs(db, boss, "boss", { admin: false }).admin).toBe(false);
    expect(listAudit(db, "acme").map((e) => e.action)).toEqual(["account_updated", "account_updated"]);
  });

  it("changes a password, keeping the session that did it and signing out the others", async () => {
    const me = asPrincipal(db, "devon");
    const other = db.issueToken("devon", "session");
    const api = db.issueToken("devon", "api");
    await expect(changePassword(db, me, { current: "wrong", next: "password2" })).rejects.toMatchObject({ status: 403 });
    await changePassword(db, me, { current: "password1", next: "password2" });
    expect(db.resolveToken(me.token)).not.toBeNull();
    expect(db.resolveToken(other.token)).toBeNull();
    expect(db.resolveToken(api.token)).not.toBeNull();
    await expect(login(db, new LoginLimiter(), { username: "devon", password: "password2", ip: "x" })).resolves.toBeTruthy();
    expect(listAudit(db, "acme")[1]).toMatchObject({ action: "password_changed", actor: "devon" });
  });

  it("issues a one-time 24h reset link that signs out every session", async () => {
    const boss = asPrincipal(db, "boss");
    const s = db.issueToken("devon", "session");
    const { resetUrl, expiresAt } = await issueResetLink(db, boss, "devon");
    expect(resetUrl).toMatch(/^http:\/\/localhost:3000\/reset\/[\w-]{43}$/);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    await expect(issueResetLink(db, boss, "zed")).rejects.toMatchObject({ status: 404 });
    const token = resetUrl.split("/").pop()!;
    await resetPassword(db, { token, password: "brandnew1" });
    expect(db.resolveToken(s.token)).toBeNull();
    await expect(resetPassword(db, { token, password: "again1234" })).rejects.toMatchObject({ status: 400 });
    await expect(login(db, new LoginLimiter(), { username: "devon", password: "brandnew1", ip: "x" })).resolves.toBeTruthy();
  });

  it("refuses an expired reset link", async () => {
    const { token } = db.createReset("devon");
    db.db.prepare("UPDATE resets SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    await expect(resetPassword(db, { token, password: "brandnew1" })).rejects.toMatchObject({ status: 400 });
  });

  it("audits token create and revoke, and only lets owners or same-org admins revoke", () => {
    const devon = asPrincipal(db, "devon");
    const zed = asPrincipal(db, "zed");
    const boss = asPrincipal(db, "boss");
    const t = createApiToken(db, devon, "laptop");
    expect(() => revokeTokenAs(db, zed, t.id)).toThrow(expect.objectContaining({ status: 404 }));
    revokeTokenAs(db, boss, t.id);
    expect(db.tokenById(t.id)).toBeNull();
    expect(listAudit(db, "acme").map((e) => e.action)).toEqual(["token_revoked", "token_created"]);
  });

  it("logs sign-ins and failures", async () => {
    await login(db, new LoginLimiter(), { username: "devon", password: "password1", ip: "x" }).catch(() => {});
    await login(db, new LoginLimiter(), { username: "devon", password: "bad", ip: "x" }).catch(() => {});
    expect(listAudit(db, "acme").map((e) => e.action)).toEqual(["login_failed", "login"]);
  });
});

const NAMES = { orgName: "Acme", inviterName: "Boss" };

describe("invites", () => {
  let db: AuthDb;
  const store = memoryStore();
  beforeEach(async () => {
    db = AuthDb.open(":memory:");
    await db.createAccount({ username: "boss", password: "password1", orgId: "acme", userId: "boss", admin: true });
  });

  it("creates a 7-day one-use link that makes an account in the org and signs in", async () => {
    const boss = asPrincipal(db, "boss");
    const inv = await createInviteAs(db, boss, { admin: false, role: "Designer" }, NAMES);
    expect(inv.inviteUrl).toMatch(/^http:\/\/localhost:3000\/invite\/[\w-]{43}$/);
    expect(Date.parse(inv.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const token = inv.inviteUrl.split("/").pop()!;
    expect(inviteInfo(db, token, () => "Acme")).toEqual({ orgName: "Acme", expiresAt: inv.expiresAt, email: null, name: null });

    const r = await acceptInvite(db, () => store, { token, username: "new.person", password: "password1", name: "New Person", email: "n@acme.test" });
    expect(r).toMatchObject({ orgId: "acme", userId: "new-person", admin: false, username: "new.person" });
    expect(db.resolveToken(r.token)?.kind).toBe("session");
    expect(db.getAccount("new.person")!.email).toBe("n@acme.test");
    expect(store.getUser("new-person")).toMatchObject({ name: "New Person", role: "Designer" });
    expect(db.listInvites("acme")[0].usedBy).toBe("new.person");
    // One use.
    expect(() => inviteInfo(db, token, () => "Acme")).toThrow(expect.objectContaining({ status: 404 }));
    await expect(acceptInvite(db, () => store, { token, username: "second", password: "password1", name: "S" })).rejects.toMatchObject({ status: 404 });
    expect(listAudit(db, "acme").map((e) => e.action)).toEqual(["invite_accepted", "invite_created"]);
  });

  it("expires, revokes, and stays in its org", async () => {
    const boss = asPrincipal(db, "boss");
    await db.createAccount({ username: "zed", password: "password1", orgId: "other", userId: "zed", admin: true });
    const zed = asPrincipal(db, "zed");
    const inv = await createInviteAs(db, boss, { admin: true }, NAMES);
    expect(() => revokeInviteAs(db, zed, inv.id)).toThrow(expect.objectContaining({ status: 404 }));
    revokeInviteAs(db, boss, inv.id);
    expect(db.listInvites("acme")).toHaveLength(0);
    const old = await createInviteAs(db, boss, { admin: false }, NAMES);
    db.db.prepare("UPDATE invites SET expires_at = ?").run(new Date(Date.now() - 1).toISOString());
    expect(() => inviteInfo(db, old.inviteUrl.split("/").pop()!, () => "x")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("refuses a taken username without spending the invite", async () => {
    const boss = asPrincipal(db, "boss");
    const token = (await createInviteAs(db, boss, { admin: false }, NAMES)).inviteUrl.split("/").pop()!;
    await expect(acceptInvite(db, () => store, { token, username: "boss", password: "password1", name: "B" })).rejects.toMatchObject({ status: 409 });
    expect(db.openInvite(token)).not.toBeNull();
  });
});

describe("account creation", () => {
  it("never lands a new account on an existing person unless asked", async () => {
    const db = AuthDb.open(":memory:");
    const store = memoryStore();
    store.saveUser({ id: "sam", name: "Sam", role: "Sales", teamDescription: "" });
    const { account } = await createAccountIn(db, store, "acme", { username: "sam", password: "password1" });
    expect(account.userId).toBe("sam-2");
    const second = await createAccountIn(db, store, "acme", { username: "sam.laptop", password: "password1", userId: "sam" });
    expect(second.account.userId).toBe("sam");
  });
});

describe("monitoring notice", () => {
  it("strips the draft banner, comments, and mock buttons, and falls back to a built-in text", async () => {
    const { cleanNotice, monitoringNotice } = await import("./notice");
    const md = "> **DRAFT — needs review.** x\n\n# Title\n\nBody.\n\n---\n\n[ ] I've read this\n\n**[ Accept and continue ]**\n\n<!-- notes -->";
    expect(cleanNotice(md)).toBe("# Title\n\nBody.");
    const notice = monitoringNotice();
    expect(notice).toMatch(/^# /);
    expect(notice).not.toContain("DRAFT");
  });
});

describe("consent", () => {
  it("is required until the current version is accepted, and again after a bump", async () => {
    const db = AuthDb.open(":memory:");
    const store = memoryStore();
    await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
    let a = db.getAccount("devon")!;
    expect(consentState(a, store)).toEqual({ required: true, version: 1, acceptedAt: null });
    expect(() => assertConsent(a, store)).toThrow(expect.objectContaining({ status: 403, message: "consent required" }));
    a = db.setConsent("devon", 1)!;
    expect(consentState(a, store)).toMatchObject({ required: false, version: 1, acceptedAt: a.consentAt });
    expect(() => assertConsent(a, store)).not.toThrow();
    saveOrgSettings(store, { consentVersion: 2 });
    expect(consentState(a, store)).toEqual({ required: true, version: 2, acceptedAt: null });
    // Auth disabled: nobody to ask.
    expect(() => assertConsent(null, store)).not.toThrow();
  });
});

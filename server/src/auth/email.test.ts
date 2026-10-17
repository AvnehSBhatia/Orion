import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/audit/log";
import { setMailTransport, type Mail } from "@/mail/mail";
import { memoryStore } from "@/test/helpers";
import { forgotPassword, issueResetLink, resetPassword, updateAccountAs } from "./accounts";
import { AuthDb, setAuthDb, type Principal } from "./db";
import { acceptInvite, createInviteAs, inviteInfo } from "./invites";
import { LoginLimiter } from "./ratelimit";
import { createAccountIn, login } from "./service";

const NAMES = { orgName: "Acme", inviterName: "Boss Person" };

/** Collects mail instead of sending it. */
function fakeTransport() {
  const sent: (Mail & { from: string })[] = [];
  setMailTransport({ sendMail: async (m) => void sent.push(m) });
  return sent;
}

const asPrincipal = (db: AuthDb, username: string): Principal => db.resolveToken(db.issueToken(username, "session").token)!;
const linkIn = (m: Mail) => m.text.match(/https?:\/\/\S+/)![0];
const allAudit = (db: AuthDb) => db.db.prepare("SELECT action, target, detail FROM audit").all() as { action: string; target: string | null; detail: string | null }[];

let db: AuthDb;
beforeEach(async () => {
  db = AuthDb.open(":memory:");
  await db.createAccount({ username: "boss", password: "password1", orgId: "acme", userId: "boss", admin: true, email: "boss@acme.test" });
  await db.createAccount({ username: "priya", password: "password1", orgId: "acme", userId: "priya", email: "Priya@Acme.test" });
  await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
});
afterEach(() => setMailTransport(undefined));

describe("forgot password", () => {
  it("answers the same whether or not an account uses the email, and emails only a real one", async () => {
    const sent = fakeTransport();
    const real = forgotPassword(db, new LoginLimiter(3), { email: "priya@acme.test" });
    const unknown = forgotPassword(db, new LoginLimiter(3), { email: "nobody@acme.test" });
    await Promise.all([real.delivery, unknown.delivery]);
    expect(real.answer).toEqual(unknown.answer);
    expect(real.answer.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("priya@acme.test");
    expect(sent[0].html).toContain(linkIn(sent[0]));

    // The emailed link is a normal one-time reset link.
    const token = linkIn(sent[0]).split("/").pop()!;
    await resetPassword(db, { token, password: "brandnew1" });
    await expect(resetPassword(db, { token, password: "again1234" })).rejects.toMatchObject({ status: 400 });
    await expect(login(db, new LoginLimiter(), { username: "priya", password: "brandnew1", ip: "x" })).resolves.toBeTruthy();

    const actions = allAudit(db).map((e) => e.action);
    expect(actions.filter((a) => a === "reset_requested")).toHaveLength(2);
    expect(actions).toContain("reset_emailed");
    expect(JSON.stringify(allAudit(db))).not.toContain(token);
  });

  it("gives the same answer through the route, and says when email is not set up", async () => {
    setAuthDb(db);
    const { POST } = await import("../../app/api/auth/forgot/route");
    const call = async (email: string) => {
      const res = await POST(
        new NextRequest("http://localhost/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ email }) }),
        {},
      );
      return { status: res.status, body: await res.json() };
    };
    try {
      fakeTransport();
      const a = await call("priya@acme.test");
      const b = await call("nobody@acme.test");
      expect(a).toEqual(b);
      expect(a.status).toBe(200);

      setMailTransport(null);
      const off = await call("priya@acme.test");
      expect(off).toEqual(await call("nobody@acme.test"));
      expect(off.body.sent).toBe("not_configured");
    } finally {
      setAuthDb(undefined);
    }
  });

  it("skips disabled accounts and caps emails per account", async () => {
    const sent = fakeTransport();
    const limiter = new LoginLimiter(3, 3_600_000);
    for (let i = 0; i < 5; i++) await forgotPassword(db, limiter, { email: "priya@acme.test" }).delivery;
    expect(sent).toHaveLength(3);
    db.updateAccount("boss", { disabled: true });
    await forgotPassword(db, limiter, { email: "boss@acme.test" }).delivery;
    expect(sent).toHaveLength(3);
  });
});

describe("sign in with email", () => {
  it("accepts the email in any case, and usernames still work", async () => {
    await expect(login(db, new LoginLimiter(), { username: "PRIYA@acme.TEST", password: "password1", ip: "x" })).resolves.toMatchObject({ username: "priya" });
    await expect(login(db, new LoginLimiter(), { username: "priya", password: "password1", ip: "x" })).resolves.toMatchObject({ username: "priya" });
    await expect(login(db, new LoginLimiter(), { username: "priya@acme.test", password: "wrong", ip: "x" })).rejects.toMatchObject({ status: 401 });
    await expect(login(db, new LoginLimiter(), { username: "nobody@acme.test", password: "password1", ip: "x" })).rejects.toMatchObject({ status: 401 });
  });
});

describe("unique emails", () => {
  it("refuses a second account or an update with an email already in use (409)", async () => {
    const store = memoryStore();
    const boss = asPrincipal(db, "boss");
    await expect(createAccountIn(db, store, "acme", { username: "sam", password: "password1", email: "priya@acme.test" })).rejects.toMatchObject({ status: 409 });
    expect(() => updateAccountAs(db, boss, "devon", { email: "PRIYA@acme.test" })).toThrow(expect.objectContaining({ status: 409 }));
    // Keeping your own email is fine.
    expect(updateAccountAs(db, boss, "priya", { email: "priya@acme.test" }).email).toBe("priya@acme.test");
    await expect(createInviteAs(db, boss, { admin: false, email: "priya@acme.test" }, NAMES)).rejects.toMatchObject({ status: 409 });
    await expect(db.createAccount({ username: "x2", password: "password1", orgId: "acme", userId: "x2", email: "priya@ACME.test" })).rejects.toThrow(/already uses/);
  });
});

describe("invite email", () => {
  it("emails the link, records the email on the account, and audits without the link", async () => {
    const sent = fakeTransport();
    const boss = asPrincipal(db, "boss");
    const inv = await createInviteAs(db, boss, { admin: false, email: "New@Acme.test", name: "New Person" }, NAMES);
    expect(inv.emailStatus).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "new@acme.test", subject: "Join Acme on Orion" });
    expect(linkIn(sent[0])).toBe(inv.inviteUrl);
    expect(sent[0].text).toContain("Boss Person invited you");

    const token = inv.inviteUrl.split("/").pop()!;
    expect(inviteInfo(db, token, () => "Acme")).toMatchObject({ email: "new@acme.test", name: "New Person" });
    await acceptInvite(db, () => memoryStore(), { token, username: "newbie", password: "password1", name: "New Person" });
    expect(db.getAccount("newbie")!.email).toBe("new@acme.test");

    expect(listAudit(db, "acme").map((e) => e.action)).toContain("invite_sent");
    expect(JSON.stringify(allAudit(db))).not.toContain(token);
  });

  it("still returns the link when email is not set up or fails", async () => {
    const boss = asPrincipal(db, "boss");
    setMailTransport(null);
    const off = await createInviteAs(db, boss, { admin: false, email: "a@acme.test" }, NAMES);
    expect(off).toMatchObject({ emailStatus: "not_configured", inviteUrl: expect.stringContaining("/invite/") });
    setMailTransport({ sendMail: async () => Promise.reject(new Error("smtp down")) });
    expect((await createInviteAs(db, boss, { admin: false, email: "b@acme.test" }, NAMES)).emailStatus).toBe("failed");
    expect((await createInviteAs(db, boss, { admin: false }, NAMES)).emailStatus).toBeNull();
    expect(listAudit(db, "acme").map((e) => e.action)).not.toContain("invite_sent");
  });

  it("emails an admin's reset link to the person when they have an email", async () => {
    const sent = fakeTransport();
    const boss = asPrincipal(db, "boss");
    const r = await issueResetLink(db, boss, "priya");
    expect(r.emailStatus).toBe("sent");
    expect(linkIn(sent[0])).toBe(r.resetUrl);
    expect((await issueResetLink(db, boss, "devon")).emailStatus).toBeNull();
    expect(sent).toHaveLength(1);
    expect(listAudit(db, "acme").map((e) => e.action)).toContain("reset_emailed");
  });
});

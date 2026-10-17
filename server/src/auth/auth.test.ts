import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actingAs, adminOnly, route, sameOrg, scopedBody, scopedQuery } from "@/http/route";
import { memoryStore } from "@/test/helpers";
import { hashPassword, sha256, verifyPassword } from "./crypto";
import { AuthDb, setAuthDb, type Principal } from "./db";
import { LoginLimiter } from "./ratelimit";
import { SESSION_COOKIE, sessionCookie } from "./request";
import { assertActingAs, scopeInput } from "./scope";
import { createAccountIn, login } from "./service";

const principal = (over: Partial<Principal> = {}): Principal => ({
  username: "devon",
  orgId: "acme",
  userId: "devon",
  admin: false,
  createdAt: "",
  email: null,
  disabled: false,
  lastSeenAt: null,
  consentVersion: 0,
  consentAt: null,
  tokenId: "t1",
  kind: "session",
  ...over,
});

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("correct hors", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });
});

describe("tokens", () => {
  let db: AuthDb;
  beforeEach(async () => {
    db = AuthDb.open(":memory:");
    await db.createAccount({ username: "Devon", password: "password1", orgId: "acme", userId: "devon" });
  });

  it("lowercases usernames and enforces password length", async () => {
    expect(db.getAccount("DEVON")?.username).toBe("devon");
    await expect(db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "d" })).rejects.toThrow(/taken/);
    await expect(db.createAccount({ username: "sam", password: "short", orgId: "acme", userId: "sam" })).rejects.toThrow(/at least/);
  });

  it("stores only the sha256 of a 32-byte token and resolves it", () => {
    const { token, info } = db.issueToken("devon", "api", "mcp");
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    const row = db.db.prepare("SELECT hash FROM tokens WHERE id = ?").get(info.id) as { hash: string };
    expect(row.hash).toBe(sha256(token));
    expect(JSON.stringify(db.db.prepare("SELECT * FROM tokens").all())).not.toContain(token);
    expect(db.resolveToken(token)).toMatchObject({ username: "devon", orgId: "acme", userId: "devon", kind: "api" });
    expect(db.resolveToken(token + "x")).toBeNull();
    expect(info.expiresAt).toBeNull();
  });

  it("expires sessions after 30 days and revokes", () => {
    const { token, info } = db.issueToken("devon", "session");
    expect(Date.parse(info.expiresAt!) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(db.resolveToken(token)).not.toBeNull();
    db.db.prepare("UPDATE tokens SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), info.id);
    expect(db.resolveToken(token)).toBeNull();
    const api = db.issueToken("devon", "api");
    expect(db.revokeToken(api.info.id)).toBe(true);
    expect(db.resolveToken(api.token)).toBeNull();
  });

  it("signs out sessions on a password change", async () => {
    const s = db.issueToken("devon", "session");
    const a = db.issueToken("devon", "api");
    await db.setPassword("devon", "password2");
    expect(db.resolveToken(s.token)).toBeNull();
    expect(db.resolveToken(a.token)).not.toBeNull();
  });
});

describe("login", () => {
  it("issues a session for the right password", async () => {
    const db = AuthDb.open(":memory:");
    await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon", admin: true });
    const r = await login(db, new LoginLimiter(), { username: " DEVON ", password: "password1", ip: "1.2.3.4" });
    expect(r).toMatchObject({ orgId: "acme", userId: "devon", admin: true });
    expect(db.resolveToken(r.token)?.kind).toBe("session");
  });

  it("returns 401 for a wrong password or unknown user, then 429 after 10 failures", async () => {
    const db = AuthDb.open(":memory:");
    await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
    const limiter = new LoginLimiter();
    await expect(login(db, limiter, { username: "nobody", password: "x", ip: "ip" })).rejects.toMatchObject({ status: 401 });
    for (let i = 0; i < 10; i++) await expect(login(db, limiter, { username: "devon", password: "nope", ip: "ip" })).rejects.toMatchObject({ status: 401 });
    // Even the right password is refused while blocked.
    await expect(login(db, limiter, { username: "devon", password: "password1", ip: "ip" })).rejects.toMatchObject({ status: 429 });
    // Another ip is its own bucket.
    await expect(login(db, limiter, { username: "devon", password: "password1", ip: "other" })).resolves.toBeTruthy();
  });

  it("forgets failures after the 15 minute window and on success", () => {
    const l = new LoginLimiter(10, 15 * 60_000);
    for (let i = 0; i < 10; i++) l.fail("k", 0);
    expect(l.blockedFor("k", 1000)).toBeGreaterThan(0);
    expect(l.blockedFor("k", 15 * 60_000 + 1)).toBe(0);
    for (let i = 0; i < 9; i++) l.fail("j", 0);
    l.reset("j");
    l.fail("j", 0);
    expect(l.blockedFor("j", 0)).toBe(0);
  });
});

describe("scoping", () => {
  it("fills a missing orgId and userId, and refuses another org", () => {
    const p = principal();
    expect(scopeInput(p, { limit: "5" })).toEqual({ limit: "5", orgId: "acme" });
    expect(scopeInput(p, { orgId: "acme" }, { user: true })).toEqual({ orgId: "acme", userId: "devon" });
    expect(() => scopeInput(p, { orgId: "demo" })).toThrow(expect.objectContaining({ status: 403 }));
    // Auth disabled: untouched.
    expect(scopeInput(null, { orgId: "demo" })).toEqual({ orgId: "demo" });
  });

  it("lets only the same person or an admin act as someone", () => {
    expect(() => assertActingAs(principal(), "devon")).not.toThrow();
    expect(() => assertActingAs(principal(), "priya")).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertActingAs(principal({ admin: true }), "priya")).not.toThrow();
  });

  it("creates the person when an account is added to an org", async () => {
    const db = AuthDb.open(":memory:");
    const store = memoryStore();
    const { account, created } = await createAccountIn(db, store, "acme", { username: "sam.k", password: "password1" });
    expect(account.userId).toBe("sam-k");
    expect(created).toBe(true);
    expect(store.getUser("sam-k")?.name).toBe("sam-k");
  });
});

describe("route() sign-in", () => {
  let db: AuthDb;
  let devon: string;
  let admin: string;
  const handler = route(async (req: NextRequest) => {
    const q = scopedQuery(req, { user: true });
    if (req.method === "POST") {
      const body = (await scopedBody(req, { user: true })) as { userId: string };
      actingAs(req, body.userId);
      return body;
    }
    if (q.who === "admin") adminOnly(req);
    if (q.path) sameOrg(req, q.path);
    return q;
  });
  const call = (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    handler(
      new NextRequest(`http://localhost${url}`, {
        method: init.method ?? "GET",
        headers: { origin: "http://localhost:3000", ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      {},
    );

  beforeEach(async () => {
    db = AuthDb.open(":memory:");
    setAuthDb(db);
    await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
    await db.createAccount({ username: "boss", password: "password1", orgId: "acme", userId: "boss", admin: true });
    devon = db.issueToken("devon", "session").token;
    admin = db.issueToken("boss", "api").token;
  });
  afterEach(() => {
    setAuthDb(undefined);
    delete process.env.AUTH_DISABLED;
  });

  it("401s without a token or with a bad one, with CORS credentials headers", async () => {
    const res = await call("/api/graph");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sign in required" });
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect((await call("/api/graph", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("accepts the session cookie and a bearer token, pinning org and user", async () => {
    const res = await call("/api/graph", { headers: { cookie: `${SESSION_COOKIE}=${devon}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "acme", userId: "devon" });
    expect((await call("/api/graph?orgId=acme", { headers: { authorization: `Bearer ${admin}` } })).status).toBe(200);
  });

  it("403s on another org, on acting as another person, and on admin-only work", async () => {
    const auth = { authorization: `Bearer ${devon}` };
    expect((await call("/api/graph?orgId=demo", { headers: auth })).status).toBe(403);
    expect((await call("/api/graph?path=demo", { headers: auth })).status).toBe(403);
    expect((await call("/api/graph?who=admin", { headers: auth })).status).toBe(403);
    expect((await call("/api/chat", { method: "POST", headers: auth, body: { userId: "boss" } })).status).toBe(403);
    expect((await call("/api/chat", { method: "POST", headers: auth, body: { orgId: "demo" } })).status).toBe(403);
    expect((await call("/api/chat", { method: "POST", headers: auth, body: {} })).status).toBe(200);
    // An admin may act for anyone in the org.
    expect((await call("/api/chat", { method: "POST", headers: { authorization: `Bearer ${admin}` }, body: { userId: "devon" } })).status).toBe(200);
  });

  it("skips sign-in when AUTH_DISABLED=true", async () => {
    process.env.AUTH_DISABLED = "true";
    const res = await call("/api/graph?orgId=demo");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "demo" });
  });

  it("builds an HttpOnly SameSite=Lax 30-day cookie", () => {
    const c = sessionCookie("abc");
    expect(c).toContain(`${SESSION_COOKIE}=abc`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain(`Max-Age=${30 * 86_400}`);
    expect(c).not.toContain("Secure");
  });
});

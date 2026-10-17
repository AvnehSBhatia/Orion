import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthDb, type Principal } from "./db";
import { createApiToken } from "./tokens";

async function authDb() {
  const db = AuthDb.open(":memory:");
  await db.createAccount({ username: "boss", password: "password1", orgId: "acme", userId: "boss", admin: true });
  await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
  return db;
}
const principal = (db: AuthDb, username: string): Principal => ({ ...db.getAccount(username)!, tokenId: "t", kind: "session" });

afterEach(() => {
  vi.doUnmock("@/auth/db");
  vi.resetModules();
});

describe("CI tokens", () => {
  it("are made by admins only, and may only send commits", async () => {
    const db = await authDb();
    expect(() => createApiToken(db, principal(db, "devon"), "GitHub: acme/web", "ci")).toThrow(expect.objectContaining({ status: 403 }));
    const { token } = createApiToken(db, principal(db, "boss"), "GitHub: acme/web", "ci");
    vi.doMock("@/auth/db", async (orig) => ({ ...(await orig<typeof import("./db")>()), getAuthDb: () => db }));
    const { authenticate } = await import("./request");
    const req = (method: string, path: string) => new Request(`http://localhost${path}`, { method, headers: { authorization: `Bearer ${token}` } });
    expect(authenticate(req("POST", "/api/ingest/code"))).toMatchObject({ kind: "ci", admin: true });
    expect(authenticate(req("GET", "/api/sources"))).toBeNull();
    expect(authenticate(req("POST", "/api/auth/tokens"))).toBeNull();
    expect(authenticate(req("POST", "/api/mcp"))).toBeNull();
    expect(authenticate(req("GET", "/v1/policy"))).toBeNull();
  });

  it("stop working when they expire", async () => {
    const db = await authDb();
    const now = Date.now();
    const made = createApiToken(db, principal(db, "boss"), "Claude Code", "api", 90, now - 91 * 86_400_000);
    expect(made.expiresAt).toBeTruthy();
    expect(db.resolveToken(made.token)).toBeNull();
    const fresh = createApiToken(db, principal(db, "boss"), "Claude Code", "api", 90);
    expect(db.resolveToken(fresh.token)?.kind).toBe("api");
  });

  it("migrates a tokens table whose CHECK refuses 'ci'", async () => {
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(":memory:");
    raw.exec(`CREATE TABLE accounts (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
      admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      INSERT INTO accounts VALUES ('old', 'x', 'acme', 'old', 1, '2026-01-01T00:00:00.000Z');
      CREATE TABLE tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('session', 'api', 'device')), label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT, last_used_at TEXT);
      INSERT INTO tokens VALUES ('t1', 'h1', 'old', 'device', 'Mac', '2026-01-01T00:00:00.000Z', NULL, NULL);`);
    const db = new AuthDb(raw);
    expect(db.listTokens("old")).toHaveLength(1);
    expect(() => db.issueToken("old", "ci", "GitHub")).not.toThrow();
  });
});

import Database from "better-sqlite3";
import type { CompletionRequest } from "@/llm/openrouter";
import { describe, expect, it, vi } from "vitest";
import { AuthDb, type Principal } from "@/auth/db";
import { LoginLimiter } from "@/auth/ratelimit";
import { memoryStore, deps as testDeps } from "@/test/helpers";
import { deleteMacData } from "./mydata";
import { registerDevice } from "./devices";
import { acceptConsent, assertMayCapture } from "./policy";
import { summarize, titlesSummary } from "./summaries";
import { submitWorkBlocks } from "./workBlocks";
import { saveOrgSettings as updateSettings } from "@/orgs/settings";

const T0 = "2026-10-14T10:00:00.000Z";
const T1 = "2026-10-14T10:05:00.000Z";

const block = (over: Record<string, unknown> = {}) => ({
  local_id: "b1",
  started_at: T0,
  ended_at: T1,
  app_bundle_id: "com.apple.mail",
  app_name: "Mail",
  window_title: "Re: pricing",
  domain_path: null,
  matched_client_id: null,
  match_method: "none",
  match_confidence: 0,
  snippet: "Hello from jane@initech.com, call me",
  text_hash: "abc",
  redaction_count: 0,
  ...over,
});

async function authDb() {
  const db = AuthDb.open(":memory:");
  await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
  return db;
}

describe("device codes", () => {
  it("are single-use and expire", async () => {
    const db = await authDb();
    const limiter = new LoginLimiter();
    const { code } = db.createDeviceCode("devon");
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const first = registerDevice(db, limiter, { name: "MacBook Pro", auth_code: code.toLowerCase().replace("-", "") }, "1.1.1.1");
    expect(first.device_token).toBeTruthy();
    expect(() => registerDevice(db, limiter, { name: "Mac", auth_code: code }, "1.1.1.1")).toThrow(/wrong, used, or expired/);
    const old = db.createDeviceCode("devon", Date.now() - 16 * 60_000);
    expect(db.consumeDeviceCode(old.code)).toBeNull();
    expect(db.listTokens("devon").some((t) => t.kind === "device" && t.label === "MacBook Pro")).toBe(true);
  });

  it("migrates a tokens table whose CHECK refuses 'device'", () => {
    const raw = new Database(":memory:");
    raw.exec(`CREATE TABLE accounts (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
      admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      INSERT INTO accounts VALUES ('old', 'x', 'acme', 'old', 0, '2026-01-01T00:00:00.000Z');
      CREATE TABLE tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, username TEXT NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('session', 'api')), label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT, last_used_at TEXT);
      INSERT INTO tokens VALUES ('t1', 'h1', 'old', 'api', 'ci', '2026-01-01T00:00:00.000Z', NULL, NULL);`);
    const db = new AuthDb(raw);
    expect(db.listTokens("old")).toHaveLength(1);
    expect(() => db.issueToken("old", "device", "Mac")).not.toThrow();
  });

  it("device tokens work on /v1 and are refused on /api", async () => {
    const db = await authDb();
    const { token } = db.issueToken("devon", "device", "Mac");
    vi.resetModules();
    vi.doMock("@/auth/db", async (orig) => ({ ...(await orig<typeof import("@/auth/db")>()), getAuthDb: () => db }));
    const { authenticate: auth } = await import("@/auth/request");
    const req = (path: string) => new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } });
    expect(auth(req("/v1/policy"))?.kind).toBe("device");
    expect(auth(req("/api/sources"))).toBeNull();
    expect(auth(req("/api/auth/tokens"))).toBeNull();
    vi.doUnmock("@/auth/db");
  });
});

describe("work blocks", () => {
  const principal = (): Principal => ({
    username: "devon",
    orgId: "acme",
    userId: "devon",
    admin: false,
    createdAt: T0,
    email: null,
    disabled: false,
    lastSeenAt: null,
    consentVersion: 0,
    consentAt: null,
    tokenId: "t",
    kind: "device",
  });
  const setup = () => {
    const store = memoryStore();
    store.saveUser({ id: "devon", name: "Devon", role: "Lawyer", teamDescription: "" });
    return { store, d: testDeps(store) };
  };

  it("is idempotent per user on local_id, rejects per block, allows emails", () => {
    const { store, d } = setup();
    const batch = [
      block(),
      block({ local_id: "b2", snippet: "card 4111 1111 1111 1111 expires" }),
      block({ local_id: "b3", window_title: "key sk-live-abcdefghijklmnop" }),
      block({ local_id: "b4", ended_at: "2026-10-14T09:00:00.000Z" }),
      block({ local_id: "b5", match_method: "bogus" }),
    ];
    const r1 = submitWorkBlocks(d, "devon", batch);
    expect(r1.accepted).toBe(1);
    expect(r1.duplicate).toBe(0);
    expect(r1.accepted_ids).toEqual(["b1"]);
    expect(r1.rejected).toEqual([
      { local_id: "b2", reason: "card_number" },
      { local_id: "b3", reason: "api_key" },
      { local_id: "b4", reason: "ended_before_started" },
      { local_id: "b5", reason: "invalid" },
    ]);
    const r2 = submitWorkBlocks(d, "devon", [block(), block({ local_id: "b6" })]);
    expect(r2).toMatchObject({ accepted: 1, duplicate: 1, accepted_ids: ["b1", "b6"] });
    // Another person's same local_id is their own block.
    store.saveUser({ id: "priya", name: "Priya", role: "x", teamDescription: "" });
    expect(submitWorkBlocks(d, "priya", [block()]).accepted).toBe(1);
    const n = (store.db.prepare("SELECT COUNT(*) AS n FROM mac_work_blocks").get() as { n: number }).n;
    expect(n).toBe(3);
    // Each stored block is an Orion document with the email kept in it, extraction pending.
    const doc = store.db.prepare("SELECT kind, text, extraction FROM sources WHERE author_id = 'devon' LIMIT 1").get() as { kind: string; text: string; extraction: string };
    expect(doc).toMatchObject({ kind: "mac", extraction: "pending" });
    expect(doc.text).toContain("jane@initech.com");
  });

  it("is turned away while capture is paused, before consent, and for excluded hosts", () => {
    const { store, d } = setup();
    const p = principal();
    expect(() => assertMayCapture(store, p)).toThrow(/consent|notice/);
    updateSettings(store, { captureEnabled: false });
    expect(() => assertMayCapture(store, p)).toThrow(/paused/);
    updateSettings(store, { captureEnabled: true, excludedHosts: ["bank.example"] });
    const r = submitWorkBlocks(d, "devon", [block({ domain_path: "www.bank.example/login" })]);
    expect(r.rejected).toEqual([{ local_id: "b1", reason: "excluded_host" }]);
    expect(r.accepted_ids).toEqual([]);
  });

  it("accepts consent only for the current version", async () => {
    const db = await authDb();
    const { store } = setup();
    const p = db.resolveToken(db.issueToken("devon", "device", "Mac").token)!;
    expect(() => acceptConsent(db, store, p, 99)).toThrow(/current notice/);
    expect(acceptConsent(db, store, p, 1).accepted_at).toBeTruthy();
    expect(() => assertMayCapture(store, db.resolveToken(db.issueToken("devon", "device", "Mac").token)!)).not.toThrow();
  });

  it("deletion removes blocks and the documents made from them, not other documents", async () => {
    const { store, d } = setup();
    const db = await authDb();
    store.db.prepare("INSERT INTO sources (id, kind, ref, title, text, author_id, created_at) VALUES ('other', 'capture', 'https://x.example', 't', 'x', 'devon', ?)").run(T0);
    submitWorkBlocks(d, "devon", [block(), block({ local_id: "b2" })]);
    store.db.prepare("INSERT INTO summaries (source_id, text, text_hash, fidelity) SELECT source_id, 's', 'h', 1 FROM mac_work_blocks").run();
    const res = deleteMacData(db, store, { ...principalFor(), userId: "devon" });
    expect(res.request_id).toBeTruthy();
    const c = (sql: string) => (store.db.prepare(sql).get() as { n: number }).n;
    expect(c("SELECT COUNT(*) AS n FROM mac_work_blocks")).toBe(0);
    expect(c("SELECT COUNT(*) AS n FROM sources WHERE kind = 'mac'")).toBe(0);
    expect(c("SELECT COUNT(*) AS n FROM summaries")).toBe(0);
    expect(c("SELECT COUNT(*) AS n FROM sources WHERE id = 'other'")).toBe(1);
  });

  function principalFor(): Principal {
    return principal();
  }
});

describe("summaries", () => {
  const blocks = [
    { app_name: "Mail", window_title: "Apple sign-in alert", snippet: "secret [PHONE]" },
    { app_name: "Safari", window_title: "Initech pricing", domain_path: "initech.com/pricing" },
  ];

  it("sends zdr routing, stores nothing, logs nothing", async () => {
    const store = memoryStore();
    const before = (store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as { n: number }).n;
    const complete = vi.fn(async (_req: CompletionRequest) => ({ choices: [{ finish_reason: "stop", message: { role: "assistant" as const, content: "You read an alert." } }] }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await summarize({ complete }, blocks)).toBe("You read an alert.");
    expect(complete.mock.calls[0][0]).toMatchObject({ zdr: true });
    const { requestBody } = await import("@/llm/openrouter");
    const sent = JSON.parse(requestBody(complete.mock.calls[0][0], {})) as { provider: Record<string, unknown> };
    expect(sent.provider).toMatchObject({ zdr: true, data_collection: "deny" });
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as { n: number }).n).toBe(before);
  });

  it("falls back to titles with no model or on failure", async () => {
    expect(await summarize(null, blocks)).toBe("Apple sign-in alert; Initech pricing");
    const failing = { complete: async () => Promise.reject(new Error("budget")) };
    expect(await summarize(failing, blocks)).toBe(titlesSummary(blocks));
  });
});

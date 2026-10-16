/**
 * Authorization for every API route, table-driven. The table must cover every exported method of every
 * `app/api/**\/route.ts`: a new route (or method) without an entry fails "covers every route".
 *
 * Each entry runs, against a fresh org fixture: signed out (401 unless public), an admin of another org (403, or the
 * stated status for routes that act only on the caller's own org), a member and an admin (admin-only routes refuse
 * members), and "viewing as" another person (members refused, admins allowed) for routes that take a userId.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthDb, setAuthDb } from "@/auth/db";
import { LEGACY_SESSION_COOKIE } from "@/auth/request";
import { createOrgStore, deleteOrgStore, getStore, orgExists } from "@/http/deps";
import { saveOrgSettings } from "@/orgs/settings";
import { recordUsage } from "@/usage";

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Who = "anon" | "member" | "admin" | "otherAdmin";
type Call = { url?: string; params?: Record<string, string>; body?: unknown; headers?: Record<string, string> };

type Fixture = {
  tokens: Record<Exclude<Who, "anon">, string> & { priya: string };
  memberTokenId: string;
  inviteId: string;
  inviteToken: string;
  resetToken: string;
};

type Expect = number | "ok" | ((res: Response, f: Fixture) => Promise<void> | void);

type Case = {
  /** "METHOD /api/path" with the folder names, like "PATCH /api/auth/accounts/[username]". */
  key: string;
  /** How to call it. Defaults to the route path with orgId=acme in the query (GET) or body (others). */
  call?: (f: Fixture, who: Who) => Call;
  /** Signed out: 401 by default; public routes state what they answer. */
  anon?: Expect;
  /** An admin of another org. 403 by default. */
  otherOrg?: Expect | "skip";
  /** Members get 403. */
  adminOnly?: boolean;
  /** Expected for the member (default "ok") and the admin (default "ok"). */
  member?: Expect;
  admin?: Expect;
  /** The same call naming another person (priya): members 403, admins allowed. */
  viewAs?: (f: Fixture) => Call;
  /** The route belongs to parallel work and may not exist yet. */
  pending?: boolean;
};

const ORG = "acme";
const API = path.resolve(import.meta.dirname, "../../app/api");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

// ok: the caller got past authorization and the handler did not crash. 502/503 are allowed (no model key in tests).
const isOk = (status: number) => ![400, 401, 403, 404, 409, 413, 415, 429, 500].includes(status);

const q = (pathname: string, extra = "") => `${pathname}?orgId=${ORG}${extra}`;

const CASES: Case[] = [
  { key: "GET /api/activity" },
  {
    key: "GET /api/audit",
    adminOnly: true,
    otherOrg: async (res) => {
      expect(res.status).toBe(200);
      const { events } = (await res.json()) as { events: { actor: string }[] };
      expect(events.every((e) => e.actor === "zed")).toBe(true);
    },
  },
  {
    key: "POST /api/auth/accept-invite",
    call: (f) => ({ body: { token: f.inviteToken, username: "newbie", password: "password1", name: "New Bie", role: "Engineer" } }),
    anon: 200,
    otherOrg: "skip",
    member: "ok",
    admin: "skip" as never,
  },
  {
    key: "GET /api/auth/accounts",
    adminOnly: true,
    otherOrg: async (res) => {
      const { accounts } = (await res.json()) as { accounts: { username: string }[] };
      expect(accounts.map((a) => a.username)).toEqual(["zed"]);
    },
  },
  {
    key: "POST /api/auth/accounts",
    call: () => ({ body: { username: "newbie", password: "password1" } }),
    adminOnly: true,
    // Creates the account in the caller's own org, never in acme.
    otherOrg: async (res) => {
      expect(res.status).toBe(200);
      expect(((await res.json()) as { account: { userId: string } }).account.userId).toBe("newbie");
    },
  },
  {
    key: "PATCH /api/auth/accounts/[username]",
    call: () => ({ params: { username: "priya" }, body: { email: "priya@acme.test" } }),
    adminOnly: true,
    otherOrg: 404,
  },
  { key: "POST /api/auth/accounts/[username]/reset", call: () => ({ params: { username: "priya" } }), adminOnly: true, otherOrg: 404 },
  { key: "POST /api/auth/consent", call: () => ({ body: { version: 1 } }), otherOrg: "skip", member: 200 },
  {
    key: "GET /api/auth/invites",
    adminOnly: true,
    otherOrg: async (res) => expect(((await res.json()) as { invites: unknown[] }).invites).toEqual([]),
  },
  { key: "POST /api/auth/invites", call: () => ({ body: { admin: false } }), adminOnly: true, otherOrg: 200 },
  { key: "GET /api/auth/invites/[key]", call: (f) => ({ params: { key: f.inviteToken } }), anon: 200, otherOrg: "skip" },
  { key: "DELETE /api/auth/invites/[key]", call: (f) => ({ params: { key: f.inviteId } }), adminOnly: true, otherOrg: 404, admin: 204 },
  { key: "POST /api/auth/login", call: () => ({ body: { username: "devon", password: "password1" } }), anon: 200, otherOrg: "skip" },
  { key: "POST /api/auth/logout", anon: 200, otherOrg: "skip" },
  { key: "GET /api/auth/me", otherOrg: "skip", member: 200 },
  { key: "POST /api/auth/password", call: () => ({ body: { current: "password1", next: "password2" } }), otherOrg: "skip", member: 204, admin: 204 },
  { key: "POST /api/auth/reset", call: (f) => ({ body: { token: f.resetToken, password: "brandnew1" } }), anon: 204, otherOrg: "skip" },
  // Closed unless ALLOW_SIGNUP=true.
  { key: "POST /api/auth/signup", call: () => ({ body: { username: "x1", password: "password1", orgName: "X" } }), anon: 403, otherOrg: "skip", member: 403, admin: 403 },
  { key: "POST /api/auth/device-codes", otherOrg: "skip", member: 200 },
  { key: "GET /api/auth/tokens", otherOrg: "skip", member: 200 },
  { key: "POST /api/auth/tokens", call: () => ({ body: { label: "ci" } }), otherOrg: "skip", member: 200 },
  { key: "DELETE /api/auth/tokens/[id]", call: (f) => ({ params: { id: f.memberTokenId } }), otherOrg: 404, member: 200 },
  { key: "GET /api/brief", viewAs: () => ({ url: q("/api/brief", "&userId=priya") }) },
  { key: "GET /api/capture/policy", member: 200 },
  {
    key: "POST /api/chat",
    call: () => ({ body: { orgId: ORG, message: "what changed?", skipDashboard: true } }),
    viewAs: () => ({ body: { orgId: ORG, userId: "priya", message: "what changed?", skipDashboard: true } }),
  },
  { key: "GET /api/clusters", member: 200 },
  { key: "GET /api/context", viewAs: () => ({ url: q("/api/context", "&userId=priya") }) },
  {
    key: "POST /api/dashboard/ask",
    call: () => ({ body: { orgId: ORG, message: "show blocked work" } }),
    viewAs: () => ({ body: { orgId: ORG, userId: "priya", message: "show blocked work" } }),
  },
  { key: "GET /api/dashboard", viewAs: () => ({ url: q("/api/dashboard", "&userId=priya") }) },
  {
    key: "POST /api/dashboard",
    call: () => ({ body: { orgId: ORG, reset: true } }),
    viewAs: () => ({ body: { orgId: ORG, userId: "priya", reset: true } }),
  },
  { key: "GET /api/embeddings", member: 200 },
  { key: "GET /api/feed", viewAs: () => ({ url: q("/api/feed", "&userId=priya") }) },
  { key: "GET /api/graph", member: 200, viewAs: () => ({ url: q("/api/graph", "&userId=priya") }) },
  {
    key: "POST /api/ingest/capture",
    call: () => ({ body: { orgId: ORG, url: "https://ads.example/campaign", title: "Campaign", html: "<p>Budget 900</p>" } }),
    viewAs: () => ({ body: { orgId: ORG, userId: "priya", url: "https://ads.example/campaign", title: "Campaign", html: "<p>Budget 900</p>" } }),
  },
  {
    key: "POST /api/ingest/code",
    call: () => ({ body: { orgId: ORG, repo: "app", commitSha: "abc1234", files: [], cards: [{ label: "Checkout", summary: "New checkout", status: "shipped" }] } }),
    viewAs: () => ({ body: { orgId: ORG, userId: "priya", repo: "app", commitSha: "abc1234", files: [], cards: [{ label: "Checkout", summary: "New checkout", status: "shipped" }] } }),
  },
  // MCP: the org and person come from the token, so another org's token simply reaches its own org.
  {
    key: "POST /api/mcp",
    call: () => ({
      url: "/api/mcp",
      headers: { accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    }),
    otherOrg: "skip",
  },
  { key: "GET /api/mcp", call: () => ({ url: "/api/mcp", headers: { accept: "text/event-stream" } }), otherOrg: "skip", member: (res) => expect([401, 403]).not.toContain(res.status), admin: (res) => expect([401, 403]).not.toContain(res.status) },
  { key: "DELETE /api/mcp", call: () => ({ url: "/api/mcp" }), otherOrg: "skip", member: (res) => expect([401, 403]).not.toContain(res.status), admin: (res) => expect([401, 403]).not.toContain(res.status) },
  { key: "DELETE /api/me/captures", otherOrg: "skip", member: 200 },
  {
    key: "GET /api/orgs",
    otherOrg: async (res) => expect(((await res.json()) as { orgs: { id: string }[] }).orgs.map((o) => o.id)).toEqual(["other"]),
    member: async (res) => expect(((await res.json()) as { orgs: { id: string }[] }).orgs.map((o) => o.id)).toEqual([ORG]),
  },
  // Only with AUTH_DISABLED=true: a signed-in caller is refused.
  { key: "POST /api/orgs", call: () => ({ url: "/api/orgs", body: { name: "New Org", description: "d" } }), otherOrg: 403, member: 403, admin: 403 },
  { key: "GET /api/orgs/[orgId]", call: () => ({ params: { orgId: ORG } }), member: 200 },
  { key: "PATCH /api/orgs/[orgId]", call: () => ({ params: { orgId: ORG }, body: { context: "We sell shoes." } }), adminOnly: true, admin: 200 },
  { key: "DELETE /api/orgs/[orgId]", call: () => ({ params: { orgId: ORG }, body: { confirm: ORG } }), adminOnly: true, admin: 204 },
  { key: "GET /api/orgs/[orgId]/settings", call: () => ({ params: { orgId: ORG } }), member: 200 },
  { key: "PATCH /api/orgs/[orgId]/settings", call: () => ({ params: { orgId: ORG }, body: { excludedHosts: ["mail.google.com"] } }), adminOnly: true, admin: 200 },
  { key: "GET /api/orgs/[orgId]/usage", call: () => ({ params: { orgId: ORG } }), adminOnly: true, pending: true },
  // The Mac app download: public, so a new teammate can install before signing in. No release in the test folder.
  { key: "GET /api/downloads/mac/latest", call: () => ({ url: "/api/downloads/mac/latest" }), anon: 404, otherOrg: "skip", member: "skip" as never, admin: "skip" as never },
  {
    key: "GET /api/downloads/mac/[file]",
    call: () => ({ url: "/api/downloads/mac/Orion-0.1.0.zip", params: { file: "Orion-0.1.0.zip" } }),
    anon: 404,
    otherOrg: "skip",
    member: "skip" as never,
    admin: "skip" as never,
  },
  // The codebase agent for GitHub Actions: public; sending anything with it takes a token.
  { key: "GET /api/downloads/ctx-sync.mjs", call: () => ({ url: "/api/downloads/ctx-sync.mjs" }), anon: (res) => expect([200, 404]).toContain(res.status), otherOrg: "skip", member: "skip" as never, admin: "skip" as never },
  { key: "GET /api/downloads/mac/install.sh", call: () => ({ url: "/api/downloads/mac/install.sh" }), anon: 200, otherOrg: "skip", member: "skip" as never, admin: "skip" as never },
  { key: "GET /api/health", call: () => ({ url: "/api/health" }), anon: (res) => expect([200, 503]).toContain(res.status), otherOrg: "skip", member: "skip" as never, admin: "skip" as never, pending: true },
  {
    key: "GET /api/sources/[id]",
    call: () => ({ url: q("/api/sources/src-p"), params: { id: "src-p" } }),
    // The text is org-wide, the screenshot is not.
    member: async (res) => {
      expect(res.status).toBe(200);
      expect(((await res.json()) as { source: { hasImage: boolean } }).source.hasImage).toBe(false);
    },
    admin: async (res) => expect(((await res.json()) as { source: { hasImage: boolean } }).source.hasImage).toBe(true),
  },
  {
    key: "GET /api/sources/[id]/image",
    call: (_f, who) => {
      const id = who === "member" ? "src-d" : "src-p";
      return { url: q(`/api/sources/${id}/image`), params: { id } };
    },
    member: 200,
    admin: 200,
    // A colleague's screenshot: refused for members.
    viewAs: () => ({ url: q("/api/sources/src-p/image"), params: { id: "src-p" } }),
  },
  { key: "GET /api/users", member: 200 },
  {
    key: "POST /api/users",
    call: () => ({ body: { orgId: ORG, id: "devon", name: "Devon", role: "Engineer on checkout" } }),
    viewAs: () => ({ body: { orgId: ORG, id: "priya", name: "Priya", role: "Sales lead" } }),
  },
  { key: "DELETE /api/users/[userId]", call: () => ({ url: q("/api/users/temp"), params: { userId: "temp" } }), adminOnly: true, admin: 200 },
];

/** Every route file under app/api, as "METHOD /api/path" for each exported handler. */
async function routeKeys(): Promise<{ key: string; file: string }[]> {
  const out: { key: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") out.push({ key: "/api/" + path.relative(API, dir).split(path.sep).join("/"), file: p });
    }
  };
  walk(API);
  const keys: { key: string; file: string }[] = [];
  for (const r of out) {
    const mod = (await import(r.file)) as Record<string, unknown>;
    for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) if (typeof mod[m] === "function") keys.push({ key: `${m} ${r.key.replace(/\/$/, "")}`, file: r.file });
  }
  return keys;
}

const fileFor = (key: string) => path.join(API, key.split(" ")[1].replace(/^\/api\/?/, ""), "route.ts");

let dataDir: string;
const saved: Record<string, string | undefined> = {};
const ENV = { EMBED_PROVIDER: "local", RATE_LIMIT: "false", OPENROUTER_API_KEY: "", AUTH_DISABLED: "", ALLOW_SIGNUP: "", COOKIE_SECURE: "", EXTENSION_IDS: "", UI_ORIGIN: "" };

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-authz-"));
  for (const [k, v] of Object.entries({ ...ENV, DATA_DIR: dataDir })) {
    saved[k] = process.env[k];
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeFixture(): Promise<Fixture> {
  const db = AuthDb.open(":memory:");
  setAuthDb(db);
  const now = new Date().toISOString();
  const acme = createOrgStore({ id: ORG, name: "Acme", description: "Acme sells shoes", websites: [], context: "", createdAt: now });
  const other = createOrgStore({ id: "other", name: "Other", description: "Another company", websites: [], context: "", createdAt: now });
  for (const [id, role] of [["devon", "Engineer"], ["priya", "Sales"], ["boss", "Founder"], ["temp", "Contractor"]]) acme.saveUser({ id, name: id, role, teamDescription: "" });
  other.saveUser({ id: "zed", name: "zed", role: "Founder", teamDescription: "" });
  await db.createAccount({ username: "devon", password: "password1", orgId: ORG, userId: "devon" });
  await db.createAccount({ username: "priya", password: "password1", orgId: ORG, userId: "priya" });
  await db.createAccount({ username: "boss", password: "password1", orgId: ORG, userId: "boss", admin: true });
  await db.createAccount({ username: "zed", password: "password1", orgId: "other", userId: "zed", admin: true });
  for (const u of ["devon", "priya", "boss", "zed"]) db.setConsent(u, 1);
  const src = acme.db.prepare("INSERT INTO sources (id, kind, ref, title, text, author_id, image, created_at) VALUES (?, 'capture', ?, 'Page', 'Some page text', ?, ?, ?)");
  src.run("src-d", "https://a.example/1", "devon", PNG, now);
  src.run("src-p", "https://a.example/2", "priya", PNG, now);
  // Bearer tokens (CSRF does not apply); sessions where a route acts on "this session" (password).
  const tok = (u: string, kind: "api" | "session" = "api") => db.issueToken(u, kind).token;
  const member = db.issueToken("devon", "api");
  const invite = db.createInvite({ orgId: ORG, createdBy: "boss" });
  return {
    tokens: { member: member.token, admin: tok("boss"), otherAdmin: tok("zed"), priya: tok("priya") },
    memberTokenId: member.info.id,
    inviteId: invite.invite.id,
    inviteToken: invite.token,
    resetToken: db.createReset("priya").token,
  };
}

function dropOrgs() {
  for (const id of [ORG, "other", "new-org"]) if (orgExists(id)) deleteOrgStore(id);
  setAuthDb(undefined);
}

function request(c: Case, call: Call, method: Method, token: string | null): NextRequest {
  const pathname = c.key.split(" ")[1].replace(/\[(\w+)\]/g, (_m, name: string) => call.params?.[name] ?? name);
  const url = call.url ?? (method === "GET" ? q(pathname) : pathname);
  const headers: Record<string, string> = { origin: "http://localhost:3000", ...call.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (method !== "GET") {
    const b = call.body ?? (url.includes("?") ? undefined : { orgId: ORG });
    if (b !== undefined) {
      body = JSON.stringify(b);
      headers["content-type"] = "application/json";
    }
  }
  return new NextRequest(`http://localhost${url}`, { method, headers, body });
}

async function invoke(c: Case, who: Who, f: Fixture, override?: Call): Promise<Response> {
  const [method] = c.key.split(" ") as [Method];
  const mod = (await import(fileFor(c.key))) as Record<string, (req: NextRequest, ctx: unknown) => Promise<Response>>;
  const call = override ?? c.call?.(f, who) ?? {};
  const token = who === "anon" ? null : f.tokens[who];
  return mod[method](request(c, call, method, token), { params: Promise.resolve(call.params ?? {}) });
}

async function check(res: Response, want: Expect, f: Fixture, label: string): Promise<void> {
  if (typeof want === "function") return want(res, f);
  const text = res.status === 204 ? "" : await res.clone().text();
  if (want === "ok") expect(isOk(res.status), `${label}: got ${res.status} ${text.slice(0, 200)}`).toBe(true);
  else expect(res.status, `${label}: ${text.slice(0, 200)}`).toBe(want);
}

describe("route authorization", () => {
  it("covers every route and method (add an entry for each new one)", async () => {
    const keys = (await routeKeys()).map((k) => k.key).sort();
    const covered = new Set(CASES.map((c) => c.key));
    expect(keys.filter((k) => !covered.has(k)), "routes without an authz entry").toEqual([]);
    const missing = CASES.filter((c) => !c.pending && !keys.includes(c.key)).map((c) => c.key);
    expect(missing, "entries without a route").toEqual([]);
  });

  beforeEach(() => dropOrgs());
  afterEach(() => dropOrgs());

  for (const c of CASES) {
    it(c.key, async (ctx) => {
      if (c.pending && !fs.existsSync(fileFor(c.key))) return ctx.skip();
      let f = await makeFixture();
      const fresh = async () => {
        dropOrgs();
        f = await makeFixture();
      };

      await check(await invoke(c, "anon", f), c.anon ?? 401, f, "signed out");
      if (c.anon !== undefined && c.anon !== 401) await fresh();

      if (c.otherOrg !== "skip") await check(await invoke(c, "otherAdmin", f), c.otherOrg ?? 403, f, "another org's admin");

      if (c.viewAs) {
        await fresh();
        await check(await invoke(c, "member", f, c.viewAs(f)), 403, f, "member viewing as a colleague");
        await check(await invoke(c, "admin", f, c.viewAs(f)), "ok", f, "admin viewing as a colleague");
      }

      if ((c.member as unknown) !== "skip") {
        await fresh();
        await check(await invoke(c, "member", f), c.adminOnly ? 403 : (c.member ?? "ok"), f, "member");
      }
      if ((c.admin as unknown) !== "skip") {
        await fresh();
        await check(await invoke(c, "admin", f), c.admin ?? "ok", f, "admin");
      }
    });
  }
});

describe("cross-cutting route behavior", () => {
  let f: Fixture;
  beforeEach(async () => {
    dropOrgs();
    f = await makeFixture();
  });
  afterEach(() => dropOrgs());

  const capture = (token: string, url = "https://ads.example/campaign") =>
    invoke({ key: "POST /api/ingest/capture" }, "member", { ...f, tokens: { ...f.tokens, member: token } }, { body: { orgId: ORG, url, title: "t", html: "<p>Budget 900</p>" } });

  it("gates capture on consent, the pause switch, and excluded hosts", async () => {
    getAuthDbFor().db.prepare("UPDATE accounts SET consent_version = 0 WHERE username = 'priya'").run();
    const noConsent = await capture(f.tokens.priya);
    expect(noConsent.status).toBe(403);
    expect(await noConsent.json()).toEqual({ error: "consent required" });

    saveOrgSettings(getStore(ORG), { excludedHosts: ["ads.example"] });
    const skipped = await capture(f.tokens.member);
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toEqual({ skipped: "excluded" });
    expect(getStore(ORG).listSources().filter((s) => s.ref.includes("ads.example"))).toHaveLength(0);

    saveOrgSettings(getStore(ORG), { captureEnabled: false });
    const paused = await capture(f.tokens.member);
    expect(paused.status).toBe(403);
    expect(await paused.json()).toEqual({ error: "capture paused by your admin" });
  });

  it("refuses a cookie write from another origin on a real route", async () => {
    const session = getAuthDbFor().issueToken("boss", "session").token;
    const mod = await import(fileFor("PATCH /api/orgs/[orgId]/settings"));
    const call = (origin: string, type = "application/json") =>
      mod.PATCH(
        new NextRequest(`http://localhost/api/orgs/${ORG}/settings`, {
          method: "PATCH",
          headers: { cookie: `${LEGACY_SESSION_COOKIE}=${session}`, origin, "content-type": type },
          body: JSON.stringify({ captureEnabled: false }),
        }),
        { params: Promise.resolve({ orgId: ORG }) },
      ) as Promise<Response>;
    expect((await call("https://evil.example")).status).toBe(403);
    expect((await call("http://localhost:3000", "text/plain")).status).toBe(415);
    expect((await call("http://localhost:3000")).status).toBe(200);
  });

  it("forces a member's code ingest onto themselves and ignores git author attribution", async () => {
    const res = await invoke({ key: "POST /api/ingest/code" }, "member", f, {
      body: { orgId: ORG, repo: "app", commitSha: "def5678", files: [], author: { name: "priya" }, cards: [{ label: "Billing", summary: "Billing page", status: "shipped" }] },
    });
    expect(res.status).toBe(200);
    const { sourceId } = (await res.json()) as { sourceId: string };
    expect(getStore(ORG).getSource(sourceId)?.authorId).toBe("devon");
  });

  it("answers 402 on chat and dashboard asks once the monthly model budget is spent", async () => {
    const store = getStore(ORG);
    saveOrgSettings(store, { llmMonthlyBudgetUsd: 0.01 });
    recordUsage(store, { model: "m", kind: "chat", inputTokens: 1, outputTokens: 1, costUsd: 1 });
    for (const key of ["POST /api/chat", "POST /api/dashboard/ask"]) {
      const res = await invoke({ key }, "member", f, { body: { orgId: ORG, message: "what changed?" } });
      expect(res.status, key).toBe(402);
      expect(await res.json()).toEqual({ error: "monthly model budget reached" });
    }
  });

  it("rejects the tokens of a disabled account", async () => {
    getAuthDbFor().updateAccount("devon", { disabled: true });
    expect((await invoke({ key: "GET /api/activity" }, "member", f)).status).toBe(401);
  });

  it("shows consent and email on /api/auth/me", async () => {
    const res = await invoke({ key: "GET /api/auth/me" }, "member", f);
    expect(await res.json()).toMatchObject({ username: "devon", email: null, consent: { required: false, version: 1, notice: expect.stringContaining("Orion") } });
  });
});

function getAuthDbFor(): AuthDb {
  return (globalThis as { __orionAuth?: AuthDb }).__orionAuth!;
}

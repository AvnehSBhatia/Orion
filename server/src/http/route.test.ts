import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthDb, setAuthDb } from "@/auth/db";
import { LEGACY_SESSION_COOKIE, SECURE_SESSION_COOKIE, clearedSessionCookies, sessionCookie } from "@/auth/request";
import { KB, MB, readCapped } from "./body";
import { checkConfig, validateConfig } from "./configCheck";
import { TokenBuckets, rateLimiter } from "./ratelimit";
import { preflight, readJson, route } from "./route";
import { ndjsonResponse, sseResponse } from "./stream";

const ENV_KEYS = ["AUTH_DISABLED", "COOKIE_SECURE", "EXTENSION_IDS", "UI_ORIGIN", "OPENROUTER_API_KEY", "EMBED_PROVIDER", "LOG_REQUESTS", "VITEST", "RATE_LIMIT"];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rateLimiter().clear();
  setAuthDb(undefined);
});

const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) =>
  new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers: init.headers, body: init.body });

describe("body caps", () => {
  const echo = route(async (r: NextRequest) => ({ got: await readJson(r) }), { public: true });
  const big = route(async (r: NextRequest) => ({ size: JSON.stringify(await readJson(r)).length }), { public: true, maxBody: 4 * MB });

  it("413s on a declared Content-Length over the cap before reading", async () => {
    const res = await echo(req("/x", { method: "POST", headers: { "content-length": String(300 * KB), "content-type": "application/json" }, body: "{}" }), {});
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request body must be at most 256KB" });
  });

  it("413s while streaming a body with no Content-Length", async () => {
    const chunk = new Uint8Array(64 * KB).fill(32);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 10) c.enqueue(chunk);
        else c.close();
      },
    });
    const r = new NextRequest("http://localhost/x", { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
    const res = await echo(r, {});
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(10);
  });

  it("lets a route raise its cap, and parses bodies under it", async () => {
    const body = JSON.stringify({ s: "x".repeat(1 * MB) });
    expect((await echo(req("/x", { method: "POST", body, headers: { "content-type": "application/json" } }), {})).status).toBe(413);
    const ok = await big(req("/x", { method: "POST", body, headers: { "content-type": "application/json" } }), {});
    expect(ok.status).toBe(200);
    expect((await echo(req("/x", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } }), {})).status).toBe(400);
  });

  it("reads exact bytes", async () => {
    expect(new TextDecoder().decode(await readCapped(req("/x", { method: "POST", body: "héllo" }), 100))).toBe("héllo");
  });
});

describe("rate limits", () => {
  it("refills a token bucket at its rate", () => {
    const b = new TokenBuckets({ default: { perSec: 2, burst: 3 } });
    expect([0, 0, 0].map(() => b.take("default", "k", 0))).toEqual([0, 0, 0]);
    expect(b.take("default", "k", 0)).toBe(1);
    expect(b.take("default", "k", 500)).toBe(0);
    expect(b.take("default", "other", 0)).toBe(0);
  });

  it("answers 429 with Retry-After and retryAfterSec once the ingest burst is spent", async () => {
    const h = route(async () => ({ ok: true }), { public: true, limit: "ingest" });
    const auth = { authorization: "Bearer abc" };
    for (let i = 0; i < 20; i++) expect((await h(req("/x", { headers: auth }), {})).status).toBe(200);
    const res = await h(req("/x", { headers: auth }), {});
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");
    expect(await res.json()).toEqual({ error: "too many requests, slow down", retryAfterSec: 1 });
    // Another token has its own bucket.
    expect((await h(req("/x", { headers: { authorization: "Bearer other" } }), {})).status).toBe(200);
  });

  it("can be turned off", async () => {
    process.env.RATE_LIMIT = "false";
    const h = route(async () => ({ ok: true }), { public: true, limit: "ask" });
    for (let i = 0; i < 15; i++) expect((await h(req("/x"), {})).status).toBe(200);
  });
});

describe("CSRF", () => {
  let token: string;
  const h = route(async (r: NextRequest) => ({ body: await readJson(r, null) }));
  beforeEach(async () => {
    const db = AuthDb.open(":memory:");
    setAuthDb(db);
    await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
    token = db.issueToken("devon", "session").token;
  });
  const cookie = () => `${LEGACY_SESSION_COOKIE}=${token}`;
  const json = { "content-type": "application/json" };

  it("refuses cookie writes from another origin, without an origin, or as text/plain", async () => {
    const post = (headers: Record<string, string>) => h(req("/x", { method: "POST", headers: { cookie: cookie(), ...headers }, body: "{}" }), {});
    expect((await post({ origin: "https://evil.example", ...json })).status).toBe(403);
    expect((await post({ ...json })).status).toBe(403);
    expect((await post({ origin: "http://localhost:3000", "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ origin: "http://localhost:3000", "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post({ origin: "http://localhost:3000", ...json })).status).toBe(200);
    expect((await post({ "sec-fetch-site": "same-site", ...json })).status).toBe(200);
    expect((await post({ "sec-fetch-site": "cross-site", ...json })).status).toBe(403);
    // A sibling-subdomain page sends its own Origin: refused even though Sec-Fetch-Site says same-site.
    expect((await post({ origin: "https://evil.localhost", "sec-fetch-site": "same-site", ...json })).status).toBe(403);
  });

  it("leaves reads and bearer requests alone", async () => {
    expect((await h(req("/x", { headers: { cookie: cookie(), origin: "https://evil.example" } }), {})).status).toBe(200);
    const bearer = await h(req("/x", { method: "POST", headers: { authorization: `Bearer ${token}`, origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" }), {});
    expect(bearer.status).toBe(200);
  });

  it("allows a bodyless cookie DELETE from the web app", async () => {
    const del = route(async () => ({ ok: true }));
    expect((await del(req("/x", { method: "DELETE", headers: { cookie: cookie(), origin: "http://localhost:3000" } }), {})).status).toBe(200);
  });
});

describe("headers and logs", () => {
  it("sets security headers and a request id on every response, errors and preflights too", async () => {
    const h = route(async () => ({ ok: true }));
    const res = await h(req("/x"), {});
    expect(res.status).toBe(401);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f]{16}$/);
    const pre = preflight(req("/x", { method: "OPTIONS", headers: { "x-request-id": "abc-123" } }));
    expect(pre.headers.get("x-request-id")).toBe("abc-123");
    expect(pre.headers.get("x-frame-options")).toBe("DENY");
  });

  it("adds HSTS behind HTTPS and keeps raw responses' own headers", async () => {
    process.env.COOKIE_SECURE = "true";
    const h = route(async () => new Response("img", { headers: { "content-type": "image/png" } }), { public: true });
    const res = await h(req("/x"), {});
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("writes one JSON log line per request", async () => {
    delete process.env.VITEST;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const h = route(async () => ({ ok: true }), { public: true });
      await h(req("/api/thing?x=1", { headers: { "x-request-id": "req-1" } }), {});
      expect(log).toHaveBeenCalledTimes(1);
      const line = JSON.parse(log.mock.calls[0][0] as string);
      expect(line).toMatchObject({ reqId: "req-1", method: "GET", path: "/api/thing", status: 200, org: null, user: null });
      expect(typeof line.ms).toBe("number");
      expect(typeof line.ts).toBe("string");
    } finally {
      log.mockRestore();
    }
  });
});

describe("CORS for extensions", () => {
  const h = route(async () => ({ ok: true }), { public: true });
  const origin = (o: string) => h(req("/x", { headers: { origin: o } }), {}).then((r) => r.headers.get("access-control-allow-origin"));

  it("allows only listed extension ids while auth is on", async () => {
    expect(await origin("chrome-extension://abc")).toBeNull();
    process.env.EXTENSION_IDS = "abc";
    expect(await origin("chrome-extension://abc")).toBe("chrome-extension://abc");
    expect(await origin("chrome-extension://zzz")).toBeNull();
    delete process.env.EXTENSION_IDS;
    process.env.AUTH_DISABLED = "true";
    expect(await origin("chrome-extension://any")).toBe("chrome-extension://any");
  });
});

describe("session cookie", () => {
  it("uses the __Host- name when Secure and clears both names", () => {
    process.env.COOKIE_SECURE = "true";
    expect(sessionCookie("t")).toMatch(new RegExp(`^${SECURE_SESSION_COOKIE}=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=\\d+; Secure$`));
    expect(clearedSessionCookies().map((c) => c.split("=")[0])).toEqual([SECURE_SESSION_COOKIE, LEGACY_SESSION_COOKIE]);
    delete process.env.COOKIE_SECURE;
    expect(sessionCookie("t").startsWith(`${LEGACY_SESSION_COOKIE}=t`)).toBe(true);
  });

  it("accepts the old name and the new one", async () => {
    const db = AuthDb.open(":memory:");
    setAuthDb(db);
    await db.createAccount({ username: "devon", password: "password1", orgId: "acme", userId: "devon" });
    const t = db.issueToken("devon", "session").token;
    const h = route(async () => ({ ok: true }));
    expect((await h(req("/x", { headers: { cookie: `${LEGACY_SESSION_COOKIE}=${t}` } }), {})).status).toBe(200);
    expect((await h(req("/x", { headers: { cookie: `${SECURE_SESSION_COOKIE}=${t}` } }), {})).status).toBe(200);
  });
});

describe("streams", () => {
  it("writes SSE events and turns a throw into an error event", async () => {
    const text = await sseResponse(async (send) => {
      send("delta", { text: "hi" });
      throw new Error("secret detail");
    }, { fallbackError: "chat failed" }).text();
    expect(text).toBe(': open\n\nevent: delta\ndata: {"text":"hi"}\n\nevent: error\ndata: {"error":"chat failed"}\n\n');
  });

  it("writes NDJSON lines", async () => {
    const res = ndjsonResponse(async (send) => {
      send({ a: 1 });
      throw new Error("boom");
    }, { onError: (error) => ({ dashboard: null, error }) });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await res.text()).toBe('{"a":1}\n{"dashboard":null,"error":"boom"}\n');
  });
});

describe("config check", () => {
  const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  const safe = () => {
    process.env.COOKIE_SECURE = "true";
    process.env.EXTENSION_IDS = "abc";
    process.env.UI_ORIGIN = "https://app.example.com";
    process.env.OPENROUTER_API_KEY = "k";
    delete process.env.AUTH_DISABLED;
  };

  it("refuses unsafe production settings", () => {
    safe();
    expect(checkConfig(prod).errors).toEqual([]);
    process.env.AUTH_DISABLED = "true";
    process.env.COOKIE_SECURE = "false";
    process.env.EXTENSION_IDS = "";
    process.env.UI_ORIGIN = "http://localhost:3000";
    process.env.EMBED_PROVIDER = "openrouter";
    delete process.env.OPENROUTER_API_KEY;
    const { errors, warnings } = checkConfig(prod);
    expect(errors).toHaveLength(4);
    expect(errors.join("\n")).toMatch(/AUTH_DISABLED[\s\S]*COOKIE_SECURE[\s\S]*UI_ORIGIN[\s\S]*OPENROUTER_API_KEY/);
    // The Mac app needs no extension ids; only the legacy extension does, so that one only warns.
    expect(warnings.join("\n")).toMatch(/EXTENSION_IDS/);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateConfig(prod)).toThrow(/Refusing to start/);
    warn.mockRestore();
  });

  it("only warns about a missing key with Gemma embeddings, and only warns in dev", () => {
    safe();
    delete process.env.OPENROUTER_API_KEY;
    process.env.EMBED_PROVIDER = "gemma";
    expect(checkConfig(prod)).toMatchObject({ errors: [], warnings: [expect.stringContaining("OPENROUTER_API_KEY")] });
    process.env.AUTH_DISABLED = "true";
    const dev = checkConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(dev.errors).toEqual([]);
    expect(dev.warnings.length).toBeGreaterThanOrEqual(2);
  });

});

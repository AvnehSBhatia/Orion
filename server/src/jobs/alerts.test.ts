import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alert, noteServerError, watchdogPass } from "./alerts";

const T0 = Date.parse("2026-10-16T12:00:00Z");

beforeEach(() => {
  delete (globalThis as { __orionAlerts?: unknown }).__orionAlerts;
  process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/x";
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.ALERT_DISK_PERCENT;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("alerts", () => {
  it("posts to the webhook at most once an hour per alert, and not at all without one", async () => {
    const post = vi.fn(async () => new Response("ok"));
    expect(await alert("disk", "full", T0, post)).toBe(true);
    expect(await alert("disk", "full", T0 + 30 * 60_000, post)).toBe(false);
    expect(await alert("health", "down", T0 + 60_000, post)).toBe(true);
    expect(await alert("disk", "full", T0 + 61 * 60_000, post)).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
    const body = JSON.parse((post.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).toContain("full");
    expect(body.content).toBe(body.text);
    delete process.env.ALERT_WEBHOOK_URL;
    expect(await alert("other", "x", T0, post)).toBe(false);
  });

  it("alerts on a burst of server errors, not on a few", () => {
    const post = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", post);
    for (let i = 0; i < 9; i++) noteServerError("/api/chat", T0 + i * 1000);
    expect(post).not.toHaveBeenCalled();
    noteServerError("/api/graph", T0 + 10_000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse((post.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).text).toMatch(/10 server errors.*\/api\/chat, \/api\/graph/);
  });

  it("the watchdog alerts on a failing health check and a full disk", async () => {
    const post = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", post);
    process.env.ALERT_DISK_PERCENT = "1";
    // A folder that exists everywhere (CI has no data dir).
    const dataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = os.tmpdir();
    await watchdogPass(() => ({ ok: false, failing: ["authDb"] }), T0);
    if (dataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = dataDir;
    const texts = post.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).text as string);
    expect(texts.some((t) => t.includes("health check is failing: authDb"))).toBe(true);
    expect(texts.some((t) => /data disk is \d+% full/.test(t))).toBe(true);
  });
});

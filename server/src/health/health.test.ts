import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveOrgSettings } from "@/orgs/settings";
import { memoryStore } from "@/test/helpers";
import { recordUsage, usageReport } from "@/usage";
import { checkHealth, orgsDirOk } from ".";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("health", () => {
  it("is ok with a writable data dir, auth.db, a ready or loading embedder, and a key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-health-"));
    process.env.DATA_DIR = dir;
    process.env.OPENROUTER_API_KEY = "k";
    process.env.ORION_VERSION = "1.2.3";
    expect(checkHealth({ authDb: () => {}, embedder: () => "loading" })).toEqual({
      ok: true,
      version: "1.2.3",
      checks: { orgsDir: true, authDb: true, embedder: "loading", llmKey: true },
    });
  });

  it("fails on a missing key, a broken auth.db, or an embedder error", () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "orion-health-"));
    delete process.env.OPENROUTER_API_KEY;
    const h = checkHealth({
      authDb: () => {
        throw new Error("SQLITE_CANTOPEN");
      },
      embedder: () => {
        throw new Error("no key");
      },
    });
    expect(h).toMatchObject({ ok: false, checks: { authDb: false, embedder: "error", llmKey: false, orgsDir: true } });
  });

  it("fails when the data dir is missing", () => {
    expect(orgsDirOk("/nonexistent/orion")).toBe(false);
  });
});

describe("usage report", () => {
  it("reports this month's model use against the budget, captures, and storage", () => {
    const store = memoryStore({ seed: true });
    saveOrgSettings(store, { llmMonthlyBudgetUsd: 25 });
    const now = new Date("2026-10-14T12:00:00Z");
    recordUsage(store, { model: "m", kind: "chat", inputTokens: 100, outputTokens: 10, costUsd: 0.25 }, now);
    recordUsage(store, { model: "m", kind: "extract", inputTokens: 50, outputTokens: 5, costUsd: 0.5 }, now);
    recordUsage(store, { model: "m", kind: "chat", inputTokens: 9, outputTokens: 9, costUsd: 9 }, new Date("2026-09-30T23:00:00Z"));
    store.saveSource({ id: "src-new", kind: "extension", ref: "https://a.com", title: "a", text: "t", image: Buffer.alloc(1234), authorId: null, createdAt: "2026-10-02T00:00:00.000Z" }, []);
    const r = usageReport(store, now);
    expect(r.month).toBe("2026-10");
    expect(r.llm).toEqual({ calls: 2, inputTokens: 150, outputTokens: 15, costUsd: 0.75, budgetUsd: 25 });
    expect(r.captures.month).toBeGreaterThanOrEqual(1);
    expect(r.captures.total).toBeGreaterThanOrEqual(r.captures.month);
    expect(r.storage.screenshotsBytes).toBeGreaterThanOrEqual(1234);
    expect(r.storage.bytes).toBeGreaterThan(0);
  });
});

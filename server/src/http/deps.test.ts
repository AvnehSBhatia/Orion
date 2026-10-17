import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-deps-"));
process.env.DATA_DIR = dir;

describe("org store cache", () => {
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps a cached handle from another copy of the Store class open and in use", async () => {
    const { createOrgStore, getStore } = await import("./deps");
    const first = createOrgStore({ id: "cachetest", name: "Cache test", description: "", websites: [], context: "", createdAt: new Date().toISOString() });
    expect(getStore("cachetest")).toBe(first);

    // A production build can hold a second copy of the class (separate route chunks): same methods, other prototype.
    const methods = Object.entries(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(first))).filter(([k, d]) => k !== "constructor" && typeof d.value === "function");
    const twin = Object.assign(Object.create(Object.fromEntries(methods.map(([k, d]) => [k, d.value]))), first);
    const cache = (globalThis as { __orion?: { stores: Map<string, unknown> } }).__orion!.stores;
    cache.set("cachetest", twin);

    expect(getStore("cachetest")).toBe(twin);
    expect(() => first.db.prepare("SELECT 1").get()).not.toThrow();
  });

  it("has no demo org in production unless DEMO_ORG=on", async () => {
    const { getStore, listOrgs, orgExists } = await import("./deps");
    const before = process.env.DEMO_ORG;
    try {
      process.env.DEMO_ORG = "off";
      expect(orgExists("demo")).toBe(false);
      expect(() => getStore("demo")).toThrow(expect.objectContaining({ status: 404 }));
      expect(listOrgs().map((o) => o.id)).not.toContain("demo");
      process.env.DEMO_ORG = "on";
      expect(orgExists("demo")).toBe(true);
    } finally {
      if (before === undefined) delete process.env.DEMO_ORG;
      else process.env.DEMO_ORG = before;
    }
  });
});

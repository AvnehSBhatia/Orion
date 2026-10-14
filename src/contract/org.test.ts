import { describe, expect, it } from "vitest";
import { ingestCapture } from "@/ingest/pipeline";
import { aboutLines } from "@/llm/extract";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { createOrgRequest, hostOf, updateOrgRequest } from "./schemas";

const ORG = {
  id: "lumen",
  name: "Lumen",
  description: "We make a budgeting app for small restaurants.",
  websites: ["github.com", "lumen.atlassian.net"],
  context: "Our main customer is Tasty Bowl.",
  createdAt: "2026-10-10T12:00:00.000Z",
};

describe("org profile", () => {
  it("turns websites into hostnames and rejects things that are not websites", () => {
    expect(hostOf("https://www.GitHub.com/lumen/app")).toBe("github.com");
    expect(hostOf("lumen.atlassian.net")).toBe("lumen.atlassian.net");
    expect(hostOf("not a site")).toBeNull();
    const ok = createOrgRequest.parse({ name: "Lumen", description: "Budgeting app.", websites: ["github.com", "https://github.com/x"] });
    expect(ok).toMatchObject({ websites: ["github.com"], context: "", members: [] });
    expect(() => createOrgRequest.parse({ name: "Lumen", description: "x", websites: ["nope"] })).toThrow(/not a website/);
    expect(() => createOrgRequest.parse({ name: "Lumen", description: "" })).toThrow();
    expect(updateOrgRequest.parse({ context: "new" })).toEqual({ context: "new" });
  });

  it("is stored once per org file and can be updated", () => {
    const store = memoryStore();
    expect(store.getOrg()).toBeNull();
    store.saveOrg(ORG);
    store.saveOrg({ ...ORG, description: "We make a budgeting app for small restaurants and cafes." });
    expect(store.getOrg()).toEqual({ ...ORG, description: "We make a budgeting app for small restaurants and cafes." });
  });

  it("tells the model what the org does, whether the page is on its websites, and who sent it", () => {
    const about = { org: ORG, author: { name: "Devon Park", role: "Engineer on the mobile app." } };
    const on = aboutLines(about, "https://lumen.atlassian.net/browse/APP-12");
    expect(on).toContain("What it does: We make a budgeting app");
    expect(on).toContain("Websites it works on: github.com, lumen.atlassian.net");
    expect(on).toContain("This page is on one of those websites.");
    expect(on).toContain("Sent by: Devon Park.");
    expect(aboutLines(about, "https://mail.google.com/")).toContain("This page is not on one of those websites.");
    expect(aboutLines({ org: null, author: null })).toBe("");
  });

  it("is passed to the extractor with every capture", async () => {
    const store = memoryStore({ seed: true });
    store.saveOrg(ORG);
    const d = deps(store, { nodes: [extracted({ label: "Budget export" })], edges: [] });
    const seen: unknown[] = [];
    d.extractor.fromCapture = async (_input, _known, about) => {
      seen.push(about);
      return { nodes: [extracted({ label: "Budget export" })], edges: [] };
    };
    await ingestCapture(d, { userId: "devon", url: "https://github.com/lumen/app", title: "PR", html: "<p>Budget export</p>", screenshotB64: "" });
    expect(seen[0]).toEqual({ org: ORG, author: { name: "Devon Park", role: expect.stringContaining("Software engineer") } });
  });
});

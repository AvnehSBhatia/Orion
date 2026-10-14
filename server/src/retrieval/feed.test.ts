import { describe, expect, it } from "vitest";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { applyUpdate } from "@/ingest/pipeline";
import { buildContext, findSources } from "./context";
import { feedFor } from "./feed";

describe("feedFor", () => {
  it("shows what others posted, never your own, with why it matters to you", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const feed = await feedFor(store, embedder, { userId: "priya", sinceHours: 72, limit: 20 });

    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((s) => s.authorId !== "priya")).toBe(true);
    const latency = feed.find((s) => s.changes.some((c) => c.nodeId === "voice-latency-fix"))!;
    expect(latency.why).toBe("changed Voice latency fix, which blocks your Voice mode general release, now blocked");
    expect(feed.indexOf(latency)).toBeLessThan(3);
    const beta = feed.find((s) => s.changes.some((c) => c.nodeId === "voice-mode"))!;
    expect(beta.why).toBe("changed Voice mode, which is part of your Voice mode general release");
  });

  it("ranks a change to something you own above unrelated news and respects the window", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, { nodes: [extracted({ label: "Acme renewal", type: "deal", domain: "sales", status: "at_risk" })], edges: [] });
    await applyUpdate(d, (await d.extractor.fromCapture({ url: "u", title: "t", text: "" }, [])), {
      kind: "extension",
      ref: "https://app.hubspot.com/acme",
      title: "Acme renewal slipped",
      text: "Acme pushed the signature to December.",
      image: null,
    }, "priya");

    const feed = await feedFor(store, d.embedder, { userId: "sam", sinceHours: 1, limit: 5 });
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ title: "Acme renewal slipped", authorName: "Priya Shah" });
    expect(feed[0].why).toBe("changed Acme renewal, which you own, now at risk");
  });
});

describe("context sources", () => {
  it("hands the model the documents behind the leading items and the best matching documents", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const ctx = await buildContext(store, embedder, { userId: "sam", q: "acme renewal hubspot deal" });
    expect(ctx.sources.length).toBeGreaterThan(0);
    expect(ctx.sources.length).toBeLessThanOrEqual(8);
    expect(ctx.sources.map((s) => s.title)).toContain("HubSpot deal: Acme annual renewal");
    expect(ctx.sources.every((s) => s.why.length > 0 && !("embedding" in s) && !("text" in s))).toBe(true);
  });

  it("findSources limits to a time window", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const recent = await findSources(store, embedder, { userId: "devon", q: "voice", k: 10, sinceHours: 5 });
    expect(recent.map((s) => s.title).sort()).toEqual(["Google Ads: Q4 search, voice mode", "HubSpot deal: Acme annual renewal"]);
  });
});

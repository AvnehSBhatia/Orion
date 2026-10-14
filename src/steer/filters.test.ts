import { describe, expect, it } from "vitest";
import { readGraph } from "@/graph/view";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { buildContext, findNodes } from "./context";
import { filterParams, matchingIds } from "./filters";

describe("matchingIds on the seed graph", () => {
  const { nodes } = readGraph(memoryStore({ seed: true }));

  it("status filters see ripple from blocked upstream work", () => {
    const ids = matchingIds(nodes, { statuses: ["blocked", "at_risk"] });
    expect(ids).toContain("voice-latency-fix");
    expect(ids).toContain("voice-mode-general-release");
  });

  it("sellable, domain, type, and recency combine", () => {
    expect([...matchingIds(nodes, { sellable: true })].sort()).toEqual(["sso-login", "voice-mode"]);
    expect([...matchingIds(nodes, { domains: ["sales"], types: ["deal"] })].sort()).toEqual(["acme-renewal", "globex-pilot"]);
    const recent = matchingIds(nodes, { updatedWithinHours: 3 });
    expect([...recent].sort()).toEqual(["cost-per-signup", "q4-search-campaign"]);
  });
});

describe("filterParams", () => {
  it("parses URL params into a filter", () => {
    expect(filterParams.parse({ status: "blocked,at_risk", sellable: "false", domain: "sales", sinceHours: "24" })).toEqual({
      statuses: ["blocked", "at_risk"],
      sellable: false,
      domains: ["sales"],
      types: undefined,
      updatedWithinHours: 24,
    });
    expect(() => filterParams.parse({ status: "sideways" })).toThrow();
  });
});

describe("buildContext", () => {
  it("adds the latest relevant change even when it misses the top hits", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const now = Date.now() + 200 * 3_600_000;
    store.upsertGraph(
      { nodes: [extracted({ label: "Pricing page copy refresh", domain: "marketing", type: "campaign" })], edges: [] },
      { sourceKind: "extension", sourceRef: "test", now: new Date(now - 3_600_000).toISOString() },
    );
    const ctx = (await buildContext(store, embedder, { userId: "sam", q: "acme renewal", hits: 3, now })).items;
    const fresh = ctx.find((n) => n.id === "pricing-page-copy-refresh");
    expect(fresh?.why).toMatch(/updated 1h ago$/);
    expect(ctx.slice(3, 6).every((n) => n.why.startsWith("match"))).toBe(true);
  });

  it("leads with the person's own top items so open questions land on their work", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const ctx = (await buildContext(store, embedder, { userId: "devon", q: "what should I work on today", hits: 3 })).items;
    const mine = (await findNodes(store, embedder, { userId: "devon", k: 3 })).map((n) => n.id);
    expect(ctx.slice(0, 3).map((n) => n.id)).toEqual(mine);
    expect(ctx.slice(0, 3).every((n) => n.why.startsWith("for you"))).toBe(true);
    expect(new Set(ctx.map((n) => n.id)).size).toBe(ctx.length);
  });
});

describe("findNodes", () => {
  it("returns only matching nodes, ranked for the person, with or without a query", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const blocked = await findNodes(store, embedder, { userId: "devon", k: 10, filter: { statuses: ["blocked", "at_risk"] } });
    expect(blocked.map((n) => n.status).every((s) => s === "blocked" || s === "at_risk")).toBe(true);
    expect(blocked.map((n) => n.id)).toContain("voice-latency-fix");

    const sellable = await findNodes(store, embedder, { userId: "sam", q: "voice", k: 10, filter: { sellable: true } });
    expect(sellable.map((n) => n.id).sort()).toEqual(["sso-login", "voice-mode"]);
    expect(sellable.every((n) => !("embedding" in n))).toBe(true);
  });
});

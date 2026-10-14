import { describe, expect, it } from "vitest";
import { normalize } from "@/llm/embed";
import { OUT_DIM, mrlCompressor } from "@/pseudo/compressor";
import { unpackGravity } from "@/pseudo/gravity";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { FRESHNESS, blend, dot, embedsScreenshot, freshness, getContextIds, getContextScored, mean, ownerMatches, recomputeUserVectors } from "./users";

const v = (...xs: number[]) => Float32Array.from(xs);
const HOUR = 3_600_000;

describe("freshness", () => {
  it("halves every half-life and ignores future or bad dates", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const at = (h: number) => new Date(now - h * HOUR).toISOString();
    expect(freshness(at(0), now)).toBeCloseTo(FRESHNESS.weight);
    expect(freshness(at(FRESHNESS.halfLifeHours), now)).toBeCloseTo(FRESHNESS.weight / 2);
    expect(freshness(at(-5), now)).toBeCloseTo(FRESHNESS.weight);
    expect(freshness("not a date", now)).toBe(0);
  });
});

describe("blend", () => {
  it("weights parts and returns a unit vector", () => {
    const out = blend([
      { weight: 0.5, vec: v(1, 0, 0) },
      { weight: 0.3, vec: v(0, 1, 0) },
      { weight: 0.2, vec: v(0, 0, 1) },
    ])!;
    expect(dot(out, out)).toBeCloseTo(1);
    expect(out[0] / out[1]).toBeCloseTo(0.5 / 0.3);
    expect(out[1] / out[2]).toBeCloseTo(0.3 / 0.2);
  });

  it("renormalizes over present parts", () => {
    const out = blend([
      { weight: 0.5, vec: v(1, 0) },
      { weight: 0.3, vec: null },
      { weight: 0.2, vec: v(0, 1) },
    ])!;
    expect(out[0] / out[1]).toBeCloseTo(0.5 / 0.2);
    expect(blend([{ weight: 1, vec: null }])).toBeNull();
  });

  it("mean of nothing is null", () => {
    expect(mean([])).toBeNull();
    expect([...mean([v(1, 3), v(3, 1)])!]).toEqual([2, 2]);
  });
});

describe("ownerMatches", () => {
  const user = { id: "devon", name: "Devon Park" };
  it.each(["Devon Park", "devon park", "devon", "Devon"])("%s", (o) => expect(ownerMatches(o, user)).toBe(true));
  it.each([null, "Devonne", "Park"])("not %s", (o) => expect(ownerMatches(o, user)).toBe(false));
});

describe("steering on the seed graph", () => {
  it("projects every node to the org space and gives every user gravity and a full ranking", async () => {
    const store = memoryStore({ seed: true });
    await recomputeUserVectors(store, deps(store).embedder);
    for (const n of store.listNodes()) {
      expect(n.z).toHaveLength(OUT_DIM);
      expect(n.zVersion).toBe(mrlCompressor().id);
    }
    for (const user of store.listUsers()) {
      const g = unpackGravity(user.gravity!);
      expect(g.center).toHaveLength(OUT_DIM);
      expect(g.g).toHaveLength(OUT_DIM);
      expect(user.ranked).toHaveLength(store.listNodes().length);
    }
  });

  it("gives each person distinct gravity", async () => {
    const store = memoryStore({ seed: true });
    await recomputeUserVectors(store, deps(store).embedder);
    const [a, b] = ["priya", "devon"].map((id) => unpackGravity(store.getUser(id)!.gravity!).g);
    expect([...a]).not.toEqual([...b]);
  });

  it("gives a PM and a developer different top context", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const pm = await getContextIds(store, embedder, { userId: "priya", k: 5 });
    const dev = await getContextIds(store, embedder, { userId: "devon", k: 5 });
    expect(pm).toHaveLength(5);
    expect(pm).not.toEqual(dev);
  });

  it("once everything is old, no-query lookups match the stored gravity ranking", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    await recomputeUserVectors(store, embedder);
    const ids = await getContextIds(store, embedder, { userId: "sam", k: 3, now: Date.now() + 1e6 * HOUR });
    expect(ids).toEqual(store.getUser("sam")!.ranked!.slice(0, 3));
  });

  it("queries blend 768d cosine, the pulled org-space score, the person, and freshness", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const scored = await getContextScored(store, embedder, { userId: "mina", q: "google ads daily budget campaign", k: 3 });
    expect(scored.map((s) => s.id)).toContain("q4-search-campaign");
    for (const s of scored) {
      expect(s.fresh).toBeGreaterThan(0);
      expect(s.score).toBeCloseTo(0.4 * s.score768 + 0.3 * s.scoreZ + 0.3 * s.person + s.fresh);
    }
  });

  it("a fresh update to a node lifts it in the person's ranking", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const now = Date.now() + 1000 * HOUR;
    const scoreOf = async (id: string) =>
      (await getContextScored(store, embedder, { userId: "sam", k: 20, now })).find((s) => s.id === id)!;
    const node = store.listNodes()[0];
    const before = await scoreOf(node.id);
    store.upsertGraph(
      { nodes: [{ ...extracted({ label: node.label }), type: node.type, summary: node.summary, domain: node.domain }], edges: [] },
      { sourceKind: "manual", sourceRef: "test", now: new Date(now).toISOString() },
    );
    const after = await scoreOf(node.id);
    expect(after.scoreZ).toBeCloseTo(before.scoreZ);
    expect(after.fresh).toBeCloseTo(FRESHNESS.weight);
    expect(after.score - before.score).toBeCloseTo(FRESHNESS.weight - before.fresh);
  });

  it("re-embeds and re-projects when the embedding model changes", async () => {
    const store = memoryStore({ seed: true });
    store.listNodes().forEach((n) => store.setNodeEmbedding(n.id, normalize(v(1, 1)), "old-model@2"));
    const { embedder } = deps(store);
    await getContextIds(store, embedder, { userId: "priya", k: 3 });
    expect(store.listNodes().every((n) => n.embedModel === embedder.model && n.z?.length === OUT_DIM)).toBe(true);
  });

  it("embeds the question with the asker's role, so the same question ranks differently per person", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const ask = async (userId: string) =>
      (await getContextScored(store, embedder, { userId, q: "google ads daily budget campaign", k: 16 })).map((s) => s.id);
    const [mina, devon] = [await ask("mina"), await ask("devon")];
    expect(mina.indexOf("q4-search-campaign")).toBeLessThan(devon.indexOf("q4-search-campaign"));
  });

  it("re-embeds a person's documents when their role changes", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    await recomputeUserVectors(store, embedder);
    const owned = store.listNodes().filter((n) => ownerMatches(n.owner, store.getUser("devon")!));
    const before = new Map(owned.map((n) => [n.id, n.embedCtx]));
    const other = store.listNodes().find((n) => !owned.includes(n) && n.embedCtx)!;
    const devon = store.getUser("devon")!;
    store.saveUser({ ...devon, role: "Staff engineer on billing and invoices." });
    await recomputeUserVectors(store, embedder);
    expect(owned.length).toBeGreaterThan(0);
    for (const n of owned) expect(store.getNode(n.id)!.embedCtx).not.toBe(before.get(n.id));
    expect(store.getNode(other.id)!.embedCtx).toBe(other.embedCtx);
  });

  it("unknown users get nothing", async () => {
    const store = memoryStore({ seed: true });
    expect(await getContextIds(store, deps(store).embedder, { userId: "ghost", k: 3 })).toEqual([]);
  });
});

describe("embedsScreenshot", () => {
  it("embeds screenshots only for captures with little text, unless told otherwise", () => {
    const before = process.env.EMBED_SCREENSHOTS;
    try {
      delete process.env.EMBED_SCREENSHOTS;
      expect(embedsScreenshot("")).toBe(true);
      expect(embedsScreenshot("a few words")).toBe(true);
      expect(embedsScreenshot("word ".repeat(200))).toBe(false);
      process.env.EMBED_SCREENSHOTS = "always";
      expect(embedsScreenshot("word ".repeat(200))).toBe(true);
      process.env.EMBED_SCREENSHOTS = "never";
      expect(embedsScreenshot("")).toBe(false);
    } finally {
      if (before === undefined) delete process.env.EMBED_SCREENSHOTS;
      else process.env.EMBED_SCREENSHOTS = before;
    }
  });
});

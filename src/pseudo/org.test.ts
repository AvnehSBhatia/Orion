import { describe, expect, it } from "vitest";
import type { Store } from "@/db/store";
import type { CompletionRequest, LlmClient } from "@/llm/openrouter";
import { deps, memoryStore } from "@/test/helpers";
import { ROUTING, activeCompressor, getContextScored, lensFor, rankNodes, recomputeUserVectors, routeOrder } from "@/steer/users";
import { buildClusters } from "./clusters";
import { labelFacets } from "./facets";
import { maintainOrg } from "./maintain";

const AREA = { engineering: "Voice Engineering", marketing: "growth ads", sales: "sales deals", ops: "ops and cost" } as const;

/** Answers each structured call by schema name: facets from each node's domain, digests and summaries as given. */
function orgLlm(store: Store, { digest = "merged" } = {}) {
  const calls: string[] = [];
  const llm: LlmClient = {
    async complete(req: CompletionRequest) {
      const name = (req.response_format as { json_schema: { name: string } }).json_schema.name;
      calls.push(name);
      const user = req.messages.find((m) => m.role === "user")!.content as string;
      let value: unknown;
      if (name === "facets") {
        const ids = [...user.matchAll(/^(\S+) \[/gm)].map((m) => m[1]);
        value = {
          items: ids.map((id) => {
            const n = store.getNode(id);
            const domain = n?.domain ?? (store.getSource(id)?.kind === "code" ? "engineering" : "sales");
            return { id, area: AREA[domain], use: n ? "status update" : "reference" };
          }),
        };
      } else if (name === "digest") value = { title: "Merged", digest: digest === "merged" ? user.replace(/\[\d+\][^\n]*\n/g, "") : digest };
      else value = { summary: user };
      return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(value) } }] };
    },
  };
  return { llm, calls };
}

describe("facets", () => {
  it("labels every item once, normalizes areas, and relabels only what changed", async () => {
    const store = memoryStore({ seed: true });
    const { llm, calls } = orgLlm(store);
    const first = await labelFacets(store, llm, "m");
    expect(first.labeled).toBe(store.listNodes().length + store.listSources().length);
    expect(new Set(store.listFacets().map((f) => f.area))).toContain("voice engineering");

    expect((await labelFacets(store, llm, "m")).labeled).toBe(0);
    expect(calls).toHaveLength(1);

    const n = store.getNode("voice-mode")!;
    store.saveNode({ ...n, summary: "Voice mode now ships to every workspace." });
    expect((await labelFacets(store, llm, "m")).labeled).toBe(1);
  });
});

describe("clusters and routing", () => {
  async function org() {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    await recomputeUserVectors(store, embedder);
    await labelFacets(store, orgLlm(store).llm, "m");
    const clusters = buildClusters(store, activeCompressor(store));
    return { store, embedder, clusters };
  }

  it("builds one cluster per named area and puts every item in one", async () => {
    const { store, clusters } = await org();
    expect(clusters.map((c) => c.label).sort()).toEqual(expect.arrayContaining(["growth ads", "sales deals", "voice engineering"]));
    expect(clusters.reduce((s, c) => s + c.size, 0)).toBe(store.listNodes().length + store.listSources().length);
    expect(store.listNodes().every((n) => n.clusterId)).toBe(true);
  });

  it("a question searches only the cluster whose centroid fits it best, plus any within the tie margin", async () => {
    const { store, embedder } = await org();
    // (With the hash embedder "google ads daily budget campaign" fits every centroid at exactly 0: a full tie.)
    const q = "google ads campaign budget and cost per signup";
    const order = routeOrder((await lensFor(store, embedder, { userId: "mina", q }))!);
    const near = new Set(order.filter((o) => order[0].score - o.score <= ROUTING.margin * order[0].score).map((o) => o.cluster.id));
    expect(near.size).toBeLessThan(order.length);
    const scored = await getContextScored(store, embedder, { userId: "mina", q, k: 2 });
    expect(scored).toHaveLength(2);
    expect(scored.every((s) => near.has(store.getNode(s.id)!.clusterId!))).toBe(true);
  });

  it("routes on the bare question, so the same question picks the same area for everyone", async () => {
    const { store, embedder } = await org();
    const q = "voice latency streaming client";
    const tops = await Promise.all(
      ["devon", "mina", "sam"].map(async (userId) => routeOrder((await lensFor(store, embedder, { userId, q }))!)[0].cluster.id),
    );
    expect(new Set(tops).size).toBe(1);
  });

  it("fills from the next cluster only when the nearest has fewer than k items, and can be turned off", async () => {
    const { store, embedder } = await org();
    const lens = (await lensFor(store, embedder, { userId: "mina", q: "google ads daily budget campaign" }))!;
    const many = rankNodes(store, lens, 12);
    const clusterOf = (id: string) => store.getNode(id)!.clusterId;
    expect(new Set(many.map((s) => clusterOf(s.id))).size).toBeGreaterThan(1);
    const routedTo = clusterOf(many[0].id);
    const firstFill = many.findIndex((s) => clusterOf(s.id) !== routedTo);
    expect(many.slice(firstFill).every((s) => clusterOf(s.id) !== routedTo)).toBe(true);
    expect(many.every((s) => s.cluster === store.listClusters().find((c) => c.id === clusterOf(s.id))!.label)).toBe(true);
    const all = rankNodes(store, lens, store.listNodes().length, undefined, { route: false });
    expect(all).toHaveLength(store.listNodes().length);
  });
});

describe("maintainOrg", () => {
  it("labels, trains, clusters, and reports, and keeps working when the model is unavailable", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const r = await maintainOrg(store, embedder, orgLlm(store).llm, "m", { forceRetrain: true });
    expect("labeled" in r.facets && r.facets.labeled).toBeGreaterThan(0);
    expect("status" in r.retrain && ["adopted", "rejected"]).toContain("status" in r.retrain ? r.retrain.status : "");
    expect(r.clusters.length).toBeGreaterThanOrEqual(3);

    const down: LlmClient = {
      async complete() {
        const { HttpError } = await import("@/server/http");
        throw new HttpError(503, "OPENROUTER_API_KEY is not set on the backend");
      },
    };
    const fresh = memoryStore({ seed: true });
    const r2 = await maintainOrg(fresh, embedder, down, "m");
    expect(r2.facets).toMatchObject({ skipped: expect.stringContaining("503") });
    expect(r2.clusters.length).toBeGreaterThanOrEqual(2);
  });
});

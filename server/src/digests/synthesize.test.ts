import { describe, expect, it } from "vitest";
import type { Store } from "@/db/store";
import { normalize } from "@/lib/vector";
import type { CompletionRequest, LlmClient } from "@/llm/openrouter";
import { collapseDigests } from "@/retrieval/context";
import { deps, memoryStore } from "@/test/helpers";
import { SYNTH, groupCached, groupSimilar, synthesizeDigests } from "./synthesize";

const NOW = "2026-10-10T12:00:00.000Z";

function addSource(store: Store, id: string, title: string, text: string, clusterId = "cl-voice") {
  store.saveSource({ id, kind: "manual", ref: `https://docs.example.com/${id}`, title, text, authorId: "devon", createdAt: NOW, image: null }, []);
  store.setClusterOf("source", id, clusterId);
}

/** Digest = whatever `digest` returns for the member block; summary = whatever `summary` returns. */
function llm(digest: (user: string) => string, summary: (user: string) => string = (u) => u) {
  const calls: string[] = [];
  const client: LlmClient = {
    async complete(req: CompletionRequest) {
      const name = (req.response_format as { json_schema: { name: string } }).json_schema.name;
      calls.push(name);
      const user = req.messages.find((m) => m.role === "user")!.content as string;
      const value = name === "digest" ? { title: "Voice latency", digest: digest(user) } : { summary: summary(user) };
      return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(value) } }] };
    },
  };
  return { client, calls };
}

const latency = "Voice latency fix is blocked on the streaming client. p95 latency is 610 ms, target 400 ms.";
const latency2 = "Voice latency fix is blocked on the streaming client. p95 latency is 600 ms, target 400 ms.";
const ads = "Q4 search campaign daily budget raised to 900 dollars, cost per signup 41.";
const memberBlock = (u: string) => u.replace(/^\[\d+\][^\n]*\n/gm, "");

describe("groupSimilar", () => {
  it("groups each source with its neighbors above the merge threshold, newest first, once", () => {
    const v = (...xs: number[]) => normalize(Float32Array.from(xs));
    const vec = new Map([
      ["a", v(1, 0, 0)],
      ["b", v(0.95, 0.1, 0)],
      ["c", v(0, 1, 0)],
      ["d", v(0.9, 0, 0.2)],
    ]);
    expect(groupSimilar(["a", "b", "c", "d"], vec)).toEqual([["a", "b", "d"]]);
  });
});

describe("groupCached", () => {
  it("matches groupSimilar as sources arrive, change text, and leave", () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    // A few tight topics so many pairs clear the merge threshold, with noise so some do not.
    const topics = Array.from({ length: 4 }, () => normalize(Float32Array.from({ length: 16 }, rand)));
    const make = (t: number, noise: number) => normalize(topics[t].map((x) => x + noise * rand()));
    const store = memoryStore();
    const vec = new Map<string, Float32Array>();
    const hashes = new Map<string, string>();
    let ids: string[] = [];
    const add = (id: string) => {
      vec.set(id, make(Math.floor((rand() + 0.5) * 4) % 4, 0.35));
      hashes.set(id, `${id}-${vec.get(id)![0]}`);
      ids = [id, ...ids];
    };
    for (let i = 0; i < 60; i++) add(`s${i}`);
    for (let round = 0; round < 5; round++) {
      const want = groupSimilar(ids, vec);
      expect(want.length).toBeGreaterThan(3);
      expect(groupCached(store, "cl", ids, vec, hashes)).toEqual(want);
      for (let i = 0; i < 8; i++) add(`r${round}-${i}`);
      const edited = ids[(round * 7) % ids.length];
      vec.set(edited, make(round % 4, 0.2));
      hashes.set(edited, `${edited}-edit-${round}`);
      ids = ids.filter((_, i) => i % 13 !== round);
    }
  });
});

describe("synthesizeDigests", () => {
  it("merges similar sources into a faithful digest, keeps it on rerun, and drops it when a member goes", async () => {
    const store = memoryStore({ seed: true });
    store.reset();
    store.saveUser({ id: "devon", name: "Devon Park", role: "Software engineer.", teamDescription: "" });
    addSource(store, "src-a", "Voice latency", latency);
    addSource(store, "src-b", "Voice latency update", latency2);
    addSource(store, "src-c", "Ads", ads);
    const { embedder } = deps(store);
    const { client, calls } = llm(memberBlock);

    const r = await synthesizeDigests(store, embedder, client, "m");
    expect(r).toMatchObject({ groups: 1, created: 1, rejected: 0 });
    const [d] = store.listDigests();
    expect(d.members.sort()).toEqual(["src-a", "src-b"]);
    expect(d.fidelity).toBeGreaterThanOrEqual(SYNTH.digestFidelity);
    const pub = store.readDocument(d.id)!.source;
    expect(pub.kind).toBe("digest");
    expect(pub.members!.map((m) => m.id).sort()).toEqual(["src-a", "src-b"]);

    expect(await synthesizeDigests(store, embedder, client, "m")).toMatchObject({ kept: 1, created: 0 });
    expect(calls.filter((c) => c === "digest")).toHaveLength(1);

    store.db.prepare("DELETE FROM sources WHERE id = 'src-b'").run();
    expect((await synthesizeDigests(store, embedder, client, "m")).deleted).toBe(1);
    expect(store.listDigests()).toEqual([]);
  });

  it("rejects a digest that drifts from its members", async () => {
    const store = memoryStore();
    addSource(store, "src-a", "Voice latency", latency);
    addSource(store, "src-b", "Voice latency update", latency2);
    const { client } = llm(() => "Team offsite is moved to Friday in the main office.");
    const r = await synthesizeDigests(store, deps(store).embedder, client, "m");
    expect(r).toMatchObject({ created: 0, rejected: 1 });
    expect(store.listDigests()).toEqual([]);
  });

  it("summarizes long members first and keeps a summary only when it is faithful", async () => {
    const store = memoryStore();
    addSource(store, "src-a", "Voice latency", `${latency} `.repeat(30));
    addSource(store, "src-b", "Voice latency update", `${latency2} `.repeat(30));
    const faithful = llm(memberBlock, () => latency);
    await synthesizeDigests(store, deps(store).embedder, faithful.client, "m");
    expect(store.getSummary("src-a")?.text).toBe(latency);

    const store2 = memoryStore();
    addSource(store2, "src-a", "Voice latency", `${latency} `.repeat(30));
    addSource(store2, "src-b", "Voice latency update", `${latency2} `.repeat(30));
    const drifting = llm(memberBlock, () => "Lunch menu for the week.");
    await synthesizeDigests(store2, deps(store2).embedder, drifting.client, "m");
    expect(store2.getSummary("src-a")).toBeNull();
  });
});

describe("collapseDigests", () => {
  it("replaces two or more chosen members with their digest, in place", async () => {
    const store = memoryStore();
    addSource(store, "src-a", "Voice latency", latency);
    addSource(store, "src-b", "Voice latency update", latency2);
    addSource(store, "src-c", "Ads", ads, "cl-ads");
    await synthesizeDigests(store, deps(store).embedder, llm(memberBlock).client, "m");
    const pick = (id: string) => ({ ...store.toPublicSource(store.getSource(id)!), why: "x" });

    const out = collapseDigests(store, [pick("src-c"), pick("src-a"), pick("src-b")], Date.parse(NOW));
    expect(out.map((s) => s.kind)).toEqual(["manual", "digest"]);
    expect(out[1].why).toMatch(/^digest of 2 similar documents/);
    expect(collapseDigests(store, [pick("src-a"), pick("src-c")], Date.parse(NOW)).map((s) => s.id)).toEqual(["src-a", "src-c"]);
  });
});

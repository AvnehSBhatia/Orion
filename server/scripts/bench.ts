// Server CPU benchmark on a copy of a real org file. Embedder and model are fakes, so this measures only our own code.
// npx tsx scripts/bench.ts [data/orgs/northwind.db] [captures=20]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, type GraphUpdate } from "@/db/store";
import { readGraph } from "@/graph/view";
import { projectEmbeddings } from "@/graph/projection";
import { ingestCapture, type IngestDeps } from "@/ingest/pipeline";
import { normalize, type EmbedInput, type Embedder } from "@/llm/embed";
import type { Extractor } from "@/llm/extract";
import type { LlmClient } from "@/llm/openrouter";
import { maintainOrg } from "@/pseudo/maintain";
import { HttpError } from "@/server/http";
import { buildContext } from "@/steer/context";
import { feedFor } from "@/steer/feed";
import { recomputeUserVectors } from "@/steer/users";

const src = process.argv[2] ?? "data/orgs/northwind.db";
const captures = Number(process.argv[3] ?? 20);
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orion-bench-")), "org.db");
fs.copyFileSync(src, file);
for (const ext of ["-wal", "-shm"]) if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, file + ext);
const store = Store.open(file);

const model = store.listNodes().find((n) => n.embedModel)?.embedModel ?? "bench@768";
let embedCalls = 0;
let embedItems = 0;
const embedder: Embedder = {
  model,
  async embed(inputs: EmbedInput[]) {
    embedCalls++;
    embedItems += inputs.length;
    if (process.env.TRACE && inputs.length > 50) console.log(`embed ${inputs.length}`, new Error().stack?.split("\n").slice(2, 6).map((l) => l.trim()).join(" < "));
    return inputs.map(() => normalize(Float32Array.from({ length: 768 }, () => Math.random() - 0.5)));
  },
};
let n = 0;
const extractor: Extractor = {
  async fromCapture() {
    n++;
    return { nodes: [{ label: `Bench item ${n}`, type: "task", domain: "engineering", summary: `bench ${n}`, todo: null, readLinks: [], owner: null, status: "on_track", sellable: null }], edges: [] } satisfies GraphUpdate;
  },
  async fromCode() {
    return { nodes: [], edges: [] };
  },
};
const llm: LlmClient = {
  async complete() {
    throw new HttpError(503, "bench: no model");
  },
};

const users = store.listUsers();
const user = users[0].id;
const counts = store.counts();
console.log(`${path.basename(src)}: ${counts.nodes} nodes, ${counts.sources} sources, ${users.length} users, model ${model}`);

async function time(label: string, runs: number, fn: (i: number) => Promise<unknown> | unknown) {
  await fn(-1); // warm
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn(i);
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  const p50 = t[Math.floor(t.length / 2)];
  const max = t[t.length - 1];
  console.log(`${label.padEnd(34)} p50 ${p50.toFixed(1).padStart(8)} ms   max ${max.toFixed(1).padStart(8)} ms`);
}

// Production shape: background work on, so refresh and maintenance are coalesced off the request path.
const deps: IngestDeps = { store, embedder, extractor, background: { llm, model: "none" } };
const html = (i: number) => `<html><body><h1>Ticket ${i}</h1><p>${"Working on the checkout flow and payment retries. ".repeat(40)} ${i}</p></body></html>`;

await time("recomputeUserVectors (no changes)", 5, () => recomputeUserVectors(store, embedder));
await time("POST capture (new page)", captures, (i) =>
  ingestCapture(deps, { userId: user, url: `https://example.com/t/${i}-${Math.random()}`, title: `T ${i}`, html: html(i), screenshotB64: "" }),
);
await time("refresh after a burst (recompute)", 3, () => recomputeUserVectors(store, embedder));
await time("GET /api/graph", 10, () => JSON.stringify(readGraph(store)));
await time("GET /api/context (q)", 10, (i) => buildContext(store, embedder, { userId: user, q: `checkout retries ${i}` }));
await time("GET /api/context (no q)", 10, () => buildContext(store, embedder, { userId: user, q: "" }));
await time("GET /api/feed", 10, () => feedFor(store, embedder, { userId: user, sinceHours: 24 * 90, limit: 20 }));
await time("GET /api/activity listSources(40)", 10, () => store.listSources(undefined, 40).map((s) => store.toPublicSource(s)));
await time("GET /api/embeddings (uncached)", 3, (i) => projectEmbeddings(store, `bench-${i}`));
await time("maintainOrg (model steps skipped)", 2, () => maintainOrg(store, embedder, llm, "none"));
console.log(`embed calls ${embedCalls}, items ${embedItems}`);
const mem = process.memoryUsage();
console.log(`rss ${(mem.rss / 1e6).toFixed(0)} MB, heap ${(mem.heapUsed / 1e6).toFixed(0)} MB`);

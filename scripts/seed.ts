// Resets an org (default: demo) to the demo people, graph, and source documents, embeds everything with
// EmbeddingGemma 2 (role context on documents), has the org model label areas and uses, trains the 64d org
// space, builds the area clusters, synthesizes digests, and fits every person's gravity.
// Usage: npm run seed [orgId]

import { config } from "@/config";
import { seedDemo } from "@/db/seed";
import { Store } from "@/db/store";
import { createEmbedder } from "@/llm/embed";
import { OpenRouterClient } from "@/llm/openrouter";
import { maintainOrg } from "@/pseudo/maintain";
import { orgDbPath } from "@/server/deps";
import { recomputeUserVectors } from "@/steer/users";

const orgId = process.argv[2] ?? "demo";
const store = Store.open(orgDbPath(orgId));
seedDemo(store, { force: true });
const embedder = createEmbedder();
const sec = (t: number) => `${((performance.now() - t) / 1000).toFixed(1)}s`;

let t = performance.now();
await recomputeUserVectors(store, embedder);
console.log(
  `Embedded ${store.listNodes().length} nodes, ${store.listSources().length} sources, ${store.listUsers().length} people with ${embedder.model} in ${sec(t)}`,
);

t = performance.now();
const r = await maintainOrg(store, embedder, new OpenRouterClient(), config.extractModel, { forceRetrain: true });
console.log(`\nOrg maintenance in ${sec(t)}`);
console.log("facets:", r.facets);
console.log("org space:", "status" in r.retrain ? { status: r.retrain.status, ...("metrics" in r.retrain ? r.retrain.metrics : {}) } : r.retrain);

const facets = store.listFacets();
const nodes = new Map(store.listNodes().map((n) => [n.id, n]));
const sources = new Map(store.listSources().map((s) => [s.id, s]));
console.log("\nclusters:");
for (const c of r.clusters) {
  const members = [
    ...[...nodes.values()].filter((n) => n.clusterId === c.id).map((n) => n.label),
    ...[...sources.values()].filter((s) => s.clusterId === c.id).map((s) => `[doc] ${s.title}`),
  ];
  console.log(`  ${c.label} (${c.size}): ${members.join(" | ")}`);
}
console.log(`  uses: ${[...new Set(facets.map((f) => f.use))].join(", ")}`);

console.log("\ndigests:", "created" in r.digests ? { ...r.digests, details: undefined } : r.digests);
if ("details" in r.digests) for (const d of r.digests.details) console.log(`  ${d.accepted ? "kept" : "rejected"} "${d.title}" (${d.members} docs) fidelity ${d.fidelity.toFixed(3)}, weakest member ${d.minMember.toFixed(3)}`);
for (const d of store.listDigests()) console.log(`  ${d.id}: ${d.text.slice(0, 220)}...`);

for (const user of store.listUsers()) console.log(`  ${user.id.padEnd(6)} ${(user.ranked ?? []).slice(0, 4).join(", ")}`);

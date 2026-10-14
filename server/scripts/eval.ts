// Retrieval eval on the seeded demo org with the configured embedder (EmbeddingGemma by default).
// Prints precision@5, recall@10, MRR, and own-work intrusion per surface, for tuning and held-out cases.
// Usage: MODEL_CACHE_DIR=/abs/path/.cache/models npx tsx scripts/eval.ts [--details] [--no-train]
import { buildEvalOrg, cachingEmbedder, details, runCases, table } from "@/eval/retrieval";
import { createEmbedder } from "@/llm/embed";

const args = new Set(process.argv.slice(2));
const embedder = cachingEmbedder(createEmbedder());
const t = performance.now();
const { store, now } = await buildEvalOrg(embedder, { train: !args.has("--no-train") });
const results = await runCases(store, embedder, now);
const held = results.filter((r) => r.heldOut).length;
console.log(`model ${embedder.model}, ${results.length} cases (${held} held out), ${((performance.now() - t) / 1000).toFixed(1)}s\n`);
console.log(table(results));
if (args.has("--details")) console.log(`\n${details(results)}`);

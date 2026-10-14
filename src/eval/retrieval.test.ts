import { describe, expect, it } from "vitest";
import { LocalHashEmbedder } from "@/llm/embed";
import { CASES, buildEvalOrg, metrics, runCases } from "./retrieval";

// Regression guard on half the retrieval eval with the hash embedder (lexical, fast). The real numbers come from
// `npx tsx scripts/eval.ts` with EmbeddingGemma; these floors sit a little under what the hash embedder scores.
describe("retrieval eval (hash embedder slice)", () => {
  it("finds explicit topics for outsiders without own-work intrusion, and keeps vague questions on the asker's work", async () => {
    const embedder = new LocalHashEmbedder();
    const { store, now } = await buildEvalOrg(embedder);
    const slice = CASES.filter((_, i) => i % 2 === 0);
    const results = await runCases(store, embedder, now, slice);
    const task = metrics(results, "taskItems");
    const search = metrics(results, "searchItems");
    if (process.env.PRINT_EVAL) console.log({ task, search });

    expect(task.mrr).toBeGreaterThanOrEqual(FLOOR.taskMrr);
    expect(task.p5).toBeGreaterThanOrEqual(FLOOR.taskP5);
    expect(search.mrr).toBeGreaterThanOrEqual(FLOOR.searchMrr);
    expect(task.intrusion!).toBeLessThanOrEqual(FLOOR.taskIntrusion);

    // A vague question leads with the asker's own work.
    for (const r of results.filter((r) => r.case.kind === "vague")) expect(r.own.has(r.ranked.taskItems[0]), r.case.id).toBe(true);
  });
});

/** Measured on this slice: task MRR 0.91, P@5 0.88, search MRR 0.85, intrusion 0.125 (before the fix: 1.0). */
const FLOOR = { taskMrr: 0.85, taskP5: 0.8, searchMrr: 0.8, taskIntrusion: 0.25 };

import { describe, expect, it } from "vitest";
import { applyUpdate } from "@/ingest/pipeline";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { neighborhood } from "./neighborhood";
import { buildTaskContext, MAX_CHARS, WRITE_TO } from "./taskContext";

describe("buildTaskContext", () => {
  it("builds one markdown file with every section, the closest items first, and a write_to hint", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const ctx = await buildTaskContext(store, embedder, { userId: "devon", task: "fix voice mode latency before the general release" });
    if (process.env.PRINT_CONTEXT) console.log(ctx.markdown);

    expect(ctx.writeTo).toBe(WRITE_TO);
    expect(ctx.markdown.length).toBeLessThanOrEqual(MAX_CHARS);
    for (const h of ["## Situation", "## Work items", "## What changed recently", "## Key documents", "## Open gaps", "## What to do next"]) {
      expect(ctx.markdown).toContain(h);
    }
    expect(ctx.itemIds.slice(0, 8)).toContain("voice-latency-fix");
    // Blockers and ripple are explained, documents carry ids for read_document.
    expect(ctx.markdown).toContain("Downstream: blocks Voice mode general release (`voice-mode-general-release`, at risk)");
    expect(ctx.markdown).toContain("Voice latency fix: on track -> **blocked**");
    expect(ctx.markdown).toContain("Upstream: blocked by Audio streaming service (`audio-streaming-service`");
    // No duplicate next steps.
    const steps = ctx.markdown.split("## What to do next")[1].split("\n").filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, ""));
    expect(new Set(steps).size).toBe(steps.length);
    expect(ctx.sourceIds.length).toBeGreaterThan(0);
    for (const id of ctx.sourceIds) expect(ctx.markdown).toContain(`\`${id}\``);
  });

  it("is deterministic for the same store, task, and time", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const now = Date.now();
    const a = await buildTaskContext(store, embedder, { userId: "sam", task: "acme renewal", now });
    const b = await buildTaskContext(store, embedder, { userId: "sam", task: "acme renewal", now });
    expect(a.markdown).toBe(b.markdown);
  });

  it("lists a fresh status flip first under recent changes, with who, when, and the source URL", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, {
      nodes: [extracted({ label: "Q4 search campaign", type: "campaign", domain: "marketing", status: "at_risk", owner: "Mina Rao" })],
      edges: [],
    });
    const before = store.getNode("q4-search-campaign")!.status;
    await applyUpdate(d, await d.extractor.fromCapture({ url: "u", title: "t", text: "" }, []), {
      kind: "extension",
      ref: "https://ads.google.com/aw/campaigns?campaignId=42",
      title: "Google Ads: Q4 search budget cut to $200/day",
      text: "Daily budget lowered from $500 to $200. Campaign limited by budget.",
      image: null,
    }, "mina");

    const ctx = await buildTaskContext(store, d.embedder, { userId: "devon", task: "Q4 search campaign google ads budget", sinceHours: 1 });
    expect(ctx.changes[0]).toMatchObject({ who: "Mina Rao", ref: "https://ads.google.com/aw/campaigns?campaignId=42", flip: before !== "at_risk" });
    const section = ctx.markdown.split("## What changed recently")[1].split("##")[0];
    expect(section).toContain("Mina Rao");
    expect(section).toContain("https://ads.google.com/aw/campaigns?campaignId=42");
    expect(section).toContain("Q4 search campaign:");
    if (before !== "at_risk") expect(section).toContain(`-> **at risk**`);
  });

  it("stays under the size cap with a large k and still ends with next steps", async () => {
    const store = memoryStore({ seed: true });
    const { embedder } = deps(store);
    const ctx = await buildTaskContext(store, embedder, { userId: "priya", task: "everything", k: 30, sinceHours: 2000 });
    expect(ctx.markdown.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(ctx.markdown).toContain("## What to do next");
  });

  it("graph_neighborhood follows links both ways with rippled statuses", () => {
    const store = memoryStore({ seed: true });
    const hood = neighborhood(store, "voice-latency-fix", 1)!;
    const byId = new Map(hood.nodes.map((n) => [n.id, n]));
    expect(byId.get("voice-latency-fix")).toMatchObject({ hops: 0, status: "blocked" });
    expect(byId.get("voice-mode-general-release")).toMatchObject({ hops: 1, status: "at_risk" });
    expect(hood.edges).toContainEqual({ from: "voice-latency-fix", relation: "blocks", to: "voice-mode-general-release" });
    expect(neighborhood(store, "nope")).toBeNull();
  });

  it("says so when the person is unknown or nothing matches", async () => {
    const store = memoryStore();
    const { embedder } = deps(store);
    const ctx = await buildTaskContext(store, embedder, { userId: "nobody", task: "anything" });
    expect(ctx.itemIds).toEqual([]);
    expect(ctx.markdown).toContain("no work items related to this task");
  });
});

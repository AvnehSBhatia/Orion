import { describe, expect, it } from "vitest";
import { applyUpdate } from "@/ingest/pipeline";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { fakeLlm } from "@/test/llm";
import type { LlmClient } from "@/llm/openrouter";
import { briefFor, cachedBrief, templateBrief } from "./brief";

const sam = { id: "sam", name: "Sam Ortiz", role: "Account executive. Deals and renewals.", teamDescription: "" };

async function withAcmeSlip() {
  const store = memoryStore({ seed: true });
  const d = deps(store, { nodes: [extracted({ label: "Acme renewal", type: "deal", domain: "sales", status: "at_risk" })], edges: [] });
  await applyUpdate(d, await d.extractor.fromCapture({ url: "u", title: "t", text: "" }, []), {
    kind: "extension",
    ref: "https://app.hubspot.com/acme",
    title: "Acme renewal slipped",
    text: "Acme pushed the signature to December.",
    image: null,
  }, "priya");
  return { store, embedder: d.embedder };
}

describe("briefFor", () => {
  it("falls back to a cited template without a model", async () => {
    const { store, embedder } = await withAcmeSlip();
    const brief = await briefFor(store, embedder, sam, { llm: null });
    expect(brief.text).toMatch(/^(Morning|Afternoon|Evening) Sam, \d+ things? moved for you: /);
    expect(brief.text).toContain("Priya changed Acme renewal, which you own, now at risk [1]");
    expect(brief.sources[0].title).toBe("Acme renewal slipped");
  });

  it("uses one model call and renumbers its citations", async () => {
    const { store, embedder } = await withAcmeSlip();
    const { llm, requests } = fakeLlm([{ content: "Morning Sam, 1 thing moved for you: Acme slipped to December [S1]." }]);
    const brief = await briefFor(store, embedder, sam, { llm });
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0].content).toContain("Sam's personal chief of staff");
    expect(brief.text).toBe("Morning Sam, 1 thing moved for you: Acme slipped to December [1].");
    expect(brief.sources).toHaveLength(1);
  });

  it("uses the template when the model is slower than the budget", async () => {
    const { store, embedder } = await withAcmeSlip();
    const slow: LlmClient = { complete: () => new Promise(() => {}) };
    const brief = await briefFor(store, embedder, sam, { llm: slow, timeoutMs: 20 });
    expect(brief.text).toContain("[1]");
  });

  it("says when nothing moved", () => {
    expect(templateBrief(sam, [], Date.parse("2026-10-10T09:00:00")).text).toBe("Morning Sam, nothing new for you in the last 2 hours.");
  });

  it("caches per key for 60s", async () => {
    let calls = 0;
    const make = async () => ({ text: `n${++calls}`, sources: [] });
    expect((await cachedBrief("t:sam", make, 1_000)).text).toBe("n1");
    expect((await cachedBrief("t:sam", make, 30_000)).text).toBe("n1");
    expect((await cachedBrief("t:sam", make, 70_000)).text).toBe("n2");
  });
});

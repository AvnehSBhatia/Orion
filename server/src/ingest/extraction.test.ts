import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphUpdate } from "@/db/store";
import { HttpError } from "@/http/error";
import type { Extractor } from "@/llm/extract";
import { saveOrgSettings } from "@/orgs/settings";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { BudgetExceededError, recordUsage } from "@/usage";
import { duePendingCount, extractionEnv, extractionState, retryDelayMs, retryPendingExtractions } from "./extraction";
import { cleanCaptureUrl, ingestCapture, ingestCode } from "./pipeline";

const T0 = Date.parse("2026-10-14T12:00:00Z");
const capture = {
  userId: "mina",
  url: "https://docs.example.com/plan?token=secret&utm=x#section-2",
  title: "Launch plan",
  html: "<p>Launch plan for the Q4 search campaign. Budget is 900 a day.</p>",
  screenshotB64: "",
};
const WORK: GraphUpdate = { nodes: [extracted({ label: "Q4 search campaign", type: "campaign", domain: "marketing" })], edges: [] };

/** An extractor that fails with each queued error in turn, then returns `update`. */
function flaky(errors: unknown[], update: GraphUpdate = WORK): Extractor & { calls: number } {
  const ex = {
    calls: 0,
    async fromCapture() {
      ex.calls++;
      const err = errors.shift();
      if (err) throw err;
      return update;
    },
    async fromCode() {
      return ex.fromCapture();
    },
  };
  return ex;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("capture hygiene", () => {
  it("strips query strings and fragments, keeping the path", () => {
    expect(cleanCaptureUrl("https://a.com/x/y?q=1#top")).toBe("https://a.com/x/y");
    expect(cleanCaptureUrl("not a url?x=1")).toBe("not a url");
  });

  it("stores and sends the cleaned URL", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, WORK);
    const res = await ingestCapture(d, capture, T0);
    expect(store.getSource(res.sourceId!)!.ref).toBe("https://docs.example.com/plan");
    expect((d.extractor.calls[0] as { url: string }).url).toBe("https://docs.example.com/plan");
    expect(store.getNode("q4-search-campaign")!.sourceRef).toBe("https://docs.example.com/plan");
  });

  it("drops captures of excluded hosts and captures while capture is off", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, WORK);
    const before = store.counts().sources;
    saveOrgSettings(store, { excludedHosts: ["example.com"] });
    expect(await ingestCapture(d, capture, T0)).toEqual({ nodesTouched: [], sourceId: null, imageStatus: "none" });
    saveOrgSettings(store, { excludedHosts: [], captureEnabled: false });
    expect((await ingestCapture(d, capture, T0)).sourceId).toBeNull();
    expect(d.extractor.calls).toHaveLength(0);
    expect(store.counts().sources).toBe(before);
  });
});

describe("extraction retry", () => {
  it("marks a source pending when extraction fails, then extracts it in the background", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCapture = async () => {
      throw new HttpError(504, "model provider timed out");
    };
    const res = await ingestCapture(d, capture, T0);
    expect(extractionState(store, res.sourceId!)).toEqual({ state: "pending", attempts: 1, nextAt: new Date(T0 + retryDelayMs(1)).toISOString() });
    expect(duePendingCount(store, T0)).toBe(0);
    expect(duePendingCount(store, T0 + retryDelayMs(1))).toBe(1);

    // Not due yet: nothing runs.
    const ex = flaky([]);
    expect((await retryPendingExtractions(store, ex, { now: T0 })).tried).toBe(0);

    const r = await retryPendingExtractions(store, ex, { now: T0 + retryDelayMs(1) });
    expect(r).toMatchObject({ tried: 1, extracted: 1 });
    expect(extractionState(store, res.sourceId!)!.state).toBe("done");
    expect(store.sourceChanges(res.sourceId!).map((c) => c.nodeId)).toEqual(["q4-search-campaign"]);
    expect(store.touchedNodeIds("mina")).toContain("q4-search-campaign");
  });

  it("backs off between attempts and gives up after the last one", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCapture = async () => {
      throw new HttpError(502, "model provider failed");
    };
    const { sourceId } = await ingestCapture(d, capture, T0);
    const down = new HttpError(502, "model provider failed");
    const ex = flaky(Array.from({ length: 10 }, () => down));
    let now = T0;
    for (let attempt = 2; attempt <= extractionEnv.maxAttempts; attempt++) {
      now = Date.parse(extractionState(store, sourceId!)!.nextAt!);
      await retryPendingExtractions(store, ex, { now });
    }
    expect(retryDelayMs(3)).toBe(4 * retryDelayMs(2));
    expect(extractionState(store, sourceId!)).toMatchObject({ state: "failed", attempts: extractionEnv.maxAttempts, nextAt: null });
    expect(store.getSource(sourceId!)).not.toBeNull();
    expect(await retryPendingExtractions(store, ex, { now: now + 86_400_000 })).toMatchObject({ tried: 0 });
  });

  it("deletes a pending capture the model then finds no work in", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCapture = async () => {
      throw new HttpError(502, "x");
    };
    const { sourceId } = await ingestCapture(d, capture, T0);
    const r = await retryPendingExtractions(store, flaky([], { nodes: [], edges: [] }), { now: T0 + 86_400_000 });
    expect(r.notWork).toBe(1);
    expect(store.getSource(sourceId!)).toBeNull();
  });

  it("retries a commit from its stored diff", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCode = async () => {
      throw new HttpError(502, "x");
    };
    const { sourceId } = await ingestCode(d, { repo: "acme/app", commitSha: "abc1234", userId: "devon", files: [{ path: "src/a.ts", diff: "+a()" }, { path: "src/b.ts", diff: "+b()" }] }, 4000);
    expect(extractionState(store, sourceId!)!.state).toBe("pending");
    let sent: unknown;
    const ex: Extractor = {
      fromCapture: async () => WORK,
      fromCode: async (input) => {
        sent = input;
        return WORK;
      },
    };
    await retryPendingExtractions(store, ex, { now: Date.now() + 86_400_000 });
    expect(sent).toMatchObject({ repo: "acme/app", commitSha: "abc1234", files: [{ path: "src/a.ts", diff: "+a()" }, { path: "src/b.ts", diff: "+b()" }] });
    expect(extractionState(store, sourceId!)!.state).toBe("done");
  });
});

describe("budget", () => {
  it("stores a capture without extraction when the budget is spent, and does not retry it", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCapture = async () => {
      throw new BudgetExceededError();
    };
    const { sourceId } = await ingestCapture(d, capture, T0);
    expect(store.getSource(sourceId!)).not.toBeNull();
    expect(extractionState(store, sourceId!)!.state).toBe("skipped");
    expect(duePendingCount(store, T0 + 86_400_000 * 30)).toBe(0);
  });

  it("holds retries while the org is over budget without using up attempts", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCapture = async () => {
      throw new HttpError(502, "x");
    };
    const { sourceId } = await ingestCapture(d, capture, Date.now());
    saveOrgSettings(store, { llmMonthlyBudgetUsd: 1 });
    recordUsage(store, { model: "m", kind: "extract", inputTokens: 0, outputTokens: 0, costUsd: 2 });
    const ex = flaky([]);
    const r = await retryPendingExtractions(store, ex, { now: Date.now() + retryDelayMs(1) });
    expect(r).toMatchObject({ tried: 0, overBudget: true });
    expect(ex.calls).toBe(0);
    expect(extractionState(store, sourceId!)).toMatchObject({ state: "pending", attempts: 1 });
  });
});

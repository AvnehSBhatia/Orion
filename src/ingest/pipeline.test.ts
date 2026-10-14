import { describe, expect, it } from "vitest";
import { OUT_DIM } from "@/pseudo/compressor";
import { HttpError } from "@/server/http";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { ingestCapture, ingestCode, isAlwaysExcluded } from "./pipeline";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const capture = {
  userId: "mina",
  url: "https://ads.google.com/x",
  title: "Ads",
  html: "<html><style>.a{}</style><script>track()</script><p>Daily budget&nbsp;900</p><div>Cost per signup 41</div></html>",
  screenshotB64: PNG_1PX,
};

describe("ingestCapture", () => {
  it("upserts, stores the page as a source with its changes, embeds, records the touch, and re-steers", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, {
      nodes: [extracted({ label: "Q4 search campaign", type: "campaign", domain: "marketing", summary: "Budget is now 900 dollars a day.", status: "at_risk" })],
      edges: [{ source: "Q4 search campaign", target: "cost-per-signup", relation: "feeds" }],
    });

    const res = await ingestCapture(d, capture);

    expect(res.nodesTouched).toEqual(["q4-search-campaign"]);
    expect(res.sourceId).toMatch(/^src-[0-9a-f]{12}$/);
    const node = store.getNode("q4-search-campaign")!;
    expect(node.summary).toBe("Budget is now 900 dollars a day.");
    expect(node.sourceRef).toBe(capture.url);
    expect(node.embedModel).toBe(d.embedder.model);

    const sent = d.extractor.calls[0] as { text: string };
    expect(sent.text).toBe("Daily budget 900\nCost per signup 41");

    const source = store.getSource(res.sourceId!)!;
    expect(source).toMatchObject({ kind: "extension", ref: capture.url, authorId: "mina", hasImage: true, imageStatus: "kept", embedModel: d.embedder.model });
    expect(res.imageStatus).toBe("kept");
    expect(source.z).toHaveLength(OUT_DIM);
    expect(store.sourceImage(res.sourceId!)!.subarray(8, 12).toString()).toBe("WEBP");
    expect(store.toPublicSource(source)).toMatchObject({
      authorName: "Mina Rao",
      changes: [{ nodeId: "q4-search-campaign", label: "Q4 search campaign", change: "updated", statusFrom: "on_track", statusTo: "at_risk" }],
    });
    expect(store.sourceIdsForNode("q4-search-campaign")[0]).toBe(res.sourceId);
    expect(store.touchedNodeIds("mina")).toContain("q4-search-campaign");
    expect(store.getUser("mina")!.ranked).toHaveLength(store.listNodes().length);
  });
});

const WORK = { nodes: [extracted({ label: "Q4 search campaign", type: "campaign" as const, domain: "marketing" as const })], edges: [] };

describe("screenshot gate", () => {
  it("drops the screenshot when its text is already on the page", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, WORK, { ocrText: "Daily budget 900\nCost per signup 41" });
    const res = await ingestCapture(d, capture);
    const source = store.getSource(res.sourceId!)!;
    expect(res.imageStatus).toBe("text_only");
    expect(source).toMatchObject({ hasImage: false, imageStatus: "text_only", ocrText: "Daily budget 900\nCost per signup 41" });
    expect((d.extractor.calls[0] as { text: string }).text).toBe("Daily budget 900\nCost per signup 41");
  });

  it("keeps a screenshot that says something new and lets the extractor read its text", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, WORK, { ocrText: "Conversion chart: signups fell 30 percent after the bid change on Tuesday" });
    const res = await ingestCapture(d, capture);
    expect(res.imageStatus).toBe("kept");
    expect(store.getSource(res.sourceId!)!.hasImage).toBe(true);
    expect((d.extractor.calls[0] as { text: string }).text).toContain("Text in the screenshot:\nConversion chart");
  });
});

describe("repeat captures", () => {
  const T0 = Date.parse("2026-10-10T12:00:00Z");
  const sources = (store: ReturnType<typeof memoryStore>) => store.listSources().filter((s) => s.ref === capture.url);

  it("answers a repeat of the sender's last capture from it without calling the model", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, WORK);
    const first = await ingestCapture(d, capture, T0);
    const again = await ingestCapture(d, capture, T0 + 5_000);
    expect(again).toEqual({ nodesTouched: [], sourceId: first.sourceId, imageStatus: "kept", duplicateOf: first.sourceId });
    expect(d.extractor.calls).toHaveLength(1);
    expect(sources(store)).toHaveLength(1);
  });

  it("stores the capture again when the page text, the screenshot text, the sender, or the window changes", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, WORK, { ocrText: "Conversion chart: signups fell 30 percent after the bid change" });
    await ingestCapture(d, capture, T0);
    const edited = await ingestCapture(d, { ...capture, html: "<p>Daily budget 950</p><div>Cost per signup 41</div>" }, T0 + 5_000);
    d.ocr = async () => ({ text: "Conversion chart: signups recovered by Friday after the bid change", confidence: 90 });
    const scrolled = await ingestCapture(d, { ...capture, html: "<p>Daily budget 950</p><div>Cost per signup 41</div>" }, T0 + 10_000);
    const otherUser = await ingestCapture(d, { ...capture, userId: "devon" }, T0 + 15_000);
    const later = await ingestCapture(d, { ...capture, userId: "devon" }, T0 + 15_000 + 31 * 60_000);
    expect([edited, scrolled, otherUser, later].every((r) => !r.duplicateOf)).toBe(true);
    expect(d.extractor.calls).toHaveLength(5);
    expect(sources(store)).toHaveLength(5);
  });
});

describe("pages with no work on them", () => {
  const T0 = Date.parse("2026-10-10T12:00:00Z");
  const inbox = {
    userId: "devon",
    url: "https://mail.google.com/mail/u/0/#inbox",
    title: "Inbox (8,629)",
    html: "<p>Inbox 8,629</p><p>Mom: dinner on Sunday?</p><p>Bank: your statement is ready</p><p>Store: 20 percent off shoes this weekend</p>",
    screenshotB64: "",
  };

  it("stores nothing when the model finds no work", async () => {
    const store = memoryStore({ seed: true });
    const before = store.listSources().length;
    const d = deps(store);
    const res = await ingestCapture(d, inbox, T0);
    expect(res).toEqual({ nodesTouched: [], sourceId: null, imageStatus: "none", notWork: true });
    expect(store.listSources()).toHaveLength(before);
    expect(d.extractor.calls).toHaveLength(1);
  });

  it("does not re-send the same page to the model while it stays about the same", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    await ingestCapture(d, inbox, T0);
    const recount = await ingestCapture(d, { ...inbox, html: inbox.html.replace("8,629", "8,630") }, T0 + 5_000);
    expect(recount.notWork).toBe(true);
    expect(d.extractor.calls).toHaveLength(1);
  });

  it("judges the page again when it changes a lot, when someone else sends it, or after the window", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    await ingestCapture(d, inbox, T0);
    await ingestCapture(d, { ...inbox, html: "<p>Q4 search campaign: daily budget raised to 950, cost per signup 41</p>" }, T0 + 5_000);
    await ingestCapture(d, { ...inbox, userId: "mina" }, T0 + 10_000);
    await ingestCapture(d, inbox, T0 + 31 * 60_000);
    expect(d.extractor.calls).toHaveLength(4);
  });
});

describe("ingest without a model", () => {
  it("still stores and embeds the source when extraction is unavailable", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCapture = async () => {
      throw new HttpError(503, "OPENROUTER_API_KEY is not set on the backend");
    };
    const res = await ingestCapture(d, capture);
    expect(res.nodesTouched).toEqual([]);
    expect(store.getSource(res.sourceId!)).toMatchObject({ hasImage: true, embedModel: d.embedder.model });
  });
});

describe("ingestCode", () => {
  it("stores the commit as a source and never sends secrets or lockfiles to the model", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, { nodes: [extracted({ label: "Usage export API", sellable: true })], edges: [] });

    const res = await ingestCode(
      d,
      {
        repo: "acme/app",
        commitSha: "abc1234def",
        userId: "devon",
        files: [
          { path: "src/export.ts", diff: "x".repeat(10_000) },
          { path: ".env.local", diff: "SECRET=1" },
          { path: "package-lock.json", diff: "{}" },
        ],
      },
      4000,
    );

    expect(res.nodesTouched).toEqual(["usage-export-api"]);
    expect(store.getNode("usage-export-api")).toMatchObject({ sourceKind: "code", sourceRef: "acme/app@abc1234def", sellable: true });
    const sent = d.extractor.calls[0] as { files: { path: string; diff: string }[] };
    expect(sent.files.map((f) => f.path)).toEqual(["src/export.ts"]);
    expect(sent.files[0].diff).toHaveLength(4000);

    const source = store.getSource(res.sourceId!)!;
    expect(source).toMatchObject({ kind: "code", title: "acme/app abc1234: src/export.ts", authorId: "devon", hasImage: false });
    expect(source.text).not.toContain("SECRET");
  });

  const card = { label: "One click checkout", summary: "Saved cards pay in one click.", status: "shipped" as const, paths: ["src/checkout.ts"] };

  it("passes the author's cards to the model and keeps them in the stored commit", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, { nodes: [extracted({ label: "One click checkout" })], edges: [] });
    const res = await ingestCode(d, { repo: "acme/app", commitSha: "c0ffee1", files: [{ path: "src/checkout.ts", diff: "+pay()" }], cards: [card] }, 4000);
    expect((d.extractor.calls[0] as { cards: unknown[] }).cards).toEqual([card]);
    expect(store.getSource(res.sourceId!)!.text).toContain("One click checkout [shipped]: Saved cards pay in one click.");
  });

  it("accepts cards without files, and stores the cards as features when the model is unavailable", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    d.extractor.fromCode = async () => {
      throw new HttpError(503, "model down");
    };
    const res = await ingestCode(d, { repo: "acme/app", commitSha: "c0ffee2", files: [], cards: [card, { ...card, label: "Voice beta", status: "in_progress" }] }, 4000);
    expect(res.nodesTouched).toEqual(["one-click-checkout", "voice-beta"]);
    expect(store.getNode("one-click-checkout")).toMatchObject({ type: "feature", status: "done", sellable: true });
    expect(store.getNode("voice-beta")).toMatchObject({ status: "on_track", sellable: false });
    expect(store.getSource(res.sourceId!)!.title).toBe("acme/app c0ffee2: One click checkout, Voice beta");
  });

  it("falls back to the cards when the model finds nothing in the change", async () => {
    const store = memoryStore({ seed: true });
    const res = await ingestCode(deps(store), { repo: "r", commitSha: "c3", files: [], cards: [card] }, 4000);
    expect(res.nodesTouched).toEqual(["one-click-checkout"]);
  });

  it("matches the git author to a person by name or email when no userId is sent", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store, { nodes: [extracted({ label: "Usage export API" })], edges: [] });
    const byName = await ingestCode(d, { repo: "r", commitSha: "a1", files: [{ path: "a.ts", diff: "+" }], author: { name: "Devon Park" } }, 4000);
    expect(store.getSource(byName.sourceId!)!.authorId).toBe("devon");
    const byEmail = await ingestCode(d, { repo: "r", commitSha: "a2", files: [{ path: "a.ts", diff: "+" }], author: { name: "D", email: "mina@lab.org" } }, 4000);
    expect(store.getSource(byEmail.sourceId!)!.authorId).toBe("mina");
    const nobody = await ingestCode(d, { repo: "r", commitSha: "a3", files: [{ path: "a.ts", diff: "+" }], author: { name: "Stranger" } }, 4000);
    expect(store.getSource(nobody.sourceId!)!.authorId).toBeNull();
  });

  it("drops cards about excluded paths", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    const res = await ingestCode(d, { repo: "r", commitSha: "s", files: [], cards: [{ ...card, paths: [".env"] }] }, 4000);
    expect(res).toEqual({ nodesTouched: [], sourceId: null });
  });

  it("does nothing when every file is excluded", async () => {
    const store = memoryStore({ seed: true });
    const d = deps(store);
    const before = store.listSources().length;
    const res = await ingestCode(d, { repo: "r", commitSha: "s", files: [{ path: "certs/server.pem", diff: "" }] }, 4000);
    expect(res).toEqual({ nodesTouched: [], sourceId: null });
    expect(d.extractor.calls).toHaveLength(0);
    expect(store.listSources()).toHaveLength(before);
  });
});

describe("isAlwaysExcluded", () => {
  it.each([".env", "apps/web/.env.production", "keys/id.key", "node_modules/x/index.js", "yarn.lock"])("%s", (p) =>
    expect(isAlwaysExcluded(p)).toBe(true),
  );
  it.each(["src/env.ts", "docs/keyboard.md", "src/lockfile.ts"])("allows %s", (p) => expect(isAlwaysExcluded(p)).toBe(false));
});

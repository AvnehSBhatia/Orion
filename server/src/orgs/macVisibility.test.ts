import { describe, expect, it } from "vitest";
import { quickContext } from "@/chat/answer";
import { applyUpdate } from "@/ingest/pipeline";
import { buildTaskContext } from "@/mcp/taskContext";
import { buildContext, findSources } from "@/retrieval/context";
import { contextFor } from "@/retrieval/contextResponse";
import { feedFor } from "@/retrieval/feed";
import { deps, extracted, memoryStore } from "@/test/helpers";
import { canSeeText, isHidden, maskMacSources, type Viewer } from "./visibility";

const SECRET = "zebracorn pricing memo from jane@initech.com";

async function setup() {
  const store = memoryStore({ seed: true });
  const d = deps(store, { nodes: [extracted({ label: "Zebracorn deal", type: "deal", domain: "sales", status: "at_risk" })], edges: [] });
  const update = await d.extractor.fromCapture({ url: "u", title: "t", text: "" }, []);
  const mac = await applyUpdate(d, update, { kind: "mac", ref: "mac://Mail", title: "Re: zebracorn pricing", text: `Mail: Re: zebracorn pricing\n${SECRET}`, image: null }, "priya");
  const ext = await applyUpdate(d, update, { kind: "extension", ref: "https://app.hubspot.com/zebracorn", title: "Zebracorn page", text: `zebracorn page ${SECRET}`, image: null }, "priya");
  return { store, d, macId: idOf(mac), extId: idOf(ext) };
}

// applyUpdate reports the stored source id somewhere in its result; find the newest of each kind otherwise.
function idOf(r: unknown): string {
  const id = (r as { sourceId?: string; source?: { id: string } }).sourceId ?? (r as { source?: { id: string } }).source?.id;
  if (!id) throw new Error("no source id in " + JSON.stringify(r));
  return id;
}

const member: Viewer = { userId: "sam", admin: false };
const author: Viewer = { userId: "priya", admin: false };
const admin: Viewer = { userId: "boss", admin: true };

describe("Mac text visibility", () => {
  it("canSeeText: author and admins read Mac text, auth-off sees all, extension is org-wide", () => {
    const mac = { kind: "mac", authorId: "priya" };
    expect(canSeeText(member, mac)).toBe(false);
    expect(canSeeText(author, mac)).toBe(true);
    expect(canSeeText(admin, mac)).toBe(true);
    expect(canSeeText(null, mac)).toBe(true);
    expect(canSeeText(member, { kind: "extension", authorId: "priya" })).toBe(true);
  });

  it("direct reads: refused for members, allowed for author and admin, extension unchanged", async () => {
    const { store, macId, extId } = await setup();
    expect(isHidden(store, member, macId)).toBe(true);
    expect(isHidden(store, author, macId)).toBe(false);
    expect(isHidden(store, admin, macId)).toBe(false);
    expect(isHidden(store, null, macId)).toBe(false);
    expect(isHidden(store, member, extId)).toBe(false);
  });

  it("activity listing keeps only metadata for others' Mac sources", async () => {
    const { store, macId, extId } = await setup();
    const all = store.listSources().map((s) => store.toPublicSource(s));
    const masked = maskMacSources(member, store, all);
    const m = masked.find((s) => s.id === macId)!;
    expect(m.title).toBe("Mac activity: Mail");
    expect(m.excerpt).toBe("");
    expect(JSON.stringify(masked.filter((s) => s.kind === "mac"))).not.toContain("pricing");
    expect(masked.find((s) => s.id === extId)!.excerpt).toContain("zebracorn");
    expect(maskMacSources(author, store, all).find((s) => s.id === macId)!.title).toBe("Re: zebracorn pricing");
  });

  it("retrieval, feed, context and task context exclude others' Mac chunks for members only", async () => {
    const { store, d, macId, extId } = await setup();
    const q = "zebracorn pricing memo";

    const found = await findSources(store, d.embedder, { userId: "sam", q, k: 10, viewer: member });
    expect(found.map((s) => s.id)).not.toContain(macId);
    expect(found.map((s) => s.id)).toContain(extId);
    expect((await findSources(store, d.embedder, { userId: "sam", q, k: 10, viewer: admin })).map((s) => s.id)).toContain(macId);
    expect((await findSources(store, d.embedder, { userId: "priya", q, k: 10, viewer: author })).map((s) => s.id)).toContain(macId);
    expect((await findSources(store, d.embedder, { userId: "sam", q, k: 10 })).map((s) => s.id)).toContain(macId);

    const ctx = await buildContext(store, d.embedder, { userId: "sam", q, viewer: member });
    expect(JSON.stringify(ctx)).not.toContain(macId);
    expect(ctx.sources.map((s) => s.id)).toContain(extId);
    expect((await buildContext(store, d.embedder, { userId: "sam", q, viewer: admin })).sources.map((s) => s.id)).toContain(macId);

    const task = await buildTaskContext(store, d.embedder, { userId: "sam", task: q, viewer: member });
    expect(task.sourceIds).not.toContain(macId);
    expect(task.markdown).not.toContain("Re: zebracorn pricing");

    const feed = await feedFor(store, d.embedder, { userId: "sam", sinceHours: 24 * 365, limit: 50, viewer: member });
    expect(feed.map((s) => s.id)).not.toContain(macId);
    expect((await feedFor(store, d.embedder, { userId: "sam", sinceHours: 24 * 365, limit: 50 })).map((s) => s.id)).toContain(macId);

    const resp = await contextFor(store, d.embedder, { userId: "sam", q, k: 10 }, {}, member);
    expect(resp.sources.map((s) => s.id)).not.toContain(macId);

    const quick = quickContext(store, q, member);
    expect(quick.sources.map((s) => s.id)).not.toContain(macId);
    expect(quickContext(store, q).sources.map((s) => s.id)).toContain(macId);
  });
});

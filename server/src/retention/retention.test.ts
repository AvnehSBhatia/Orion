import { afterEach, describe, expect, it, vi } from "vitest";
import type { Store } from "@/db/store";
import { extractionRetryPass, retentionPass, type JobDeps } from "@/jobs/scheduler";
import { saveOrgSettings } from "@/orgs/settings";
import { extracted, memoryStore } from "@/test/helpers";
import { ensureExtractionColumns } from "@/ingest/extraction";
import { capScreenshots, reclaimSpace, runRetention } from ".";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function addSource(store: Store, id: string, ageDays: number, imageBytes = 0) {
  const now = daysAgo(ageDays);
  const { changes } = store.upsertGraph({ nodes: [extracted({ label: `Item ${id}` })], edges: [] }, { sourceKind: "extension", sourceRef: `https://a.com/${id}`, now });
  store.saveSource(
    { id, kind: "extension", ref: `https://a.com/${id}`, title: id, text: `text of ${id}`, image: imageBytes ? Buffer.alloc(imageBytes, 1) : null, authorId: null, createdAt: now },
    changes,
  );
}

afterEach(() => {
  delete process.env.MAX_SCREENSHOT_GB_PER_ORG;
  vi.restoreAllMocks();
});

describe("retention", () => {
  it("deletes old documents but keeps their graph nodes, and drops their source_changes", () => {
    const store = memoryStore();
    saveOrgSettings(store, { retentionDays: 30, screenshotRetentionDays: 0 });
    addSource(store, "old", 40);
    addSource(store, "new", 5);
    store.saveDigest({ id: "dg-1", title: "d", text: "summary of old", members: ["old"], membersKey: "old", clusterId: null, fidelity: 1, newestAt: daysAgo(40), createdAt: daysAgo(1), embedding: null, embedModel: null });

    const r = runRetention(store, NOW);

    expect(r).toMatchObject({ documentsDeleted: 1, digestsDeleted: 1 });
    expect(store.getSource("old")).toBeNull();
    expect(store.getSource("new")).not.toBeNull();
    expect(store.getNode("item-old")).not.toBeNull();
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM source_changes WHERE source_id = 'old'").get()).toEqual({ n: 0 });
    expect(store.listDigests()).toHaveLength(0);
  });

  it("removes old screenshots but keeps the text", () => {
    const store = memoryStore();
    saveOrgSettings(store, { retentionDays: 90, screenshotRetentionDays: 14 });
    addSource(store, "a", 20, 100);
    addSource(store, "b", 2, 100);
    expect(runRetention(store, NOW)).toMatchObject({ documentsDeleted: 0, screenshotsExpired: 1 });
    expect(store.getSource("a")).toMatchObject({ hasImage: false, imageStatus: "none", text: "text of a" });
    expect(store.getSource("b")!.hasImage).toBe(true);
  });

  it("keeps everything forever at 0 days", () => {
    const store = memoryStore();
    saveOrgSettings(store, { retentionDays: 0, screenshotRetentionDays: 0 });
    addSource(store, "ancient", 3000, 50);
    expect(runRetention(store, NOW)).toMatchObject({ documentsDeleted: 0, screenshotsExpired: 0, vacuum: "none" });
    expect(store.getSource("ancient")!.hasImage).toBe(true);
  });

  it("caps screenshot storage per org, evicting the oldest first", () => {
    const store = memoryStore();
    addSource(store, "s1", 3, 400);
    addSource(store, "s2", 2, 400);
    addSource(store, "s3", 1, 400);
    expect(capScreenshots(store, 900)).toBe(1);
    expect(store.getSource("s1")!.hasImage).toBe(false);
    expect(store.getSource("s2")!.hasImage).toBe(true);
    expect(capScreenshots(store, 900)).toBe(0);
    expect(capScreenshots(store, 0)).toBe(0); // 0: no cap
  });

  it("reads the cap from MAX_SCREENSHOT_GB_PER_ORG", () => {
    const store = memoryStore();
    saveOrgSettings(store, { screenshotRetentionDays: 0 });
    addSource(store, "s1", 2, 600);
    addSource(store, "s2", 1, 600);
    process.env.MAX_SCREENSHOT_GB_PER_ORG = String(1000 / 1024 ** 3);
    expect(runRetention(store, NOW).screenshotsEvicted).toBe(1);
  });

  it("converts to incremental vacuum once enough space is free, then vacuums incrementally", () => {
    const store = memoryStore();
    saveOrgSettings(store, { retentionDays: 1, screenshotRetentionDays: 0 });
    for (let i = 0; i < 40; i++) addSource(store, `x${i}`, 10, 8000);
    expect(runRetention(store, NOW)).toMatchObject({ documentsDeleted: 40, vacuum: "full" });
    expect(store.db.pragma("auto_vacuum", { simple: true })).toBe(2);
    for (let i = 0; i < 40; i++) addSource(store, `y${i}`, 10, 8000);
    expect(runRetention(store, NOW).vacuum).toBe("incremental");
    expect(reclaimSpace(store)).toBe("none");
  });
});

describe("background passes", () => {
  it("never let one org's failure stop the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const good = memoryStore();
    saveOrgSettings(good, { retentionDays: 30 });
    addSource(good, "old", 40);
    const deps: JobDeps = {
      orgIds: () => ["broken", "good"],
      store: (id) => {
        if (id === "broken") throw new Error("disk on fire");
        return good;
      },
      maintain: () => {},
    };
    await expect(retentionPass(deps, NOW)).resolves.toBeUndefined();
    expect(good.getSource("old")).toBeNull();
    const logged = (console.error as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => JSON.parse(c[0]));
    expect(logged[0]).toMatchObject({ level: "error", msg: "background job failed", job: "retention", orgId: "broken", err: { message: "disk on fire" } });
  });

  it("schedules maintenance only for orgs with extractions due", async () => {
    const due = memoryStore();
    const idle = memoryStore();
    addSource(due, "p", 1);
    ensureExtractionColumns(due);
    ensureExtractionColumns(idle);
    due.db.prepare("UPDATE sources SET extraction = 'pending', extraction_next_at = ? WHERE id = 'p'").run(daysAgo(0.01));
    const maintained: Store[] = [];
    await extractionRetryPass({ orgIds: () => ["due", "idle"], store: (id) => (id === "due" ? due : idle), maintain: (s) => maintained.push(s) }, NOW);
    expect(maintained).toEqual([due]);
  });
});

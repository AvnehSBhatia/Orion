import { describe, expect, it } from "vitest";
import type { Store } from "@/db/store";
import { clearOldSnippets, finalizeDraft, exportDraft, ownerExport, ownerPilot, reviewEntry, roundedMinutes, saveBaseline, todayDraft, type DraftDeps } from "./drafts";
import { assertOwner } from "./http";
import { metricsFor } from "./metrics";
import { isVerbatim } from "./narrative";
import { ensureMacTables } from "./schema";
import { submitWorkBlocks } from "./workBlocks";
import { saveOrgSettings } from "@/orgs/settings";
import { deps as ingestDeps, memoryStore } from "@/test/helpers";
import { fakeLlm, jsonTurn } from "@/test/llm";
import type { Principal } from "@/auth/db";

const USER = "u1";

function setup(): Store {
  const store = memoryStore();
  ensureMacTables(store);
  const now = new Date().toISOString();
  store.db.prepare("INSERT INTO mac_clients (id, name, seq, created_at, updated_at) VALUES ('c1', 'Initech', 1, ?, ?), ('c2', 'Acme', 2, ?, ?)").run(now, now, now, now);
  return store;
}

const block = (local_id: string, started_at: string, ended_at: string, extra: Record<string, unknown> = {}) => ({
  local_id,
  started_at,
  ended_at,
  app_name: "Safari",
  window_title: "Pricing page",
  domain_path: "initech.com/pricing",
  matched_client_id: "c1",
  match_method: "domain",
  match_confidence: 0.9,
  snippet: "Quarterly pricing review for Initech",
  redaction_count: 0,
  ...extra,
});

const send = (store: Store, blocks: unknown[], user = USER) => submitWorkBlocks(ingestDeps(store), user, blocks);
const mk = (store: Store, llm: DraftDeps["llm"] | undefined = fakeLlm([{ content: "nope" }], { repeatLast: true }).llm): DraftDeps => ({ store, llm: llm ?? null, model: "m" });
const NOW = new Date("2026-10-14T20:00:00Z"); // 13:00 in Los Angeles

describe("today's draft", () => {
  it("puts evening work in America/Los_Angeles on the local day and morning-after UTC work on the next", async () => {
    const store = setup();
    // 2026-10-14 19:00 PDT = 2026-10-15T02:00Z; local day is the 14th. 2026-10-15T08:00Z is 01:00 PDT on the 15th.
    send(store, [block("a", "2026-10-15T02:00:00Z", "2026-10-15T02:30:00Z"), block("b", "2026-10-15T08:00:00Z", "2026-10-15T08:30:00Z")]);
    const la = await todayDraft(mk(store), USER, "America/Los_Angeles", new Date("2026-10-15T03:00:00Z"));
    expect(la.day).toBe("2026-10-14");
    expect(la.entries).toHaveLength(1);
    expect(la.entries[0].evidence.map((e) => e.work_block_id)).toEqual(["a"]);
    const utc = await todayDraft(mk(store), USER, "Not/AZone", new Date("2026-10-15T09:00:00Z"));
    expect(utc.day).toBe("2026-10-15");
    expect(utc.entries[0].evidence.map((e) => e.work_block_id)).toEqual(["b"]);
  });

  it("makes one entry per client plus one unmatched entry, and only for the caller", async () => {
    const store = setup();
    send(store, [
      block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z"),
      block("b", "2026-10-14T18:00:00Z", "2026-10-14T18:10:00Z"),
      block("c", "2026-10-14T18:30:00Z", "2026-10-14T18:40:00Z", { matched_client_id: "c2" }),
      block("d", "2026-10-14T19:00:00Z", "2026-10-14T19:05:00Z", { matched_client_id: null, match_method: "none", match_confidence: 0 }),
    ]);
    send(store, [block("x", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z")], "other");
    const d = await todayDraft(mk(store), USER, "America/Los_Angeles", NOW);
    expect(d.entries.map((e) => [e.client_id, e.unmatched, e.minutes])).toEqual([
      ["c1", false, 24],
      ["c2", false, 12],
      [null, true, 6],
    ]);
    const other = await todayDraft(mk(store), "other", "America/Los_Angeles", NOW);
    expect(other.entries).toHaveLength(1);
    expect(other.draft_id).not.toBe(d.draft_id);
  });

  it("rounds covered time up to 6 or 15 minutes and counts overlap once", async () => {
    const mins = [
      { started_at: "2026-10-14T17:00:00Z", ended_at: "2026-10-14T17:07:00Z" },
      { started_at: "2026-10-14T17:05:00Z", ended_at: "2026-10-14T17:08:00Z" },
    ];
    expect(roundedMinutes(mins, 6)).toBe(12); // 8 min covered
    expect(roundedMinutes(mins, 15)).toBe(15);
    expect(roundedMinutes([{ started_at: "2026-10-14T17:00:00Z", ended_at: "2026-10-14T17:06:00Z" }], 6)).toBe(6);
    expect(roundedMinutes([], 6)).toBe(0);
    const store = setup();
    saveOrgSettings(store, { billingIncrementMin: 15 });
    send(store, [block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:07:00Z")]);
    expect((await todayDraft(mk(store), USER, "America/Los_Angeles", NOW)).entries[0].minutes).toBe(15);
  });

  it("uses the model's line with verbatim quotes, sending zero-retention requests", async () => {
    const store = setup();
    send(store, [block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z")]);
    const { llm, requests } = fakeLlm([jsonTurn({ narrative: "Reviewed Initech pricing.", quotes: [{ id: "a", quote: "pricing review" }] })]);
    const d = await todayDraft(mk(store, llm), USER, "America/Los_Angeles", NOW);
    expect(d.entries[0].narrative).toBe("Reviewed Initech pricing.");
    expect(d.entries[0].evidence[0].quote).toBe("pricing review");
    expect(requests[0].zdr).toBe(true);
    // Unchanged evidence: no second call.
    await todayDraft(mk(store, llm), USER, "America/Los_Angeles", NOW);
    expect(requests).toHaveLength(1);
  });

  it("falls back to the stub when a quote or quoted phrase is not in the evidence, or the model fails", async () => {
    for (const turn of [
      jsonTurn({ narrative: "Reviewed pricing.", quotes: [{ id: "a", quote: "budget cut of 40%" }] }),
      jsonTurn({ narrative: 'Discussed "layoffs" with Initech.', quotes: [] }),
      { content: "not json" },
    ]) {
      const store = setup();
      send(store, [block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z"), block("b", "2026-10-14T17:20:00Z", "2026-10-14T17:30:00Z")]);
      const d = await todayDraft(mk(store, fakeLlm([turn]).llm), USER, "America/Los_Angeles", NOW);
      expect(d.entries[0].narrative).toBe("Work on Initech: 2 items");
      expect(d.entries[0].evidence.every((e) => e.quote === null)).toBe(true);
    }
    const store = setup();
    send(store, [block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z")]);
    expect((await todayDraft(mk(store, null), USER, "America/Los_Angeles", NOW)).entries[0].narrative).toBe("Work on Initech: 1 item");
    expect(isVerbatim("a  b", "x a\nb y")).toBe(true);
  });
});

describe("review, finalize, export", () => {
  it("accepts, edits (a client change makes a personal alias rule) and rejects; only the owner may review", async () => {
    const store = setup();
    send(store, [block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z", { matched_client_id: null, match_method: "none", match_confidence: 0, domain_path: "acme.com/x" })]);
    const d = await todayDraft(mk(store), USER, "America/Los_Angeles", NOW);
    const id = d.entries[0].id;
    expect(() => reviewEntry(store, "other", id, { action: "accept" })).toThrow(/unknown entry/);
    expect(reviewEntry(store, USER, id, { action: "accept" }).status).toBe("accepted");
    const edited = reviewEntry(store, USER, id, { action: "edit", client_id: "c2", minutes: 30, narrative: "Calls" });
    expect(edited).toMatchObject({ status: "edited", client_id: "c2", unmatched: false, minutes: 30, narrative: "Calls" });
    const rules = store.db.prepare("SELECT pattern, client_id, user_id FROM mac_alias_rules").all();
    expect(rules).toEqual([{ pattern: "acme.com", client_id: "c2", user_id: USER }]);
    expect(reviewEntry(store, USER, id, { action: "reject" }).status).toBe("rejected");
    expect(() => reviewEntry(store, USER, id, { action: "edit", client_id: "nope" })).toThrow(/unknown client/);
  });

  it("409s the export before finalize, then exports accepted and edited entries only", async () => {
    const store = setup();
    send(store, [
      block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z"),
      block("b", "2026-10-14T18:00:00Z", "2026-10-14T18:10:00Z", { matched_client_id: "c2" }),
      block("c", "2026-10-14T19:00:00Z", "2026-10-14T19:10:00Z", { matched_client_id: null, match_method: "none", match_confidence: 0 }),
    ]);
    const d = await todayDraft(mk(store), USER, "America/Los_Angeles", NOW);
    expect(() => exportDraft(store, USER, d.draft_id)).toThrow(expect.objectContaining({ status: 409 }));
    reviewEntry(store, USER, d.entries[0].id, { action: "accept" });
    reviewEntry(store, USER, d.entries[1].id, { action: "edit", narrative: "Said, \"hi\"" });
    reviewEntry(store, USER, d.entries[2].id, { action: "reject" });
    expect(() => finalizeDraft(store, "other", d.draft_id)).toThrow(/unknown draft/);
    expect(finalizeDraft(store, USER, d.draft_id)).toEqual({ exported: 2 });
    const csv = exportDraft(store, USER, d.draft_id);
    expect(csv.split("\n")[0]).toBe("date,client,minutes,narrative,status");
    expect(csv).toContain("2026-10-14,Initech,12,Work on Initech: 1 item,accepted");
    expect(csv).toContain('2026-10-14,Acme,12,"Said, ""hi""",edited');
    expect(csv).not.toContain("Quarterly pricing");
    expect(() => reviewEntry(store, USER, d.entries[0].id, { action: "reject" })).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe("baseline and metrics", () => {
  it("replaces a baseline day, and scores recovered minutes, rates and the 3-of-5 window", async () => {
    const store = setup();
    send(store, [block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:30:00Z"), block("b", "2026-10-14T18:00:00Z", "2026-10-14T18:30:00Z", { matched_client_id: "c2" })]);
    const d = await todayDraft(mk(store), USER, "America/Los_Angeles", NOW);
    saveBaseline(store, USER, { day: "2026-10-14", entries: [{ client_id: "c1", minutes: 99 }] });
    expect(saveBaseline(store, USER, { day: "2026-10-14", entries: [{ client_id: "c1", minutes: 12 }] }).entries).toHaveLength(1);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM mac_baseline").get()).toEqual({ n: 1 });
    reviewEntry(store, USER, d.entries[0].id, { action: "accept" }); // Initech 30
    reviewEntry(store, USER, d.entries[1].id, { action: "edit", minutes: 18 }); // Acme 18
    const m = metricsFor(store, USER, "2026-10-13", "2026-10-14");
    expect(m.days).toEqual([
      { day: "2026-10-13", recovered_minutes: null, acceptance_rate: null, edit_rate: null, active: false },
      { day: "2026-10-14", recovered_minutes: 18 + 18, acceptance_rate: 0.5, edit_rate: 0.5, active: true },
    ]);
    expect(m.active_in_window).toBe(false);
    // Three active days of the last five.
    for (const day of ["2026-10-12", "2026-10-13"]) {
      store.db.prepare("INSERT INTO mac_drafts (id, user_id, day, created_at) VALUES (?, ?, ?, 'x')").run(`d${day}`, USER, day);
      store.db
        .prepare("INSERT INTO mac_entries (id, draft_id, user_id, unmatched, started_at, ended_at, minutes, narrative, status, created_at) VALUES (?, ?, ?, 1, 'x', 'x', 6, 'n', 'rejected', 'x')")
        .run(`e${day}`, `d${day}`, USER);
    }
    expect(metricsFor(store, USER, "2026-10-14", "2026-10-14").active_in_window).toBe(true);
    // An empty baseline still counts as submitted: nothing recovered is 0 minutes of overlap.
    saveBaseline(store, USER, { day: "2026-10-12", entries: [] });
    expect(metricsFor(store, USER, "2026-10-12", "2026-10-12").days[0].recovered_minutes).toBe(0);
  });
});

describe("owner views", () => {
  it("exports and totals everyone's reviewed entries, and refuses non-admins and device tokens", async () => {
    const store = setup();
    send(store, [block("a", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z")]);
    send(store, [block("x", "2026-10-14T17:00:00Z", "2026-10-14T17:10:00Z", { matched_client_id: "c2" })], "other");
    const d1 = await todayDraft(mk(store), USER, "America/Los_Angeles", NOW);
    const d2 = await todayDraft(mk(store), "other", "America/Los_Angeles", NOW);
    reviewEntry(store, USER, d1.entries[0].id, { action: "accept" });
    reviewEntry(store, "other", d2.entries[0].id, { action: "reject" });
    const csv = ownerExport(store, "2026-10-14", "2026-10-14");
    expect(csv.split("\n")[0]).toBe("date,person,client,minutes,narrative,status");
    expect(csv).toContain("Initech");
    expect(csv).not.toContain("Acme");
    expect(csv).not.toContain("Pricing page");
    const pilot = ownerPilot(store, "2026-10-14", "2026-10-14").people;
    expect(pilot.find((p) => p.user_id === USER)).toMatchObject({ accepted: 1, edited: 0, rejected: 0, active_days: 1 });
    expect(pilot.find((p) => p.user_id === "other")).toMatchObject({ accepted: 0, rejected: 1, active_days: 1 });
    const principal = (o: Partial<Principal>) => ({ admin: false, kind: "session", ...o }) as Principal;
    expect(() => assertOwner(principal({}))).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertOwner(principal({ admin: true, kind: "device" }))).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertOwner(principal({ admin: true }))).not.toThrow();
  });
});

describe("snippet retention", () => {
  it("clears snippets and quotes past snippetRetentionDays and keeps everything else", async () => {
    const store = setup();
    send(store, [block("old", "2026-09-01T17:00:00Z", "2026-09-01T17:10:00Z"), block("new", "2026-10-13T17:00:00Z", "2026-10-13T17:10:00Z")]);
    store.db.prepare("INSERT INTO mac_drafts (id, user_id, day, created_at) VALUES ('d', ?, '2026-09-01', 'x')").run(USER);
    store.db.prepare("INSERT INTO mac_entries (id, draft_id, user_id, unmatched, started_at, ended_at, minutes, narrative, status, created_at) VALUES ('e', 'd', ?, 0, 'x', 'x', 6, 'kept', 'proposed', 'x')").run(USER);
    store.db.prepare("INSERT INTO mac_evidence (entry_id, block_id, quote) SELECT 'e', id, 'q' FROM mac_work_blocks WHERE local_id = 'old'").run();
    expect(clearOldSnippets(store, 14, NOW.getTime())).toBe(1);
    const rows = store.db.prepare("SELECT local_id, snippet FROM mac_work_blocks ORDER BY local_id").all() as { local_id: string; snippet: string | null }[];
    expect(rows.find((r) => r.local_id === "old")!.snippet).toBeNull();
    expect(rows.find((r) => r.local_id === "new")!.snippet).not.toBeNull();
    expect(store.db.prepare("SELECT quote FROM mac_evidence").get()).toEqual({ quote: null });
    expect(store.db.prepare("SELECT narrative FROM mac_entries").get()).toEqual({ narrative: "kept" });
    expect(clearOldSnippets(store, 0, NOW.getTime())).toBe(0);
  });
});

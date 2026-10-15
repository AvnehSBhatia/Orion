// Daily time drafts: a person's work blocks for a local day become one entry per client (plus one unmatched entry),
// reviewed by that person, finalized and exported. Also baselines, the owner export and pilot totals, and the
// snippet retention job.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "@/db/store";
import type { LlmClient } from "@/llm/openrouter";
import { getOrgSettings } from "@/orgs/settings";
import { withUsage } from "@/usage";
import { csvLines } from "./csv";
import { v1Error } from "./http";
import { writeNarrative, stubNarrative } from "./narrative";
import { ensureMacTables, nextSeq } from "./schema";
import { DAY_RE, localDay, localDayRange, validZone } from "./time";

export type Evidence = { work_block_id: string; quote: string | null };
export type Entry = {
  id: string;
  client_id: string | null;
  started_at: string;
  ended_at: string;
  minutes: number;
  narrative: string;
  evidence: Evidence[];
  unmatched: boolean;
  status: "proposed" | "accepted" | "edited" | "rejected";
};
export type Draft = { draft_id: string; day: string; entries: Entry[] };
export type DraftDeps = { store: Store; llm: LlmClient | null; model: string };

type EntryRow = {
  id: string;
  draft_id: string;
  user_id: string;
  client_id: string | null;
  unmatched: number;
  started_at: string;
  ended_at: string;
  minutes: number;
  narrative: string;
  narrative_key: string | null;
  status: Entry["status"];
};
type DraftRow = { id: string; user_id: string; day: string; finalized_at: string | null; csv: string | null };
type BlockRow = {
  id: string;
  local_id: string;
  started_at: string;
  ended_at: string;
  window_title: string;
  app_name: string;
  domain_path: string | null;
  matched_client_id: string | null;
  snippet: string | null;
};

/** Covered time rounded up to the billing increment: overlapping blocks count once, any covered time costs at least one increment. */
export function roundedMinutes(blocks: { started_at: string; ended_at: string }[], increment: number): number {
  const spans = blocks
    .map((b) => [Date.parse(b.started_at), Date.parse(b.ended_at)] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let curS = 0;
  let curE = 0;
  for (const [s, e] of spans) {
    if (curE === 0 || s > curE) {
      covered += curE - curS;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  covered += curE - curS;
  if (covered <= 0) return 0;
  return Math.ceil(covered / 60_000 / increment - 1e-9) * increment;
}

const billingIncrement = (store: Store): number => (getOrgSettings(store).billingIncrementMin === 15 ? 15 : 6);

function clientName(store: Store, id: string | null): string {
  if (!id) return "Unmatched";
  return (store.db.prepare("SELECT name FROM mac_clients WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "Unknown client";
}

function toEntry(store: Store, r: EntryRow): Entry {
  const ev = store.db
    .prepare("SELECT b.local_id AS id, e.quote AS quote FROM mac_evidence e JOIN mac_work_blocks b ON b.id = e.block_id WHERE e.entry_id = ? ORDER BY b.started_at, b.local_id")
    .all(r.id) as { id: string; quote: string | null }[];
  return {
    id: r.id,
    client_id: r.client_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    minutes: r.minutes,
    narrative: r.narrative,
    evidence: ev.map((e) => ({ work_block_id: e.id, quote: e.quote })),
    unmatched: r.unmatched === 1,
    status: r.status,
  };
}

function entryBlocks(store: Store, entryId: string): BlockRow[] {
  return store.db
    .prepare(
      `SELECT b.id, b.local_id, b.started_at, b.ended_at, b.window_title, b.app_name, b.domain_path, b.matched_client_id, b.snippet
       FROM mac_evidence e JOIN mac_work_blocks b ON b.id = e.block_id WHERE e.entry_id = ? ORDER BY b.started_at, b.local_id`,
    )
    .all(entryId) as BlockRow[];
}

const evidenceKey = (blocks: BlockRow[]) => createHash("sha256").update(blocks.map((b) => b.id).join("|")).digest("hex").slice(0, 24);

/** Puts blocks that are in no entry yet into the day's entries and recomputes the entries they touched. */
function assignBlocks(store: Store, draft: DraftRow, userId: string, tz: string, now: string): void {
  const range = localDayRange(draft.day, tz);
  const fresh = store.db
    .prepare(
      `SELECT b.id, b.matched_client_id AS cid FROM mac_work_blocks b
       WHERE b.user_id = ? AND b.started_at >= ? AND b.started_at < ? AND NOT EXISTS (SELECT 1 FROM mac_evidence e WHERE e.block_id = b.id)
       ORDER BY b.started_at`,
    )
    .all(userId, range.from, range.to) as { id: string; cid: string | null }[];
  if (!fresh.length) return;
  const increment = billingIncrement(store);
  store.transaction(() => {
    const touched = new Set<string>();
    for (const b of fresh) {
      const cid = b.cid && store.db.prepare("SELECT 1 FROM mac_clients WHERE id = ?").get(b.cid) ? b.cid : null;
      let entry = (
        cid
          ? store.db.prepare("SELECT * FROM mac_entries WHERE draft_id = ? AND client_id = ? AND unmatched = 0").get(draft.id, cid)
          : store.db.prepare("SELECT * FROM mac_entries WHERE draft_id = ? AND unmatched = 1").get(draft.id)
      ) as EntryRow | undefined;
      if (!entry) {
        const id = randomUUID();
        store.db
          .prepare("INSERT INTO mac_entries (id, draft_id, user_id, client_id, unmatched, started_at, ended_at, minutes, narrative, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'proposed', ?)")
          .run(id, draft.id, userId, cid, cid ? 0 : 1, now, now, stubNarrative(clientName(store, cid), 0), now);
        entry = store.db.prepare("SELECT * FROM mac_entries WHERE id = ?").get(id) as EntryRow;
      }
      store.db.prepare("INSERT INTO mac_evidence (entry_id, block_id, quote) VALUES (?, ?, NULL)").run(entry.id, b.id);
      touched.add(entry.id);
    }
    for (const id of touched) {
      const e = store.db.prepare("SELECT * FROM mac_entries WHERE id = ?").get(id) as EntryRow;
      const blocks = entryBlocks(store, id);
      // A person's own edit or rejection stands; accepted entries with new evidence need another look.
      if (e.status === "edited" || e.status === "rejected") continue;
      store.db
        .prepare("UPDATE mac_entries SET started_at = ?, ended_at = ?, minutes = ?, status = 'proposed', reviewed_at = NULL WHERE id = ?")
        .run(
          blocks.map((b) => b.started_at).sort()[0],
          blocks.map((b) => b.ended_at).sort().at(-1),
          roundedMinutes(blocks, increment),
          id,
        );
    }
  });
}

/** Writes the model's line for entries whose evidence changed since the last one. */
async function writeNarratives(deps: DraftDeps, draft: DraftRow): Promise<void> {
  const { store } = deps;
  const rows = store.db.prepare("SELECT * FROM mac_entries WHERE draft_id = ? AND status IN ('proposed', 'accepted')").all(draft.id) as EntryRow[];
  for (const e of rows) {
    const blocks = entryBlocks(store, e.id);
    const key = evidenceKey(blocks);
    if (e.narrative_key === key) continue;
    const name = clientName(store, e.client_id);
    const out = await withUsage(store, () =>
      writeNarrative(deps.llm, deps.model, name, blocks.map((b) => ({ id: b.local_id, title: `${b.app_name}: ${b.window_title}`, snippet: b.snippet }))),
    );
    store.transaction(() => {
      // Skip if another request moved the evidence meanwhile, or the person edited the entry.
      const cur = store.db.prepare("SELECT narrative_key, status FROM mac_entries WHERE id = ?").get(e.id) as { narrative_key: string | null; status: string } | undefined;
      if (!cur || cur.narrative_key !== e.narrative_key || cur.status === "edited" || cur.status === "rejected") return;
      store.db.prepare("UPDATE mac_entries SET narrative = ?, narrative_key = ? WHERE id = ?").run(out.narrative, key, e.id);
      const setQuote = store.db.prepare("UPDATE mac_evidence SET quote = ? WHERE entry_id = ? AND block_id = ?");
      for (const b of blocks) setQuote.run(out.quotes[b.local_id] ?? null, e.id, b.id);
    });
  }
}

/** GET /v1/drafts/today: the person's draft for the local day in `tz` (UTC when missing or unknown), built or refreshed from their blocks. */
export async function todayDraft(deps: DraftDeps, userId: string, tzParam: string | null | undefined, now = new Date()): Promise<Draft> {
  const { store } = deps;
  ensureMacTables(store);
  const tz = validZone(tzParam);
  const day = localDay(now, tz);
  store.db.prepare("INSERT OR IGNORE INTO mac_drafts (id, user_id, day, created_at) VALUES (?, ?, ?, ?)").run(randomUUID(), userId, day, now.toISOString());
  const draft = store.db.prepare("SELECT * FROM mac_drafts WHERE user_id = ? AND day = ?").get(userId, day) as DraftRow;
  if (!draft.finalized_at) {
    assignBlocks(store, draft, userId, tz, now.toISOString());
    await writeNarratives(deps, draft);
  }
  const entries = store.db.prepare("SELECT * FROM mac_entries WHERE draft_id = ? ORDER BY unmatched, started_at, id").all(draft.id) as EntryRow[];
  return { draft_id: draft.id, day, entries: entries.map((r) => toEntry(store, r)) };
}

export const reviewRequest = z.object({
  action: z.enum(["accept", "edit", "reject"]),
  minutes: z.number().int().min(0).max(1440).optional(),
  client_id: z.string().max(64).nullable().optional(),
  narrative: z.string().trim().min(1).max(500).optional(),
  started_at: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()).optional(),
  ended_at: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()).optional(),
});

/** The strongest pattern in these blocks: their most common domain, else their most common window title. */
function strongestPattern(blocks: BlockRow[]): string | null {
  const count = (vals: string[]) => {
    const m = new Map<string, number>();
    for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };
  const domains = blocks.flatMap((b) => (b.domain_path ? [b.domain_path.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].replace(/^www\./, "").toLowerCase()] : [])).filter(Boolean);
  return count(domains) ?? count(blocks.map((b) => b.window_title.trim()).filter(Boolean));
}

function saveAliasRule(store: Store, userId: string, pattern: string, clientId: string, now: string): void {
  const existing = store.db.prepare("SELECT id FROM mac_alias_rules WHERE user_id = ? AND lower(pattern) = lower(?)").get(userId, pattern) as { id: string } | undefined;
  if (existing) store.db.prepare("UPDATE mac_alias_rules SET client_id = ?, accepted_as = NULL, seq = ?, updated_at = ? WHERE id = ?").run(clientId, nextSeq(store), now, existing.id);
  else
    store.db
      .prepare("INSERT INTO mac_alias_rules (id, pattern, client_id, user_id, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), pattern.slice(0, 500), clientId, userId, nextSeq(store), now, now);
}

/** POST /v1/drafts/entries/{id}/review. Only the entry's owner; reviewing again replaces the earlier decision. */
export function reviewEntry(store: Store, userId: string, entryId: string, body: z.infer<typeof reviewRequest>, now = new Date()): Entry {
  ensureMacTables(store);
  const at = now.toISOString();
  const row = store.db.prepare("SELECT * FROM mac_entries WHERE id = ? AND user_id = ?").get(entryId, userId) as EntryRow | undefined;
  if (!row) throw v1Error(404, "not_found", "unknown entry");
  const draft = store.db.prepare("SELECT * FROM mac_drafts WHERE id = ?").get(row.draft_id) as DraftRow;
  if (draft.finalized_at) throw v1Error(409, "conflict", "this day is already finalized");
  if (body.action !== "edit" && (body.minutes !== undefined || body.client_id !== undefined || body.narrative || body.started_at || body.ended_at))
    throw v1Error(400, "invalid_request", "only action \"edit\" changes an entry");
  if (body.client_id && !store.db.prepare("SELECT 1 FROM mac_clients WHERE id = ?").get(body.client_id)) throw v1Error(404, "not_found", "unknown client");

  let resultId = row.id;
  store.transaction(() => {
    if (body.action === "reject") {
      store.db.prepare("UPDATE mac_entries SET status = 'rejected', reviewed_at = ? WHERE id = ?").run(at, row.id);
      return;
    }
    if (body.action === "accept") {
      store.db.prepare("UPDATE mac_entries SET status = 'accepted', reviewed_at = ? WHERE id = ?").run(at, row.id);
      return;
    }
    const started = body.started_at ?? row.started_at;
    const ended = body.ended_at ?? row.ended_at;
    if (Date.parse(ended) < Date.parse(started)) throw v1Error(400, "invalid_request", "ended_at is before started_at");
    let clientId = row.client_id;
    let unmatched = row.unmatched;
    if (body.client_id !== undefined && body.client_id !== row.client_id) {
      clientId = body.client_id;
      unmatched = clientId ? 0 : 1;
      const pattern = strongestPattern(entryBlocks(store, row.id));
      if (clientId && pattern) saveAliasRule(store, userId, pattern, clientId, at);
    }
    const minutes = body.minutes ?? row.minutes;
    const narrative = body.narrative ?? row.narrative;
    // One entry per client per day: moving into a client that already has one merges into it.
    const other = (
      clientId
        ? store.db.prepare("SELECT * FROM mac_entries WHERE draft_id = ? AND client_id = ? AND unmatched = 0 AND id <> ?").get(row.draft_id, clientId, row.id)
        : store.db.prepare("SELECT * FROM mac_entries WHERE draft_id = ? AND unmatched = 1 AND id <> ?").get(row.draft_id, row.id)
    ) as EntryRow | undefined;
    if (other) {
      store.db.prepare("UPDATE mac_evidence SET entry_id = ? WHERE entry_id = ?").run(other.id, row.id);
      store.db.prepare("DELETE FROM mac_entries WHERE id = ?").run(row.id);
      store.db
        .prepare("UPDATE mac_entries SET status = 'edited', reviewed_at = ?, minutes = ?, started_at = ?, ended_at = ?, narrative = ? WHERE id = ?")
        .run(at, other.minutes + minutes, [other.started_at, started].sort()[0], [other.ended_at, ended].sort().at(-1), other.narrative, other.id);
      resultId = other.id;
      return;
    }
    store.db
      .prepare("UPDATE mac_entries SET status = 'edited', reviewed_at = ?, client_id = ?, unmatched = ?, minutes = ?, narrative = ?, started_at = ?, ended_at = ? WHERE id = ?")
      .run(at, clientId, unmatched, minutes, narrative, started, ended, row.id);
  });
  return toEntry(store, store.db.prepare("SELECT * FROM mac_entries WHERE id = ?").get(resultId) as EntryRow);
}

function ownDraft(store: Store, userId: string, draftId: string): DraftRow {
  ensureMacTables(store);
  const d = store.db.prepare("SELECT * FROM mac_drafts WHERE id = ? AND user_id = ?").get(draftId, userId) as DraftRow | undefined;
  if (!d) throw v1Error(404, "not_found", "unknown draft");
  return d;
}

function exportRows(store: Store, where: string, params: unknown[]): { day: string; user_id: string; client_id: string | null; minutes: number; narrative: string; status: string }[] {
  return store.db
    .prepare(
      `SELECT d.day AS day, e.user_id AS user_id, e.client_id AS client_id, e.minutes AS minutes, e.narrative AS narrative, e.status AS status
       FROM mac_entries e JOIN mac_drafts d ON d.id = e.draft_id WHERE e.status IN ('accepted', 'edited') AND ${where} ORDER BY d.day, e.user_id, e.started_at, e.id`,
    )
    .all(...params) as never;
}

/** POST /v1/drafts/{id}/finalize: freezes the day and keeps its CSV (accepted and edited entries). */
export function finalizeDraft(store: Store, userId: string, draftId: string, now = new Date()): { exported: number } {
  const d = ownDraft(store, userId, draftId);
  const rows = exportRows(store, "e.draft_id = ?", [d.id]);
  const csv = csvLines(
    ["date", "client", "minutes", "narrative", "status"],
    rows.map((r) => [r.day, r.client_id ? clientName(store, r.client_id) : "", r.minutes, r.narrative, r.status]),
  );
  if (!d.finalized_at) store.db.prepare("UPDATE mac_drafts SET finalized_at = ?, csv = ? WHERE id = ?").run(now.toISOString(), csv, d.id);
  return { exported: rows.length };
}

/** GET /v1/drafts/{id}/export: the CSV, 409 before finalize. */
export function exportDraft(store: Store, userId: string, draftId: string): string {
  const d = ownDraft(store, userId, draftId);
  if (!d.finalized_at || d.csv === null) throw v1Error(409, "not_finalized", "finalize the draft before exporting it");
  return d.csv;
}

export const baselineRequest = z.object({
  day: z.string().regex(DAY_RE),
  entries: z.array(z.object({ client_id: z.string().max(64).nullable(), minutes: z.number().int().min(0).max(1440) })).max(200),
});

/** POST /v1/baseline: the person's own timesheet for a day, replacing an earlier one. */
export function saveBaseline(store: Store, userId: string, body: z.infer<typeof baselineRequest>, now = new Date()): z.infer<typeof baselineRequest> {
  ensureMacTables(store);
  if (Number.isNaN(Date.parse(`${body.day}T00:00:00Z`))) throw v1Error(400, "invalid_request", "day is not a date");
  store.transaction(() => {
    store.db.prepare("DELETE FROM mac_baseline WHERE user_id = ? AND day = ?").run(userId, body.day);
    const ins = store.db.prepare("INSERT INTO mac_baseline (user_id, day, client_id, minutes) VALUES (?, ?, ?, ?)");
    for (const e of body.entries) ins.run(userId, body.day, e.client_id, e.minutes);
    store.db
      .prepare("INSERT INTO mac_baseline_days (user_id, day, submitted_at) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET submitted_at = excluded.submitted_at")
      .run(userId, body.day, now.toISOString());
  });
  return { day: body.day, entries: body.entries };
}

/** The days of a ?from&to query: both optional, "YYYY-MM-DD". */
export function dayRange(from: string | null, to: string | null, fallbackDays = 7, now = new Date()): { from: string; to: string } {
  for (const v of [from, to]) if (v && (!DAY_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) throw v1Error(400, "invalid_request", "from and to are days like 2026-10-14");
  const end = to ?? now.toISOString().slice(0, 10);
  const start = from ?? new Date(Date.parse(`${end}T00:00:00Z`) - (fallbackDays - 1) * 86_400_000).toISOString().slice(0, 10);
  if (start > end) throw v1Error(400, "invalid_request", "from is after to");
  return { from: start, to: end };
}

const personName = (store: Store, id: string) => store.getUser(id)?.name ?? id;

/** GET /v1/owner/export.csv: accepted and edited entries for everyone. No snippets or evidence. */
export function ownerExport(store: Store, from: string, to: string): string {
  ensureMacTables(store);
  const rows = exportRows(store, "d.day BETWEEN ? AND ?", [from, to]);
  return csvLines(
    ["date", "person", "client", "minutes", "narrative", "status"],
    rows.map((r) => [r.day, personName(store, r.user_id), r.client_id ? clientName(store, r.client_id) : "", r.minutes, r.narrative, r.status]),
  );
}

export type PilotPerson = { user_id: string; name: string; accepted: number; edited: number; rejected: number; active_days: number };

/** GET /v1/owner/pilot: review counts and active days per person. No snippets or titles. */
export function ownerPilot(store: Store, from: string, to: string): { people: PilotPerson[] } {
  ensureMacTables(store);
  const rows = store.db
    .prepare(
      `SELECT e.user_id AS user_id,
         SUM(e.status = 'accepted') AS accepted, SUM(e.status = 'edited') AS edited, SUM(e.status = 'rejected') AS rejected,
         COUNT(DISTINCT CASE WHEN e.status <> 'proposed' THEN d.day END) AS active_days
       FROM mac_entries e JOIN mac_drafts d ON d.id = e.draft_id WHERE d.day BETWEEN ? AND ? GROUP BY e.user_id`,
    )
    .all(from, to) as { user_id: string; accepted: number; edited: number; rejected: number; active_days: number }[];
  const by = new Map(rows.map((r) => [r.user_id, r]));
  const ids = [...new Set([...store.listUsers().map((u) => u.id), ...by.keys()])];
  return {
    people: ids.map((id) => ({
      user_id: id,
      name: personName(store, id),
      accepted: by.get(id)?.accepted ?? 0,
      edited: by.get(id)?.edited ?? 0,
      rejected: by.get(id)?.rejected ?? 0,
      active_days: by.get(id)?.active_days ?? 0,
    })),
  };
}

/** Hourly retention: snippets and evidence quotes older than `days` (by block start) are cleared. 0 keeps them. */
export function clearOldSnippets(store: Store, days: number, now = Date.now()): number {
  if (!(days > 0)) return 0;
  ensureMacTables(store);
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  let n = 0;
  store.transaction(() => {
    store.db.prepare("UPDATE mac_evidence SET quote = NULL WHERE quote IS NOT NULL AND block_id IN (SELECT id FROM mac_work_blocks WHERE started_at < ?)").run(cutoff);
    n = store.db.prepare("UPDATE mac_work_blocks SET snippet = NULL WHERE snippet IS NOT NULL AND started_at < ?").run(cutoff).changes;
  });
  return n;
}

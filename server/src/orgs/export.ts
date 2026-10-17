// A person's data export (an access request): everything Orion holds about one person in one org, as one JSON file.
import { audit, auditAbout, type AuditEvent } from "@/audit/log";
import type { AuthDb, Principal } from "@/auth/db";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { ensureMacTables } from "@/mac/schema";

export const EXPORT_VERSION = 1;

const ABOUT = [
  "Everything Orion holds about this person in this org, as of exportedAt.",
  "documents: what they captured or committed, with the full text and what each changed in the work graph.",
  "mac: their Mac app work blocks, time entries, daily drafts, baseline and personal alias rules (field names as in the Mac API).",
  "workItems: work graph items they own, touched, or changed through one of their documents.",
  "tokens: sign-in and API tokens, metadata only. Orion stores only a hash of each token and never a password in readable form; neither is exported.",
  "auditLog: security events where they acted or were acted on.",
].join(" ");

const SCREENSHOTS =
  "Screenshot images are not inside this file, to keep it small. Each id is a document with a screenshot; while signed in, " +
  "GET /api/sources/<id>/image downloads it. Ask an admin if you need them all.";

type SourceRow = { id: string; kind: string; ref: string; title: string; text: string; ocr_text: string | null; created_at: string; has_image: number };
type ChangeRow = { source_id: string; node_id: string; label: string | null; change: string; status_from: string | null; status_to: string };
type NodeRow = { id: string; label: string; type: string; status: string; summary: string; owner: string | null; updated_at: string };

export type PersonExport = {
  format: "orion-person-export";
  version: number;
  exportedAt: string;
  orgId: string;
  userId: string;
  about: string;
  accounts: {
    username: string;
    email: string | null;
    role: "admin" | "member";
    disabled: boolean;
    createdAt: string;
    lastSeenAt: string | null;
    consent: { version: number; acceptedAt: string | null };
    tokens: { id: string; kind: string; label: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null }[];
  }[];
  person: { id: string; name: string; role: string; teamDescription: string } | null;
  documents: {
    id: string;
    kind: string;
    ref: string;
    title: string;
    text: string;
    ocrText: string | null;
    summary: string | null;
    createdAt: string;
    hasScreenshot: boolean;
    changed: { itemId: string; label: string | null; change: string; statusFrom: string | null; statusTo: string }[];
  }[];
  screenshots: { count: number; ids: string[]; howToGet: string };
  mac: {
    workBlocks: Record<string, unknown>[];
    timeEntries: Record<string, unknown>[];
    drafts: Record<string, unknown>[];
    baseline: Record<string, unknown>[];
    baselineDays: Record<string, unknown>[];
    aliasRules: Record<string, unknown>[];
  };
  workItems: { id: string; label: string; type: string; status: string; summary: string; owner: string | null; updatedAt: string; why: ("owner" | "touched" | "changed")[] }[];
  dashboard: unknown;
  auditLog: AuditEvent[];
};

/** Builds the export. Nothing about other people's documents is included, only items this person is linked to. */
export function buildPersonExport(db: AuthDb, store: Store, orgId: string, userId: string, now = new Date()): PersonExport {
  ensureMacTables(store);
  const q = store.db;
  const accounts = db.accountsForUser(orgId, userId);
  const user = store.getUser(userId);
  if (!user && accounts.length === 0) throw new HttpError(404, `unknown userId "${userId}"`);

  const sources = q
    .prepare("SELECT id, kind, ref, title, text, ocr_text, created_at, image IS NOT NULL AS has_image FROM sources WHERE author_id = ? ORDER BY created_at")
    .all(userId) as SourceRow[];
  const changes = q
    .prepare(
      `SELECT c.source_id, c.node_id, n.label, c.change, c.status_from, c.status_to FROM source_changes c
       JOIN sources s ON s.id = c.source_id LEFT JOIN nodes n ON n.id = c.node_id WHERE s.author_id = ?`,
    )
    .all(userId) as ChangeRow[];
  const summaries = new Map(
    (q.prepare("SELECT m.source_id, m.text FROM summaries m JOIN sources s ON s.id = m.source_id WHERE s.author_id = ?").all(userId) as { source_id: string; text: string }[]).map(
      (r) => [r.source_id, r.text],
    ),
  );
  const changesBy = new Map<string, ChangeRow[]>();
  for (const c of changes) changesBy.set(c.source_id, [...(changesBy.get(c.source_id) ?? []), c]);

  // Work items: owned (by id or name, as the model wrote it), touched, or changed by one of their documents.
  const why = new Map<string, Set<"owner" | "touched" | "changed">>();
  const add = (id: string, w: "owner" | "touched" | "changed") => why.set(id, (why.get(id) ?? new Set()).add(w));
  const names = [userId, user?.name].filter((n): n is string => !!n).map((n) => n.trim().toLowerCase());
  for (const r of q.prepare("SELECT id, owner FROM nodes WHERE owner IS NOT NULL").all() as { id: string; owner: string }[]) {
    if (names.includes(r.owner.trim().toLowerCase())) add(r.id, "owner");
  }
  for (const r of q.prepare("SELECT node_id FROM touches WHERE user_id = ?").all(userId) as { node_id: string }[]) add(r.node_id, "touched");
  for (const c of changes) add(c.node_id, "changed");
  const node = q.prepare("SELECT id, label, type, status, summary, owner, updated_at FROM nodes WHERE id = ?");
  const workItems = [...why].flatMap(([id, w]) => {
    const n = node.get(id) as NodeRow | undefined;
    return n ? [{ id: n.id, label: n.label, type: n.type, status: n.status, summary: n.summary, owner: n.owner, updatedAt: n.updated_at, why: [...w] }] : [];
  });

  const rows = (sql: string) => q.prepare(sql).all(userId) as Record<string, unknown>[];
  const screenshotIds = sources.filter((s) => s.has_image).map((s) => s.id);
  const usernames = accounts.map((a) => a.username);

  return {
    format: "orion-person-export",
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    orgId,
    userId,
    about: ABOUT,
    accounts: accounts.map((a) => ({
      username: a.username,
      email: a.email,
      role: a.admin ? "admin" : "member",
      disabled: a.disabled,
      createdAt: a.createdAt,
      lastSeenAt: a.lastSeenAt,
      consent: { version: a.consentVersion, acceptedAt: a.consentAt },
      tokens: db.listTokens(a.username).map((t) => ({ id: t.id, kind: t.kind, label: t.label, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt })),
    })),
    person: user ? { id: user.id, name: user.name, role: user.role, teamDescription: user.teamDescription } : null,
    documents: sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      ref: s.ref,
      title: s.title,
      text: s.text,
      ocrText: s.ocr_text,
      summary: summaries.get(s.id) ?? null,
      createdAt: s.created_at,
      hasScreenshot: s.has_image === 1,
      changed: (changesBy.get(s.id) ?? []).map((c) => ({ itemId: c.node_id, label: c.label, change: c.change, statusFrom: c.status_from, statusTo: c.status_to })),
    })),
    screenshots: { count: screenshotIds.length, ids: screenshotIds, howToGet: SCREENSHOTS },
    mac: {
      workBlocks: rows(
        `SELECT id, local_id, started_at, ended_at, app_bundle_id, app_name, window_title, domain_path, matched_client_id, match_method,
         match_confidence, snippet, redaction_count, source_id, created_at FROM mac_work_blocks WHERE user_id = ? ORDER BY started_at`,
      ),
      timeEntries: rows(
        `SELECT e.id, e.draft_id, e.client_id, e.unmatched, e.started_at, e.ended_at, e.minutes, e.narrative, e.status, e.reviewed_at, e.created_at,
         (SELECT json_group_array(json_object('work_block_id', b.local_id, 'quote', v.quote)) FROM mac_evidence v JOIN mac_work_blocks b ON b.id = v.block_id
          WHERE v.entry_id = e.id) AS evidence
         FROM mac_entries e WHERE e.user_id = ? ORDER BY e.started_at`,
      ).map((r) => ({ ...r, evidence: JSON.parse(String(r.evidence ?? "[]")) as unknown })),
      drafts: rows("SELECT id, day, finalized_at, csv, created_at FROM mac_drafts WHERE user_id = ? ORDER BY day"),
      baseline: rows("SELECT day, client_id, minutes FROM mac_baseline WHERE user_id = ? ORDER BY day"),
      baselineDays: rows("SELECT day, submitted_at FROM mac_baseline_days WHERE user_id = ? ORDER BY day"),
      aliasRules: rows("SELECT id, pattern, client_id, accepted_as, created_at, updated_at FROM mac_alias_rules WHERE user_id = ? ORDER BY created_at"),
    },
    workItems,
    dashboard: store.getDashboard(userId),
    auditLog: auditAbout(db, orgId, usernames, [...usernames, userId]),
  };
}

/** The export as a download, `orion-export-<user>-<date>.json`. */
export function exportResponse(e: PersonExport): Response {
  const safe = e.userId.replace(/[^\w.-]/g, "_");
  return new Response(JSON.stringify(e, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="orion-export-${safe}-${e.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Exports a person and records it: by the person themselves, or by an admin of their org. Counts only in the log. */
export function exportPerson(db: AuthDb, store: Store, actor: Principal | null, orgId: string, userId: string): PersonExport {
  const e = buildPersonExport(db, store, orgId, userId);
  audit(db, {
    orgId,
    actor: actor?.username ?? null,
    action: "data_exported",
    target: userId,
    detail: { by: actor && actor.userId === userId ? "self" : "admin", documents: e.documents.length, workBlocks: e.mac.workBlocks.length, screenshots: e.screenshots.count },
  });
  return e;
}

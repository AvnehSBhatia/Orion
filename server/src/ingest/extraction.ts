// Extraction state per stored source, and the background retry of extractions that failed on a provider error.
import { config } from "@/config";
import type { Store, GraphUpdate, StoredSource } from "@/db/store";
import { HttpError } from "@/http/error";
import { logJson } from "@/jobs/log";
import type { CaptureInput, Extractor, ExtractContext, KnownNode } from "@/llm/extract";
import { BudgetExceededError, overBudget } from "@/usage";
import { changesOf, pageOf } from "./diff";

/**
 * null or "done": the model judged the source (or it never needed the model).
 * "pending": extraction failed on a provider error or timeout and will be retried in the background.
 * "failed": still failing after the last attempt; the source stays stored without graph changes.
 * "skipped": the org's monthly model budget was spent; not retried.
 */
export type ExtractionState = "done" | "pending" | "failed" | "skipped";

export const extractionEnv = {
  get maxAttempts(): number {
    const n = Number(process.env.EXTRACTION_MAX_ATTEMPTS);
    return Number.isInteger(n) && n > 0 ? n : 5;
  },
  /** Wait before the first retry; each later one waits 4x longer, up to 12 hours. */
  get retryBaseMs(): number {
    const n = Number(process.env.EXTRACTION_RETRY_BASE_MS);
    return Number.isFinite(n) && n > 0 ? n : 2 * 60_000;
  },
};

const MAX_RETRY_WAIT_MS = 12 * 3_600_000;

export function retryDelayMs(attempts: number): number {
  return Math.min(MAX_RETRY_WAIT_MS, extractionEnv.retryBaseMs * 4 ** Math.max(0, attempts - 1));
}

const ready = new WeakSet<object>();

/** Adds the extraction columns to an org file that lacks them. Cheap after the first call per connection. */
export function ensureExtractionColumns(store: Store): void {
  if (ready.has(store.db)) return;
  const have = new Set((store.db.prepare("PRAGMA table_info(sources)").all() as { name: string }[]).map((c) => c.name));
  const cols: Record<string, string> = {
    extraction: "TEXT",
    extraction_attempts: "INTEGER NOT NULL DEFAULT 0",
    extraction_next_at: "TEXT",
    extraction_error: "TEXT",
  };
  for (const [name, type] of Object.entries(cols)) if (!have.has(name)) store.db.exec(`ALTER TABLE sources ADD COLUMN ${name} ${type}`);
  store.db.exec("CREATE INDEX IF NOT EXISTS sources_extraction ON sources(extraction, extraction_next_at) WHERE extraction = 'pending'");
  ready.add(store.db);
}

/** Why a model call failed, kept on the source for operators ("504: model provider timed out"). */
const reason = (err: unknown) => (err instanceof HttpError ? `${err.status}: ${err.message}` : err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Marks a just-stored source after its extraction failed: pending for a retry, or skipped when over budget. */
export function markExtractionFailed(store: Store, sourceId: string, err: unknown, now = Date.now()): ExtractionState {
  ensureExtractionColumns(store);
  if (err instanceof BudgetExceededError) {
    store.db.prepare("UPDATE sources SET extraction = 'skipped', extraction_error = ? WHERE id = ?").run(reason(err), sourceId);
    return "skipped";
  }
  store.db
    .prepare("UPDATE sources SET extraction = 'pending', extraction_attempts = 1, extraction_next_at = ?, extraction_error = ? WHERE id = ?")
    .run(new Date(now + retryDelayMs(1)).toISOString(), reason(err), sourceId);
  return "pending";
}

export function extractionState(store: Store, sourceId: string): { state: ExtractionState; attempts: number; nextAt: string | null } | null {
  ensureExtractionColumns(store);
  const r = store.db.prepare("SELECT extraction, extraction_attempts, extraction_next_at FROM sources WHERE id = ?").get(sourceId) as
    | { extraction: string | null; extraction_attempts: number; extraction_next_at: string | null }
    | undefined;
  return r ? { state: (r.extraction as ExtractionState | null) ?? "done", attempts: r.extraction_attempts, nextAt: r.extraction_next_at } : null;
}

/** Pending extractions whose retry time has come. */
export function duePendingCount(store: Store, now = Date.now()): number {
  ensureExtractionColumns(store);
  return (
    store.db.prepare("SELECT COUNT(*) AS n FROM sources WHERE extraction = 'pending' AND extraction_next_at <= ?").get(new Date(now).toISOString()) as {
      n: number;
    }
  ).n;
}

export type RetryReport = {
  tried: number;
  extracted: number;
  notWork: number;
  failed: number;
  stillPending: number;
  /** Mac blocks marked done unread: the same person had the same screen extracted within the day. */
  repeats: number;
  overBudget?: true;
};

function aboutFor(store: Store, authorId: string | null): ExtractContext {
  const u = authorId ? store.getUser(authorId) : null;
  return { org: store.getOrg(), author: u ? { name: u.name, role: u.role } : null };
}

const known = (store: Store): KnownNode[] => store.listNodes().map(({ id, label, type, domain, updatedAt }) => ({ id, label, type, domain, updatedAt }));

/** Page text sent to the model on a retry (the capture path sends at most this much too). */
const MAX_RETRY_TEXT = 30_000;

/** Files back out of a stored commit source ("--- path\n<diff>" blocks). */
function filesOf(text: string): { path: string; diff: string }[] {
  const parts = text.split(/^--- (.+)$/m);
  const files: { path: string; diff: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) files.push({ path: parts[i], diff: parts[i + 1]?.replace(/^\n/, "").replace(/\n\n$/, "") ?? "" });
  return files;
}

function captureInput(s: StoredSource): CaptureInput {
  const changes = changesOf(s.text);
  const seen = s.ocrText && s.imageStatus === "kept" ? `${pageOf(s.text)}\n\nText in the screenshot:\n${s.ocrText}` : pageOf(s.text);
  return { url: s.ref, title: s.title, text: seen.slice(0, MAX_RETRY_TEXT), ...(changes && { changes }) };
}

/** Mac blocks go in batches when the extractor takes them; everything else one source per call. */
const batchable = (extractor: Extractor, s: StoredSource) => s.kind === "mac" && !!extractor.fromCaptures;

/** One update per source in `group`: a batch of one person's Mac blocks, or a single source. */
async function extractAgain(store: Store, extractor: Extractor, group: StoredSource[]): Promise<GraphUpdate[]> {
  const s = group[0];
  const about = aboutFor(store, s.authorId);
  if (batchable(extractor, s)) return extractor.fromCaptures!(group.map(captureInput), known(store), about);
  if (s.kind === "code") {
    const at = s.ref.lastIndexOf("@");
    return [await extractor.fromCode({ repo: s.ref.slice(0, at), commitSha: s.ref.slice(at + 1), files: filesOf(s.text) }, known(store), about)];
  }
  return [await extractor.fromCapture(captureInput(s), known(store), about)];
}

const DAY_MS = 86_400_000;

/** A Mac block with the same window and text as one the same person had extracted within a day: nothing new to read. */
function isRepeat(store: Store, s: StoredSource): boolean {
  if (s.kind !== "mac") return false;
  const from = new Date(Date.parse(s.createdAt) - DAY_MS).toISOString();
  const to = new Date(Date.parse(s.createdAt) + DAY_MS).toISOString();
  return !!store.db
    .prepare(
      `SELECT 1 FROM sources WHERE ref = ? AND created_at BETWEEN ? AND ? AND kind = 'mac' AND id <> ? AND author_id IS ? AND title = ? AND text = ?
         AND (extraction IS NULL OR extraction = 'done') LIMIT 1`,
    )
    .get(s.ref, from, to, s.id, s.authorId, s.title, s.text);
}

/** The due sources in calls: one person's Mac blocks in batches of `config.extractBatch`, others one each. */
function groups(extractor: Extractor, sources: StoredSource[]): StoredSource[][] {
  const out: StoredSource[][] = [];
  const open = new Map<string, StoredSource[]>();
  for (const s of sources) {
    if (!batchable(extractor, s)) {
      out.push([s]);
      continue;
    }
    const key = s.authorId ?? "";
    let g = open.get(key);
    if (!g || g.length >= config.extractBatch) open.set(key, (g = [])), out.push(g);
    g.push(s);
  }
  return out;
}

/** Merges a late extraction into the graph as if it had come with the capture: nodes, what the source changed, touches. */
function applyLate(store: Store, s: StoredSource, update: GraphUpdate): void {
  store.transaction(() => {
    const { touched, changes } = store.upsertGraph(update, { sourceKind: s.kind, sourceRef: s.ref });
    const stmt = store.db.prepare(
      "INSERT OR REPLACE INTO source_changes (source_id, node_id, change, status_from, status_to) VALUES (?, ?, ?, ?, ?)",
    );
    for (const c of changes) stmt.run(s.id, c.nodeId, c.change, c.statusFrom, c.statusTo);
    if (s.authorId && store.getUser(s.authorId) && touched.length) store.addTouches(s.authorId, touched);
    store.db.prepare("UPDATE sources SET extraction = 'done', extraction_next_at = NULL, extraction_error = NULL WHERE id = ?").run(s.id);
  });
}

/**
 * Re-runs extraction for pending sources whose retry time has come, oldest first. A success merges the graph changes
 * (a capture the model now finds no work in is deleted, as it would not have been stored); a provider error schedules
 * the next attempt with backoff, and after the last attempt marks the source failed. Nothing runs while the org is
 * over its model budget, and attempts are not used up by it. Callers re-embed afterwards (maintainOrg does).
 */
export async function retryPendingExtractions(
  store: Store,
  extractor: Extractor,
  { now = Date.now(), limit = 20 }: { now?: number; limit?: number } = {},
): Promise<RetryReport> {
  ensureExtractionColumns(store);
  const report: RetryReport = { tried: 0, extracted: 0, notWork: 0, failed: 0, stillPending: 0, repeats: 0 };
  const ids = (
    store.db
      .prepare("SELECT id FROM sources WHERE extraction = 'pending' AND extraction_next_at <= ? ORDER BY created_at LIMIT ?")
      .all(new Date(now).toISOString(), limit) as { id: string }[]
  ).map((r) => r.id);
  if (!ids.length) return report;
  if (overBudget(store, new Date(now))) return { ...report, overBudget: true };
  const max = extractionEnv.maxAttempts;
  const due: StoredSource[] = [];
  const pass = new Set<string>();
  for (const s of store.getSources(ids)) {
    if (isRepeat(store, s)) {
      store.db.prepare("UPDATE sources SET extraction = 'done', extraction_next_at = NULL, extraction_error = NULL WHERE id = ?").run(s.id);
      report.repeats++;
      continue;
    }
    // A repeat of a block in this same pass waits for the next one, when the first is done and it matches.
    const key = s.kind === "mac" ? `${s.authorId}\n${s.ref}\n${s.title}\n${s.text}` : s.id;
    if (pass.has(key)) continue;
    pass.add(key);
    due.push(s);
  }
  for (const group of groups(extractor, due)) {
    report.tried += group.length;
    try {
      const updates = await extractAgain(store, extractor, group);
      group.forEach((s, i) => {
        const update = updates[i] ?? { nodes: [], edges: [] };
        if (s.kind === "extension" && !update.nodes.length && !update.edges.length) {
          store.db.prepare("DELETE FROM sources WHERE id = ?").run(s.id);
          report.notWork++;
        } else {
          applyLate(store, s, update);
          report.extracted++;
        }
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        report.overBudget = true;
        report.tried -= group.length;
        break;
      }
      for (const s of group) {
        if (!(err instanceof HttpError)) logJson("error", "extraction retry crashed", { sourceId: s.id, err });
        const row = store.db.prepare("SELECT extraction_attempts AS n FROM sources WHERE id = ?").get(s.id) as { n: number };
        const attempts = row.n + 1;
        if (attempts >= max) {
          store.db.prepare("UPDATE sources SET extraction = 'failed', extraction_attempts = ?, extraction_next_at = NULL, extraction_error = ? WHERE id = ?").run(attempts, reason(err), s.id);
          report.failed++;
          logJson("warn", "extraction gave up", { sourceId: s.id, attempts, error: reason(err) });
        } else {
          store.db
            .prepare("UPDATE sources SET extraction_attempts = ?, extraction_next_at = ?, extraction_error = ? WHERE id = ?")
            .run(attempts, new Date(now + retryDelayMs(attempts)).toISOString(), reason(err), s.id);
          report.stillPending++;
        }
      }
    }
  }
  return report;
}

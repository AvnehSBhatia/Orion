// POST /v1/work-blocks: approved Mac work, stored per block (a bad block is turned away on its own), each one
// also kept as an Orion document so the dashboard, graph, search and MCP see it. Extraction runs in the background.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "@/db/store";
import { ensureExtractionColumns } from "@/ingest/extraction";
import type { IngestDeps } from "@/ingest/pipeline";
import { logJson } from "@/jobs/log";
import { maintainInBackground } from "@/orgspace/maintain";
import { getOrgSettings, isExcludedUrl } from "@/orgs/settings";
import { guardHit, type GuardHit } from "./guard";
import { ensureMacTables } from "./schema";

export const MAX_BLOCKS = 500;
export const SNIPPET_MAX = 1500;

const iso = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());
/** Long text is cut rather than refused: the Mac counts characters differently from JavaScript. */
const cut = (max: number) => z.string().max(max * 8).transform((s) => s.slice(0, max));

export const blockSchema = z.object({
  local_id: z.string().trim().min(1).max(128),
  started_at: iso,
  ended_at: iso,
  app_bundle_id: cut(255).nullish(),
  app_name: cut(200),
  window_title: cut(1000),
  domain_path: cut(2048).nullish(),
  matched_client_id: z.string().max(64).nullish(),
  match_method: z.enum(["domain", "code", "alias", "manual", "none"]),
  match_confidence: z.number().min(0).max(1),
  snippet: cut(SNIPPET_MAX),
  text_hash: z.string().max(128).nullish(),
  redaction_count: z.number().int().min(0).max(100_000).default(0),
});
export type WorkBlockInput = z.infer<typeof blockSchema>;

/** The envelope only; each block is checked on its own so one bad block cannot sink the batch. */
export const workBlocksRequest = z.object({
  batch_hash: z.string().max(128).optional(),
  blocks: z.array(z.unknown()).max(MAX_BLOCKS),
});

export type RejectReason = GuardHit | "ended_before_started" | "excluded_host" | "invalid";
export type WorkBlocksResponse = { accepted: number; duplicate: number; accepted_ids: string[]; rejected: { local_id: string; reason: RejectReason }[] };

/** Why one block cannot be stored, or null. Card numbers and API keys are looked for in the snippet and the title. */
function rejectReason(store: Store, b: WorkBlockInput): RejectReason | null {
  if (Date.parse(b.ended_at) < Date.parse(b.started_at)) return "ended_before_started";
  if (b.domain_path && isExcludedUrl(getOrgSettings(store), `https://${b.domain_path.replace(/^[a-z]+:\/\//i, "")}`)) return "excluded_host";
  return guardHit(b.snippet) ?? guardHit(b.window_title) ?? guardHit(b.domain_path ?? "");
}

/** What the Orion document for a block points at: the page, or the app. */
export function blockRef(b: Pick<WorkBlockInput, "domain_path" | "app_bundle_id" | "app_name">): string {
  if (b.domain_path) return `https://${b.domain_path.replace(/^[a-z]+:\/\//i, "")}`;
  return `mac://${encodeURIComponent(b.app_name || b.app_bundle_id || "app")}`;
}

export function blockDocText(b: Pick<WorkBlockInput, "app_name" | "window_title" | "domain_path" | "snippet">, clientName: string | null): string {
  const head = [`${b.app_name}: ${b.window_title}`, b.domain_path ?? "", clientName ? `Client: ${clientName}` : ""].filter(Boolean).join("\n");
  return b.snippet ? `${head}\n\n${b.snippet}` : head;
}

/**
 * Stores the batch. Idempotent per person on local_id: a block seen before counts as a duplicate and is listed in
 * accepted_ids again, so the Mac marks it sent. Callers check consent and the pause switch first.
 */
export function submitWorkBlocks(deps: IngestDeps, userId: string, blocks: unknown[], now = new Date()): WorkBlocksResponse {
  const { store } = deps;
  ensureMacTables(store);
  ensureExtractionColumns(store);
  const out: WorkBlocksResponse = { accepted: 0, duplicate: 0, accepted_ids: [], rejected: [] };
  const known = store.db.prepare("SELECT 1 FROM mac_work_blocks WHERE user_id = ? AND local_id = ?");
  const clientName = store.db.prepare("SELECT name FROM mac_clients WHERE id = ?");
  const insert = store.db.prepare(
    `INSERT INTO mac_work_blocks (id, user_id, local_id, started_at, ended_at, app_bundle_id, app_name, window_title, domain_path,
       matched_client_id, match_method, match_confidence, snippet, text_hash, redaction_count, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const at = now.toISOString();
  const author = store.getUser(userId) ? userId : null;
  let stored = 0;

  store.transaction(() => {
    for (const raw of blocks) {
      const parsed = blockSchema.safeParse(raw);
      if (!parsed.success) {
        const id = (raw as { local_id?: unknown } | null)?.local_id;
        out.rejected.push({ local_id: typeof id === "string" ? id.slice(0, 128) : "", reason: "invalid" });
        continue;
      }
      const b = parsed.data;
      if (known.get(userId, b.local_id)) {
        out.duplicate++;
        out.accepted_ids.push(b.local_id);
        continue;
      }
      const reason = rejectReason(store, b);
      if (reason) {
        out.rejected.push({ local_id: b.local_id, reason });
        continue;
      }
      // An id the org does not know (a client added and removed between syncs) is stored as unmatched.
      const client = b.matched_client_id ? (clientName.get(b.matched_client_id) as { name: string } | undefined) : undefined;
      const clientId = client ? b.matched_client_id! : null;
      const id = randomUUID();
      const sourceId = `src-mac-${id}`;
      store.saveSource(
        { id: sourceId, kind: "mac", ref: blockRef(b), title: b.window_title || b.app_name, text: blockDocText(b, client?.name ?? null), image: null, authorId: author, createdAt: b.started_at },
        [],
      );
      // Extraction waits for the background: marked due now, picked up by org maintenance or the retry job.
      store.db.prepare("UPDATE sources SET extraction = 'pending', extraction_attempts = 0, extraction_next_at = ? WHERE id = ?").run(at, sourceId);
      insert.run(
        id,
        userId,
        b.local_id,
        b.started_at,
        b.ended_at,
        b.app_bundle_id ?? null,
        b.app_name,
        b.window_title,
        b.domain_path ?? null,
        clientId,
        clientId ? b.match_method : "none",
        clientId ? b.match_confidence : 0,
        b.snippet,
        b.text_hash ?? null,
        b.redaction_count,
        sourceId,
        at,
      );
      out.accepted++;
      out.accepted_ids.push(b.local_id);
      stored++;
    }
  });

  // Counts only: never a title or snippet.
  if (out.rejected.length) logJson("warn", "work blocks rejected", { count: out.rejected.length, reasons: [...new Set(out.rejected.map((r) => r.reason))] });
  const bg = deps.background;
  if (stored && bg) maintainInBackground(store, deps.embedder, bg.llm, bg.model);
  return out;
}

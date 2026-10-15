// The firm's clients and alias rules: synced to each Mac for on-device matching, managed by admins.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/audit/log";
import type { AuthDb, Principal } from "@/auth/db";
import type { Store } from "@/db/store";
import { parseCsv } from "./csv";
import { v1Error } from "./http";
import { currentSeq, ensureMacTables, nextSeq } from "./schema";

export type Client = { id: string; name: string; aliases: string[]; domains: string[]; project_codes: string[]; active: boolean };
export type AliasRule = { id: string; pattern: string; client_id: string };
export type AdminAliasRule = AliasRule & {
  client_name: string;
  user_id: string | null;
  user_name: string | null;
  scope: "user" | "org";
  status: "pending" | "accepted";
  created_at: string;
};

type ClientRow = { id: string; name: string; aliases: string; domains: string; project_codes: string; active: number; seq: number };
type RuleRow = { id: string; pattern: string; client_id: string; user_id: string | null; accepted_as: string | null; created_at: string; seq: number };

const toClient = (r: ClientRow): Client => ({
  id: r.id,
  name: r.name,
  aliases: JSON.parse(r.aliases) as string[],
  domains: JSON.parse(r.domains) as string[],
  project_codes: JSON.parse(r.project_codes) as string[],
  active: r.active === 1,
});
const toRule = (r: RuleRow): AliasRule => ({ id: r.id, pattern: r.pattern, client_id: r.client_id });

const list = (max: number) =>
  z
    .array(z.string().trim().min(1).max(max))
    .max(100)
    .transform((xs) => [...new Set(xs)]);
/** "https://www.Initech.com/x" → "initech.com"; plain words stay as typed (lowercased). */
const domain = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((d) => d.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0]);

export const clientInput = z.object({
  name: z.string().trim().min(1).max(200),
  aliases: list(200).default([]),
  domains: z.array(domain).max(100).default([]).transform((xs) => [...new Set(xs.filter(Boolean))]),
  project_codes: list(64).default([]),
});
export const clientPatch = clientInput.partial().extend({ active: z.boolean().optional() }).strict();

export function getClient(store: Store, id: string): Client | null {
  ensureMacTables(store);
  const r = store.db.prepare("SELECT * FROM mac_clients WHERE id = ?").get(id) as ClientRow | undefined;
  return r ? toClient(r) : null;
}

export function listClients(store: Store): Client[] {
  ensureMacTables(store);
  return (store.db.prepare("SELECT * FROM mac_clients ORDER BY lower(name)").all() as ClientRow[]).map(toClient);
}

/**
 * GET /v1/clients. The etag is the list's change counter: with `since` equal to a known etag only clients and
 * rules changed after it come back (none when nothing changed); a missing or unknown `since` gets everything.
 * Rules are the org-wide ones plus the caller's own.
 */
export function clientsFor(store: Store, userId: string, since?: string | null): { clients: Client[]; rules: AliasRule[]; etag: string } {
  ensureMacTables(store);
  const seq = currentSeq(store);
  const m = since?.match(/^c(\d+)$/);
  const after = m && Number(m[1]) <= seq ? Number(m[1]) : 0;
  const clients = (store.db.prepare("SELECT * FROM mac_clients WHERE seq > ? ORDER BY lower(name)").all(after) as ClientRow[]).map(toClient);
  const rules = (
    store.db.prepare("SELECT * FROM mac_alias_rules WHERE seq > ? AND (user_id IS NULL OR user_id = ?) ORDER BY created_at").all(after, userId) as RuleRow[]
  ).map(toRule);
  return { clients, rules, etag: `c${seq}` };
}

function assertFreeName(store: Store, name: string, except?: string): void {
  const r = store.db.prepare("SELECT id FROM mac_clients WHERE lower(name) = lower(?)").get(name) as { id: string } | undefined;
  if (r && r.id !== except) throw v1Error(409, "duplicate_client", `a client named "${name}" already exists`);
}

export function createClient(db: AuthDb, store: Store, p: Principal | null, input: z.infer<typeof clientInput>): Client {
  ensureMacTables(store);
  const id = randomUUID();
  store.transaction(() => {
    assertFreeName(store, input.name);
    const now = new Date().toISOString();
    store.db
      .prepare("INSERT INTO mac_clients (id, name, aliases, domains, project_codes, active, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(id, input.name, JSON.stringify(input.aliases), JSON.stringify(input.domains), JSON.stringify(input.project_codes), nextSeq(store), now, now);
  });
  audit(db, { orgId: p?.orgId ?? null, actor: p?.username ?? null, action: "client_changed", target: id, detail: { what: "created" } });
  return getClient(store, id)!;
}

export function updateClient(db: AuthDb, store: Store, p: Principal | null, id: string, patch: z.infer<typeof clientPatch>): Client {
  ensureMacTables(store);
  const before = getClient(store, id);
  if (!before) throw v1Error(404, "not_found", "unknown client");
  const next = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Client;
  store.transaction(() => {
    if (patch.name !== undefined) assertFreeName(store, next.name, id);
    store.db
      .prepare("UPDATE mac_clients SET name = ?, aliases = ?, domains = ?, project_codes = ?, active = ?, seq = ?, updated_at = ? WHERE id = ?")
      .run(next.name, JSON.stringify(next.aliases), JSON.stringify(next.domains), JSON.stringify(next.project_codes), next.active ? 1 : 0, nextSeq(store), new Date().toISOString(), id);
  });
  audit(db, { orgId: p?.orgId ?? null, actor: p?.username ?? null, action: "client_changed", target: id, detail: { what: "updated", fields: Object.keys(patch) } });
  return getClient(store, id)!;
}

const cellList = (cell: string | undefined) =>
  (cell ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * POST /v1/owner/clients/import: CSV `name,aliases,domains,project_codes` with `;` between values in a cell. A
 * header row is optional. A name that exists (case-insensitive) is updated, others are created; bad lines are
 * reported by line number and skipped.
 */
export function importClients(db: AuthDb, store: Store, p: Principal | null, csv: string): { created: number; updated: number; errors: { line: number; message: string }[] } {
  ensureMacTables(store);
  const rows = parseCsv(csv);
  const out = { created: 0, updated: 0, errors: [] as { line: number; message: string }[] };
  if (rows.length > 5000) throw v1Error(400, "invalid_request", "import at most 5,000 clients at a time");
  rows.forEach((cells, i) => {
    if (i === 0 && cells[0]?.trim().toLowerCase() === "name") return;
    const parsed = clientInput.safeParse({ name: cells[0] ?? "", aliases: cellList(cells[1]), domains: cellList(cells[2]), project_codes: cellList(cells[3]) });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      out.errors.push({ line: i + 1, message: `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}` });
      return;
    }
    const existing = store.db.prepare("SELECT id FROM mac_clients WHERE lower(name) = lower(?)").get(parsed.data.name) as { id: string } | undefined;
    if (existing) {
      updateClient(db, store, p, existing.id, { ...parsed.data, active: true });
      out.updated++;
    } else {
      createClient(db, store, p, parsed.data);
      out.created++;
    }
  });
  return out;
}

/**
 * A personal rule from a client change in a draft: this person's future blocks with this title or domain match
 * this client. One rule per person and pattern; a later change of mind moves it to the new client.
 */
export function savePersonalRule(store: Store, userId: string, pattern: string, clientId: string): void {
  ensureMacTables(store);
  const now = new Date().toISOString();
  store.transaction(() => {
    const seq = nextSeq(store);
    store.db
      .prepare(
        `INSERT INTO mac_alias_rules (id, pattern, client_id, user_id, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(IFNULL(user_id, ''), lower(pattern)) DO UPDATE SET client_id = excluded.client_id, accepted_as = NULL, seq = excluded.seq, updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), pattern, clientId, userId, seq, now, now);
  });
}

/** GET /v1/owner/alias-rules: org-wide rules and every person's rules, pending until an admin accepts them. */
export function adminRules(store: Store): AdminAliasRule[] {
  ensureMacTables(store);
  const rows = store.db
    .prepare("SELECT r.*, c.name AS client_name FROM mac_alias_rules r JOIN mac_clients c ON c.id = r.client_id ORDER BY r.user_id IS NOT NULL, r.created_at DESC")
    .all() as (RuleRow & { client_name: string })[];
  return rows.map((r) => ({
    ...toRule(r),
    client_name: r.client_name,
    user_id: r.user_id,
    user_name: r.user_id ? (store.getUser(r.user_id)?.name ?? r.user_id) : null,
    scope: r.user_id ? "user" : "org",
    status: r.user_id && !r.accepted_as ? "pending" : "accepted",
    created_at: r.created_at,
  }));
}

/** POST /v1/owner/alias-rules/{id}/accept: copies a personal rule into an org-wide one (or updates the org rule with that pattern). */
export function acceptRule(db: AuthDb, store: Store, p: Principal | null, id: string): AliasRule {
  ensureMacTables(store);
  const r = store.db.prepare("SELECT * FROM mac_alias_rules WHERE id = ?").get(id) as RuleRow | undefined;
  if (!r) throw v1Error(404, "not_found", "unknown alias rule");
  if (!r.user_id) return toRule(r);
  const now = new Date().toISOString();
  const orgRule = store.transaction(() => {
    const seq = nextSeq(store);
    const row = store.db
      .prepare(
        `INSERT INTO mac_alias_rules (id, pattern, client_id, user_id, seq, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(IFNULL(user_id, ''), lower(pattern)) DO UPDATE SET client_id = excluded.client_id, seq = excluded.seq, updated_at = excluded.updated_at
         RETURNING *`,
      )
      .get(randomUUID(), r.pattern, r.client_id, seq, now, now) as RuleRow;
    store.db.prepare("UPDATE mac_alias_rules SET accepted_as = ? WHERE id = ?").run(row.id, id);
    return row;
  });
  audit(db, { orgId: p?.orgId ?? null, actor: p?.username ?? null, action: "alias_rule_accepted", target: orgRule.id, detail: { from: id } });
  return toRule(orgRule);
}

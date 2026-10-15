// The Mac app's tables in the org's SQLite file: clients and alias rules, work blocks, daily drafts, baselines.
import type { Store } from "@/db/store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mac_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  domains TEXT NOT NULL DEFAULT '[]',
  project_codes TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mac_clients_name ON mac_clients(lower(name));

-- user_id NULL: an org-wide rule. accepted_as: the org rule an admin copied this personal rule into.
CREATE TABLE IF NOT EXISTS mac_alias_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES mac_clients(id),
  user_id TEXT,
  accepted_as TEXT,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mac_alias_rules_key ON mac_alias_rules(IFNULL(user_id, ''), lower(pattern));

-- One counter for the client list: every change takes the next value, and the etag is the highest one.
CREATE TABLE IF NOT EXISTS mac_seq (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS mac_work_blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  app_bundle_id TEXT,
  app_name TEXT NOT NULL,
  window_title TEXT NOT NULL,
  domain_path TEXT,
  matched_client_id TEXT,
  match_method TEXT NOT NULL,
  match_confidence REAL NOT NULL,
  snippet TEXT,
  text_hash TEXT,
  redaction_count INTEGER NOT NULL DEFAULT 0,
  source_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, local_id)
);
CREATE INDEX IF NOT EXISTS mac_work_blocks_user_start ON mac_work_blocks(user_id, started_at);
CREATE INDEX IF NOT EXISTS mac_work_blocks_created ON mac_work_blocks(created_at);

CREATE TABLE IF NOT EXISTS mac_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  finalized_at TEXT,
  csv TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, day)
);

CREATE TABLE IF NOT EXISTS mac_entries (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES mac_drafts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  client_id TEXT,
  unmatched INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  narrative TEXT NOT NULL,
  narrative_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'edited', 'rejected')),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mac_entries_draft ON mac_entries(draft_id);
CREATE INDEX IF NOT EXISTS mac_entries_user ON mac_entries(user_id);

-- block_id: the stored block (mac_work_blocks.id); the API shows the block's local_id as work_block_id.
CREATE TABLE IF NOT EXISTS mac_evidence (
  entry_id TEXT NOT NULL REFERENCES mac_entries(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL UNIQUE REFERENCES mac_work_blocks(id) ON DELETE CASCADE,
  quote TEXT,
  PRIMARY KEY (entry_id, block_id)
);

CREATE TABLE IF NOT EXISTS mac_baseline (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  client_id TEXT,
  minutes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mac_baseline_user_day ON mac_baseline(user_id, day);
-- A day with a baseline submitted, even an empty one.
CREATE TABLE IF NOT EXISTS mac_baseline_days (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
`;

const ready = new WeakSet<object>();

/** Creates the Mac tables in an org file that lacks them. Cheap after the first call per connection. */
export function ensureMacTables(store: Store): void {
  if (ready.has(store.db)) return;
  store.db.exec(SCHEMA);
  ready.add(store.db);
}

/** The next value of the client-list counter. Call inside the transaction that writes the row. */
export function nextSeq(store: Store): number {
  ensureMacTables(store);
  const r = store.db.prepare("INSERT INTO mac_seq (id, value) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET value = value + 1 RETURNING value").get() as {
    value: number;
  };
  return r.value;
}

export function currentSeq(store: Store): number {
  ensureMacTables(store);
  return (store.db.prepare("SELECT value FROM mac_seq WHERE id = 1").get() as { value: number } | undefined)?.value ?? 0;
}

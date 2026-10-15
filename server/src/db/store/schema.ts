import type Database from "better-sqlite3";

/** One SQLite file per org. Every table is created if missing; columns added later come from `migrate`. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  domain TEXT NOT NULL,
  summary TEXT NOT NULL,
  todo TEXT,
  read_links TEXT NOT NULL DEFAULT '[]',
  owner TEXT,
  status TEXT NOT NULL,
  sellable INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  source_ref TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  websites TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  team_description TEXT NOT NULL,
  seed_vec BLOB,
  seed_model TEXT,
  user_vec BLOB,
  ranked TEXT
);

CREATE TABLE IF NOT EXISTS compressors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  weights BLOB NOT NULL,
  metrics TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS touches (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  author_id TEXT,
  image BLOB,
  created_at TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT,
  z BLOB,
  z_version TEXT
);
CREATE INDEX IF NOT EXISTS sources_created ON sources(created_at);
CREATE INDEX IF NOT EXISTS sources_ref ON sources(ref, created_at);

CREATE TABLE IF NOT EXISTS source_changes (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  change TEXT NOT NULL,
  status_from TEXT,
  status_to TEXT NOT NULL,
  PRIMARY KEY (source_id, node_id)
);
CREATE INDEX IF NOT EXISTS source_changes_node ON source_changes(node_id);

CREATE TABLE IF NOT EXISTS facets (
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  area TEXT NOT NULL,
  use TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_kind, item_id)
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  centroid BLOB NOT NULL,
  size INTEGER NOT NULL,
  version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  members TEXT NOT NULL,
  members_key TEXT NOT NULL,
  cluster_id TEXT,
  fidelity REAL NOT NULL,
  newest_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  embedding BLOB,
  embed_model TEXT
);

CREATE TABLE IF NOT EXISTS dashboards (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  spec TEXT NOT NULL,
  origin TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  fidelity REAL NOT NULL
);
`;

/** Creates the tables and adds columns that older org files lack. Safe to run on every open. */
export function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  addColumns(db, "nodes", { z: "BLOB", z_version: "TEXT", embed_ctx: "TEXT", cluster_id: "TEXT" });
  addColumns(db, "users", { gravity: "BLOB", gravity_version: "TEXT" });
  addColumns(db, "sources", {
    embed_ctx: "TEXT",
    cluster_id: "TEXT",
    ocr_text: "TEXT",
    image_status: "TEXT",
    plain_vec: "BLOB",
    plain_model: "TEXT",
    plain_hash: "TEXT",
  });
}

function addColumns(db: Database.Database, table: string, cols: Record<string, string>): void {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of Object.entries(cols)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/** Empties every table (the demo reset). */
export function clearAll(db: Database.Database): void {
  db.exec(
    `DELETE FROM dashboards; DELETE FROM summaries; DELETE FROM digests; DELETE FROM clusters; DELETE FROM facets; DELETE FROM source_changes;
     DELETE FROM sources; DELETE FROM touches; DELETE FROM edges; DELETE FROM nodes; DELETE FROM users; DELETE FROM compressors;`,
  );
}

//! Port of `src/db/store.ts` at d17501b: one SQLite file per org, identical schema and `addColumns`
//! migrations, so existing `data/orgs/*.db` files open unchanged. Float32 vectors are little-endian BLOBs.
//!
//! Shape: `Store` owns `Mutex<Db>`; `store.db()` returns a guard that derefs to [`Db`] (the guard is `!Send`,
//! so it cannot be held across an `.await`). `store.transaction(|db| ...)` runs a closure atomically.
//! Multi-statement `Db` methods use savepoints, so they nest inside an outer transaction like better-sqlite3's.
//! Whole-org reads (`list_nodes`, `list_source_meta`) are memoized until the connection writes, keyed on
//! SQLite's `total_changes()`, and returned as `Arc<Vec<_>>`.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result};
use parking_lot::{Mutex, MutexGuard};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;
use sha1::{Digest, Sha1};

use crate::contract::types::*;
use crate::text::{LABEL_MAX, SUMMARY_MAX, clamp, js_len, js_take, js_trim, normalize_label, slugify};
use crate::time::now_iso;

pub const SOURCE_TEXT_MAX: usize = 8_000;
const EXCERPT_MAX: usize = 280;

/// Every embedded item carries its model, a hash of the role context it was embedded with, and its
/// org-space projection.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Vectors {
    pub embedding: Option<Vec<f32>>,
    pub embed_model: Option<String>,
    pub embed_ctx: Option<String>,
    /// 64d org-space embedding from the active compressor.
    pub z: Option<Vec<f32>>,
    pub z_version: Option<String>,
    pub cluster_id: Option<String>,
}

/// Anything ranked in the org space: nodes, sources, and source metadata.
pub trait Vectored {
    fn id(&self) -> &str;
    fn vectors(&self) -> &Vectors;
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredNode {
    pub id: String,
    pub key: String,
    pub label: String,
    pub node_type: NodeType,
    pub domain: Domain,
    pub summary: String,
    pub todo: Option<String>,
    pub read_links: Vec<ReadLink>,
    pub owner: Option<String>,
    pub status: Status,
    pub sellable: bool,
    pub source_kind: SourceKind,
    pub source_ref: String,
    pub updated_at: String,
    pub vectors: Vectors,
}

impl Vectored for StoredNode {
    fn id(&self) -> &str {
        &self.id
    }
    fn vectors(&self) -> &Vectors {
        &self.vectors
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredUser {
    pub id: String,
    pub name: String,
    pub role: String,
    pub team_description: String,
    pub seed_vec: Option<Vec<f32>>,
    pub seed_model: Option<String>,
    pub user_vec: Option<Vec<f32>>,
    pub ranked: Option<Vec<String>>,
    /// Packed Gravity, see `pseudo::gravity`.
    pub gravity: Option<Vec<f32>>,
    pub gravity_version: Option<String>,
}

/// A captured page or a commit: the raw document behind graph changes.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredSource {
    pub id: String,
    pub kind: SourceKind,
    pub source_ref: String,
    pub title: String,
    pub text: String,
    /// Text read off the screenshot. The chat model is text only, so this is how it sees the image.
    pub ocr_text: String,
    pub image_status: ImageStatus,
    pub author_id: Option<String>,
    pub created_at: String,
    pub has_image: bool,
    pub vectors: Vectors,
}

impl Vectored for StoredSource {
    fn id(&self) -> &str {
        &self.id
    }
    fn vectors(&self) -> &Vectors {
        &self.vectors
    }
}

/// A source without its text: what ranking, projection, and maintenance need. Cheap to load for a whole org.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceMeta {
    pub id: String,
    pub kind: SourceKind,
    pub source_ref: String,
    pub title: String,
    pub image_status: ImageStatus,
    pub author_id: Option<String>,
    pub created_at: String,
    pub has_image: bool,
    pub vectors: Vectors,
}

impl Vectored for SourceMeta {
    fn id(&self) -> &str {
        &self.id
    }
    fn vectors(&self) -> &Vectors {
        &self.vectors
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewSource {
    pub id: String,
    pub kind: SourceKind,
    pub source_ref: String,
    pub title: String,
    pub text: String,
    pub author_id: Option<String>,
    pub created_at: String,
    pub image: Option<Vec<u8>>,
    pub ocr_text: Option<String>,
    pub image_status: Option<ImageStatus>,
}

/// Area and use of one node or source, as labeled by the org model.
#[derive(Debug, Clone, PartialEq)]
pub struct Facet {
    pub item_id: String,
    pub item_kind: ItemKind,
    pub area: String,
    pub use_: String,
    pub text_hash: String,
}

str_enum!(ItemKind { Node = "node", Source = "source" });

/// A named region of the org space. `version` is the compressor id its centroid lives in.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredCluster {
    pub id: String,
    pub label: String,
    pub centroid: Vec<f32>,
    pub size: i64,
    pub version: String,
}

/// Several similar sources merged into one short text, with the fidelity it passed.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredDigest {
    pub id: String,
    pub title: String,
    pub text: String,
    pub members: Vec<String>,
    pub members_key: String,
    pub cluster_id: Option<String>,
    pub fidelity: f64,
    pub newest_at: String,
    pub created_at: String,
    pub embedding: Option<Vec<f32>>,
    pub embed_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredSummary {
    pub source_id: String,
    pub text: String,
    pub text_hash: String,
    pub fidelity: f64,
}

str_enum!(CompressorKind { Mrl = "mrl", Trained = "trained" });

#[derive(Debug, Clone, PartialEq)]
pub struct StoredCompressor {
    pub id: String,
    pub kind: CompressorKind,
    pub weights: Vec<f32>,
    /// `CompressorMetrics` as JSON (`unknown` in TS).
    pub metrics: Value,
    pub created_at: String,
}

/// A cached plain-text vector (title + body, no screenshot, no role) used to group sources into digests.
#[derive(Debug, Clone, PartialEq)]
pub struct PlainVector {
    pub vec: Vec<f32>,
    pub model: String,
    pub hash: String,
}

/// A node as extracted by the model, before it has an id or provenance.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedNode {
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub domain: Domain,
    pub summary: String,
    pub todo: Option<String>,
    pub read_links: Vec<ReadLink>,
    pub owner: Option<String>,
    pub status: Status,
    /// None keeps the stored value. Only code ingest decides what sales can mention.
    pub sellable: Option<bool>,
}

/// Edge endpoints are labels (or ids) as the model wrote them, resolved at upsert time.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ExtractedEdge {
    pub source: String,
    pub target: String,
    pub relation: Relation,
}

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct GraphUpdate {
    pub nodes: Vec<ExtractedNode>,
    pub edges: Vec<ExtractedEdge>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Provenance {
    pub source_kind: SourceKind,
    pub source_ref: String,
    pub now: Option<String>,
}

/// `SourceChange` without the label.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeChange {
    pub node_id: String,
    pub change: ChangeKind,
    pub status_from: Option<Status>,
    pub status_to: Status,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct UpsertResult {
    pub touched: Vec<String>,
    pub edges_added: Vec<String>,
    pub changes: Vec<NodeChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub nodes: i64,
    pub edges: i64,
    pub sources: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthorAt {
    pub author_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClusterAssignment {
    pub kind: ItemKind,
    pub id: String,
    pub cluster_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UserSteering {
    pub user_vec: Option<Vec<f32>>,
    pub gravity: Option<Vec<f32>>,
    pub gravity_version: Option<String>,
    pub ranked: Vec<String>,
}

pub fn node_key(t: NodeType, label: &str) -> String {
    format!("{}:{}", t.as_str(), normalize_label(label))
}

fn sha1_hex(s: &str) -> String {
    hex::encode(Sha1::digest(s.as_bytes()))
}

pub fn source_id(kind: SourceKind, source_ref: &str, created_at: &str) -> String {
    format!("src-{}", &sha1_hex(&format!("{}\n{source_ref}\n{created_at}", kind.as_str()))[..12])
}

pub fn edge_id(source: &str, relation: Relation, target: &str) -> String {
    format!("{source}__{}__{target}", relation.as_str())
}

pub fn to_public_node(n: &StoredNode) -> PublicNode {
    PublicNode {
        id: n.id.clone(),
        label: n.label.clone(),
        node_type: n.node_type,
        domain: n.domain,
        summary: n.summary.clone(),
        todo: n.todo.clone(),
        read_links: n.read_links.clone(),
        owner: n.owner.clone(),
        status: n.status,
        sellable: n.sellable,
        source_kind: n.source_kind,
        source_ref: n.source_ref.clone(),
        updated_at: n.updated_at.clone(),
    }
}

/// `textHash(...parts)`: sha1 of the parts joined by newlines (None as ""), first 12 hex chars.
pub fn text_hash(parts: &[Option<&str>]) -> String {
    let joined: Vec<&str> = parts.iter().map(|p| p.unwrap_or("")).collect();
    sha1_hex(&joined.join("\n"))[..12].to_string()
}

pub fn to_public_user(u: &StoredUser) -> User {
    User { id: u.id.clone(), name: u.name.clone(), role: u.role.clone(), team_description: u.team_description.clone() }
}

pub fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

pub fn from_blob(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

fn blob_opt(v: &Option<Vec<f32>>) -> Option<Vec<u8>> {
    v.as_deref().map(to_blob)
}

const SCHEMA: &str = r#"
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
"#;

const SOURCE_COLS: &str = "id, kind, ref, title, text, ocr_text, image_status, author_id, image IS NOT NULL AS has_image, created_at,
  embedding, embed_model, embed_ctx, z, z_version, cluster_id";

const SOURCE_META_COLS: &str = "id, kind, ref, title, image_status, author_id, image IS NOT NULL AS has_image, created_at,
  embedding, embed_model, embed_ctx, z, z_version, cluster_id";

fn enum_col<T>(row: &Row, col: &str, parse: fn(&str) -> Option<T>) -> rusqlite::Result<T> {
    let s: String = row.get(col)?;
    parse(&s).ok_or_else(|| rusqlite::Error::InvalidColumnType(0, format!("{col}={s}"), rusqlite::types::Type::Text))
}

fn vec_col(row: &Row, col: &str) -> rusqlite::Result<Option<Vec<f32>>> {
    Ok(row.get::<_, Option<Vec<u8>>>(col)?.map(|b| from_blob(&b)))
}

fn row_vectors(row: &Row) -> rusqlite::Result<Vectors> {
    Ok(Vectors {
        embedding: vec_col(row, "embedding")?,
        embed_model: row.get("embed_model")?,
        embed_ctx: row.get("embed_ctx")?,
        z: vec_col(row, "z")?,
        z_version: row.get("z_version")?,
        cluster_id: row.get("cluster_id")?,
    })
}

fn image_status_of(row: &Row, has_image: bool) -> rusqlite::Result<ImageStatus> {
    let raw: Option<String> = row.get("image_status")?;
    Ok(raw.as_deref().and_then(ImageStatus::parse).unwrap_or(if has_image { ImageStatus::Kept } else { ImageStatus::None }))
}

fn row_to_source(row: &Row) -> rusqlite::Result<StoredSource> {
    let has_image = row.get::<_, i64>("has_image")? == 1;
    Ok(StoredSource {
        id: row.get("id")?,
        kind: enum_col(row, "kind", SourceKind::parse)?,
        source_ref: row.get("ref")?,
        title: row.get("title")?,
        text: row.get("text")?,
        ocr_text: row.get::<_, Option<String>>("ocr_text")?.unwrap_or_default(),
        image_status: image_status_of(row, has_image)?,
        author_id: row.get("author_id")?,
        created_at: row.get("created_at")?,
        has_image,
        vectors: row_vectors(row)?,
    })
}

fn row_to_source_meta(row: &Row) -> rusqlite::Result<SourceMeta> {
    let has_image = row.get::<_, i64>("has_image")? == 1;
    Ok(SourceMeta {
        id: row.get("id")?,
        kind: enum_col(row, "kind", SourceKind::parse)?,
        source_ref: row.get("ref")?,
        title: row.get("title")?,
        image_status: image_status_of(row, has_image)?,
        author_id: row.get("author_id")?,
        created_at: row.get("created_at")?,
        has_image,
        vectors: row_vectors(row)?,
    })
}

fn row_to_node(row: &Row) -> rusqlite::Result<StoredNode> {
    let links: String = row.get("read_links")?;
    Ok(StoredNode {
        id: row.get("id")?,
        key: row.get("key")?,
        label: row.get("label")?,
        node_type: enum_col(row, "type", NodeType::parse)?,
        domain: enum_col(row, "domain", Domain::parse)?,
        summary: row.get("summary")?,
        todo: row.get("todo")?,
        read_links: serde_json::from_str(&links).unwrap_or_default(),
        owner: row.get("owner")?,
        status: enum_col(row, "status", Status::parse)?,
        sellable: row.get::<_, i64>("sellable")? == 1,
        source_kind: enum_col(row, "source_kind", SourceKind::parse)?,
        source_ref: row.get("source_ref")?,
        updated_at: row.get("updated_at")?,
        vectors: row_vectors(row)?,
    })
}

fn row_to_user(row: &Row) -> rusqlite::Result<StoredUser> {
    let ranked: Option<String> = row.get("ranked")?;
    Ok(StoredUser {
        id: row.get("id")?,
        name: row.get("name")?,
        role: row.get("role")?,
        team_description: row.get("team_description")?,
        seed_vec: vec_col(row, "seed_vec")?,
        seed_model: row.get("seed_model")?,
        user_vec: vec_col(row, "user_vec")?,
        ranked: ranked.and_then(|r| serde_json::from_str(&r).ok()),
        gravity: vec_col(row, "gravity")?,
        gravity_version: row.get("gravity_version")?,
    })
}

fn row_to_digest(row: &Row) -> rusqlite::Result<StoredDigest> {
    let members: String = row.get("members")?;
    Ok(StoredDigest {
        id: row.get("id")?,
        title: row.get("title")?,
        text: row.get("text")?,
        members: serde_json::from_str(&members).unwrap_or_default(),
        members_key: row.get("members_key")?,
        cluster_id: row.get("cluster_id")?,
        fidelity: row.get("fidelity")?,
        newest_at: row.get("newest_at")?,
        created_at: row.get("created_at")?,
        embedding: vec_col(row, "embedding")?,
        embed_model: row.get("embed_model")?,
    })
}

fn row_to_edge(row: &Row) -> rusqlite::Result<Edge> {
    Ok(Edge {
        id: row.get("id")?,
        source: row.get("source")?,
        target: row.get("target")?,
        relation: enum_col(row, "relation", Relation::parse)?,
        source_ref: row.get("source_ref")?,
    })
}

fn row_to_change(row: &Row) -> rusqlite::Result<SourceChange> {
    Ok(SourceChange {
        node_id: row.get("node_id")?,
        label: row.get("label")?,
        change: enum_col(row, "change", ChangeKind::parse)?,
        status_from: row.get::<_, Option<String>>("status_from")?.as_deref().and_then(Status::parse),
        status_to: enum_col(row, "status_to", Status::parse)?,
    })
}

fn merge_links(a: &[ReadLink], b: &[ReadLink]) -> Vec<ReadLink> {
    // Map semantics: a later duplicate replaces the value but keeps the first insertion position.
    let mut order: Vec<String> = vec![];
    let mut seen: HashMap<String, ReadLink> = HashMap::new();
    for link in a.iter().chain(b) {
        if link.url.is_empty() {
            continue;
        }
        if !seen.contains_key(&link.url) {
            order.push(link.url.clone());
        }
        seen.insert(link.url.clone(), link.clone());
    }
    order.into_iter().take(8).filter_map(|u| seen.remove(&u)).collect()
}

fn clean_node(n: &ExtractedNode) -> ExtractedNode {
    ExtractedNode {
        label: clamp(&n.label, LABEL_MAX),
        summary: clamp(&n.summary, SUMMARY_MAX),
        todo: n.todo.as_deref().filter(|t| !js_trim(t).is_empty()).map(|t| clamp(t, 200)),
        owner: n.owner.as_deref().map(js_trim).filter(|o| !o.is_empty()).map(String::from),
        read_links: n
            .read_links
            .iter()
            .filter(|l| l.url.starts_with("http://") || l.url.starts_with("https://"))
            .map(|l| ReadLink { title: clamp(if l.title.is_empty() { &l.url } else { &l.title }, 80), url: l.url.clone() })
            .collect(),
        ..n.clone()
    }
}

fn excerpt(text: &str) -> String {
    let flat = crate::text::plain_spaces(text);
    if js_len(&flat) > EXCERPT_MAX { format!("{}...", js_take(&flat, EXCERPT_MAX - 3)) } else { flat }
}

static NEXT_UID: AtomicU64 = AtomicU64::new(1);

type Memo<T> = RefCell<Option<(i64, Arc<Vec<T>>)>>;

/// The query surface over one org connection. Get one with `Store::db()` or inside `Store::transaction`.
pub struct Db {
    conn: Connection,
    memo_nodes: Memo<StoredNode>,
    memo_meta: Memo<SourceMeta>,
}

/// Memoized whole-org reads, for `Db::preserving`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoKey {
    Nodes,
    SourceMeta,
}

pub struct Store {
    inner: Mutex<Db>,
    path: PathBuf,
    uid: u64,
}

impl Store {
    /// Opens (creating directories as needed) and migrates. `":memory:"` opens a private in-memory db.
    pub fn open(file: impl AsRef<Path>) -> Result<Store> {
        let path = file.as_ref().to_path_buf();
        let conn = if path.as_os_str() == ":memory:" {
            Connection::open_in_memory()?
        } else {
            if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
            }
            Connection::open(&path).with_context(|| format!("opening {}", path.display()))?
        };
        let db = Db::init(conn)?;
        Ok(Store { inner: Mutex::new(db), path, uid: NEXT_UID.fetch_add(1, Ordering::Relaxed) })
    }

    pub fn memory() -> Result<Store> {
        Store::open(":memory:")
    }

    /// Locks the connection. Do not hold the guard across an `.await` (it is `!Send`, so the compiler stops you).
    pub fn db(&self) -> MutexGuard<'_, Db> {
        self.inner.lock()
    }

    /// Runs `f` atomically (a savepoint, so it nests).
    pub fn transaction<T>(&self, f: impl FnOnce(&Db) -> Result<T>) -> Result<T> {
        self.db().tx(f)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Unique per open handle: a key for per-store in-memory state (TS used `WeakMap<Store, ...>`).
    pub fn uid(&self) -> u64 {
        self.uid
    }
}

impl Db {
    fn init(conn: Connection) -> Result<Db> {
        // journal_mode returns a row, so read it rather than execute it.
        let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(SCHEMA)?;
        let db = Db { conn, memo_nodes: RefCell::new(None), memo_meta: RefCell::new(None) };
        db.add_columns("nodes", &[("z", "BLOB"), ("z_version", "TEXT"), ("embed_ctx", "TEXT"), ("cluster_id", "TEXT")])?;
        db.add_columns("users", &[("gravity", "BLOB"), ("gravity_version", "TEXT")])?;
        db.add_columns(
            "sources",
            &[
                ("embed_ctx", "TEXT"),
                ("cluster_id", "TEXT"),
                ("ocr_text", "TEXT"),
                ("image_status", "TEXT"),
                ("plain_vec", "BLOB"),
                ("plain_model", "TEXT"),
                ("plain_hash", "TEXT"),
            ],
        )?;
        Ok(db)
    }

    fn add_columns(&self, table: &str, cols: &[(&str, &str)]) -> Result<()> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let have: HashSet<String> = stmt.query_map([], |r| r.get::<_, String>("name"))?.collect::<rusqlite::Result<_>>()?;
        for (name, ty) in cols {
            if !have.contains(*name) {
                self.conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {ty}"))?;
            }
        }
        Ok(())
    }

    /// The raw connection, for queries this port has not wrapped.
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Runs `f` inside a savepoint: released on Ok, rolled back on Err.
    pub fn tx<T>(&self, f: impl FnOnce(&Db) -> Result<T>) -> Result<T> {
        self.conn.execute_batch("SAVEPOINT orion_tx")?;
        match f(self) {
            Ok(v) => {
                self.conn.execute_batch("RELEASE orion_tx")?;
                Ok(v)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK TO orion_tx; RELEASE orion_tx");
                Err(e)
            }
        }
    }

    fn total_changes(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT total_changes()", [], |r| r.get(0))?)
    }

    fn memoized<T>(&self, memo: &Memo<T>, load: impl FnOnce() -> Result<Vec<T>>) -> Result<Arc<Vec<T>>> {
        let at = self.total_changes()?;
        if let Some((hit_at, value)) = memo.borrow().as_ref() {
            if *hit_at == at {
                return Ok(value.clone());
            }
        }
        let value = Arc::new(load()?);
        *memo.borrow_mut() = Some((at, value.clone()));
        Ok(value)
    }

    /// Runs writes that cannot change the given memoized reads (for example per-user steering never touches
    /// nodes or sources) and keeps those reads valid across them.
    pub fn preserving<T>(&self, keys: &[MemoKey], f: impl FnOnce(&Db) -> Result<T>) -> Result<T> {
        let before = self.total_changes()?;
        let fresh = |memo_at: Option<i64>| memo_at == Some(before);
        let nodes_fresh = keys.contains(&MemoKey::Nodes) && fresh(self.memo_nodes.borrow().as_ref().map(|m| m.0));
        let meta_fresh = keys.contains(&MemoKey::SourceMeta) && fresh(self.memo_meta.borrow().as_ref().map(|m| m.0));
        let out = f(self)?;
        let after = self.total_changes()?;
        if nodes_fresh {
            if let Some(m) = self.memo_nodes.borrow_mut().as_mut() {
                m.0 = after;
            }
        }
        if meta_fresh {
            if let Some(m) = self.memo_meta.borrow_mut().as_mut() {
                m.0 = after;
            }
        }
        Ok(out)
    }

    // ---- Nodes ----

    /// Newest first. Memoized until the connection writes.
    pub fn list_nodes(&self) -> Result<Arc<Vec<StoredNode>>> {
        self.memoized(&self.memo_nodes, || {
            let mut stmt = self.conn.prepare_cached("SELECT * FROM nodes ORDER BY updated_at DESC")?;
            Ok(stmt.query_map([], row_to_node)?.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    pub fn get_node(&self, id: &str) -> Result<Option<StoredNode>> {
        Ok(self.conn.prepare_cached("SELECT * FROM nodes WHERE id = ?")?.query_row([id], row_to_node).optional()?)
    }

    pub fn find_node_by_key(&self, key: &str) -> Result<Option<StoredNode>> {
        Ok(self.conn.prepare_cached("SELECT * FROM nodes WHERE key = ?")?.query_row([key], row_to_node).optional()?)
    }

    /// Resolve an edge endpoint written as an id or a label of any type.
    pub fn resolve_node_ref(&self, r: &str) -> Result<Option<StoredNode>> {
        if let Some(n) = self.get_node(r)? {
            return Ok(Some(n));
        }
        if let Some(n) = self.get_node(&slugify(r))? {
            return Ok(Some(n));
        }
        Ok(self
            .conn
            .prepare_cached("SELECT * FROM nodes WHERE substr(key, instr(key, ':') + 1) = ? ORDER BY updated_at DESC LIMIT 1")?
            .query_row([normalize_label(r)], row_to_node)
            .optional()?)
    }

    pub fn save_node(&self, n: &StoredNode) -> Result<()> {
        self.conn
            .prepare_cached(
                "INSERT INTO nodes (id, key, label, type, domain, summary, todo, read_links, owner, status, sellable,
                   source_kind, source_ref, updated_at, embedding, embed_model, embed_ctx, z, z_version, cluster_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
                 ON CONFLICT(id) DO UPDATE SET
                   key = excluded.key, label = excluded.label, type = excluded.type, domain = excluded.domain,
                   summary = excluded.summary, todo = excluded.todo, read_links = excluded.read_links,
                   owner = excluded.owner, status = excluded.status, sellable = excluded.sellable,
                   source_kind = excluded.source_kind, source_ref = excluded.source_ref, updated_at = excluded.updated_at,
                   embedding = excluded.embedding, embed_model = excluded.embed_model, embed_ctx = excluded.embed_ctx,
                   z = excluded.z, z_version = excluded.z_version, cluster_id = excluded.cluster_id",
            )?
            .execute(params![
                n.id,
                n.key,
                n.label,
                n.node_type.as_str(),
                n.domain.as_str(),
                n.summary,
                n.todo,
                serde_json::to_string(&n.read_links)?,
                n.owner,
                n.status.as_str(),
                n.sellable as i64,
                n.source_kind.as_str(),
                n.source_ref,
                n.updated_at,
                blob_opt(&n.vectors.embedding),
                n.vectors.embed_model,
                n.vectors.embed_ctx,
                blob_opt(&n.vectors.z),
                n.vectors.z_version,
                n.vectors.cluster_id,
            ])?;
        Ok(())
    }

    /// A new 768d vector invalidates the org-space vector and cluster derived from it.
    pub fn set_node_embedding(&self, id: &str, vec: &[f32], model: &str, ctx: Option<&str>) -> Result<()> {
        self.conn
            .prepare_cached("UPDATE nodes SET embedding = ?, embed_model = ?, embed_ctx = ?, z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?")?
            .execute(params![to_blob(vec), model, ctx, id])?;
        Ok(())
    }

    pub fn set_node_z(&self, id: &str, z: &[f32], version: &str) -> Result<()> {
        self.conn.prepare_cached("UPDATE nodes SET z = ?, z_version = ? WHERE id = ?")?.execute(params![to_blob(z), version, id])?;
        Ok(())
    }

    pub fn set_cluster_of(&self, kind: ItemKind, id: &str, cluster_id: Option<&str>) -> Result<()> {
        let table = if kind == ItemKind::Node { "nodes" } else { "sources" };
        self.conn.prepare_cached(&format!("UPDATE {table} SET cluster_id = ? WHERE id = ?"))?.execute(params![cluster_id, id])?;
        Ok(())
    }

    // ---- Compressors ----

    pub fn active_compressor(&self) -> Result<Option<StoredCompressor>> {
        self.compressor_where("active = 1")
    }

    /// Most recent training attempt, adopted or not.
    pub fn latest_compressor(&self) -> Result<Option<StoredCompressor>> {
        self.compressor_where("1 = 1")
    }

    fn compressor_where(&self, cond: &str) -> Result<Option<StoredCompressor>> {
        let sql = format!("SELECT * FROM compressors WHERE {cond} ORDER BY created_at DESC, rowid DESC LIMIT 1");
        Ok(self
            .conn
            .prepare_cached(&sql)?
            .query_row([], |r| {
                let metrics: Option<String> = r.get("metrics")?;
                Ok(StoredCompressor {
                    id: r.get("id")?,
                    kind: enum_col(r, "kind", CompressorKind::parse)?,
                    weights: from_blob(&r.get::<_, Vec<u8>>("weights")?),
                    metrics: metrics.and_then(|m| serde_json::from_str(&m).ok()).unwrap_or(Value::Null),
                    created_at: r.get("created_at")?,
                })
            })
            .optional()?)
    }

    /// Stores a compressor (`created_at` is set now); when `activate` it becomes the only active one.
    pub fn save_compressor(&self, c: &StoredCompressor, activate: bool) -> Result<()> {
        self.tx(|db| {
            if activate {
                db.conn.execute_batch("UPDATE compressors SET active = 0")?;
            }
            db.conn
                .prepare_cached("INSERT OR REPLACE INTO compressors (id, kind, weights, metrics, active, created_at) VALUES (?, ?, ?, ?, ?, ?)")?
                .execute(params![c.id, c.kind.as_str(), to_blob(&c.weights), serde_json::to_string(&c.metrics)?, activate as i64, now_iso()])?;
            Ok(())
        })
    }

    fn unique_id(&self, label: &str, t: NodeType) -> Result<String> {
        let base = slugify(label);
        let taken = |id: &str| -> Result<bool> {
            Ok(self.conn.prepare_cached("SELECT 1 FROM nodes WHERE id = ?")?.query_row([id], |_| Ok(())).optional()?.is_some())
        };
        if !taken(&base)? {
            return Ok(base);
        }
        let typed = format!("{base}-{}", t.as_str());
        if !taken(&typed)? {
            return Ok(typed);
        }
        let mut i = 2;
        loop {
            let id = format!("{typed}-{i}");
            if !taken(&id)? {
                return Ok(id);
            }
            i += 1;
        }
    }

    /// Upsert by `type:normalizedLabel`. Newer non-null fields win; `unknown` status never overwrites a known
    /// one. Edges are written only when both endpoints resolve. Embeddings are cleared when label or summary
    /// change so the caller re-embeds them.
    pub fn upsert_graph(&self, update: &GraphUpdate, prov: &Provenance) -> Result<UpsertResult> {
        let now = prov.now.clone().unwrap_or_else(now_iso);
        self.tx(|db| {
            let mut out = UpsertResult::default();
            let mut local: HashMap<String, String> = HashMap::new();
            for raw in &update.nodes {
                let incoming = clean_node(raw);
                if incoming.label.is_empty() {
                    continue;
                }
                let key = node_key(incoming.node_type, &incoming.label);
                let existing = db.find_node_by_key(&key)?;
                let node = match &existing {
                    Some(e) => {
                        let summary = if incoming.summary.is_empty() { e.summary.clone() } else { incoming.summary.clone() };
                        let text_changed = e.label != incoming.label || e.summary != summary;
                        StoredNode {
                            label: incoming.label.clone(),
                            domain: incoming.domain,
                            summary,
                            todo: incoming.todo.clone().or_else(|| e.todo.clone()),
                            read_links: merge_links(&e.read_links, &incoming.read_links),
                            owner: incoming.owner.clone().or_else(|| e.owner.clone()),
                            status: if incoming.status != Status::Unknown { incoming.status } else { e.status },
                            sellable: incoming.sellable.unwrap_or(e.sellable),
                            source_kind: prov.source_kind,
                            source_ref: prov.source_ref.clone(),
                            updated_at: now.clone(),
                            vectors: if text_changed { Vectors::default() } else { e.vectors.clone() },
                            ..e.clone()
                        }
                    }
                    None => StoredNode {
                        id: db.unique_id(&incoming.label, incoming.node_type)?,
                        key: key.clone(),
                        label: incoming.label.clone(),
                        node_type: incoming.node_type,
                        domain: incoming.domain,
                        summary: incoming.summary.clone(),
                        todo: incoming.todo.clone(),
                        read_links: incoming.read_links.clone(),
                        owner: incoming.owner.clone(),
                        status: incoming.status,
                        sellable: incoming.sellable.unwrap_or(false),
                        source_kind: prov.source_kind,
                        source_ref: prov.source_ref.clone(),
                        updated_at: now.clone(),
                        vectors: Vectors::default(),
                    },
                };
                db.save_node(&node)?;
                local.insert(normalize_label(&raw.label), node.id.clone());
                local.insert(normalize_label(&node.label), node.id.clone());
                if !out.touched.contains(&node.id) {
                    out.touched.push(node.id.clone());
                    out.changes.push(NodeChange {
                        node_id: node.id.clone(),
                        change: if existing.is_some() { ChangeKind::Updated } else { ChangeKind::Created },
                        status_from: existing.as_ref().map(|e| e.status),
                        status_to: node.status,
                    });
                }
            }
            let resolve = |r: &str| -> Result<Option<String>> {
                if let Some(id) = local.get(&normalize_label(r)) {
                    return Ok(Some(id.clone()));
                }
                Ok(db.resolve_node_ref(r)?.map(|n| n.id))
            };
            for e in &update.edges {
                let (Some(source), Some(target)) = (resolve(&e.source)?, resolve(&e.target)?) else { continue };
                if source == target {
                    continue;
                }
                let edge = Edge { id: edge_id(&source, e.relation, &target), source, target, relation: e.relation, source_ref: prov.source_ref.clone() };
                if db.add_edge(&edge)? {
                    out.edges_added.push(edge.id);
                }
            }
            Ok(out)
        })
    }

    // ---- Sources ----

    pub fn save_source(&self, s: &NewSource, changes: &[NodeChange]) -> Result<()> {
        self.tx(|db| {
            let status = s.image_status.unwrap_or(if s.image.is_some() { ImageStatus::Kept } else { ImageStatus::None });
            db.conn
                .prepare_cached(
                    "INSERT OR REPLACE INTO sources (id, kind, ref, title, text, ocr_text, image_status, author_id, image, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )?
                .execute(params![
                    s.id,
                    s.kind.as_str(),
                    s.source_ref,
                    s.title,
                    js_take(&s.text, SOURCE_TEXT_MAX),
                    js_take(s.ocr_text.as_deref().unwrap_or(""), SOURCE_TEXT_MAX),
                    status.as_str(),
                    s.author_id,
                    s.image,
                    s.created_at,
                ])?;
            let mut stmt = db
                .conn
                .prepare_cached("INSERT OR REPLACE INTO source_changes (source_id, node_id, change, status_from, status_to) VALUES (?, ?, ?, ?, ?)")?;
            for c in changes {
                stmt.execute(params![s.id, c.node_id, c.change.as_str(), c.status_from.map(Status::as_str), c.status_to.as_str()])?;
            }
            Ok(())
        })
    }

    pub fn get_source(&self, id: &str) -> Result<Option<StoredSource>> {
        Ok(self.conn.prepare_cached(&format!("SELECT {SOURCE_COLS} FROM sources WHERE id = ?"))?.query_row([id], row_to_source).optional()?)
    }

    /// The newest source of this kind and ref by this author, if any.
    pub fn last_source_by(&self, kind: SourceKind, source_ref: &str, author_id: &str) -> Result<Option<StoredSource>> {
        Ok(self
            .conn
            .prepare_cached(&format!(
                "SELECT {SOURCE_COLS} FROM sources WHERE ref = ? AND kind = ? AND author_id = ? ORDER BY created_at DESC LIMIT 1"
            ))?
            .query_row(params![source_ref, kind.as_str(), author_id], row_to_source)
            .optional()?)
    }

    /// Newest first. `since` is an ISO timestamp; `limit` -1 means all.
    pub fn list_sources(&self, since: Option<&str>, limit: i64) -> Result<Vec<StoredSource>> {
        let rows = match since {
            Some(since) => self
                .conn
                .prepare_cached(&format!("SELECT {SOURCE_COLS} FROM sources WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?"))?
                .query_map(params![since, limit], row_to_source)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => self
                .conn
                .prepare_cached(&format!("SELECT {SOURCE_COLS} FROM sources ORDER BY created_at DESC LIMIT ?"))?
                .query_map([limit], row_to_source)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(rows)
    }

    /// Every source without its text, newest first. Memoized until the connection writes.
    pub fn list_source_meta(&self) -> Result<Arc<Vec<SourceMeta>>> {
        self.memoized(&self.memo_meta, || {
            let mut stmt = self.conn.prepare_cached(&format!("SELECT {SOURCE_META_COLS} FROM sources ORDER BY created_at DESC"))?;
            Ok(stmt.query_map([], row_to_source_meta)?.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    /// Full sources by id, in the order given; missing ids are skipped.
    pub fn get_sources(&self, ids: &[String]) -> Result<Vec<StoredSource>> {
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(s) = self.get_source(id)? {
                out.push(s);
            }
        }
        Ok(out)
    }

    /// Cached plain-text vectors (title + body, no screenshot, no role) used to group similar sources into digests.
    pub fn plain_vectors(&self) -> Result<HashMap<String, PlainVector>> {
        let mut stmt = self.conn.prepare_cached("SELECT id, plain_vec, plain_model, plain_hash FROM sources WHERE plain_vec IS NOT NULL")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                PlainVector {
                    vec: from_blob(&r.get::<_, Vec<u8>>(1)?),
                    model: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    hash: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                },
            ))
        })?;
        Ok(rows.collect::<rusqlite::Result<HashMap<_, _>>>()?)
    }

    pub fn set_plain_vectors(&self, items: &[(String, PlainVector)]) -> Result<()> {
        self.tx(|db| {
            let mut stmt = db.conn.prepare_cached("UPDATE sources SET plain_vec = ?, plain_model = ?, plain_hash = ? WHERE id = ?")?;
            for (id, p) in items {
                stmt.execute(params![to_blob(&p.vec), p.model, p.hash, id])?;
            }
            Ok(())
        })
    }

    /// Who wrote what since `since`, without loading documents: one row per source, newest first.
    pub fn source_authors_since(&self, since: &str) -> Result<Vec<AuthorAt>> {
        let mut stmt = self.conn.prepare_cached("SELECT author_id, created_at FROM sources WHERE created_at >= ? ORDER BY created_at DESC")?;
        let rows = stmt.query_map([since], |r| Ok(AuthorAt { author_id: r.get(0)?, created_at: r.get(1)? }))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn counts(&self) -> Result<Counts> {
        Ok(self.conn.query_row(
            "SELECT (SELECT COUNT(*) FROM nodes), (SELECT COUNT(*) FROM edges), (SELECT COUNT(*) FROM sources)",
            [],
            |r| Ok(Counts { nodes: r.get(0)?, edges: r.get(1)?, sources: r.get(2)? }),
        )?)
    }

    /// Changes whenever an item, its embedding, its cluster, or the edges change. Cheap cache key for projections.
    pub fn embedding_stamp(&self) -> Result<String> {
        Ok(self.conn.query_row(
            "SELECT (SELECT COUNT(*) || ':' || COUNT(embedding) || ':' || COUNT(z) || ':' || COUNT(cluster_id) || ':' || IFNULL(MAX(updated_at), '') FROM nodes),
                    (SELECT COUNT(*) || ':' || COUNT(embedding) || ':' || COUNT(z) || ':' || COUNT(cluster_id) || ':' || IFNULL(MAX(created_at), '') FROM sources),
                    (SELECT COUNT(*) FROM edges),
                    (SELECT COUNT(*) || ':' || IFNULL(MAX(version), '') FROM clusters)",
            [],
            |r| Ok(format!("{}|{}|{}|{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?)),
        )?)
    }

    pub fn source_image(&self, id: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .conn
            .prepare_cached("SELECT image FROM sources WHERE id = ?")?
            .query_row([id], |r| r.get::<_, Option<Vec<u8>>>(0))
            .optional()?
            .flatten())
    }

    pub fn source_changes(&self, source_id: &str) -> Result<Vec<SourceChange>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT c.node_id, n.label, c.change, c.status_from, c.status_to FROM source_changes c
             JOIN nodes n ON n.id = c.node_id WHERE c.source_id = ?",
        )?;
        Ok(stmt.query_map([source_id], row_to_change)?.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Every source's changes in one query, keyed by source id.
    pub fn changes_by_source(&self) -> Result<HashMap<String, Vec<SourceChange>>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT c.source_id, c.node_id, n.label, c.change, c.status_from, c.status_to FROM source_changes c
             JOIN nodes n ON n.id = c.node_id",
        )?;
        let mut out: HashMap<String, Vec<SourceChange>> = HashMap::new();
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>("source_id")?, row_to_change(r)?)))?;
        for row in rows {
            let (sid, c) = row?;
            out.entry(sid).or_default().push(c);
        }
        Ok(out)
    }

    /// Source ids behind a node, newest first.
    pub fn source_ids_for_node(&self, node_id: &str, limit: i64) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT s.id FROM source_changes c JOIN sources s ON s.id = c.source_id
             WHERE c.node_id = ? ORDER BY s.created_at DESC LIMIT ?",
        )?;
        Ok(stmt.query_map(params![node_id, limit], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?)
    }

    /// A new 768d vector invalidates the org-space vector and cluster derived from it.
    pub fn set_source_embedding(&self, id: &str, vec: &[f32], model: &str, ctx: Option<&str>) -> Result<()> {
        self.conn
            .prepare_cached("UPDATE sources SET embedding = ?, embed_model = ?, embed_ctx = ?, z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?")?
            .execute(params![to_blob(vec), model, ctx, id])?;
        Ok(())
    }

    /// Swaps in a processed screenshot and clears the vectors so it re-embeds.
    pub fn replace_source_image(&self, id: &str, image: &[u8], status: ImageStatus) -> Result<()> {
        self.conn
            .prepare_cached(
                "UPDATE sources SET image = ?, image_status = ?, embedding = NULL, embed_model = NULL, embed_ctx = NULL,
                   z = NULL, z_version = NULL, cluster_id = NULL WHERE id = ?",
            )?
            .execute(params![image, status.as_str(), id])?;
        Ok(())
    }

    pub fn set_source_z(&self, id: &str, z: &[f32], version: &str) -> Result<()> {
        self.conn.prepare_cached("UPDATE sources SET z = ?, z_version = ? WHERE id = ?")?.execute(params![to_blob(z), version, id])?;
        Ok(())
    }

    pub fn to_public_source(&self, s: &StoredSource) -> Result<Source> {
        let author = match &s.author_id {
            Some(a) => self.get_user(a)?,
            None => None,
        };
        Ok(Source {
            id: s.id.clone(),
            kind: s.kind.into(),
            source_ref: s.source_ref.clone(),
            title: s.title.clone(),
            excerpt: excerpt(&s.text),
            author_id: s.author_id.clone(),
            author_name: author.map(|u| u.name),
            created_at: s.created_at.clone(),
            has_image: s.has_image,
            changes: self.source_changes(&s.id)?,
            members: None,
        })
    }

    // ---- Facets, clusters, digests, summaries ----

    pub fn list_facets(&self) -> Result<Vec<Facet>> {
        let mut stmt = self.conn.prepare_cached("SELECT item_kind, item_id, area, use, text_hash FROM facets")?;
        let rows = stmt.query_map([], |r| {
            Ok(Facet {
                item_kind: enum_col(r, "item_kind", ItemKind::parse)?,
                item_id: r.get("item_id")?,
                area: r.get("area")?,
                use_: r.get("use")?,
                text_hash: r.get("text_hash")?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn save_facets(&self, facets: &[Facet]) -> Result<()> {
        let now = now_iso();
        self.tx(|db| {
            let mut stmt =
                db.conn.prepare_cached("INSERT OR REPLACE INTO facets (item_kind, item_id, area, use, text_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")?;
            for f in facets {
                stmt.execute(params![f.item_kind.as_str(), f.item_id, f.area, f.use_, f.text_hash, now])?;
            }
            Ok(())
        })
    }

    /// Clusters whose centroids live in the space of compressor `version`, biggest first.
    pub fn list_clusters(&self, version: Option<&str>) -> Result<Vec<StoredCluster>> {
        let map = |r: &Row| {
            Ok(StoredCluster {
                id: r.get("id")?,
                label: r.get("label")?,
                centroid: from_blob(&r.get::<_, Vec<u8>>("centroid")?),
                size: r.get("size")?,
                version: r.get("version")?,
            })
        };
        let rows = match version {
            Some(v) => self
                .conn
                .prepare_cached("SELECT * FROM clusters WHERE version = ? ORDER BY size DESC, label")?
                .query_map([v], map)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => self.conn.prepare_cached("SELECT * FROM clusters ORDER BY size DESC, label")?.query_map([], map)?.collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(rows)
    }

    /// Replaces every cluster and every item's assignment in one transaction.
    pub fn replace_clusters(&self, clusters: &[StoredCluster], assign: &[ClusterAssignment]) -> Result<()> {
        self.tx(|db| {
            db.conn.execute_batch("DELETE FROM clusters; UPDATE nodes SET cluster_id = NULL; UPDATE sources SET cluster_id = NULL;")?;
            let mut stmt = db.conn.prepare_cached("INSERT INTO clusters (id, label, centroid, size, version) VALUES (?, ?, ?, ?, ?)")?;
            for c in clusters {
                stmt.execute(params![c.id, c.label, to_blob(&c.centroid), c.size, c.version])?;
            }
            for a in assign {
                db.set_cluster_of(a.kind, &a.id, a.cluster_id.as_deref())?;
            }
            Ok(())
        })
    }

    pub fn list_digests(&self) -> Result<Vec<StoredDigest>> {
        let mut stmt = self.conn.prepare_cached("SELECT * FROM digests ORDER BY newest_at DESC")?;
        Ok(stmt.query_map([], row_to_digest)?.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_digest(&self, id: &str) -> Result<Option<StoredDigest>> {
        Ok(self.conn.prepare_cached("SELECT * FROM digests WHERE id = ?")?.query_row([id], row_to_digest).optional()?)
    }

    pub fn save_digest(&self, d: &StoredDigest) -> Result<()> {
        self.conn
            .prepare_cached(
                "INSERT OR REPLACE INTO digests (id, title, text, members, members_key, cluster_id, fidelity, newest_at, created_at,
                   embedding, embed_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?
            .execute(params![
                d.id,
                d.title,
                d.text,
                serde_json::to_string(&d.members)?,
                d.members_key,
                d.cluster_id,
                d.fidelity,
                d.newest_at,
                d.created_at,
                blob_opt(&d.embedding),
                d.embed_model,
            ])?;
        Ok(())
    }

    pub fn delete_digests(&self, ids: &[String]) -> Result<()> {
        self.tx(|db| {
            let mut stmt = db.conn.prepare_cached("DELETE FROM digests WHERE id = ?")?;
            for id in ids {
                stmt.execute([id])?;
            }
            Ok(())
        })
    }

    pub fn get_summary(&self, source_id: &str) -> Result<Option<StoredSummary>> {
        Ok(self
            .conn
            .prepare_cached("SELECT * FROM summaries WHERE source_id = ?")?
            .query_row([source_id], |r| {
                Ok(StoredSummary { source_id: r.get("source_id")?, text: r.get("text")?, text_hash: r.get("text_hash")?, fidelity: r.get("fidelity")? })
            })
            .optional()?)
    }

    pub fn save_summary(&self, s: &StoredSummary) -> Result<()> {
        self.conn
            .prepare_cached("INSERT OR REPLACE INTO summaries (source_id, text, text_hash, fidelity) VALUES (?, ?, ?, ?)")?
            .execute(params![s.source_id, s.text, s.text_hash, s.fidelity])?;
        Ok(())
    }

    /// Full text of a document or digest by id. `ocr_text` is what was read off a kept screenshot.
    pub fn read_document(&self, id: &str) -> Result<Option<SourceResponse>> {
        if let Some(s) = self.get_source(id)? {
            return Ok(Some(SourceResponse { source: self.to_public_source(&s)?, text: s.text, ocr_text: s.ocr_text, image_status: s.image_status }));
        }
        Ok(match self.get_digest(id)? {
            Some(d) => Some(SourceResponse { source: self.to_public_digest(&d)?, text: d.text, ocr_text: String::new(), image_status: ImageStatus::None }),
            None => None,
        })
    }

    /// A digest in the same public shape as a source, with the documents it merges.
    pub fn to_public_digest(&self, d: &StoredDigest) -> Result<Source> {
        let mut members = vec![];
        for id in &d.members {
            let Some(s) = self.get_source(id)? else { continue };
            let author = match &s.author_id {
                Some(a) => self.get_user(a)?,
                None => None,
            };
            members.push(SourceMember { id: s.id, title: s.title, source_ref: s.source_ref, author_name: author.map(|u| u.name), created_at: s.created_at });
        }
        let mut names: Vec<String> = vec![];
        for m in &members {
            if let Some(n) = &m.author_name {
                if !names.contains(n) {
                    names.push(n.clone());
                }
            }
        }
        // Map by node id: the last change for a node wins, at the node's first position.
        let mut order: Vec<String> = vec![];
        let mut by_node: HashMap<String, SourceChange> = HashMap::new();
        for id in &d.members {
            for c in self.source_changes(id)? {
                if !by_node.contains_key(&c.node_id) {
                    order.push(c.node_id.clone());
                }
                by_node.insert(c.node_id.clone(), c);
            }
        }
        Ok(Source {
            id: d.id.clone(),
            kind: PublicSourceKind::Digest,
            source_ref: members.iter().map(|m| m.source_ref.as_str()).collect::<Vec<_>>().join(" "),
            title: d.title.clone(),
            excerpt: excerpt(&d.text),
            author_id: None,
            author_name: (!names.is_empty()).then(|| names.join(", ")),
            created_at: d.newest_at.clone(),
            has_image: false,
            changes: order.into_iter().filter_map(|n| by_node.remove(&n)).collect(),
            members: Some(members),
        })
    }

    // ---- Edges ----

    pub fn list_edges(&self) -> Result<Vec<Edge>> {
        let mut stmt = self.conn.prepare_cached("SELECT * FROM edges")?;
        Ok(stmt.query_map([], row_to_edge)?.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Returns false when an endpoint is missing or the edge already exists.
    pub fn add_edge(&self, e: &Edge) -> Result<bool> {
        if self.get_node(&e.source)?.is_none() || self.get_node(&e.target)?.is_none() {
            return Ok(false);
        }
        let n = self
            .conn
            .prepare_cached("INSERT OR IGNORE INTO edges (id, source, target, relation, source_ref) VALUES (?, ?, ?, ?, ?)")?
            .execute(params![e.id, e.source, e.target, e.relation.as_str(), e.source_ref])?;
        Ok(n > 0)
    }

    // ---- Org profile: one row per org file ----

    pub fn get_org(&self) -> Result<Option<Org>> {
        Ok(self
            .conn
            .prepare_cached("SELECT * FROM org LIMIT 1")?
            .query_row([], |r| {
                let websites: String = r.get("websites")?;
                Ok(Org {
                    id: r.get("id")?,
                    name: r.get("name")?,
                    description: r.get("description")?,
                    websites: serde_json::from_str(&websites).unwrap_or_default(),
                    context: r.get("context")?,
                    created_at: r.get("created_at")?,
                })
            })
            .optional()?)
    }

    pub fn save_org(&self, o: &Org) -> Result<()> {
        self.tx(|db| {
            db.conn.prepare_cached("DELETE FROM org WHERE id <> ?")?.execute([&o.id])?;
            db.conn
                .prepare_cached(
                    "INSERT INTO org (id, name, description, websites, context, created_at) VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
                       websites = excluded.websites, context = excluded.context",
                )?
                .execute(params![o.id, o.name, o.description, serde_json::to_string(&o.websites)?, o.context, o.created_at])?;
            Ok(())
        })
    }

    // ---- Users ----

    pub fn list_users(&self) -> Result<Vec<StoredUser>> {
        let mut stmt = self.conn.prepare_cached("SELECT * FROM users ORDER BY id")?;
        Ok(stmt.query_map([], row_to_user)?.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_user(&self, id: &str) -> Result<Option<StoredUser>> {
        Ok(self.conn.prepare_cached("SELECT * FROM users WHERE id = ?")?.query_row([id], row_to_user).optional()?)
    }

    pub fn save_user(&self, u: &User) -> Result<()> {
        self.conn
            .prepare_cached(
                "INSERT INTO users (id, name, role, team_description) VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role,
                   team_description = excluded.team_description, seed_vec = NULL, seed_model = NULL",
            )?
            .execute(params![u.id, u.name, u.role, u.team_description])?;
        Ok(())
    }

    pub fn set_user_seed(&self, id: &str, vec: &[f32], model: &str) -> Result<()> {
        self.conn.prepare_cached("UPDATE users SET seed_vec = ?, seed_model = ? WHERE id = ?")?.execute(params![to_blob(vec), model, id])?;
        Ok(())
    }

    pub fn set_user_steering(&self, id: &str, s: &UserSteering) -> Result<()> {
        self.conn
            .prepare_cached("UPDATE users SET user_vec = ?, gravity = ?, gravity_version = ?, ranked = ? WHERE id = ?")?
            .execute(params![blob_opt(&s.user_vec), blob_opt(&s.gravity), s.gravity_version, serde_json::to_string(&s.ranked)?, id])?;
        Ok(())
    }

    pub fn add_touches(&self, user_id: &str, node_ids: &[String]) -> Result<()> {
        self.tx(|db| {
            let mut stmt = db.conn.prepare_cached("INSERT OR IGNORE INTO touches (user_id, node_id) VALUES (?, ?)")?;
            for id in node_ids {
                stmt.execute(params![user_id, id])?;
            }
            Ok(())
        })
    }

    pub fn touched_node_ids(&self, user_id: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare_cached("SELECT node_id FROM touches WHERE user_id = ?")?;
        Ok(stmt.query_map([user_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?)
    }

    // ---- Dashboards: one per person, stored as the spec JSON ----

    pub fn get_dashboard(&self, user_id: &str) -> Result<Option<DashboardSpec>> {
        let spec: Option<String> =
            self.conn.prepare_cached("SELECT spec FROM dashboards WHERE user_id = ?")?.query_row([user_id], |r| r.get(0)).optional()?;
        let Some(spec) = spec else { return Ok(None) };
        let v: Value = serde_json::from_str(&spec)?;
        // Saved specs went through the schema on the way in; parse leniently in case an old shape is on disk.
        Ok(Some(match serde_json::from_value::<DashboardSpec>(v.clone()) {
            Ok(d) => d,
            Err(_) => crate::contract::schemas::dashboard_spec(&v, &[]).map_err(|e| anyhow::anyhow!("stored dashboard: {e}"))?,
        }))
    }

    pub fn save_dashboard(&self, user_id: &str, spec: &DashboardSpec) -> Result<()> {
        self.conn
            .prepare_cached(
                "INSERT INTO dashboards (user_id, spec, origin, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET spec = excluded.spec, origin = excluded.origin, updated_at = excluded.updated_at",
            )?
            .execute(params![user_id, serde_json::to_string(spec)?, spec.origin.as_str(), spec.updated_at])?;
        Ok(())
    }

    pub fn delete_dashboard(&self, user_id: &str) -> Result<()> {
        self.conn.prepare_cached("DELETE FROM dashboards WHERE user_id = ?")?.execute([user_id])?;
        Ok(())
    }

    pub fn reset(&self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM dashboards; DELETE FROM summaries; DELETE FROM digests; DELETE FROM clusters; DELETE FROM facets; DELETE FROM source_changes;
             DELETE FROM sources; DELETE FROM touches; DELETE FROM edges; DELETE FROM nodes; DELETE FROM users; DELETE FROM compressors;",
        )?;
        Ok(())
    }
}

use crate::contract::types::str_enum;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::view::read_graph;
    use crate::testing::{extracted, memory_store};

    fn prov(r: &str) -> Provenance {
        Provenance { source_kind: SourceKind::Extension, source_ref: r.into(), now: None }
    }

    fn update(nodes: Vec<ExtractedNode>) -> GraphUpdate {
        GraphUpdate { nodes, edges: vec![] }
    }

    #[test]
    fn dedupes_by_type_and_normalized_label_newer_non_null_fields_win() {
        let store = memory_store(false);
        let db = store.db();
        db.upsert_graph(
            &update(vec![ExtractedNode { node_type: NodeType::Campaign, owner: Some("Mina Rao".into()), ..extracted("Q4 Search Campaign") }]),
            &prov("https://example.com/a"),
        )
        .unwrap();
        let r = db
            .upsert_graph(
                &update(vec![ExtractedNode {
                    node_type: NodeType::Campaign,
                    owner: None,
                    status: Status::Unknown,
                    todo: Some("Raise budget".into()),
                    ..extracted("q4 search-campaign")
                }]),
                &prov("https://example.com/b"),
            )
            .unwrap();
        let nodes = db.list_nodes().unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(r.touched, vec![nodes[0].id.clone()]);
        let n = &nodes[0];
        assert_eq!(n.id, "q4-search-campaign");
        assert_eq!(n.owner.as_deref(), Some("Mina Rao"));
        assert_eq!(n.status, Status::OnTrack);
        assert_eq!(n.todo.as_deref(), Some("Raise budget"));
        assert_eq!(n.source_ref, "https://example.com/b");
    }

    #[test]
    fn keeps_same_label_with_different_types_apart() {
        let store = memory_store(false);
        let db = store.db();
        db.upsert_graph(
            &update(vec![extracted("Voice mode"), ExtractedNode { node_type: NodeType::Milestone, ..extracted("Voice mode") }]),
            &prov("https://example.com/a"),
        )
        .unwrap();
        let mut ids: Vec<String> = db.list_nodes().unwrap().iter().map(|n| n.id.clone()).collect();
        ids.sort();
        assert_eq!(ids, vec!["voice-mode", "voice-mode-milestone"]);
        assert_eq!(db.find_node_by_key(&node_key(NodeType::Milestone, "voice mode")).unwrap().unwrap().id, "voice-mode-milestone");
    }

    #[test]
    fn clears_the_embedding_only_when_label_or_summary_change() {
        let store = memory_store(false);
        let db = store.db();
        let p = prov("https://example.com/a");
        db.upsert_graph(&update(vec![extracted("SSO login")]), &p).unwrap();
        db.set_node_embedding("sso-login", &[1.0, 0.0], "m", None).unwrap();
        db.upsert_graph(&update(vec![ExtractedNode { owner: Some("Devon Park".into()), ..extracted("SSO login") }]), &p).unwrap();
        assert!(db.get_node("sso-login").unwrap().unwrap().vectors.embedding.is_some());
        db.upsert_graph(&update(vec![ExtractedNode { summary: "Now with Okta".into(), ..extracted("SSO login") }]), &p).unwrap();
        assert!(db.get_node("sso-login").unwrap().unwrap().vectors.embedding.is_none());
    }

    #[test]
    fn only_sets_sellable_when_the_update_decides_it() {
        let store = memory_store(false);
        let db = store.db();
        let p = prov("https://example.com/a");
        db.upsert_graph(&update(vec![ExtractedNode { sellable: Some(true), ..extracted("Voice mode") }]), &p).unwrap();
        db.upsert_graph(&update(vec![ExtractedNode { sellable: None, ..extracted("Voice mode") }]), &p).unwrap();
        assert!(db.get_node("voice-mode").unwrap().unwrap().sellable);
    }

    #[test]
    fn clamps_labels_and_summaries_to_the_contract_limits() {
        let store = memory_store(false);
        let db = store.db();
        let long = "A very long feature name that keeps going past forty characters";
        db.upsert_graph(&update(vec![ExtractedNode { summary: "word ".repeat(60), ..extracted(long) }]), &prov("x")).unwrap();
        let nodes = db.list_nodes().unwrap();
        assert!(js_len(&nodes[0].label) <= 40);
        assert!(js_len(&nodes[0].summary) <= 140);
    }

    #[test]
    fn writes_edges_only_when_both_endpoints_exist_by_label_or_id() {
        let store = memory_store(false);
        let db = store.db();
        let p = prov("https://example.com/a");
        db.upsert_graph(&update(vec![extracted("Audio streaming service")]), &p).unwrap();
        let edge = |s: &str, t: &str, r| ExtractedEdge { source: s.into(), target: t.into(), relation: r };
        let r = db
            .upsert_graph(
                &GraphUpdate {
                    nodes: vec![ExtractedNode { node_type: NodeType::Task, ..extracted("Voice latency fix") }],
                    edges: vec![
                        edge("Audio streaming service", "Voice latency fix", Relation::Blocks),
                        edge("voice-latency-fix", "Nonexistent thing", Relation::Feeds),
                        edge("Audio streaming service", "Voice latency fix", Relation::Blocks),
                    ],
                },
                &p,
            )
            .unwrap();
        assert_eq!(r.edges_added, vec!["audio-streaming-service__blocks__voice-latency-fix"]);
        assert_eq!(db.list_edges().unwrap().len(), 1);
    }

    #[test]
    fn never_exposes_embeddings() {
        let store = memory_store(true);
        let db = store.db();
        for n in db.list_nodes().unwrap().iter() {
            db.set_node_embedding(&n.id, &[1.0], "m", None).unwrap();
        }
        let graph = serde_json::to_value(read_graph(&db).unwrap()).unwrap();
        for n in graph["nodes"].as_array().unwrap() {
            assert!(n.get("embedding").is_none() && n.get("key").is_none());
        }
        let public = serde_json::to_value(to_public_node(&db.list_nodes().unwrap()[0])).unwrap();
        assert!(public.get("embedding").is_none());
    }

    // Port of "is stored once per org file and can be updated" from src/contract/org.test.ts.
    #[test]
    fn org_profile_is_stored_once_and_updated() {
        let store = memory_store(false);
        let db = store.db();
        assert!(db.get_org().unwrap().is_none());
        let org = Org {
            id: "lumen".into(),
            name: "Lumen".into(),
            description: "We make a budgeting app for small restaurants.".into(),
            websites: vec!["github.com".into(), "lumen.atlassian.net".into()],
            context: "Our main customer is Tasty Bowl.".into(),
            created_at: "2026-10-10T12:00:00.000Z".into(),
        };
        db.save_org(&org).unwrap();
        let updated = Org { description: "We make a budgeting app for small restaurants and cafes.".into(), ..org };
        db.save_org(&updated).unwrap();
        assert_eq!(db.get_org().unwrap().unwrap(), updated);
    }

    #[test]
    fn memoized_reads_follow_writes_and_preserving() {
        let store = memory_store(true);
        let db = store.db();
        let a = db.list_nodes().unwrap();
        let b = db.list_nodes().unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        db.preserving(&[MemoKey::Nodes], |db| {
            db.set_user_steering("priya", &UserSteering { user_vec: None, gravity: None, gravity_version: None, ranked: vec![] })
        })
        .unwrap();
        assert!(Arc::ptr_eq(&a, &db.list_nodes().unwrap()));
        db.set_node_embedding("voice-mode", &[1.0], "m", None).unwrap();
        assert!(!Arc::ptr_eq(&a, &db.list_nodes().unwrap()));
        let meta = db.list_source_meta().unwrap();
        assert_eq!(meta.len(), db.counts().unwrap().sources as usize);
    }

    #[test]
    fn transactions_roll_back_and_vectors_round_trip() {
        let store = memory_store(false);
        let r: Result<()> = store.transaction(|db| {
            db.save_user(&User { id: "x".into(), name: "X".into(), role: "r".into(), team_description: String::new() })?;
            anyhow::bail!("nope")
        });
        assert!(r.is_err());
        assert!(store.db().get_user("x").unwrap().is_none());
        assert_eq!(from_blob(&to_blob(&[1.5, -2.0])), vec![1.5, -2.0]);
        // Same bytes better-sqlite3 wrote from a Float32Array.
        assert_eq!(to_blob(&[1.0]), vec![0, 0, 0x80, 0x3f]);
    }
}

//! Port of `src/steer/context.ts`. STUB. Tests: covered through `src/steer/users.test.ts`, `src/llm/chat.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;

use super::filters::NodeFilter;
use crate::contract::types::{Cluster, PublicNode, Relation, Source, Why};
use crate::db::store::{Db, Store};
use crate::llm::embed::Embedder;

pub const EXPAND: [Relation; 3] = [Relation::Blocks, Relation::Feeds, Relation::PartOf];
/// The "latest" lane: changes this recent are pulled in even when they rank below the top hits.
pub const LATEST_WITHIN_HOURS: f64 = 72.0;
pub const LATEST_MAX: usize = 3;
/// Documents handed to the model: best matching ones plus the newest behind the leading nodes.
pub const SOURCES_MATCHES: usize = 4;
pub const SOURCES_PER_NODE: usize = 1;
pub const SOURCES_MAX: usize = 8;

pub type ContextItem = Why<PublicNode>;
pub type ContextSource = Why<Source>;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Context {
    pub items: Vec<ContextItem>,
    pub sources: Vec<ContextSource>,
}

/// "updated just now" / "updated 5h ago" / "updated 3d ago"
pub fn ago(at: &str, now: i64) -> String {
    todo!("port ago from src/steer/context.ts")
}

/// The org's areas in the active space, biggest first.
pub fn public_clusters(db: &Db) -> Result<Vec<Cluster>> {
    todo!("port publicClusters from src/steer/context.ts")
}

/// Replaces two or more chosen documents of one digest by that digest, at the first one's position.
pub fn collapse_digests(db: &Db, sources: Vec<ContextSource>, now: i64) -> Result<Vec<ContextSource>> {
    todo!("port collapseDigests from src/steer/context.ts")
}

/// Structured filter over the reader's graph, then ranked by the person's gravity plus freshness.
pub async fn find_nodes(store: &Store, embedder: &dyn Embedder, user_id: &str, q: Option<&str>, k: usize, filter: &NodeFilter, now: i64) -> Result<Vec<ContextItem>> {
    todo!("port findNodes from src/steer/context.ts")
}

/// Best matching documents for the person and question, optionally limited to the last `since_hours`.
pub async fn find_sources(store: &Store, embedder: &dyn Embedder, user_id: &str, q: Option<&str>, k: usize, since_hours: Option<f64>, now: i64) -> Result<Vec<ContextSource>> {
    todo!("port findSources from src/steer/context.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContextOptions {
    pub k: usize,
    pub hits: usize,
    pub for_you: usize,
}

impl Default for ContextOptions {
    fn default() -> Self {
        ContextOptions { k: 16, hits: 6, for_you: 3 }
    }
}

/// What the model sees up front for one person and one question (for you, best, latest, neighbors, documents).
pub async fn build_context(store: &Store, embedder: &dyn Embedder, user_id: &str, q: &str, opts: ContextOptions, now: i64) -> Result<Context> {
    todo!("port buildContext from src/steer/context.ts")
}

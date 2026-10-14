//! Port of `src/steer/users.ts` at d17501b (list_source_meta/get_sources, embeds_screenshot,
//! refresh_in_background, preserving). STUB. Tests: `src/steer/users.test.ts`.
//! Background state was a `WeakMap<Store, ...>`; key a process-wide map by `Store::uid()`.
#![allow(unused_variables, unused_imports, dead_code)]

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::Result;

use crate::db::store::{Db, SourceMeta, Store, StoredCluster, StoredNode, StoredSource, StoredUser, Vectored};
use crate::llm::embed::{EmbedInput, Embedder};
use crate::pseudo::compressor::Compressor;
use crate::pseudo::gravity::Gravity;

pub const USER_WEIGHTS_SEED: f64 = 0.5;
pub const USER_WEIGHTS_OWNED: f64 = 0.3;
pub const USER_WEIGHTS_TOUCHED: f64 = 0.2;

/// Query score = 0.4 cos768 + 0.3 gravityZ(q) + 0.3 gravityZ(person).
pub struct Rerank;
impl Rerank {
    pub const QUERY768: f64 = 0.4;
    pub const QUERY_Z: f64 = 0.3;
    pub const PERSON: f64 = 0.3;
    pub const SHORTLIST_FACTOR: usize = 4;
    pub const SHORTLIST_MIN: usize = 40;
}

/// Role context in embeddings: documents carry their author's role, questions the asker's.
pub struct RoleContext;
impl RoleContext {
    pub const DOCUMENTS: bool = true;
    pub const QUERIES: bool = true;
    pub const MAX_CHARS: usize = 240;
}

/// A question checks cluster centroids first and searches only the nearest cluster.
pub struct Routing;
impl Routing {
    pub const ENABLED: bool = true;
    pub const PROBE: usize = 1;
}

/// Added to every score: weight * 2^(-age / halfLife).
pub struct Freshness;
impl Freshness {
    pub const WEIGHT: f64 = 0.05;
    pub const HALF_LIFE_HOURS: f64 = 48.0;
}

pub const SOURCE_EMBED_CHARS: usize = 4_000;
/// After an ingest, how long to wait for more before refreshing.
pub const REFRESH_DEBOUNCE_MS: u64 = 1_000;

pub fn freshness(updated_at: &str, now: i64) -> f64 {
    todo!("port freshness from src/steer/users.ts")
}

pub fn dot(a: &[f32], b: &[f32]) -> f64 {
    todo!("port dot from src/steer/users.ts")
}

pub fn mean(vecs: &[&[f32]]) -> Option<Vec<f32>> {
    todo!("port mean from src/steer/users.ts")
}

/// Weighted sum of the present parts, weights renormalized over what is present, then unit length.
pub fn blend(parts: &[(f64, Option<&[f32]>)]) -> Option<Vec<f32>> {
    todo!("port blend from src/steer/users.ts")
}

pub fn owner_matches(owner: Option<&str>, user_id: &str, user_name: &str) -> bool {
    todo!("port ownerMatches from src/steer/users.ts")
}

/// A person's profile reads like a standing search, so it embeds as a query.
pub fn seed_input(role: &str, team_description: &str) -> EmbedInput {
    todo!("port seedInput from src/steer/users.ts")
}

pub fn role_context(role: Option<&str>) -> Option<String> {
    todo!("port roleContext from src/steer/users.ts")
}

pub fn node_context(node: &StoredNode, users: &[StoredUser]) -> Option<String> {
    todo!("port nodeContext from src/steer/users.ts")
}

pub fn source_context(author_id: Option<&str>, users: &[StoredUser]) -> Option<String> {
    todo!("port sourceContext from src/steer/users.ts")
}

pub fn node_input(label: &str, summary: &str, ctx: Option<&str>) -> EmbedInput {
    todo!("port nodeInput from src/steer/users.ts")
}

pub fn active_compressor(db: &Db) -> Result<Compressor> {
    todo!("port activeCompressor from src/steer/users.ts")
}

/// A source embeds as one document: title, text (or OCR text), and the screenshot when `embeds_screenshot`.
pub fn source_input(db: &Db, s: &StoredSource, ctx: Option<&str>) -> Result<EmbedInput> {
    todo!("port sourceInput from src/steer/users.ts")
}

/// EMBED_SCREENSHOTS: always, never, or auto (text shorter than SCREENSHOT_TEXT_MIN).
pub fn embeds_screenshot(text: &str) -> bool {
    todo!("port embedsScreenshot from src/steer/users.ts")
}

/// Embeds nodes, sources, and seeds that are missing a vector, have another model, or a stale role context.
pub async fn ensure_embeddings(store: &Store, embedder: &dyn Embedder) -> Result<usize> {
    todo!("port ensureEmbeddings from src/steer/users.ts")
}

/// Projects items missing an org-space vector for `c`, dropping them into the nearest cluster.
pub fn ensure_pseudo(db: &Db, c: &Compressor) -> Result<()> {
    todo!("port ensurePseudo from src/steer/users.ts")
}

pub fn user_gravity(user: &StoredUser, c: &Compressor) -> Option<Gravity> {
    todo!("port userGravity from src/steer/users.ts")
}

/// userVec, gravity, and the stored no-query ranking for every person.
pub async fn recompute_user_vectors(store: &Store, embedder: &dyn Embedder) -> Result<()> {
    todo!("port recomputeUserVectors from src/steer/users.ts")
}

/// recompute_user_vectors debounced per org, one run at a time; `after` runs once the covering refresh is done.
pub fn refresh_in_background(store: Arc<Store>, embedder: Arc<dyn Embedder>, after: Option<Box<dyn FnOnce() + Send>>) {
    todo!("port refreshInBackground from src/steer/users.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct Scored {
    pub id: String,
    pub score: f64,
    pub score_z: f64,
    pub score768: f64,
    pub person: f64,
    pub fresh: f64,
    /// Label of the cluster the question was routed to, when routing picked this item.
    pub cluster: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LensQuery {
    /// The question with the asker's role, for ranking.
    pub x: Vec<f32>,
    pub z: Vec<f32>,
    /// The bare question in the org space, for routing.
    pub topic: Vec<f32>,
}

/// One person's steering state plus, optionally, the embedded question. Build once, rank many lists.
#[derive(Debug, Clone)]
pub struct Lens {
    pub user: StoredUser,
    pub grav: Option<Gravity>,
    pub compressor: Compressor,
    pub model: String,
    pub q: Option<LensQuery>,
    pub clusters: Vec<StoredCluster>,
    pub now: i64,
}

pub async fn lens_for(store: &Store, embedder: &dyn Embedder, user_id: &str, q: Option<&str>, now: i64) -> Result<Option<Lens>> {
    todo!("port lensFor from src/steer/users.ts")
}

/// Clusters ordered by centroid fit to the bare question.
pub fn route_order(lens: &Lens) -> Vec<(StoredCluster, f64)> {
    todo!("port routeOrder from src/steer/users.ts")
}

/// Two-stage ranking (org-space scan, 768d rerank) plus freshness; `at` gives each item's timestamp.
pub fn rank<T: Vectored>(lens: &Lens, items: &[T], at: impl Fn(&T) -> &str, k: usize, route: bool) -> Vec<Scored> {
    todo!("port rank from src/steer/users.ts")
}

pub fn rank_nodes(db: &Db, lens: &Lens, k: usize, allow: Option<&HashSet<String>>, route: bool) -> Result<Vec<Scored>> {
    todo!("port rankNodes from src/steer/users.ts")
}

pub fn rank_sources(db: &Db, lens: &Lens, k: usize, filter: Option<&dyn Fn(&SourceMeta) -> bool>, route: bool) -> Result<Vec<Scored>> {
    todo!("port rankSources from src/steer/users.ts")
}

pub async fn get_context_scored(
    store: &Store,
    embedder: &dyn Embedder,
    user_id: &str,
    q: Option<&str>,
    k: usize,
    allow: Option<&HashSet<String>>,
    now: i64,
) -> Result<Vec<Scored>> {
    todo!("port getContextScored from src/steer/users.ts")
}

pub async fn get_context_ids(
    store: &Store,
    embedder: &dyn Embedder,
    user_id: &str,
    q: Option<&str>,
    k: usize,
    allow: Option<&HashSet<String>>,
    now: i64,
) -> Result<Vec<String>> {
    todo!("port getContextIds from src/steer/users.ts")
}

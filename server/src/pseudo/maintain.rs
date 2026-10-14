//! Port of `src/pseudo/maintain.ts` at d17501b (MAINTAIN_INTERVAL_MS floor). STUB.
//! Background state was a `WeakMap<Store, ...>`; key a process-wide map by `Store::uid()`.
#![allow(unused_variables, unused_imports, dead_code)]

use std::sync::Arc;

use anyhow::Result;

use super::facets::FacetReport;
use super::retrain::RetrainResult;
use crate::contract::types::Cluster;
use crate::db::store::Store;
use crate::llm::embed::Embedder;
use crate::llm::openrouter::LlmClient;
use crate::synth::digest::DigestReport;

/// Newly labeled items, as a share of all items, that justify retraining even without corpus growth.
pub const RELABEL_SHARE: f64 = 0.2;
pub const DEBOUNCE_MS: u64 = 3_000;

/// MAINTAIN_INTERVAL_MS (default 60s): minimum time between the end of one run and the start of the next.
pub fn maintain_interval_ms() -> u64 {
    crate::config::config().maintain_interval_ms
}

/// A step that ran, or why it was skipped (model steps are optional).
#[derive(Debug, Clone, PartialEq)]
pub enum Step<T> {
    Done(T),
    Skipped(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct MaintainReport {
    pub facets: Step<FacetReport>,
    pub retrain: Step<RetrainResult>,
    pub clusters: Vec<Cluster>,
    pub digests: Step<DigestReport>,
    pub ms: u64,
}

/// Embed and project anything new, label areas, retrain when warranted, rebuild clusters, refresh digests.
pub async fn maintain_org(store: &Arc<Store>, embedder: &dyn Embedder, llm: &dyn LlmClient, model: &str, force_retrain: bool) -> Result<MaintainReport> {
    todo!("port maintainOrg from src/pseudo/maintain.ts")
}

/// After an ingest: debounced per org, one run at a time, bursts coalesce. Never fails.
pub fn maintain_in_background(store: Arc<Store>, embedder: Arc<dyn Embedder>, llm: Arc<dyn LlmClient>, model: String) {
    todo!("port maintainInBackground from src/pseudo/maintain.ts")
}

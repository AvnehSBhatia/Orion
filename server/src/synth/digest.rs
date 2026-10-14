//! Port of `src/synth/digest.ts` at d17501b (cached plain vectors, group_cached neighbor cache). STUB.
//! Tests: `src/synth/digest.test.ts`. The neighbor cache was a `WeakMap<Store, ...>`; key by `Store::uid()`.
#![allow(unused_variables, unused_imports, dead_code)]

use std::collections::HashMap;

use anyhow::Result;

use crate::db::store::{SourceMeta, Store, StoredSource};
use crate::llm::embed::Embedder;
use crate::llm::openrouter::LlmClient;

/// Two sources in one cluster this close (768d, plain text) are merged into one digest.
pub const MERGE_SIM: f64 = 0.85;
pub const MAX_MEMBERS: usize = 5;
/// Longer documents are summarized before merging.
pub const SUMMARIZE_OVER: usize = 1_500;
pub const SUMMARY_CHARS: usize = 600;
pub const SUMMARY_FIDELITY: f64 = 0.85;
pub const DIGEST_FIDELITY: f64 = 0.85;
pub const MEMBER_FLOOR: f64 = 0.75;
pub const DIGEST_CHARS: usize = 1_200;

#[derive(Debug, Clone, PartialEq)]
pub struct DigestDetail {
    pub title: String,
    pub members: usize,
    pub fidelity: f64,
    pub min_member: f64,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DigestReport {
    pub groups: usize,
    pub created: usize,
    pub kept: usize,
    pub rejected: usize,
    pub deleted: usize,
    pub summaries: usize,
    pub details: Vec<DigestDetail>,
}

/// Greedy, newest first: each unassigned source takes its closest unassigned neighbors above MERGE_SIM.
pub fn group_similar(ids: &[String], vec: &HashMap<String, Vec<f32>>) -> Vec<Vec<String>> {
    todo!("port groupSimilar from src/synth/digest.ts")
}

/// group_similar with each source's above-threshold neighbors cached per store, recomputed only for sources
/// whose cluster or text hash changed. Same groups as group_similar.
pub fn group_cached(store: &Store, cluster_id: &str, ids: &[String], vec: &HashMap<String, Vec<f32>>, hashes: &HashMap<String, String>) -> Vec<Vec<String>> {
    todo!("port groupCached from src/synth/digest.ts")
}

/// `ids sorted|newest createdAt`
pub fn members_key(members: &[StoredSource]) -> String {
    todo!("port membersKey from src/synth/digest.ts")
}

/// Groups similar sources per cluster, summarizes long members, and keeps digests that pass both fidelity checks.
pub async fn synthesize_digests(store: &Store, embedder: &dyn Embedder, llm: &dyn LlmClient, model: &str) -> Result<DigestReport> {
    todo!("port synthesizeDigests from src/synth/digest.ts")
}

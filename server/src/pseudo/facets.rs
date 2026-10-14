//! Port of `src/pseudo/facets.ts`. STUB. Tests: `src/pseudo/org.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;

use crate::db::store::Store;
use crate::llm::openrouter::LlmClient;

/// How people use an item. A fixed set, so "same use" means the same thing across orgs.
pub const USES: [&str; 7] = ["status update", "plan", "decision", "customer record", "code change", "metrics", "reference"];
pub const BATCH: usize = 30;
pub const EXCERPT: usize = 400;
pub const AREA_MAX: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FacetReport {
    pub labeled: usize,
    pub areas: usize,
}

pub fn normalize_area(s: &str) -> String {
    todo!("port normalizeArea from src/pseudo/facets.ts")
}

/// Target area count: grows with the square root of the corpus.
pub fn target_areas(n: usize) -> usize {
    todo!("port targetAreas from src/pseudo/facets.ts")
}

/// Labels every node and source with no facet yet, or whose text changed since it was labeled.
pub async fn label_facets(store: &Store, llm: &dyn LlmClient, model: &str) -> Result<FacetReport> {
    todo!("port labelFacets from src/pseudo/facets.ts")
}

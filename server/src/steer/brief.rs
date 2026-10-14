//! Port of `src/steer/brief.ts`. STUB. Tests: `src/steer/brief.test.ts`.
//! The 60s cache was on globalThis; keep a process-wide map keyed by "orgId:userId" (shared in-flight future).
#![allow(unused_variables, unused_imports, dead_code)]

use std::future::Future;
use std::sync::Arc;

use anyhow::Result;

use crate::contract::types::{BriefResponse, Source, User, Why};
use crate::db::store::Store;
use crate::llm::embed::Embedder;
use crate::llm::openrouter::LlmClient;

pub const BRIEF_HOURS: i64 = 2;
pub const BRIEF_TTL_MS: i64 = 60_000;
pub const BRIEF_TIMEOUT_MS: u64 = 2_000;
pub const BRIEF_ITEMS: usize = 5;

pub type Moved = Why<Source>;

#[derive(Clone, Default)]
pub struct BriefDeps {
    pub llm: Option<Arc<dyn LlmClient>>,
    pub now: Option<i64>,
    pub timeout_ms: Option<u64>,
}

/// What moved for the person in the window: their ranked feed, then documents that flipped work to blocked or at risk.
pub async fn what_moved(store: &Store, embedder: &dyn Embedder, user_id: &str, now: i64) -> Result<Vec<Moved>> {
    todo!("port whatMoved from src/steer/brief.ts")
}

/// No model: the same brief from a template, citing each item.
pub fn template_brief(user: &User, moved: &[Moved], now: i64) -> BriefResponse {
    todo!("port templateBrief from src/steer/brief.ts")
}

/// One fast model call over what moved; the template when there is no key, nothing moved, or it takes over 2s.
pub async fn brief_for(store: &Store, embedder: &dyn Embedder, user: &User, deps: BriefDeps) -> Result<BriefResponse> {
    todo!("port briefFor from src/steer/brief.ts")
}

/// `make()` cached per key for 60s; concurrent callers share one call; failures are not cached.
pub async fn cached_brief<F, Fut>(key: &str, make: F, now: i64) -> Result<BriefResponse>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<BriefResponse>> + Send + 'static,
{
    todo!("port cachedBrief from src/steer/brief.ts")
}

/// True when the backend can call the model.
pub fn has_model_key() -> bool {
    crate::config::config().has_model_key()
}

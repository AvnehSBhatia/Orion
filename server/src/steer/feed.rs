//! Port of `src/steer/feed.ts` at d17501b (changes_by_source, top `limit` hydrated). STUB.
//! Tests: `src/steer/feed.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;

use crate::contract::types::FeedItem;
use crate::db::store::Store;
use crate::llm::embed::Embedder;

/// Added to the gravity score when a document changed something tied to the reader.
pub const IMPACT_OWNED: f64 = 0.25;
pub const IMPACT_TOUCHED: f64 = 0.15;
pub const IMPACT_LINKED: f64 = 0.1;
pub const IMPACT_ALARMING: f64 = 0.05;

/// What other people captured or committed in the window, ranked for the reader.
pub async fn feed_for(store: &Store, embedder: &dyn Embedder, user_id: &str, since_hours: f64, limit: usize, now: i64) -> Result<Vec<FeedItem>> {
    todo!("port feedFor from src/steer/feed.ts")
}

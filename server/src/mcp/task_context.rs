//! Port of `src/mcp/taskContext.ts` (48ff660). STUB. Tests: `src/mcp/taskContext.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;
use serde::Serialize;

use crate::db::store::Store;
use crate::llm::embed::Embedder;

/// Where a coding agent should save the file, relative to the repo root.
pub const WRITE_TO: &str = ".orion/context.md";
/// Hard cap on the markdown, so the file stays cheap to load into a coding agent's context.
pub const MAX_CHARS: usize = 12_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskChange {
    pub source_id: String,
    pub at: String,
    pub who: Option<String>,
    pub title: String,
    #[serde(rename = "ref")]
    pub source_ref: String,
    /// What it did to the items in this context, e.g. "Voice latency fix: on track -> blocked".
    pub effects: Vec<String>,
    pub flip: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContext {
    pub markdown: String,
    pub write_to: String,
    pub item_ids: Vec<String>,
    pub source_ids: Vec<String>,
    pub changes: Vec<TaskChange>,
    pub truncated: bool,
}

/// One markdown context file for a coding agent's task (k default 10, since_hours default 168).
pub async fn build_task_context(store: &Store, embedder: &dyn Embedder, user_id: &str, task: &str, k: usize, since_hours: f64, now: i64) -> Result<TaskContext> {
    todo!("port buildTaskContext from src/mcp/taskContext.ts")
}

//! Port of `src/ingest/pipeline.ts` at 48ff660 (refresh_in_background, early light-mode repeat, change-aware diffs via ingest::diff).
//! STUB. Tests: `src/ingest/pipeline.test.ts`, the ingest half of `src/contract/org.test.ts`.
//! The not-work memory was a `WeakMap<Store, ...>`; key a process-wide map by `Store::uid()`.
#![allow(unused_variables, unused_imports, dead_code)]

use std::sync::Arc;

use anyhow::Result;

use super::image::OcrFn;
use crate::contract::types::{CaptureResponse, CodeFile, CodeIngestResponse, CommitAuthor, FeatureCard, ImageStatus, SourceKind};
use crate::db::store::{Db, GraphUpdate, Store};
use crate::llm::embed::Embedder;
use crate::llm::extract::Extractor;
use crate::llm::openrouter::LlmClient;

/// Org maintenance and screenshot pruning after each ingest.
#[derive(Clone)]
pub struct Background {
    pub llm: Arc<dyn LlmClient>,
    pub model: String,
}

#[derive(Clone)]
pub struct IngestDeps {
    pub store: Arc<Store>,
    pub embedder: Arc<dyn Embedder>,
    pub extractor: Arc<dyn Extractor>,
    /// Off when None (tests): embedding and steering then run inline.
    pub background: Option<Background>,
    pub ocr: Option<OcrFn>,
}

/// Paths that never go to the model, whatever the sender filtered.
pub const ALWAYS_EXCLUDE: [&str; 4] = [
    r"(^|/)\.env[^/]*$",
    r"\.(pem|key)$",
    r"(^|/)node_modules/",
    r"(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum)$",
];
/// Visible page text sent to the extractor.
pub const MAX_PAGE_TEXT: usize = 30_000;
/// Page text sent with a diff of the previous capture.
pub const MAX_PAGE_TEXT_WITH_DIFF: usize = 8_000;
/// A repeat of the sender's last capture of a URL within this window is skipped.
pub const CAPTURE_REPEAT_MS: i64 = 30 * 60_000;
/// Share of words two captures of a not-work page must share to count as the same page.
pub const NOT_WORK_SAME_PAGE: f64 = 0.8;

pub fn is_always_excluded(path: &str) -> bool {
    todo!("port isAlwaysExcluded from src/ingest/pipeline.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct SourceDoc {
    pub kind: SourceKind,
    pub source_ref: String,
    pub title: String,
    pub text: String,
    pub image: Option<Vec<u8>>,
    pub ocr_text: Option<String>,
    pub image_status: Option<ImageStatus>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Applied {
    pub nodes_touched: Vec<String>,
    pub source_id: String,
}

/// Upsert the graph, store the document, record touches, then refresh steering (background or inline).
pub async fn apply_update(deps: &IngestDeps, update: &GraphUpdate, source: SourceDoc, user_id: Option<&str>, now: Option<String>) -> Result<Applied> {
    todo!("port applyUpdate from src/ingest/pipeline.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct CaptureBody {
    pub user_id: String,
    pub url: String,
    pub title: String,
    pub html: String,
    pub screenshot_b64: String,
}

/// OCR/shrink the screenshot, skip repeats and not-work pages, extract, apply.
pub async fn ingest_capture(deps: &IngestDeps, body: CaptureBody, now: Option<i64>) -> Result<CaptureResponse> {
    todo!("port ingestCapture from src/ingest/pipeline.ts")
}

/// The person behind a commit: the given userId if known, else the person matching the git author.
pub fn commit_author(db: &Db, user_id: Option<&str>, author: Option<&CommitAuthor>) -> Result<Option<String>> {
    todo!("port commitAuthor from src/ingest/pipeline.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct CodeBody {
    pub repo: String,
    pub commit_sha: String,
    pub files: Vec<CodeFile>,
    pub cards: Option<Vec<FeatureCard>>,
    pub user_id: Option<String>,
    pub author: Option<CommitAuthor>,
}

pub async fn ingest_code(deps: &IngestDeps, body: CodeBody, max_diff_chars: usize) -> Result<CodeIngestResponse> {
    todo!("port ingestCode from src/ingest/pipeline.ts")
}

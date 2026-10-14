//! Port of `src/ingest/image.ts`. STUB. Tests: `src/ingest/image.test.ts`.
//! Uses the `image` and `webp` crates in place of sharp; OCR (tesseract.js) has no Rust dependency yet,
//! so `tesseract_ocr` may return empty text until one is chosen.
#![allow(unused_variables, unused_imports, dead_code)]

use std::sync::Arc;

use anyhow::Result;
use futures::future::BoxFuture;

use crate::contract::types::ImageStatus;
use crate::llm::embed::Embedder;

/// OCR text vs page text cosine at or above this: the screenshot adds nothing, store text only.
pub const OCR_TEXT_ONLY_SIM: f64 = 0.95;
/// Less OCR text than this: the screenshot is visual, always keep it.
pub const MIN_OCR_CHARS: usize = 20;
pub const MIN_OCR_CONFIDENCE: f64 = 60.0;
/// What the Gemma image processor actually uses.
pub const MAX_PIXELS: u64 = 645_120;
pub const WEBP_QUALITY: f32 = 80.0;
pub const GRID: u32 = 4;
pub const DROP_FRACTION: f64 = 0.25;
pub const PRUNE_KEEP_SIM: f64 = 0.95;
pub const TRIM_THRESHOLD: u8 = 8;
pub const MIN_TRIMMED_SIDE: u32 = 32;
pub const MIN_TILE_SIDE: u32 = 32;
pub const FLAT_BACKGROUND_SHARE: f64 = 0.2;

#[derive(Debug, Clone, PartialEq)]
pub struct OcrResult {
    pub text: String,
    pub confidence: f64,
}

pub type OcrFn = Arc<dyn Fn(Vec<u8>) -> BoxFuture<'static, OcrResult> + Send + Sync>;

pub fn tesseract_ocr() -> OcrFn {
    todo!("port tesseractOcr from src/ingest/image.ts")
}

/// Decode, trim the flat border, shrink to MAX_PIXELS, encode webp.
pub fn shrink_image(image: &[u8]) -> Result<Vec<u8>> {
    todo!("port shrinkImage from src/ingest/image.ts")
}

/// The stretch of page text the screenshot shows.
pub fn visible_stretch(page_text: &str, ocr_text: &str) -> String {
    todo!("port visibleStretch from src/ingest/image.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedScreenshot {
    pub image: Option<Vec<u8>>,
    pub ocr_text: String,
    /// TextOnly or Kept
    pub status: ImageStatus,
    pub ocr_sim: Option<f64>,
}

pub async fn prepare_screenshot(embedder: &dyn Embedder, title: &str, page_text: &str, image: &[u8], ocr: Option<OcrFn>) -> Result<PreparedScreenshot> {
    todo!("port prepareScreenshot from src/ingest/image.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct PruneResult {
    pub image: Vec<u8>,
    /// true: "pruned", false: "unchanged"
    pub pruned: bool,
    pub dropped: usize,
    pub sim: Option<f64>,
    pub ms: u64,
}

pub async fn prune_image(embedder: &dyn Embedder, image: &[u8]) -> Result<PruneResult> {
    todo!("port pruneImage from src/ingest/image.ts")
}

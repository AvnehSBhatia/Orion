//! Port of `src/pseudo/compressor.ts` at d17501b (fullNeighbors, bounded topKOf, MAX_EVAL_ANCHORS). STUB.
//! Tests: `src/pseudo/pseudo.test.ts`, `src/pseudo/org.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

use std::collections::HashSet;

use anyhow::Result;
use serde::{Deserialize, Serialize};

pub const IN_DIM: usize = 768;
/// The org space: small enough to scan and cluster cheaply, trained per org on how its documents are used.
pub const OUT_DIM: usize = 64;
/// Held-out anchors scored per evaluation.
pub const MAX_EVAL_ANCHORS: usize = 256;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressorMetrics {
    /// Mean overlap between 768d and org-space top-k neighbor sets on held-out items.
    pub recall_at_k: f64,
    /// Same measure for plain Matryoshka truncation, the baseline a trained map must beat.
    pub baseline_recall_at_k: f64,
    pub area_purity: Option<f64>,
    pub baseline_area_purity: Option<f64>,
    pub labeled_items: usize,
    pub k: usize,
    pub train_items: usize,
    pub val_items: usize,
    pub steps: usize,
    pub final_loss: f64,
}

/// Per training vector: index of its area and of its use, -1 when unlabeled.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Labels {
    pub area: Vec<i32>,
    pub use_: Vec<i32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Compressor {
    pub id: String,
    pub kind: crate::db::store::CompressorKind,
    /// OUT_DIM x IN_DIM, row-major.
    pub weights: Vec<f32>,
    pub metrics: Option<CompressorMetrics>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrainOptions {
    pub steps: usize,
    pub batch: usize,
    pub lr: f64,
    pub tau_teacher: f64,
    pub tau_student: f64,
    pub anchor_weight: f64,
    pub label_weight: f64,
    pub use_weight: f64,
    pub k: usize,
    pub val_fraction: f64,
    pub seed: u32,
}

impl Default for TrainOptions {
    fn default() -> Self {
        TrainOptions {
            steps: 300,
            batch: 192,
            lr: 2e-3,
            tau_teacher: 0.05,
            tau_student: 0.05,
            anchor_weight: 1e-3,
            label_weight: 0.5,
            use_weight: 0.3,
            k: 10,
            val_fraction: 0.2,
            seed: 7,
        }
    }
}

/// EmbeddingGemma 2 is Matryoshka-trained, so its leading dims are already a usable small embedding.
pub fn mrl_compressor() -> Compressor {
    todo!("port mrlCompressor from src/pseudo/compressor.ts")
}

pub fn area_purity(c: &Compressor, xs: &[Vec<f32>], labels: &Labels, anchors: &[usize], k: usize) -> Option<f64> {
    todo!("port areaPurity from src/pseudo/compressor.ts")
}

/// 768d unit vector to OUT_DIM unit vector.
pub fn compress(c: &Compressor, x: &[f32]) -> Vec<f32> {
    todo!("port compress from src/pseudo/compressor.ts")
}

/// Each anchor's top-k neighbors in 768d, shared across evaluations.
pub fn full_neighbors(xs: &[Vec<f32>], anchors: &[usize], k: usize) -> Vec<HashSet<usize>> {
    todo!("port fullNeighbors from src/pseudo/compressor.ts")
}

/// Mean overlap of top-k neighbors in 768d vs the compressed space, for each anchor.
pub fn neighbor_recall(c: &Compressor, xs: &[Vec<f32>], anchors: &[usize], k: usize, full: Option<&[HashSet<usize>]>) -> f64 {
    todo!("port neighborRecall from src/pseudo/compressor.ts")
}

/// Similarity distillation with org supervision (Adam, minibatches). Yields to the runtime between steps.
pub async fn train_compressor(xs: &[Vec<f32>], opts: &TrainOptions, labels: Option<&Labels>) -> Result<Compressor> {
    todo!("port trainCompressor from src/pseudo/compressor.ts")
}

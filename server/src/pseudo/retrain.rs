//! Port of `src/pseudo/retrain.ts` at d17501b (list_source_meta, counts). STUB. Tests: `src/pseudo/org.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;

use super::compressor::{CompressorMetrics, Labels, TrainOptions};
use crate::db::store::{Db, Store};
use crate::llm::embed::Embedder;

/// Below this many training vectors a learned map cannot beat Matryoshka truncation reliably.
pub const MIN_TRAIN_VECTORS: usize = 32;
/// Retrain once the training set has grown this much since the last attempt.
pub const RETRAIN_GROWTH: f64 = 1.25;
pub const ADOPT_MARGIN: f64 = 0.01;
pub const RECALL_SLACK: f64 = 0.15;
pub const MIN_LABELED: usize = 12;
pub const MAX_USE_SHARE: f64 = 0.6;

#[derive(Debug, Clone, PartialEq)]
pub enum RetrainResult {
    Skipped { reason: String, vectors: usize },
    Adopted { id: String, metrics: CompressorMetrics },
    Rejected { id: String, metrics: CompressorMetrics },
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrainingSet {
    pub xs: Vec<Vec<f32>>,
    pub labels: Option<Labels>,
}

pub async fn training_set(store: &Store, embedder: &dyn Embedder) -> Result<TrainingSet> {
    todo!("port trainingSet from src/pseudo/retrain.ts")
}

pub fn should_adopt(m: &CompressorMetrics) -> bool {
    todo!("port shouldAdopt from src/pseudo/retrain.ts")
}

pub async fn retrain_compressor(store: &Store, embedder: &dyn Embedder, force: bool, train: Option<TrainOptions>) -> Result<RetrainResult> {
    todo!("port retrainCompressor from src/pseudo/retrain.ts")
}

pub fn last_trained_size(db: &Db) -> Result<usize> {
    todo!("port lastTrainedSize from src/pseudo/retrain.ts")
}

/// Vectors the next training set would hold, without embedding anything.
pub fn estimated_training_size(db: &Db) -> Result<usize> {
    todo!("port estimatedTrainingSize from src/pseudo/retrain.ts")
}

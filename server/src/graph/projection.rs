//! Port of `src/graph/projection.ts`. STUB: signatures and constants are final; bodies are `todo!()`.
//! Reads sources through `Db::list_source_meta` (d17501b). The TS cached per org on globalThis; keep a
//! process-wide cache keyed by org id (projection + warm-start axes), reprojecting at most every FRESH_MS.
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;

use crate::contract::types::EmbeddingsResponse;
use crate::db::store::Db;

pub const MAX_POINTS: usize = 1_500;
pub const ITERATIONS: usize = 40;
pub const TOLERANCE: f64 = 1e-6;
/// While data streams in, reproject at most this often; polls in between get the last projection.
pub const FRESH_MS: i64 = 2_000;

/// Warm-start state for `pca`: the last projection's axes.
#[derive(Debug, Clone, Default)]
pub struct WarmAxes {
    pub axes: Option<Vec<Vec<f64>>>,
}

/// Top `k` principal axes by power iteration with deflation; returns each row's coordinates on those axes.
pub fn pca(rows: &[&[f32]], k: usize, warm: Option<&mut WarmAxes>) -> Vec<Vec<f64>> {
    todo!("port pca from src/graph/projection.ts")
}

/// Scales each column into [-1, 1] around zero, robust to outliers (90th percentile + tanh).
pub fn scale_columns(points: Vec<Vec<f64>>) -> Vec<Vec<f64>> {
    todo!("port scaleColumns from src/graph/projection.ts")
}

/// Every node and document with a vector, newest first, projected to 3D. Cached per org until the data changes.
pub fn project_embeddings(db: &Db, org_id: &str) -> Result<EmbeddingsResponse> {
    todo!("port projectEmbeddings from src/graph/projection.ts")
}

//! Port of `src/pseudo/clusters.ts`. STUB. Tests: `src/pseudo/org.test.ts`, `src/pseudo/pseudo.test.ts`.
//! Reads sources through `Db::list_source_meta` (d17501b).
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;

use super::compressor::Compressor;
use crate::db::store::{Db, StoredCluster};

/// An area needs `MIN_SIZE` items to be its own cluster; smaller ones fold into the nearest.
pub const MIN_SIZE: usize = 2;
pub const KMEANS_ITERS: usize = 25;

/// Anything with a centroid (stored clusters, clusters being built).
pub trait HasCentroid {
    fn centroid(&self) -> &[f32];
}

impl HasCentroid for StoredCluster {
    fn centroid(&self) -> &[f32] {
        &self.centroid
    }
}

/// The cluster whose centroid has the highest dot product with `z`.
pub fn nearest_cluster<'a, C: HasCentroid>(clusters: &'a [C], z: &[f32]) -> Option<&'a C> {
    todo!("port nearestCluster from src/pseudo/clusters.ts")
}

/// One cluster per labeled area (centroids in compressor `c`'s space), else deterministic k-means.
/// Replaces all clusters and assignments.
pub fn build_clusters(db: &Db, c: &Compressor) -> Result<Vec<StoredCluster>> {
    todo!("port buildClusters from src/pseudo/clusters.ts")
}

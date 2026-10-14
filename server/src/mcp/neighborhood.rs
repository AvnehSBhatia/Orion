//! Port of `src/mcp/neighborhood.ts` (48ff660). STUB.
#![allow(unused_variables, unused_imports, dead_code)]

use anyhow::Result;
use serde::Serialize;

use crate::contract::types::Relation;
use crate::db::store::Db;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NeighborNode {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub status: String,
    pub owner: Option<String>,
    pub summary: String,
    pub todo: Option<String>,
    pub hops: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NeighborEdge {
    pub from: String,
    pub relation: Relation,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Neighborhood {
    pub center: String,
    pub nodes: Vec<NeighborNode>,
    pub edges: Vec<NeighborEdge>,
}

/// Items within `depth` hops of `id` over every relation, with effective (rippled) statuses. None when unknown.
pub fn neighborhood(db: &Db, id: &str, depth: usize) -> Result<Option<Neighborhood>> {
    todo!("port neighborhood from src/mcp/neighborhood.ts")
}

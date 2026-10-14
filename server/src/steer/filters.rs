//! Port of `src/steer/filters.ts`. STUB. Tests: `src/steer/filters.test.ts`.
#![allow(unused_variables, unused_imports, dead_code)]

use std::collections::HashSet;

use serde_json::Value;

use crate::contract::schemas::VResult;
use crate::contract::types::{Domain, NodeType, PublicNode, Status};

/// Structured filters over the graph as readers see it (`nodeFilter` in TS; every field nullish).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NodeFilter {
    pub statuses: Option<Vec<Status>>,
    pub sellable: Option<bool>,
    pub domains: Option<Vec<Domain>>,
    pub types: Option<Vec<NodeType>>,
    pub updated_within_hours: Option<f64>,
}

/// `nodeFilter.parse` on a JSON object (used by MCP `find_items`).
pub fn node_filter(v: &Value) -> VResult<NodeFilter> {
    todo!("port nodeFilter from src/steer/filters.ts")
}

pub fn is_empty_filter(f: &NodeFilter) -> bool {
    todo!("port isEmptyFilter from src/steer/filters.ts")
}

/// Ids of the nodes that pass (ripple statuses already applied by the caller).
pub fn matching_ids(nodes: &[PublicNode], f: &NodeFilter, now: i64) -> HashSet<String> {
    todo!("port matchingIds from src/steer/filters.ts")
}

/// `?status=blocked,at_risk&sellable=true&domain=sales&type=deal&sinceHours=24`, with zod's messages.
pub fn filter_params(query: &Value) -> VResult<NodeFilter> {
    todo!("port filterParams from src/steer/filters.ts")
}

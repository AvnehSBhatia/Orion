//! Port of `src/graph/ripple.ts` (done). Tests: `src/graph/rules.test.ts`.

use std::collections::{HashMap, VecDeque};

use crate::contract::types::{Edge, PublicNode, Relation, Status};

pub const CARRIES_RISK: [Relation; 2] = [Relation::Blocks, Relation::Feeds];
pub const TROUBLED: [Status; 2] = [Status::Blocked, Status::AtRisk];
pub const CAN_DEGRADE: [Status; 2] = [Status::OnTrack, Status::Unknown];

#[derive(Debug, Clone, PartialEq)]
pub struct RippleChange {
    pub node_id: String,
    pub from: Status,
    /// Always `AtRisk`.
    pub to: Status,
    pub cause_id: String,
}

/// A blocked or at-risk node pushes `at_risk` downstream along `blocks` and `feeds` edges, transitively.
/// Done, blocked, and already at-risk nodes keep their status.
pub fn ripple(nodes: &[PublicNode], edges: &[Edge]) -> Vec<RippleChange> {
    let mut status: HashMap<&str, Status> = nodes.iter().map(|n| (n.id.as_str(), n.status)).collect();
    let mut downstream: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in edges {
        if CARRIES_RISK.contains(&e.relation) {
            downstream.entry(e.source.as_str()).or_default().push(e.target.as_str());
        }
    }
    let mut changes = vec![];
    let mut queue: VecDeque<&str> = nodes.iter().filter(|n| TROUBLED.contains(&n.status)).map(|n| n.id.as_str()).collect();
    while let Some(id) = queue.pop_front() {
        for &target in downstream.get(id).map(Vec::as_slice).unwrap_or(&[]) {
            let Some(&from) = status.get(target) else { continue };
            if !CAN_DEGRADE.contains(&from) {
                continue;
            }
            status.insert(target, Status::AtRisk);
            changes.push(RippleChange { node_id: target.into(), from, to: Status::AtRisk, cause_id: id.into() });
            queue.push_back(target);
        }
    }
    changes
}

pub fn apply_ripple(nodes: Vec<PublicNode>, changes: &[RippleChange]) -> Vec<PublicNode> {
    let to: HashMap<&str, Status> = changes.iter().map(|c| (c.node_id.as_str(), c.to)).collect();
    nodes
        .into_iter()
        .map(|mut n| {
            if let Some(&s) = to.get(n.id.as_str()) {
                n.status = s;
            }
            n
        })
        .collect()
}

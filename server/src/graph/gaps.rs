//! Port of `src/graph/gaps.ts` (done). Tests: `src/graph/rules.test.ts`.

use std::collections::{HashMap, HashSet};

use crate::contract::types::{Edge, Gap, GapKind, NodeType, PublicNode, Status};

/// Types that are people or outside parties, so they never need an internal owner.
pub const OWNERLESS_OK: [NodeType; 2] = [NodeType::Stakeholder, NodeType::Supplier];

/// Deterministic gap rules:
/// - no_owner: open work with nobody responsible.
/// - single_threaded_deal: an open deal linked to fewer than two stakeholders.
pub fn find_gaps(nodes: &[PublicNode], edges: &[Edge]) -> Vec<Gap> {
    let by_id: HashMap<&str, &PublicNode> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut gaps = vec![];
    for node in nodes {
        if node.status == Status::Done {
            continue;
        }
        if node.owner.is_none() && !OWNERLESS_OK.contains(&node.node_type) {
            gaps.push(Gap { node_id: node.id.clone(), kind: GapKind::NoOwner, message: format!("{} has no owner.", node.label) });
        }
        if node.node_type == NodeType::Deal {
            let mut stakeholders: HashSet<&str> = HashSet::new();
            for e in edges {
                let other = if e.source == node.id {
                    Some(e.target.as_str())
                } else if e.target == node.id {
                    Some(e.source.as_str())
                } else {
                    None
                };
                if let Some(o) = other {
                    if by_id.get(o).is_some_and(|n| n.node_type == NodeType::Stakeholder) {
                        stakeholders.insert(o);
                    }
                }
            }
            if stakeholders.len() < 2 {
                let who = if stakeholders.is_empty() { "no stakeholder" } else { "only one stakeholder" };
                gaps.push(Gap {
                    node_id: node.id.clone(),
                    kind: GapKind::SingleThreadedDeal,
                    message: format!("{} has {who}. Add a second contact.", node.label),
                });
            }
        }
    }
    gaps
}

/// Fills empty "what to do" fields from gaps so the click panel always has an action.
pub fn apply_gap_todos(nodes: Vec<PublicNode>, gaps: &[Gap]) -> Vec<PublicNode> {
    let mut first: HashMap<&str, &Gap> = HashMap::new();
    for g in gaps {
        first.entry(g.node_id.as_str()).or_insert(g);
    }
    nodes
        .into_iter()
        .map(|mut n| {
            if n.todo.as_deref().is_some_and(|t| !t.is_empty()) {
                return n;
            }
            if let Some(gap) = first.get(n.id.as_str()) {
                n.todo = Some(match gap.kind {
                    GapKind::NoOwner => "Pick an owner for this.".into(),
                    GapKind::SingleThreadedDeal => "Find a second contact on this deal.".into(),
                });
            }
            n
        })
        .collect()
}

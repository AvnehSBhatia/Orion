//! Port of `src/graph/view.ts` (done).

use std::collections::HashMap;

use anyhow::Result;

use super::gaps::{apply_gap_todos, find_gaps};
use super::ripple::{apply_ripple, ripple};
use crate::contract::types::{GraphResponse, PublicNode};
use crate::db::store::{Db, to_public_node};

/// What every reader sees: embeddings stripped, ripple statuses applied, gap todos filled.
pub fn read_graph(db: &Db) -> Result<GraphResponse> {
    let edges = db.list_edges()?;
    let raw: Vec<PublicNode> = db.list_nodes()?.iter().map(to_public_node).collect();
    let changes = ripple(&raw, &edges);
    let rippled = apply_ripple(raw, &changes);
    let gaps = find_gaps(&rippled, &edges);
    Ok(GraphResponse { nodes: apply_gap_todos(rippled, &gaps), edges, gaps })
}

/// Effective public versions of the given ids, in the given order.
pub fn public_nodes_by_id(db: &Db, ids: &[String]) -> Result<Vec<PublicNode>> {
    let graph = read_graph(db)?;
    let by_id: HashMap<&str, &PublicNode> = graph.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    Ok(ids.iter().filter_map(|id| by_id.get(id.as_str()).map(|n| (*n).clone())).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::types::{GapKind, Status};
    use crate::testing::memory_store;

    #[test]
    fn demo_graph_ripples_and_fills_gaps() {
        let store = memory_store(true);
        let g = read_graph(&store.db()).unwrap();
        let status = |id: &str| g.nodes.iter().find(|n| n.id == id).unwrap().status;
        // voice-latency-fix is blocked, so the release it blocks is at risk.
        assert_eq!(status("voice-mode-general-release"), Status::AtRisk);
        assert!(g.gaps.iter().any(|x| x.node_id == "acme-renewal" && x.kind == GapKind::SingleThreadedDeal));
        let audio = g.nodes.iter().find(|n| n.id == "audio-streaming-service").unwrap();
        assert_eq!(audio.todo.as_deref(), Some("Pick an owner for this."));
    }
}

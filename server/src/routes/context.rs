//! Port of `app/api/context/route.ts`. Without filters: the assistant's context. With filters: only matching
//! nodes ranked for the person, plus the newest document behind each.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::context_query;
use crate::contract::types::ContextResponse;
use crate::server::deps::{AppState, require_user};
use crate::server::http::{ApiResult, QueryValue, ok};
use crate::steer::context::{ContextOptions, build_context, find_nodes};
use crate::steer::filters::{filter_params, is_empty_filter};
use crate::time::now_ms;

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<ContextResponse> {
    let params = auth.scope(q, true)?;
    let query = context_query(&params)?;
    let filter = filter_params(&params)?;
    let store = state.store(&org_or_default(query.org_id))?;
    require_user(&store.db(), &query.user_id)?;
    let embedder = state.embedder.as_ref();
    let now = now_ms();

    if is_empty_filter(&filter) {
        let opts = ContextOptions { k: query.k, ..Default::default() };
        let ctx = build_context(&store, embedder, &query.user_id, query.q.as_deref().unwrap_or(""), opts, now).await?;
        return ok(ContextResponse { nodes: ctx.items.into_iter().map(|n| n.item).collect(), sources: ctx.sources.into_iter().map(|s| s.item).collect() });
    }

    let items = find_nodes(&store, embedder, &query.user_id, query.q.as_deref(), query.k, &filter, now).await?;
    let db = store.db();
    let mut ids: Vec<String> = vec![];
    for n in &items {
        for id in db.source_ids_for_node(&n.item.id, 1)? {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    let mut sources = vec![];
    for id in ids {
        if let Some(s) = db.get_source(&id)? {
            sources.push(db.to_public_source(&s)?);
        }
    }
    ok(ContextResponse { nodes: items.into_iter().map(|n| n.item).collect(), sources })
}

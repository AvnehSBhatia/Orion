//! Port of `app/api/graph/route.ts`.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::org_query;
use crate::contract::types::GraphResponse;
use crate::graph::view::read_graph;
use crate::server::deps::{AppState, require_user};
use crate::server::http::{ApiResult, QueryValue, ok};

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<GraphResponse> {
    let user_id = q.get("userId").and_then(serde_json::Value::as_str).filter(|u| !u.is_empty()).map(String::from);
    let q = org_query(&auth.scope(q, false)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    let db = store.db();
    if let Some(u) = user_id {
        require_user(&db, &u)?;
    }
    ok(read_graph(&db)?)
}

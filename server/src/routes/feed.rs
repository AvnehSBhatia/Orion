//! Port of `app/api/feed/route.ts`.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::feed_query;
use crate::contract::types::FeedResponse;
use crate::server::deps::{AppState, require_user};
use crate::server::http::{ApiResult, QueryValue, ok};
use crate::steer::feed::feed_for;
use crate::time::now_ms;

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<FeedResponse> {
    let q = feed_query(&auth.scope(q, true)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    require_user(&store.db(), &q.user_id)?;
    let items = feed_for(&store, state.embedder.as_ref(), &q.user_id, q.since_hours, q.limit, now_ms()).await?;
    ok(FeedResponse { items })
}

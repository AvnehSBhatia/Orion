//! Port of `app/api/brief/route.ts`: a one or two sentence briefing of what moved, cached 60s.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::brief_query;
use crate::contract::types::BriefResponse;
use crate::db::store::to_public_user;
use crate::server::deps::{AppState, require_user};
use crate::server::http::{ApiResult, QueryValue, ok};
use crate::steer::brief::{BriefDeps, brief_for, cached_brief};
use crate::time::now_ms;

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<BriefResponse> {
    let q = brief_query(&auth.scope(q, true)?)?;
    let org = org_or_default(q.org_id);
    let store = state.store(&org)?;
    let user = to_public_user(&require_user(&store.db(), &q.user_id)?);
    let key = format!("{org}:{}", user.id);
    let embedder = state.embedder.clone();
    let llm = state.config.has_model_key().then(|| state.llm.clone());
    let res = cached_brief(
        &key,
        move || async move { brief_for(&store, embedder.as_ref(), &user, BriefDeps { llm, now: None, timeout_ms: None }).await },
        now_ms(),
    )
    .await?;
    ok(res)
}

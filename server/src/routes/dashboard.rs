//! Port of `app/api/dashboard/route.ts`: the person's dashboard (saved, else composed from their role), and
//! saving an edit or `reset: true`.

use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::{dashboard_query, dashboard_request};
use crate::contract::types::DashboardResponse;
use crate::db::store::to_public_user;
use crate::server::deps::{AppState, require_user};
use crate::server::http::{ApiResult, HttpError, JsonBody, QueryValue, ok};
use crate::steer::dashboard::{ComposeDeps, resolve_dashboard, sanitize_dashboard};

fn deps(state: &AppState) -> ComposeDeps {
    ComposeDeps { llm: state.llm.clone(), model: None, now: None }
}

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<DashboardResponse> {
    let q = dashboard_query(&auth.scope(q, true)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    let user = to_public_user(&require_user(&store.db(), &q.user_id)?);
    ok(DashboardResponse { dashboard: resolve_dashboard(&store, &user, &deps(&state)).await? })
}

pub async fn post(State(state): State<Arc<AppState>>, auth: Auth, JsonBody(body): JsonBody) -> ApiResult<DashboardResponse> {
    let raw = auth.scope(body, true)?;
    let body = dashboard_request(&raw)?;
    auth.acting_as(&body.user_id)?;
    let store = state.store(&org_or_default(body.org_id))?;
    let user = to_public_user(&require_user(&store.db(), &body.user_id)?);
    if body.reset == Some(true) {
        store.db().delete_dashboard(&user.id)?;
        return ok(DashboardResponse { dashboard: resolve_dashboard(&store, &user, &deps(&state)).await? });
    }
    let parsed = body.dashboard.expect("schema guarantees a dashboard without reset");
    let known: HashSet<String> = store.db().list_nodes()?.iter().map(|n| n.id.clone()).collect();
    // sanitizeDashboard re-parses the raw spec the client sent, like the TS does with body.dashboard.
    let spec_value = raw.get("dashboard").cloned().unwrap_or(serde_json::Value::Null);
    let dashboard = sanitize_dashboard(&spec_value, parsed.origin, Some(&known), None)
        .ok_or_else(|| HttpError::bad_request("dashboard needs at least one valid widget"))?;
    store.db().save_dashboard(&user.id, &dashboard)?;
    ok(DashboardResponse { dashboard })
}

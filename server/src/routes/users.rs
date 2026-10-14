//! Port of `app/api/users/route.ts`: list people; create or update one (yourself, or anyone as an admin).

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::{org_query, upsert_user_request};
use crate::contract::types::{DashboardOrigin, UpsertUserResponse, User, UsersResponse};
use crate::db::store::to_public_user;
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, HttpError, JsonBody, QueryValue, ok};
use crate::steer::users::recompute_user_vectors;
use crate::text::slugify;

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<UsersResponse> {
    let q = org_query(&auth.scope(q, false)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    let users = store.db().list_users()?.iter().map(to_public_user).collect();
    ok(UsersResponse { users })
}

/// Their free-text role re-anchors their gravity right away.
pub async fn post(State(state): State<Arc<AppState>>, auth: Auth, JsonBody(body): JsonBody) -> ApiResult<UpsertUserResponse> {
    let body = upsert_user_request(&auth.scope(body, false)?)?;
    let store = state.store(&org_or_default(body.org_id))?;
    let id = body.id.clone().unwrap_or_else(|| slugify(&body.name));
    auth.acting_as(&id)?;
    {
        let db = store.db();
        // A new role means a new default dashboard; one they shaped by asking Orion stays.
        if let Some(before) = db.get_user(&id)? {
            if before.role != body.role && db.get_dashboard(&id)?.is_some_and(|d| d.origin == DashboardOrigin::Role) {
                db.delete_dashboard(&id)?;
            }
        }
        db.save_user(&User { id: id.clone(), name: body.name, role: body.role, team_description: body.team_description })?;
    }
    recompute_user_vectors(&store, state.embedder.as_ref()).await?;
    let user = store.db().get_user(&id)?.ok_or_else(HttpError::internal)?;
    ok(UpsertUserResponse { user: to_public_user(&user) })
}

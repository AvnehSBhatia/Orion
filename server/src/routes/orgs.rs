//! Port of `app/api/orgs/route.ts`. Signed in, GET lists only the caller's org and POST is refused (an org
//! made here would have no account that can reach it). With AUTH_DISABLED both behave as before auth.

use std::sync::Arc;

use axum::extract::State;

use crate::auth::Auth;
use crate::contract::schemas::{ID_RE, create_org_request};
use crate::contract::types::{Org, OrgResponse, OrgsResponse, User};
use crate::db::store::to_public_user;
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, HttpError, JsonBody, ok};
use crate::steer::users::recompute_user_vectors;
use crate::text::{js_take, slugify};
use crate::time::now_iso;

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth) -> ApiResult<OrgsResponse> {
    let only = auth.session().map(|s| s.org_id.clone());
    ok(OrgsResponse { orgs: state.list_orgs(only.as_deref())? })
}

pub async fn post(State(state): State<Arc<AppState>>, auth: Auth, JsonBody(body): JsonBody) -> ApiResult<OrgResponse> {
    if auth.session().is_some() {
        return Err(HttpError::forbidden("create orgs with POST /api/auth/signup or scripts/account.ts"));
    }
    let req = create_org_request(&body)?;
    let org_id = req.id.clone().unwrap_or_else(|| js_take(&slugify(&req.name), 40));
    if !ID_RE.is_match(&org_id) {
        return Err(HttpError::bad_request("name needs letters or digits, or pass an id"));
    }
    let org = Org { id: org_id, name: req.name, description: req.description, websites: req.websites, context: req.context, created_at: now_iso() };
    let store = state.create_org_store(&org)?;
    for m in &req.members {
        store.db().save_user(&User { id: slugify(&m.name), name: m.name.clone(), role: m.role.clone(), team_description: String::new() })?;
    }
    if !req.members.is_empty() {
        recompute_user_vectors(&store, state.embedder.as_ref()).await?;
    }
    let db = store.db();
    ok(OrgResponse { org: db.get_org()?.ok_or_else(HttpError::internal)?, users: db.list_users()?.iter().map(to_public_user).collect() })
}

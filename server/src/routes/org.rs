//! Port of `app/api/orgs/[orgId]/route.ts`: read the profile (same org), change it (org admins).

use std::sync::Arc;

use axum::extract::{Path, State};

use crate::auth::Auth;
use crate::contract::schemas::{org_id, update_org_request};
use crate::contract::types::{Org, OrgResponse};
use crate::db::store::{Db, to_public_user};
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, HttpError, JsonBody, ok};
use crate::time::now_iso;

fn org_of(db: &Db, id: &str) -> Result<Org, HttpError> {
    db.get_org()?.ok_or_else(|| HttpError::not_found(format!("org \"{id}\" has no profile yet. PATCH it with a name and description.")))
}

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, Path(raw): Path<String>) -> ApiResult<OrgResponse> {
    let id = org_id(&raw)?;
    auth.same_org(&id)?;
    let store = state.store(&id)?;
    let db = store.db();
    ok(OrgResponse { org: org_of(&db, &id)?, users: db.list_users()?.iter().map(to_public_user).collect() })
}

/// The model reads the new profile on the next capture; existing documents are not re-read.
pub async fn patch(State(state): State<Arc<AppState>>, auth: Auth, Path(raw): Path<String>, JsonBody(body): JsonBody) -> ApiResult<OrgResponse> {
    let id = org_id(&raw)?;
    auth.same_org(&id)?;
    auth.admin_only()?;
    let store = state.store(&id)?;
    let patch = update_org_request(&body)?;
    let db = store.db();
    let current = db.get_org()?;
    if current.is_none() && (patch.name.is_none() || patch.description.is_none()) {
        return Err(HttpError::bad_request("this org has no profile yet; send name and description"));
    }
    let cur = current.as_ref();
    db.save_org(&Org {
        id: id.clone(),
        name: patch.name.or_else(|| cur.map(|c| c.name.clone())).unwrap_or_default(),
        description: patch.description.or_else(|| cur.map(|c| c.description.clone())).unwrap_or_default(),
        websites: patch.websites.or_else(|| cur.map(|c| c.websites.clone())).unwrap_or_default(),
        context: patch.context.or_else(|| cur.map(|c| c.context.clone())).unwrap_or_default(),
        created_at: cur.map(|c| c.created_at.clone()).unwrap_or_else(now_iso),
    })?;
    ok(OrgResponse { org: org_of(&db, &id)?, users: db.list_users()?.iter().map(to_public_user).collect() })
}

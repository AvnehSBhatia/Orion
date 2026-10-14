//! Port of `app/api/sources/[id]/route.ts` (works for digest ids too).

use std::sync::Arc;

use axum::extract::{Path, State};

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::org_query;
use crate::contract::types::SourceResponse;
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, HttpError, QueryValue};

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, Path(id): Path<String>, QueryValue(q): QueryValue) -> ApiResult<SourceResponse> {
    let q = org_query(&auth.scope(q, false)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    let found = store.db().read_document(&id)?;
    found.map(axum::Json).ok_or_else(|| HttpError::not_found(format!("unknown source \"{id}\"")))
}

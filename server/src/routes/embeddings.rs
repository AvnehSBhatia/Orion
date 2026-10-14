//! Port of `app/api/embeddings/route.ts`: nodes and documents as a 3D point cloud.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::org_query;
use crate::contract::types::EmbeddingsResponse;
use crate::graph::projection::project_embeddings;
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, QueryValue, ok};

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<EmbeddingsResponse> {
    let q = org_query(&auth.scope(q, false)?)?;
    let org = org_or_default(q.org_id);
    let store = state.store(&org)?;
    ok(project_embeddings(&store.db(), &org)?)
}

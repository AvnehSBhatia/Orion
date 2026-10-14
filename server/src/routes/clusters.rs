//! Port of `app/api/clusters/route.ts`.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::org_query;
use crate::contract::types::ClustersResponse;
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, QueryValue, ok};
use crate::steer::context::public_clusters;

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue) -> ApiResult<ClustersResponse> {
    let q = org_query(&auth.scope(q, false)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    ok(ClustersResponse { clusters: public_clusters(&store.db())? })
}

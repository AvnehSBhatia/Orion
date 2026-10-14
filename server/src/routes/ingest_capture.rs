//! Port of `app/api/ingest/capture/route.ts`.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::capture_request;
use crate::contract::types::CaptureResponse;
use crate::ingest::pipeline::{CaptureBody, ingest_capture};
use crate::server::deps::{AppState, require_user};
use crate::server::http::{ApiResult, JsonBody, ok};

pub async fn post(State(state): State<Arc<AppState>>, auth: Auth, JsonBody(body): JsonBody) -> ApiResult<CaptureResponse> {
    let body = capture_request(&auth.scope(body, true)?)?;
    auth.acting_as(&body.user_id)?;
    let deps = state.ingest_deps(&org_or_default(body.org_id))?;
    require_user(&deps.store.db(), &body.user_id)?;
    let res = ingest_capture(
        &deps,
        CaptureBody { user_id: body.user_id, url: body.url, title: body.title, html: body.html, screenshot_b64: body.screenshot_b64 },
        None,
    )
    .await?;
    ok(res)
}

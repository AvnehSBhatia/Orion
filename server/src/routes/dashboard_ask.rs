//! Port of `app/api/dashboard/ask/route.ts` (48ff660): reshape the dashboard from one message and save it.
//! With `?stream=1` the answer is NDJSON: `{"draft":spec}` as soon as the instant draft exists, then
//! `{"dashboard":spec|null,"trace":{...}}` (or `{"dashboard":null,"error":...}`). Without it, one JSON body.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::dashboard_ask_request;
use crate::contract::types::{DashboardAskResponse, DashboardSpec};
use crate::db::store::to_public_user;
use crate::server::deps::{AppState, require_user};
use crate::server::http::{HttpError, JsonBody, QueryValue};
use crate::steer::dashboard::{AskDeps, ComposeDeps, ask_and_save_dashboard};

pub async fn post(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue, JsonBody(body): JsonBody) -> Result<Response, HttpError> {
    let body = dashboard_ask_request(&auth.scope(body, true)?)?;
    auth.acting_as(&body.user_id)?;
    let store = state.store(&org_or_default(body.org_id))?;
    let user = to_public_user(&require_user(&store.db(), &body.user_id)?);
    let compose = ComposeDeps { llm: state.llm.clone(), model: None, now: None };

    if q.get("stream").and_then(serde_json::Value::as_str) != Some("1") {
        let (dashboard, _trace) = ask_and_save_dashboard(&store, &user, &body.message, &AskDeps { compose, on_draft: None }).await?;
        return Ok(axum::Json(DashboardAskResponse { dashboard }).into_response());
    }

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<bytes::Bytes, std::io::Error>>();
    let line = |v: serde_json::Value| Ok(bytes::Bytes::from(format!("{v}\n")));
    let draft_tx = tx.clone();
    let on_draft = Arc::new(move |draft: &DashboardSpec| {
        let _ = draft_tx.send(line(json!({ "draft": draft })));
    });
    tokio::spawn(async move {
        let deps = AskDeps { compose, on_draft: Some(on_draft) };
        let msg = match tokio::spawn(async move { ask_and_save_dashboard(&store, &user, &body.message, &deps).await }).await {
            Ok(Ok((dashboard, trace))) => json!({ "dashboard": dashboard, "trace": trace }),
            Ok(Err(e)) => json!({ "dashboard": null, "error": e.to_string() }),
            Err(e) => json!({ "dashboard": null, "error": format!("dashboard ask failed: {e}") }),
        };
        let _ = tx.send(line(msg));
    });
    let stream = futures::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|item| (item, rx)) });
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/x-ndjson; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap())
}

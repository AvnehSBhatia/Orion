//! Port of `app/api/mcp/route.ts`: Streamable HTTP MCP (stateless, JSON responses). Needs a bearer token or
//! session (the org and person come from it; URL params are ignored). With AUTH_DISABLED they come from
//! `?orgId=&userId=` or the `x-orion-org` / `x-orion-user` headers.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::auth::authenticate;
use crate::contract::schemas::{DEFAULT_ORG, org_id};
use crate::server::deps::{AppState, require_user};
use crate::server::http::{HttpError, QueryValue};
use crate::server::mcp::{McpContext, handle_body};

pub async fn handle(State(state): State<Arc<AppState>>, method: Method, headers: HeaderMap, QueryValue(q): QueryValue, body: Bytes) -> Response {
    match serve(state, method, headers, q, body).await {
        Ok(r) => r,
        Err(e) => e.into_response(),
    }
}

async fn serve(state: Arc<AppState>, method: Method, headers: HeaderMap, q: Value, body: Bytes) -> Result<Response, HttpError> {
    let (org, user) = match authenticate(&state, &headers).await? {
        Some(p) => (p.org_id, p.user_id),
        None if !state.config.auth_disabled => {
            let mut res = HttpError::new(401, crate::auth::SIGN_IN_REQUIRED).into_response();
            res.headers_mut().insert(header::WWW_AUTHENTICATE, "Bearer realm=\"orion\"".parse().unwrap());
            return Ok(res);
        }
        None => {
            let pick = |k: &str, h: &str| q.get(k).and_then(Value::as_str).map(String::from).or_else(|| headers.get(h).and_then(|v| v.to_str().ok()).map(String::from));
            let org = org_id(&pick("orgId", "x-orion-org").unwrap_or_else(|| DEFAULT_ORG.into()))?;
            let user = pick("userId", "x-orion-user").filter(|u| !u.is_empty()).ok_or_else(|| HttpError::bad_request("userId is required"))?;
            (org, user)
        }
    };
    let store = state.store(&org)?;
    require_user(&store.db(), &user)?;
    if method != Method::POST {
        // Stateless server: no standalone SSE stream and no sessions to delete.
        return Ok((StatusCode::METHOD_NOT_ALLOWED, axum::Json(json!({ "jsonrpc": "2.0", "error": { "code": -32000, "message": "Method not allowed." }, "id": null }))).into_response());
    }
    let msg: Value = serde_json::from_slice(&body)
        .map_err(|_| HttpError::bad_request("body must be valid JSON"))?;
    let ctx = McpContext { store, embedder: state.embedder.clone(), user_id: user };
    Ok(match handle_body(&ctx, &msg).await {
        Some(v) => axum::Json(v).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    })
}

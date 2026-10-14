//! Every route from `app/api/**`, same paths and methods. Protected routes take [`Auth`](crate::auth::Auth)
//! (401 without a session cookie or bearer token unless AUTH_DISABLED); `/api/auth/*` and `/api/mcp` check
//! the caller themselves, like the TS `{ public: true }` routes. OPTIONS preflights are answered by the CORS
//! middleware before routing.

use std::sync::Arc;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{get, post};
use tower_http::catch_panic::CatchPanicLayer;

use crate::contract::schemas::DEFAULT_ORG;
use crate::server::deps::AppState;
use crate::server::http;

pub mod activity;
pub mod auth;
pub mod brief;
pub mod chat;
pub mod clusters;
pub mod context;
pub mod dashboard;
pub mod dashboard_ask;
pub mod embeddings;
pub mod feed;
pub mod graph;
pub mod ingest_capture;
pub mod ingest_code;
pub mod mcp;
pub mod org;
pub mod orgs;
pub mod source;
pub mod source_image;
pub mod users;

/// The org a validated request names; with auth on, `scope` already pinned it to the caller's org.
/// Only with AUTH_DISABLED can it still be missing, and then it is the demo org, as before auth.
pub fn org_or_default(org_id: Option<String>) -> String {
    org_id.unwrap_or_else(|| DEFAULT_ORG.to_string())
}

/// Every API path, as `(method, path)`, for docs and the router smoke test.
pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/activity"),
    ("GET", "/api/brief"),
    ("POST", "/api/chat"),
    ("GET", "/api/clusters"),
    ("GET", "/api/context"),
    ("GET", "/api/dashboard"),
    ("POST", "/api/dashboard"),
    ("POST", "/api/dashboard/ask"),
    ("GET", "/api/embeddings"),
    ("GET", "/api/feed"),
    ("GET", "/api/graph"),
    ("POST", "/api/ingest/capture"),
    ("POST", "/api/ingest/code"),
    ("GET", "/api/mcp"),
    ("POST", "/api/mcp"),
    ("DELETE", "/api/mcp"),
    ("GET", "/api/orgs"),
    ("POST", "/api/orgs"),
    ("GET", "/api/orgs/demo"),
    ("PATCH", "/api/orgs/demo"),
    ("GET", "/api/sources/src-x"),
    ("GET", "/api/sources/src-x/image"),
    ("GET", "/api/users"),
    ("POST", "/api/users"),
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/me"),
    ("POST", "/api/auth/accounts"),
    ("GET", "/api/auth/tokens"),
    ("POST", "/api/auth/tokens"),
    ("DELETE", "/api/auth/tokens/abc"),
];

pub fn router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .route("/api/activity", get(activity::get))
        .route("/api/brief", get(brief::get))
        .route("/api/chat", post(chat::post))
        .route("/api/clusters", get(clusters::get))
        .route("/api/context", get(context::get))
        .route("/api/dashboard", get(dashboard::get).post(dashboard::post))
        .route("/api/dashboard/ask", post(dashboard_ask::post))
        .route("/api/embeddings", get(embeddings::get))
        .route("/api/feed", get(feed::get))
        .route("/api/graph", get(graph::get))
        .route("/api/ingest/capture", post(ingest_capture::post))
        .route("/api/ingest/code", post(ingest_code::post))
        .route("/api/mcp", get(mcp::handle).post(mcp::handle).delete(mcp::handle))
        .route("/api/orgs", get(orgs::get).post(orgs::post))
        .route("/api/orgs/{org_id}", get(org::get).patch(org::patch))
        .route("/api/sources/{id}", get(source::get))
        .route("/api/sources/{id}/image", get(source_image::get))
        .route("/api/users", get(users::get).post(users::post))
        .route("/api/auth/signup", post(auth::signup))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/accounts", post(auth::accounts))
        .route("/api/auth/tokens", get(auth::list_tokens).post(auth::create_token))
        .route("/api/auth/tokens/{id}", axum::routing::delete(auth::delete_token))
        .fallback(http::not_found)
        .method_not_allowed_fallback(http::method_not_allowed)
        .with_state(state.clone());

    api.layer(DefaultBodyLimit::max(state.config.max_body_bytes))
        .layer(CatchPanicLayer::custom(http::panic_response))
        .layer(middleware::from_fn_with_state(state.cors.clone(), http::cors))
        .layer(middleware::from_fn(http::security_headers))
        .layer(tower_http::trace::TraceLayer::new_for_http())
}

#[cfg(test)]
mod tests;

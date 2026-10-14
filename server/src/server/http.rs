//! Port of `src/server/http.ts`: contract-shaped errors (`{error}`), CORS, plus security headers, the body
//! limit, and the JSON/query extractors every route uses.
//!
//! Module code returns `anyhow::Result`; an `HttpError` raised anywhere (`bail!(HttpError::new(503, ..))`)
//! keeps its status when it reaches a handler, because `From<anyhow::Error>` downcasts. Anything else is a
//! logged 500 "internal error", like the TS `errorStatus`.

use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header, request::Parts};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::Value;

use crate::config::Config;
use crate::contract::schemas::{ValidationError, query_value};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct HttpError {
    pub status: u16,
    pub message: String,
}

impl HttpError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        HttpError { status, message: message.into() }
    }
    pub fn bad_request(m: impl Into<String>) -> Self {
        Self::new(400, m)
    }
    pub fn unauthorized() -> Self {
        Self::new(401, "sign in required")
    }
    pub fn forbidden(m: impl Into<String>) -> Self {
        Self::new(403, m)
    }
    pub fn not_found(m: impl Into<String>) -> Self {
        Self::new(404, m)
    }
    pub fn internal() -> Self {
        Self::new(500, "internal error")
    }
}

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (status, axum::Json(serde_json::json!({ "error": self.message }))).into_response()
    }
}

impl From<ValidationError> for HttpError {
    fn from(e: ValidationError) -> Self {
        HttpError::new(400, e.to_string())
    }
}

impl From<serde_json::Error> for HttpError {
    fn from(_: serde_json::Error) -> Self {
        HttpError::new(400, "body must be valid JSON")
    }
}

impl From<anyhow::Error> for HttpError {
    fn from(err: anyhow::Error) -> Self {
        if let Some(h) = err.downcast_ref::<HttpError>() {
            return h.clone();
        }
        if let Some(v) = err.downcast_ref::<ValidationError>() {
            return HttpError::new(400, v.to_string());
        }
        tracing::error!("{err:#}");
        HttpError::internal()
    }
}

impl From<rusqlite::Error> for HttpError {
    fn from(err: rusqlite::Error) -> Self {
        anyhow::Error::from(err).into()
    }
}

pub type ApiResult<T> = Result<axum::Json<T>, HttpError>;

/// `Ok(Json(value))`
pub fn ok<T: Serialize>(value: T) -> ApiResult<T> {
    Ok(axum::Json(value))
}

/// The request body as a JSON value: invalid JSON is 400 "body must be valid JSON", too large is 413.
pub struct JsonBody(pub Value);

impl<S: Send + Sync> FromRequest<S> for JsonBody {
    type Rejection = HttpError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(req, state).await.map_err(|rej| {
            if rej.status() == StatusCode::PAYLOAD_TOO_LARGE {
                HttpError::new(413, "request body too large")
            } else {
                HttpError::bad_request("body must be valid JSON")
            }
        })?;
        Ok(JsonBody(serde_json::from_slice(&bytes)?))
    }
}

/// The query string as a JSON object of strings, like `Object.fromEntries(req.nextUrl.searchParams)`.
pub struct QueryValue(pub Value);

impl QueryValue {
    pub fn get(&self, k: &str) -> Option<&str> {
        self.0.get(k).and_then(Value::as_str)
    }
}

impl<S: Send + Sync> FromRequestParts<S> for QueryValue {
    type Rejection = HttpError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let pairs: Vec<(String, String)> =
            url::form_urlencoded::parse(parts.uri.query().unwrap_or("").as_bytes()).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        Ok(QueryValue(query_value(&pairs)))
    }
}

// ---- CORS ----

/// Origins allowed to call the API with credentials.
#[derive(Debug, Clone)]
pub struct CorsPolicy {
    pub ui_origins: Vec<String>,
    /// Empty: any `chrome-extension://` origin.
    pub extension_ids: Vec<String>,
}

impl CorsPolicy {
    pub fn from_config(c: &Config) -> Self {
        CorsPolicy { ui_origins: c.ui_origins.clone(), extension_ids: c.extension_ids.clone() }
    }

    pub fn allows(&self, origin: &str) -> bool {
        if let Some(id) = origin.strip_prefix("chrome-extension://") {
            let id = id.trim_end_matches('/');
            return self.extension_ids.is_empty() || self.extension_ids.iter().any(|e| e == id);
        }
        self.ui_origins.iter().any(|o| o == origin)
    }

    fn headers(&self, req_headers: &HeaderMap) -> Vec<(header::HeaderName, HeaderValue)> {
        let Some(origin) = req_headers.get(header::ORIGIN).and_then(|o| o.to_str().ok()) else { return vec![] };
        if !self.allows(origin) {
            return vec![];
        }
        let Ok(origin) = HeaderValue::from_str(origin) else { return vec![] };
        vec![
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, origin),
            (header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, PATCH, DELETE, OPTIONS")),
            (header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Content-Type, Authorization")),
            (header::ACCESS_CONTROL_ALLOW_CREDENTIALS, HeaderValue::from_static("true")),
            (header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("86400")),
        ]
    }
}

/// CORS for every route: preflights answer 204 before routing or auth; other responses get the headers.
pub async fn cors(axum::extract::State(policy): axum::extract::State<Arc<CorsPolicy>>, req: Request, next: Next) -> Response {
    let headers = policy.headers(req.headers());
    let mut res = if req.method() == Method::OPTIONS {
        Response::builder().status(StatusCode::NO_CONTENT).body(Body::empty()).unwrap()
    } else {
        next.run(req).await
    };
    let h = res.headers_mut();
    for (k, v) in headers {
        h.insert(k, v);
    }
    h.append(header::VARY, HeaderValue::from_static("Origin"));
    res
}

/// Security headers on every response (kept if a handler already set one).
pub async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    let defaults = [
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (header::REFERRER_POLICY, "no-referrer"),
        (header::X_FRAME_OPTIONS, "DENY"),
        (header::CONTENT_SECURITY_POLICY, "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"),
        (header::HeaderName::from_static("cross-origin-resource-policy"), "same-site"),
    ];
    for (k, v) in defaults {
        if !h.contains_key(&k) {
            h.insert(k, HeaderValue::from_static(v));
        }
    }
    res
}

/// A panicking handler (a `todo!()` stub) becomes a contract-shaped 500 instead of a dropped connection.
pub fn panic_response(err: Box<dyn std::any::Any + Send + 'static>) -> Response {
    let msg = err.downcast_ref::<String>().cloned().or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
    tracing::error!("handler panicked: {msg}");
    HttpError::internal().into_response()
}

pub async fn not_found() -> HttpError {
    HttpError::not_found("not found")
}

pub async fn method_not_allowed() -> HttpError {
    HttpError::new(405, "method not allowed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_keep_status_through_anyhow() {
        let e: HttpError = anyhow::Error::from(HttpError::new(503, "OPENROUTER_API_KEY is not set on the backend")).into();
        assert_eq!(e.status, 503);
        let e: HttpError = anyhow::anyhow!("boom").into();
        assert_eq!((e.status, e.message.as_str()), (500, "internal error"));
    }

    #[test]
    fn cors_policy() {
        let open = CorsPolicy { ui_origins: vec!["http://localhost:3000".into()], extension_ids: vec![] };
        assert!(open.allows("http://localhost:3000"));
        assert!(open.allows("chrome-extension://abc"));
        assert!(!open.allows("https://evil.example"));
        let pinned = CorsPolicy { extension_ids: vec!["abc".into()], ..open };
        assert!(pinned.allows("chrome-extension://abc"));
        assert!(!pinned.allows("chrome-extension://xyz"));
    }
}

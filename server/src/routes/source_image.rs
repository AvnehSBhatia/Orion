//! Port of `app/api/sources/[id]/image/route.ts`: the stored screenshot.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::org_query;
use crate::server::deps::AppState;
use crate::server::http::{HttpError, QueryValue};

pub fn content_type(buf: &[u8]) -> &'static str {
    if buf.len() >= 2 && buf[0] == 0x89 && buf[1] == 0x50 {
        return "image/png";
    }
    if buf.len() >= 12 && &buf[8..12] == b"WEBP" {
        return "image/webp";
    }
    "image/jpeg"
}

pub async fn get(State(state): State<Arc<AppState>>, auth: Auth, Path(id): Path<String>, QueryValue(q): QueryValue) -> Result<Response, HttpError> {
    let q = org_query(&auth.scope(q, false)?)?;
    let store = state.store(&org_or_default(q.org_id))?;
    let image = store.db().source_image(&id)?;
    let Some(image) = image else { return Err(HttpError::not_found(format!("no image for source \"{id}\""))) };
    Ok(([(header::CONTENT_TYPE, content_type(&image)), (header::CACHE_CONTROL, "private, max-age=3600")], image).into_response())
}

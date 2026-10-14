//! Port of `app/api/ingest/code/route.ts`. The commit author is matched to a person; no act-as check, since
//! the codebase agent attributes commits to their authors.

use std::sync::Arc;

use axum::extract::State;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::{MAX_DIFF_CHARS, code_ingest_request};
use crate::contract::types::CodeIngestResponse;
use crate::ingest::pipeline::{CodeBody, ingest_code};
use crate::server::deps::AppState;
use crate::server::http::{ApiResult, JsonBody, ok};

pub async fn post(State(state): State<Arc<AppState>>, auth: Auth, JsonBody(body): JsonBody) -> ApiResult<CodeIngestResponse> {
    let b = code_ingest_request(&auth.scope(body, false)?)?;
    let deps = state.ingest_deps(&org_or_default(b.org_id))?;
    let body = CodeBody { repo: b.repo, commit_sha: b.commit_sha, files: b.files, cards: b.cards, user_id: b.user_id, author: b.author };
    ok(ingest_code(&deps, body, MAX_DIFF_CHARS).await?)
}

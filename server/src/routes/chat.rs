//! Port of `app/api/chat/route.ts`. One model call over context retrieved up front. With `?stream=1` the
//! answer is server-sent events, framed as `web/lib/orion.ts` reads them: a `: open` comment, `delta` events
//! (`{text}`), an optional `timing` event, then `done` with the full ChatResponse, or `error` (`{error}`).
//! Unless `skipDashboard`, the dashboard ask runs alongside and its result rides in `dashboard`.

use std::collections::HashSet;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::json;

use super::org_or_default;
use crate::auth::Auth;
use crate::contract::schemas::chat_request;
use crate::contract::types::{ChatRequest, ChatResponse, Status, TurnRole, User, Why};
use crate::db::store::{Store, to_public_user};
use crate::graph::view::read_graph;
use crate::llm::chat::{ChatInput, MAX_ITEMS, OnDelta};
use crate::server::deps::{AppState, require_user};
use crate::server::http::{HttpError, JsonBody, QueryValue};
use crate::steer::context::{Context, ContextOptions, build_context};
use crate::steer::dashboard::{AskDeps, ComposeDeps, ask_and_save_dashboard};
use crate::time::{now_ms, parse_ms};

/// The local embedder queues behind swarm ingest; past this budget, answer from a lexical pick instead.
pub const CONTEXT_BUDGET_MS: u64 = 1_200;

static WORD3: Lazy<Regex> = Lazy::new(|| Regex::new(r"[a-z0-9]{3,}").unwrap());

fn words(text: &str) -> Vec<String> {
    WORD3.find_iter(&text.to_lowercase()).map(|m| m.as_str().to_string()).collect()
}

/// Context without embeddings: nodes and recent sources ranked by word overlap, risk, and freshness.
pub fn quick_context(store: &Store, q: &str) -> anyhow::Result<Context> {
    let wanted: HashSet<String> = words(q).into_iter().collect();
    let overlap = |text: &str| words(text).iter().filter(|w| wanted.contains(*w)).count() as f64;
    let risk = |s: Status| match s {
        Status::Blocked => 2.0,
        Status::AtRisk => 1.5,
        Status::Unknown => 0.5,
        _ => 0.0,
    };
    let db = store.db();
    let mut scored: Vec<(f64, _)> = read_graph(&db)?
        .nodes
        .into_iter()
        .map(|n| {
            let score = overlap(&format!("{} {}", n.label, n.summary)) * 3.0 + risk(n.status) + parse_ms(&n.updated_at).unwrap_or(0) as f64 / 1e13;
            (score, n)
        })
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    let items = scored.into_iter().take(MAX_ITEMS).map(|(_, n)| Why::new(n, "matches the question")).collect();
    let mut sources: Vec<(f64, _)> = vec![];
    for (i, s) in db.list_sources(None, 60)?.iter().enumerate() {
        let p = db.to_public_source(s)?;
        sources.push((overlap(&format!("{} {}", p.title, p.excerpt)) - i as f64 / 100.0, p));
    }
    sources.sort_by(|a, b| b.0.total_cmp(&a.0));
    Ok(Context { items, sources: sources.into_iter().take(5).map(|(_, s)| Why::new(s, "recent")).collect() })
}

async fn answer(state: Arc<AppState>, store: Arc<Store>, user: User, body: ChatRequest, on_delta: Option<OnDelta>, on_timing: Option<OnDelta>) -> anyhow::Result<ChatResponse> {
    let dashboard_task = (body.skip_dashboard != Some(true)).then(|| {
        let (store, user, message) = (store.clone(), user.clone(), body.message.clone());
        let deps = AskDeps { compose: ComposeDeps { llm: state.llm.clone(), model: None, now: None }, on_draft: None };
        tokio::spawn(async move { ask_and_save_dashboard(&store, &user, &message, &deps).await })
    });
    let t0 = now_ms();
    // A follow-up like "how would you fix this?" retrieves with the question it follows.
    let history = body.history.clone().unwrap_or_default();
    let prev = history.iter().rev().find(|t| t.role == TurnRole::User).map(|t| t.text.clone());
    let q = match prev {
        Some(p) => format!("{p}\n{}", body.message),
        None => body.message.clone(),
    };
    let opts = ContextOptions { k: MAX_ITEMS, ..Default::default() };
    let ctx_task = {
        let (store, embedder, uid, q) = (store.clone(), state.embedder.clone(), user.id.clone(), q.clone());
        tokio::spawn(async move { build_context(&store, embedder.as_ref(), &uid, &q, opts, now_ms()).await })
    };
    let context = match tokio::time::timeout(Duration::from_millis(CONTEXT_BUDGET_MS), ctx_task).await {
        Ok(Ok(Ok(c))) => c,
        Ok(Ok(Err(e))) => return Err(e),
        Ok(Err(join)) => return Err(anyhow::anyhow!("context failed: {join}")),
        Err(_) => quick_context(&store, &q)?,
    };
    if let Some(t) = &on_timing {
        t(&json!({ "contextMs": now_ms() - t0 }).to_string());
    }
    let (org, known_ids) = {
        let db = store.db();
        (db.get_org()?, db.list_nodes()?.iter().map(|n| n.id.clone()).collect::<HashSet<_>>())
    };
    let input = ChatInput {
        user,
        org,
        message: body.message.clone(),
        history,
        context,
        current_view: body.current_view.clone(),
        known_ids,
        now: None,
    };
    let mut res = state.chat.reply(input, on_delta).await?;
    res.dashboard = match dashboard_task {
        Some(t) => t.await.map_err(|e| anyhow::anyhow!("dashboard ask failed: {e}"))??.0,
        None => None,
    };
    Ok(res)
}

pub async fn post(State(state): State<Arc<AppState>>, auth: Auth, QueryValue(q): QueryValue, JsonBody(body): JsonBody) -> Result<Response, HttpError> {
    let body = chat_request(&auth.scope(body, true)?)?;
    auth.acting_as(&body.user_id)?;
    let store = state.store(&org_or_default(body.org_id.clone()))?;
    let user = to_public_user(&require_user(&store.db(), &body.user_id)?);

    if q.get("stream").and_then(serde_json::Value::as_str) != Some("1") {
        let res = answer(state, store, user, body, None, None).await?;
        return Ok(axum::Json(res).into_response());
    }

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
    // Flush headers now so the client can show the answer the moment the first token lands.
    let _ = tx.send(Event::default().comment("open"));
    let delta_tx = tx.clone();
    let on_delta: OnDelta = Arc::new(move |text: &str| {
        let _ = delta_tx.send(Event::default().event("delta").data(json!({ "text": text }).to_string()));
    });
    let timing_tx = tx.clone();
    let on_timing: OnDelta = Arc::new(move |payload: &str| {
        let _ = timing_tx.send(Event::default().event("timing").data(payload));
    });
    tokio::spawn(async move {
        let run = tokio::spawn(answer(state, store, user, body, Some(on_delta), Some(on_timing)));
        let event = match run.await {
            Ok(Ok(res)) => Event::default().event("done").data(serde_json::to_string(&res).unwrap_or_default()),
            Ok(Err(e)) => {
                let message = e.downcast_ref::<HttpError>().map(|h| h.message.clone()).unwrap_or_else(|| {
                    tracing::error!("chat failed: {e:#}");
                    "chat failed".into()
                });
                Event::default().event("error").data(json!({ "error": message }).to_string())
            }
            Err(e) => {
                tracing::error!("chat panicked: {e}");
                Event::default().event("error").data(json!({ "error": "chat failed" }).to_string())
            }
        };
        let _ = tx.send(event);
    });
    let stream = futures::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|e| (Ok::<_, Infallible>(e), rx)) });
    let mut res = Sse::new(stream).into_response();
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-transform"));
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream; charset=utf-8"));
    Ok(res)
}

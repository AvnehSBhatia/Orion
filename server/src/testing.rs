//! Port of `src/test/helpers.ts` and `src/test/llm.ts`, plus a test app builder. Available to unit tests and,
//! with the `testing` feature, to integration tests.

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use parking_lot::Mutex;
use serde_json::Value;
use tower::ServiceExt;

use crate::config::Config;
use crate::contract::types::{ChatResponse, Domain, NodeType, Status};
use crate::db::seed::seed_demo;
use crate::db::store::{ExtractedNode, GraphUpdate, Store};
use crate::ingest::image::{OcrFn, OcrResult};
use crate::ingest::pipeline::IngestDeps;
use crate::llm::chat::{ChatInput, ChatModel, OnDelta};
use crate::llm::embed::{Embedder, LocalHashEmbedder};
use crate::llm::extract::{CaptureInput, CodeInput, ExtractContext, Extractor, KnownNode};
use crate::llm::openrouter::{AssistantMessage, Choice, Completion, CompletionRequest, LlmClient, ToolCall, ToolFunctionCall};
use crate::server::deps::{AppState, Parts};

/// An in-memory store, optionally seeded with the demo org.
pub fn memory_store(seed: bool) -> Arc<Store> {
    let store = Store::memory().expect("in-memory store");
    if seed {
        seed_demo(&store.db(), false).expect("seed");
    }
    Arc::new(store)
}

/// An extracted node with the helper defaults (feature, engineering, "<label> summary", on track).
pub fn extracted(label: &str) -> ExtractedNode {
    ExtractedNode {
        label: label.into(),
        node_type: NodeType::Feature,
        domain: Domain::Engineering,
        summary: format!("{label} summary"),
        todo: None,
        read_links: vec![],
        owner: None,
        status: Status::OnTrack,
        sellable: None,
    }
}

/// What a fake extractor was asked.
#[derive(Debug, Clone, PartialEq)]
pub enum ExtractCall {
    Capture { input: CaptureInput, about: Option<ExtractContext> },
    Code { input: CodeInput, about: Option<ExtractContext> },
}

/// Extractor that returns a fixed update and records what it was asked.
pub struct FakeExtractor {
    pub update: Mutex<GraphUpdate>,
    pub calls: Mutex<Vec<ExtractCall>>,
}

impl FakeExtractor {
    pub fn new(update: GraphUpdate) -> Arc<Self> {
        Arc::new(FakeExtractor { update: Mutex::new(update), calls: Mutex::new(vec![]) })
    }
}

#[async_trait]
impl Extractor for FakeExtractor {
    async fn from_capture(&self, input: &CaptureInput, _known: &[KnownNode], about: Option<&ExtractContext>) -> Result<GraphUpdate> {
        self.calls.lock().push(ExtractCall::Capture { input: input.clone(), about: about.cloned() });
        Ok(self.update.lock().clone())
    }
    async fn from_code(&self, input: &CodeInput, _known: &[KnownNode], about: Option<&ExtractContext>) -> Result<GraphUpdate> {
        self.calls.lock().push(ExtractCall::Code { input: input.clone(), about: about.cloned() });
        Ok(self.update.lock().clone())
    }
}

/// No background work; OCR reads `ocr_text` off every screenshot (default "", so screenshots are kept).
pub fn deps(store: Arc<Store>, update: GraphUpdate, ocr_text: &str) -> (IngestDeps, Arc<FakeExtractor>) {
    let extractor = FakeExtractor::new(update);
    let text = ocr_text.to_string();
    let ocr: OcrFn = Arc::new(move |_img| {
        let text = text.clone();
        Box::pin(async move { OcrResult { confidence: if text.is_empty() { 0.0 } else { 90.0 }, text } })
    });
    let d = IngestDeps { store, embedder: Arc::new(LocalHashEmbedder::default()), extractor: extractor.clone(), background: None, ocr: Some(ocr) };
    (d, extractor)
}

/// One scripted model turn.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FakeTurn {
    pub content: Option<String>,
    /// (tool name, args)
    pub tool_calls: Vec<(String, Value)>,
}

impl FakeTurn {
    pub fn text(s: &str) -> Self {
        FakeTurn { content: Some(s.into()), tool_calls: vec![] }
    }
}

/// A completion whose content is this JSON, for structured-output calls.
pub fn json_turn(value: Value) -> FakeTurn {
    FakeTurn { content: Some(value.to_string()), tool_calls: vec![] }
}

pub type Requests = Arc<Mutex<Vec<CompletionRequest>>>;

/// Scripted OpenAI-compatible client: returns the queued turns in order and records every request.
pub struct FakeLlm {
    turns: Vec<FakeTurn>,
    repeat_last: bool,
    i: Mutex<usize>,
    pub requests: Requests,
}

#[async_trait]
impl LlmClient for FakeLlm {
    async fn complete(&self, req: CompletionRequest) -> Result<Completion> {
        self.requests.lock().push(req);
        let i = {
            let mut i = self.i.lock();
            *i += 1;
            *i
        };
        if self.turns.is_empty() || (!self.repeat_last && i > self.turns.len()) {
            anyhow::bail!("fakeLlm ran out of turns");
        }
        let turn = &self.turns[(i - 1).min(self.turns.len() - 1)];
        let tool_calls: Vec<ToolCall> = turn
            .tool_calls
            .iter()
            .enumerate()
            .map(|(j, (name, args))| ToolCall {
                id: format!("call_{i}_{j}"),
                call_type: "function".into(),
                function: ToolFunctionCall { name: name.clone(), arguments: args.to_string() },
            })
            .collect();
        let finish = if tool_calls.is_empty() { "stop" } else { "tool_calls" };
        let message = AssistantMessage { content: turn.content.clone(), tool_calls: (!tool_calls.is_empty()).then_some(tool_calls), ..Default::default() };
        Ok(Completion { choices: vec![Choice { finish_reason: Some(finish.into()), message }] })
    }
}

pub fn fake_llm(turns: Vec<FakeTurn>, repeat_last: bool) -> (Arc<FakeLlm>, Requests) {
    let requests: Requests = Arc::new(Mutex::new(vec![]));
    (Arc::new(FakeLlm { turns, repeat_last, i: Mutex::new(0), requests: requests.clone() }), requests)
}

/// A chat model that always answers `reply` (streamed as one delta).
pub struct FakeChat {
    pub reply: String,
}

#[async_trait]
impl ChatModel for FakeChat {
    async fn reply(&self, _input: ChatInput, on_delta: Option<OnDelta>) -> Result<ChatResponse> {
        if let Some(d) = on_delta {
            d(&self.reply);
        }
        Ok(ChatResponse { reply: self.reply.clone(), view_command: None, dashboard: None, sources: vec![], actions: vec![] })
    }
}

/// A full app on a temp data dir: local embedder, a fake LLM that has no turns, fake extractor and chat.
pub struct TestApp {
    pub state: Arc<AppState>,
    pub router: Router,
    pub dir: tempfile::TempDir,
}

pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
}

impl TestApp {
    pub fn new() -> TestApp {
        Self::with_config(|_| {})
    }

    pub fn with_config(edit: impl FnOnce(&mut Config)) -> TestApp {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = Config::for_tests(dir.path());
        edit(&mut config);
        let (llm, _) = fake_llm(vec![], false);
        let embedder: Arc<dyn Embedder> = Arc::new(LocalHashEmbedder::default());
        let state = AppState::with_parts(
            config,
            Parts {
                embedder,
                llm,
                extractor: FakeExtractor::new(GraphUpdate::default()),
                chat: Arc::new(FakeChat { reply: "ok".into() }),
                background: false,
            },
        )
        .expect("app state");
        let router = crate::routes::router(state.clone());
        TestApp { state, router, dir }
    }

    /// Sends one request. `body` None sends no body; `token` goes in `Authorization: Bearer`.
    pub async fn request(&self, method: Method, path: &str, body: Option<Value>, token: Option<&str>) -> TestResponse {
        self.request_with(method, path, body, |h| {
            if let Some(t) = token {
                h.insert("authorization", format!("Bearer {t}").parse().unwrap());
            }
        })
        .await
    }

    pub async fn request_with(&self, method: Method, path: &str, body: Option<Value>, headers: impl FnOnce(&mut HeaderMap)) -> TestResponse {
        let mut req = Request::builder().method(method).uri(path);
        let mut h = HeaderMap::new();
        headers(&mut h);
        for (k, v) in h.iter() {
            req = req.header(k, v);
        }
        let req = match body {
            Some(b) => req.header("content-type", "application/json").body(Body::from(b.to_string())).unwrap(),
            None => req.body(Body::empty()).unwrap(),
        };
        let res = self.router.clone().oneshot(req).await.expect("router");
        let status = res.status();
        let headers = res.headers().clone();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
        TestResponse { status, headers, body }
    }

    /// Creates an account directly (and the person in the org), returning a session token.
    pub fn account(&self, username: &str, password: &str, org: &str, user: &str, admin: bool) -> String {
        let store = self.state.store(org).unwrap_or_else(|_| {
            self.state
                .create_org_store(&crate::contract::types::Org {
                    id: org.into(),
                    name: org.into(),
                    description: org.into(),
                    websites: vec![],
                    context: String::new(),
                    created_at: crate::time::now_iso(),
                })
                .expect("org")
        });
        crate::routes::auth::ensure_person(&store, user, None, None).unwrap();
        self.state.auth.create_account(username, password, org, user, admin).expect("account");
        self.state.auth.issue_token(username, crate::auth::TokenKind::Session, "test").unwrap().0
    }
}

impl Default for TestApp {
    fn default() -> Self {
        Self::new()
    }
}

//! Port of `src/llm/chat.ts`. STUB: signatures and constants are final; bodies are `todo!()`.
//! Tests to port: `src/llm/chat.test.ts`, `src/llm/leaked.test.ts`.
//!
//! Streaming contract used by `routes::chat`: `reply(input, Some(on_delta))` calls `on_delta` with each chunk
//! of visible answer text (the ACTIONS line held back), then returns the full `ChatResponse`.
#![allow(unused_variables, unused_imports, dead_code)]

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use futures::future::BoxFuture;
use serde_json::{Map, Value};

use super::openrouter::{CompletionRequest, LlmClient};
use crate::contract::types::{ChatAction, ChatResponse, ChatTurn, Org, PublicNode, Source, User, ViewCommand};
use crate::steer::context::Context;

pub struct ChatInput {
    pub user: User,
    /// The org profile, so answers use the org's own names for things.
    pub org: Option<Org>,
    pub message: String,
    /// Earlier turns, oldest first (at most 6), so follow-ups resolve "this" and "it".
    pub history: Vec<ChatTurn>,
    /// Retrieved before the model runs (build_context), so one model call is enough.
    pub context: Context,
    pub current_view: Option<ViewCommand>,
    /// Every node id in the graph, so the view can only point at real stars.
    pub known_ids: HashSet<String>,
    /// ms since epoch; None is now.
    pub now: Option<i64>,
}

/// Called with each chunk of reply text as the model writes it (raw, citations not yet renumbered).
pub type OnDelta = Arc<dyn Fn(&str) + Send + Sync>;

#[async_trait]
pub trait ChatModel: Send + Sync {
    async fn reply(&self, input: ChatInput, on_delta: Option<OnDelta>) -> Result<ChatResponse>;
}

/// Streams one completion's text, calling on_delta per chunk; resolves with the whole text.
pub type Streamer = Arc<dyn Fn(CompletionRequest, OnDelta) -> BoxFuture<'static, Result<String>> + Send + Sync>;

/// The model for interactive answers and dashboard edits (OPENROUTER_FAST_MODEL, default gemini-2.5-flash-lite).
pub fn fast_model() -> String {
    crate::config::config().fast_model.clone()
}

pub const MAX_ITEMS: usize = 8;
pub const MAX_SOURCES: usize = 5;
pub const EXCERPT_CHARS: usize = 300;
/// Room for two sentences plus the ACTIONS line.
pub const MAX_TOKENS: u32 = 300;
pub const MAX_ACTIONS: usize = 3;
pub const ACTION_TAIL: &str = "ACTIONS:";
pub const MAX_CITATIONS: usize = 3;

/// Drops tool markup some models (DeepSeek) write into the text.
pub fn strip_leaked(text: &str) -> String {
    todo!("port stripLeaked from src/llm/chat.ts")
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeakedCall {
    pub name: String,
    pub args: Map<String, Value>,
}

/// Recovers tool calls a model wrote as DSML markup.
pub fn parse_leaked_calls(text: &str) -> Vec<LeakedCall> {
    todo!("port parseLeakedCalls from src/llm/chat.ts")
}

pub fn first_name(name: &str) -> String {
    todo!("port firstName from src/llm/chat.ts")
}

/// The system prompt: the person's own chief of staff, framed by the role they wrote for themselves.
pub fn chat_prompt(user: &User, org: Option<&Org>) -> String {
    todo!("port chatPrompt from src/llm/chat.ts")
}

pub fn sanitize_view(raw: &Value, known_ids: &HashSet<String>) -> Option<ViewCommand> {
    todo!("port sanitizeView from src/llm/chat.ts")
}

/// Gives every document the model sees a short stable handle (S1, S2, ...) for citations.
#[derive(Debug, Clone, Default)]
pub struct Handles {
    by_id: HashMap<String, String>,
    /// handle -> source
    pub sources: HashMap<String, Source>,
}

impl Handles {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, s: &Source) -> String {
        todo!("port Handles.add from src/llm/chat.ts")
    }

    /// The compact JSON the model sees for one source (handle, title, author, createdAt, why, excerpt, changes).
    pub fn brief(&mut self, s: &Source, why: Option<&str>) -> Value {
        todo!("port Handles.brief from src/llm/chat.ts")
    }

    /// Renumbers cited handles in order of first use: [S4] then [S2] become [1] and [2].
    pub fn cite(&self, reply: &str) -> (String, Vec<Source>) {
        todo!("port Handles.cite from src/llm/chat.ts")
    }
}

/// At most `max` cited sources: citations past the max-th distinct source are dropped.
pub fn cap_citations(reply: &str, cited: &[Source], max: usize) -> (String, Vec<Source>) {
    todo!("port capCitations from src/llm/chat.ts")
}

/// Where the visible answer ends: before the ACTIONS line, holding back a partial "ACTIO" and trailing whitespace.
pub fn visible_end(text: &str) -> usize {
    todo!("port visibleEnd from src/llm/chat.ts")
}

/// Splits the reply from its ACTIONS line: (body, tail).
pub fn split_actions(text: &str) -> (String, String) {
    todo!("port splitActions from src/llm/chat.ts")
}

/// Parses `open:S2 (Label) | ask:question (Label) | show:request (Label)` into at most 3 real actions.
pub fn parse_actions(tail: &str, sources: &HashMap<String, Source>, items: &[PublicNode], known_ids: &HashSet<String>) -> Vec<ChatAction> {
    todo!("port parseActions from src/llm/chat.ts")
}

/// OpenRouter with stream: true, read as server-sent events.
pub fn open_router_stream(key: Option<String>, http: reqwest::Client) -> Streamer {
    todo!("port openRouterStream from src/llm/chat.ts")
}

/// One model call, no tools: the context is retrieved up front, so the answer can start at once.
pub struct LlmChat {
    pub llm: Arc<dyn LlmClient>,
    pub model: String,
    /// Set for the real OpenRouter client; fakes answer through `llm.complete`.
    pub streamer: Option<Streamer>,
}

impl LlmChat {
    pub fn new(llm: Arc<dyn LlmClient>, model: impl Into<String>, streamer: Option<Streamer>) -> Self {
        LlmChat { llm, model: model.into(), streamer }
    }
}

#[async_trait]
impl ChatModel for LlmChat {
    async fn reply(&self, input: ChatInput, on_delta: Option<OnDelta>) -> Result<ChatResponse> {
        todo!("port LlmChat.reply from src/llm/chat.ts")
    }
}

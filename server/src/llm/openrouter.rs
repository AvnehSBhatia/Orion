//! Port of `src/llm/openrouter.ts`: the OpenAI-compatible chat completions shape callers depend on,
//! `OpenRouterClient` (with the "reasoning is mandatory" retry), and `complete_json`.

use std::collections::HashSet;

use anyhow::{Result, bail};
use async_trait::async_trait;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::server::http::HttpError;

pub const CHAT_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolFunctionCall {
    pub name: String,
    /// JSON-encoded arguments.
    pub arguments: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type", default = "function_type")]
    pub call_type: String,
    pub function: ToolFunctionCall,
}

fn function_type() -> String {
    "function".into()
}

/// The assistant turn: text and/or tool calls, plus anything else the provider sent (kept for echoing back).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct AssistantMessage {
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum ChatMessage {
    System { content: String },
    User { content: String },
    Assistant(AssistantMessage),
    Tool { tool_call_id: String, content: String },
}

impl ChatMessage {
    pub fn system(c: impl Into<String>) -> Self {
        ChatMessage::System { content: c.into() }
    }
    pub fn user(c: impl Into<String>) -> Self {
        ChatMessage::User { content: c.into() }
    }
    pub fn assistant(c: impl Into<String>) -> Self {
        ChatMessage::Assistant(AssistantMessage { content: Some(c.into()), ..Default::default() })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    pub description: String,
    pub parameters: Value,
    pub strict: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: ToolFunction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Choice {
    pub finish_reason: Option<String>,
    pub message: AssistantMessage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Completion {
    pub choices: Vec<Choice>,
}

impl Completion {
    /// `choices[0].message.content`
    pub fn content(&self) -> Option<&str> {
        self.choices.first().and_then(|c| c.message.content.as_deref())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonSchemaFormat {
    pub name: String,
    pub strict: bool,
    pub schema: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResponseFormat {
    #[serde(rename = "type")]
    pub format_type: String,
    pub json_schema: JsonSchemaFormat,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tools: Option<Vec<ToolDef>>,
    /// "auto" | "none" | "required"
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_choice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub response_format: Option<ResponseFormat>,
}

/// OpenAI-compatible chat completions, the only shape callers depend on.
#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn complete(&self, req: CompletionRequest) -> Result<Completion>;

    /// The real OpenRouter client streams chat replies; fakes return false and are called through `complete`.
    fn supports_streaming(&self) -> bool {
        false
    }
}

/// `{ anyOf: [schema, { type: "null" }] }`
pub fn nullable(schema: Value) -> Value {
    json!({ "anyOf": [schema, { "type": "null" }] })
}

pub fn tool(name: &str, description: &str, parameters: Value) -> ToolDef {
    ToolDef { tool_type: "function".into(), function: ToolFunction { name: name.into(), description: description.into(), parameters, strict: true } }
}

pub struct OpenRouterClient {
    key: Option<String>,
    http: reqwest::Client,
    /// Models that rejected `reasoning: { enabled: false }`; requests to them omit it.
    reasoning_required: Mutex<HashSet<String>>,
}

impl OpenRouterClient {
    pub fn new(key: Option<String>) -> Self {
        OpenRouterClient { key, http: reqwest::Client::new(), reasoning_required: Mutex::new(HashSet::new()) }
    }

    pub fn from_config(c: &crate::config::Config) -> Self {
        Self::new(c.open_router_key.clone())
    }

    pub fn key(&self) -> Option<&str> {
        self.key.as_deref()
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// The request body: optional reasoning-off, the request, and `provider.require_parameters`.
    pub fn body(req: &CompletionRequest, reasoning_off: bool) -> Result<Value> {
        let mut body = Map::new();
        if reasoning_off {
            body.insert("reasoning".into(), json!({ "enabled": false }));
        }
        if let Value::Object(m) = serde_json::to_value(req)? {
            body.extend(m);
        }
        body.insert("provider".into(), json!({ "require_parameters": true }));
        Ok(Value::Object(body))
    }

    async fn send(&self, key: &str, req: &CompletionRequest, reasoning_off: bool) -> Result<reqwest::Response, reqwest::Error> {
        self.http
            .post(CHAT_URL)
            .bearer_auth(key)
            .header("X-Title", "Orion")
            .json(&Self::body(req, reasoning_off).unwrap_or(Value::Null))
            .send()
            .await
    }
}

fn provider_failed(status: u16) -> anyhow::Error {
    HttpError::new(if status == 429 { 429 } else { 502 }, "model provider failed").into()
}

#[async_trait]
impl LlmClient for OpenRouterClient {
    async fn complete(&self, req: CompletionRequest) -> Result<Completion> {
        let Some(key) = self.key.as_deref() else { bail!(HttpError::new(503, "OPENROUTER_API_KEY is not set on the backend")) };
        let required = self.reasoning_required.lock().contains(&req.model);
        let mut res = match self.send(key, &req, !required).await {
            Ok(r) => r,
            Err(err) => {
                tracing::error!("OpenRouter unreachable: {err}");
                bail!(HttpError::new(502, "model provider failed"));
            }
        };
        // Some models refuse to run without reasoning; remember that and send it their way.
        if res.status().as_u16() == 400 && !required {
            let text = res.text().await.unwrap_or_default();
            if text.to_lowercase().contains("reasoning is mandatory") {
                self.reasoning_required.lock().insert(req.model.clone());
                res = match self.send(key, &req, false).await {
                    Ok(r) => r,
                    Err(err) => {
                        tracing::error!("OpenRouter unreachable: {err}");
                        bail!(HttpError::new(502, "model provider failed"));
                    }
                };
            } else {
                tracing::error!("OpenRouter 400: {}", crate::text::js_take(&text, 500));
                return Err(provider_failed(400));
            }
        }
        let status = res.status().as_u16();
        if !res.status().is_success() {
            let text = res.text().await.unwrap_or_default();
            tracing::error!("OpenRouter {status}: {}", crate::text::js_take(&text, 500));
            return Err(provider_failed(status));
        }
        let json: Value = res.json().await.map_err(|e| {
            tracing::error!("OpenRouter returned unreadable JSON: {e}");
            anyhow::Error::from(HttpError::new(502, "model provider failed"))
        })?;
        match serde_json::from_value::<Completion>(json.clone()) {
            Ok(c) if !c.choices.is_empty() => Ok(c),
            _ => {
                tracing::error!("OpenRouter returned no choices: {:?}", json.pointer("/error/message"));
                bail!(HttpError::new(502, "model provider failed"))
            }
        }
    }

    fn supports_streaming(&self) -> bool {
        true
    }
}

#[derive(Debug, Clone)]
pub struct JsonCall<'a> {
    pub model: &'a str,
    pub name: &'a str,
    pub schema: Value,
    pub system: &'a str,
    pub user: &'a str,
    /// default 3000
    pub max_tokens: Option<u32>,
}

/// Strips a ```json fence.
fn unfence(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix("```json").or_else(|| s.strip_prefix("```")).unwrap_or(s);
    let s = s.trim_start();
    s.strip_suffix("```").unwrap_or(s).trim_end()
}

/// One structured answer under a strict JSON schema. Retries once on unparseable output, then 422.
/// The result still goes through validation at the call site.
pub async fn complete_json(llm: &dyn LlmClient, call: JsonCall<'_>) -> Result<Value> {
    for _ in 0..2 {
        let res = llm
            .complete(CompletionRequest {
                model: call.model.into(),
                max_tokens: Some(call.max_tokens.unwrap_or(3000)),
                temperature: Some(0.0),
                messages: vec![ChatMessage::system(call.system), ChatMessage::user(call.user)],
                response_format: Some(ResponseFormat {
                    format_type: "json_schema".into(),
                    json_schema: JsonSchemaFormat { name: call.name.into(), strict: true, schema: call.schema.clone() },
                }),
                ..Default::default()
            })
            .await?;
        let Some(content) = res.content().map(str::trim).filter(|c| !c.is_empty()) else { continue };
        match serde_json::from_str::<Value>(unfence(content)) {
            Ok(v) => return Ok(v),
            Err(_) => tracing::error!("Model returned non-JSON for {}: {}", call.name, crate::text::js_take(content, 200)),
        }
    }
    bail!(HttpError::new(422, format!("model did not return {}", call.name)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{FakeTurn, fake_llm, json_turn};

    #[test]
    fn messages_serialize_like_openai() {
        let m = serde_json::to_value(ChatMessage::user("hi")).unwrap();
        assert_eq!(m, json!({"role": "user", "content": "hi"}));
        let a = serde_json::to_value(ChatMessage::Assistant(AssistantMessage::default())).unwrap();
        assert_eq!(a, json!({"role": "assistant", "content": null}));
        let body = OpenRouterClient::body(&CompletionRequest { model: "m".into(), ..Default::default() }, true).unwrap();
        assert_eq!(body, json!({"reasoning": {"enabled": false}, "model": "m", "messages": [], "provider": {"require_parameters": true}}));
    }

    #[tokio::test]
    async fn complete_json_retries_then_422s() {
        let (llm, requests) = fake_llm(vec![FakeTurn::text("not json"), json_turn(json!({"a": 1}))], false);
        let call = JsonCall { model: "m", name: "thing", schema: json!({}), system: "s", user: "u", max_tokens: None };
        assert_eq!(complete_json(llm.as_ref(), call.clone()).await.unwrap(), json!({"a": 1}));
        assert_eq!(requests.lock().len(), 2);
        let (llm, _) = fake_llm(vec![FakeTurn::text("```json\n{\"b\":2}\n```")], false);
        assert_eq!(complete_json(llm.as_ref(), call.clone()).await.unwrap(), json!({"b": 2}));
        let (llm, _) = fake_llm(vec![FakeTurn::text("nope")], true);
        let err: HttpError = complete_json(llm.as_ref(), call).await.unwrap_err().into();
        assert_eq!((err.status, err.message.as_str()), (422, "model did not return thing"));
    }

    #[tokio::test]
    async fn no_key_is_503() {
        let c = OpenRouterClient::new(None);
        let err: HttpError = c.complete(CompletionRequest::default()).await.unwrap_err().into();
        assert_eq!(err.status, 503);
    }
}

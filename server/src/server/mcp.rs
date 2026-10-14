//! Port of `src/server/mcp.ts`: a read-only MCP server (stateless Streamable HTTP, JSON responses) for one org
//! and one person. The protocol layer here is complete; the tools call `steer::*`, so they work once those
//! modules are ported. The org and person come from the caller's Bearer token, not the URL.
//!
//! Pending from the TS side: a `context_for_task` tool is being added there; port it when it lands.

use std::sync::Arc;

use anyhow::Result;
use serde_json::{Value, json};

use crate::db::store::Store;
use crate::graph::view::read_graph;
use crate::llm::embed::Embedder;
use crate::steer::context::{ContextOptions, build_context, find_nodes, find_sources, public_clusters};
use crate::steer::feed::feed_for;
use crate::steer::filters::node_filter;
use crate::time::now_ms;

pub const INSTRUCTIONS: &str = "Orion holds the latest work context for one person in one org: what teammates captured from web pages and screenshots, what they committed, and the work graph built from it, ranked for this person.
Call get_my_context at the start of a task, with the task as the query. Call whats_new to catch up on what others changed that affects this person. Cite sources by their ref (URL or repo@sha) when you rely on them.
Everything here is read only.";

pub const PROTOCOL_VERSION: &str = "2025-06-18";
const SUPPORTED_VERSIONS: [&str; 4] = ["2025-06-18", "2025-03-26", "2024-11-05", "2025-11-25"];

fn read_only() -> Value {
    json!({ "readOnlyHint": true, "openWorldHint": false })
}

/// The tool list, with JSON schemas equivalent to the zod input schemas.
pub fn tools() -> Value {
    let statuses = json!(crate::contract::types::Status::NAMES);
    let domains = json!(crate::contract::types::Domain::NAMES);
    let types = json!(crate::contract::types::NodeType::NAMES);
    json!([
        {
            "name": "get_my_context",
            "title": "Get my context",
            "description": "The most relevant and most recent work items and source documents for this person, for an optional question or task. Start here.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string", "description": "The task or question. Omit for a general catch up." },
                "limit": { "type": "integer", "minimum": 1, "maximum": 30, "description": "Work items to return, default 16." }
            }},
            "annotations": read_only()
        },
        {
            "name": "whats_new",
            "title": "What's new for me",
            "description": "Documents and commits other people added recently that affect this person, with why each one matters.",
            "inputSchema": { "type": "object", "properties": {
                "sinceHours": { "type": "number", "exclusiveMinimum": 0, "maximum": 2160, "description": "Look back this many hours, default 72." },
                "limit": { "type": "integer", "minimum": 1, "maximum": 50, "description": "Default 15." }
            }},
            "annotations": read_only()
        },
        {
            "name": "find_items",
            "title": "Find work items",
            "description": "Filter the work graph by status, sellable, domain, type, or recency, ranked for this person. Status includes risk passed down from blocked work.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string" },
                "statuses": { "type": "array", "items": { "type": "string", "enum": statuses } },
                "sellable": { "type": "boolean" },
                "domains": { "type": "array", "items": { "type": "string", "enum": domains } },
                "types": { "type": "array", "items": { "type": "string", "enum": types } },
                "updatedWithinHours": { "type": "number", "exclusiveMinimum": 0 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
            }},
            "annotations": read_only()
        },
        {
            "name": "search_sources",
            "title": "Search source documents",
            "description": "Search captured pages, screenshots, and commits, ranked for this person. Returns excerpts; use get_source for full text.",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string" },
                "sinceHours": { "type": "number", "exclusiveMinimum": 0 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
            }},
            "annotations": read_only()
        },
        {
            "name": "get_source",
            "title": "Get a source document",
            "description": "Full text of one captured page, commit, or digest by id, with what it changed. Includes text read off the screenshot. A digest lists the documents it merges.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
            "annotations": read_only()
        },
        {
            "name": "list_areas",
            "title": "List org areas",
            "description": "The named areas of this org (for example a team or workstream), each a cluster of related documents and work items. Questions are routed to the nearest area.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": read_only()
        },
        {
            "name": "get_item",
            "title": "Get a work item",
            "description": "One work item by id with its direct links and the documents behind it, newest first.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
            "annotations": read_only()
        }
    ])
}

/// One org and one person, as the token says.
pub struct McpContext {
    pub store: Arc<Store>,
    pub embedder: Arc<dyn Embedder>,
    pub user_id: String,
}

fn text_result(value: &Value) -> Value {
    json!({ "content": [{ "type": "text", "text": value.to_string() }] })
}

fn tool_error(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

fn int_arg(args: &Value, key: &str, min: f64, max: f64) -> Result<Option<usize>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64() {
            Some(n) if n.fract() == 0.0 && n >= min && n <= max => Ok(Some(n as usize)),
            _ => Err(format!("{key} must be an integer from {min} to {max}")),
        },
    }
}

fn num_arg(args: &Value, key: &str, max: Option<f64>) -> Result<Option<f64>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64() {
            Some(n) if n > 0.0 && max.is_none_or(|m| n <= m) => Ok(Some(n)),
            _ => Err(format!("{key} must be a positive number")),
        },
    }
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

/// Runs one tool. `Ok(Err(msg))` is a tool-level input error returned to the client with isError.
pub async fn call_tool(ctx: &McpContext, name: &str, args: &Value) -> Result<Result<Value, String>> {
    let now = now_ms();
    let McpContext { store, embedder, user_id } = ctx;
    let embedder = embedder.as_ref();
    macro_rules! arg {
        ($e:expr) => {
            match $e {
                Ok(v) => v,
                Err(m) => return Ok(Err(m)),
            }
        };
    }
    let out = match name {
        "get_my_context" => {
            let limit = arg!(int_arg(args, "limit", 1.0, 30.0)).unwrap_or(16);
            let q = str_arg(args, "query").unwrap_or("");
            let c = build_context(store, embedder, user_id, q, ContextOptions { k: limit, ..Default::default() }, now).await?;
            let items: Vec<Value> = c
                .items
                .iter()
                .map(|n| {
                    let mut v = serde_json::to_value(n).unwrap_or(Value::Null);
                    if let Value::Object(m) = &mut v {
                        for k in ["readLinks", "sourceKind", "sourceRef"] {
                            m.remove(k);
                        }
                    }
                    v
                })
                .collect();
            json!({ "items": items, "sources": c.sources })
        }
        "whats_new" => {
            let since = arg!(num_arg(args, "sinceHours", Some(2160.0))).unwrap_or(72.0);
            let limit = arg!(int_arg(args, "limit", 1.0, 50.0)).unwrap_or(15);
            json!({ "items": feed_for(store, embedder, user_id, since, limit, now).await? })
        }
        "find_items" => {
            let limit = arg!(int_arg(args, "limit", 1.0, 50.0)).unwrap_or(10);
            let filter = arg!(node_filter(args).map_err(|e| e.to_string()));
            json!({ "items": find_nodes(store, embedder, user_id, str_arg(args, "query"), limit, &filter, now).await? })
        }
        "search_sources" => {
            let limit = arg!(int_arg(args, "limit", 1.0, 20.0)).unwrap_or(5);
            let since = arg!(num_arg(args, "sinceHours", None));
            json!({ "sources": find_sources(store, embedder, user_id, str_arg(args, "query"), limit, since, now).await? })
        }
        "get_source" => {
            let Some(id) = str_arg(args, "id") else { return Ok(Err("id is required".into())) };
            match store.db().read_document(id)? {
                Some(d) => serde_json::to_value(d)?,
                None => json!({ "error": format!("unknown source {id}") }),
            }
        }
        "list_areas" => json!({ "areas": public_clusters(&store.db())? }),
        "get_item" => {
            let Some(id) = str_arg(args, "id") else { return Ok(Err("id is required".into())) };
            let db = store.db();
            let graph = read_graph(&db)?;
            let Some(node) = graph.nodes.iter().find(|n| n.id == id) else {
                return Ok(Ok(json!({ "error": format!("unknown item {id}") })));
            };
            let label = |nid: &str| graph.nodes.iter().find(|n| n.id == nid).map(|n| n.label.clone());
            let links: Vec<Value> = graph
                .edges
                .iter()
                .filter(|e| e.source == id || e.target == id)
                .map(|e| json!({ "from": label(&e.source), "relation": e.relation, "to": label(&e.target) }))
                .collect();
            let mut sources = vec![];
            for sid in db.source_ids_for_node(id, 5)? {
                if let Some(s) = db.get_source(&sid)? {
                    sources.push(db.to_public_source(&s)?);
                }
            }
            json!({ "item": node, "links": links, "sources": sources })
        }
        other => return Ok(Err(format!("unknown tool {other}"))),
    };
    Ok(Ok(out))
}

fn rpc_result(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Handles one JSON-RPC message. None for notifications (no response body).
pub async fn handle_message(ctx: &McpContext, msg: &Value) -> Option<Value> {
    let Some(method) = msg.get("method").and_then(Value::as_str) else {
        // A response or garbage: nothing to answer unless it carried an id.
        return msg.get("id").map(|id| rpc_error(id, -32600, "Invalid Request"));
    };
    let id = msg.get("id")?.clone();
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION);
            let version = if SUPPORTED_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSION };
            rpc_result(
                &id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "orion", "version": "0.1.0" },
                    "instructions": INSTRUCTIONS
                }),
            )
        }
        "ping" => rpc_result(&id, json!({})),
        "tools/list" => rpc_result(&id, json!({ "tools": tools() })),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else { return Some(rpc_error(&id, -32602, "tools/call needs a name")) };
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match call_tool(ctx, name, &args).await {
                Ok(Ok(v)) => rpc_result(&id, text_result(&v)),
                Ok(Err(m)) => rpc_result(&id, tool_error(&m)),
                Err(e) => {
                    let h: crate::server::http::HttpError = e.into();
                    rpc_result(&id, tool_error(&h.message))
                }
            }
        }
        _ => rpc_error(&id, -32601, &format!("Method not found: {method}")),
    })
}

/// A POST body: one message or a batch. None when nothing needs an answer (202).
pub async fn handle_body(ctx: &McpContext, body: &Value) -> Option<Value> {
    match body {
        Value::Array(batch) => {
            let mut out = vec![];
            for m in batch {
                if let Some(r) = handle_message(ctx, m).await {
                    out.push(r);
                }
            }
            (!out.is_empty()).then_some(Value::Array(out))
        }
        m => handle_message(ctx, m).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::memory_store;

    #[tokio::test]
    async fn protocol_basics() {
        let ctx = McpContext { store: memory_store(true), embedder: Arc::new(crate::llm::embed::LocalHashEmbedder::default()), user_id: "devon".into() };
        let init = handle_message(&ctx, &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})).await.unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert!(handle_message(&ctx, &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).await.is_none());
        let list = handle_message(&ctx, &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})).await.unwrap();
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 7);
        let item = handle_message(&ctx, &json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_item", "arguments": {"id": "voice-mode"}}})).await.unwrap();
        let text = item["result"]["content"][0]["text"].as_str().unwrap();
        let v: Value = serde_json::from_str(text).unwrap();
        assert_eq!(v["item"]["id"], "voice-mode");
        let src = handle_message(&ctx, &json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "get_source", "arguments": {"id": "nope"}}})).await.unwrap();
        assert!(src["result"]["content"][0]["text"].as_str().unwrap().contains("unknown source nope"));
        let missing = handle_message(&ctx, &json!({"jsonrpc": "2.0", "id": 5, "method": "nope"})).await.unwrap();
        assert_eq!(missing["error"]["code"], -32601);
    }
}

//! Port of `src/steer/dashboard.ts` at 48ff660 (instant parseAsk/draftDashboard, one model refine). STUB.
//! Tests: `src/steer/dashboard.test.ts`, `src/steer/dashboard.ask.test.ts`.
//! In-flight role compositions were a module Map; keep a process-wide map keyed by "orgId:userId".
#![allow(unused_variables, unused_imports, dead_code)]

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::Result;
use serde_json::Value;

use crate::contract::types::{DashboardOrigin, DashboardSpec, GraphResponse, Org, PublicNode, User, Widget, WidgetFilter, WidgetKind};
use crate::db::store::Store;
use crate::llm::openrouter::LlmClient;

pub const ROLE_TIMEOUT_MS: u64 = 20_000;
pub const ASK_TIMEOUT_MS: u64 = 15_000;
pub const ASK_NODES: usize = 60;

/// How the widgets read, shared by the role composer and the chat tool.
pub const WIDGET_GUIDE: &str = "Widget kinds:
- kpi: one big number, set metric (total_nodes, blocked, at_risk, on_track, done, sellable, sources_total, sources_last_hour, active_people, gaps). A filter narrows node metrics.
- status_breakdown: node statuses as a chart. domain_breakdown: nodes per domain (engineering, sales, marketing, ops).
- node_list: cards for the nodes that pass the filter (domains, statuses, nodeIds, owner, query).
- activity: live stream of what people capture and commit. people: who is active right now.
- constellation: 3D cloud of every node and document by meaning. map: the star map of work and how it connects.
- gaps: work with no owner and other risks. note: a short text you write (text).
Layout is a 4-column grid: sm 1 column, md 2, lg 3, full 4. Put four sm kpis on the first row, then the big views. Fill rows to 4 columns.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Persona {
    Founder,
    Sales,
    Marketing,
    Engineering,
    Research,
    Ops,
    General,
}

#[derive(Clone)]
pub struct ComposeDeps {
    pub llm: Arc<dyn LlmClient>,
    pub model: Option<String>,
    /// ms since epoch; None is now.
    pub now: Option<i64>,
}

pub fn widget_json_schema() -> Value {
    todo!("port WIDGET_JSON_SCHEMA from src/steer/dashboard.ts")
}

pub fn dashboard_json_schema() -> Value {
    todo!("port DASHBOARD_JSON_SCHEMA from src/steer/dashboard.ts")
}

/// Validates a model- or UI-written spec; node ids outside `allowed_ids` are dropped. None when nothing is left.
pub fn sanitize_dashboard(raw: &Value, origin: DashboardOrigin, allowed_ids: Option<&HashSet<String>>, now: Option<i64>) -> Option<DashboardSpec> {
    todo!("port sanitizeDashboard from src/steer/dashboard.ts")
}

/// Every role dashboard shows the swarm: one activity widget and one constellation or map.
pub fn with_live_widgets(spec: DashboardSpec) -> DashboardSpec {
    todo!("port withLiveWidgets from src/steer/dashboard.ts")
}

pub fn persona_of(role: &str) -> Persona {
    todo!("port personaOf from src/steer/dashboard.ts")
}

/// A good dashboard from keywords in the role alone. Used when the model is unavailable.
pub fn heuristic_dashboard(user: &User, nodes: Option<&[PublicNode]>, now: Option<i64>) -> DashboardSpec {
    todo!("port heuristicDashboard from src/steer/dashboard.ts")
}

/// When there is no person to compose for.
pub fn default_dashboard(now: Option<i64>) -> DashboardSpec {
    todo!("port defaultDashboard from src/steer/dashboard.ts")
}

/// The person's default dashboard designed by the model from their role; the heuristic on any failure.
pub async fn compose_role_dashboard(user: &User, org: Option<&Org>, graph: &GraphResponse, deps: &ComposeDeps) -> DashboardSpec {
    todo!("port composeRoleDashboard from src/steer/dashboard.ts")
}

/// The saved dashboard, else one composed from the person's role (and saved).
pub async fn resolve_dashboard(store: &Arc<Store>, user: &User, deps: &ComposeDeps) -> Result<DashboardSpec> {
    todo!("port resolveDashboard from src/steer/dashboard.ts")
}

/// Cheap pre-check: true unless the message is clearly a plain question with no layout words.
pub fn looks_like_layout_request(message: &str) -> bool {
    todo!("port looksLikeLayoutRequest from src/steer/dashboard.ts")
}

/// What `parse_ask` read from a message with no model.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AskIntent {
    /// one per thing asked for ("blocked marketing" and "Google Ads changes today")
    pub groups: Vec<WidgetFilter>,
    /// widgets named outright ("the constellation", "who is active")
    pub kinds: Vec<WidgetKind>,
    pub sellable: bool,
    /// "only X" / "just X": nothing unrelated stays
    pub only: bool,
    /// "also show X" / "add X": keep the current board and put X first
    pub add: bool,
    /// "I am a growth marketer": reshape for the role
    pub role: Option<String>,
    /// words the parser did not use; when empty, the draft is final and the model is skipped
    pub leftover: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskTrace {
    pub draft: bool,
    pub model_calls: u32,
    pub prompt_chars: usize,
    pub ms: u64,
}

pub type OnDraft = Arc<dyn Fn(&DashboardSpec) + Send + Sync>;

#[derive(Clone)]
pub struct AskDeps {
    pub compose: ComposeDeps,
    /// Called with the instant draft before the model is asked, so the UI can show it right away.
    pub on_draft: Option<OnDraft>,
}

pub fn parse_ask(message: &str, user: &User, nodes: &[PublicNode]) -> AskIntent {
    todo!("port parseAsk from src/steer/dashboard.ts")
}

/// "Blocked marketing work", "Google Ads changes today", "Priya Shah's work".
pub fn filter_title(f: &WidgetFilter) -> String {
    todo!("port filterTitle from src/steer/dashboard.ts")
}

/// The instant dashboard for an ask, or None when the parser recognized nothing or the message removes things.
pub fn draft_dashboard(user: &User, message: &str, current: &DashboardSpec, nodes: &[PublicNode], now: Option<i64>, intent: Option<AskIntent>) -> Option<DashboardSpec> {
    todo!("port draftDashboard from src/steer/dashboard.ts")
}

pub fn keeps_filters(groups: &[WidgetFilter], spec: &DashboardSpec) -> bool {
    todo!("port keepsFilters from src/steer/dashboard.ts")
}

pub fn enforce_only(spec: DashboardSpec) -> DashboardSpec {
    todo!("port enforceOnly from src/steer/dashboard.ts")
}

/// The instant draft (handed to `on_draft`), then at most one model call to refine it. None when no change.
pub async fn ask_dashboard(user: &User, message: &str, current: &DashboardSpec, nodes: &[PublicNode], deps: &AskDeps, trace: &mut AskTrace) -> Option<DashboardSpec> {
    todo!("port askDashboard from src/steer/dashboard.ts")
}

/// ask_dashboard against the store: the draft is saved the moment it exists, the refinement replaces it.
pub async fn ask_and_save_dashboard(store: &Arc<Store>, user: &User, message: &str, deps: &AskDeps) -> Result<(Option<DashboardSpec>, AskTrace)> {
    todo!("port askAndSaveDashboard from src/steer/dashboard.ts")
}

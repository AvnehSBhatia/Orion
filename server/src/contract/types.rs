//! Port of `src/contract/types.ts`: the shared wire contract. Every struct serializes camelCase, exactly as
//! the TypeScript types did. Request types here are the *parsed* shapes produced by `contract::schemas`.
//!
//! One change from the TS contract: `orgId` on requests is `Option<String>`. Omitted now means "the signed-in
//! session's org" (it used to mean "demo"); routes resolve it with `Session::org`.

use serde::{Deserialize, Serialize};

/// A string enum with serde as its wire names, `ALL`, `NAMES`, `as_str`, and `parse`.
macro_rules! str_enum {
    ($(#[$m:meta])* $name:ident { $($variant:ident = $s:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];
            pub const NAMES: &'static [&'static str] = &[$($s),+];
            pub fn as_str(self) -> &'static str { match self { $($name::$variant => $s),+ } }
            pub fn parse(s: &str) -> Option<Self> { match s { $($s => Some($name::$variant),)+ _ => None } }
        }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(self.as_str()) }
        }
        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(self.as_str()) }
        }
        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let s = String::deserialize(d)?;
                Self::parse(&s).ok_or_else(|| serde::de::Error::custom(format!("unknown {} {:?}", stringify!($name), s)))
            }
        }
    };
}
pub(crate) use str_enum;

str_enum!(NodeType {
    Feature = "feature",
    Task = "task",
    Milestone = "milestone",
    Campaign = "campaign",
    Deal = "deal",
    Stakeholder = "stakeholder",
    Supplier = "supplier",
    Decision = "decision",
    Risk = "risk",
    Metric = "metric",
});

str_enum!(Domain { Engineering = "engineering", Sales = "sales", Marketing = "marketing", Ops = "ops" });

str_enum!(Status { OnTrack = "on_track", AtRisk = "at_risk", Blocked = "blocked", Done = "done", Unknown = "unknown" });

str_enum!(Relation { Blocks = "blocks", Feeds = "feeds", PartOf = "part_of", Governs = "governs", Influences = "influences" });

str_enum!(SourceKind { Extension = "extension", Code = "code", Manual = "manual" });

str_enum!(
    /// `SourceKind | "digest"`: a public source may be a digest of several documents.
    PublicSourceKind { Extension = "extension", Code = "code", Manual = "manual", Digest = "digest" }
);

impl From<SourceKind> for PublicSourceKind {
    fn from(k: SourceKind) -> Self {
        match k {
            SourceKind::Extension => PublicSourceKind::Extension,
            SourceKind::Code => PublicSourceKind::Code,
            SourceKind::Manual => PublicSourceKind::Manual,
        }
    }
}

str_enum!(Layout { Clusters = "clusters", Timeline = "timeline", List = "list" });

str_enum!(
    /// What happened to a capture's screenshot: dropped because its text was already on the page (text_only),
    /// kept (trimmed and shrunk), or pruned of the regions least like the whole.
    ImageStatus { None = "none", TextOnly = "text_only", Kept = "kept", Pruned = "pruned" }
);

str_enum!(ChangeKind { Created = "created", Updated = "updated" });

str_enum!(GapKind { NoOwner = "no_owner", SingleThreadedDeal = "single_threaded_deal" });

str_enum!(WidgetKind {
    Kpi = "kpi",
    StatusBreakdown = "status_breakdown",
    DomainBreakdown = "domain_breakdown",
    NodeList = "node_list",
    Activity = "activity",
    Constellation = "constellation",
    Map = "map",
    Gaps = "gaps",
    People = "people",
    Note = "note",
});

str_enum!(WidgetMetric {
    TotalNodes = "total_nodes",
    Blocked = "blocked",
    AtRisk = "at_risk",
    OnTrack = "on_track",
    Done = "done",
    Sellable = "sellable",
    SourcesTotal = "sources_total",
    SourcesLastHour = "sources_last_hour",
    ActivePeople = "active_people",
    Gaps = "gaps",
});

str_enum!(WidgetSize { Sm = "sm", Md = "md", Lg = "lg", Full = "full" });

str_enum!(DashboardOrigin { Role = "role", Chat = "chat", Default = "default" });

str_enum!(CardStatus { Shipped = "shipped", InBeta = "in_beta", InProgress = "in_progress" });

str_enum!(TurnRole { User = "user", Assistant = "assistant" });

str_enum!(ActionKind { Open = "open", Ask = "ask", Show = "show" });

str_enum!(ActionTarget { Source = "source", Node = "node" });

str_enum!(PointKind { Node = "node", Source = "source" });

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadLink {
    pub title: String,
    pub url: String,
}

/// What every endpoint returns for a node: the stored node with its vectors stripped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicNode {
    /// kebab-case slug
    pub id: String,
    /// max 40 chars
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    pub domain: Domain,
    /// max 140 chars, plain language
    pub summary: String,
    /// "what you need to do", for the click panel
    pub todo: Option<String>,
    /// "what you need to read"
    pub read_links: Vec<ReadLink>,
    pub owner: Option<String>,
    pub status: Status,
    /// sales can talk about this feature to customers
    pub sellable: bool,
    pub source_kind: SourceKind,
    /// page URL or commit sha
    pub source_ref: String,
    /// ISO
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    /// `${source}__${relation}__${target}`
    pub id: String,
    pub source: String,
    pub target: String,
    pub relation: Relation,
    pub source_ref: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
    /// Free text in the person's own words; anchors what gets pulled for them.
    pub role: String,
    /// Optional extra context, may be "".
    pub team_description: String,
}

/// One thing someone captured or committed, and what it changed in the graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChange {
    pub node_id: String,
    pub label: String,
    pub change: ChangeKind,
    pub status_from: Option<Status>,
    pub status_to: Status,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMember {
    pub id: String,
    pub title: String,
    #[serde(rename = "ref")]
    pub source_ref: String,
    pub author_name: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// "src-..." for documents, "dg-..." for digests
    pub id: String,
    pub kind: PublicSourceKind,
    /// page URL, or repo@sha for code; for a digest, its members' refs
    #[serde(rename = "ref")]
    pub source_ref: String,
    pub title: String,
    /// first ~280 chars of the visible text or diff
    pub excerpt: String,
    pub author_id: Option<String>,
    pub author_name: Option<String>,
    pub created_at: String,
    pub has_image: bool,
    pub changes: Vec<SourceChange>,
    /// digests only: the documents it was built from
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub members: Option<Vec<SourceMember>>,
}

/// `T & { why: string }`: a node or source with the reason it was picked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Why<T> {
    #[serde(flatten)]
    pub item: T,
    pub why: String,
}

impl<T> Why<T> {
    pub fn new(item: T, why: impl Into<String>) -> Self {
        Why { item, why: why.into() }
    }
}

/// A named area of the org. Questions route to the nearest one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cluster {
    pub id: String,
    pub label: String,
    pub size: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gap {
    pub node_id: String,
    pub kind: GapKind,
    /// one plain sentence
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewCommand {
    pub focus_node_ids: Vec<String>,
    pub highlight_node_ids: Vec<String>,
    /// null means all
    pub visible_domains: Option<Vec<Domain>>,
    pub layout: Layout,
    pub caption: String,
}

// ---- Dynamic dashboard ----

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetFilter {
    pub domains: Option<Vec<Domain>>,
    pub statuses: Option<Vec<Status>>,
    pub node_ids: Option<Vec<String>>,
    pub owner: Option<String>,
    /// case-insensitive substring over label + summary
    pub query: Option<String>,
    /// only work updated (or captured) in the last N hours; omitted when unused
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub since_hours: Option<i64>,
    /// where it was captured, matched against the page URL or title ("google ads", "hubspot", "code")
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source: Option<String>,
}

impl WidgetFilter {
    /// An empty filter (every field null) is no filter.
    pub fn is_empty(&self) -> bool {
        self.domains.is_none() && self.statuses.is_none() && self.node_ids.is_none() && self.owner.is_none()
            && self.query.is_none()
            && self.since_hours.is_none()
            && self.source.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Widget {
    pub id: String,
    pub kind: WidgetKind,
    pub title: String,
    /// sm = 1 col, md = 2, lg = 3, full = 4 (of a 4-col grid)
    pub size: WidgetSize,
    pub metric: Option<WidgetMetric>,
    pub filter: Option<WidgetFilter>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSpec {
    pub title: String,
    pub subtitle: String,
    /// at most 12
    pub widgets: Vec<Widget>,
    pub origin: DashboardOrigin,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

// ---- POST /api/ingest/capture ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub org_id: Option<String>,
    pub user_id: String,
    pub url: String,
    pub title: String,
    /// <= 60k chars
    pub html: String,
    /// jpeg, no data: prefix (stripped by the schema), <= 2MB decoded
    pub screenshot_b64: String,
    /// already painted by the extension, recorded only
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub redactions: Option<Vec<Rect>>,
}

/// `duplicate_of` is set when the capture repeated the sender's last one of this URL; nothing new was stored.
/// `not_work` is set when the model found no work on the page; nothing was stored and `source_id` is null.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResponse {
    pub nodes_touched: Vec<String>,
    pub source_id: Option<String>,
    pub image_status: ImageStatus,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub duplicate_of: Option<String>,
    /// Always `Some(true)` when present (`notWork?: true`).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub not_work: Option<bool>,
}

// ---- POST /api/ingest/code ----

/// Written by the developer's coding agent from the change itself (codebase-agent/.ctx-cards.json).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeatureCard {
    /// <= 40
    pub label: String,
    /// <= 140, readable by sales
    pub summary: String,
    pub status: CardStatus,
    /// files the card is about, never private ones
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CodeFile {
    pub path: String,
    pub diff: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommitAuthor {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIngestRequest {
    pub org_id: Option<String>,
    pub repo: String,
    pub commit_sha: String,
    /// may be empty when cards are sent
    pub files: Vec<CodeFile>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cards: Option<Vec<FeatureCard>>,
    /// whose commit this is, feeds their steering vector
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub user_id: Option<String>,
    /// the commit author; matched to a person by name when userId is absent
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub author: Option<CommitAuthor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIngestResponse {
    pub nodes_touched: Vec<String>,
    pub source_id: Option<String>,
}

// ---- GET /api/graph ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphResponse {
    pub nodes: Vec<PublicNode>,
    pub edges: Vec<Edge>,
    pub gaps: Vec<Gap>,
}

// ---- GET /api/context ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextResponse {
    pub nodes: Vec<PublicNode>,
    pub sources: Vec<Source>,
}

// ---- GET /api/feed ----

pub type FeedItem = Why<Source>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeedResponse {
    pub items: Vec<FeedItem>,
}

// ---- GET /api/sources/:id ----

/// `ocr_text` is the text read off the screenshot, "" when there is none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResponse {
    pub source: Source,
    pub text: String,
    pub ocr_text: String,
    pub image_status: ImageStatus,
}

// ---- GET /api/clusters ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClustersResponse {
    pub clusters: Vec<Cluster>,
}

// ---- POST /api/chat ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatTurn {
    pub role: TurnRole,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub org_id: Option<String>,
    pub user_id: String,
    pub message: String,
    pub current_view: Option<ViewCommand>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub skip_dashboard: Option<bool>,
    /// The last turns, oldest first, at most 6 (blank turns dropped).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub history: Option<Vec<ChatTurn>>,
}

/// A suggested next step under the reply. For "open", `target` says whether `value` is a source or node id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatAction {
    pub kind: ActionKind,
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub target: Option<ActionTarget>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub reply: String,
    pub view_command: Option<ViewCommand>,
    pub dashboard: Option<DashboardSpec>,
    pub sources: Vec<Source>,
    pub actions: Vec<ChatAction>,
}

// ---- GET /api/brief ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BriefResponse {
    pub text: String,
    pub sources: Vec<Source>,
}

// ---- /api/dashboard ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRequest {
    pub org_id: Option<String>,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dashboard: Option<DashboardSpec>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reset: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DashboardResponse {
    pub dashboard: DashboardSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardAskRequest {
    pub org_id: Option<String>,
    pub user_id: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DashboardAskResponse {
    pub dashboard: Option<DashboardSpec>,
}

// ---- GET /api/activity ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPerson {
    pub author_id: Option<String>,
    pub name: String,
    pub count: i64,
    pub last_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityCounts {
    pub nodes: i64,
    pub edges: i64,
    pub sources: i64,
    pub last_hour: i64,
    pub people: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActivityResponse {
    /// newest first
    pub sources: Vec<Source>,
    /// by sources in the last 24h, most active first
    pub people: Vec<ActivityPerson>,
    pub counts: ActivityCounts,
}

// ---- GET /api/embeddings ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingPoint {
    /// node id or source id
    pub id: String,
    pub kind: PointKind,
    pub label: String,
    pub domain: Option<Domain>,
    pub status: Option<Status>,
    pub cluster_id: Option<String>,
    pub author: Option<String>,
    pub created_at: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EmbeddingsResponse {
    pub points: Vec<EmbeddingPoint>,
    pub clusters: Vec<Cluster>,
}

// ---- /api/users ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsersResponse {
    pub users: Vec<User>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertUserRequest {
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub id: Option<String>,
    pub name: String,
    pub role: String,
    pub team_description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpsertUserResponse {
    pub user: User,
}

// ---- Orgs ----

/// What the org is, so the model can tell work from everything else and name things the way the org does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Org {
    pub id: String,
    pub name: String,
    /// what the org does, in its own words
    pub description: String,
    /// hostnames the org works on, like "github.com"
    pub websites: Vec<String>,
    /// anything else worth knowing; may be ""
    pub context: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub members: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewMember {
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateOrgRequest {
    /// defaults to a slug of the name
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    /// stored as hostnames
    pub websites: Vec<String>,
    pub context: String,
    pub members: Vec<NewMember>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct UpdateOrgRequest {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub websites: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub context: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgResponse {
    pub org: Org,
    pub users: Vec<User>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgsResponse {
    pub orgs: Vec<OrgSummary>,
}

// ---- Query shapes (GET) ----

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgQuery {
    pub org_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserQuery {
    pub org_id: Option<String>,
    pub user_id: String,
}

pub type BriefQuery = UserQuery;
pub type DashboardQuery = UserQuery;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextQuery {
    pub org_id: Option<String>,
    pub user_id: String,
    pub q: Option<String>,
    /// 1..=50, default 8
    pub k: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedQuery {
    pub org_id: Option<String>,
    pub user_id: String,
    /// (0, 2160], default 72
    pub since_hours: f64,
    /// 1..=100, default 20
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityQuery {
    pub org_id: Option<String>,
    /// 1..=200, default 40
    pub limit: usize,
}

/// Every non-2xx response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
}

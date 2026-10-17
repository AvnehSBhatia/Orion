// Shapes the backend sends and accepts. They mirror server/src/contract/types.ts and docs/api-additions.md;
// keep them in sync by hand.

export type Domain = "engineering" | "sales" | "marketing" | "ops";
export type Status = "on_track" | "at_risk" | "blocked" | "done" | "unknown";
export type Layout = "clusters" | "timeline" | "list";

export type PublicNode = {
  id: string;
  label: string;
  type: string;
  domain: Domain;
  summary: string;
  todo: string | null;
  readLinks: { title: string; url: string }[];
  owner: string | null;
  status: Status;
  sellable: boolean;
  sourceKind: "extension" | "code" | "manual" | "mac";
  sourceRef: string;
  updatedAt: string;
};
export type Edge = { id: string; source: string; target: string; relation: string; sourceRef: string };
export type Gap = { nodeId: string; kind: string; message: string };
export type GraphResponse = { nodes: PublicNode[]; edges: Edge[]; gaps: Gap[] };

export type SourceChange = { nodeId: string; label: string; change: "created" | "updated"; statusFrom: Status | null; statusTo: Status };
export type Source = {
  id: string;
  kind: "extension" | "code" | "manual" | "mac" | "digest";
  ref: string;
  title: string;
  excerpt: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  hasImage: boolean;
  changes: SourceChange[];
};

export type ImageStatus = "none" | "text_only" | "kept" | "pruned";
/** GET /api/sources/:id. `hasImage` is false when the caller may not see the screenshot. */
export type SourceDetail = { source: Source; text: string; ocrText: string; imageStatus: ImageStatus };

export type User = { id: string; name: string; role: string; teamDescription: string };
export type OrgProfile = { id: string; name: string; description: string; websites: string[]; context: string; createdAt: string };
export type OrgSummary ={ id: string; name: string; description: string; members: number };

export type ViewCommand = {
  focusNodeIds: string[];
  highlightNodeIds: string[];
  visibleDomains: Domain[] | null;
  layout: Layout;
  caption: string;
};

// ---- Dynamic dashboard -------------------------------------------------------------
// The backend composes one per user: first from their role, then Orion rewrites it when asked.

export type WidgetKind =
  | "kpi" // one big number: `metric`
  | "status_breakdown" // bar/donut of node statuses (respects filter)
  | "domain_breakdown" // nodes per domain
  | "node_list" // filtered list of nodes (cards with status, owner, todo)
  | "activity" // live stream of captures/commits (sources), newest first
  | "constellation" // embedding constellation (3D projection of node + source embeddings)
  | "map" // the star map
  | "gaps" // ownership gaps / risks
  | "people" // who is active, by recent sources
  | "note"; // free text from Orion (`text`)

export type WidgetMetric =
  | "total_nodes"
  | "blocked"
  | "at_risk"
  | "on_track"
  | "done"
  | "sellable"
  | "sources_total"
  | "sources_last_hour"
  | "active_people"
  | "gaps";

export type WidgetFilter = {
  domains: Domain[] | null;
  statuses: Status[] | null;
  nodeIds: string[] | null;
  owner: string | null;
  query: string | null; // case-insensitive substring over label + summary
  sinceHours?: number | null; // only work updated (or captured) in the last N hours
  source?: string | null; // where it was captured, matched against the page URL or title ("google ads", "hubspot", "code")
};

export type Widget = {
  id: string;
  kind: WidgetKind;
  title: string;
  size: "sm" | "md" | "lg" | "full"; // sm = 1 col, md = 2, lg = 3, full = 4 (of a 4-col grid)
  metric: WidgetMetric | null;
  filter: WidgetFilter | null;
  text: string | null;
};

export type DashboardSpec = {
  title: string;
  subtitle: string;
  widgets: Widget[];
  origin: "role" | "chat" | "default";
  updatedAt: string;
};

export type DashboardResponse = { dashboard: DashboardSpec };

/** One earlier turn, sent as `history` so follow-ups resolve. The backend keeps the last 6, 600 chars each. */
export type ChatTurn = { role: "user" | "assistant"; text: string };
/** A suggested next step under a reply. For "open", `target` says whether `value` is a source or node id. */
export type ChatAction = { kind: "open" | "ask" | "show"; label: string; value: string; target?: "source" | "node" };

export type ChatResponse = {
  reply: string;
  viewCommand: ViewCommand | null;
  dashboard: DashboardSpec | null;
  sources: Source[];
  actions: ChatAction[];
};

/** GET /api/brief: one or two sentences on what moved for this person lately, citing `sources` as [1], [2]. */
export type BriefResponse = { text: string; sources: Source[] };

// ---- Activity + embeddings ---------------------------------------------------------

export type ActivityResponse = {
  sources: Source[]; // newest first
  people: { authorId: string | null; name: string; count: number; lastAt: string }[];
  counts: { nodes: number; edges: number; sources: number; lastHour: number; people: number };
};

export type EmbeddingPoint = {
  id: string; // node id or source id
  kind: "node" | "source";
  label: string;
  domain: Domain | null;
  status: Status | null;
  clusterId: string | null;
  author: string | null;
  createdAt: string;
  x: number; // PCA projection, each axis normalized to [-1, 1]
  y: number;
  z: number;
};
export type EmbeddingsResponse = { points: EmbeddingPoint[]; clusters: { id: string; label: string; size: number }[] };

// ---- Session, accounts, admin -------------------------------------------------------

/** `notice` is the org's monitoring notice text (markdown-ish plain text), when the server sends one. */
export type Consent = { required: boolean; version: number; acceptedAt: string | null; notice?: string | null };

export type Me = {
  username?: string;
  orgId?: string;
  userId?: string;
  admin?: boolean;
  email?: string | null;
  consent?: Consent;
  authDisabled?: boolean;
};

export type LoginResponse = { token: string; orgId: string; userId: string; admin: boolean; username: string };

export type Account = {
  username: string;
  userId: string;
  name: string;
  email: string | null;
  admin: boolean;
  disabled: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  consentAt: string | null;
};

export type Invite = {
  id: string;
  admin: boolean;
  role: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
};

export type CreatedInvite = { id: string; inviteUrl: string; expiresAt: string };
export type InviteLookup = { orgName: string; expiresAt: string };

export type TokenInfo = {
  id: string;
  /** "device": a connected Mac; `label` is its model name. */
  /** "ci": a repo's GitHub sync, which may only send commits. */
  kind: "session" | "api" | "device" | "ci";
  label: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};
export type CreatedToken = TokenInfo & { token: string };

/** server/src/orgs/settings.ts */
export type OrgSettings = {
  captureEnabled: boolean;
  excludedHosts: string[];
  captureIntervalSec: number;
  retentionDays: number;
  screenshotRetentionDays: number;
  screenshotVisibility: "author_and_admins" | "org";
  llmMonthlyBudgetUsd: number;
  consentVersion: number;
  /** Mac drafts round each entry up to this many minutes. */
  billingIncrementMin: 6 | 15;
  /** Mac snippets and evidence quotes are cleared after this many days. */
  snippetRetentionDays: number;
  /** Macs may read page text in browsers (each person must also turn it on). */
  macBrowserPageText: boolean;
};

export type Usage = {
  month: string;
  llm: { calls: number; inputTokens: number; outputTokens: number; costUsd: number; budgetUsd: number };
  captures: { month: string; total: number };
  storage: { bytes: number; screenshotsBytes: number };
};

export type AuditEvent = { at: string; actor: string; action: string; target: string | null; detail: string | null };

/** POST /api/auth/device-codes: a one-time code for connecting a Mac, valid 15 minutes. */
export type DeviceCode = { code: string; expiresAt: string };

// ---- Mac time tracking (/v1, snake_case like docs/mac-v1.md) --------------------------

export type MacClient = { id: string; name: string; aliases: string[]; domains: string[]; project_codes: string[]; active: boolean };
export type MacClientInput = Partial<Omit<MacClient, "id">>;
export type ClientImportResult = { created: number; updated: number; errors: { line: number; message: string }[] };

export type AdminAliasRule = {
  id: string;
  pattern: string;
  client_id: string;
  client_name: string;
  user_id: string | null;
  user_name: string | null;
  scope: "user" | "org";
  status: "pending" | "accepted";
  created_at: string;
};
export type AliasRule = { id: string; pattern: string; client_id: string };

export type PilotPerson = { user_id: string; name: string; accepted: number; edited: number; rejected: number; active_days: number };

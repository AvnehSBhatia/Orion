// Orion shared contract (spec section 1).
// Standalone on purpose: the extension, codebase agent, and UI can copy this file as is.

export const NODE_TYPES = [
  "feature",
  "task",
  "milestone",
  "campaign",
  "deal",
  "stakeholder",
  "supplier",
  "decision",
  "risk",
  "metric",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const DOMAINS = ["engineering", "sales", "marketing", "ops"] as const;
export type Domain = (typeof DOMAINS)[number];

export const STATUSES = ["on_track", "at_risk", "blocked", "done", "unknown"] as const;
export type Status = (typeof STATUSES)[number];

export const RELATIONS = ["blocks", "feeds", "part_of", "governs", "influences"] as const;
export type Relation = (typeof RELATIONS)[number];

export const SOURCE_KINDS = ["extension", "code", "manual"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const LAYOUTS = ["clusters", "timeline", "list"] as const;
export type Layout = (typeof LAYOUTS)[number];

export type ReadLink = { title: string; url: string };

export type Node = {
  id: string; // kebab-case slug
  label: string; // max 40 chars
  type: NodeType;
  domain: Domain;
  summary: string; // max 140 chars, plain language
  todo: string | null; // "what you need to do", for the click panel
  readLinks: ReadLink[]; // "what you need to read"
  owner: string | null;
  status: Status;
  sellable: boolean; // sales can talk about this feature to customers
  sourceKind: SourceKind;
  sourceRef: string; // page URL or commit sha
  updatedAt: string; // ISO
  embedding: number[]; // stored server side only, never sent to UI
};

// What every endpoint actually returns: a Node with the embedding stripped.
export type PublicNode = Omit<Node, "embedding">;

export type Edge = {
  id: string; // `${source}__${relation}__${target}`
  source: string; // upstream node id
  target: string; // downstream node id
  relation: Relation;
  sourceRef: string;
};

export type User = {
  id: string;
  name: string;
  role: string; // free text, a sentence or two in the person's own words; anchors what gets pulled for them
  teamDescription: string; // optional extra context, may be ""
};

/** One thing someone captured or committed, and what it changed in the graph. */
export type SourceChange = {
  nodeId: string;
  label: string;
  change: "created" | "updated";
  statusFrom: Status | null;
  statusTo: Status;
};

// What happened to a capture's screenshot: dropped because its text was already on the page,
// kept (trimmed and shrunk to what the embedder uses), or pruned of the regions least like the whole.
export type ImageStatus = "none" | "text_only" | "kept" | "pruned";

export type SourceMember = { id: string; title: string; ref: string; authorName: string | null; createdAt: string };

export type Source = {
  id: string; // "src-..." for documents, "dg-..." for digests
  kind: SourceKind | "digest"; // a digest is several similar sources merged into one short text
  ref: string; // page URL, or repo@sha for code; for a digest, its members' refs
  title: string;
  excerpt: string; // first ~280 chars of the visible text or diff
  authorId: string | null;
  authorName: string | null; // for a digest, every member author
  createdAt: string; // ISO; for a digest, its newest member
  hasImage: boolean; // GET /api/sources/:id/image?orgId=... serves the screenshot
  changes: SourceChange[];
  members?: SourceMember[]; // digests only: the documents it was built from
};

// A named area of the org (for example "voice frontend code"). Questions route to the nearest one.
export type Cluster = { id: string; label: string; size: number };

export type GapKind = "no_owner" | "single_threaded_deal";

export type Gap = {
  nodeId: string;
  kind: GapKind;
  message: string; // one plain sentence
};

export type ViewCommand = {
  focusNodeIds: string[]; // zoom to these
  highlightNodeIds: string[];
  visibleDomains: Domain[] | null; // null means all
  layout: Layout;
  caption: string; // one plain sentence shown on screen
};

export type Rect = { x: number; y: number; w: number; h: number };

// Every request is scoped to one org: `orgId` in the JSON body for POSTs, `?orgId=` for GETs.
// No auth yet. Omitted orgId means "demo".

// POST /api/ingest/capture
export type CaptureRequest = {
  orgId?: string;
  userId: string;
  url: string;
  title: string;
  html: string; // <= 60k chars
  screenshotB64: string; // jpeg, no data: prefix, <= 2MB decoded
  redactions?: Rect[]; // already painted by the extension, recorded only
};
/**
 * `duplicateOf` is set when the capture repeated the sender's last one of this URL; nothing new was stored.
 * `notWork` is set when the model found no work on the page; nothing was stored and `sourceId` is null.
 */
export type CaptureResponse = {
  nodesTouched: string[];
  sourceId: string | null;
  imageStatus: ImageStatus;
  duplicateOf?: string;
  notWork?: true;
};

// POST /api/ingest/code
/** Written by the developer's coding agent from the change itself (codebase-agent/.ctx-cards.json). */
export type FeatureCard = {
  label: string; // <= 40
  summary: string; // <= 140, readable by sales
  status: "shipped" | "in_beta" | "in_progress";
  paths: string[]; // files the card is about, never private ones
};
export type CodeIngestRequest = {
  orgId?: string;
  repo: string;
  commitSha: string;
  files: { path: string; diff: string }[]; // may be empty when cards are sent
  cards?: FeatureCard[]; // used to ground extraction, and stored as is if the model is unavailable
  userId?: string; // whose commit this is, feeds their steering vector
  author?: { name: string; email?: string }; // the commit author; matched to a person by name when userId is absent
};
export type CodeIngestResponse = { nodesTouched: string[]; sourceId: string | null };

// GET /api/graph?orgId=...
export type GraphResponse = { nodes: PublicNode[]; edges: Edge[]; gaps: Gap[] };

// GET /api/context?orgId=...&userId=...&q=...&k=8
// Optional filters: &status=blocked,at_risk &sellable=true &domain=sales,ops &type=deal &sinceHours=24
// Status filters see ripple: work downstream of something blocked counts as at_risk.
// `sources` are the documents behind those nodes plus the best matching documents, newest first.
export type ContextResponse = { nodes: PublicNode[]; sources: Source[] };

// GET /api/feed?orgId=...&userId=...&sinceHours=72&limit=20
// What other people captured or committed that affects this person, most relevant first.
export type FeedItem = Source & { why: string };
export type FeedResponse = { items: FeedItem[] };

// GET /api/sources/:id?orgId=...   (works for digest ids too)
// `ocrText` is the text read off the screenshot, "" when there is none.
export type SourceResponse = { source: Source; text: string; ocrText: string; imageStatus: ImageStatus };

// GET /api/clusters?orgId=...
export type ClustersResponse = { clusters: Cluster[] };

// POST /api/chat
export type ChatRequest = { orgId?: string; userId: string; message: string; currentView: ViewCommand | null };
// `sources` are the documents the answer drew on, so the UI can show where it came from.
export type ChatResponse = { reply: string; viewCommand: ViewCommand | null; sources: Source[] };

// GET /api/users?orgId=...
export type UsersResponse = { users: User[] };

// POST /api/users: create or update a person (join an org). `role` is free text. The org must exist.
export type UpsertUserRequest = { orgId?: string; id?: string; name: string; role: string; teamDescription?: string };
export type UpsertUserResponse = { user: User };

/** What the org is, so the model can tell work from everything else and name things the way the org does. */
export type Org = {
  id: string;
  name: string;
  description: string; // what the org does, in its own words
  websites: string[]; // hostnames the org works on, like "github.com" or "acme.atlassian.net"
  context: string; // anything else worth knowing: products, customers, jargon. May be ""
  createdAt: string;
};
export type OrgSummary = Pick<Org, "id" | "name" | "description"> & { members: number };

// POST /api/orgs: create an org, optionally with its first members. 409 if the id is taken.
export type CreateOrgRequest = {
  id?: string; // defaults to a slug of the name
  name: string;
  description: string;
  websites?: string[]; // hostnames or URLs; stored as hostnames
  context?: string;
  members?: { name: string; role: string }[];
};
// PATCH /api/orgs/:orgId: change any profile field.
export type UpdateOrgRequest = Partial<Pick<Org, "name" | "description" | "websites" | "context">>;
export type OrgResponse = { org: Org; users: User[] };
export type OrgsResponse = { orgs: OrgSummary[] };

// MCP (Streamable HTTP): /api/mcp?orgId=...&userId=...  read-only tools for any MCP client (Cursor, Codex, other coding agents).

// Every non-2xx response
export type ErrorResponse = { error: string };

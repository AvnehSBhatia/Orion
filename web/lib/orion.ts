// Client for the Orion backend (repo root, `npm run dev` on :3001).
// Types mirror src/contract/types.ts; keep them in sync by hand.
"use client";

import { useEffect, useRef, useState } from "react";

export const API = (process.env.NEXT_PUBLIC_ORION_API || "http://localhost:3001").replace(/\/+$/, "");

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
  sourceKind: "extension" | "code" | "manual";
  sourceRef: string;
  updatedAt: string;
};
export type Edge = { id: string; source: string; target: string; relation: string; sourceRef: string };
export type Gap = { nodeId: string; kind: string; message: string };
export type GraphResponse = { nodes: PublicNode[]; edges: Edge[]; gaps: Gap[] };

export type SourceChange = { nodeId: string; label: string; change: "created" | "updated"; statusFrom: Status | null; statusTo: Status };
export type Source = {
  id: string;
  kind: "extension" | "code" | "manual" | "digest";
  ref: string;
  title: string;
  excerpt: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  hasImage: boolean;
  changes: SourceChange[];
};

export type User = { id: string; name: string; role: string; teamDescription: string };
export type OrgSummary = { id: string; name: string; description: string; members: number };

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

export const MAX_HISTORY = 6;
export const HISTORY_CHARS = 600;
/** The last 6 turns with text, trimmed to what the backend accepts. */
export const toHistory = (turns: ChatTurn[]): ChatTurn[] =>
  turns
    .filter((t) => t.text.trim())
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, text: t.text.slice(0, HISTORY_CHARS) }));

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

// ---- Fetchers ----------------------------------------------------------------------

/** Fired on window when the backend answers 401, so the app can show the sign-in screen again. */
export const SIGNED_OUT_EVENT = "orion:signed-out";

function checkSignedIn(res: Response) {
  if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

/** Every call carries the session cookie (`credentials: "include"`); the backend sets it at sign-in. */
async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    cache: "no-store",
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!path.startsWith("/api/auth/")) checkSignedIn(res);
    throw Object.assign(new Error((body as { error?: string }).error || `${path} returned ${res.status}`), { status: res.status });
  }
  return body as T;
}

export type Me = { username?: string; orgId?: string; userId?: string; admin?: boolean; authDisabled?: boolean };
export type LoginResponse = { token: string; orgId: string; userId: string; admin: boolean; username: string };

export const auth = {
  /** Who is signed in; rejects with `status: 401` when nobody is. */
  me: () => j<Me>("/api/auth/me"),
  login: (username: string, password: string) =>
    j<LoginResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => j<{ ok: true }>("/api/auth/logout", { method: "POST" }),
};

const q = (o: Record<string, string | number | undefined>) =>
  "?" + Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const orion = {
  orgs: () => j<{ orgs: OrgSummary[] }>("/api/orgs"),
  users: (orgId: string) => j<{ users: User[] }>(`/api/users${q({ orgId })}`),
  graph: (orgId: string) => j<GraphResponse>(`/api/graph${q({ orgId })}`),
  activity: (orgId: string, limit = 40) => j<ActivityResponse>(`/api/activity${q({ orgId, limit })}`),
  embeddings: (orgId: string) => j<EmbeddingsResponse>(`/api/embeddings${q({ orgId })}`),
  dashboard: (orgId: string, userId: string) => j<DashboardResponse>(`/api/dashboard${q({ orgId, userId })}`),
  saveDashboard: (orgId: string, userId: string, dashboard: DashboardSpec) =>
    j<DashboardResponse>("/api/dashboard", { method: "POST", body: JSON.stringify({ orgId, userId, dashboard }) }),
  resetDashboard: (orgId: string, userId: string) =>
    j<DashboardResponse>("/api/dashboard", { method: "POST", body: JSON.stringify({ orgId, userId, reset: true }) }),
  brief: (orgId: string, userId: string) => j<BriefResponse>(`/api/brief${q({ orgId, userId })}`),
  /**
   * The answer as it is written: `onDelta` gets each chunk of raw text (citations as [S2]), then the promise
   * resolves with the final ChatResponse (citations renumbered, sources attached).
   */
  chatStream: async (
    orgId: string,
    userId: string,
    message: string,
    currentView: ViewCommand | null,
    onDelta: (text: string) => void,
    history: ChatTurn[] = [],
  ): Promise<ChatResponse> => {
    const res = await fetch(`${API}/api/chat?stream=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, userId, message, currentView, skipDashboard: true, history: toHistory(history) }),
      cache: "no-store",
      credentials: "include",
    });
    checkSignedIn(res);
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || `/api/chat returned ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, end);
        buf = buf.slice(end + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        if (event === "delta") onDelta(payload.text);
        else if (event === "done") return { ...payload, actions: payload.actions ?? [] } as ChatResponse;
        else if (event === "error") throw new Error(payload.error || "chat failed");
      }
    }
    throw new Error("the answer stream ended early");
  },
  /** One fast model call that reshapes (and saves) the dashboard; null when the message was not a layout request. */
  askDashboard: (orgId: string, userId: string, message: string) =>
    j<{ dashboard: DashboardSpec | null }>("/api/dashboard/ask", { method: "POST", body: JSON.stringify({ orgId, userId, message }) }),
  imageUrl: (orgId: string, sourceId: string) => `${API}/api/sources/${sourceId}/image${q({ orgId })}`,
};

/** Polls `load` every `ms` while mounted; re-runs immediately when `key` changes. Keeps the last good value on error. */
export function usePoll<T>(key: string | null, load: () => Promise<T>, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const v = await loadRef.current();
        if (alive) {
          setData(v);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, ms]);
  return { data, error, setData };
}

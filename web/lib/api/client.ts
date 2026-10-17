// Client for the Orion backend (`server/`, :3001 in dev). One fetch helper and one stream opener; every call
// carries the session cookie (`credentials: "include"`), which the backend sets at sign-in.

import { toHistory } from "@/lib/chat";
import { cleanGraph } from "@/lib/format";
import type {
  Account,
  AdminAliasRule,
  AliasRule,
  ClientImportResult,
  ActivityResponse,
  AuditEvent,
  BriefResponse,
  ChatResponse,
  ChatTurn,
  CreatedInvite,
  CreatedToken,
  DashboardResponse,
  DashboardSpec,
  DeviceCode,
  EmbeddingsResponse,
  GraphResponse,
  Invite,
  InviteLookup,
  LoginResponse,
  MacClient,
  MacClientInput,
  Me,
  MyTimesheet,
  OrgProfile,
  OrgSettings,
  OrgSummary,
  PilotPerson,
  PrivacySummary,
  ResetLink,
  SourceDetail,
  TokenInfo,
  Usage,
  User,
  ViewCommand,
} from "@/lib/api/types";

export const API = (process.env.NEXT_PUBLIC_ORION_API || "http://localhost:3001").replace(/\/+$/, "");

/** Fired on window when the backend answers 401, so the app can show the sign-in screen again. */
export const SIGNED_OUT_EVENT = "orion:signed-out";

/** A failed call. `status` is 0 when the server could not be reached at all. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : 0);

type Query = Record<string, string | number | undefined | null>;

const qs = (query?: Query) => {
  const parts = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

type Options = { method?: string; body?: unknown; query?: Query; signal?: AbortSignal };

async function send(path: string, { method = "GET", body, query, signal }: Options): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}${qs(query)}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      cache: "no-store",
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Could not reach the Orion server.", 0);
  }
  if (res.status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  return res;
}

async function fail(res: Response, path: string): Promise<never> {
  // /api answers { error: "..." }; /v1 answers { error: { code, message } }.
  const body = (await res.json().catch(() => ({}))) as { error?: string | { code?: string; message?: string }; retryAfterSec?: number };
  const header = Number(res.headers.get("retry-after"));
  const retry = body.retryAfterSec ?? (Number.isFinite(header) && header > 0 ? header : null);
  const message = typeof body.error === "string" ? body.error : body.error?.message;
  throw new ApiError(message || `${path} returned ${res.status}`, res.status, retry);
}

/** JSON in, JSON out. 204 resolves to undefined. */
export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const res = await send(path, options);
  if (!res.ok) return fail(res, path);
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => ({}))) as T;
}

/** A file (CSV) from the server, saved by the browser under `filename`. */
export async function download(path: string, filename: string, query?: Query): Promise<void> {
  const res = await send(path, { query });
  if (!res.ok) return fail(res, path);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** POSTs `body` and returns a reader over the streamed response, after the same error handling as `request`. */
export async function openStream(path: string, body: unknown, query?: Query, signal?: AbortSignal) {
  const res = await send(path, { method: "POST", body, query, signal });
  if (!res.ok || !res.body) return fail(res, path);
  return res.body.getReader();
}

/** Server-sent events: calls `onEvent(name, data)` per frame until `onEvent` returns a value. */
async function readSse<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: string, data: unknown) => T | undefined,
): Promise<T> {
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
      const result = onEvent(event, JSON.parse(data));
      if (result !== undefined) return result;
    }
  }
  throw new ApiError("The answer stream ended early.", 502);
}

/** Newline-delimited JSON: calls `onLine` per line; resolves with the first non-undefined return, or `fallback()`. */
async function readNdjson<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onLine: (line: unknown) => T | undefined,
  fallback: () => T,
): Promise<T> {
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    let end: number;
    while ((end = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, end).trim();
      buf = buf.slice(end + 1);
      if (!line) continue;
      const result = onLine(JSON.parse(line));
      if (result !== undefined) return result;
    }
    if (done) break;
  }
  return fallback();
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body });
const del = <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body });
const seg = encodeURIComponent;

export const api = {
  auth: {
    /** Who is signed in; rejects with status 401 when nobody is. */
    me: () => request<Me>("/api/auth/me"),
    login: (username: string, password: string) => post<LoginResponse>("/api/auth/login", { username, password }),
    logout: () => post<{ ok: true }>("/api/auth/logout"),
    consent: (version: number) => post<{ acceptedAt: string }>("/api/auth/consent", { version }),
    changePassword: (current: string, next: string) => post<void>("/api/auth/password", { current, next }),
    /** Public: set a new password from a reset link. */
    resetPassword: (token: string, password: string) => post<void>("/api/auth/reset", { token, password }),
    /** Public: email a reset link to the account with this email, if there is one. */
    acceptInvite: (body: { token: string; username: string; password: string; name: string; role: string; email?: string }) =>
      post<LoginResponse>("/api/auth/accept-invite", body),
  },
  accounts: {
    list: () => request<{ accounts: Account[] }>("/api/auth/accounts"),
    update: (username: string, change: Partial<Pick<Account, "admin" | "disabled" | "email">>) =>
      patch<{ account: Account }>(`/api/auth/accounts/${seg(username)}`, change),
    resetLink: (username: string) => post<ResetLink>(`/api/auth/accounts/${seg(username)}/reset`),
  },
  invites: {
    list: () => request<{ invites: Invite[] }>("/api/auth/invites"),
    create: (body: { admin?: boolean; role?: string; email?: string; name?: string }) => post<CreatedInvite>("/api/auth/invites", body),
    revoke: (id: string) => del<void>(`/api/auth/invites/${seg(id)}`),
    /** Public: which org an invite link is for. */
    lookup: (token: string) => request<InviteLookup>(`/api/auth/invites/${seg(token)}`),
  },
  tokens: {
    list: () => request<{ tokens: TokenInfo[] }>("/api/auth/tokens"),
    create: (label: string, opts: { kind?: "api" | "ci"; expiresInDays?: number } = {}) => post<CreatedToken>("/api/auth/tokens", { label, ...opts }),
    revoke: (id: string) => del<{ ok: true }>(`/api/auth/tokens/${seg(id)}`),
  },
  /** A one-time code the Mac app exchanges for its device token (POST /v1/devices/register). */
  deviceCode: () => post<DeviceCode>("/api/auth/device-codes"),
  /** Admin side of the Mac app's time tracking (docs/mac-v1.md). */
  owner: {
    clients: () => request<{ clients: MacClient[] }>("/v1/owner/clients"),
    createClient: (body: MacClientInput & { name: string }) => post<MacClient>("/v1/owner/clients", body),
    updateClient: (id: string, change: MacClientInput) => patch<MacClient>(`/v1/owner/clients/${seg(id)}`, change),
    importClients: (csv: string) => post<ClientImportResult>("/v1/owner/clients/import", { csv }),
    aliasRules: () => request<{ rules: AdminAliasRule[] }>("/v1/owner/alias-rules"),
    acceptRule: (id: string) => post<AliasRule>(`/v1/owner/alias-rules/${seg(id)}/accept`),
    pilot: (from: string, to: string) => request<{ people: PilotPerson[] }>("/v1/owner/pilot", { query: { from, to } }),
    exportCsv: (from: string, to: string) => download("/v1/owner/export.csv", `orion-time-${from}-to-${to}.csv`, { from, to }),
  },
  orgs: {
    list: () => request<{ orgs: OrgSummary[] }>("/api/orgs"),
    settings: (orgId: string) => request<{ settings: OrgSettings }>(`/api/orgs/${seg(orgId)}/settings`),
    saveSettings: (orgId: string, change: Partial<OrgSettings>) =>
      patch<{ settings: OrgSettings }>(`/api/orgs/${seg(orgId)}/settings`, change),
    usage: (orgId: string) => request<Usage>(`/api/orgs/${seg(orgId)}/usage`),
  },
  org: {
    get: (orgId: string) => request<{ org: OrgProfile; users: User[] }>(`/api/orgs/${seg(orgId)}`),
    update: (orgId: string, change: Partial<Pick<OrgProfile, "name" | "description" | "websites" | "context">>) =>
      patch<{ org: OrgProfile; users: User[] }>(`/api/orgs/${seg(orgId)}`, change),
  },
  me: {
    /** Removes the caller's own captured documents and screenshots. */
    deleteCaptures: () => del<{ deleted: number }>("/api/me/captures"),
    /** Everything Orion holds about the caller, saved as one JSON file. */
    exportData: (userId: string) => download("/api/me/export", `orion-export-${userId}-${new Date().toISOString().slice(0, 10)}.json`),
    /** Counts and settings only: what left this account, and who else looked. */
    privacy: () => request<PrivacySummary>("/api/me/privacy"),
    /** The caller's own time entries. A user id is not sent. */
    time: (from: string, to: string) => request<MyTimesheet>("/api/me/time", { query: { from, to } }),
  },
  health: () => request<{ ok: boolean; version?: string }>("/api/health"),
  audit: (limit = 100) => request<{ events: AuditEvent[] }>("/api/audit", { query: { limit } }),
  /** Admin: every audit event the org keeps, as CSV. */
  auditCsv: (orgId: string) => download("/api/audit", `orion-audit-${orgId}-${new Date().toISOString().slice(0, 10)}.csv`, { format: "csv" }),
  /** Admin: everything Orion holds about one person, as one JSON file. */
  exportPerson: (orgId: string, userId: string) => download(`/api/users/${seg(userId)}/export`, `orion-export-${userId}-${new Date().toISOString().slice(0, 10)}.json`, { orgId }),
  users: (orgId: string) => request<{ users: User[] }>("/api/users", { query: { orgId } }),
  graph: async (orgId: string) => cleanGraph(await request<GraphResponse>("/api/graph", { query: { orgId } })),
  activity: (orgId: string, limit = 40) => request<ActivityResponse>("/api/activity", { query: { orgId, limit } }),
  embeddings: (orgId: string) => request<EmbeddingsResponse>("/api/embeddings", { query: { orgId } }),
  brief: (orgId: string, userId: string) => request<BriefResponse>("/api/brief", { query: { orgId, userId } }),
  sources: {
    get: (orgId: string, id: string) => request<SourceDetail>(`/api/sources/${seg(id)}`, { query: { orgId } }),
    imageUrl: (orgId: string, id: string) => `${API}/api/sources/${seg(id)}/image${qs({ orgId })}`,
  },
  dashboard: {
    get: (orgId: string, userId: string) => request<DashboardResponse>("/api/dashboard", { query: { orgId, userId } }),
    reset: (orgId: string, userId: string) => post<DashboardResponse>("/api/dashboard", { orgId, userId, reset: true }),
    /**
     * Reshapes (and saves) the dashboard. `onDraft` gets the instant draft the server builds without a model,
     * usually within a few ms; the promise resolves with the refined spec (null when the message was not a
     * layout request). Streams NDJSON from /api/dashboard/ask?stream=1.
     */
    ask: async (orgId: string, userId: string, message: string, onDraft?: (spec: DashboardSpec) => void) => {
      const reader = await openStream("/api/dashboard/ask", { orgId, userId, message }, { stream: 1 });
      let draft: DashboardSpec | null = null;
      return readNdjson<{ dashboard: DashboardSpec | null }>(
        reader,
        (line) => {
          const msg = line as { draft?: DashboardSpec; dashboard?: DashboardSpec | null };
          if (msg.draft) {
            draft = msg.draft;
            onDraft?.(msg.draft);
            return undefined;
          }
          return "dashboard" in msg ? { dashboard: msg.dashboard ?? draft } : undefined;
        },
        () => ({ dashboard: draft }),
      );
    },
  },
  /**
   * The answer as it is written: `onDelta` gets each chunk of raw text (citations as [S2]), then the promise
   * resolves with the final ChatResponse (citations renumbered, sources attached).
   */
  chat: async (
    orgId: string,
    userId: string,
    message: string,
    currentView: ViewCommand | null,
    onDelta: (text: string) => void,
    history: ChatTurn[] = [],
    signal?: AbortSignal,
  ): Promise<ChatResponse> => {
    const body = { orgId, userId, message, currentView, skipDashboard: true, history: toHistory(history) };
    const reader = await openStream("/api/chat", body, { stream: 1 }, signal);
    return readSse<ChatResponse>(reader, (event, data) => {
      const payload = data as { text?: string; error?: string } & ChatResponse;
      if (event === "delta") onDelta(payload.text ?? "");
      else if (event === "done") return { ...payload, actions: payload.actions ?? [] };
      else if (event === "error") throw new ApiError(payload.error || "chat failed", 502);
      return undefined;
    });
  },
};

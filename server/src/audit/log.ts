import type { AuthDb } from "@/auth/db";

export const AUDIT_ACTIONS = [
  "login",
  "login_failed",
  "logout",
  "token_created",
  "token_revoked",
  "account_created",
  "account_updated",
  "password_changed",
  "password_reset",
  "invite_created",
  "invite_accepted",
  "invite_sent",
  "reset_requested",
  "reset_emailed",
  "settings_changed",
  "data_deleted",
  "device_code_created",
  "device_registered",
  "consent_accepted",
  "client_changed",
  "alias_rule_accepted",
  "draft_finalized",
  "time_exported",
  "viewed_as",
  "source_opened",
  "org_updated",
  "mcp_tool_called",
  "data_exported",
  "audit_exported",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEvent = { at: string; actor: string | null; action: AuditAction; target: string | null; detail: string | null };

export type AuditInput = {
  /** null when the event belongs to no org (a failed sign-in for an unknown username). */
  orgId: string | null;
  /** The username that acted; null for anonymous calls. */
  actor: string | null;
  action: AuditAction;
  target?: string | null;
  /** Short free text or a small object (stored as JSON). Never secrets or captured content. */
  detail?: string | Record<string, unknown> | null;
};

/**
 * Appends one event to the audit log in auth.db. The log lives apart from the org files so it outlives an org's
 * deletion. Failures are logged, never thrown: an audit write must not break the action it records.
 */
export function audit(db: AuthDb, e: AuditInput): void {
  try {
    const detail = e.detail == null ? null : typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
    db.db
      .prepare("INSERT INTO audit (org_id, at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .run(e.orgId, new Date().toISOString(), e.actor, e.action, e.target ?? null, detail?.slice(0, 2000) ?? null);
  } catch (err) {
    console.error("audit write failed", err);
  }
}

/** The org's newest events first. */
export function listAudit(db: AuthDb, orgId: string, limit = 100): AuditEvent[] {
  return db.db
    .prepare("SELECT at, actor, action, target, detail FROM audit WHERE org_id = ? ORDER BY id DESC LIMIT ?")
    .all(orgId, Math.max(1, Math.min(1000, Math.floor(limit)))) as AuditEvent[];
}

/** How long the audit log is kept. The hourly retention job removes older rows. */
export const AUDIT_RETENTION_DAYS = 400;

/** Deletes events older than `days`, across every org. Returns rows removed. */
export function purgeAudit(db: AuthDb, now = Date.now(), days = AUDIT_RETENTION_DAYS): number {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  return db.db.prepare("DELETE FROM audit WHERE at < ?").run(cutoff).changes;
}

/** Every event of the org, oldest first, for the CSV export. */
export function allAudit(db: AuthDb, orgId: string): AuditEvent[] {
  return db.db.prepare("SELECT at, actor, action, target, detail FROM audit WHERE org_id = ? ORDER BY id").all(orgId) as AuditEvent[];
}

/** Events in the org where one of `actors` acted or one of `targets` was acted on, oldest first. */
export function auditAbout(db: AuthDb, orgId: string, actors: string[], targets: string[]): AuditEvent[] {
  const a = actors.length ? actors : [""];
  const t = targets.length ? targets : [""];
  return db.db
    .prepare(
      `SELECT at, actor, action, target, detail FROM audit WHERE org_id = ?
       AND (actor IN (${a.map(() => "?").join(",")}) OR target IN (${t.map(() => "?").join(",")})) ORDER BY id`,
    )
    .all(orgId, ...a, ...t) as AuditEvent[];
}

// Last write per key, and calls since then, for events that would otherwise flood the log. In memory: a restart
// may log one extra event per key, which is fine.
const throttle = new Map<string, { at: number; calls: number }>();

/**
 * `audit`, at most once per `key` per `windowMs`. The written event's detail gets `calls`: how many times it
 * happened since the last write, this one included. Returns whether it wrote.
 */
export function auditThrottled(db: AuthDb, key: string, windowMs: number, e: AuditInput, now = Date.now()): boolean {
  const last = throttle.get(key);
  if (last && now - last.at < windowMs) {
    last.calls++;
    return false;
  }
  if (throttle.size > 10_000) for (const [k, v] of throttle) if (now - v.at >= windowMs) throttle.delete(k);
  const calls = (last?.calls ?? 0) + 1;
  throttle.set(key, { at: now, calls: 0 });
  const detail = typeof e.detail === "object" && e.detail !== null ? { ...e.detail, calls } : e.detail;
  audit(db, { ...e, detail });
  return true;
}

/** Forgets the throttle (tests). */
export function resetAuditThrottle(): void {
  throttle.clear();
}

const HOUR = 3_600_000;

/**
 * An admin read another person's view (feed, brief, context, dashboard, chat as them). Once per admin and person
 * an hour. The route is logged, never what was on it.
 */
export function auditViewingAs(db: AuthDb, p: { orgId: string; username: string; userId: string }, target: string, route: string): void {
  if (target === p.userId) return;
  auditThrottled(db, `view:${p.orgId}:${p.username}:${target}`, HOUR, { orgId: p.orgId, actor: p.username, action: "viewed_as", target, detail: { route } });
}

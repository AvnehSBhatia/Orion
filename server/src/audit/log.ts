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
  "settings_changed",
  "data_deleted",
  "device_code_created",
  "device_registered",
  "consent_accepted",
  "client_changed",
  "alias_rule_accepted",
  "draft_finalized",
  "time_exported",
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

// GET /api/me/privacy: what Orion holds and shares about the caller, as counts and dates. Never content.
import { AUDIT_RETENTION_DAYS, type AuditAction } from "@/audit/log";
import type { AuthDb, Principal } from "@/auth/db";
import type { Store } from "@/db/store";
import { ensureMacTables } from "@/mac/schema";
import { getOrgSettings } from "./settings";

export const PRIVACY_WINDOW_DAYS = 7;
const EVENT_DAYS = 90;
const EVENT_LIMIT = 20;

/** Actions someone else can take about a person that the person should hear about. */
const ABOUT_YOU: AuditAction[] = ["viewed_as", "source_opened", "data_exported", "data_deleted", "account_updated", "password_reset"];

export type PrivacyEvent = {
  at: string;
  /** Who did it (a username in the caller's org). */
  actor: string | null;
  action: AuditAction;
  /** For source_opened: whether the text or the screenshot was opened. */
  what?: "text" | "screenshot";
};

export type PrivacySummary = {
  windowDays: number;
  /** What the caller sent in the window, counted by Mac app and by other document kind. */
  sent: {
    total: number;
    macApps: { app: string; count: number }[];
    other: { kind: string; count: number }[];
  };
  settings: {
    retentionDays: number;
    screenshotRetentionDays: number;
    snippetRetentionDays: number;
    auditRetentionDays: number;
    macBrowserPageText: boolean;
    screenshotVisibility: "author_and_admins" | "org";
  };
  /** Things other people did about the caller in the last 90 days, newest first. */
  events: PrivacyEvent[];
  eventDays: number;
};

export function privacySummary(db: AuthDb, store: Store, p: Principal, now = Date.now()): PrivacySummary {
  ensureMacTables(store);
  const since = new Date(now - PRIVACY_WINDOW_DAYS * 86_400_000).toISOString();
  const q = store.db;
  const macApps = (
    q
      .prepare("SELECT app_name AS app, COUNT(*) AS count FROM mac_work_blocks WHERE user_id = ? AND created_at >= ? GROUP BY app_name ORDER BY count DESC, app")
      .all(p.userId, since) as { app: string; count: number }[]
  ).map((r) => ({ app: r.app, count: Number(r.count) }));
  const other = (
    q
      .prepare("SELECT kind, COUNT(*) AS count FROM sources WHERE author_id = ? AND kind != 'mac' AND created_at >= ? GROUP BY kind ORDER BY count DESC, kind")
      .all(p.userId, since) as { kind: string; count: number }[]
  ).map((r) => ({ kind: r.kind, count: Number(r.count) }));
  const total = [...macApps, ...other].reduce((n, r) => n + r.count, 0);

  const s = getOrgSettings(store);
  return {
    windowDays: PRIVACY_WINDOW_DAYS,
    sent: { total, macApps, other },
    settings: {
      retentionDays: s.retentionDays,
      screenshotRetentionDays: s.screenshotRetentionDays,
      snippetRetentionDays: s.snippetRetentionDays,
      auditRetentionDays: AUDIT_RETENTION_DAYS,
      macBrowserPageText: s.macBrowserPageText,
      screenshotVisibility: s.screenshotVisibility,
    },
    events: eventsAbout(db, p, new Date(now - EVENT_DAYS * 86_400_000).toISOString()),
    eventDays: EVENT_DAYS,
  };
}

/** Audit events where someone other than the caller acted on them: their view, their documents, their account. */
function eventsAbout(db: AuthDb, p: Principal, since: string): PrivacyEvent[] {
  const mine = [...new Set([...db.accountsForUser(p.orgId, p.userId).map((a) => a.username), p.username])];
  const targets = [...mine, p.userId];
  const marks = (xs: unknown[]) => xs.map(() => "?").join(",");
  const rows = db.db
    .prepare(
      `SELECT at, actor, action, detail FROM audit
       WHERE org_id = ? AND at >= ? AND action IN (${marks(ABOUT_YOU)})
         AND (actor IS NULL OR actor NOT IN (${marks(mine)}))
         AND (
           (action != 'source_opened' AND target IN (${marks(targets)}))
           OR (action = 'source_opened' AND (CASE WHEN json_valid(detail) THEN json_extract(detail, '$.author') END) = ?)
         )
       ORDER BY id DESC LIMIT ?`,
    )
    .all(p.orgId, since, ...ABOUT_YOU, ...mine, ...targets, p.userId, EVENT_LIMIT) as { at: string; actor: string | null; action: AuditAction; detail: string | null }[];
  return rows.map((r) => {
    const e: PrivacyEvent = { at: r.at, actor: r.actor, action: r.action };
    if (r.action === "source_opened" && r.detail) {
      try {
        const what = (JSON.parse(r.detail) as { what?: unknown }).what;
        if (what === "text" || what === "screenshot") e.what = what;
      } catch {
        // Not JSON: leave it out.
      }
    }
    return e;
  });
}

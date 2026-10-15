import { z } from "zod";
import type { Store } from "@/db/store";

/**
 * Per-org policy an admin controls. Read by ingest (what to keep), the extension (what to capture),
 * retention jobs (what to delete), the LLM client (what it may spend), and source routes (who sees screenshots).
 */
export type OrgSettings = {
  /** Master switch for the extension: false makes every client stop capturing. */
  captureEnabled: boolean;
  /** Hostnames the extension never captures (and the server drops if one slips through), like "mail.google.com". */
  excludedHosts: string[];
  /** Seconds between captures of a changed source. */
  captureIntervalSec: number;
  /** Captured documents older than this are deleted (their graph changes stay). 0 keeps them forever. */
  retentionDays: number;
  /** Screenshots are removed from documents older than this; the text stays until retentionDays. */
  screenshotRetentionDays: number;
  /** Who can open a colleague's screenshot. Page text and derived work items are always org-wide. */
  screenshotVisibility: "author_and_admins" | "org";
  /** LLM spend cap per calendar month (UTC). Model steps are skipped once reached; 0 means no cap. */
  llmMonthlyBudgetUsd: number;
  /** The monitoring notice people must accept before capture starts. Bumping it asks everyone again. */
  consentVersion: number;
  /** Mac time drafts round each entry's minutes up to this many minutes. */
  billingIncrementMin: 6 | 15;
  /** Mac work-block snippets and draft evidence quotes are cleared after this many days. 0 keeps them. */
  snippetRetentionDays: number;
  /** Macs may read page text in browsers (each person must also turn it on). Off: tab title and domain only. */
  macBrowserPageText: boolean;
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  captureEnabled: true,
  excludedHosts: [],
  captureIntervalSec: 5,
  retentionDays: 90,
  screenshotRetentionDays: 14,
  screenshotVisibility: "author_and_admins",
  llmMonthlyBudgetUsd: 50,
  consentVersion: 1,
  billingIncrementMin: 6,
  snippetRetentionDays: 14,
  macBrowserPageText: false,
};

function ensureTable(store: Store): void {
  store.db.exec("CREATE TABLE IF NOT EXISTS org_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
}

/** Stored values over the defaults, so a setting added later has a value in every existing org. */
export function getOrgSettings(store: Store): OrgSettings {
  ensureTable(store);
  const rows = store.db.prepare("SELECT key, value FROM org_settings").all() as { key: string; value: string }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  return { ...DEFAULT_ORG_SETTINGS, ...(stored as Partial<OrgSettings>) };
}

export function saveOrgSettings(store: Store, patch: Partial<OrgSettings>): OrgSettings {
  ensureTable(store);
  const stmt = store.db.prepare(
    "INSERT INTO org_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  store.transaction(() => {
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) stmt.run(key, JSON.stringify(value));
  });
  return getOrgSettings(store);
}

/** "https://www.Mail.Google.com/inbox" → "mail.google.com". null when nothing host-like is left. */
export function normalizeHost(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, "").replace(/\.$/, "");
    return (/^[a-z0-9.-]+$/.test(host) && host.includes(".")) || host === "localhost" ? host : null;
  } catch {
    return null;
  }
}

/** A partial OrgSettings as an admin sends it (PATCH /api/orgs/:orgId/settings). Unknown keys are refused. */
export const orgSettingsPatch = z
  .object({
    captureEnabled: z.boolean(),
    excludedHosts: z
      .array(z.string().max(253))
      .max(500)
      .transform((hosts, ctx) => {
        const out = new Set<string>();
        for (const h of hosts) {
          const n = normalizeHost(h);
          if (!n) ctx.addIssue({ code: "custom", message: `"${h}" is not a hostname` });
          else out.add(n);
        }
        return [...out];
      }),
    captureIntervalSec: z.number().int().min(1).max(3600),
    retentionDays: z.number().int().min(0).max(3650),
    screenshotRetentionDays: z.number().int().min(0).max(3650),
    screenshotVisibility: z.enum(["author_and_admins", "org"]),
    llmMonthlyBudgetUsd: z.number().min(0).max(1_000_000),
    consentVersion: z.number().int().min(1).max(1_000_000),
    billingIncrementMin: z.union([z.literal(6), z.literal(15)]),
    snippetRetentionDays: z.number().int().min(0).max(3650),
    macBrowserPageText: z.boolean(),
  })
  .partial()
  .strict();

/** "https://www.Mail.google.com/x" and "mail.google.com" both match an excluded "mail.google.com" (subdomains too). */
export function isExcludedUrl(settings: Pick<OrgSettings, "excludedHosts">, url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return settings.excludedHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

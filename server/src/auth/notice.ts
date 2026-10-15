import fs from "node:fs";
import path from "node:path";
import type { OrgSettings } from "@/orgs/settings";

/** Shown when the notice file is not deployed next to the server. */
export const BUILT_IN_NOTICE = `# Before you start: what Orion records

Orion records only the browser tabs, windows, or screens you pick, and only while recording is on: the page address, title, visible text (never passwords), and screenshots when the content changes.

Your colleagues see the work items and page text. Screenshots are visible to you and your org's admins unless your admin changed that. Page text is processed by AI models through OpenRouter to build work items.

You can pause or stop recording at any time from the Orion icon, and delete your own captures in Orion's settings. Ask your admin how long data is kept and who to contact about it.`;

const CANDIDATES = ["docs/legal/monitoring-notice.md", "docs/legal/employee-monitoring-notice.md"];

/** The notice markdown without the DRAFT banner, HTML comments, or the mock accept buttons after the last rule. */
export function cleanNotice(md: string): string {
  let s = md.replace(/<!--[\s\S]*?-->/g, "");
  s = s
    .split("\n")
    .filter((l) => !/^>\s*\*\*DRAFT/i.test(l))
    .join("\n");
  const rule = s.lastIndexOf("\n---");
  if (rule >= 0 && /\[\s?\]|\[ *Accept/i.test(s.slice(rule))) s = s.slice(0, rule);
  return s.trim();
}

let cached: string | null = null;

/** The monitoring notice text people accept (GET /api/auth/me → consent.notice). Read once per process. */
export function monitoringNotice(): string {
  if (cached !== null) return cached;
  const cwd = process.cwd(/* turbopackIgnore: true */);
  const roots = [cwd, path.resolve(/* turbopackIgnore: true */ cwd, "..")];
  for (const root of roots) {
    for (const rel of CANDIDATES) {
      try {
        const text = cleanNotice(fs.readFileSync(path.join(/* turbopackIgnore: true */ root, rel), "utf8"));
        if (text) return (cached = text);
      } catch {}
    }
  }
  return (cached = BUILT_IN_NOTICE);
}

const days = (n: number) => (n > 0 ? `${n} day${n === 1 ? "" : "s"}` : "until deleted");

/**
 * The notice for one org: the page already shows the title, so the leading heading goes, and the template's
 * placeholders are filled from the org's name and settings. Policy wording an org must write itself
 * (what Orion is not used for, a contact) gets a neutral default until counsel edits the file.
 */
export function noticeFor(org: { name: string } | null, settings: OrgSettings, notice = monitoringNotice()): string {
  const company = org?.name || "Your organization";
  const excluded = settings.excludedHosts.length ? settings.excludedHosts.join(", ") : "none set by your admin yet";
  const visible =
    settings.screenshotVisibility === "org"
      ? `visible to everyone in ${company}`
      : `visible only to you and ${company}'s Orion admins`;
  return notice
    .replace(/^#\s+[^\n]*\n+/, "")
    .replace(/visible only to you and \[Company\]'s Orion admins \[unless changed:[^\]]*\]/g, visible)
    .replace(/\[Company\]/g, company)
    .replace(/at most every \[5\] seconds/g, `at most every ${settings.captureIntervalSec} seconds`)
    .replace(/\[14\] days/g, days(settings.screenshotRetentionDays))
    .replace(/\[90\] days/g, days(settings.retentionDays))
    .replace(/\[list, e\.g\.[^\]]*\]/g, excluded)
    .replace(/\[measure productivity[^\]]*\]\s*—\s*\[edit to match your policy\]/g, "measure productivity or make disciplinary decisions")
    .replace(/\[link to privacy policy\]/g, "[Privacy policy](/privacy)")
    .replace(/\[contact name \/ email\]|\[contact\]/g, "your Orion admin");
}

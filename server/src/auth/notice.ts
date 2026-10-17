import fs from "node:fs";
import path from "node:path";
import type { OrgSettings } from "@/orgs/settings";

/** Shown when the notice file is not deployed next to the server. */
export const BUILT_IN_NOTICE = `# Before you start: what Orion records

**[Company] uses Orion to keep a shared, current picture of the team's work and to draft your daily time entries.** Please read this before you turn on capture. Nothing is sent to Orion until you accept this notice.

**What the Orion Mac app reads.**

- Text on screen in the front window of the apps you turn on. Every app starts off. Password managers, Keychain and System Settings can't be turned on.
- In browsers: the tab title and the page address, cut to the domain and path (no query strings). Page text only if [Company] allows it and you turn it on yourself. [browser page text]
- Which app and window you were in, and when.

Orion never takes screenshots. It doesn't record keystrokes, audio or your camera. It skips private and incognito windows and password fields. It skips banking sites and any sites or words you add to your skip list. Sites [Company] blocks for everyone: [excluded sites].

**Cleaned on your Mac first.** Before anything is saved, the app removes card numbers, Social Security numbers, and API keys and tokens. It also removes email addresses, phone numbers and street addresses unless you turn that off. You can also choose to hide people's names.

**The Outbox.** What the app captures waits in the Outbox on your Mac, where you can read, edit or delete it. Items you don't review are approved automatically after 30 minutes and then sent. You can turn auto-approve off, so nothing is sent until you approve it. While items wait, the app may send them to Orion only to write a short summary for you. That text is not stored.

**What Orion does with it.** AI models read your approved work to find work items (projects, tasks, blockers, who's on what) and to draft your daily time entries by client. The models run through OpenRouter, only at providers that keep nothing and don't train on it.

**Who sees it.**

- Everyone in [Company] sees the work items. They can describe what you worked on.
- The text from your Mac is visible only to you and [Company]'s Orion admins.
- Admins can view Orion as you. Each time is recorded in the audit log.
- You review your own time entries. Admins can export the entries you accept or edit (date, client, minutes, description) and see how many entries each person accepted, edited or rejected.

Orion does not score or rank people. Ask [contact] how [Company] uses this information.

**How long it's kept.** Text from your Mac: [snippet days]. Window titles, page addresses and times: [document days] in search, and they stay with your time records until deleted. Time entries and work items stay until deleted.

**Your controls.**

- Pause or turn off capture at any time from the Orion icon in the menu bar.
- Choose which apps are read, and change your skip list and what is removed.
- Review, edit or delete items in the Outbox before they're sent.
- Delete your data from the Mac app or from Orion's settings. Work items already built from it stay.
- Download a copy of your data from Orion's settings.
- Ask [contact] to see, correct or delete your data.

**If [Company] still uses the older Orion Chrome extension.** It records only the tabs, windows or screens you pick, while recording is on: the page address, title and visible text (never passwords), and screenshots when the content changes, at most every [interval] seconds. Its page text is visible to everyone in [Company] and kept [document days]. Screenshots are [screenshot visibility] and kept [screenshot days].

**More detail:** [link to privacy policy] · Questions: [contact]`;

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
 * [bracketed] fields are filled from the org's name and settings. [Company] is filled last, since other fields'
 * text names the company too.
 */
export function noticeFor(org: { name: string } | null, settings: OrgSettings, notice = monitoringNotice()): string {
  const company = org?.name || "Your organization";
  const excluded = settings.excludedHosts.length ? settings.excludedHosts.join(", ") : "none set yet";
  const pageText = settings.macBrowserPageText ? "[Company] allows this now." : "[Company] has this turned off now.";
  const visible = settings.screenshotVisibility === "org" ? "visible to everyone in [Company]" : "visible only to you and [Company]'s Orion admins";
  return notice
    .replace(/^#\s+[^\n]*\n+/, "")
    .replace(/\[browser page text\]/g, pageText)
    .replace(/\[screenshot visibility\]/g, visible)
    .replace(/\[excluded sites\]/g, excluded)
    .replace(/\[snippet days\]/g, days(settings.snippetRetentionDays))
    .replace(/\[document days\]/g, days(settings.retentionDays))
    .replace(/\[screenshot days\]/g, days(settings.screenshotRetentionDays))
    .replace(/\[interval\]/g, String(settings.captureIntervalSec))
    .replace(/\[link to privacy policy\]/g, "[Privacy policy](/privacy)")
    .replace(/\[contact\]/g, "your Orion admin")
    .replace(/\[Company\]/g, company);
}

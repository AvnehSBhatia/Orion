import fs from "node:fs";
import path from "node:path";

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

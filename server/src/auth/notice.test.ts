import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_SETTINGS } from "@/orgs/settings";
import { noticeFor } from "./notice";

const TEMPLATE = `# Before you start: what Orion records

**[Company] uses Orion.** Screenshots when the content changes, at most every [5] seconds. Never recorded: [list, e.g. banking, health, HR, personal email].
[Company] does not use Orion to [measure productivity / time-track / make disciplinary decisions] — [edit to match your policy].
- **Screenshots** are visible only to you and [Company]'s Orion admins [unless changed: "to everyone in the organization"].
**How long it's kept.** Screenshots: [14] days. Page text: [90] days.
Ask [contact] to see your data. **More detail:** [link to privacy policy] · Questions: [contact name / email]`;

describe("noticeFor", () => {
  it("fills every placeholder from the org and its settings and drops the duplicate title", () => {
    const out = noticeFor({ name: "Acme" }, { ...DEFAULT_ORG_SETTINGS, excludedHosts: ["mail.google.com"], retentionDays: 0 }, TEMPLATE);
    expect(out).not.toMatch(/\[(?!Privacy policy\])[^\]]*\]/);
    expect(out.startsWith("#")).toBe(false);
    expect(out).toContain("Acme uses Orion");
    expect(out).toContain("at most every 5 seconds");
    expect(out).toContain("Never recorded: mail.google.com");
    expect(out).toContain("visible only to you and Acme's Orion admins");
    expect(out).toContain("Screenshots: 14 days. Page text: until deleted.");
  });

  it("says screenshots are org-wide when the org chose that", () => {
    expect(noticeFor({ name: "Acme" }, { ...DEFAULT_ORG_SETTINGS, screenshotVisibility: "org" }, TEMPLATE)).toContain("visible to everyone in Acme");
  });

  it("leaves no brackets in the real notice file", () => {
    expect(noticeFor({ name: "Acme" }, DEFAULT_ORG_SETTINGS)).not.toMatch(/\[(?!Privacy policy\])[^\]]*\]/);
  });
});

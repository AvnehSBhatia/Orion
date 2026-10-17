import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_SETTINGS } from "@/orgs/settings";
import { BUILT_IN_NOTICE, cleanNotice, noticeFor } from "./notice";

const TEMPLATE = `# Before you start: what Orion records

**[Company] uses Orion.** Page text only if [Company] allows it. [browser page text]
Sites [Company] blocks for everyone: [excluded sites].
Text from your Mac: [snippet days]. Search: [document days]. Screenshots are [screenshot visibility] and kept [screenshot days], at most every [interval] seconds.
Ask [contact]. **More detail:** [link to privacy policy] · Questions: [contact]`;

const NO_BRACKETS = /\[(?!Privacy policy\])[^\]]*\]/;

describe("noticeFor", () => {
  it("fills every field from the org and its settings and drops the duplicate title", () => {
    const out = noticeFor({ name: "Acme" }, { ...DEFAULT_ORG_SETTINGS, excludedHosts: ["mail.google.com"], retentionDays: 0 }, TEMPLATE);
    expect(out).not.toMatch(NO_BRACKETS);
    expect(out.startsWith("#")).toBe(false);
    expect(out).toContain("Acme uses Orion");
    expect(out).toContain("Acme has this turned off now.");
    expect(out).toContain("blocks for everyone: mail.google.com.");
    expect(out).toContain("Text from your Mac: 14 days. Search: until deleted.");
    expect(out).toContain("visible only to you and Acme's Orion admins and kept 14 days, at most every 5 seconds");
    expect(out).toContain("Ask your Orion admin.");
    expect(out).toContain("[Privacy policy](/privacy)");
  });

  it("follows the org's browser page text and screenshot settings", () => {
    const out = noticeFor({ name: "Acme" }, { ...DEFAULT_ORG_SETTINGS, macBrowserPageText: true, screenshotVisibility: "org" }, TEMPLATE);
    expect(out).toContain("Acme allows this now.");
    expect(out).toContain("visible to everyone in Acme");
    expect(out).toContain("blocks for everyone: none set yet.");
  });

  it("leaves no brackets in the real notice file", () => {
    expect(noticeFor({ name: "Acme" }, DEFAULT_ORG_SETTINGS)).not.toMatch(NO_BRACKETS);
  });

  it("keeps the built-in notice identical to docs/legal/employee-monitoring-notice.md", () => {
    const file = path.resolve(__dirname, "../../../docs/legal/employee-monitoring-notice.md");
    expect(cleanNotice(fs.readFileSync(file, "utf8"))).toBe(BUILT_IN_NOTICE);
  });

  it("fills the built-in notice too", () => {
    expect(noticeFor({ name: "Acme" }, DEFAULT_ORG_SETTINGS, BUILT_IN_NOTICE)).not.toMatch(NO_BRACKETS);
  });
});

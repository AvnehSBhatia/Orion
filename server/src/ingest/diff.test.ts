import { describe, expect, it } from "vitest";
import { MAX_DIFF_CHARS, pageDiff, pageOf, samePage, withChanges } from "./diff";

const PAGE = ["Campaigns", "Q4 search campaign", "Daily budget $900", "Status: Enabled", "Cost per signup 41", "Last updated 12:03 PM"].join("\n");

describe("pageDiff", () => {
  it("reports an edited value as a change with its old and new values", () => {
    const next = PAGE.replace("$900", "$1,200");
    expect(pageDiff(PAGE, next)).toBe('Changed: "Daily budget $900" -> "Daily budget $1,200" ($900 -> $1,200)');
  });

  it("reports added and removed lines", () => {
    const next = PAGE.replace("Status: Enabled\n", "").replace("Campaigns\n", "Campaigns\nNew ad group: Brand terms\n");
    expect(pageDiff(PAGE, next)).toBe('Added: "New ad group: Brand terms"\nRemoved: "Status: Enabled"');
  });

  it("ignores clock times and relative timestamps", () => {
    const next = PAGE.replace("12:03 PM", "12:07 PM");
    expect(pageDiff(PAGE, next)).toBeNull();
    expect(samePage(PAGE, next)).toBe(true);
    expect(samePage("Synced 5 minutes ago\nBudget 900", "Synced 6 minutes ago\nBudget 900")).toBe(true);
    expect(samePage(PAGE, PAGE.replace("$900", "$950"))).toBe(false);
  });

  it("gives no diff when the page is mostly different (another view on the same URL)", () => {
    expect(pageDiff(PAGE, "Billing\nInvoices\nPayment method Visa 4242\nNext charge Nov 1\nTax ID")).toBeNull();
  });

  it("does not report lines after a truncated previous capture as added", () => {
    const prev = PAGE.slice(0, PAGE.indexOf("Cost"));
    expect(pageDiff(prev, PAGE.replace("$900", "$1,200"), { prevTruncated: true })).toBe(
      'Changed: "Daily budget $900" -> "Daily budget $1,200" ($900 -> $1,200)',
    );
  });

  it("caps the block", () => {
    const rows = (bump: (i: number) => number) => Array.from({ length: 1000 }, (_, i) => `Ad group ${i} spend ${bump(i)}`).join("\n");
    const d = pageDiff(rows((i) => i), rows((i) => (i % 4 ? i : i + 1)))!;
    expect(d.length).toBeLessThanOrEqual(MAX_DIFF_CHARS);
    expect(d).toMatch(/\.\.\. and \d+ more changes$/);
  });
});

describe("stored change block", () => {
  it("round-trips the page text", () => {
    const stored = withChanges(PAGE, 'Changed: "a" -> "b"', "2026-10-10T12:00:00.000Z");
    expect(stored.startsWith("What changed since the last capture (at 2026-10-10T12:00:00.000Z):\nChanged:")).toBe(true);
    expect(pageOf(stored)).toBe(PAGE);
    expect(pageOf(PAGE)).toBe(PAGE);
    expect(withChanges(PAGE, null, "")).toBe(PAGE);
  });
});

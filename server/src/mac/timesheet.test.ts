import { describe, expect, it } from "vitest";
import { memoryStore } from "@/test/helpers";
import { ensureMacTables } from "./schema";
import { myTimesheet } from "./timesheet";

describe("myTimesheet", () => {
  it("returns one person's entries and totals only the accepted ones", () => {
    const store = memoryStore();
    ensureMacTables(store);
    const now = "2026-10-16T00:00:00.000Z";
    store.db.prepare("INSERT INTO mac_clients (id, name, seq, created_at, updated_at) VALUES ('c1', 'Initech', 1, ?, ?)").run(now, now);
    const draft = store.db.prepare("INSERT INTO mac_drafts (id, user_id, day, created_at) VALUES (?, ?, ?, ?)");
    draft.run("d1", "ada", "2026-10-14", now);
    draft.run("d2", "ada", "2026-10-15", now);
    draft.run("d3", "grace", "2026-10-15", now);
    const entry = store.db.prepare(
      "INSERT INTO mac_entries (id, draft_id, user_id, client_id, unmatched, started_at, ended_at, minutes, narrative, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    entry.run("e1", "d1", "ada", "c1", 0, now, now, 60, "Pricing page", "accepted", now);
    entry.run("e2", "d2", "ada", "c1", 0, now, now, 30, "Still a draft", "proposed", now);
    entry.run("e3", "d2", "ada", null, 1, now, now, 15, "No match", "edited", now);
    entry.run("e4", "d3", "grace", "c1", 0, now, now, 90, "Not Ada", "accepted", now);

    const sheet = myTimesheet(store, "ada", "2026-10-01", "2026-10-16");
    expect(sheet.userId).toBe("ada");
    expect(sheet.entries.map((e) => e.narrative)).toEqual(["Pricing page", "Still a draft", "No match"]);
    expect(sheet.entries.map((e) => e.client)).toEqual(["Initech", "Initech", "No client"]);
    expect(sheet.clients).toEqual([
      { client: "Initech", minutes: 60, entries: 1 },
      { client: "No client", minutes: 15, entries: 1 },
    ]);
  });
});

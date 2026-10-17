// GET /api/me/time: the caller's own time entries for a range. No snippets, no one else's rows.
import type { Store } from "@/db/store";
import { dayRange } from "./drafts";
import { ensureMacTables } from "./schema";

export type TimesheetEntry = {
  day: string;
  client: string;
  minutes: number;
  narrative: string;
  status: "proposed" | "accepted" | "edited" | "rejected";
};

export type TimesheetClient = { client: string; minutes: number; entries: number };

export type MyTimesheet = {
  userId: string;
  from: string;
  to: string;
  entries: TimesheetEntry[];
  /** Accepted and edited minutes, grouped by client. Drafts and rejections stay in `entries` only. */
  clients: TimesheetClient[];
};

const clientName = (store: Store, id: string | null, unmatched: number) => {
  if (unmatched || !id) return "No client";
  return (store.db.prepare("SELECT name FROM mac_clients WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "Unknown client";
};

/** The signed-in person's entries between two days. `from` and `to` are optional YYYY-MM-DD. */
export function myTimesheet(store: Store, userId: string, from: string | null, to: string | null, now = new Date()): MyTimesheet {
  ensureMacTables(store);
  const range = dayRange(from, to, 14, now);
  const rows = store.db
    .prepare(
      `SELECT d.day AS day, e.client_id AS client_id, e.unmatched AS unmatched, e.minutes AS minutes, e.narrative AS narrative, e.status AS status
       FROM mac_entries e JOIN mac_drafts d ON d.id = e.draft_id
       WHERE e.user_id = ? AND d.day BETWEEN ? AND ?
       ORDER BY d.day, e.started_at, e.id`,
    )
    .all(userId, range.from, range.to) as {
    day: string;
    client_id: string | null;
    unmatched: number;
    minutes: number;
    narrative: string;
    status: TimesheetEntry["status"];
  }[];
  const entries = rows.map((r) => ({
    day: r.day,
    client: clientName(store, r.client_id, r.unmatched),
    minutes: r.minutes,
    narrative: r.narrative,
    status: r.status,
  }));
  const tally = new Map<string, TimesheetClient>();
  for (const e of entries) {
    if (e.status !== "accepted" && e.status !== "edited") continue;
    const cur = tally.get(e.client) ?? { client: e.client, minutes: 0, entries: 0 };
    cur.minutes += e.minutes;
    cur.entries += 1;
    tally.set(e.client, cur);
  }
  return {
    userId,
    ...range,
    entries,
    clients: [...tally.values()].sort((a, b) => b.minutes - a.minutes || a.client.localeCompare(b.client)),
  };
}

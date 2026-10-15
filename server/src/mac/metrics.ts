// Pilot metrics from reviewed entries and baselines: recovered minutes, acceptance and edit rates, active days.
import type { Store } from "@/db/store";
import { ensureMacTables } from "./schema";
import { addDays, eachDay } from "./time";

type ClientMinutes = { clientId: string | null; minutes: number };
export type ReviewCounts = { acceptedAsIs: number; edited: number; rejected: number };

function sumByClient(rows: ClientMinutes[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.clientId ?? "", (totals.get(r.clientId ?? "") ?? 0) + r.minutes);
  return totals;
}

/** Accepted minutes not already on that day's baseline timesheet, per client. Null when no baseline was submitted. */
export function recoveredMinutes(hasBaseline: boolean, accepted: ClientMinutes[], baseline: ClientMinutes[]): number | null {
  if (!hasBaseline) return null;
  const base = sumByClient(baseline);
  let out = 0;
  for (const [k, m] of sumByClient(accepted)) out += Math.max(0, m - (base.get(k) ?? 0));
  return out;
}

const total = (c: ReviewCounts) => c.acceptedAsIs + c.edited + c.rejected;
export const acceptanceRate = (c: ReviewCounts) => (total(c) === 0 ? null : c.acceptedAsIs / total(c));
export const editRate = (c: ReviewCounts) => (total(c) === 0 ? null : c.edited / total(c));
/** Active in the window: at least 3 of the last 5 days had a reviewed entry. */
export const isActiveInWindow = (activeDays: number, required = 3) => activeDays >= required;

export type DayMetrics = { day: string; recovered_minutes: number | null; acceptance_rate: number | null; edit_rate: number | null; active: boolean };
export type Metrics = { days: DayMetrics[]; active_in_window: boolean };

type EntryRow = { day: string; status: string; client_id: string | null; minutes: number };

/** One person's metrics for the days from..to (inclusive, "YYYY-MM-DD"). */
export function metricsFor(store: Store, userId: string, from: string, to: string): Metrics {
  ensureMacTables(store);
  const windowFrom = addDays(to, -4);
  const queryFrom = from < windowFrom ? from : windowFrom;
  const entries = store.db
    .prepare(
      `SELECT d.day AS day, e.status AS status, e.client_id AS client_id, e.minutes AS minutes
       FROM mac_entries e JOIN mac_drafts d ON d.id = e.draft_id WHERE e.user_id = ? AND d.day BETWEEN ? AND ?`,
    )
    .all(userId, queryFrom, to) as EntryRow[];
  const baseline = store.db.prepare("SELECT day, client_id, minutes FROM mac_baseline WHERE user_id = ? AND day BETWEEN ? AND ?").all(userId, queryFrom, to) as {
    day: string;
    client_id: string | null;
    minutes: number;
  }[];
  const baselineDays = new Set(
    (store.db.prepare("SELECT day FROM mac_baseline_days WHERE user_id = ? AND day BETWEEN ? AND ?").all(userId, queryFrom, to) as { day: string }[]).map((r) => r.day),
  );
  const scored = eachDay(queryFrom, to).map((day) => {
    const es = entries.filter((e) => e.day === day);
    const counts: ReviewCounts = {
      acceptedAsIs: es.filter((e) => e.status === "accepted").length,
      edited: es.filter((e) => e.status === "edited").length,
      rejected: es.filter((e) => e.status === "rejected").length,
    };
    const accepted = es.filter((e) => e.status === "accepted" || e.status === "edited").map((e) => ({ clientId: e.client_id, minutes: e.minutes }));
    return {
      day,
      recovered_minutes: recoveredMinutes(
        baselineDays.has(day),
        accepted,
        baseline.filter((b) => b.day === day).map((b) => ({ clientId: b.client_id, minutes: b.minutes })),
      ),
      acceptance_rate: acceptanceRate(counts),
      edit_rate: editRate(counts),
      active: total(counts) >= 1,
    };
  });
  return {
    days: scored.filter((d) => d.day >= from && d.day <= to),
    active_in_window: isActiveInWindow(scored.filter((d) => d.day >= windowFrom && d.active).length),
  };
}

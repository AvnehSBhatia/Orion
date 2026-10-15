// One dashboard per person, stored as the spec JSON.
import type { DashboardSpec } from "@/contract/types";
import type { Db } from "./rows";

export function getDashboard(db: Db, userId: string): DashboardSpec | null {
  const row = db.prepare("SELECT spec FROM dashboards WHERE user_id = ?").get(userId) as { spec: string } | undefined;
  return row ? (JSON.parse(row.spec) as DashboardSpec) : null;
}

export function saveDashboard(db: Db, userId: string, spec: DashboardSpec): void {
  db.prepare(
    `INSERT INTO dashboards (user_id, spec, origin, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET spec = excluded.spec, origin = excluded.origin, updated_at = excluded.updated_at`,
  ).run(userId, JSON.stringify(spec), spec.origin, spec.updatedAt);
}

export function deleteDashboard(db: Db, userId: string): void {
  db.prepare("DELETE FROM dashboards WHERE user_id = ?").run(userId);
}

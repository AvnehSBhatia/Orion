// The org profile, its people, and which nodes each person has worked on.
import type { Org, User } from "@/contract/types";
import { fromBlob, toBlob, type Db } from "./rows";
import type { StoredUser } from "./types";

type UserRow = {
  id: string;
  name: string;
  role: string;
  team_description: string;
  seed_vec: Buffer | null;
  seed_model: string | null;
  user_vec: Buffer | null;
  ranked: string | null;
  gravity: Buffer | null;
  gravity_version: string | null;
};

function rowToUser(r: UserRow): StoredUser {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    teamDescription: r.team_description,
    seedVec: fromBlob(r.seed_vec),
    seedModel: r.seed_model,
    userVec: fromBlob(r.user_vec),
    ranked: r.ranked ? (JSON.parse(r.ranked) as string[]) : null,
    gravity: fromBlob(r.gravity),
    gravityVersion: r.gravity_version,
  };
}

/** One row per org file. */
export function getOrg(db: Db): Org | null {
  const row = db.prepare("SELECT * FROM org LIMIT 1").get() as
    | { id: string; name: string; description: string; websites: string; context: string; created_at: string }
    | undefined;
  if (!row) return null;
  const { created_at, websites, ...rest } = row;
  return { ...rest, websites: JSON.parse(websites) as string[], createdAt: created_at };
}

export function saveOrg(db: Db, o: Org): void {
  db.transaction(() => {
    db.prepare("DELETE FROM org WHERE id <> ?").run(o.id);
    db.prepare(
      `INSERT INTO org (id, name, description, websites, context, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
         websites = excluded.websites, context = excluded.context`,
    ).run(o.id, o.name, o.description, JSON.stringify(o.websites), o.context, o.createdAt);
  })();
}

export function listUsers(db: Db): StoredUser[] {
  return (db.prepare("SELECT * FROM users ORDER BY id").all() as UserRow[]).map(rowToUser);
}

export function getUser(db: Db, id: string): StoredUser | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/** Saving a person clears their seed vector, so a changed role is re-embedded. */
export function saveUser(db: Db, u: User): void {
  db.prepare(
    `INSERT INTO users (id, name, role, team_description) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role,
       team_description = excluded.team_description, seed_vec = NULL, seed_model = NULL`,
  ).run(u.id, u.name, u.role, u.teamDescription);
}

export function setUserSeed(db: Db, id: string, vec: Float32Array, model: string): void {
  db.prepare("UPDATE users SET seed_vec = ?, seed_model = ? WHERE id = ?").run(toBlob(vec), model, id);
}

export type Steering = { userVec: Float32Array | null; gravity: Float32Array | null; gravityVersion: string | null; ranked: string[] };

export function setUserSteering(db: Db, id: string, s: Steering): void {
  db.prepare("UPDATE users SET user_vec = ?, gravity = ?, gravity_version = ?, ranked = ? WHERE id = ?").run(
    toBlob(s.userVec),
    toBlob(s.gravity),
    s.gravityVersion,
    JSON.stringify(s.ranked),
    id,
  );
}

export function addTouches(db: Db, userId: string, nodeIds: string[]): void {
  const stmt = db.prepare("INSERT OR IGNORE INTO touches (user_id, node_id) VALUES (?, ?)");
  db.transaction(() => nodeIds.forEach((id) => stmt.run(userId, id)))();
}

export function touchedNodeIds(db: Db, userId: string): string[] {
  return (db.prepare("SELECT node_id FROM touches WHERE user_id = ?").all(userId) as { node_id: string }[]).map((r) => r.node_id);
}

import type { User } from "@/contract/types";
import type { Store, StoredUser } from "@/db/store";
import type { Embedder } from "@/llm/embed";
import { recomputeUserVectors } from "@/orgspace/personVectors";

/** Owners are free text written by the model: a full name, a first name, or a user id all count. */
export function ownerMatches(owner: string | null, user: Pick<StoredUser, "id" | "name">): boolean {
  if (!owner) return false;
  const o = owner.trim().toLowerCase();
  const name = user.name.toLowerCase();
  return o === name || o === user.id.toLowerCase() || o === name.split(/\s+/)[0];
}

/**
 * Creates or updates a person and re-anchors everyone's gravity. A new role means a new default dashboard;
 * one they shaped by asking Orion stays.
 */
export async function upsertPerson(store: Store, embedder: Embedder, user: User): Promise<StoredUser> {
  const before = store.getUser(user.id);
  if (before && before.role !== user.role && store.getDashboard(user.id)?.origin === "role") store.deleteDashboard(user.id);
  store.saveUser(user);
  await recomputeUserVectors(store, embedder);
  return store.getUser(user.id)!;
}

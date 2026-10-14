import type { StoredUser } from "@/db/store";

/** Owners are free text written by the model: a full name, a first name, or a user id all count. */
export function ownerMatches(owner: string | null, user: Pick<StoredUser, "id" | "name">): boolean {
  if (!owner) return false;
  const o = owner.trim().toLowerCase();
  const name = user.name.toLowerCase();
  return o === name || o === user.id.toLowerCase() || o === name.split(/\s+/)[0];
}

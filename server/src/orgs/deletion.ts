import { audit } from "@/audit/log";
import type { AuthDb, Principal } from "@/auth/db";
import { DEFAULT_ORG } from "@/contract/schemas";
import type { Store } from "@/db/store";
import { deleteOrgStore } from "@/http/deps";
import { HttpError } from "@/http/error";

/**
 * Removes every document a person captured or committed: the text, the screenshot, what each changed in the graph
 * (source_changes), its summary and area labels, any digest built from it, and the person's touches. The graph
 * nodes and edges those documents produced stay, since colleagues' work builds on them.
 */
export function deleteCapturesBy(store: Store, userId: string): number {
  return store.transaction(() => {
    const ids = (store.db.prepare("SELECT id FROM sources WHERE author_id = ?").all(userId) as { id: string }[]).map((r) => r.id);
    deleteSources(store, ids);
    store.db.prepare("DELETE FROM touches WHERE user_id = ?").run(userId);
    return ids.length;
  });
}

/** Removes these documents and everything derived from them (changes, summaries, facets, digests built from them). */
export function deleteSources(store: Store, ids: string[]): void {
  store.transaction(() => {
    if (ids.length) {
      const gone = new Set(ids);
      const digests = store.db.prepare("SELECT id, members FROM digests").all() as { id: string; members: string }[];
      const stale = digests.filter((d) => (JSON.parse(d.members) as string[]).some((m) => gone.has(m))).map((d) => d.id);
      if (stale.length) store.deleteDigests(stale);
      const facet = store.db.prepare("DELETE FROM facets WHERE item_kind = 'source' AND item_id = ?");
      const changes = store.db.prepare("DELETE FROM source_changes WHERE source_id = ?");
      const summary = store.db.prepare("DELETE FROM summaries WHERE source_id = ?");
      const source = store.db.prepare("DELETE FROM sources WHERE id = ?");
      for (const id of ids) {
        facet.run(id);
        changes.run(id);
        summary.run(id);
        source.run(id);
      }
    }
  });
}

/** The caller deletes their own captures. */
export function deleteMyCaptures(db: AuthDb, store: Store, p: Principal): { deleted: number } {
  const deleted = deleteCapturesBy(store, p.userId);
  audit(db, { orgId: p.orgId, actor: p.username, action: "data_deleted", target: p.userId, detail: { what: "own captures", documents: deleted } });
  return { deleted };
}

/** An admin removes a person: their captures, the person (dashboard, touches), and every account they sign in with. */
export function deletePerson(db: AuthDb, store: Store, actor: Principal | null, orgId: string, userId: string): { deleted: number } {
  if (actor && actor.userId === userId) throw new HttpError(400, "you cannot delete yourself; ask another admin");
  const accounts = db.accountsForUser(orgId, userId);
  if (!store.getUser(userId) && accounts.length === 0) throw new HttpError(404, `unknown userId "${userId}"`);
  const others = db.activeAdmins(orgId).filter((u) => !accounts.some((a) => a.username === u));
  if (accounts.some((a) => a.admin && !a.disabled) && others.length === 0) throw new HttpError(409, "the org needs at least one active admin");
  const deleted = deleteCapturesBy(store, userId);
  store.transaction(() => {
    store.db.prepare("DELETE FROM dashboards WHERE user_id = ?").run(userId);
    store.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  for (const a of accounts) db.deleteAccount(a.username);
  audit(db, {
    orgId,
    actor: actor?.username ?? null,
    action: "data_deleted",
    target: userId,
    detail: { what: "person", documents: deleted, accounts: accounts.map((a) => a.username) },
  });
  return { deleted };
}

/** An admin removes the whole org: its SQLite file and every account, token, and invite in it. The audit log stays. */
export function deleteOrg(db: AuthDb, actor: Principal | null, orgId: string, confirm: string): void {
  if (confirm !== orgId) throw new HttpError(400, `send { "confirm": "${orgId}" } to delete this org`);
  if (orgId === DEFAULT_ORG) throw new HttpError(400, "the demo org cannot be deleted");
  deleteOrgStore(orgId);
  const accounts = db.deleteOrg(orgId);
  audit(db, { orgId, actor: actor?.username ?? null, action: "data_deleted", target: orgId, detail: { what: "org", accounts } });
}

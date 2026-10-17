// DELETE /v1/me/data: the person's Mac data goes now, including the Orion documents made from their blocks.
import { randomUUID } from "node:crypto";
import { audit } from "@/audit/log";
import type { AuthDb, Principal } from "@/auth/db";
import type { Store } from "@/db/store";
import { deleteMacRows, deleteSources } from "@/orgs/deletion";
import { ensureMacTables } from "./schema";

export function deleteMacData(db: AuthDb, store: Store, p: Principal): { request_id: string } {
  ensureMacTables(store);
  const uid = p.userId;
  const counts = store.transaction(() => {
    const q = store.db;
    const sources = (q.prepare("SELECT source_id FROM mac_work_blocks WHERE user_id = ? AND source_id IS NOT NULL").all(uid) as { source_id: string }[]).map((r) => r.source_id);
    deleteSources(store, sources);
    const blocks = deleteMacRows(store, uid);
    return { blocks, documents: sources.length };
  });
  const request_id = randomUUID();
  audit(db, { orgId: p.orgId, actor: p.username, action: "data_deleted", target: uid, detail: { what: "mac data", request_id, ...counts } });
  return { request_id };
}

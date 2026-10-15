import { z } from "zod";
import { audit } from "@/audit/log";
import { HttpError } from "@/http/error";
import type { AuthDb, Principal } from "./db";

export const createTokenRequest = z.object({ label: z.string().trim().min(1).max(80).default("api token") });

/** A new API token for MCP, the extension, or CI. The raw token is returned once. */
export function createApiToken(db: AuthDb, p: Principal, label: string) {
  const { token, info } = db.issueToken(p.username, "api", label);
  audit(db, { orgId: p.orgId, actor: p.username, action: "token_created", target: info.id, detail: { label } });
  return { token, ...info, orgId: p.orgId, userId: p.userId };
}

/** Revokes one of your tokens; an admin may revoke any token of an account in their org. 404 otherwise. */
export function revokeTokenAs(db: AuthDb, p: Principal, id: string): void {
  const t = db.tokenById(id);
  const owner = t ? db.getAccount(t.username) : null;
  const allowed = t && (t.username === p.username || (p.admin && owner?.orgId === p.orgId));
  if (!t || !allowed) throw new HttpError(404, `unknown token "${id}"`);
  db.revokeToken(id);
  audit(db, { orgId: p.orgId, actor: p.username, action: "token_revoked", target: id, detail: { owner: t.username, kind: t.kind } });
}

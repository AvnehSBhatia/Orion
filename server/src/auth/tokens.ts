import { z } from "zod";
import { audit } from "@/audit/log";
import { HttpError } from "@/http/error";
import type { AuthDb, Principal } from "./db";

export const createTokenRequest = z.object({
  label: z.string().trim().min(1).max(80).default("api token"),
  /** api: MCP and scripts, acting as you. ci: a repo's GitHub sync, which may only send commits (admins). */
  kind: z.enum(["api", "ci"]).default("api"),
  /** Days until the token stops working; omitted, it lasts until revoked. */
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

/** A new API or CI token. The raw token is returned once. A CI token is an admin's, so commits are credited by git author. */
export function createApiToken(db: AuthDb, p: Principal, label: string, kind: "api" | "ci" = "api", expiresInDays?: number, now = Date.now()) {
  if (kind === "ci" && !p.admin) throw new HttpError(403, "only an admin can connect a repo");
  const expiresAt = expiresInDays ? new Date(now + expiresInDays * 86_400_000).toISOString() : null;
  const { token, info } = db.issueToken(p.username, kind, label, expiresAt);
  audit(db, { orgId: p.orgId, actor: p.username, action: "token_created", target: info.id, detail: { label, kind, expiresAt } });
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

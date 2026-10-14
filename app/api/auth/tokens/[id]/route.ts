import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { HttpError, preflight, requirePrincipal, route } from "@/server/http";

export const runtime = "nodejs";

/** Revoke one of your tokens. An admin may revoke any token of an account in their org. */
export const DELETE = route(
  async (req: NextRequest, ctx: RouteContext<"/api/auth/tokens/[id]">) => {
    const p = requirePrincipal(req);
    const { id } = await ctx.params;
    const db = getAuthDb();
    const t = db.tokenById(id);
    const owner = t ? db.getAccount(t.username) : null;
    const allowed = t && (t.username === p.username || (p.admin && owner?.orgId === p.orgId));
    if (!t || !allowed) throw new HttpError(404, `unknown token "${id}"`);
    db.revokeToken(id);
    return { ok: true };
  },
  { public: true },
);

export const OPTIONS = preflight;

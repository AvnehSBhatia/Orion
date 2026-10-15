import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/audit/log";
import { getAuthDb } from "@/auth/db";
import { clearedSessionCookies } from "@/auth/request";
import { optionalPrincipal, preflight, route } from "@/http/route";

export const runtime = "nodejs";

/** Revokes the token this request carries (cookie or bearer) and clears the cookie. */
export const POST = route(
  async (req: NextRequest) => {
    const p = optionalPrincipal(req);
    if (p) {
      const db = getAuthDb();
      db.revokeToken(p.tokenId);
      audit(db, { orgId: p.orgId, actor: p.username, action: "logout", target: p.username });
    }
    const res = NextResponse.json({ ok: true });
    for (const c of clearedSessionCookies()) res.headers.append("Set-Cookie", c);
    return res;
  },
  { public: true },
);

export const OPTIONS = preflight;

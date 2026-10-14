import { NextResponse, type NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { authenticate, clearedSessionCookie } from "@/auth/request";
import { preflight, route } from "@/server/http";

export const runtime = "nodejs";

/** Revokes the token this request carries (cookie or bearer) and clears the cookie. */
export const POST = route(
  async (req: NextRequest) => {
    const p = authenticate(req);
    if (p) getAuthDb().revokeToken(p.tokenId);
    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", clearedSessionCookie());
    return res;
  },
  { public: true },
);

export const OPTIONS = preflight;

import { NextResponse, type NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { loginLimiter } from "@/auth/ratelimit";
import { clientIp, sessionCookie } from "@/auth/request";
import { login, loginRequest } from "@/auth/service";
import { preflight, route } from "@/server/http";

export const runtime = "nodejs";

/** Username and password in; a 30-day session cookie (HttpOnly) and the same token in the body out. */
export const POST = route(
  async (req: NextRequest) => {
    const body = loginRequest.parse(await req.json());
    const result = await login(getAuthDb(), loginLimiter(), { ...body, ip: clientIp(req) });
    const res = NextResponse.json({ token: result.token, orgId: result.orgId, userId: result.userId, admin: result.admin, username: result.username });
    res.headers.append("Set-Cookie", sessionCookie(result.token));
    return res;
  },
  { public: true },
);

export const OPTIONS = preflight;

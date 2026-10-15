import { NextResponse, type NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { loginLimiter } from "@/auth/ratelimit";
import { clientIp, sessionCookie } from "@/auth/request";
import { login, loginBody, loginRequest } from "@/auth/service";
import { preflight, readJson, route } from "@/http/route";

export const runtime = "nodejs";

/** Username and password in; a 30-day session cookie (HttpOnly) and the same token in the body out. 403 when disabled. */
export const POST = route(
  async (req: NextRequest) => {
    const body = loginRequest.parse(await readJson(req));
    const result = await login(getAuthDb(), loginLimiter(), { ...body, ip: clientIp(req) });
    const res = NextResponse.json(loginBody(result));
    res.headers.append("Set-Cookie", sessionCookie(result.token));
    return res;
  },
  { public: true },
);

export const OPTIONS = preflight;

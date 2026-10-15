import { NextResponse, type NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { sessionCookie } from "@/auth/request";
import { loginBody } from "@/auth/service";
import { signup, signupRequest } from "@/auth/signup";
import { preflight, readJson, route } from "@/http/route";

export const runtime = "nodejs";

/** Only with ALLOW_SIGNUP=true: creates a new org and its first (admin) account, and signs in. */
export const POST = route(
  async (req: NextRequest) => {
    const result = await signup(getAuthDb(), signupRequest.parse(await readJson(req)));
    const res = NextResponse.json(loginBody(result));
    res.headers.append("Set-Cookie", sessionCookie(result.token));
    return res;
  },
  { public: true, limit: "account" },
);

export const OPTIONS = preflight;

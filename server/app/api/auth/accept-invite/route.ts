import { NextResponse, type NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { acceptInvite, acceptInviteRequest } from "@/auth/invites";
import { sessionCookie } from "@/auth/request";
import { loginBody } from "@/auth/service";
import { getEmbedder, getStore } from "@/http/deps";
import { preflight, readJson, route } from "@/http/route";
import { recomputeUserVectors } from "@/orgspace/personVectors";

export const runtime = "nodejs";

/** Public: spends an invite, creates the account and the person, and signs in (same body and cookie as login). */
export const POST = route(
  async (req: NextRequest) => {
    const body = acceptInviteRequest.parse(await readJson(req));
    const result = await acceptInvite(getAuthDb(), getStore, body);
    const store = getStore(result.orgId);
    await recomputeUserVectors(store, getEmbedder());
    const res = NextResponse.json(loginBody(result));
    res.headers.append("Set-Cookie", sessionCookie(result.token));
    return res;
  },
  { public: true, limit: "account" },
);

export const OPTIONS = preflight;

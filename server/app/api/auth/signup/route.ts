import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthDb } from "@/auth/db";
import { sessionCookie } from "@/auth/request";
import { createAccountIn, newAccountRequest } from "@/auth/service";
import { config } from "@/config";
import { slugify } from "@/lib/text";
import { createOrgStore, getEmbedder } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, route } from "@/http/route";
import { recomputeUserVectors } from "@/orgspace/personVectors";

export const runtime = "nodejs";

const ORG_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const signupRequest = newAccountRequest.omit({ admin: true }).extend({
  orgName: z.string().trim().min(1).max(80),
  orgId: z.string().regex(ORG_ID_RE, "orgId must be lowercase letters and dashes").optional(),
  orgDescription: z.string().trim().min(1).max(2_000).optional(),
});

/** Only with ALLOW_SIGNUP=true: creates a new org and its first (admin) account, and signs in. */
export const POST = route(
  async (req: NextRequest) => {
    if (!config.allowSignup) throw new HttpError(403, "sign up is closed. Ask an admin for an account.");
    const body = signupRequest.parse(await req.json());
    const db = getAuthDb();
    if (db.getAccount(body.username)) throw new HttpError(409, `username "${body.username.trim().toLowerCase()}" is taken`);
    const orgId = body.orgId ?? slugify(body.orgName).slice(0, 40);
    if (!ORG_ID_RE.test(orgId)) throw new HttpError(400, "orgName needs a letter or number, or pass an orgId");
    const store = createOrgStore({
      id: orgId,
      name: body.orgName,
      description: body.orgDescription ?? body.orgName,
      websites: [],
      context: "",
      createdAt: new Date().toISOString(),
    });
    const { account } = await createAccountIn(db, store, orgId, { ...body, admin: true });
    await recomputeUserVectors(store, getEmbedder());
    const { token } = db.issueToken(account.username, "session", "signup");
    const res = NextResponse.json({ token, orgId, userId: account.userId, admin: true, username: account.username });
    res.headers.append("Set-Cookie", sessionCookie(token));
    return res;
  },
  { public: true },
);

export const OPTIONS = preflight;

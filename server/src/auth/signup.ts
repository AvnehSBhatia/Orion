import { z } from "zod";
import { audit } from "@/audit/log";
import { config } from "@/config";
import { ORG_ID_RE } from "@/orgs/profile";
import { slugify } from "@/lib/text";
import { createOrgStore, getEmbedder } from "@/http/deps";
import { HttpError } from "@/http/error";
import { recomputeUserVectors } from "@/orgspace/personVectors";
import type { AuthDb } from "./db";
import { createAccountIn, newAccountRequest, type LoginResult } from "./service";

export const signupRequest = newAccountRequest.omit({ admin: true }).extend({
  orgName: z.string().trim().min(1).max(80),
  orgId: z.string().regex(ORG_ID_RE, "orgId must be lowercase letters and dashes").optional(),
  orgDescription: z.string().trim().min(1).max(2_000).optional(),
});

/** Only with ALLOW_SIGNUP=true: creates a new org and its first (admin) account, and signs in. */
export async function signup(db: AuthDb, body: z.infer<typeof signupRequest>): Promise<LoginResult> {
  if (!config.allowSignup) throw new HttpError(403, "sign up is closed. Ask an admin for an account.");
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
  audit(db, { orgId, actor: account.username, action: "account_created", target: account.username, detail: "signup" });
  return { token, orgId, userId: account.userId, admin: true, username: account.username };
}

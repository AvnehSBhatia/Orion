import type { NextRequest } from "next/server";
import { audit } from "@/audit/log";
import { listAccountViews, toAccountView } from "@/auth/accounts";
import { getAuthDb } from "@/auth/db";
import { createAccountIn, newAccountRequest } from "@/auth/service";
import { getEmbedder, getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, readJson, requirePrincipal, route } from "@/http/route";
import { recomputeUserVectors } from "@/orgspace/personVectors";

export const runtime = "nodejs";

function adminCaller(req: NextRequest) {
  const p = requirePrincipal(req);
  if (!p.admin) throw new HttpError(403, "only an org admin can manage accounts");
  return p;
}

/** Every account in the admin's org. */
export const GET = route(
  async (req: NextRequest) => {
    const p = adminCaller(req);
    return { accounts: listAccountViews(getAuthDb(), getStore(p.orgId), p.orgId) };
  },
  { public: true },
);

/** An org admin adds an account to their org; the person is added to the org if missing. */
export const POST = route(
  async (req: NextRequest) => {
    const p = adminCaller(req);
    const body = newAccountRequest.parse(await readJson(req));
    const store = getStore(p.orgId);
    const db = getAuthDb();
    const { account, created } = await createAccountIn(db, store, p.orgId, body);
    if (created) await recomputeUserVectors(store, getEmbedder());
    audit(db, { orgId: p.orgId, actor: p.username, action: "account_created", target: account.username, detail: { admin: account.admin } });
    return { account: toAccountView(account, store) };
  },
  { public: true },
);

export const OPTIONS = preflight;

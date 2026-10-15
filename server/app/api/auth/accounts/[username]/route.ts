import type { NextRequest } from "next/server";
import { toAccountView, updateAccountAs, updateAccountRequest } from "@/auth/accounts";
import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, readJson, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

/** An admin promotes, demotes, disables, re-enables, or sets the email of an account in their org. */
export const PATCH = route(
  async (req: NextRequest, ctx: RouteContext<"/api/auth/accounts/[username]">) => {
    const p = requirePrincipal(req);
    if (!p.admin) throw new HttpError(403, "only an org admin can manage accounts");
    const { username } = await ctx.params;
    const patch = updateAccountRequest.parse(await readJson(req));
    const account = updateAccountAs(getAuthDb(), p, username, patch);
    return { account: toAccountView(account, getStore(p.orgId)) };
  },
  { public: true },
);

export const OPTIONS = preflight;

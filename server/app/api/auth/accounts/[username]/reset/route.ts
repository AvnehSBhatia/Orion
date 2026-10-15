import type { NextRequest } from "next/server";
import { issueResetLink } from "@/auth/accounts";
import { getAuthDb } from "@/auth/db";
import { HttpError } from "@/http/error";
import { preflight, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

/** An admin makes a one-time password reset link (24h) for an account in their org, to share with the person. */
export const POST = route(
  async (req: NextRequest, ctx: RouteContext<"/api/auth/accounts/[username]/reset">) => {
    const p = requirePrincipal(req);
    if (!p.admin) throw new HttpError(403, "only an org admin can reset passwords");
    const { username } = await ctx.params;
    return issueResetLink(getAuthDb(), p, username);
  },
  { public: true },
);

export const OPTIONS = preflight;

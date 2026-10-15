import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { inviteInfo, revokeInviteAs } from "@/auth/invites";
import { getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

// One dynamic segment serves both calls (Next allows one name per level): GET takes the invite's secret token,
// DELETE takes its id.

/** Public: what the invite page shows (the org name and expiry). 404 when unknown, used, or expired. */
export const GET = route(
  async (_req: NextRequest, ctx: RouteContext<"/api/auth/invites/[key]">) => {
    const { key } = await ctx.params;
    return inviteInfo(getAuthDb(), key, (orgId) => {
      try {
        return getStore(orgId).getOrg()?.name ?? orgId;
      } catch {
        return orgId;
      }
    });
  },
  { public: true, limit: "account" },
);

/** An admin cancels an invite of their org. */
export const DELETE = route(
  async (req: NextRequest, ctx: RouteContext<"/api/auth/invites/[key]">) => {
    const p = requirePrincipal(req);
    if (!p.admin) throw new HttpError(403, "only an org admin can manage invites");
    const { key } = await ctx.params;
    revokeInviteAs(getAuthDb(), p, key);
    return new Response(null, { status: 204 });
  },
  { public: true },
);

export const OPTIONS = preflight;

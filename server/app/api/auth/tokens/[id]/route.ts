import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { revokeTokenAs } from "@/auth/tokens";
import { preflight, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

/** Revoke one of your tokens. An admin may revoke any token of an account in their org. */
export const DELETE = route(
  async (req: NextRequest, ctx: RouteContext<"/api/auth/tokens/[id]">) => {
    const p = requirePrincipal(req);
    revokeTokenAs(getAuthDb(), p, (await ctx.params).id);
    return { ok: true };
  },
  { public: true },
);

export const OPTIONS = preflight;

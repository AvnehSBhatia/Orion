import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { orgQuery } from "@/contract/schemas";
import { getStore } from "@/http/deps";
import { adminOnly, preflight, principalOf, route, scopedQuery } from "@/http/route";
import { deletePerson } from "@/orgs/deletion";

export const runtime = "nodejs";

/** An admin removes a person: their captures, the person, and their accounts. Graph nodes stay. */
export const DELETE = route(async (req: NextRequest, ctx: RouteContext<"/api/users/[userId]">) => {
  adminOnly(req);
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const { userId } = await ctx.params;
  return deletePerson(getAuthDb(), getStore(orgId), principalOf(req), orgId, userId);
});

export const OPTIONS = preflight;

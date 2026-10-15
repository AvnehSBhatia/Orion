import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { acceptRule } from "@/mac/clients";
import { assertOwner, pathId, v1Route } from "@/mac/http";

export const runtime = "nodejs";

export const POST = v1Route(async (_req, ctx: { params: Promise<{ id: string }> }, p) => {
  assertOwner(p);
  return acceptRule(getAuthDb(), getStore(p.orgId), p, pathId((await ctx.params).id));
});

export const OPTIONS = preflight;

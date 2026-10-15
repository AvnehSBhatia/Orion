import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight, readJson } from "@/http/route";
import { clientPatch, updateClient } from "@/mac/clients";
import { assertOwner, pathId, v1Route } from "@/mac/http";

export const runtime = "nodejs";

export const PATCH = v1Route(async (req, ctx: { params: Promise<{ id: string }> }, p) => {
  assertOwner(p);
  const id = pathId((await ctx.params).id);
  return updateClient(getAuthDb(), getStore(p.orgId), p, id, clientPatch.parse(await readJson(req)));
});

export const OPTIONS = preflight;

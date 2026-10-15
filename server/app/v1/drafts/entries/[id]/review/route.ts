import { getStore } from "@/http/deps";
import { preflight, readJson } from "@/http/route";
import { reviewEntry, reviewRequest } from "@/mac/drafts";
import { pathId, v1Route } from "@/mac/http";

export const runtime = "nodejs";

export const POST = v1Route(async (req, ctx: { params: Promise<{ id: string }> }, p) => {
  const { id } = await ctx.params;
  const body = reviewRequest.parse(await readJson(req));
  return { entry: reviewEntry(getStore(p.orgId), p.userId, pathId(id), body) };
});

export const OPTIONS = preflight;

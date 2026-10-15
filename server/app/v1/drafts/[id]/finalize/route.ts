import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { finalizeDraft } from "@/mac/drafts";
import { pathId, v1Route } from "@/mac/http";

export const runtime = "nodejs";

export const POST = v1Route(async (_req, ctx: { params: Promise<{ id: string }> }, p) => {
  const { id } = await ctx.params;
  return finalizeDraft(getStore(p.orgId), p.userId, pathId(id));
});

export const OPTIONS = preflight;

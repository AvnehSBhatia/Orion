import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { csvResponse } from "@/mac/csv";
import { exportDraft } from "@/mac/drafts";
import { pathId, v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** The finalized day as CSV (date,client,minutes,narrative,status); 409 before finalize. */
export const GET = v1Route(async (_req, ctx: { params: Promise<{ id: string }> }, p) => {
  const { id } = await ctx.params;
  return csvResponse(exportDraft(getStore(p.orgId), p.userId, pathId(id)), "timesheet.csv");
});

export const OPTIONS = preflight;

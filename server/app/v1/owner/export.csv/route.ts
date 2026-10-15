import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { csvResponse } from "@/mac/csv";
import { dayRange, ownerExport } from "@/mac/drafts";
import { assertOwner, v1Route } from "@/mac/http";

export const runtime = "nodejs";

/** Admin: accepted and edited entries for everyone (date,person,client,minutes,narrative,status). */
export const GET = v1Route(async (req, _ctx, p) => {
  assertOwner(p);
  const q = req.nextUrl.searchParams;
  const { from, to } = dayRange(q.get("from"), q.get("to"), 30);
  return csvResponse(ownerExport(getStore(p.orgId), from, to), "orion-timesheets.csv");
});

export const OPTIONS = preflight;

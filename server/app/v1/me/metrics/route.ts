import { getStore } from "@/http/deps";
import { preflight } from "@/http/route";
import { dayRange } from "@/mac/drafts";
import { v1Route } from "@/mac/http";
import { metricsFor } from "@/mac/metrics";

export const runtime = "nodejs";

export const GET = v1Route(async (req, _ctx, p) => {
  const q = req.nextUrl.searchParams;
  const { from, to } = dayRange(q.get("from"), q.get("to"));
  return metricsFor(getStore(p.orgId), p.userId, from, to);
});

export const OPTIONS = preflight;

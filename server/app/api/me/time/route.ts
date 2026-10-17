import type { NextRequest } from "next/server";
import { getStore } from "@/http/deps";
import { preflight, requirePrincipal, route } from "@/http/route";
import { myTimesheet } from "@/mac/timesheet";

export const runtime = "nodejs";

/** The caller's own time entries. A userId in the query is ignored. */
export const GET = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    const url = new URL(req.url);
    return myTimesheet(getStore(p.orgId), p.userId, url.searchParams.get("from"), url.searchParams.get("to"));
  },
  { public: true },
);

export const OPTIONS = preflight;

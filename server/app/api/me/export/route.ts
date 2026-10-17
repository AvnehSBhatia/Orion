import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight, requirePrincipal, route } from "@/http/route";
import { exportPerson, exportResponse } from "@/orgs/export";

export const runtime = "nodejs";

/** Everything Orion holds about the caller, as one JSON download. Screenshots are listed by id, not included. */
export const GET = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    return exportResponse(exportPerson(getAuthDb(), getStore(p.orgId), p, p.orgId, p.userId));
  },
  { public: true },
);

export const OPTIONS = preflight;

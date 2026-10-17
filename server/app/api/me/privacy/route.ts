import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { getStore } from "@/http/deps";
import { preflight, requirePrincipal, route } from "@/http/route";
import { privacySummary } from "@/orgs/privacy";

export const runtime = "nodejs";

/**
 * What Orion holds and shares about the caller: items sent in the last 7 days by app (counts only), the org's
 * retention settings, and recent audit events where someone else acted on them. Always the caller's own.
 */
export const GET = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    return privacySummary(getAuthDb(), getStore(p.orgId), p);
  },
  { public: true },
);

export const OPTIONS = preflight;

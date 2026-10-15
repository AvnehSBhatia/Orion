import type { NextRequest } from "next/server";
import { captureRequest } from "@/contract/schemas";
import { ingestCapture } from "@/ingest/pipeline";
import { getIngestDeps, requireUser } from "@/http/deps";
import { MB } from "@/http/body";
import { preflight, principalOf, route, scopedBody } from "@/http/route";
import { captureGate } from "@/orgs/policy";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One captured tab, window, or screen. 403 while the org has capture paused or the caller has not accepted the
 * monitoring notice; `{ skipped: "excluded" }` (nothing stored) for a host on the org's exclusion list.
 */
export const POST = route(
  async (req: NextRequest) => {
    const body = captureRequest.parse(await scopedBody(req, { user: true }));
    const deps = getIngestDeps(body.orgId);
    requireUser(deps.store, body.userId);
    if (captureGate(deps.store, principalOf(req), body.url) === "excluded") return { skipped: "excluded" as const };
    return ingestCapture(deps, body);
  },
  { limit: "ingest", maxBody: 4 * MB },
);

export const OPTIONS = preflight;

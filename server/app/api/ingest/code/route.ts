import type { NextRequest } from "next/server";
import { MAX_DIFF_CHARS, codeIngestRequest } from "@/contract/schemas";
import { ingestCode } from "@/ingest/pipeline";
import { getIngestDeps } from "@/http/deps";
import { MB } from "@/http/body";
import { actingAs, preflight, principalOf, route, scopedBody } from "@/http/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * A commit (diffs and/or feature cards). A member's commit is always theirs: `userId` must be the caller, and git
 * author attribution is ignored. Admins (and CI tokens an admin created) may name anyone or attribute by author.
 */
export const POST = route(
  async (req: NextRequest) => {
    const body = codeIngestRequest.parse(await scopedBody(req));
    const p = principalOf(req);
    if (body.userId) actingAs(req, body.userId);
    const input = p && !p.admin ? { ...body, userId: p.userId, author: undefined } : body;
    return ingestCode(getIngestDeps(body.orgId), input, MAX_DIFF_CHARS);
  },
  { limit: "ingest", maxBody: 1 * MB },
);

export const OPTIONS = preflight;

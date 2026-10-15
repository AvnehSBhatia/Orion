import { getIngestDeps } from "@/http/deps";
import { MB } from "@/http/body";
import { preflight, readJson } from "@/http/route";
import { v1Route } from "@/mac/http";
import { assertMayCapture } from "@/mac/policy";
import { submitWorkBlocks, workBlocksRequest } from "@/mac/workBlocks";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Approved Mac work, up to 500 blocks; each block is accepted, a duplicate, or rejected on its own. */
export const POST = v1Route(
  async (req, _ctx, p) => {
    const body = workBlocksRequest.parse(await readJson(req));
    const deps = getIngestDeps(p.orgId);
    assertMayCapture(deps.store, p);
    return submitWorkBlocks(deps, p.userId, body.blocks);
  },
  { limit: "ingest", maxBody: 8 * MB },
);

export const OPTIONS = preflight;

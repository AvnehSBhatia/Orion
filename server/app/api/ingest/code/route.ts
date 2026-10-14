import type { NextRequest } from "next/server";
import { MAX_DIFF_CHARS, codeIngestRequest } from "@/contract/schemas";
import { ingestCode } from "@/ingest/pipeline";
import { getIngestDeps } from "@/http/deps";
import { preflight, route, scopedBody } from "@/http/route";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route(async (req: NextRequest) => {
  const body = codeIngestRequest.parse(await scopedBody(req));
  return ingestCode(getIngestDeps(body.orgId), body, MAX_DIFF_CHARS);
});

export const OPTIONS = preflight;

import type { NextRequest } from "next/server";
import { MAX_DIFF_CHARS, codeIngestRequest } from "@/contract/schemas";
import { ingestCode } from "@/ingest/pipeline";
import { getIngestDeps } from "@/server/deps";
import { preflight, route } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route(async (req: NextRequest) => {
  const body = codeIngestRequest.parse(await req.json());
  return ingestCode(getIngestDeps(body.orgId), body, MAX_DIFF_CHARS);
});

export const OPTIONS = preflight;

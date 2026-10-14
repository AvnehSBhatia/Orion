import type { NextRequest } from "next/server";
import { captureRequest } from "@/contract/schemas";
import { ingestCapture } from "@/ingest/pipeline";
import { getIngestDeps, requireUser } from "@/server/deps";
import { actingAs, preflight, route, scopedBody } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route(async (req: NextRequest) => {
  const body = captureRequest.parse(await scopedBody(req, { user: true }));
  actingAs(req, body.userId);
  const deps = getIngestDeps(body.orgId);
  requireUser(deps.store, body.userId);
  return ingestCapture(deps, body);
});

export const OPTIONS = preflight;

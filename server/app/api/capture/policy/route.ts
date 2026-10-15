import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import { getStore } from "@/http/deps";
import { preflight, principalOf, route, scopedQuery } from "@/http/route";
import { capturePolicy, type CapturePolicy } from "@/orgs/policy";

export const runtime = "nodejs";

/** What the extension follows: whether capture is on, excluded hosts, the interval, and whether consent is needed. */
export const GET = route(async (req: NextRequest): Promise<CapturePolicy> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  return capturePolicy(getStore(orgId), principalOf(req));
});

export const OPTIONS = preflight;

import type { NextRequest } from "next/server";
import { activityQuery } from "@/contract/schemas";
import type { ActivityResponse } from "@/contract/types";
import { getStore } from "@/http/deps";
import { preflight, principalOf, route, scopedQuery } from "@/http/route";
import { maskImages, maskMacSources, viewerOf } from "@/orgs/visibility";
import { activity } from "@/retrieval/activity";

export const runtime = "nodejs";

/** What people are capturing and committing right now. Cheap enough to poll every couple of seconds. */
export const GET = route(async (req: NextRequest): Promise<ActivityResponse> => {
  const { orgId, limit } = activityQuery.parse(scopedQuery(req));
  const store = getStore(orgId);
  const out = activity(store, limit);
  return { ...out, sources: maskImages(principalOf(req), store, maskMacSources(viewerOf(principalOf(req)), store, out.sources)) };
});

export const OPTIONS = preflight;

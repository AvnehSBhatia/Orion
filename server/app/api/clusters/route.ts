import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import type { ClustersResponse } from "@/contract/types";
import { getStore } from "@/http/deps";
import { preflight, route, scopedQuery } from "@/http/route";
import { publicClusters } from "@/retrieval/context";

export const runtime = "nodejs";

export const GET = route(async (req: NextRequest): Promise<ClustersResponse> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  return { clusters: publicClusters(getStore(orgId)) };
});

export const OPTIONS = preflight;

import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import type { ClustersResponse } from "@/contract/types";
import { getStore } from "@/server/deps";
import { preflight, route } from "@/server/http";
import { publicClusters } from "@/steer/context";

export const runtime = "nodejs";

export const GET = route(async (req: NextRequest): Promise<ClustersResponse> => {
  const { orgId } = orgQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return { clusters: publicClusters(getStore(orgId)) };
});

export const OPTIONS = preflight;

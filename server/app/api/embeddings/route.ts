import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import type { EmbeddingsResponse } from "@/contract/types";
import { projectEmbeddings } from "@/graph/projection";
import { getStore } from "@/server/deps";
import { preflight, route, scopedQuery } from "@/server/http";

export const runtime = "nodejs";

/** Nodes and documents as a 3D point cloud (PCA of their embeddings). Recomputed only when the data changes. */
export const GET = route(async (req: NextRequest): Promise<EmbeddingsResponse> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  return projectEmbeddings(getStore(orgId), orgId);
});

export const OPTIONS = preflight;

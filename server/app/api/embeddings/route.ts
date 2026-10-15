import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import type { EmbeddingsResponse } from "@/contract/types";
import { projectEmbeddings } from "@/graph/projection";
import { getStore } from "@/http/deps";
import { hiddenSourceIds, viewerOf } from "@/orgs/visibility";
import { preflight, principalOf, route, scopedQuery } from "@/http/route";

export const runtime = "nodejs";

/** Nodes and documents as a 3D point cloud (PCA of their embeddings). Recomputed only when the data changes. */
export const GET = route(async (req: NextRequest): Promise<EmbeddingsResponse> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const store = getStore(orgId);
  const out = projectEmbeddings(store, orgId);
  const hidden = hiddenSourceIds(store, viewerOf(principalOf(req)));
  if (!hidden.size) return out;
  // Another person's Mac window title is private; the point itself (position, cluster) stays.
  return { ...out, points: out.points.map((p) => (hidden.has(p.id) ? { ...p, label: "Mac activity" } : p)) };
});

export const OPTIONS = preflight;

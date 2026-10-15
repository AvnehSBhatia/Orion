import type { NextRequest } from "next/server";
import { feedQuery } from "@/contract/schemas";
import type { FeedResponse } from "@/contract/types";
import { getEmbedder, getStore, requireUser } from "@/http/deps";
import { preflight, principalOf, route, scopedQuery } from "@/http/route";
import { maskImages, viewerOf } from "@/orgs/visibility";
import { feedFor } from "@/retrieval/feed";

export const runtime = "nodejs";

/** What moved for a person lately. Another person's feed takes an admin. */
export const GET = route(async (req: NextRequest): Promise<FeedResponse> => {
  const q = feedQuery.parse(scopedQuery(req, { user: true }));
  const store = getStore(q.orgId);
  requireUser(store, q.userId);
  const items = await feedFor(store, getEmbedder(), { userId: q.userId, sinceHours: q.sinceHours, limit: q.limit, viewer: viewerOf(principalOf(req)) });
  return { items: maskImages(principalOf(req), store, items) };
});

export const OPTIONS = preflight;

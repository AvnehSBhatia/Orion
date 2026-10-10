import type { NextRequest } from "next/server";
import { feedQuery } from "@/contract/schemas";
import type { FeedResponse } from "@/contract/types";
import { getEmbedder, getStore, requireUser } from "@/server/deps";
import { preflight, route } from "@/server/http";
import { feedFor } from "@/steer/feed";

export const runtime = "nodejs";

export const GET = route(async (req: NextRequest): Promise<FeedResponse> => {
  const q = feedQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const store = getStore(q.orgId);
  requireUser(store, q.userId);
  return { items: await feedFor(store, getEmbedder(), { userId: q.userId, sinceHours: q.sinceHours, limit: q.limit }) };
});

export const OPTIONS = preflight;

import type { NextRequest } from "next/server";
import { briefQuery } from "@/contract/schemas";
import type { BriefResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { getEmbedder, getLlm, getStore, requireUser } from "@/http/deps";
import { preflight, route, scopedQuery } from "@/http/route";
import { briefFor, cachedBrief, hasModelKey } from "@/retrieval/brief";

export const runtime = "nodejs";

/** A one or two sentence personal briefing of what moved for this person in the last 2 hours, cached 60s. */
export const GET = route(async (req: NextRequest): Promise<BriefResponse> => {
  const q = briefQuery.parse(scopedQuery(req, { user: true }));
  const store = getStore(q.orgId);
  const user = toPublicUser(requireUser(store, q.userId));
  return cachedBrief(`${q.orgId}:${user.id}`, () => briefFor(store, getEmbedder(), user, { llm: hasModelKey() ? getLlm() : null }));
});

export const OPTIONS = preflight;

import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import type { SourceResponse } from "@/contract/types";
import { getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, principalOf, route, scopedQuery } from "@/http/route";
import { isHidden, maskImages, viewerOf } from "@/orgs/visibility";

export const runtime = "nodejs";

/** A document's full text (org-wide, except Mac work blocks: author and admins only). `hasImage` is false when the caller may not open its screenshot. */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/sources/[id]">): Promise<SourceResponse> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const { id } = await ctx.params;
  const store = getStore(orgId);
  const found = store.readDocument(id);
  if (!found) throw new HttpError(404, `unknown source "${id}"`);
  if (isHidden(store, viewerOf(principalOf(req)), id)) throw new HttpError(403, "only the author and admins can read Mac activity text");
  return { ...found, source: maskImages(principalOf(req), store, [found.source])[0] };
});

export const OPTIONS = preflight;

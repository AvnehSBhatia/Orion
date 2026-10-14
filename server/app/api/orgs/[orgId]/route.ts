import type { NextRequest } from "next/server";
import { orgId as orgIdSchema, updateOrgRequest } from "@/contract/schemas";
import type { OrgResponse } from "@/contract/types";
import { toPublicUser, type Store } from "@/db/store";
import { getStore } from "@/server/deps";
import { HttpError, adminOnly, preflight, route, sameOrg } from "@/server/http";

export const runtime = "nodejs";

function orgOf(store: Store, id: string) {
  const org = store.getOrg();
  if (!org) throw new HttpError(404, `org "${id}" has no profile yet. PATCH it with a name and description.`);
  return org;
}

export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]">): Promise<OrgResponse> => {
  const id = orgIdSchema.parse((await ctx.params).orgId);
  sameOrg(req, id);
  const store = getStore(id);
  return { org: orgOf(store, id), users: store.listUsers().map(toPublicUser) };
});

/** Change the profile. The model reads it on the next capture; existing documents are not re-read. */
export const PATCH = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]">): Promise<OrgResponse> => {
  const id = orgIdSchema.parse((await ctx.params).orgId);
  sameOrg(req, id);
  adminOnly(req);
  const store = getStore(id);
  const patch = updateOrgRequest.parse(await req.json());
  const current = store.getOrg();
  if (!current && (!patch.name || !patch.description)) throw new HttpError(400, "this org has no profile yet; send name and description");
  store.saveOrg({
    id,
    name: patch.name ?? current!.name,
    description: patch.description ?? current!.description,
    websites: patch.websites ?? current?.websites ?? [],
    context: patch.context ?? current?.context ?? "",
    createdAt: current?.createdAt ?? new Date().toISOString(),
  });
  return { org: store.getOrg()!, users: store.listUsers().map(toPublicUser) };
});

export const OPTIONS = preflight;

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthDb } from "@/auth/db";
import { orgId as orgIdSchema, updateOrgRequest } from "@/contract/schemas";
import type { OrgResponse } from "@/contract/types";
import { getStore } from "@/http/deps";
import { adminOnly, preflight, principalOf, readJson, route, sameOrg } from "@/http/route";
import { deleteOrg } from "@/orgs/deletion";
import { orgResponse, updateOrgProfile } from "@/orgs/profile";

export const runtime = "nodejs";

const orgParam = async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]">) => {
  const id = orgIdSchema.parse((await ctx.params).orgId);
  sameOrg(req, id);
  return id;
};

export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]">): Promise<OrgResponse> => {
  const id = await orgParam(req, ctx);
  return orgResponse(getStore(id), id);
});

/** Change the profile (admin). The model reads it on the next capture; existing documents are not re-read. */
export const PATCH = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]">): Promise<OrgResponse> => {
  const id = await orgParam(req, ctx);
  adminOnly(req);
  return updateOrgProfile(getStore(id), id, updateOrgRequest.parse(await readJson(req)));
});

const deleteOrgRequest = z.object({ confirm: z.string() });

/** Delete the org (admin): its data file and every account in it. The body must repeat the id: `{ confirm: "<orgId>" }`. */
export const DELETE = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]">) => {
  const id = await orgParam(req, ctx);
  adminOnly(req);
  const { confirm } = deleteOrgRequest.parse(await readJson(req, {}));
  deleteOrg(getAuthDb(), principalOf(req), id, confirm);
  return new Response(null, { status: 204 });
});

export const OPTIONS = preflight;

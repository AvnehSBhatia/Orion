import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { orgId as orgIdSchema } from "@/contract/schemas";
import { getStore } from "@/http/deps";
import { adminOnly, preflight, principalOf, readJson, route, sameOrg } from "@/http/route";
import { updateSettingsAs } from "@/orgs/policy";
import { getOrgSettings, orgSettingsPatch, type OrgSettings } from "@/orgs/settings";

export const runtime = "nodejs";

const orgParam = async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]/settings">) => {
  const id = orgIdSchema.parse((await ctx.params).orgId);
  sameOrg(req, id);
  return id;
};

/** The org's capture, retention, visibility, budget, and consent settings. Members may read them. */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]/settings">): Promise<{ settings: OrgSettings }> => {
  const id = await orgParam(req, ctx);
  return { settings: getOrgSettings(getStore(id)) };
});

/** An admin changes some settings; the rest keep their values. */
export const PATCH = route(async (req: NextRequest, ctx: RouteContext<"/api/orgs/[orgId]/settings">): Promise<{ settings: OrgSettings }> => {
  const id = await orgParam(req, ctx);
  adminOnly(req);
  const patch = orgSettingsPatch.parse(await readJson(req));
  return { settings: updateSettingsAs(getAuthDb(), getStore(id), principalOf(req), id, patch) };
});

export const OPTIONS = preflight;

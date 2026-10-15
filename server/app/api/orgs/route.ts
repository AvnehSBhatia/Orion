import type { NextRequest } from "next/server";
import { createOrgRequest } from "@/contract/schemas";
import type { OrgResponse, OrgsResponse } from "@/contract/types";
import { listOrgs } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, principalOf, readJson, route } from "@/http/route";
import { createOrg } from "@/orgs/profile";

export const runtime = "nodejs";

/** Signed in, only the caller's org. */
export const GET = route(async (req: NextRequest): Promise<OrgsResponse> => ({ orgs: listOrgs(principalOf(req)?.orgId) }));

/** Create an org with its profile and, optionally, its first members. Only with AUTH_DISABLED=true (local demos). */
export const POST = route(async (req: NextRequest): Promise<OrgResponse> => {
  // An org made here would have no account that can reach it.
  if (principalOf(req)) throw new HttpError(403, "create orgs with POST /api/auth/signup or scripts/account.ts");
  return createOrg(createOrgRequest.parse(await readJson(req)));
});

export const OPTIONS = preflight;

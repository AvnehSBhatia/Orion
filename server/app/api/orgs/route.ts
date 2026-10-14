import type { NextRequest } from "next/server";
import { createOrgRequest } from "@/contract/schemas";
import type { OrgResponse, OrgsResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { slugify } from "@/lib/text";
import { createOrgStore, getEmbedder, listOrgs } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, principalOf, route } from "@/http/route";
import { recomputeUserVectors } from "@/orgspace/personVectors";

export const runtime = "nodejs";

/** Signed in, only the caller's org. */
export const GET = route(async (req: NextRequest): Promise<OrgsResponse> => ({ orgs: listOrgs(principalOf(req)?.orgId) }));

/** Create an org with its profile (what it does, the websites it works on) and, optionally, its first members. */
export const POST = route(async (req: NextRequest): Promise<OrgResponse> => {
  // An org made here would have no account that can reach it.
  if (principalOf(req)) throw new HttpError(403, "create orgs with POST /api/auth/signup or scripts/account.ts");
  const { members, id, ...profile } = createOrgRequest.parse(await req.json());
  const orgId = id ?? slugify(profile.name).slice(0, 40);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(orgId)) throw new HttpError(400, "name needs letters or digits, or pass an id");
  const store = createOrgStore({ id: orgId, ...profile, createdAt: new Date().toISOString() });
  for (const m of members) store.saveUser({ id: slugify(m.name), name: m.name, role: m.role, teamDescription: "" });
  if (members.length) await recomputeUserVectors(store, getEmbedder());
  return { org: store.getOrg()!, users: store.listUsers().map(toPublicUser) };
});

export const OPTIONS = preflight;

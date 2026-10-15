import type { NextRequest } from "next/server";
import { orgQuery, upsertUserRequest } from "@/contract/schemas";
import type { UpsertUserResponse, UsersResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { slugify } from "@/lib/text";
import { getEmbedder, getStore } from "@/http/deps";
import { actingAs, preflight, route, scopedBody, scopedQuery } from "@/http/route";
import { upsertPerson } from "@/orgs/people";

export const runtime = "nodejs";

export const GET = route(async (req: NextRequest): Promise<UsersResponse> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  return { users: getStore(orgId).listUsers().map(toPublicUser) };
});

/** Create or update a person (yourself, or anyone as an admin). Their free-text role re-anchors their gravity right away. */
export const POST = route(async (req: NextRequest): Promise<UpsertUserResponse> => {
  const body = upsertUserRequest.parse(await scopedBody(req));
  const id = body.id ?? slugify(body.name);
  actingAs(req, id);
  const user = await upsertPerson(getStore(body.orgId), getEmbedder(), { id, name: body.name, role: body.role, teamDescription: body.teamDescription });
  return { user: toPublicUser(user) };
});

export const OPTIONS = preflight;

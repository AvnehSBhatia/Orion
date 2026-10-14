import type { NextRequest } from "next/server";
import { orgQuery, upsertUserRequest } from "@/contract/schemas";
import type { UpsertUserResponse, UsersResponse } from "@/contract/types";
import { toPublicUser } from "@/db/store";
import { slugify } from "@/lib/text";
import { getEmbedder, getStore } from "@/server/deps";
import { actingAs, preflight, route, scopedBody, scopedQuery } from "@/server/http";
import { recomputeUserVectors } from "@/steer/users";

export const runtime = "nodejs";

export const GET = route(async (req: NextRequest): Promise<UsersResponse> => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  return { users: getStore(orgId).listUsers().map(toPublicUser) };
});

/** Create or update a person. Their free-text role re-anchors their gravity right away. */
export const POST = route(async (req: NextRequest): Promise<UpsertUserResponse> => {
  const body = upsertUserRequest.parse(await scopedBody(req));
  const store = getStore(body.orgId);
  const id = body.id ?? slugify(body.name);
  actingAs(req, id);
  // A new role means a new default dashboard; one they shaped by asking Orion stays.
  const before = store.getUser(id);
  if (before && before.role !== body.role && store.getDashboard(id)?.origin === "role") store.deleteDashboard(id);
  store.saveUser({ id, name: body.name, role: body.role, teamDescription: body.teamDescription });
  await recomputeUserVectors(store, getEmbedder());
  return { user: toPublicUser(store.getUser(id)!) };
});

export const OPTIONS = preflight;

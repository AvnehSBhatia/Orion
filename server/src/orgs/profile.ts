import type { z } from "zod";
import type { createOrgRequest, updateOrgRequest } from "@/contract/schemas";
import type { OrgResponse } from "@/contract/types";
import { toPublicUser, type Store } from "@/db/store";
import { createOrgStore, getEmbedder } from "@/http/deps";
import { HttpError } from "@/http/error";
import { slugify } from "@/lib/text";
import { recomputeUserVectors } from "@/orgspace/personVectors";

export const ORG_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function orgResponse(store: Store, id: string): OrgResponse {
  const org = store.getOrg();
  if (!org) throw new HttpError(404, `org "${id}" has no profile yet. PATCH it with a name and description.`);
  return { org, users: store.listUsers().map(toPublicUser) };
}

/** Changes the profile. The model reads it on the next capture; existing documents are not re-read. */
export function updateOrgProfile(store: Store, id: string, patch: z.infer<typeof updateOrgRequest>): OrgResponse {
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
  return orgResponse(store, id);
}

/** Creates an org with its profile and, optionally, its first members (auth-disabled demos only). */
export async function createOrg(body: z.infer<typeof createOrgRequest>): Promise<OrgResponse> {
  const { members, id, ...profile } = body;
  const orgId = id ?? slugify(profile.name).slice(0, 40);
  if (!ORG_ID_RE.test(orgId)) throw new HttpError(400, "name needs letters or digits, or pass an id");
  const store = createOrgStore({ id: orgId, ...profile, createdAt: new Date().toISOString() });
  for (const m of members) store.saveUser({ id: slugify(m.name), name: m.name, role: m.role, teamDescription: "" });
  if (members.length) await recomputeUserVectors(store, getEmbedder());
  return orgResponse(store, orgId);
}

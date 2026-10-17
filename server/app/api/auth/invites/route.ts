import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { createInviteAs, createInviteRequest, listInviteViews } from "@/auth/invites";
import { getStore } from "@/http/deps";
import { HttpError } from "@/http/error";
import { preflight, readJson, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

function adminCaller(req: NextRequest) {
  const p = requirePrincipal(req);
  if (!p.admin) throw new HttpError(403, "only an org admin can manage invites");
  return p;
}

/** The admin's org invites, used and pending. */
export const GET = route(
  async (req: NextRequest) => {
    const p = adminCaller(req);
    return { invites: listInviteViews(getAuthDb(), p.orgId) };
  },
  { public: true },
);

/** A one-use invite link (7 days). `admin: true` makes the new account an admin. The admin copies the link. */
export const POST = route(
  async (req: NextRequest) => {
    const p = adminCaller(req);
    const body = createInviteRequest.parse(await readJson(req, {}));
    const store = getStore(p.orgId);
    const names = { orgName: store.getOrg()?.name ?? p.orgId, inviterName: store.getUser(p.userId)?.name ?? p.username };
    return createInviteAs(getAuthDb(), p, body, names);
  },
  { public: true },
);

export const OPTIONS = preflight;

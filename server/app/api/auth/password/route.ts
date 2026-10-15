import type { NextRequest } from "next/server";
import { changePassword, changePasswordRequest } from "@/auth/accounts";
import { getAuthDb } from "@/auth/db";
import { preflight, readJson, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

/** The caller changes their password (`current` must match). Their other sessions are signed out. */
export const POST = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    await changePassword(getAuthDb(), p, changePasswordRequest.parse(await readJson(req)));
    return new Response(null, { status: 204 });
  },
  { public: true },
);

export const OPTIONS = preflight;

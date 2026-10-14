import type { NextRequest } from "next/server";
import { authenticate } from "@/auth/request";
import { config } from "@/config";
import { HttpError, preflight, route } from "@/server/http";

export const runtime = "nodejs";

/** Who is signed in. 401 when nobody is; `authDisabled: true` when the server runs with AUTH_DISABLED=true. */
export const GET = route(
  async (req: NextRequest) => {
    const p = authenticate(req);
    if (p) return { username: p.username, orgId: p.orgId, userId: p.userId, admin: p.admin, kind: p.kind, authDisabled: config.authDisabled };
    if (config.authDisabled) return { authDisabled: true };
    throw new HttpError(401, "sign in required");
  },
  { public: true },
);

export const OPTIONS = preflight;

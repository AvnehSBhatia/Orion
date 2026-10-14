import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthDb } from "@/auth/db";
import { preflight, requirePrincipal, route } from "@/server/http";

export const runtime = "nodejs";

const createToken = z.object({ label: z.string().trim().min(1).max(80).default("api token") });

/** Your tokens (sessions and API tokens), without the secrets. */
export const GET = route(async (req: NextRequest) => ({ tokens: getAuthDb().listTokens(requirePrincipal(req).username) }), { public: true });

/** A new API token for MCP, the extension, or CI. The raw token is in this response only. */
export const POST = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    const { label } = createToken.parse(await req.json().catch(() => ({})));
    const { token, info } = getAuthDb().issueToken(p.username, "api", label);
    return { token, ...info, orgId: p.orgId, userId: p.userId };
  },
  { public: true },
);

export const OPTIONS = preflight;

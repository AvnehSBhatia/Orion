import type { NextRequest } from "next/server";
import { getAuthDb } from "@/auth/db";
import { createApiToken, createTokenRequest } from "@/auth/tokens";
import { preflight, readJson, requirePrincipal, route } from "@/http/route";

export const runtime = "nodejs";

/** Your tokens (sessions and API tokens), without the secrets. */
export const GET = route(async (req: NextRequest) => ({ tokens: getAuthDb().listTokens(requirePrincipal(req).username) }), { public: true });

/** A new API token for MCP, the extension, or CI. The raw token is in this response only. */
export const POST = route(
  async (req: NextRequest) => {
    const p = requirePrincipal(req);
    const { label } = createTokenRequest.parse(await readJson(req, {}));
    return createApiToken(getAuthDb(), p, label);
  },
  { public: true },
);

export const OPTIONS = preflight;

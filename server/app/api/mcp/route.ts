import type { NextRequest } from "next/server";
import { z } from "zod";
import { orgId } from "@/contract/schemas";
import { config } from "@/config";
import { mcpHandlerFor } from "@/mcp/server";
import { DEFAULT_MAX_BODY, readCapped } from "@/http/body";
import { HttpError } from "@/http/error";
import { viewerOf } from "@/orgs/visibility";
import { optionalPrincipal, route } from "@/http/route";

export const runtime = "nodejs";
export const maxDuration = 60;

const scope = z.object({ orgId, userId: z.string().min(1, "userId is required") });

/** The request with its body read under the size cap, since the MCP transport reads the body itself. */
async function capped(req: NextRequest): Promise<Request> {
  if (req.method !== "POST") return req;
  const body = await readCapped(req, DEFAULT_MAX_BODY);
  return new Request(req.url, { method: req.method, headers: req.headers, body });
}

/**
 * Streamable HTTP MCP endpoint. Needs `Authorization: Bearer <api token>` (POST /api/auth/tokens); the org and
 * person come from the token and URL params are ignored. With AUTH_DISABLED=true they come from the URL
 * (`/api/mcp?orgId=acme&userId=devon`) or the `x-orion-org` and `x-orion-user` headers.
 */
const handle = route(
  async (req: NextRequest): Promise<Response> => {
    const principal = optionalPrincipal(req);
    if (principal) return mcpHandlerFor(principal.orgId, principal.userId, viewerOf(principal))(await capped(req));
    if (!config.authDisabled) throw new HttpError(401, "sign in required", undefined, { "WWW-Authenticate": 'Bearer realm="orion"' });
    const url = req.nextUrl.searchParams;
    const parsed = scope.parse({
      orgId: url.get("orgId") ?? req.headers.get("x-orion-org") ?? undefined,
      userId: url.get("userId") ?? req.headers.get("x-orion-user") ?? undefined,
    });
    return mcpHandlerFor(parsed.orgId, parsed.userId)(await capped(req));
  },
  { public: true, limit: "ask" },
);

export { handle as GET, handle as POST, handle as DELETE };

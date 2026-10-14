import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { orgId } from "@/contract/schemas";
import { authenticate } from "@/auth/request";
import { config } from "@/config";
import { mcpHandlerFor } from "@/mcp/server";
import { HttpError } from "@/http/error";

export const runtime = "nodejs";
export const maxDuration = 60;

const scope = z.object({ orgId, userId: z.string().min(1, "userId is required") });

/**
 * Streamable HTTP MCP endpoint. Needs `Authorization: Bearer <api token>` (POST /api/auth/tokens); the org and
 * person come from the token and URL params are ignored. With AUTH_DISABLED=true they come from the URL
 * (`/api/mcp?orgId=acme&userId=devon`) or the `x-orion-org` and `x-orion-user` headers.
 */
async function handle(req: NextRequest): Promise<Response> {
  const principal = authenticate(req);
  if (principal) return serve(req, principal.orgId, principal.userId);
  if (!config.authDisabled) {
    return NextResponse.json({ error: "sign in required" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="orion"' } });
  }
  const url = req.nextUrl.searchParams;
  const parsed = scope.safeParse({
    orgId: url.get("orgId") ?? req.headers.get("x-orion-org") ?? undefined,
    userId: url.get("userId") ?? req.headers.get("x-orion-user") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  return serve(req, parsed.data.orgId, parsed.data.userId);
}

async function serve(req: NextRequest, orgId: string, userId: string): Promise<Response> {
  try {
    return await mcpHandlerFor(orgId, userId)(req);
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export { handle as GET, handle as POST, handle as DELETE };

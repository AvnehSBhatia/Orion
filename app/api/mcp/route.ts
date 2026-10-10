import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { orgId } from "@/contract/schemas";
import { mcpHandlerFor } from "@/server/mcp";
import { HttpError } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const scope = z.object({ orgId, userId: z.string().min(1, "userId is required") });

/**
 * Streamable HTTP MCP endpoint. No auth yet: the org and person come from the URL
 * (`/api/mcp?orgId=acme&userId=devon`) or the `x-orion-org` and `x-orion-user` headers.
 */
async function handle(req: NextRequest): Promise<Response> {
  const url = req.nextUrl.searchParams;
  const parsed = scope.safeParse({
    orgId: url.get("orgId") ?? req.headers.get("x-orion-org") ?? undefined,
    userId: url.get("userId") ?? req.headers.get("x-orion-user") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    return await mcpHandlerFor(parsed.data.orgId, parsed.data.userId)(req);
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export { handle as GET, handle as POST, handle as DELETE };

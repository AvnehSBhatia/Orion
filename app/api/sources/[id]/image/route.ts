import type { NextRequest } from "next/server";
import { orgQuery } from "@/contract/schemas";
import { getStore } from "@/server/deps";
import { HttpError, preflight, route, scopedQuery } from "@/server/http";

export const runtime = "nodejs";

function contentType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}

export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/sources/[id]/image">) => {
  const { orgId } = orgQuery.parse(scopedQuery(req));
  const { id } = await ctx.params;
  const image = getStore(orgId).sourceImage(id);
  if (!image) throw new HttpError(404, `no image for source "${id}"`);
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": contentType(image), "Cache-Control": "private, max-age=3600" },
  });
});

export const OPTIONS = preflight;

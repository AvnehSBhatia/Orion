// /v1 route plumbing: Orion's route() underneath, errors as { error: { code, message } }, and who may call.
import type { NextRequest } from "next/server";
import type { Principal } from "@/auth/db";
import { HttpError } from "@/http/error";
import { requirePrincipal, route, type RouteOptions } from "@/http/route";

const CODES: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  402: "budget_exceeded",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "rate_limited",
  500: "internal",
  502: "upstream_failed",
  503: "unavailable",
  504: "upstream_timeout",
};

/** An HttpError whose /v1 body carries this `code`, like `consent_required`. */
export const v1Error = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  new HttpError(status, message, { code }, headers);

/** Rewrites route()'s `{ error: "..." , code? }` into `{ error: { code, message } }`, keeping other fields (retryAfterSec). */
async function reshapeError(res: Response): Promise<Response> {
  if (res.status < 400 || !res.headers.get("content-type")?.includes("application/json")) return res;
  const body = (await res.clone().json().catch(() => null)) as ({ error?: unknown; code?: unknown } & Record<string, unknown>) | null;
  if (!body || typeof body.error !== "string") return res;
  const { error, code, ...rest } = body;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ error: { code: typeof code === "string" ? code : (CODES[res.status] ?? "error"), message: error }, ...rest }), {
    status: res.status,
    headers,
  });
}

/**
 * A /v1 handler: everything `route()` does (body cap, rate limit, CSRF, security headers, log line), with the
 * caller always signed in (even when AUTH_DISABLED=true, since every /v1 call acts as a person) unless `public`.
 */
export function v1Route<T, C = unknown>(handler: (req: NextRequest, ctx: C, p: Principal) => Promise<T>, opts: RouteOptions = {}) {
  const inner = route<T, C>(async (req, ctx) => handler(req, ctx, opts.public ? (null as unknown as Principal) : requirePrincipal(req)), {
    ...opts,
    public: true,
  });
  return async (req: NextRequest, ctx: C): Promise<Response> => reshapeError(await inner(req, ctx));
}

/** Owner endpoints: an org admin with the session cookie or an API token, never a Mac's device token. */
export function assertOwner(p: Principal): void {
  if (p.kind === "device") throw v1Error(403, "forbidden", "a device token cannot call owner endpoints; sign in as an admin");
  if (!p.admin) throw v1Error(403, "forbidden", "only an org admin can do this");
}

/** A path id: 404 for anything that cannot be one of ours. */
export function pathId(id: string): string {
  if (!/^[\w-]{1,64}$/.test(id)) throw v1Error(404, "not_found", "not found");
  return id;
}

import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { config } from "@/config";
import type { ErrorResponse } from "@/contract/types";
import type { Principal } from "@/auth/db";
import { authenticate } from "@/auth/request";
import { SIGN_IN_REQUIRED, assertActingAs, assertAdmin, assertOrg, scopeInput } from "@/auth/scope";

export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** Matches by shape, so errors thrown by another copy of this module (dev reloads, bundles) still count. */
  static [Symbol.hasInstance](v: unknown): boolean {
    return v instanceof Error && v.name === "HttpError" && typeof (v as { status?: unknown }).status === "number";
  }
}

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin.startsWith("chrome-extension://")) {
    const ids = config.extensionIds;
    return ids.length === 0 || ids.includes(origin.slice("chrome-extension://".length)) ? origin : null;
  }
  return config.uiOrigins.includes(origin) ? origin : null;
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

function errorStatus(err: unknown): { status: number; error: string } {
  if (err instanceof HttpError) return { status: err.status, error: err.message };
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { status: 400, error: `${where}${issue?.message ?? "invalid request"}` };
  }
  if (err instanceof SyntaxError) return { status: 400, error: "body must be valid JSON" };
  console.error(err);
  return { status: 500, error: "internal error" };
}

// The caller of each in-flight request, set by `route()`. null: auth is disabled.
const principals = new WeakMap<Request, Principal | null>();

/** The signed-in caller of a request handled by `route()`; null when AUTH_DISABLED=true or on a public route. */
export function principalOf(req: Request): Principal | null {
  return principals.get(req) ?? null;
}

/** The caller, or 401. For routes that only make sense signed in (tokens, me) even when auth is disabled. */
export function requirePrincipal(req: Request): Principal {
  const p = principalOf(req) ?? authenticate(req);
  if (!p) throw new HttpError(401, SIGN_IN_REQUIRED);
  return p;
}

/** The query string as an object, with orgId (and with `user`, userId) pinned to the caller. */
export function scopedQuery(req: NextRequest, opts?: { user?: boolean }): Record<string, string> {
  return scopeInput(principalOf(req), Object.fromEntries(req.nextUrl.searchParams), opts);
}

/** The JSON body, with orgId (and with `user`, userId) pinned to the caller. */
export async function scopedBody(req: NextRequest, opts?: { user?: boolean }): Promise<unknown> {
  return scopeInput(principalOf(req), await req.json(), opts);
}

/** 403 unless the caller is this person or an org admin. */
export const actingAs = (req: Request, userId: string) => assertActingAs(principalOf(req), userId);
/** 403 unless the caller belongs to this org. */
export const sameOrg = (req: Request, orgId: string) => assertOrg(principalOf(req), orgId);
/** 403 unless the caller is an org admin. */
export const adminOnly = (req: Request) => assertAdmin(principalOf(req));

/**
 * Wraps a route handler with sign-in, JSON output (or a raw Response), CORS, and contract-shaped errors.
 * Every route needs a session cookie or bearer token (401 otherwise) unless `public` or AUTH_DISABLED=true.
 */
export function route<T, C = unknown>(handler: (req: NextRequest, ctx: C) => Promise<T>, opts: { public?: boolean } = {}) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const headers = corsHeaders(req);
    try {
      if (!opts.public && !config.authDisabled) {
        const p = authenticate(req);
        if (!p) throw new HttpError(401, SIGN_IN_REQUIRED);
        principals.set(req, p);
      }
      const out = await handler(req, ctx);
      if (out instanceof Response) {
        for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
        return out;
      }
      return NextResponse.json(out, { headers });
    } catch (err) {
      const { status, error } = errorStatus(err);
      return NextResponse.json<ErrorResponse>({ error }, { status, headers });
    }
  };
}

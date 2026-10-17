import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { config } from "@/config";
import type { ErrorResponse } from "@/contract/types";
import { auditViewingAs } from "@/audit/log";
import { sha256 } from "@/auth/crypto";
import { getAuthDb, type Principal } from "@/auth/db";
import { authenticate, clientIp, rawToken } from "@/auth/request";
import { SIGN_IN_REQUIRED, assertActingAs, assertAdmin, assertOrg, scopeInput } from "@/auth/scope";
import { DEFAULT_MAX_BODY, checkContentLength, readJsonCapped } from "./body";
import { allowedOrigin, checkCsrf } from "./csrf";
import { noteServerError } from "@/jobs/alerts";
import { HttpError, tooManyRequests } from "./error";
import { rateLimiter, type LimitClass } from "./ratelimit";

export type RouteOptions = {
  /** No sign-in needed (the handler may still look up the caller with `requirePrincipal`). */
  public?: boolean;
  /** Which token bucket the call spends from (see `http/ratelimit.ts`). Default: "default". */
  limit?: LimitClass;
  /** Body size cap in bytes. Default 256KB. */
  maxBody?: number;
};

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "Retry-After, X-Request-Id",
    Vary: "Origin",
  };
}

/** Headers every API response carries. The API serves only JSON, streams, and images, so nothing may run or frame. */
export function securityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    ...(config.cookieSecure ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

const requestId = (req: Request) => {
  const given = req.headers.get("x-request-id");
  return given && /^[\w.:-]{1,64}$/.test(given) ? given : randomBytes(8).toString("hex");
};

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders(req), ...securityHeaders(), "X-Request-Id": requestId(req) } });
}

function errorStatus(err: unknown): { status: number; body: ErrorResponse & Record<string, unknown>; headers?: Record<string, string> } {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message, ...err.extra }, headers: err.headers };
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { status: 400, body: { error: `${where}${issue?.message ?? "invalid request"}` } };
  }
  if (err instanceof SyntaxError) return { status: 400, body: { error: "body must be valid JSON" } };
  console.error(err);
  return { status: 500, body: { error: "internal error" } };
}

// Per in-flight request: the caller (null when auth is disabled or the route is public) and the body cap.
const principals = new WeakMap<Request, Principal | null>();
const bodyCaps = new WeakMap<Request, number>();

/** The signed-in caller of a request handled by `route()`; null when AUTH_DISABLED=true or on a public route. */
export function principalOf(req: Request): Principal | null {
  return principals.get(req) ?? null;
}

/** The caller if the request carries a valid token, else null. Works on public routes too. */
export function optionalPrincipal(req: Request): Principal | null {
  if (principals.has(req) && principals.get(req)) return principals.get(req)!;
  const p = authenticate(req);
  if (p) principals.set(req, p);
  return p;
}

/** The caller, or 401. For routes that only make sense signed in (tokens, me) even when auth is disabled. */
export function requirePrincipal(req: Request): Principal {
  const p = optionalPrincipal(req);
  if (!p) throw new HttpError(401, SIGN_IN_REQUIRED);
  return p;
}

/** The JSON body, read with the route's byte cap. `fallback` stands in for an empty body. */
export function readJson(req: Request, fallback?: unknown): Promise<unknown> {
  return readJsonCapped(req, bodyCaps.get(req) ?? DEFAULT_MAX_BODY, fallback);
}

/** With `user`, an admin naming another person's userId is "viewing as": audited, once an hour per admin and person. */
function noteViewingAs<T>(req: NextRequest, scoped: T, opts?: { user?: boolean }): T {
  const p = principalOf(req);
  const userId = (scoped as { userId?: unknown } | null)?.userId;
  if (opts?.user && p && typeof userId === "string" && userId !== p.userId) auditViewingAs(getAuthDb(), p, userId, req.nextUrl.pathname);
  return scoped;
}

/** The query string as an object, with orgId (and with `user`, userId) pinned to the caller. */
export function scopedQuery(req: NextRequest, opts?: { user?: boolean }): Record<string, string> {
  return noteViewingAs(req, scopeInput(principalOf(req), Object.fromEntries(req.nextUrl.searchParams), opts), opts);
}

/** The JSON body, with orgId (and with `user`, userId) pinned to the caller. */
export async function scopedBody(req: NextRequest, opts?: { user?: boolean }): Promise<unknown> {
  return noteViewingAs(req, scopeInput(principalOf(req), await readJson(req), opts), opts);
}

/** 403 unless the caller is this person or an org admin. */
export const actingAs = (req: Request, userId: string) => assertActingAs(principalOf(req), userId);
/** 403 unless the caller belongs to this org. */
export const sameOrg = (req: Request, orgId: string) => assertOrg(principalOf(req), orgId);
/** 403 unless the caller is an org admin. */
export const adminOnly = (req: Request) => assertAdmin(principalOf(req));

/** Who the rate limiter counts: the token (hashed) when there is one, else the client IP. */
function limitKey(req: Request, cls: LimitClass): string {
  const raw = cls === "account" ? null : rawToken(req);
  return raw ? `t:${sha256(raw).slice(0, 24)}` : `ip:${clientIp(req)}`;
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  try {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  } catch {
    // Immutable headers (a fetched or redirect response): copy it.
    const copy = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) copy.headers.set(k, v);
    return copy;
  }
}

function logRequest(line: { reqId: string; method: string; path: string; status: number; ms: number; org: string | null; user: string | null }): void {
  if (!config.logRequests) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...line }));
}

/**
 * Wraps a route handler with, in order: a request id, the body size cap, the rate limit, the CSRF check, sign-in,
 * JSON output (or a raw Response), CORS and security headers, contract-shaped errors, and one JSON log line.
 * Every route needs a session cookie or bearer token (401 otherwise) unless `public` or AUTH_DISABLED=true.
 */
export function route<T, C = unknown>(handler: (req: NextRequest, ctx: C) => Promise<T>, opts: RouteOptions = {}) {
  const cls = opts.limit ?? "default";
  const maxBody = opts.maxBody ?? DEFAULT_MAX_BODY;
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const t0 = Date.now();
    const reqId = requestId(req);
    const headers = { ...corsHeaders(req), ...securityHeaders(), "X-Request-Id": reqId };
    let res: Response;
    try {
      checkContentLength(req, maxBody);
      bodyCaps.set(req, maxBody);
      if (config.rateLimit) {
        const wait = rateLimiter().take(cls, limitKey(req, cls));
        if (wait) throw tooManyRequests(wait);
      }
      checkCsrf(req);
      if (!opts.public && !config.authDisabled) {
        const p = authenticate(req);
        if (!p) throw new HttpError(401, SIGN_IN_REQUIRED);
        principals.set(req, p);
      }
      const out = await handler(req, ctx);
      res = out instanceof Response ? withHeaders(out, headers) : NextResponse.json(out, { headers });
    } catch (err) {
      const { status, body, headers: extra } = errorStatus(err);
      res = NextResponse.json(body, { status, headers: { ...headers, ...extra } });
    }
    if (res.status >= 500) noteServerError(req.nextUrl.pathname);
    const p = principals.get(req) ?? null;
    logRequest({ reqId, method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - t0, org: p?.orgId ?? null, user: p?.userId ?? null });
    return res;
  };
}

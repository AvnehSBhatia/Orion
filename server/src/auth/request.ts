import { config } from "@/config";
import { SESSION_DAYS, getAuthDb, type Principal } from "./db";

/** The cookie name over plain HTTP (local dev), and before the `__Host-` name existed. */
export const LEGACY_SESSION_COOKIE = "orion_session";
/** Behind HTTPS: `__Host-` makes the browser refuse it unless Secure, Path=/, and no Domain. */
export const SECURE_SESSION_COOKIE = "__Host-orion_session";
/** Kept for callers that predate the Secure name. */
export const SESSION_COOKIE = LEGACY_SESSION_COOKIE;

export const sessionCookieName = () => (config.cookieSecure ? SECURE_SESSION_COOKIE : LEGACY_SESSION_COOKIE);

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function bearerToken(req: Request): string | null {
  const m = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

/** The session cookie, under the current name or the old one (accepted during the switch to `__Host-`). */
export function cookieToken(req: Request): string | null {
  return cookieValue(req, SECURE_SESSION_COOKIE) ?? cookieValue(req, LEGACY_SESSION_COOKIE);
}

/** The raw token: `Authorization: Bearer <token>` first, else the session cookie. */
export function rawToken(req: Request): string | null {
  return bearerToken(req) ?? cookieToken(req);
}

/** True when the request authenticates with a cookie (and so needs CSRF checks), not a bearer token. */
export const usesCookie = (req: Request) => !bearerToken(req) && !!cookieToken(req);

/** The signed-in account, or null. Disabled accounts and expired tokens are null. */
export function authenticate(req: Request): Principal | null {
  const raw = rawToken(req);
  return raw ? getAuthDb().resolveToken(raw) : null;
}

const attrs = (maxAge: number) => ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, ...(config.cookieSecure ? ["Secure"] : [])];

export function sessionCookie(token: string): string {
  return [`${sessionCookieName()}=${token}`, ...attrs(SESSION_DAYS * 86_400)].join("; ");
}

/** Clears both names, so a cookie set before the switch to `__Host-` goes too. */
export function clearedSessionCookies(): string[] {
  const names = config.cookieSecure ? [SECURE_SESSION_COOKIE, LEGACY_SESSION_COOKIE] : [LEGACY_SESSION_COOKIE];
  return names.map((n) => [`${n}=`, ...attrs(0)].join("; "));
}

/** The client IP for rate limiting. X-Forwarded-For only counts when TRUST_PROXY=true, since clients can forge it. */
export function clientIp(req: Request): string {
  if (!config.trustProxy) return "direct";
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
}

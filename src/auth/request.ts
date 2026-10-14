import { config } from "@/config";
import { SESSION_DAYS, getAuthDb, type Principal } from "./db";

export const SESSION_COOKIE = "orion_session";

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The raw token: `Authorization: Bearer <token>` first, else the session cookie. */
export function rawToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  const m = auth?.match(/^Bearer\s+(\S+)\s*$/i);
  if (m) return m[1];
  return cookieValue(req, SESSION_COOKIE);
}

/** The signed-in account, or null. */
export function authenticate(req: Request): Principal | null {
  const raw = rawToken(req);
  return raw ? getAuthDb().resolveToken(raw) : null;
}

export function sessionCookie(token: string): string {
  return [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_DAYS * 86_400}`, ...(config.cookieSecure ? ["Secure"] : [])].join("; ");
}

export function clearedSessionCookie(): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(config.cookieSecure ? ["Secure"] : [])].join("; ");
}

/** The client IP for rate limiting. X-Forwarded-For only counts when TRUST_PROXY=true, since clients can forge it. */
export function clientIp(req: Request): string {
  if (!config.trustProxy) return "direct";
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
}

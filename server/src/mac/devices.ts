// Connecting a Mac: a signed-in person makes a one-time code in the web app, the Mac trades it for a device token.
import { z } from "zod";
import { audit } from "@/audit/log";
import type { AuthDb, Principal } from "@/auth/db";
import type { LoginLimiter } from "@/auth/ratelimit";
import { tooManyRequests } from "@/http/error";
import { v1Error } from "./http";

export const registerRequest = z.object({
  /** The Mac model ("MacBook Pro") or "Mac"; never the computer or user name. */
  name: z.string().trim().min(1).max(120),
  auth_code: z.string().trim().min(1).max(64),
});

/** POST /api/auth/device-codes: a code for "Connect your Mac", valid 15 minutes, once. */
export function createDeviceCode(db: AuthDb, p: Principal): { code: string; expiresAt: string } {
  const out = db.createDeviceCode(p.username);
  audit(db, { orgId: p.orgId, actor: p.username, action: "device_code_created", target: p.userId });
  return out;
}

/**
 * POST /v1/devices/register. A wrong, used, or expired code is a 401, and failures count per IP like logins do,
 * so the 8-character code space cannot be walked.
 */
export function registerDevice(db: AuthDb, limiter: LoginLimiter, body: z.infer<typeof registerRequest>, ip: string): { device_id: string; device_token: string } {
  const key = `device|${ip}`;
  const wait = limiter.blockedFor(key);
  if (wait) throw tooManyRequests(wait, "too many failed codes, try again later");
  const account = db.consumeDeviceCode(body.auth_code);
  if (!account) {
    limiter.fail(key);
    throw v1Error(401, "invalid_auth_code", "the code is wrong, used, or expired; make a new one in Orion's Settings");
  }
  limiter.reset(key);
  const { token, info } = db.issueToken(account.username, "device", body.name);
  audit(db, { orgId: account.orgId, actor: account.username, action: "device_registered", target: info.id, detail: { name: info.label } });
  return { device_id: info.id, device_token: token };
}

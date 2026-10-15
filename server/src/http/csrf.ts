import { usesCookie } from "@/auth/request";
import { config } from "@/config";
import { HttpError } from "./error";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Origins allowed by CORS: the web app's (UI_ORIGIN) and, for chrome-extension:// origins, the ids in
 * EXTENSION_IDS. With no ids set, any extension passes only while auth is disabled (local demos).
 */
export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin.startsWith("chrome-extension://")) {
    const ids = config.extensionIds;
    const id = origin.slice("chrome-extension://".length);
    if (ids.length) return ids.includes(id) ? origin : null;
    return config.authDisabled ? origin : null;
  }
  return config.uiOrigins.includes(origin) ? origin : null;
}

const isJson = (contentType: string) => /^application\/([\w.+-]+\+)?json\s*(;|$)/i.test(contentType.trim());

/**
 * Cookie-authenticated writes must come from the web app (or an allowed extension), and carry JSON.
 * Origin must be allowed; without an Origin header, Sec-Fetch-Site must say same-origin or same-site.
 * A body sent as a form or text/plain (the only kinds a cross-site page can post without a preflight) is refused.
 * Bearer requests are exempt: a browser never attaches a bearer token on its own.
 */
export function checkCsrf(req: Request): void {
  if (!UNSAFE.has(req.method) || !usesCookie(req)) return;
  const origin = req.headers.get("origin");
  if (origin) {
    const self = (() => {
      try {
        return new URL(req.url).origin;
      } catch {
        return null;
      }
    })();
    if (origin !== self && !allowedOrigin(origin)) throw new HttpError(403, `cross-site request refused (origin ${origin} is not allowed)`);
  } else {
    const site = req.headers.get("sec-fetch-site");
    if (site !== "same-origin" && site !== "same-site") throw new HttpError(403, "cross-site request refused (no Origin header)");
  }
  const type = req.headers.get("content-type");
  if (type !== null && !isJson(type)) throw new HttpError(415, "send the body as Content-Type: application/json");
}

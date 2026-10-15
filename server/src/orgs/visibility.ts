import type { Principal } from "@/auth/db";
import type { Store } from "@/db/store";
import { HttpError } from "@/http/error";
import { getOrgSettings, type OrgSettings } from "./settings";

/**
 * Who may open a captured screenshot: its author, an org admin, or anyone when the org sets
 * `screenshotVisibility: "org"`. Page text and derived work items are org-wide either way. No principal: auth is off.
 */
export function canSeeImage(p: Principal | null, settings: Pick<OrgSettings, "screenshotVisibility">, authorId: string | null): boolean {
  if (!p || p.admin || settings.screenshotVisibility === "org") return true;
  return authorId !== null && authorId === p.userId;
}

/** Sources with `hasImage` turned off where the caller may not open the screenshot. */
export function maskImages<T extends { authorId: string | null; hasImage: boolean }>(p: Principal | null, store: Store, sources: T[]): T[] {
  if (!p || p.admin) return sources;
  const settings = getOrgSettings(store);
  return sources.map((s) => (s.hasImage && !canSeeImage(p, settings, s.authorId) ? { ...s, hasImage: false } : s));
}

function contentType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}

/** The screenshot as a response, after the visibility check. 404 when there is none, 403 when it is not yours to see. */
export function screenshotResponse(p: Principal | null, store: Store, id: string): Response {
  const source = store.getSource(id);
  const image = source ? store.sourceImage(id) : null;
  if (!source || !image) throw new HttpError(404, `no image for source "${id}"`);
  if (!canSeeImage(p, getOrgSettings(store), source.authorId)) throw new HttpError(403, "only the author and admins can open this screenshot");
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": contentType(image), "Cache-Control": "private, max-age=3600" },
  });
}

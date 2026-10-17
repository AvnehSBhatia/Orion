import type { Principal } from "@/auth/db";
import type { Source } from "@/contract/types";
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

/** Who is asking, for reads of source text. `null` (auth off) sees everything. */
export type Viewer = { userId: string; admin: boolean } | null;

export const viewerOf = (p: Principal | null): Viewer => (p ? { userId: p.userId, admin: p.admin } : null);

/** Raw text of a Mac work block (`kind = "mac"`) is private to its author and org admins; everything else is org-wide. */
export function canSeeText(v: Viewer, s: { kind: string; authorId: string | null }): boolean {
  if (!v || v.admin || s.kind !== "mac") return true;
  return s.authorId !== null && s.authorId === v.userId;
}

/** Ids of Mac sources whose text this viewer may not read. Empty for admins and when auth is off. */
export function hiddenSourceIds(store: Store, v: Viewer): Set<string> {
  if (!v || v.admin) return new Set();
  return new Set(store.listSourceMeta().filter((s) => !canSeeText(v, s)).map((s) => s.id));
}

/** True when this document, or any member of this digest, is a Mac source the viewer may not read. */
export function isHidden(store: Store, v: Viewer, id: string): boolean {
  if (!v || v.admin) return false;
  const s = store.getSource(id);
  if (s) return !canSeeText(v, s);
  const d = store.getDigest(id);
  return !!d && d.members.some((m) => isHidden(store, v, m));
}

/**
 * Drops sources the viewer may not read (Mac text of other people, and digests that merge it). For model context
 * and search results, where even a title of someone's window is private.
 */
export function dropHidden<T extends { id: string }>(store: Store, v: Viewer, items: T[]): T[] {
  if (!v || v.admin) return items;
  return items.filter((s) => !isHidden(store, v, s.id));
}

/**
 * For listings (activity): another person's Mac source stays as metadata, "Mac activity" plus the app name, with no
 * excerpt, URL, or window title. Digests that merge such text are dropped.
 */
export function maskMacSources<T extends Source>(v: Viewer, store: Store, sources: T[]): T[] {
  if (!v || v.admin) return sources;
  return sources.flatMap((s) => {
    if (s.kind === "digest") return isHidden(store, v, s.id) ? [] : [s];
    if (canSeeText(v, s)) return [s];
    const app = store.getSource(s.id)?.text.split(":")[0].trim();
    return [{ ...s, title: app ? `Mac activity: ${app}` : "Mac activity", excerpt: "", ref: "mac://activity" }];
  });
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

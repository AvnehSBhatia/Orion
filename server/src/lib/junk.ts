// Junk the model sometimes writes into an item's to-do and reading list, dropped on extraction and again on read
// so items stored before this filter display clean too.
import type { ReadLink } from "@/contract/types";

/** Shorter than this, a to-do says nothing a teammate can act on ("Update 230."). */
export const TODO_MIN = 12;

/** A to-do worth showing, trimmed, or null: drops short ones and a bare verb plus a number ("Update 257."). */
export function usefulTodo(todo: string | null | undefined): string | null {
  const t = todo?.trim();
  if (!t || t.length < TODO_MIN) return null;
  if (/^[a-z]+\s+#?[\d.,:/-]+\.?$/i.test(t) || !/[a-z]{3}/i.test(t)) return null;
  return t;
}

// Search engines whose own pages (home and results) are never something to read.
const SEARCH_HOSTS = ["bing.com", "duckduckgo.com", "search.yahoo.com", "yandex.com", "yandex.ru", "baidu.com", "ecosia.org", "startpage.com", "search.brave.com", "kagi.com"];
// Google's home, results and new-tab pages; its products (ads.google.com, docs.google.com) are real work.
const GOOGLE_HOST = /^(www\.)?google(\.[a-z]{2,3}){1,2}$/;
const GOOGLE_JUNK_PATH = /^\/($|search|webhp|url|_\/chrome\/newtab)/;
const YAHOO_HOME = /^(www\.)?yahoo\.com$/;

/** Null when the link is not worth reading: not http(s), a search engine page, or a browser new-tab page. */
function linkKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (SEARCH_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  if (GOOGLE_HOST.test(host) && GOOGLE_JUNK_PATH.test(u.pathname)) return null;
  if (YAHOO_HOME.test(host) && u.pathname === "/") return null;
  // Same page: ignore the fragment and a trailing slash.
  return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}

/** The links worth reading, in order, once per page. */
export function usefulReadLinks(links: ReadLink[]): ReadLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = linkKey(l.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The item with its junk to-do and links dropped. */
export function withoutJunk<T extends { todo: string | null; readLinks: ReadLink[] }>(n: T): T {
  return { ...n, todo: usefulTodo(n.todo), readLinks: usefulReadLinks(n.readLinks) };
}

// URL rules shared by the options page, the service worker, and the chooser.
// Pure functions, no chrome APIs, so they run under node:test.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when tokens and captures may be sent to this server: any https:// URL,
 * or plain http:// only to this machine (localhost, 127.0.0.1, ::1).
 */
export function isAllowedServerUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
}

/** "https://orion.example.com/" -> "https://orion.example.com". Null when not an allowed server URL. */
export function normalizeServerUrl(raw: string): string | null {
  if (!isAllowedServerUrl(raw)) return null;
  const url = new URL(raw.trim());
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

/** The host permission pattern that covers a server URL, like "https://orion.example.com/*". */
export function originPattern(serverUrl: string): string {
  const url = new URL(serverUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

/**
 * Drops the query string and fragment from web URLs, which often carry
 * session ids, search terms, emails, and reset tokens. Other schemes
 * (desktop://window/1) pass through unchanged.
 */
export function stripQueryAndFragment(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.split(/[?#]/)[0];
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;
  return url.origin + url.pathname;
}

/** "https://www.Mail.Google.com/x" -> "mail.google.com". Null for non-web URLs. */
export function hostOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Turns what a person or admin typed ("https://www.bank.com/login", "Bank.com",
 * "*.bank.com") into a bare host ("bank.com"). Null when it is not a host.
 */
export function normalizeHostEntry(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z]+:\/\//.test(s)) s = `https://${s.replace(/^\*\./, '')}`;
  const host = hostOf(s);
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes('.') && host !== 'localhost') return null;
  return host;
}

/** True when host is one of the listed hosts or a subdomain of one. */
export function hostMatches(host: string | null, list: readonly string[]): boolean {
  if (!host) return false;
  return list.some((entry) => {
    const h = normalizeHostEntry(entry);
    return !!h && (host === h || host.endsWith(`.${h}`));
  });
}

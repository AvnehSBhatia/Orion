/**
 * Returns the page as compact HTML, or its visible text when the HTML is too big.
 *
 * Runs inside the page via chrome.scripting.executeScript, so it must stay
 * self contained: no imports, no references to anything outside this function.
 */
export function readPage(): string {
  // The server's limit for the html field.
  const MAX_CHARS = 60_000;
  const STRIP_TAGS = 'script, style, svg, noscript, iframe, link, meta, template, canvas';
  // Everything else (class, style, data-*, src, event handlers) is noise for the
  // model and pushes real pages past the size limit.
  const KEEP_ATTRS = new Set([
    'href', 'alt', 'title', 'aria-label', 'role', 'value', 'placeholder',
    'datetime', 'checked', 'selected', 'name', 'type',
  ]);

  const clone = document.documentElement.cloneNode(true) as HTMLElement;

  // cloneNode copies attributes, not live form state. Carry over what the
  // user typed so an edited budget field shows its current value. Password
  // fields are never copied.
  const FIELDS = 'input, textarea, select';
  const liveFields = document.querySelectorAll<HTMLInputElement>(FIELDS);
  clone.querySelectorAll<HTMLElement>(FIELDS).forEach((el, i) => {
    const live = liveFields[i];
    if (!live || live.type === 'password') return;
    el.setAttribute('value', live.value);
  });

  clone.querySelectorAll(STRIP_TAGS).forEach((el) => el.remove());
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (!KEEP_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
    }
    // A password field can carry a value attribute set by the page itself.
    if (el instanceof HTMLInputElement && el.type === 'password') el.removeAttribute('value');
  });

  const html = clone.outerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ');
  if (html.length <= MAX_CHARS) return html;

  const text = document.body?.innerText ?? clone.textContent ?? '';
  return text.slice(0, MAX_CHARS);
}

import { isSensitiveField, type FieldInfo } from '../lib/sensitive.ts';

/**
 * Returns the page as compact HTML, or its visible text when the HTML is too big.
 *
 * Bundled on its own as read-page.js and injected into a tab with
 * chrome.scripting.executeScript({ files }), which leaves it on
 * globalThis.__orionReadPage in the extension's isolated world. Takes the
 * document as a parameter so tests can run it against a fake DOM.
 *
 * Never copied: values of password and hidden inputs, cc-* and one-time-code
 * autocomplete fields, and fields whose name, id, or label looks like a card
 * number, CVV, SSN, IBAN, token, secret, or API key (see lib/sensitive.ts).
 */
export function readPage(doc: Document = document): string {
  // The server's limit for the html field.
  const MAX_CHARS = 60_000;
  const STRIP_TAGS = 'script, style, svg, noscript, iframe, link, meta, template, canvas';
  // Everything else (class, style, data-*, src, event handlers) is noise for the
  // model and pushes real pages past the size limit.
  const KEEP_ATTRS = new Set([
    'href', 'alt', 'title', 'aria-label', 'role', 'value', 'placeholder',
    'datetime', 'checked', 'selected', 'name', 'type',
  ]);
  const FIELDS = 'input, textarea, select';

  const clone = doc.documentElement.cloneNode(true) as HTMLElement;

  // cloneNode copies attributes, not live form state. Carry over what the
  // user typed so an edited budget field shows its current value, except for
  // sensitive fields, whose values are wiped from the copy entirely.
  const liveFields = Array.from(doc.querySelectorAll<HTMLInputElement>(FIELDS));
  const cloneFields = Array.from(clone.querySelectorAll<HTMLElement>(FIELDS));
  cloneFields.forEach((el, i) => {
    const live = liveFields[i];
    if (!live) return;
    if (isSensitiveField(describe(live))) {
      el.removeAttribute('value');
      if (el.tagName === 'TEXTAREA') el.textContent = '';
      if (el.tagName === 'SELECT') el.querySelectorAll('option').forEach((o) => o.removeAttribute('selected'));
      // Hidden inputs carry nothing a person reads; drop them.
      if ((live.getAttribute('type') ?? '').toLowerCase() === 'hidden') el.remove();
      return;
    }
    if (el.tagName === 'TEXTAREA') el.textContent = live.value ?? '';
    else if (el.tagName === 'INPUT') el.setAttribute('value', live.value ?? '');
  });

  clone.querySelectorAll(STRIP_TAGS).forEach((el) => el.remove());
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (!KEEP_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
    }
  });

  const html = clone.outerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ');
  if (html.length <= MAX_CHARS) return html;

  // Too big: send the visible text, but never text typed into fields.
  const body = doc.body?.cloneNode(true) as HTMLElement | undefined;
  if (!body) return '';
  body.querySelectorAll(`${STRIP_TAGS}, ${FIELDS}`).forEach((el) => el.remove());
  return (body.innerText ?? body.textContent ?? '').replace(/\s{2,}/g, ' ').slice(0, MAX_CHARS);

  function describe(el: HTMLInputElement): FieldInfo {
    const id = el.getAttribute('id');
    const labels: string[] = [];
    const forLabel = id ? doc.querySelector(`label[for="${id.replace(/["\\]/g, '\\$&')}"]`) : null;
    if (forLabel?.textContent) labels.push(forLabel.textContent);
    const wrapping = el.closest('label');
    if (wrapping?.textContent) labels.push(wrapping.textContent);
    for (const a of ['aria-label', 'placeholder', 'title']) {
      const v = el.getAttribute(a);
      if (v) labels.push(v);
    }
    return {
      tag: el.tagName,
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id,
      autocomplete: el.getAttribute('autocomplete'),
      label: labels.join(' '),
    };
  }
}

/** Entry for the injected read-page.js bundle. */
export function installReadPage(): void {
  (globalThis as { __orionReadPage?: () => string }).__orionReadPage = () => readPage(document);
}

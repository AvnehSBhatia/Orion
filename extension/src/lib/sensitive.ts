// Decides which form fields must never have their values copied into a
// capture. Used by readPage (injected into tabs) and covered by tests.

export type FieldInfo = {
  tag: string; // input, textarea, select
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  label?: string | null; // text of the field's <label>, aria-label, or placeholder
};

const SECRET_TYPES = new Set(['password', 'hidden']);
const SECRET_AUTOCOMPLETE = new Set(['one-time-code', 'current-password', 'new-password']);

// Matched against names, ids, and labels after "cardNumber", "card_number",
// and "card-number" have all been turned into "card number".
const SECRET_WORDS = new RegExp(
  [
    // payment cards
    'card ?(number|no|num)', 'credit ?card', 'debit ?card', 'cc ?(num|number|no)', 'ccn', 'pan',
    'cvv2?', 'cvc2?', 'csc', 'security ?code', 'card ?verification', 'card ?expiry', 'exp ?date',
    // identity numbers
    'ssn', 'social ?security', 'national ?id', 'national ?insurance', 'tax ?id', 'tin', 'passport ?(number|no)',
    // bank accounts
    'iban', 'bic', 'swift', 'routing ?(number|no)', 'account ?(number|no|num)', 'sort ?code', 'aba',
    // credentials and secrets
    'password', 'passwd', 'passphrase', 'passcode', 'pin', 'otp', 'one ?time ?(code|password)', 'totp', 'mfa', '2fa',
    'verification ?code', 'auth ?code', 'token', 'secret', 'api ?key', 'apikey', 'access ?key', 'private ?key',
    'client ?secret', 'credentials?', 'recovery ?code', 'seed ?phrase',
  ]
    .map((w) => `\\b${w}\\b`)
    .join('|'),
);

/** "cardNumber", "card_number", "x-api-key" -> "card number", "card number", "x api key". */
export function words(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** True when the field's value must never leave the browser. */
export function isSensitiveField(field: FieldInfo): boolean {
  const type = (field.type ?? '').toLowerCase();
  if (field.tag.toLowerCase() === 'input' && SECRET_TYPES.has(type)) return true;

  const autocomplete = (field.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (autocomplete.some((t) => t.startsWith('cc-') || SECRET_AUTOCOMPLETE.has(t))) return true;

  return [field.name, field.id, field.label].some((s) => !!s && SECRET_WORDS.test(words(s)));
}

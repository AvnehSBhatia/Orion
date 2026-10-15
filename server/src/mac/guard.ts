// The server's last check on Mac text: card numbers and API keys never get stored, whatever the Mac redacted.
// Emails, phone numbers and addresses are allowed, since a person may turn those redactions off on their Mac.

export type GuardHit = "card_number" | "api_key";

const API_KEYS = [
  /sk-(?:live|test|ant|proj)-[A-Za-z0-9_-]{10,}/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
];

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** What makes this text unstorable, or null. Never log the text, only the result. */
export function guardHit(text: string): GuardHit | null {
  const runs = text.match(/\d(?:[ -]?\d){12,18}/g) ?? [];
  if (runs.some((r) => luhn(r.replace(/\D/g, "")))) return "card_number";
  if (API_KEYS.some((re) => re.test(text))) return "api_key";
  return null;
}

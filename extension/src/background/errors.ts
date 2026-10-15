import type { ErrorCode } from '../types';

// Errors thrown inside the service worker carry a code the popup knows how to
// explain. Anything else is reported as 'unknown'.
export class CaptureError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ?? code);
    this.code = code;
  }
}

// Codes that describe a normal situation (not signed in yet, a chrome:// page,
// a site the user excluded), not a bug worth an error in the console.
const EXPECTED: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'no_user', 'restricted', 'excluded', 'paused', 'consent', 'signed_out', 'capture_disabled', 'paused_by_org', 'retrying', 'no_permission',
]);

/** Logs the error and returns the code to show the user. */
export function reportError(err: unknown): ErrorCode {
  const code = err instanceof CaptureError ? err.code : 'unknown';
  (EXPECTED.has(code) ? console.info : console.error)('[orion]', err);
  return code;
}

import type { ErrorCode } from '../types';

// Errors thrown inside the service worker carry a code the popup knows how to
// explain. Anything else is reported as 'unknown'.
export class CaptureError extends Error {
  constructor(readonly code: ErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

/** Logs the error and returns the code to show the user. */
export function reportError(err: unknown): ErrorCode {
  const code = err instanceof CaptureError ? err.code : 'unknown';
  // Missing user id and chrome:// pages are normal, not errors worth flagging.
  const expected = code === 'no_user' || code === 'restricted';
  (expected ? console.info : console.error)('[orion]', err);
  return code;
}

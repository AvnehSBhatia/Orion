// The upload queue. Each beat, changed captures are queued and then sent
// oldest first. When the server is busy or unreachable (429, 5xx, network),
// sending pauses with exponential backoff (or Retry-After) while new captures
// keep queueing, up to a small cap; past it, the oldest are dropped. The queue
// is in memory only, so nothing captured is written to disk.

import { backoffDelay } from '../lib/backoff.ts';
import { blockReason } from '../lib/policy.ts';
import { BoundedQueue } from '../lib/queue.ts';
import { getLocal } from '../privacy';
import { patchRecording } from '../recording';
import type { CapturePayload, ErrorCode } from '../types';
import { isStopOutcome, postCapture, stopFor } from './upload';

const MAX_QUEUED = 40;
const MAX_QUEUED_BYTES = 24_000_000; // about 12 average window captures at the 2MB screenshot cap

const queue = new BoundedQueue<CapturePayload>(
  MAX_QUEUED,
  MAX_QUEUED_BYTES,
  (p) => p.screenshotB64.length + p.html.length + p.url.length + p.title.length,
);
let failures = 0;
let retryAt = 0;

export function enqueue(payload: CapturePayload): void {
  const dropped = queue.push(payload);
  if (dropped > 0) console.info(`[orion] upload queue full, dropped ${dropped} oldest`);
}

/** Forget everything queued, for example when the session stops. */
export function resetSender(): void {
  queue.clear();
  failures = 0;
  retryAt = 0;
}

export type DrainResult = { sent: number; lastError: ErrorCode | null; stopped: boolean };

/**
 * Sends queued captures until the queue is empty, the server asks to wait,
 * or the session has to stop. Does nothing while a backoff is running.
 */
export async function drain(now = Date.now()): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, lastError: null, stopped: false };
  if (now < retryAt) {
    result.lastError = 'retrying';
    await report();
    return result;
  }

  // A site may have been excluded since its capture was queued.
  const { policy, blockedHosts } = await getLocal();
  queue.retain((p) => p.source !== 'tab' || blockReason(p.url, policy, blockedHosts) === null);

  for (let next = queue.peek(); next; next = queue.peek()) {
    const outcome = await postCapture(next);
    if (outcome.kind === 'ok') {
      queue.shift();
      failures = 0;
      retryAt = 0;
      result.sent++;
      continue;
    }
    if (outcome.kind === 'retry') {
      failures++;
      retryAt = Date.now() + backoffDelay(failures, outcome.retryAfterMs);
      result.lastError = 'retrying';
      break;
    }
    if (isStopOutcome(outcome)) {
      resetSender();
      result.lastError = await stopFor(outcome);
      result.stopped = true;
      return result;
    }
    // 402 or another 4xx: this capture will never be accepted. Drop it and go on.
    queue.shift();
    result.lastError = outcome.kind === 'budget' ? 'budget' : 'backend';
  }
  await report();
  return result;
}

async function report(): Promise<void> {
  await patchRecording({ queued: queue.length, retryAt: retryAt > Date.now() ? retryAt : null });
}

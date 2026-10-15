import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKOFF_MAX_MS, backoffDelay, parseRetryAfter } from '../src/lib/backoff.ts';
import { BoundedQueue } from '../src/lib/queue.ts';
import { classifyResponse } from '../src/lib/responses.ts';

test('Retry-After is read as seconds, a date, or the body field', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(parseRetryAfter('120', undefined, now), 120_000);
  assert.equal(parseRetryAfter('Wed, 14 Oct 2026 12:00:30 GMT', undefined, now), 30_000);
  assert.equal(parseRetryAfter('Wed, 14 Oct 2026 11:00:00 GMT', undefined, now), 0);
  assert.equal(parseRetryAfter(null, 7, now), 7_000);
  assert.equal(parseRetryAfter('garbage', 'x', now), null);
  assert.equal(parseRetryAfter(undefined, undefined, now), null);
});

test('backoff doubles from 5s to a 5 minute cap', () => {
  const noJitter = () => 0;
  assert.equal(backoffDelay(1, null, noJitter), 5_000);
  assert.equal(backoffDelay(2, null, noJitter), 10_000);
  assert.equal(backoffDelay(3, null, noJitter), 20_000);
  assert.equal(backoffDelay(50, null, noJitter), BACKOFF_MAX_MS);
  assert.equal(backoffDelay(0, null, noJitter), 5_000);
  // Jitter only ever adds time.
  assert.equal(backoffDelay(1, null, () => 1), 6_250);
});

test('Retry-After wins, clamped to 1 second .. 1 hour', () => {
  assert.equal(backoffDelay(1, 42_000), 42_000);
  assert.equal(backoffDelay(1, 0), 1_000);
  assert.equal(backoffDelay(1, 10 * 60 * 60_000), 60 * 60_000);
});

test('the queue drops the oldest items when over count or bytes', () => {
  const q = new BoundedQueue<string>(3, 10, (s) => s.length);
  assert.equal(q.push('aaa'), 0);
  assert.equal(q.push('bbb'), 0);
  assert.equal(q.push('ccc'), 0);
  assert.equal(q.push('ddd'), 1); // count cap
  assert.equal(q.peek(), 'bbb');
  assert.equal(q.push('eeeeeeee'), 3); // byte cap pushes out everything older
  assert.equal(q.length, 1);
  assert.equal(q.bytes, 8);
  assert.equal(q.push('x'.repeat(11)), 1); // can never fit, rejected
  assert.equal(q.length, 1);
  assert.equal(q.shift(), 'eeeeeeee');
  assert.equal(q.bytes, 0);
  assert.equal(q.shift(), undefined);
});

test('the queue can drop items that are no longer allowed', () => {
  const q = new BoundedQueue<string>(10, 100, (s) => s.length);
  q.push('keep');
  q.push('drop');
  q.push('keep2');
  q.retain((s) => !s.startsWith('drop'));
  assert.equal(q.length, 2);
  assert.equal(q.bytes, 9);
});

test('server answers map to actions', () => {
  assert.deepEqual(classifyResponse(200, undefined, null), { kind: 'ok' });
  assert.deepEqual(classifyResponse(401, 'unauthorized', null), { kind: 'signed_out' });
  assert.deepEqual(classifyResponse(403, 'consent required', null), { kind: 'consent' });
  assert.deepEqual(classifyResponse(403, 'capture paused', null), { kind: 'paused_by_org' });
  assert.deepEqual(classifyResponse(403, 'extension not allowed', null), { kind: 'forbidden' });
  assert.deepEqual(classifyResponse(402, 'monthly model budget reached', null), { kind: 'budget' });
  assert.deepEqual(classifyResponse(429, 'slow down', 30_000), { kind: 'retry', retryAfterMs: 30_000 });
  assert.deepEqual(classifyResponse(503, undefined, null), { kind: 'retry', retryAfterMs: null });
  assert.deepEqual(classifyResponse(408, undefined, null), { kind: 'retry', retryAfterMs: null });
  assert.deepEqual(classifyResponse(400, 'bad body', null), { kind: 'drop' });
  assert.deepEqual(classifyResponse(413, 'too large', null), { kind: 'drop' });
});

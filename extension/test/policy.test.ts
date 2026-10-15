import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, PAUSE_FOREVER, blockReason, isPaused, parsePolicy } from '../src/lib/policy.ts';

test('policy is parsed defensively', () => {
  assert.deepEqual(parsePolicy(null), DEFAULT_POLICY);
  assert.deepEqual(parsePolicy({}), DEFAULT_POLICY);
  assert.deepEqual(
    parsePolicy({
      captureEnabled: false,
      excludedHosts: ['mail.google.com', 3, 'bank.com'],
      captureIntervalSec: 30,
      consent: { required: true, version: 2 },
    }),
    { captureEnabled: false, excludedHosts: ['mail.google.com', 'bank.com'], captureIntervalSec: 30, consent: { required: true, version: 2 } },
  );
  assert.equal(parsePolicy({ captureIntervalSec: 1 }).captureIntervalSec, 5);
  assert.equal(parsePolicy({ captureIntervalSec: 1e9 }).captureIntervalSec, 3600);
  assert.equal(parsePolicy({ captureIntervalSec: 'soon' }).captureIntervalSec, 5);
  // Only an explicit false turns capture off.
  assert.equal(parsePolicy({ captureEnabled: 'no' }).captureEnabled, true);
});

test('pause is active until its end time', () => {
  const now = 1_000_000;
  assert.equal(isPaused(null, now), false);
  assert.equal(isPaused(undefined, now), false);
  assert.equal(isPaused(now - 1, now), false);
  assert.equal(isPaused(now + 15 * 60_000, now), true);
  assert.equal(isPaused(PAUSE_FOREVER, now), true);
});

test('org exclusions and personal blocks stop a url from being read', () => {
  const policy = { excludedHosts: ['mail.google.com', 'bank.com'] };
  assert.equal(blockReason('https://mail.google.com/mail/u/0', policy, []), 'org_excluded');
  assert.equal(blockReason('https://www.online.bank.com/', policy, []), 'org_excluded');
  assert.equal(blockReason('https://health.example.com/x', policy, ['health.example.com']), 'user_blocked');
  assert.equal(blockReason('chrome://settings', policy, []), 'not_web');
  assert.equal(blockReason(undefined, policy, []), 'not_web');
  assert.equal(blockReason('https://ads.google.com/campaigns', policy, []), null);
});

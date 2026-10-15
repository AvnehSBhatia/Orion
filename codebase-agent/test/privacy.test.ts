import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPathFilter, privateGlobsFrom } from '../src/privacy.ts';

const GITIGNORE = [
  '# normal git rules',
  'node_modules/',
  '.env',
  'dist/',
  '!.env.example',
  '',
  '# agent private',
  '+./src/features/secret-pricing-engine/',
  '+./src/features/unreleased-voice-mode/',
  '+.*.secret.ts',
].join('\r\n');

const filter = createPathFilter(GITIGNORE);

test('reads plus-dot lines and strips the prefix', () => {
  assert.deepEqual(privateGlobsFrom(GITIGNORE), [
    '/src/features/secret-pricing-engine/',
    '/src/features/unreleased-voice-mode/',
    '*.secret.ts',
  ]);
});

test('plus-dot folder and everything inside it is excluded', () => {
  assert.equal(filter.isAllowed('src/features/secret-pricing-engine/index.ts'), false);
  assert.equal(filter.isAllowed('src/features/secret-pricing-engine/deep/nested/rules.ts'), false);
  assert.equal(filter.isAllowed('src/features/unreleased-voice-mode/mic.ts'), false);
  assert.equal(filter.isPrivate('src/features/unreleased-voice-mode/mic.ts'), true);
});

test('plus-dot folder rules are anchored to the repo root', () => {
  assert.equal(filter.isAllowed('other/src/features/secret-pricing-engine/index.ts'), true);
});

test('plus-dot glob patterns work', () => {
  assert.equal(filter.isAllowed('src/billing/rates.secret.ts'), false);
});

test('normal files are allowed', () => {
  assert.equal(filter.isAllowed('src/features/checkout/index.ts'), true);
  assert.equal(filter.isAllowed('README.md'), true);
  assert.equal(filter.isPrivate('src/features/checkout/index.ts'), false);
});

test('normal gitignore rules are excluded', () => {
  assert.equal(filter.isAllowed('dist/bundle.js'), false);
  assert.equal(filter.isAllowed('node_modules/foo/index.js'), false);
});

test('secrets are always excluded, even when gitignore negates them', () => {
  assert.equal(filter.isAllowed('.env.local'), false);
  assert.equal(filter.isAllowed('.env.example'), false);
  assert.equal(filter.isAllowed('config/server.pem'), false);
  assert.equal(filter.isAllowed('certs/private.key'), false);
});

test('lockfiles and sync state files are excluded', () => {
  assert.equal(filter.isAllowed('package-lock.json'), false);
  assert.equal(filter.isAllowed('extension/package-lock.json'), false);
  assert.equal(filter.isAllowed('yarn.lock'), false);
  assert.equal(filter.isAllowed('.ctx-cards.json'), false);
  assert.equal(filter.isAllowed('.ctx-last-sha'), false);
});

test('windows and dot-slash paths are normalized', () => {
  assert.equal(filter.isAllowed('src\\features\\secret-pricing-engine\\index.ts'), false);
  assert.equal(filter.isAllowed('./src/features/secret-pricing-engine/index.ts'), false);
  assert.equal(filter.isAllowed('src\\features\\checkout\\index.ts'), true);
});

test('empty gitignore still applies the hard denylist', () => {
  const empty = createPathFilter('');
  assert.equal(empty.isAllowed('src/app.ts'), true);
  assert.equal(empty.isAllowed('.env'), false);
});

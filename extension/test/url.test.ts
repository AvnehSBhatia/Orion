import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostMatches,
  hostOf,
  isAllowedServerUrl,
  normalizeHostEntry,
  normalizeServerUrl,
  originPattern,
  stripQueryAndFragment,
} from '../src/lib/url.ts';

test('only https servers are allowed, plus http on this machine', () => {
  assert.equal(isAllowedServerUrl('https://orion.example.com'), true);
  assert.equal(isAllowedServerUrl('https://orion.example.com:8443/base/'), true);
  assert.equal(isAllowedServerUrl('http://localhost:3001'), true);
  assert.equal(isAllowedServerUrl('http://127.0.0.1:3001'), true);
  assert.equal(isAllowedServerUrl('http://[::1]:3001'), true);
  assert.equal(isAllowedServerUrl('http://orion.example.com'), false);
  assert.equal(isAllowedServerUrl('http://localhost.evil.com'), false);
  assert.equal(isAllowedServerUrl('http://10.0.0.5:3001'), false);
  assert.equal(isAllowedServerUrl('ftp://orion.example.com'), false);
  assert.equal(isAllowedServerUrl('https://user:pw@orion.example.com'), false);
  assert.equal(isAllowedServerUrl('not a url'), false);
  assert.equal(isAllowedServerUrl(''), false);
});

test('server urls are normalized without trailing slashes', () => {
  assert.equal(normalizeServerUrl(' https://orion.example.com/ '), 'https://orion.example.com');
  assert.equal(normalizeServerUrl('https://example.com/orion//'), 'https://example.com/orion');
  assert.equal(normalizeServerUrl('http://example.com'), null);
  assert.equal(originPattern('https://orion.example.com:8443/x'), 'https://orion.example.com/*');
});

test('query strings and fragments are stripped from web urls', () => {
  assert.equal(
    stripQueryAndFragment('https://mail.example.com/inbox?token=abc&email=a@b.c#msg-1'),
    'https://mail.example.com/inbox',
  );
  assert.equal(stripQueryAndFragment('http://localhost:3000/a/b/?q=1'), 'http://localhost:3000/a/b/');
  assert.equal(stripQueryAndFragment('https://example.com#x'), 'https://example.com/');
  assert.equal(stripQueryAndFragment('desktop://window/src-1'), 'desktop://window/src-1');
  assert.equal(stripQueryAndFragment('weird?x=1'), 'weird');
});

test('hosts are compared without www and with subdomains', () => {
  assert.equal(hostOf('https://www.Mail.Google.com/x'), 'mail.google.com');
  assert.equal(hostOf('chrome://extensions'), null);
  assert.equal(normalizeHostEntry('https://www.bank.com/login'), 'bank.com');
  assert.equal(normalizeHostEntry('*.Bank.com'), 'bank.com');
  assert.equal(normalizeHostEntry('bank'), null);
  assert.equal(normalizeHostEntry('  '), null);
  assert.equal(hostMatches('mail.google.com', ['google.com']), true);
  assert.equal(hostMatches('mail.google.com', ['mail.google.com']), true);
  assert.equal(hostMatches('notgoogle.com', ['google.com']), false);
  assert.equal(hostMatches('docs.google.com', ['mail.google.com']), false);
  assert.equal(hostMatches(null, ['google.com']), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSensitiveField, words } from '../src/lib/sensitive.ts';

const input = (f: Record<string, string>) => isSensitiveField({ tag: 'INPUT', ...f });

test('names are split into words', () => {
  assert.equal(words('cardNumber'), 'card number');
  assert.equal(words('card_number'), 'card number');
  assert.equal(words('X-API-Key'), 'x api key');
  assert.equal(words('userSSN'), 'user ssn');
  assert.equal(words('IBANField'), 'iban field');
});

test('password, hidden, and secret autocomplete fields are sensitive', () => {
  assert.equal(input({ type: 'password' }), true);
  assert.equal(input({ type: 'hidden', name: 'state' }), true);
  assert.equal(input({ type: 'text', autocomplete: 'cc-number' }), true);
  assert.equal(input({ type: 'text', autocomplete: 'section-pay cc-csc' }), true);
  assert.equal(input({ type: 'text', autocomplete: 'one-time-code' }), true);
  assert.equal(input({ type: 'text', autocomplete: 'new-password' }), true);
});

test('fields that look like cards, ids, bank accounts, or secrets are sensitive', () => {
  for (const name of [
    'cardNumber', 'card_number', 'ccnum', 'cvv', 'cvc2', 'security-code', 'ssn', 'social_security_number',
    'iban', 'routingNumber', 'account_number', 'api_key', 'apiKey', 'x-api-key', 'access_token', 'clientSecret',
    'csrf_token', 'otp', 'mfaCode', 'private-key', 'pin',
  ]) {
    assert.equal(input({ type: 'text', name }), true, name);
  }
  assert.equal(input({ type: 'text', id: 'ccNumber' }), true);
  assert.equal(input({ type: 'text', label: 'Credit card number' }), true);
  assert.equal(input({ type: 'text', label: 'Your IBAN' }), true);
  assert.equal(input({ type: 'text', label: 'Social Security Number' }), true);
  assert.equal(input({ type: 'text', label: 'Personal access token' }), true);
});

test('ordinary work fields are kept', () => {
  for (const name of ['budget', 'campaign_name', 'dailyBudget', 'title', 'email', 'tokenizer_model', 'spinner', 'company', 'search', 'amount']) {
    assert.equal(input({ type: 'text', name }), false, name);
  }
  assert.equal(input({ type: 'text', label: 'Deal stage' }), false);
  assert.equal(isSensitiveField({ tag: 'TEXTAREA', name: 'notes' }), false);
  assert.equal(isSensitiveField({ tag: 'SELECT', name: 'stage' }), false);
});

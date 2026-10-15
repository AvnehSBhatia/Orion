import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../src/cards.ts';
import { createPathFilter } from '../src/privacy.ts';

const filter = createPathFilter('+./src/secret/\n');

const card = (over: Record<string, unknown> = {}) => ({
  label: 'Faster checkout',
  summary: 'Checkout now takes one click for saved cards.',
  status: 'shipped',
  paths: ['src/checkout/index.ts'],
  ...over,
});

test('accepts an array or a { cards } object', () => {
  assert.equal(parseCards([card()], filter).cards.length, 1);
  assert.equal(parseCards({ cards: [card()] }, filter).cards.length, 1);
});

test('drops cards that mention a private path', () => {
  const r = parseCards([card({ paths: ['src\\secret\\pricing.ts'] })], filter);
  assert.equal(r.cards.length, 0);
  assert.match(r.dropped[0].reason, /private/);
});

test('only known fields are passed through', () => {
  const [c] = parseCards([card({ sellable: true, extra: 'x' })], filter).cards;
  assert.deepEqual(Object.keys(c).sort(), ['label', 'paths', 'status', 'summary']);
});

test('rejects bad status and missing fields', () => {
  const r = parseCards([card({ status: 'done' }), card({ label: '' }), 'nope'], filter);
  assert.equal(r.cards.length, 0);
  assert.equal(r.dropped.length, 3);
});

test('clips label and summary to the contract limits', () => {
  const [c] = parseCards([card({ label: 'x'.repeat(80), summary: 'y'.repeat(300) })], filter).cards;
  assert.ok(c.label.length <= 40);
  assert.ok(c.summary.length <= 140);
});

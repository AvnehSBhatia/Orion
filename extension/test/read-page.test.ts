import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readPage } from '../src/background/read-page.ts';

function page(body: string): Document {
  const { document } = parseHTML(`<!doctype html><html><head><title>t</title><script>x()</script></head><body>${body}</body></html>`);
  return document as unknown as Document;
}

test('typed values are copied, secrets are not', () => {
  const doc = page(`
    <label for="budget">Daily budget</label><input id="budget" name="budget" value="10">
    <input type="password" name="pw" value="hunter2">
    <input type="hidden" name="csrf" value="hidden-secret">
    <input name="cardNumber" value="4111111111111111">
    <label>CVV <input name="c" value="123"></label>
    <input name="whatever" autocomplete="cc-exp" value="12/29">
    <input name="code" autocomplete="one-time-code" value="654321">
    <input id="ssn" value="078-05-1120">
    <input aria-label="API key" value="sk-live-abc">
    <textarea name="client_secret">s3cret</textarea>
    <textarea name="notes">launch on friday</textarea>
    <select name="iban"><option selected>DE89 3704</option></select>
  `);
  // Simulate the user typing into the budget field after load.
  (doc.querySelector('#budget') as HTMLInputElement).value = '25';

  const html = readPage(doc);
  assert.match(html, /value="25"/);
  assert.match(html, /launch on friday/);
  for (const secret of ['hunter2', 'hidden-secret', '4111111111111111', '"123"', '12/29', '654321', '078-05-1120', 'sk-live-abc', 's3cret']) {
    assert.ok(!html.includes(secret), `leaked ${secret}`);
  }
  assert.ok(!html.includes('<script'), 'script kept');
  assert.ok(!/<option selected/.test(html), 'sensitive select kept its selection');
});

test('unneeded attributes are stripped', () => {
  const html = readPage(page('<a href="/x" class="btn" onclick="evil()" data-id="1">Go</a>'));
  assert.match(html, /<a href="\/x">Go<\/a>/);
});

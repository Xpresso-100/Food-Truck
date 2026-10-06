// Supporting checks (SPEC R7 and section 8): the 415 and 422 cases on POST /api/orders,
// the check order 401 -> 403 -> 415 -> 422, and nothing written on a rejected order.
// READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { assertError } from '../support/contract.mjs';

const OK_LINE = { sku: 'HOT011', qty: 1 };

const INVALID = [
  ['lines missing', {}],
  ['lines null', { lines: null }],
  ['lines not an array', { lines: 'HOT011' }],
  ['lines an object', { lines: { sku: 'HOT011', qty: 1 } }],
  ['lines empty', { lines: [] }],
  ['more than 50 lines', { lines: Array.from({ length: 51 }, () => ({ ...OK_LINE })) }],
  ['a line that is not an object', { lines: ['HOT011'] }],
  ['a line that is a number', { lines: [5] }],
  ['sku missing', { lines: [{ qty: 1 }] }],
  ['sku not a string', { lines: [{ sku: 11, qty: 1 }] }],
  ['unknown sku', { lines: [{ sku: 'NOPE99', qty: 1 }] }],
  ['inactive sku', { lines: [{ sku: 'PKD034', qty: 1 }] }],
  ['qty missing', { lines: [{ sku: 'HOT011' }] }],
  ['qty "2" (string)', { lines: [{ sku: 'HOT011', qty: '2' }] }],
  ['qty 2.5', { lines: [{ sku: 'HOT011', qty: 2.5 }] }],
  ['qty 0', { lines: [{ sku: 'HOT011', qty: 0 }] }],
  ['qty -1', { lines: [{ sku: 'HOT011', qty: -1 }] }],
  ['qty 1000', { lines: [{ sku: 'HOT011', qty: 1000 }] }],
  ['qty null', { lines: [{ sku: 'HOT011', qty: null }] }],
  ['qty true', { lines: [{ sku: 'HOT011', qty: true }] }],
  ['duplicate sku', { lines: [{ sku: 'HOT011', qty: 1 }, { sku: 'HOT011', qty: 2 }] }],
  ['one good line and one unknown sku', { lines: [OK_LINE, { sku: 'NOPE99', qty: 1 }] }],
  ['note not a string', { lines: [OK_LINE], note: 123 }],
  ['note over 500 characters', { lines: [OK_LINE], note: 'x'.repeat(501) }],
];

describe('POST /api/orders validation and check order', () => {
  let app, truck1, franchise1, hq1;

  before(async () => {
    app = await startApp();
    truck1 = await app.login('truck1');
    franchise1 = await app.login('franchise1');
    hq1 = await app.login('hq1');
  });
  after(async () => { await app?.stop(); });

  async function orderCount() {
    const res = await hq1.get('/api/hq/orders');
    assert.equal(res.status, 200, `HQ inbox (used to count orders): ${res.text}`);
    return res.json.orders.length;
  }

  it('every invalid body gives 422 validation_failed and writes nothing', async () => {
    const before = await orderCount();
    for (const [label, body] of INVALID) {
      assertError(await truck1.post('/api/orders', body), 422, 'validation_failed', label);
    }
    assert.equal(await orderCount(), before, 'no order may be written when validation fails');
  });

  it('malformed JSON and non-object JSON bodies give 422', async () => {
    for (const raw of ['{"lines":[', '', '[]', '"lines"', '42', 'null']) {
      assertError(await truck1.postRaw('/api/orders', raw), 422, 'validation_failed', `body ${JSON.stringify(raw)}`);
    }
  });

  it('a non-JSON content type gives 415', async () => {
    const body = JSON.stringify({ lines: [OK_LINE] });
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      assertError(await truck1.postRaw('/api/orders', body, type), 415, 'unsupported_media_type', type);
    }
    assertError(await truck1.request('POST', '/api/orders', { body }), 415, 'unsupported_media_type', 'no content type');
  });

  it('check order: unauthenticated 401, then role 403, then content type 415, then validation 422', async () => {
    const anon = app.client();
    assertError(await anon.post('/api/orders', { lines: 'bad' }), 401, 'unauthenticated', 'anon, bad body');
    assertError(await anon.postRaw('/api/orders', 'x', 'text/plain'), 401, 'unauthenticated', 'anon, wrong type');
    assertError(await franchise1.post('/api/orders', { lines: 'bad' }), 403, 'forbidden', 'franchise, bad body');
    assertError(await hq1.postRaw('/api/orders', 'x', 'text/plain'), 403, 'forbidden', 'hq, wrong type');
    assertError(await truck1.postRaw('/api/orders', '{bad json', 'text/plain'), 415, 'unsupported_media_type', 'truck, wrong type and bad JSON');
  });

  it('accepted edge values: qty 2.0, qty 999, a 500-character note, charset in the content type', async () => {
    let res = await truck1.postRaw('/api/orders', '{"lines":[{"sku":"PKD010","qty":2.0}]}');
    assert.equal(res.status, 201, `qty 2.0: ${res.text}`);
    assert.equal(res.json.order.lines[0].qty, 2);

    res = await truck1.post('/api/orders', { lines: [{ sku: 'PKD020', qty: 999 }] });
    assert.equal(res.status, 201, `qty 999: ${res.text}`);
    assert.equal(res.json.order.lines[0].qty, 999);

    const note = 'n'.repeat(500);
    res = await truck1.post('/api/orders', { lines: [OK_LINE], note });
    assert.equal(res.status, 201, `500-char note: ${res.text}`);
    assert.equal(res.json.order.note, note);

    res = await truck1.postRaw('/api/orders', JSON.stringify({ lines: [OK_LINE] }), 'application/json; charset=utf-8');
    assert.equal(res.status, 201, `charset: ${res.text}`);
  });

  it('moq is shown but not enforced (DAI006 moq 6, qty 1 is accepted)', async () => {
    const res = await truck1.post('/api/orders', { lines: [{ sku: 'DAI006', qty: 1 }] });
    assert.equal(res.status, 201, res.text);
  });
});

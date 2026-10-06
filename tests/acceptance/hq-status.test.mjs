// Supporting checks (SPEC R8, R9, D17 and section 8): the HQ inbox and forward-only status
// changes with 409 invalid_transition. The truck sees the new status in its history.
// READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { assertError, assertJsonHeaders, assertOrderShape, ISO_8601_OFFSET } from '../support/contract.mjs';

describe('HQ inbox and status transitions', () => {
  let app, truck1, truck2, franchise1, hq1;
  let A, B, C; // A and B by truck1, C by truck2

  before(async () => {
    app = await startApp();
    truck1 = await app.login('truck1');
    truck2 = await app.login('truck2');
    franchise1 = await app.login('franchise1');
    hq1 = await app.login('hq1');
  });
  after(async () => { await app?.stop(); });

  const status = (id, s) => hq1.post(`/api/hq/orders/${id}/status`, { status: s });
  function orders() {
    assert.ok(A && B && C, 'precondition: R7 must succeed');
    return { A, B, C };
  }

  it('setup: trucks place three orders', async () => {
    const a = await truck1.post('/api/orders', { lines: [{ sku: 'HOT011', qty: 1 }] });
    const b = await truck1.post('/api/orders', { lines: [{ sku: 'PKD010', qty: 2 }] });
    const c = await truck2.post('/api/orders', { lines: [{ sku: 'SYR001', qty: 3 }] });
    for (const r of [a, b, c]) assert.equal(r.status, 201, r.text);
    [A, B, C] = [a.json.order, b.json.order, c.json.order];
  });

  it('GET /api/hq/orders lists every truck\'s orders, newest first, as full order objects', async () => {
    const { A, B, C } = orders();
    const res = await hq1.get('/api/hq/orders');
    assert.equal(res.status, 200, res.text);
    assertJsonHeaders(res, 'R8');
    const ids = res.json.orders.map((o) => o.id);
    for (const o of [A, B, C]) assert.ok(ids.includes(o.id), `order ${o.id} listed`);
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i - 1] > ids[i], 'newest first');
    res.json.orders.forEach((o, i) => assertOrderShape(o, `orders[${i}]`));
    assert.deepEqual(res.json.orders.find((o) => o.id === C.id), C);
  });

  it('?status filters; an unknown status is 422', async () => {
    const { A } = orders();
    const res = await hq1.get('/api/hq/orders?status=pending');
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.orders.some((o) => o.id === A.id));
    assert.ok(res.json.orders.every((o) => o.status === 'pending'));
    assertError(await hq1.get('/api/hq/orders?status=bogus'), 422, 'validation_failed', 'status=bogus');
  });

  it('pending -> in_process: 200 with the new status and status_updated_at set', async () => {
    const { A } = orders();
    const res = await status(A.id, 'in_process');
    assert.equal(res.status, 200, res.text);
    assertJsonHeaders(res, 'R9');
    assertOrderShape(res.json.order, 'R9 order');
    assert.equal(res.json.order.id, A.id);
    assert.equal(res.json.order.status, 'in_process');
    assert.match(String(res.json.order.status_updated_at), ISO_8601_OFFSET);
    assert.deepEqual(res.json.order.lines, A.lines, 'lines unchanged');
    assert.equal(res.json.order.cost_total, A.cost_total, 'cost_total unchanged');
  });

  it('the same or an earlier status is 409 invalid_transition', async () => {
    const { A } = orders();
    assertError(await status(A.id, 'in_process'), 409, 'invalid_transition', 'same status');
    assertError(await status(A.id, 'pending'), 409, 'invalid_transition', 'backwards');
  });

  it('forward skips are allowed: in_process -> delivered, pending -> out_for_delivery', async () => {
    const { A, B } = orders();
    let res = await status(A.id, 'delivered');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.order.status, 'delivered');
    res = await status(B.id, 'out_for_delivery');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.order.status, 'out_for_delivery');
  });

  it('nothing moves after delivered', async () => {
    const { A } = orders();
    for (const s of ['pending', 'in_process', 'out_for_delivery', 'delivered']) {
      assertError(await status(A.id, s), 409, 'invalid_transition', `delivered -> ${s}`);
    }
  });

  it('the filter reflects the new statuses', async () => {
    const { A, B, C } = orders();
    const pending = await hq1.get('/api/hq/orders?status=pending');
    const pendingIds = pending.json.orders.map((o) => o.id);
    assert.ok(pendingIds.includes(C.id) && !pendingIds.includes(A.id) && !pendingIds.includes(B.id));
    const delivered = await hq1.get('/api/hq/orders?status=delivered');
    assert.deepEqual(delivered.json.orders.map((o) => o.id), [A.id]);
  });

  it('a missing or invalid status value is 422', async () => {
    const { C } = orders();
    for (const body of [{}, { status: 'shipped' }, { status: 2 }, { status: null }, { status: ['delivered'] }]) {
      assertError(await hq1.post(`/api/hq/orders/${C.id}/status`, body), 422, 'validation_failed', JSON.stringify(body));
    }
    assertError(await hq1.postRaw(`/api/hq/orders/${C.id}/status`, '{"status":'), 422, 'validation_failed', 'malformed JSON');
  });

  it('an unknown or non-integer id is 404 not_found', async () => {
    for (const id of ['999999', 'abc', '0', '-1', '1.5']) {
      assertError(await status(id, 'in_process'), 404, 'not_found', `id ${id}`);
    }
  });

  it('a non-JSON content type is 415', async () => {
    const { C } = orders();
    const res = await hq1.postRaw(`/api/hq/orders/${C.id}/status`, '{"status":"in_process"}', 'text/plain');
    assertError(res, 415, 'unsupported_media_type', 'R9 text/plain');
  });

  it('truck and franchise users get 403; unauthenticated gets 401; the order is unchanged', async () => {
    const { C } = orders();
    for (const [who, client] of [['truck2', truck2], ['franchise1', franchise1]]) {
      assertError(await client.post(`/api/hq/orders/${C.id}/status`, { status: 'delivered' }), 403, 'forbidden', `${who} R9`);
      assertError(await client.get('/api/hq/orders'), 403, 'forbidden', `${who} R8`);
    }
    assertError(await app.client().post(`/api/hq/orders/${C.id}/status`, { status: 'delivered' }), 401, 'unauthenticated', 'anon R9');
    const inbox = await hq1.get('/api/hq/orders');
    assert.equal(inbox.json.orders.find((o) => o.id === C.id).status, 'pending');
  });

  it('the truck sees the new status in its history', async () => {
    const { A, B } = orders();
    const one = await truck1.get(`/api/orders/${A.id}`);
    assert.equal(one.status, 200, one.text);
    assert.equal(one.json.order.status, 'delivered');
    assert.match(String(one.json.order.status_updated_at), ISO_8601_OFFSET);
    const list = await truck1.get('/api/orders');
    assert.equal(list.status, 200, list.text);
    assert.equal(list.json.orders.find((o) => o.id === B.id).status, 'out_for_delivery');
    const ids = list.json.orders.map((o) => o.id);
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i - 1] > ids[i], 'history newest first');
  });
});

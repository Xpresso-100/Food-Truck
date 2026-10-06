// AC2 - Franchise users never see cost prices or truck pricing. (SPEC sections 3 and 8)
// Black-box through the HTTP API. READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { assertError, assertJsonHeaders, allKeys, allNumbers } from '../support/contract.mjs';
import { ACTIVE_PRODUCTS, COST_PRICES, DEFAULT_STATUSES, INACTIVE_SKU, PASSWORDS } from '../support/fixtures.mjs';

const FORBIDDEN_KEYS = ['cost_price', 'unit_cost', 'line_cost', 'cost_total', 'unit_price', 'line_total', 'truck_price'];

/** No forbidden key and no fixture cost value (rands or cents) anywhere in a franchise response. */
function assertNoCost(res, label) {
  for (const key of FORBIDDEN_KEYS) {
    assert.ok(!res.text.includes(`"${key}"`), `${label}: forbidden key "${key}" in body`);
  }
  if (res.json === undefined) return;
  for (const { key, path } of allKeys(res.json)) {
    assert.ok(!FORBIDDEN_KEYS.includes(key), `${label}: forbidden key ${key} at ${path}`);
    assert.ok(!/cost/i.test(key), `${label}: cost key ${key} at ${path}`);
  }
  for (const { value, path } of allNumbers(res.json)) {
    for (const cost of COST_PRICES) {
      assert.ok(Math.abs(value - cost) > 1e-9, `${label}: cost value ${cost} at ${path}`);
      assert.ok(Math.abs(value - Math.round(cost * 100)) > 1e-9, `${label}: cost value in cents at ${path}`);
    }
  }
}

describe('AC2 franchise users never see cost prices or truck pricing', () => {
  let app, franchise1, truck1, hq1;
  let orderId = 1;

  before(async () => {
    app = await startApp();
    truck1 = await app.login('truck1');
    hq1 = await app.login('hq1');
    const created = await truck1.post('/api/orders', { lines: [{ sku: 'HOT011', qty: 2 }] });
    if (created.status === 201) orderId = created.json.order.id;
  });
  after(async () => { await app?.stop(); });

  it('R2 login: franchise1 is role franchise at location 3, no cost data', async () => {
    franchise1 = app.client();
    const res = await franchise1.post('/api/login', { username: 'franchise1', password: PASSWORDS.franchise1 });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.role, 'franchise');
    assert.equal(res.json.user.location.id, 3);
    assertNoCost(res, 'R2');
  });

  it('R4 GET /api/me: no cost data', async () => {
    const res = await franchise1.get('/api/me');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.role, 'franchise');
    assertNoCost(res, 'R4');
  });

  it('R5 GET /api/stock: status only, exactly sku/name/category/unit/status, no cost data', async () => {
    const res = await franchise1.get('/api/stock');
    assert.equal(res.status, 200, res.text);
    assertJsonHeaders(res, 'R5');
    assertNoCost(res, 'R5');
    assert.deepEqual(res.json.items.map((i) => i.sku), ACTIVE_PRODUCTS.map((p) => p.sku));
    for (const item of res.json.items) {
      assert.deepEqual(Object.keys(item).sort(), ['category', 'name', 'sku', 'status', 'unit'], `keys of ${item.sku}`);
      assert.equal(item.status, DEFAULT_STATUSES[item.sku], `status of ${item.sku}`);
    }
  });

  it('R6 GET /api/products: exactly sku/name/category/unit/moq/price, price = franchise price', async () => {
    const res = await franchise1.get('/api/products');
    assert.equal(res.status, 200, res.text);
    assertJsonHeaders(res, 'R6');
    assertNoCost(res, 'R6');
    assert.deepEqual(res.json.items.map((i) => i.sku), ACTIVE_PRODUCTS.map((p) => p.sku), 'active products, category then sku');
    assert.ok(!res.json.items.some((i) => i.sku === INACTIVE_SKU), 'inactive product hidden');
    for (const item of res.json.items) {
      const p = ACTIVE_PRODUCTS.find((x) => x.sku === item.sku);
      assert.deepEqual(Object.keys(item).sort(), ['category', 'moq', 'name', 'price', 'sku', 'unit'], `keys of ${item.sku}`);
      assert.equal(typeof item.price, 'number', `price of ${item.sku} is a number`);
      assert.ok(Math.abs(item.price - p.franchise) < 1e-9, `price of ${item.sku}: expected ${p.franchise}, got ${item.price}`);
      assert.equal(item.moq, p.moq);
      assert.equal(item.name, p.name);
    }
  });

  it('R7 POST /api/orders is 403 with no order data (valid body, bad body, wrong content type)', async () => {
    const attempts = [
      franchise1.post('/api/orders', { lines: [{ sku: 'HOT011', qty: 1 }] }),
      franchise1.post('/api/orders', { lines: 'not-an-array' }),
      franchise1.postRaw('/api/orders', '{"lines":[{"sku":"HOT011","qty":1}]}', 'text/plain'),
    ];
    for (const res of await Promise.all(attempts)) {
      assertError(res, 403, 'forbidden', 'R7 franchise');
      assert.equal(res.json.order, undefined);
      assertNoCost(res, 'R7');
    }
  });

  it('R8 GET /api/hq/orders is 403 with no order data', async () => {
    const res = await franchise1.get('/api/hq/orders');
    assertError(res, 403, 'forbidden', 'R8 franchise');
    assert.equal(res.json.orders, undefined);
    assertNoCost(res, 'R8');
  });

  it('R9 POST /api/hq/orders/{id}/status is 403 and changes nothing', async () => {
    const res = await franchise1.post(`/api/hq/orders/${orderId}/status`, { status: 'delivered' });
    assertError(res, 403, 'forbidden', 'R9 franchise');
    assert.equal(res.json.order, undefined);
    assertNoCost(res, 'R9');

    const inbox = await hq1.get('/api/hq/orders');
    assert.equal(inbox.status, 200, inbox.text);
    const order = inbox.json.orders.find((o) => o.id === orderId);
    assert.ok(order, 'the order still exists');
    assert.equal(order.status, 'pending', 'a franchise user cannot move an order');
  });

  it('R10 GET /api/orders and R11 GET /api/orders/{id} are 403 with no order data', async () => {
    for (const path of ['/api/orders', `/api/orders/${orderId}`, '/api/orders?location_id=2']) {
      const res = await franchise1.get(path);
      assertError(res, 403, 'forbidden', `franchise ${path}`);
      assert.equal(res.json.orders, undefined);
      assert.equal(res.json.order, undefined);
      assertNoCost(res, path);
    }
  });
});

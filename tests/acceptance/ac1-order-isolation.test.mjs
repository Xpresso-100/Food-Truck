// AC1 - Truck user cannot read other locations' orders. (SPEC section 8)
// Black-box through the HTTP API (R7, R8, R10, R11). READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { assertError, assertJsonHeaders, assertOrderShape } from '../support/contract.mjs';

describe('AC1 truck user cannot read other locations\' orders', () => {
  let app, truck1, truck2, franchise1, hq1;
  let orderX; // placed by truck2 (location 4)
  let orderY; // placed by truck1 (location 2)

  before(async () => {
    app = await startApp();
    truck1 = await app.login('truck1');
    truck2 = await app.login('truck2');
    franchise1 = await app.login('franchise1');
    hq1 = await app.login('hq1');
  });
  after(async () => { await app?.stop(); });

  function orders() {
    assert.ok(orderX && orderY, 'precondition: truck2 and truck1 must be able to place orders (R7)');
    return { X: orderX, Y: orderY };
  }

  it('truck2 and truck1 each place an order for their own location', async () => {
    const x = await truck2.post('/api/orders', { lines: [{ sku: 'PKD010', qty: 3 }] });
    assert.equal(x.status, 201, x.text);
    assertOrderShape(x.json.order, 'X');
    assert.equal(x.json.order.location.id, 4);
    orderX = x.json.order;

    const y = await truck1.post('/api/orders', { lines: [{ sku: 'HOT011', qty: 1 }] });
    assert.equal(y.status, 201, y.text);
    assertOrderShape(y.json.order, 'Y');
    assert.equal(y.json.order.location.id, 2);
    orderY = y.json.order;
  });

  it('truck1 GET /api/orders/{X} is 404 not_found, identical to a missing id', async () => {
    const { X } = orders();
    const other = await truck1.get(`/api/orders/${X.id}`);
    assertError(other, 404, 'not_found', 'other location');
    assert.equal(other.json.order, undefined);
    assert.ok(!other.text.includes('PKD010'), 'a 404 must not leak order content');

    const missing = await truck1.get('/api/orders/999999');
    assertError(missing, 404, 'not_found', 'missing id');
    assert.deepEqual(other.json, missing.json, 'another location\'s order must look exactly like a missing one');

    for (const bad of ['0', '-1', 'abc']) {
      const res = await truck1.get(`/api/orders/${bad}`);
      assertError(res, 404, 'not_found', `id ${bad}`);
      assert.deepEqual(res.json, missing.json, `id ${bad} body`);
    }
  });

  it('truck1 GET /api/orders/{Y} returns its own order', async () => {
    const { Y } = orders();
    const res = await truck1.get(`/api/orders/${Y.id}`);
    assert.equal(res.status, 200, res.text);
    assertJsonHeaders(res, 'R11');
    assert.equal(res.json.order.id, Y.id);
    assert.equal(res.json.order.location.id, 2);
  });

  for (const path of ['/api/orders', '/api/orders?location_id=4', '/api/orders?location_id=4&location=4']) {
    it(`truck1 GET ${path} lists only location 2's orders`, async () => {
      const { X, Y } = orders();
      const res = await truck1.get(path);
      assert.equal(res.status, 200, res.text);
      assertJsonHeaders(res, path);
      assert.ok(Array.isArray(res.json.orders), 'orders array');
      const ids = res.json.orders.map((o) => o.id);
      assert.ok(ids.includes(Y.id), 'truck1 must see its own order');
      assert.ok(!ids.includes(X.id), 'truck1 must never see truck2\'s order');
      for (const o of res.json.orders) assert.equal(o.location.id, 2, `order ${o.id} location`);
    });
  }

  it('truck2 sees its own order and not truck1\'s', async () => {
    const { X, Y } = orders();
    const list = await truck2.get('/api/orders');
    assert.equal(list.status, 200, list.text);
    const ids = list.json.orders.map((o) => o.id);
    assert.ok(ids.includes(X.id));
    assert.ok(!ids.includes(Y.id));
    assertError(await truck2.get(`/api/orders/${Y.id}`), 404, 'not_found', 'truck2 reading Y');
  });

  it('franchise1 gets 403 on GET /api/orders and GET /api/orders/{id}', async () => {
    const { X } = orders();
    for (const path of ['/api/orders', `/api/orders/${X.id}`]) {
      const res = await franchise1.get(path);
      assertError(res, 403, 'forbidden', `franchise ${path}`);
      assert.equal(res.json.orders, undefined);
      assert.equal(res.json.order, undefined);
    }
  });

  it('hq1 gets 403 on GET /api/orders and GET /api/orders/{id}', async () => {
    const { X } = orders();
    for (const path of ['/api/orders', `/api/orders/${X.id}`]) {
      assertError(await hq1.get(path), 403, 'forbidden', `hq ${path}`);
    }
  });

  it('unauthenticated requests get 401', async () => {
    const { X } = orders();
    const anon = app.client();
    for (const path of ['/api/orders', `/api/orders/${X.id}`, '/api/hq/orders']) {
      assertError(await anon.get(path), 401, 'unauthenticated', `anon ${path}`);
    }
  });

  it('hq1 sees both trucks\' orders in GET /api/hq/orders', async () => {
    const { X, Y } = orders();
    const res = await hq1.get('/api/hq/orders');
    assert.equal(res.status, 200, res.text);
    const ids = res.json.orders.map((o) => o.id);
    assert.ok(ids.includes(X.id), 'hq sees truck2\'s order');
    assert.ok(ids.includes(Y.id), 'hq sees truck1\'s order');
  });
});

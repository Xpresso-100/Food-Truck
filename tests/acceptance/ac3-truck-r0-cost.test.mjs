// AC3 - Truck order lines are R0 and store the cost value. (SPEC sections 2, 4 and 8)
// The SPEC section 6 worked example, black-box through R6, R7, R8, R10 and R11.
// READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { assertMoney, assertOrderShape, assertJsonHeaders } from '../support/contract.mjs';
import { ACTIVE_PRODUCTS, LOCATIONS, WORKED_EXAMPLE, INACTIVE_SKU } from '../support/fixtures.mjs';

function assertWorkedExample(order, label) {
  assertOrderShape(order, label);
  assert.equal(order.status, 'pending', `${label}.status`);
  assert.deepEqual(order.location, LOCATIONS[2], `${label}.location is the session user's location`);
  assert.deepEqual(order.created_by, { id: 2, username: 'truck1' }, `${label}.created_by`);
  assert.equal(order.status_updated_at, null, `${label}.status_updated_at`);
  assert.equal(order.lines.length, WORKED_EXAMPLE.lines.length, `${label}.lines length`);
  WORKED_EXAMPLE.lines.forEach((exp, i) => {
    const line = order.lines[i];
    const l = `${label}.lines[${i}]`;
    assert.equal(line.sku, exp.sku, `${l}.sku (lines keep submitted order)`);
    assert.equal(line.name, exp.name, `${l}.name`);
    assert.equal(line.unit, exp.unit, `${l}.unit`);
    assert.equal(line.qty, exp.qty, `${l}.qty`);
    assertMoney(line.unit_price, 0, `${l}.unit_price`);
    assertMoney(line.line_total, 0, `${l}.line_total`);
    assertMoney(line.unit_cost, exp.unit_cost, `${l}.unit_cost`);
    assertMoney(line.line_cost, exp.line_cost, `${l}.line_cost`);
  });
  assertMoney(order.subtotal, 0, `${label}.subtotal`);
  assertMoney(order.vat_amount, 0, `${label}.vat_amount`);
  assertMoney(order.total, 0, `${label}.total`);
  assertMoney(order.cost_total, WORKED_EXAMPLE.cost_total, `${label}.cost_total`);
}

describe('AC3 truck order lines are R0 and store the cost value', () => {
  let app, truck1, hq1;
  let plain, tampered, withNote;

  before(async () => {
    app = await startApp();
    truck1 = await app.login('truck1');
    hq1 = await app.login('hq1');
  });
  after(async () => { await app?.stop(); });

  it('truck1 posts the worked example: 201 with R0 lines, cost stored, totals 0, cost_total 585.1', async () => {
    const res = await truck1.post('/api/orders', WORKED_EXAMPLE.body);
    assert.equal(res.status, 201, res.text);
    assertJsonHeaders(res, 'R7');
    assertWorkedExample(res.json.order, 'order');
    assert.equal(res.json.order.note, null, 'note is null when absent');
    plain = res.json.order;
  });

  it('posted unit_price, unit_cost, location_id, status and user_id are ignored', async () => {
    const res = await truck1.post('/api/orders', {
      lines: [
        { sku: 'HOT011', qty: 2, unit_price: 99, unit_cost: 1, line_total: 99, line_cost: 1, price: 99 },
        { sku: 'DAI006', qty: 6, unit_price: 99, unit_cost: 1 },
      ],
      location_id: 4,
      location: { id: 4 },
      user_id: 4,
      created_by_user_id: 4,
      status: 'delivered',
      unit_price: 99,
      unit_cost: 1,
      price: 99,
      subtotal: 99,
      total: 99,
      cost_total: 1,
    });
    assert.equal(res.status, 201, res.text);
    assertWorkedExample(res.json.order, 'tampered');
    tampered = res.json.order;
  });

  it('a note is stored and returned', async () => {
    const res = await truck1.post('/api/orders', { ...WORKED_EXAMPLE.body, note: 'for Friday' });
    assert.equal(res.status, 201, res.text);
    assertWorkedExample(res.json.order, 'withNote');
    assert.equal(res.json.order.note, 'for Friday');
    withNote = res.json.order;
  });

  it('re-reading through R11 returns the same values', async () => {
    assert.ok(plain && tampered && withNote, 'precondition: R7 must succeed');
    for (const created of [plain, tampered, withNote]) {
      const res = await truck1.get(`/api/orders/${created.id}`);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json.order, created, `R11 order ${created.id}`);
    }
  });

  it('re-reading through R10 returns the same values', async () => {
    assert.ok(plain && tampered && withNote, 'precondition: R7 must succeed');
    const res = await truck1.get('/api/orders');
    assert.equal(res.status, 200, res.text);
    for (const created of [plain, tampered, withNote]) {
      assert.deepEqual(res.json.orders.find((o) => o.id === created.id), created, `R10 order ${created.id}`);
    }
  });

  it('re-reading through R8 (HQ) returns the same values', async () => {
    assert.ok(plain && tampered && withNote, 'precondition: R7 must succeed');
    const res = await hq1.get('/api/hq/orders');
    assert.equal(res.status, 200, res.text);
    for (const created of [plain, tampered, withNote]) {
      assert.deepEqual(res.json.orders.find((o) => o.id === created.id), created, `R8 order ${created.id}`);
    }
  });

  for (const who of ['truck1', 'hq1']) {
    it(`R6 GET /api/products as ${who}: unit_price 0 and unit_cost = cost price`, async () => {
      const client = who === 'truck1' ? truck1 : hq1;
      const res = await client.get('/api/products');
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json.items.map((i) => i.sku), ACTIVE_PRODUCTS.map((p) => p.sku), 'active products, category then sku');
      assert.ok(!res.json.items.some((i) => i.sku === INACTIVE_SKU), 'inactive product hidden');
      for (const item of res.json.items) {
        const p = ACTIVE_PRODUCTS.find((x) => x.sku === item.sku);
        assert.equal(item.name, p.name);
        assert.equal(item.category, p.category);
        assert.equal(item.unit, p.unit);
        assert.equal(item.moq, p.moq);
        assertMoney(item.unit_price, 0, `${item.sku}.unit_price`);
        assertMoney(item.unit_cost, p.cost, `${item.sku}.unit_cost`);
      }
    });
  }
});

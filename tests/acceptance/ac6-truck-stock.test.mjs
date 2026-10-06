// AC6 - Locked rule: truck users CAN read FinCon stock, with the same status visibility as
// franchisees. (SPEC R5, section 6 default quantities, section 8)
// Black-box through GET /api/stock with the mock FinCon adapter. READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { assertError, assertJsonHeaders, ISO_8601_OFFSET } from '../support/contract.mjs';
import { ACTIVE_PRODUCTS, ACTIVE_ITEM_NOS, DEFAULT_STATUSES, INACTIVE_SKU, INACTIVE_ITEM_NO } from '../support/fixtures.mjs';

const ITEM_KEYS = ['category', 'name', 'sku', 'status', 'unit'];

/** R5 body shape: source, checked_at, active items sorted by category then sku, exact keys. */
function assertStockBody(res, label) {
  assert.equal(res.status, 200, `${label}: ${res.text}`);
  assertJsonHeaders(res, label);
  assert.ok(['fincon', 'cache', 'unavailable'].includes(res.json.source), `${label} source ${res.json.source}`);
  assert.match(String(res.json.checked_at), ISO_8601_OFFSET, `${label} checked_at`);
  assert.deepEqual(res.json.items.map((i) => i.sku), ACTIVE_PRODUCTS.map((p) => p.sku), `${label}: active products, category then sku`);
  assert.ok(!res.json.items.some((i) => i.sku === INACTIVE_SKU), `${label}: inactive product hidden`);
  for (const item of res.json.items) {
    const p = ACTIVE_PRODUCTS.find((x) => x.sku === item.sku);
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS, `${label}: keys of ${item.sku} (no quantities, no prices)`);
    assert.equal(item.name, p.name);
    assert.equal(item.category, p.category);
    assert.equal(item.unit, p.unit);
  }
}

function statuses(res) {
  return Object.fromEntries(res.json.items.map((i) => [i.sku, i.status]));
}

describe('AC6 truck users can read FinCon stock (default mock quantities)', () => {
  let app, truck1, franchise1, hq1;

  before(async () => {
    app = await startApp();
    truck1 = await app.login('truck1');
    franchise1 = await app.login('franchise1');
    hq1 = await app.login('hq1');
  });
  after(async () => { await app?.stop(); });

  it('truck1 GET /api/stock: 200, source fincon, the SPEC section 6 statuses', async () => {
    const res = await truck1.get('/api/stock');
    assertStockBody(res, 'truck1');
    assert.equal(res.json.source, 'fincon');
    assert.deepEqual(statuses(res), DEFAULT_STATUSES);
  });

  it('only the ItemNos of active products are requested from FinCon', () => {
    const reads = app.finconCalls().filter((c) => c.method === 'GetStockQuantitiesForOpt2');
    assert.ok(reads.length > 0, 'R5 must read FinCon');
    const requested = new Set(reads.flatMap((c) => c.items || []));
    assert.ok(!requested.has(INACTIVE_ITEM_NO), `${INACTIVE_ITEM_NO} belongs to an inactive product and must not be requested`);
    assert.deepEqual([...requested].sort(), [...ACTIVE_ITEM_NOS].sort());
  });

  it('franchise1 and hq1 see the same statuses as the truck', async () => {
    for (const [who, client] of [['franchise1', franchise1], ['hq1', hq1]]) {
      const res = await client.get('/api/stock');
      assertStockBody(res, who);
      assert.deepEqual(statuses(res), DEFAULT_STATUSES, who);
    }
  });

  it('statuses follow the FinCon quantities, re-read on every call', async () => {
    // qty <= 0 out; qty <= 10 low; shared code (CUPLID) never low; not returned or unmapped = in_stock
    app.setFinconStock({ items: { BEANS: 0, MILK2L: 11, CUP250: 10, CUPLID: 0 } });
    let res = await truck1.get('/api/stock');
    assertStockBody(res, 'first quantities');
    assert.deepEqual(statuses(res), {
      DAI006: 'in_stock', HOT011: 'out_of_stock', PKD010: 'low_stock', PKD020: 'out_of_stock', PKD021: 'out_of_stock', SYR001: 'in_stock',
    });

    app.setFinconStock({ items: { BEANS: -2, CUPLID: 3, CUP250: 1 } });
    res = await truck1.get('/api/stock');
    assertStockBody(res, 'second quantities');
    assert.deepEqual(statuses(res), {
      DAI006: 'in_stock', HOT011: 'out_of_stock', PKD010: 'low_stock', PKD020: 'in_stock', PKD021: 'in_stock', SYR001: 'in_stock',
    });

    app.setFinconStock(null);
    res = await truck1.get('/api/stock');
    assert.deepEqual(statuses(res), DEFAULT_STATUSES, 'back to the defaults');
  });

  it('unauthenticated GET /api/stock is 401', async () => {
    assertError(await app.client().get('/api/stock'), 401, 'unauthenticated', 'anon R5');
  });
});

describe('AC6 FinCon unreachable: stock fails open', () => {
  let app, truck1;

  before(async () => {
    app = await startApp({ finconStock: { fail: true } });
    truck1 = await app.login('truck1');
  });
  after(async () => { await app?.stop(); });

  it('{"fail":true} gives 200 with source unavailable and every item in_stock', async () => {
    const res = await truck1.get('/api/stock');
    assertStockBody(res, 'unreachable');
    assert.equal(res.json.source, 'unavailable');
    for (const item of res.json.items) assert.equal(item.status, 'in_stock', `${item.sku} fails open`);
  });
});

describe('R5 stock cache (STOCK_CACHE_TTL_SECONDS=900)', () => {
  let app, truck1;

  before(async () => {
    app = await startApp({ env: { STOCK_CACHE_TTL_SECONDS: '900' } });
    truck1 = await app.login('truck1');
  });
  after(async () => { await app?.stop(); });

  it('a second read within the TTL is served from the cache with no FinCon call', async () => {
    const first = await truck1.get('/api/stock');
    assertStockBody(first, 'first read');
    assert.equal(first.json.source, 'fincon');
    assert.deepEqual(statuses(first), DEFAULT_STATUSES);

    // FinCon now says everything is out of stock; a fresh cache must still answer, unchanged.
    const callsAfterFirst = app.finconCalls().length;
    app.setFinconStock({ items: { BEANS: 0, MILK2L: 0, CUP250: 0, CUPLID: 0 } });
    const second = await truck1.get('/api/stock');
    assertStockBody(second, 'second read');
    assert.equal(second.json.source, 'cache');
    assert.deepEqual(statuses(second), DEFAULT_STATUSES, 'cached statuses');
    assert.equal(app.finconCalls().length, callsAfterFirst, 'no FinCon call while the cache is fresh');
  });
});

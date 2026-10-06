// AC4 - Nothing writes to FinCon. (SPEC sections 6 and 8)
// Dynamic: drive R2, R5, R6, R7, R10, R11, R8 and R9 and read the mock FinCon call log.
// Static: the real adapter calls only three read methods; the interface declares no write.
// READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApp, ROOT } from '../support/harness.mjs';
import { WORKED_EXAMPLE } from '../support/fixtures.mjs';

const READ_METHODS = ['Login', 'GetStockQuantitiesForOpt2', 'Logout'];

/** PHP source without comments, so prose in comments cannot hide or fake a finding. */
function phpCode(path) {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('AC4 nothing writes to FinCon (dynamic)', () => {
  let app, truck1, franchise1, hq1, orderId;

  before(async () => {
    app = await startApp();
    // R2
    truck1 = await app.login('truck1');
    franchise1 = await app.login('franchise1');
    hq1 = await app.login('hq1');
  });
  after(async () => { await app?.stop(); });

  it('R5 reads stock through the FinCon adapter (the call log is not empty)', async () => {
    for (const client of [truck1, franchise1, hq1]) {
      const res = await client.get('/api/stock');
      assert.equal(res.status, 200, res.text);
    }
    const calls = app.finconCalls();
    assert.ok(calls.some((c) => c.method === 'GetStockQuantitiesForOpt2'), 'R5 must read FinCon stock (STOCK_CACHE_TTL_SECONDS=0)');
  });

  it('R6 runs', async () => {
    assert.equal((await truck1.get('/api/products')).status, 200);
    assert.equal((await franchise1.get('/api/products')).status, 200);
  });

  it('R7 POST /api/orders adds zero FinCon log lines', async () => {
    const before = app.finconCalls().length;
    const res = await truck1.post('/api/orders', WORKED_EXAMPLE.body);
    assert.equal(res.status, 201, res.text);
    orderId = res.json.order.id;
    assert.equal(app.finconCalls().length, before, 'placing an order must never touch FinCon');
  });

  it('R10, R11 and R8 run', async () => {
    assert.ok(orderId, 'precondition: R7 must succeed');
    assert.equal((await truck1.get('/api/orders')).status, 200);
    assert.equal((await truck1.get(`/api/orders/${orderId}`)).status, 200);
    assert.equal((await hq1.get('/api/hq/orders')).status, 200);
  });

  it('R9 POST /api/hq/orders/{id}/status adds zero FinCon log lines', async () => {
    assert.ok(orderId, 'precondition: R7 must succeed');
    const before = app.finconCalls().length;
    const res = await hq1.post(`/api/hq/orders/${orderId}/status`, { status: 'in_process' });
    assert.equal(res.status, 200, res.text);
    assert.equal(app.finconCalls().length, before, 'a status change must never touch FinCon');
  });

  it('every logged FinCon call is a read: kind "read" and method Login, GetStockQuantitiesForOpt2 or Logout', () => {
    const calls = app.finconCalls();
    assert.ok(calls.length > 0, 'the FinCon call log must not be empty after R5');
    for (const [i, call] of calls.entries()) {
      assert.equal(call.invalid, undefined, `log line ${i + 1} is not JSON: ${call.invalid}`);
      assert.equal(call.kind, 'read', `log line ${i + 1} kind`);
      assert.ok(READ_METHODS.includes(call.method), `log line ${i + 1} method ${call.method}`);
    }
  });
});

describe('AC4 nothing writes to FinCon (static)', () => {
  it('src/Fincon/TunnelFinconStockReader.php names only the DataSnap methods Login, GetStockQuantitiesForOpt2 and Logout', () => {
    const code = phpCode('src/Fincon/TunnelFinconStockReader.php');
    for (const m of READ_METHODS) assert.ok(code.includes(`'${m}'`) || code.includes(`"${m}"`), `${m} must be named`);

    // Any string literal that looks like a DataSnap method name must be one of the three.
    const literals = [...code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2]);
    const methodLike = /^(Get|Set|Update|Insert|Create|Post|Put|Write|Delete|Save|Add|Login|Logout|Import|Process|Submit|Cancel|Remove|Modify|Edit|Upload|Generate)[A-Za-z0-9]*$/;
    for (const lit of literals.filter((l) => methodLike.test(l))) {
      assert.ok(READ_METHODS.includes(lit), `DataSnap method "${lit}" is not one of ${READ_METHODS.join(', ')}`);
    }

    // No write-verb PascalCase name anywhere in the code (literals, constants, URLs).
    const writeLike = /\b(Set|Update|Insert|Create|Post|Put|Write|Delete|Save|Add|Import|Process|Submit|Cancel|Remove|Modify|Edit|Upload)[A-Z][A-Za-z0-9]*/g;
    assert.deepEqual([...code.matchAll(writeLike)].map((m) => m[0]), [], 'write-like FinCon names found');

    // Every literal DataSnap URL segment FinconAPI/"<Method>" names a read method.
    for (const m of code.matchAll(/FinconAPI\/(?:\\?"|%22)([A-Za-z0-9_]+)/g)) {
      assert.ok(READ_METHODS.includes(m[1]), `URL method ${m[1]}`);
    }
  });

  it('the FinconStockReader interface declares no set/update/insert/create/post/write/delete/save method', () => {
    const code = phpCode('src/Fincon/FinconStockReader.php');
    assert.match(code, /\binterface\s+FinconStockReader\b/);
    const methods = [...code.matchAll(/\bfunction\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
    assert.ok(methods.length > 0, 'the interface declares a read method');
    for (const name of methods) {
      assert.ok(!/^(set|update|insert|create|post|write|delete|save)/i.test(name), `write-like method ${name}`);
    }
  });
});

// Supporting checks (SPEC 4.1): routing, error envelope, headers, the api.php?route= fallback.
// READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { assertError, assertJsonHeaders } from '../support/contract.mjs';

describe('API conventions', () => {
  let app, truck1;

  before(async () => {
    app = await startApp();
    truck1 = await app.login('truck1');
  });
  after(async () => { await app?.stop(); });

  it('an unknown API path is 404 not_found with the error envelope', async () => {
    for (const path of ['/api/nope', '/api/orders/1/extra', '/api/hq']) {
      assertError(await truck1.get(path), 404, 'not_found', path);
    }
  });

  it('a known path with the wrong method is 405 method_not_allowed', async () => {
    assertError(await app.client().get('/api/login'), 405, 'method_not_allowed', 'GET /api/login');
    assertError(await app.client().post('/api/health', {}), 405, 'method_not_allowed', 'POST /api/health');
    assertError(await truck1.request('DELETE', '/api/orders'), 405, 'method_not_allowed', 'DELETE /api/orders');
    assertError(await truck1.request('PUT', '/api/orders/1'), 405, 'method_not_allowed', 'PUT /api/orders/1');
  });

  it('/api.php?route=/<path> is the same route as /api/<path>', async () => {
    const a = await app.client().get('/api/health');
    const b = await app.client().get('/api.php?route=/health');
    assert.equal(b.status, a.status);
    assert.deepEqual(b.json, a.json);
    assertJsonHeaders(b, 'fallback health');

    const me1 = await truck1.get('/api/me');
    const me2 = await truck1.get('/api.php?route=/me');
    assert.equal(me2.status, 200, me2.text);
    assert.deepEqual(me2.json, me1.json);
  });

  it('module routes answer with JSON headers', async () => {
    for (const path of ['/api/stock', '/api/products', '/api/orders']) {
      const res = await truck1.get(path);
      assert.equal(res.status, 200, `${path}: ${res.text}`);
      assertJsonHeaders(res, path);
    }
  });

  it('dotfiles and server-side files are not served', async () => {
    for (const path of ['/.htaccess', '/router.php']) {
      const res = await app.client().get(path);
      assert.equal(res.status, 404, `${path} must not be served`);
    }
  });
});

// Supporting checks (SPEC section 8): login, session cookie, logout, roles from the session.
// Black-box through R2, R3, R4. READ-ONLY except for node G1.
// Passwords come from the test fixtures only (tests/support/fixtures.mjs).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, parseSetCookie } from '../support/harness.mjs';
import { assertError, assertJsonHeaders, allKeys } from '../support/contract.mjs';
import { LOCATIONS, PASSWORDS, USERS } from '../support/fixtures.mjs';

const EMPTY = '';
const WRONG = `${PASSWORDS.truck1}-wrong`;
const PLANTED_SESSION_ID = `planted${'0'.repeat(26)}`;

function sessionCookie(res) {
  const all = res.setCookies.map(parseSetCookie).filter((c) => c.name === 'TRUCKSESSID');
  return all[all.length - 1];
}

describe('login, session and roles', () => {
  let app;

  before(async () => { app = await startApp(); });
  after(async () => { await app?.stop(); });

  for (const username of ['truck1', 'truck2', 'franchise1', 'hq1']) {
    it(`${username} logs in: 200 user object, role = location type, no password data`, async () => {
      const c = app.client();
      const res = await c.post('/api/login', { username, password: PASSWORDS[username] });
      assert.equal(res.status, 200, res.text);
      assertJsonHeaders(res, 'login');
      const u = USERS[username];
      assert.deepEqual(res.json.user, { id: u.id, username, role: u.role, location: LOCATIONS[u.location] });
      assert.ok(!allKeys(res.json).some(({ key }) => /password/i.test(key)), 'no password field');

      const me = await c.get('/api/me');
      assert.equal(me.status, 200, me.text);
      assertJsonHeaders(me, 'me');
      assert.deepEqual(me.json.user, res.json.user);
    });
  }

  it('the session cookie is TRUCKSESSID, HttpOnly, SameSite=Strict, Path=/, 8 hours', async () => {
    const res = await app.client().post('/api/login', { username: 'truck1', password: PASSWORDS.truck1 });
    assert.equal(res.status, 200, res.text);
    const c = sessionCookie(res);
    assert.ok(c && c.value, 'Set-Cookie TRUCKSESSID');
    assert.equal(c.attrs.httponly, true, 'HttpOnly');
    assert.equal(String(c.attrs.samesite).toLowerCase(), 'strict', 'SameSite=Strict');
    assert.equal(c.attrs.path, '/', 'Path=/');
    if (c.attrs['max-age'] !== undefined) {
      assert.equal(Number(c.attrs['max-age']), 28800, 'Max-Age 8h');
    } else {
      const ms = Date.parse(c.attrs.expires) - Date.now();
      assert.ok(Math.abs(ms - 28800 * 1000) < 120000, 'Expires about 8h from now');
    }
  });

  it('the session id is regenerated on login (no fixation)', async () => {
    const c = app.client();
    c.cookies.set('TRUCKSESSID', PLANTED_SESSION_ID);
    const first = await c.post('/api/login', { username: 'truck1', password: PASSWORDS.truck1 });
    assert.equal(first.status, 200, first.text);
    const id1 = sessionCookie(first)?.value;
    assert.ok(id1 && id1 !== PLANTED_SESSION_ID, 'a server-issued id replaces the planted one');
    const second = await c.post('/api/login', { username: 'truck1', password: PASSWORDS.truck1 });
    assert.equal(second.status, 200, second.text);
    const id2 = sessionCookie(second)?.value;
    assert.ok(id2 && id2 !== id1, 'logging in again issues a new id');
  });

  it('wrong password, unknown user and inactive user all give the identical 401 invalid_credentials', async () => {
    const attempts = [
      { username: 'truck1', password: WRONG },
      { username: 'nobody', password: PASSWORDS.truck1 },
      { username: 'truck_off', password: PASSWORDS.truck_off },
    ];
    const bodies = [];
    for (const body of attempts) {
      const c = app.client();
      const res = await c.post('/api/login', body);
      assertError(res, 401, 'invalid_credentials', `login ${body.username}`);
      assertError(await c.get('/api/me'), 401, 'unauthenticated', `no session after failed login ${body.username}`);
      bodies.push(res.json);
    }
    assert.deepEqual(bodies[1], bodies[0]);
    assert.deepEqual(bodies[2], bodies[0]);
  });

  it('missing, empty or non-string username or password gives 422 validation_failed', async () => {
    const c = app.client();
    for (const body of [
      {}, { username: 'truck1' }, { password: PASSWORDS.truck1 },
      { username: EMPTY, password: PASSWORDS.truck1 }, { username: 'truck1', password: EMPTY },
      { username: 12, password: PASSWORDS.truck1 }, { username: 'truck1', password: [PASSWORDS.truck1] },
    ]) {
      assertError(await c.post('/api/login', body), 422, 'validation_failed', `login ${Object.keys(body).join('+') || 'empty body'}`);
    }
    assertError(await c.postRaw('/api/login', '{"username":'), 422, 'validation_failed', 'malformed JSON');
    assertError(await c.postRaw('/api/login', '["truck1"]'), 422, 'validation_failed', 'JSON array body');
  });

  it('login with a non-JSON content type gives 415', async () => {
    const body = JSON.stringify({ username: 'truck1', password: PASSWORDS.truck1 });
    const res = await app.client().postRaw('/api/login', body, 'application/x-www-form-urlencoded');
    assertError(res, 415, 'unsupported_media_type', 'login form-encoded');
  });

  it('role and location in the login body never change identity', async () => {
    const c = app.client();
    const res = await c.post('/api/login', { username: 'truck1', password: PASSWORDS.truck1, role: 'hq', location_id: 1, user_id: 1 });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.role, 'truck');
    assert.equal(res.json.user.location.id, 2);
    assertError(await c.get('/api/hq/orders'), 403, 'forbidden', 'truck cannot use hq routes');
  });

  it('GET /api/me without a session is 401 unauthenticated', async () => {
    assertError(await app.client().get('/api/me'), 401, 'unauthenticated', 'anon me');
  });

  it('logout returns 204 with an empty body, and /api/me is then 401', async () => {
    const c = await app.login('truck1');
    const stale = c.cookieHeader();
    const out = await c.post('/api/logout');
    assert.equal(out.status, 204, out.text);
    assert.equal(out.text, EMPTY);
    assertError(await c.get('/api/me'), 401, 'unauthenticated', 'after logout');
    // The old cookie value is dead on the server too.
    assertError(await app.client().get('/api/me', { headers: { Cookie: stale } }), 401, 'unauthenticated', 'replayed cookie');
  });

  it('logout without a session is still 204', async () => {
    const res = await app.client().post('/api/logout');
    assert.equal(res.status, 204, res.text);
  });
});

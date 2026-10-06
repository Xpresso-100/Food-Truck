// AC7 - E2E smoke flow (SPEC section 8): truck user logs in on a phone-sized viewport -> views stock
// -> places an order -> sees it in order history.
// Part 1 drives the real app through its public HTTP API. Part 2 drives the real pages in a headless
// Chromium-family browser at 375x667 (skipped, with a reason, when no browser is installed).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../support/harness.mjs';
import { PASSWORDS, ACTIVE_PRODUCTS, DEFAULT_STATUSES, WORKED_EXAMPLE } from '../support/fixtures.mjs';
import { findBrowser, launchBrowser } from './support/browser.mjs';

const PHONE = { width: 375, height: 667 };
const close = (a, b) => Math.abs(a - b) < 0.005;

describe('AC7 E2E smoke - truck flow through the HTTP API', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { if (app) await app.stop(); });

  it('logs in, views stock, places an R0 order with cost, and finds it in its own history only', async () => {
    const truck = await app.login('truck1');

    const me = await truck.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.role, 'truck');
    assert.equal(me.json.user.location.type, 'truck');

    const stock = await truck.get('/api/stock');
    assert.equal(stock.status, 200);
    assert.equal(stock.json.source, 'fincon');
    assert.deepEqual(stock.json.items.map((i) => i.sku), ACTIVE_PRODUCTS.map((p) => p.sku));
    for (const item of stock.json.items) assert.equal(item.status, DEFAULT_STATUSES[item.sku], item.sku);

    const products = await truck.get('/api/products');
    assert.equal(products.status, 200);
    for (const p of products.json.items) {
      assert.equal(p.unit_price, 0, `${p.sku} truck price is R0`);
      assert.ok(close(p.unit_cost, ACTIVE_PRODUCTS.find((a) => a.sku === p.sku).cost), `${p.sku} cost`);
    }

    const finconBefore = app.finconCalls().length;
    const placed = await truck.post('/api/orders', { ...WORKED_EXAMPLE.body, note: 'e2e smoke' });
    assert.equal(placed.status, 201, placed.text);
    assert.equal(app.finconCalls().length, finconBefore, 'placing an order makes no FinCon call');
    const order = placed.json.order;
    assert.equal(order.status, 'pending');
    assert.equal(order.location.id, me.json.user.location.id);
    assert.equal(order.total, 0);
    assert.ok(close(order.cost_total, WORKED_EXAMPLE.cost_total));
    for (const [i, line] of order.lines.entries()) {
      assert.equal(line.unit_price, 0);
      assert.equal(line.line_total, 0);
      assert.ok(close(line.unit_cost, WORKED_EXAMPLE.lines[i].unit_cost), `${line.sku} unit_cost`);
      assert.ok(close(line.line_cost, WORKED_EXAMPLE.lines[i].line_cost), `${line.sku} line_cost`);
    }

    const history = await truck.get('/api/orders');
    assert.equal(history.status, 200);
    assert.equal(history.json.orders[0].id, order.id, 'the new order is first in history');
    assert.deepEqual(history.json.orders[0], order);

    const one = await truck.get(`/api/orders/${order.id}`);
    assert.equal(one.status, 200);
    assert.deepEqual(one.json.order, order);

    // Another truck cannot see it.
    const other = await app.login('truck2');
    assert.equal((await other.get(`/api/orders/${order.id}`)).status, 404);
    assert.ok(!(await other.get('/api/orders')).json.orders.some((o) => o.id === order.id));

    // HQ sees it in the inbox (SPEC 5).
    const hq = await app.login('hq1');
    const inbox = await hq.get('/api/hq/orders?status=pending');
    assert.equal(inbox.status, 200);
    assert.ok(inbox.json.orders.some((o) => o.id === order.id), 'HQ inbox lists the truck order');
  });
});

const browserBin = findBrowser();

describe('AC7 E2E smoke - truck flow in a headless browser at 375x667', { skip: browserBin ? false : 'no Chromium-family browser installed (set E2E_BROWSER to a chrome/msedge path)' }, () => {
  let app;
  let page;
  before(async () => {
    app = await startApp();
    page = await launchBrowser(browserBin);
    await page.setPhoneViewport(PHONE.width, PHONE.height);
  });
  after(async () => {
    if (page) await page.closeBrowser();
    if (app) await app.stop();
  });

  const path = () => page.evaluate('location.pathname');
  const waitForPath = (p) => page.waitFor(`location.pathname === ${JSON.stringify(p)} && document.readyState === "complete"`, { what: `page ${p}` });
  const assertFitsPhone = async (label) => {
    assert.equal(await page.evaluate('window.innerWidth'), PHONE.width, `${label}: viewport is phone width`);
    const sw = await page.scrollWidth();
    assert.ok(sw <= PHONE.width, `${label}: scrollWidth ${sw} > ${PHONE.width} (horizontal scroll at phone width)`);
  };

  it('logs in, views stock, places an order and sees it in history; every page fits 375px', { timeout: 120000 }, async () => {
    // A logged-out visit to the stock page goes to the login page.
    await page.goto(`${app.baseUrl}/stock.html`);
    await waitForPath('/');
    await page.waitFor('document.querySelector("form#login-form")');
    await assertFitsPhone('/');

    // Wrong password shows an error and stays on the login page.
    await page.type('#username', 'truck1');
    await page.type('#password', 'not-the-password');
    await page.click('#login-submit');
    await page.waitFor('document.querySelector("#login-error").textContent.trim() !== ""', { what: '#login-error text' });
    assert.equal(await path(), '/');

    // Log in as the truck user.
    await page.type('#password', PASSWORDS.truck1);
    await page.click('#login-submit');
    await waitForPath('/stock.html');

    // View stock: every active product, with its FinCon status.
    await page.waitFor(`document.querySelectorAll("#stock-list [data-sku]").length === ${ACTIVE_PRODUCTS.length}`, { what: 'stock cards' });
    const statuses = await page.evaluate(`Object.fromEntries([...document.querySelectorAll("#stock-list [data-sku]")]
      .map((n) => [n.dataset.sku, n.querySelector("[data-status]") && n.querySelector("[data-status]").dataset.status]))`);
    assert.deepEqual(statuses, DEFAULT_STATUSES);
    assert.equal(await page.evaluate('document.querySelectorAll("input[data-qty-for]").length'), ACTIVE_PRODUCTS.length, 'a qty input per product');
    assert.equal(await page.evaluate('document.querySelector("a#nav-history").getAttribute("href")'), '/history.html');
    await assertFitsPhone('/stock.html');

    // Place an order: the SPEC section 6 worked example.
    for (const line of WORKED_EXAMPLE.body.lines) await page.type(`input[data-qty-for="${line.sku}"]`, String(line.qty));
    await page.click('#place-order');
    const orderId = Number(await page.waitFor(
      '(() => { const c = document.querySelector("#order-confirmation"); return c && !c.hidden && c.dataset.orderId; })()',
      { what: '#order-confirmation[data-order-id]' },
    ));
    assert.ok(Number.isInteger(orderId) && orderId > 0, `order id ${orderId}`);
    const confirmation = await page.evaluate('document.querySelector("#order-confirmation").textContent');
    assert.match(confirmation, /R585\.10/, 'confirmation shows the cost total');
    assert.equal(await page.evaluate('[...document.querySelectorAll("input[data-qty-for]")].every((i) => i.value === "")'), true, 'form cleared');
    await assertFitsPhone('/stock.html after order');

    // The server stored it as an R0 order with the cost snapshot.
    const api = await app.login('truck1');
    const stored = (await api.get(`/api/orders/${orderId}`)).json.order;
    assert.equal(stored.total, 0);
    assert.ok(close(stored.cost_total, WORKED_EXAMPLE.cost_total));
    // The page submits lines in on-screen order (category, sku), so compare by sku.
    const bySku = (a, b) => a[0].localeCompare(b[0]);
    assert.deepEqual(stored.lines.map((l) => [l.sku, l.qty, l.unit_price]).sort(bySku),
      WORKED_EXAMPLE.lines.map((l) => [l.sku, l.qty, 0]).sort(bySku));

    // See it in order history.
    await page.click('a#nav-history');
    await waitForPath('/history.html');
    const card = `#history-list [data-order-id="${orderId}"]`;
    await page.waitFor(`document.querySelector(${JSON.stringify(card)})`, { what: card });
    const cardInfo = await page.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(card)});
      return { text: n.innerText, status: n.querySelector("[data-status]") && n.querySelector("[data-status]").dataset.status,
               first: document.querySelector("#history-list [data-order-id]").dataset.orderId }; })()`);
    assert.equal(cardInfo.status, 'pending');
    assert.equal(Number(cardInfo.first), orderId, 'newest order first');
    assert.match(cardInfo.text, /2 lines/, 'shows the line count');
    assert.match(cardInfo.text, /R585\.10/, 'shows the cost total');
    assert.match(cardInfo.text, /\d{4}/, 'shows the created date');
    await assertFitsPhone('/history.html');

    // Back to stock, then sign out.
    await page.click('a#nav-stock');
    await waitForPath('/stock.html');
    await page.click('button#logout');
    await waitForPath('/');
    assert.equal((await page.evaluate('fetch("/api/me").then((r) => r.status)')), 401, 'signed out');

    // HQ sees the truck order on its own page, which also fits a phone.
    await page.type('#username', 'hq1');
    await page.type('#password', PASSWORDS.hq1);
    await page.click('#login-submit');
    await waitForPath('/hq.html');
    const hqButton = `#hq-orders [data-order-id="${orderId}"] button[data-next-status]`;
    await page.waitFor(`document.querySelector(${JSON.stringify(hqButton)})`, { what: hqButton });
    await assertFitsPhone('/hq.html');

    assert.deepEqual(page.errors, [], 'no uncaught JavaScript errors on any page');
  });
});

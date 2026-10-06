// Assertions on the public HTTP contract (SPEC section 4). Shared, frozen after G1.

import assert from 'node:assert/strict';

export const ISO_8601_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Money is a JSON number with at most 2 decimals; compare numerically. */
export function assertMoney(actual, expected, label) {
  assert.equal(typeof actual, 'number', `${label} must be a JSON number, got ${JSON.stringify(actual)}`);
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label} expected ${expected}, got ${actual}`);
  assert.ok(Math.abs(Math.round(actual * 100) - actual * 100) < 1e-6, `${label} has more than 2 decimals: ${actual}`);
}

/** SPEC 4.1 headers on every API response except 204. */
export function assertJsonHeaders(res, label = '') {
  assert.match(res.headers.get('content-type') || '', /^application\/json;\s*charset=utf-8$/i, `${label} Content-Type`);
  assert.match(res.headers.get('cache-control') || '', /no-store/i, `${label} Cache-Control`);
}

/** SPEC 4.1 error envelope with the expected status and code. */
export function assertError(res, status, code, label = '') {
  assert.equal(res.status, status, `${label} expected HTTP ${status}, got ${res.status}: ${res.text}`);
  assertJsonHeaders(res, label);
  assert.ok(res.json && typeof res.json.error === 'object' && res.json.error !== null, `${label} error envelope missing: ${res.text}`);
  assert.equal(res.json.error.code, code, `${label} error.code`);
  assert.equal(typeof res.json.error.message, 'string', `${label} error.message`);
}

/** Walk any JSON value. visit(key, value, path) is called for every object property and array item. */
export function walk(value, visit, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((v, i) => { visit(String(i), v, `${path}[${i}]`); walk(v, visit, `${path}[${i}]`); });
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { visit(k, v, `${path}.${k}`); walk(v, visit, `${path}.${k}`); }
  }
}

/** Every object key anywhere in a JSON value, with its path. */
export function allKeys(value) {
  const out = [];
  walk(value, (k, _v, p) => { if (!/^\d+$/.test(k) || !p.endsWith(']')) out.push({ key: k, path: p }); });
  return out;
}

/** Every number anywhere in a JSON value (numeric strings included), with its path. */
export function allNumbers(value) {
  const out = [];
  const check = (v, p) => {
    if (typeof v === 'number') out.push({ value: v, path: p });
    else if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) out.push({ value: Number(v), path: p });
  };
  check(value, '$');
  walk(value, (_k, v, p) => check(v, p));
  return out;
}

/** SPEC 4.2 order object shape. */
export function assertOrderShape(order, label = 'order') {
  assert.ok(order && typeof order === 'object', `${label} missing`);
  assert.ok(Number.isInteger(order.id) && order.id > 0, `${label}.id`);
  assert.ok(order.location && Number.isInteger(order.location.id), `${label}.location.id`);
  assert.equal(typeof order.location.name, 'string', `${label}.location.name`);
  assert.equal(order.location.type, 'truck', `${label}.location.type`);
  assert.ok(order.created_by && Number.isInteger(order.created_by.id), `${label}.created_by.id`);
  assert.equal(typeof order.created_by.username, 'string', `${label}.created_by.username`);
  assert.ok(['pending', 'in_process', 'out_for_delivery', 'delivered'].includes(order.status), `${label}.status ${order.status}`);
  assert.ok(order.note === null || typeof order.note === 'string', `${label}.note`);
  assert.match(String(order.created_at), ISO_8601_OFFSET, `${label}.created_at`);
  assert.ok(order.status_updated_at === null || ISO_8601_OFFSET.test(order.status_updated_at), `${label}.status_updated_at`);
  for (const k of ['subtotal', 'vat_amount', 'total']) assertMoney(order[k], 0, `${label}.${k}`);
  assert.equal(typeof order.cost_total, 'number', `${label}.cost_total`);
  assert.ok(Array.isArray(order.lines) && order.lines.length > 0, `${label}.lines`);
  let sum = 0;
  order.lines.forEach((l, i) => {
    const ll = `${label}.lines[${i}]`;
    for (const k of ['sku', 'name', 'unit']) assert.equal(typeof l[k], 'string', `${ll}.${k}`);
    assert.ok(Number.isInteger(l.qty) && l.qty >= 1, `${ll}.qty`);
    assertMoney(l.unit_price, 0, `${ll}.unit_price`);
    assertMoney(l.line_total, 0, `${ll}.line_total`);
    assert.equal(typeof l.unit_cost, 'number', `${ll}.unit_cost`);
    assertMoney(l.line_cost, Math.round(l.qty * l.unit_cost * 100) / 100, `${ll}.line_cost`);
    sum += Math.round(l.line_cost * 100);
  });
  assertMoney(order.cost_total, sum / 100, `${label}.cost_total`);
}

// Smoke: the app starts and the scaffold works (feature S01). Shared, frozen after G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { startApp, runPhp, harnessEnv, ROOT } from '../support/harness.mjs';
import { assertJsonHeaders } from '../support/contract.mjs';

function phpFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...phpFiles(p));
    else if (entry.name.endsWith('.php')) out.push(p);
  }
  return out;
}

describe('smoke: the app starts', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app?.stop(); });

  it('GET /api/health returns 200 {"ok":true} with JSON headers', async () => {
    const res = await app.client().get('/api/health');
    assert.equal(res.status, 200, res.text);
    assertJsonHeaders(res, 'health');
    assert.deepEqual(res.json, { ok: true });
  });

  it('migrate is idempotent', () => {
    const r = app.php(['bin/migrate.php']);
    assert.equal(r.status, 0, r.stderr);
  });

  it('every PHP file passes php -l', () => {
    const files = ['src', 'public', 'bin'].flatMap((d) => phpFiles(join(ROOT, d)));
    assert.ok(files.length > 0);
    // PHP 8.3+ lints many files in one process; older versions get one process per file.
    const version = Number(runPhp(['-r', 'echo PHP_VERSION_ID;'], process.env).stdout);
    const batches = version >= 80300 ? [files] : files.map((f) => [f]);
    for (const batch of batches) {
      const r = runPhp(['-l', ...batch], process.env);
      assert.equal(r.status, 0, `${batch.map((f) => relative(ROOT, f)).join(', ')}: ${r.stdout}${r.stderr}`);
    }
  });
});

describe('smoke: seed refuses in production', () => {
  let tmpDir;
  before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'truck-seed-')); });
  after(() => { rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

  it('php bin/seed.php test exits 1 and writes nothing when APP_ENV=production', () => {
    const env = harnessEnv(tmpDir);
    assert.equal(runPhp(['bin/migrate.php'], env).status, 0);
    const refused = runPhp(['bin/seed.php', 'test'], { ...env, APP_ENV: 'production' });
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    const count = runPhp(['-r', `$p = new PDO(getenv('DB_DSN'));
      echo $p->query('SELECT (SELECT COUNT(*) FROM locations) + (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM products)')->fetchColumn();`], env);
    assert.equal(count.status, 0, count.stderr);
    assert.equal(count.stdout.trim(), '0');
  });
});

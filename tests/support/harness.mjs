// Test harness (SPEC section 6). Shared, frozen after G1.
// Starts the real app black-box: temp dir -> env -> php bin/migrate.php -> php bin/seed.php test
// -> php -S 127.0.0.1:<free port> -t public public/router.php -> poll GET /api/health.
// Zero npm dependencies: node:test, node:assert and global fetch only.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASSWORDS } from './fixtures.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PHP = process.env.PHP_BIN || 'php';
const REQUEST_TIMEOUT_MS = 20000;

/** Run a PHP CLI script from the repo root. Returns { status, stdout, stderr }. */
export function runPhp(args, env, input) {
  const r = spawnSync(PHP, args, { cwd: ROOT, env, input, encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.error) throw new Error(`could not run ${PHP} ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The SPEC section 6 environment for a temp dir. */
export function harnessEnv(tmpDir, overrides = {}) {
  return {
    ...process.env,
    APP_ENV: 'test',
    DB_DSN: `sqlite:${join(tmpDir, 'app.sqlite')}`,
    DB_USER: '',
    DB_PASS: '',
    SESSION_COOKIE_SECURE: '0',
    SESSION_SAVE_PATH: join(tmpDir, 'sessions'),
    FINCON_ADAPTER: 'mock',
    FINCON_MOCK_STOCK: join(tmpDir, 'fincon-stock.json'),
    FINCON_MOCK_LOG: join(tmpDir, 'fincon-calls.jsonl'),
    STOCK_CACHE_TTL_SECONDS: '0',
    ...overrides,
  };
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start a fresh app (own temp dir, own SQLite DB, own port).
 * options.env        extra or overriding environment variables
 * options.finconStock object written to FINCON_MOCK_STOCK before start (e.g. {fail:true})
 */
export async function startApp(options = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'truck-test-'));
  const env = harnessEnv(tmpDir, options.env || {});
  if (options.finconStock !== undefined) writeFileSync(env.FINCON_MOCK_STOCK, JSON.stringify(options.finconStock));

  for (const args of [['bin/migrate.php'], ['bin/seed.php', 'test']]) {
    const r = runPhp(args, env);
    if (r.status !== 0) {
      throw new Error(`php ${args.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
    }
  }

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(PHP, ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/router.php'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  const keep = (chunk) => { output = (output + chunk.toString()).slice(-8000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = false;
  child.on('exit', () => { exited = true; });

  const deadline = Date.now() + 20000;
  let healthy = false;
  while (Date.now() < deadline && !exited) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      await res.text();
      if (res.status === 200) { healthy = true; break; }
    } catch { /* not up yet */ }
    await sleep(100);
  }
  if (!healthy) {
    child.kill();
    throw new Error(`app did not become healthy on ${baseUrl} (exited=${exited})\n${output}`);
  }

  const app = {
    baseUrl,
    tmpDir,
    env,
    get serverOutput() { return output; },
    /** A new client with an empty cookie jar. */
    client() { return new Client(baseUrl); },
    /** A client logged in as `username` (fixture password unless given). Throws unless login is 200. */
    async login(username, password = PASSWORDS[username]) {
      const c = new Client(baseUrl);
      const res = await c.post('/api/login', { username, password });
      if (res.status !== 200) throw new Error(`login ${username} expected 200, got ${res.status}: ${res.text}`);
      return c;
    },
    /** Write the mock FinCon stock source; null removes it (back to the default quantities). */
    setFinconStock(obj) {
      if (obj === null) rmSync(env.FINCON_MOCK_STOCK, { force: true });
      else writeFileSync(env.FINCON_MOCK_STOCK, JSON.stringify(obj));
    },
    /** Every mock FinCon call so far, parsed. A line that is not JSON comes back as {invalid: line}. */
    finconCalls() {
      if (!existsSync(env.FINCON_MOCK_LOG)) return [];
      return readFileSync(env.FINCON_MOCK_LOG, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => {
        try { return JSON.parse(l); } catch { return { invalid: l }; }
      });
    },
    /** Run a PHP CLI script against this app's database. */
    php(args, input) { return runPhp(args, env, input); },
    async stop() {
      if (!exited) {
        const done = new Promise((r) => child.once('exit', r));
        child.kill();
        await Promise.race([done, sleep(3000)]);
      }
      try { rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
    },
  };
  return app;
}

/** Minimal HTTP client with a cookie jar. */
export class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /**
   * opts.json        value sent as a JSON body with Content-Type application/json
   * opts.body        raw string body (sent as is)
   * opts.contentType Content-Type for a raw body (or to override the JSON one)
   * opts.headers     extra headers
   * Returns { status, headers, text, json, setCookies }.
   */
  async request(method, path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    let body;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers['Content-Type'] = opts.contentType || 'application/json';
    } else if (opts.body !== undefined) {
      body = opts.body;
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
    }
    const cookie = this.cookieHeader();
    if (cookie && !headers.Cookie) headers.Cookie = cookie;
    const res = await fetch(this.baseUrl + path, {
      method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    const setCookies = res.headers.getSetCookie();
    for (const sc of setCookies) {
      const c = parseSetCookie(sc);
      const expired = c.attrs['max-age'] === '0' || (c.attrs.expires && Date.parse(c.attrs.expires) < Date.now());
      if (expired || c.value === '') this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    let json;
    try { json = text === '' ? undefined : JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, headers: res.headers, text, json, setCookies };
  }

  get(path, opts) { return this.request('GET', path, opts); }

  post(path, json, opts = {}) {
    return this.request('POST', path, json === undefined ? opts : { ...opts, json });
  }

  /** POST a raw string body, e.g. malformed JSON or 2.0 that JSON.stringify would rewrite. */
  postRaw(path, body, contentType = 'application/json') {
    return this.request('POST', path, { body, contentType });
  }
}

/** Parse one Set-Cookie header: { name, value, attrs } with lower-case attribute names (flags are true). */
export function parseSetCookie(header) {
  const [pair, ...rest] = header.split(';');
  const eq = pair.indexOf('=');
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const attrs = {};
  for (const part of rest) {
    const i = part.indexOf('=');
    if (i === -1) attrs[part.trim().toLowerCase()] = true;
    else attrs[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return { name, value, attrs };
}

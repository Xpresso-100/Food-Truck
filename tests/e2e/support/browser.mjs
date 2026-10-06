// Minimal headless-browser driver for the E2E node. Zero npm dependencies: it speaks the Chrome
// DevTools Protocol over Node's global WebSocket to a Chromium-family browser already on the machine
// (Chrome, Edge, Chromium, or a Playwright-cached chromium). Nothing is downloaded or installed.
// E2E_BROWSER=<path> picks the binary; E2E_BROWSER=none forces the browser tests to skip.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Path of a usable Chromium-family browser, or null when none is installed. */
export function findBrowser() {
  const forced = process.env.E2E_BROWSER;
  if (forced === 'none') return null;
  if (forced) return existsSync(forced) ? forced : null;

  const candidates = [];
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      candidates.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(join(root, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const dir of (process.env.PATH || '').split(':')) {
      for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
        candidates.push(join(dir, name));
      }
    }
  }
  const found = candidates.find((p) => existsSync(p));
  return found || findPlaywrightChromium();
}

function findPlaywrightChromium() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'));
  if (!existsSync(cache)) return null;
  const exe = process.platform === 'win32' ? 'chrome.exe' : 'chrome';
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-win64', 'chrome-win', 'chrome-linux64', 'chrome-linux']) {
      const p = join(cache, d, sub, exe);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Launch the browser headless and return a Page attached to its first tab. */
export async function launchBrowser(binary) {
  const profile = mkdtempSync(join(tmpdir(), 'truck-e2e-browser-'));
  const child = spawn(binary, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    '--disable-background-networking', '--disable-sync', '--metrics-recording-only', '--mute-audio',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => { exited = true; });

  const close = async () => {
    if (!exited) {
      const done = new Promise((r) => child.once('exit', r));
      child.kill();
      await Promise.race([done, sleep(5000)]);
    }
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ }
  };

  try {
    // Chrome writes "<port>\n<browser ws path>" here once DevTools is listening.
    const portFile = join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 20000;
    let port = null;
    while (Date.now() < deadline && !exited) {
      if (existsSync(portFile)) {
        const first = readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
        if (/^\d+$/.test(first)) { port = first; break; }
      }
      await sleep(100);
    }
    if (!port) throw new Error(`browser did not open a DevTools port (exited=${exited}): ${binary}`);

    let target = null;
    while (Date.now() < deadline && !target) {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
      target = list.find((t) => t.type === 'page');
      if (!target) await sleep(100);
    }
    if (!target) throw new Error('browser has no page target');

    const page = await Page.connect(target.webSocketDebuggerUrl);
    page.closeBrowser = async () => { page.disconnect(); await close(); };
    return page;
  } catch (e) {
    await close();
    throw e;
  }
}

/** One browser tab, driven over CDP. */
export class Page {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolveOpen, reject) => {
      ws.addEventListener('open', resolveOpen, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed to open')), { once: true });
    });
    const page = new Page(ws);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    return page;
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    /** Uncaught page exceptions, as text. */
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push((d.exception && d.exception.description) || d.text);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  disconnect() {
    try { this.ws.close(); } catch { /* already closed */ }
  }

  /** Emulate a phone: CSS viewport width x height, touch, mobile meta-viewport handling. */
  async setPhoneViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  async goto(url) {
    const r = await this.send('Page.navigate', { url });
    if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
    await this.waitFor('document.readyState === "complete"');
  }

  /** Evaluate an expression in the page; promises are awaited, the value is returned by value. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`page eval failed: ${(d.exception && d.exception.description) || d.text}\n  in: ${expression}`);
    }
    return r.result.value;
  }

  /** Poll until `expression` is truthy; returns its value. Survives navigations mid-poll. */
  async waitFor(expression, { timeout = 15000, what = expression } = {}) {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const v = await this.evaluate(expression);
        if (v) return v;
        lastError = null;
      } catch (e) {
        lastError = e; // context destroyed by a navigation; retry
      }
      await sleep(100);
    }
    const state = await this.evaluate('location.pathname + " | " + document.body.innerText.slice(0, 400)').catch(() => '?');
    throw new Error(`timed out after ${timeout}ms waiting for: ${what}\n  page: ${state}${lastError ? `\n  last error: ${lastError.message}` : ''}`);
  }

  /** Scroll the element into view and tap/click its centre with real input events. */
  async click(selector) {
    const box = await this.waitFor(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || el.disabled) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`, { what: `visible, enabled ${selector}` });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
  }

  /** Focus a field, clear it, and type text as keyboard input. */
  async type(selector, text) {
    await this.click(selector);
    await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ''; })()`);
    await this.send('Input.insertText', { text });
  }

  /** Horizontal layout width of the current document (SPEC 4.4: must be <= the viewport width). */
  scrollWidth() {
    return this.evaluate('document.documentElement.scrollWidth');
  }
}

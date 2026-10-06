// AC5 - UI usable at phone width. (SPEC 4.4 phone-width rules 1-5, D16)
// Static checks on the pages and CSS exactly as served. The E2E node adds a real-browser
// 375x667 no-horizontal-scroll check. READ-ONLY except for node G1.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { startApp, ROOT } from '../support/harness.mjs';

const PAGES = ['/', '/stock.html', '/history.html', '/hq.html'];
const MAX_PX = 360;

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** width / min-width declarations with a px value over 360 (media query conditions are not declarations). */
function wideDeclarations(css) {
  const found = [];
  for (const m of stripCssComments(css).matchAll(/(^|[{;\s])(min-width|width)\s*:\s*([^;{}]+)/gi)) {
    for (const px of m[3].matchAll(/(-?\d*\.?\d+)px\b/gi)) {
      if (parseFloat(px[1]) > MAX_PX) found.push(`${m[2]}: ${m[3].trim()}`);
    }
  }
  return found;
}

/** True when some rule whose selector names `element` declares min-height >= 44px (or >= 2.75rem/em). */
function hasTapTarget(css, element) {
  for (const rule of stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(`(^|[^\\w-])${element}(?![\\w-])`, 'i').test(rule[1])) continue;
    for (const d of rule[2].matchAll(/min-height\s*:\s*(\d*\.?\d+)(px|rem|em)\b/gi)) {
      const v = parseFloat(d[1]);
      if ((d[2].toLowerCase() === 'px' && v >= 44) || (d[2].toLowerCase() !== 'px' && v >= 2.75)) return true;
    }
  }
  return false;
}

function cssFilesOnDisk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFilesOnDisk(p));
    else if (e.name.toLowerCase().endsWith('.css')) out.push(p);
  }
  return out;
}

describe('AC5 UI usable at phone width', () => {
  let app;
  const pages = {};

  before(async () => {
    app = await startApp();
    const c = app.client();
    for (const page of PAGES) {
      const res = await c.get(page);
      pages[page] = { status: res.status, type: res.headers.get('content-type') || '', html: res.text };
    }
  });
  after(async () => { await app?.stop(); });

  function page(p) {
    assert.equal(pages[p].status, 200, `${p} must be served`);
    return pages[p].html;
  }

  for (const p of PAGES) {
    describe(`page ${p}`, () => {
      it('is served as HTML', () => {
        page(p);
        assert.match(pages[p].type, /text\/html/i);
      });

      it('rule 1: has <meta name="viewport" content="width=device-width, initial-scale=1">', () => {
        const ok = tags(page(p), 'meta').some((t) => {
          const content = (attr(t, 'content') || '').replace(/\s+/g, '').toLowerCase();
          return (attr(t, 'name') || '').toLowerCase() === 'viewport'
            && content.split(',').includes('width=device-width')
            && /(^|,)initial-scale=1(\.0)?(,|$)/.test(content);
        });
        assert.ok(ok, `${p} needs the viewport meta tag`);
      });

      it('rule 2: links /assets/app.css', () => {
        const ok = tags(page(p), 'link').some((t) => /\bstylesheet\b/i.test(attr(t, 'rel') || '')
          && new URL(attr(t, 'href') || '', app.baseUrl + p).pathname === '/assets/app.css');
        assert.ok(ok, `${p} must link /assets/app.css`);
      });

      it('rule 5: uses no <table> element', () => {
        assert.ok(!/<table\b/i.test(page(p)), `${p} must use cards, not tables`);
      });

      it('rule 3: no inline width or min-width over 360px', () => {
        const html = page(p);
        const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
          .concat(tags(html, '[a-z][a-z0-9-]*').map((t) => attr(t, 'style')).filter(Boolean).map((s) => `;${s}`));
        assert.deepEqual(inline.flatMap(wideDeclarations), [], `${p} inline styles`);
      });
    });
  }

  it('rule 3: no CSS served under /assets/ has a width or min-width over 360px', async () => {
    const c = app.client();
    const paths = new Set(['/assets/app.css']);
    for (const p of PAGES) {
      if (pages[p].status !== 200) continue;
      for (const t of tags(pages[p].html, 'link')) {
        if (!/\bstylesheet\b/i.test(attr(t, 'rel') || '')) continue;
        const u = new URL(attr(t, 'href') || '', app.baseUrl + p);
        if (u.origin === app.baseUrl && u.pathname.startsWith('/assets/')) paths.add(u.pathname);
      }
    }
    const assetsDir = join(ROOT, 'public', 'assets');
    for (const f of cssFilesOnDisk(assetsDir)) paths.add('/assets/' + relative(assetsDir, f).split('\\').join('/'));

    for (const path of paths) {
      const res = await c.get(path);
      assert.equal(res.status, 200, `${path} must be served`);
      assert.deepEqual(wideDeclarations(res.text), [], `${path} has width/min-width over ${MAX_PX}px; use max-width`);
    }
  });

  it('rule 4: app.css gives button and input tap targets min-height of at least 44px', async () => {
    const res = await app.client().get('/assets/app.css');
    assert.equal(res.status, 200, '/assets/app.css must be served');
    assert.match(res.headers.get('content-type') || '', /text\/css/i);
    assert.ok(hasTapTarget(res.text, 'button'), 'a rule for button must declare min-height >= 44px');
    assert.ok(hasTapTarget(res.text, 'input'), 'a rule for input must declare min-height >= 44px');
  });
});

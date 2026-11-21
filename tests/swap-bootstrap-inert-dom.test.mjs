import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const runtime = JSON.parse(await readFile(new URL('src/fst-runtime-manifest.json',root),'utf8'));
const origin = 'https://fst-bootstrap.test';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t) {
  const context = await browser.newContext({ viewport: { width: 521, height: 731 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [], modules = new Set(), library = deferred();
  t.after(async () => { library.resolve(); await context.close(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Old embedded WebViews can retain the HTML attribute without providing
    // the reflected HTMLElement.inert property used by modern browsers.
    delete HTMLElement.prototype.inert;
    localStorage.setItem('fstswap_wallet_choice', 'disconnected');
    localStorage.setItem('swap_language', 'en');
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) {
      return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'offline fixture' });
    }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (/\.(?:mjs|js)$/.test(path)) modules.add(path);
    if (path === 'assets/vendor/ethers.umd.min.js' || /^assets\/vendor\/fst-ethers-[A-F0-9]{16}\.js$/.test(path)) await library.promise;
    try {
      const body = await readFile(new URL(path, root));
      const contentType = /\.(?:mjs|js)$/.test(path) ? 'application/javascript' :
        path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' :
        path.endsWith('.json') ? 'application/json' : path.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
      return route.fulfill({ contentType, body });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto(origin + '/#/swap', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const main = document.querySelector('main.fst-swap-card:not([data-fst-initial])');
    return main && Object.hasOwn(main, 'inert') && main.inert === true;
  });
  assert.equal(await page.evaluate(() => 'inert' in HTMLElement.prototype), false);
  assert.equal(await page.locator('main').getAttribute('inert'), '');
  assert.equal(await page.evaluate(() => globalThis.ethers === undefined), true, 'the real transaction library is still loading');
  assert.equal(await page.locator('#swap-currency-input .open-currency-select-button').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  await assert.rejects(page.locator('#swap-currency-input .open-currency-select-button').click({ timeout: 150 }), /Timeout/,
    'the initial server-rendered form remains noninteractive until its library finishes');
  assert.equal(await page.locator('reach-portal').count(), 0);
  library.resolve();
  await page.waitForFunction(() => document.querySelector('main.fst-swap-card')?.inert === false);
  for (const module of ['src/app.js', 'src/swap-view.mjs', 'src/swap-shell.mjs', 'src/swap-official-tpl.mjs']) {
    const published=runtime.files.filter(file=>file.inputs.some(input=>input.split('?')[0]===module));
    assert.ok(published.length>0,`runtime manifest must retain the real ${module}`);
    for(const file of published)assert.ok(modules.has(file.path),`full application startup must load published ${module} from ${file.path}`);
  }
  assert.equal([...modules].filter(module=>module.startsWith('src/')&&!module.startsWith('src/fst-runtime-')).length,0,'HTML must execute its generated runtime, without a second raw-source singleton graph');
  return { page, errors };
}

for (const side of ['input', 'output']) {
  test(`SSR bootstrap without native inert support opens and selects the ${side} token after library load`, async t => {
    const { page, errors } = await fixture(t);
    await page.locator(`#swap-currency-${side} .open-currency-select-button`).click({ timeout: 1200 });
    assert.equal(await page.locator('#token-search-input').isVisible(), true);
    await page.locator('.fst-common-token[aria-label="Select BNB"]').click();
    assert.equal(await page.locator(`#swap-currency-${side} .token-symbol-container`).textContent(), 'BNB');
    assert.equal(await page.locator('reach-portal').count(), 0);
    assert.equal(await page.locator('main').getAttribute('inert'), null);
    assert.deepEqual(errors, []);
  });
}

test('SSR bootstrap without native inert support opens the card wallet dialog after library load', async t => {
  const { page, errors } = await fixture(t);
  await page.locator('#swap-page button').filter({ hasText: /^Connect to a wallet$/ }).click({ timeout: 1200 });
  assert.equal(await page.locator('.fst-wallet-dialog').isVisible(), true);
  assert.equal(await page.locator('.fst-wallet-dialog button[id^="connect-"]').count(), 6);
  assert.equal(await page.locator('main').getAttribute('inert'), null);
  assert.deepEqual(errors, []);
});

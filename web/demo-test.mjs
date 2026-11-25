// A check of the website's "Try thinky" demo, as built by web/build-demo.sh, in a real browser
// (Chromium through Playwright, as dev/ui-tests). The website's build (.github/workflows/pages.yml)
// runs it before publishing, so a demo that doesn't start never goes live.
//   node web/demo-test.mjs [demo folder]     (default web/demo-out)
// Playwright is imported from /opt/npm-tools, as the UI tests do (PLAYWRIGHT changes where);
// CHROME names another Chromium to use instead of Playwright's own.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.argv[2] || new URL('./demo-out', import.meta.url).pathname);
const { chromium } = await import((process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright') + '/index.mjs');

// A small web server for the demo folder, sending each file with the type a browser expects
// (WebAssembly must come as application/wasm, scripts as JavaScript).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIR, rel);
  if (!file.startsWith(DIR)) { res.writeHead(403).end(); return; } // nothing outside the folder
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let fails = 0;
function check(ok, msg) {
  console.log((ok ? '  ok  ' : '  FAIL ') + msg);
  if (!ok) fails++;
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  for (const [name, viewport, touch] of [['laptop', { width: 1280, height: 860 }, false], ['phone', { width: 390, height: 780 }, true]]) {
    console.log(`=== ${name}`);
    const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    // 1. it starts: today's journal with the website's first notes and the sample pages
    await page.goto(BASE);
    const started = await page.waitForSelector('.sheet .outline', { timeout: 30000 }).then(() => true, () => false);
    check(started, 'the demo opens on a journal page');
    const text = started ? await page.locator('.sheet').first().innerText() : '';
    check(text.includes('running in your browser'), "the website's first notes are on today's journal");
    check(started && await page.locator('a, .pl, [data-page]').filter({ hasText: 'Start here' }).count() > 0, 'a link to the "Start here" sample page');

    // 2. a note written is kept when the page is opened again (laptop only: typing on the phone
    //    layout is the same code, and the phone run checks that it starts)
    if (!touch && started) {
      const word = 'demo-check-' + Date.now();
      await page.locator('.outline .blk > .bc').first().click();
      await page.waitForSelector('textarea.ed');
      await page.keyboard.press('End');
      await page.keyboard.type(' ' + word);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500); // (the demo keeps notes a moment after a change)
      await page.reload();
      await page.waitForSelector('.sheet .outline', { timeout: 30000 }).catch(() => {});
      check((await page.locator('.sheet').first().innerText()).includes(word), 'a note written is still there after a reload');
    }

    check(errors.length === 0, 'no errors in the page' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);

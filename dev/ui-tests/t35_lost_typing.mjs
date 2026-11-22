// Typing that couldn't be saved (the file locked, offline…) must not vanish when the app closes or
// is put away: closing the window (lean-close) and hiding it (visibilitychange: Android may then end
// the app) keep a copy in logseq/bak, as closing a side does (t13_tabs_safety); and the save is tried
// again by itself once the file can be written (review claim 1, Nov 22, 2026).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, VAULT, BASE } from './lib.mjs';
import fs from 'node:fs';
const all = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map((f) => d + '/' + f).filter((f) => fs.statSync(f).isFile()) : []);
const kept = (s) => all(VAULT + '/logseq').some((f) => fs.readFileSync(f, 'utf8').includes(s));
const inFile = (s) => fs.readFileSync(VAULT + '/pages/Marta Pell.md', 'utf8').includes(s);
const FAIL = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the file is locked' }) });

const browser = await chromium.launch();
const errors = [];
async function start(tauri) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (tauri) await ctx.addInitScript(() => {
    // the desktop app stand-in: calls go to the dev server, events are kept so the test can send them
    window.__ev = {}; window.__quit = false;
    const win = { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onResized: () => {}, setSize: async () => {} };
    window.__TAURI__ = {
      core: { invoke: async (_c, { cmd, args }) => {
        if (cmd === 'quit') { window.__quit = true; return true; }
        const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
      } },
      event: { listen: async (name, fn) => { window.__ev[name] = fn; return () => {}; } },
      window: { getCurrentWindow: () => win }, app: { getVersion: async () => { throw new Error('test'); } },
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify('calm')); }, VAULT);
  await page.goto(BASE + '/?t=' + Date.now() + '#/page/Marta%20Pell');
  await page.waitForSelector('#main .outline');
  return page;
}
async function typeUnsaved(page, add) {
  await page.route('**/api/save', FAIL);
  await page.locator('#main .outline .blk > .bc', { hasText: 'Wild Yeast' }).first().click({ position: { x: 4, y: 6 } });
  await page.waitForSelector('#main textarea.ed');
  await page.keyboard.press('End');
  await page.keyboard.type(add);
  await sleep(1500); // the save after typing fails ("Could not save …")
}

console.log('closing the window while a save fails: the typing is kept in logseq/bak');
{
  const page = await start(true);
  await typeUnsaved(page, ' LOSTCLOSE');
  check(await page.evaluate(() => typeof window.__ev['lean-close'] === 'function'), 'the close handler is listening');
  await page.evaluate(() => window.__ev['lean-close']({}));
  for (let i = 0; i < 60 && !(await page.evaluate(() => window.__quit)); i++) await sleep(100);
  const quit = await page.evaluate(() => window.__quit);
  check(!inFile('LOSTCLOSE'), '(the page file really has no copy: the save failed)');
  check(quit && kept('LOSTCLOSE'), 'the app quit, with a copy of the unsaved typing in logseq/bak', `quit=${quit} kept=${kept('LOSTCLOSE')}`);
  await page.context().close();
}

console.log('putting the app away (Android) while a save fails: the typing is kept in logseq/bak');
{
  const page = await start(false);
  await typeUnsaved(page, ' LOSTHIDE');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(2000);
  check(!inFile('LOSTHIDE'), '(the page file really has no copy: the save failed)');
  check(kept('LOSTHIDE'), 'hidden with unsaved typing: a copy is in logseq/bak');
  await page.context().close();
}

console.log('a save that failed is tried again by itself, without more typing');
{
  const page = await start(false);
  await typeUnsaved(page, ' RETRIED');
  check(kept('RETRIED') && !inFile('RETRIED'), 'not saved yet, but a copy is already in logseq/bak');
  await page.keyboard.press('Escape');
  await page.unroute('**/api/save'); // the file can be written again
  await sleep(7000); // (the first try again is 5 s after the failure)
  check(inFile('RETRIED'), 'saved by itself once the file could be written');
  await page.context().close();
}

await browser.close();
if (errors.length) console.log('script errors: ' + errors.join(' | '));
process.exit(failures() ? 1 : 0);

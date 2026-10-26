// Shared helpers for the UI tests.
// Run through run.sh, which makes a fresh sample vault and starts the dev server.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
export const DIR = process.env.UI_TEST_DIR || '/tmp/lean-ui-test'; // vault, server log, screenshots
export const VAULT = DIR + '/vault';
export const SHOTS = DIR + '/shots';
export const BASE = process.env.BASE || 'http://127.0.0.1:8766';
fs.mkdirSync(SHOTS, { recursive: true });
export const read = (rel) => fs.readFileSync(VAULT + '/' + rel, 'utf8');
export const write = (rel, t) => fs.writeFileSync(VAULT + '/' + rel, t);
export const exists = (rel) => fs.existsSync(VAULT + '/' + rel);
let fails = 0;
export function check(cond, msg, extra = '') {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.log('  FAIL ' + msg + (extra ? ' :: ' + String(extra).slice(0, 400) : '')); }
}
export const failures = () => fails;
export async function open(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // the dev server sends the app's Content-Security-Policy; report anything it blocks
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
  let t0 = Date.now();
  await page.goto(BASE + '/');
  if (Date.now() - t0 > 3000) console.log('  (slow first load: ' + (Date.now() - t0) + ' ms)');
  await page.evaluate((p) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(p)); }, VAULT);
  await page.goto(BASE + '/?t=' + Date.now() + '#/journals');
  await page.waitForSelector('.sheet .outline');
  return { browser, page, errors };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function go(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await sleep(450);
}
/** Click a block (by text) in the first outline that has it, to edit it. */
export async function editBlock(page, text, where = 'end') {
  const bc = page.locator('.outline .blk > .bc', { hasText: text }).first();
  await bc.click({ position: where === 'start' ? { x: 2, y: 8 } : undefined });
  await page.waitForSelector('textarea.ed');
  if (where === 'end') await page.keyboard.press('End');
}

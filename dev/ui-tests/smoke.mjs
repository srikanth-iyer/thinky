// Smoke test: every view loads without script errors; screenshots for a visual check.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { BASE, VAULT, SHOTS } from './lib.mjs';
const OUT = SHOTS;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(BASE + '/');
await page.evaluate((v) => { localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
await page.goto(BASE + '/?v=1#/journals'); await page.reload();
await page.waitForTimeout(800);
for (const [name, hash] of [['journals', '#/journals'], ['pages', '#/pages'], ['todos', '#/todos'], ['tags', '#/tags'], ['props', '#/props'],
  ['sb', '#/page/Sourdough%20Bread'], ['maths', '#/page/Maths'], ['pictures', '#/page/Pictures'], ['apron', '#/page/APRON'], ['apron-child', '#/page/APRON%2FSpice%20jars'], ['settings', '#/settings']]) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}
console.log(errors.length ? 'script errors:\n' + errors.join('\n') : 'no script errors');
await browser.close();

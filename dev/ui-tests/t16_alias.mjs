// A page's other name (alias::) counts as the page, as in Logseq (asked for Oct 28): typing
// [[SB or #SB (Sourdough Bread has alias:: SB) offers "SB → Sourdough Bread", never "New page: SB";
// the search box neither offers a new page; the alias opens the page; All pages never shows it as
// a page without a file. A name that's nobody's still gets "New page".
import fs from 'node:fs';
import { open, check, failures, sleep, go, editBlock, SHOTS } from './lib.mjs';

const SHOTS32 = process.env.SHOTS32 || SHOTS;
fs.mkdirSync(SHOTS32, { recursive: true });
const { browser, page, errors } = await open();
const ta = page.locator('textarea.ed');
const acItems = () => page.evaluate(() => (document.querySelector('#ac').hidden ? [] : [...document.querySelectorAll('#ac li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim())));

console.log('[[ and # with an alias: the page it names, no “New page”');
await go(page, '#/page/Marta%20Pell');
await editBlock(page, 'Wrote Notes');
await page.keyboard.type(' see [[SB', { delay: 20 });
await sleep(300);
let items = await acItems();
check(items[0] === 'SB → Sourdough Bread', 'typing [[SB offers “SB → Sourdough Bread” first', JSON.stringify(items));
check(!items.some((t) => t.startsWith('New page')), 'and no “New page: SB”', JSON.stringify(items));
await page.screenshot({ path: SHOTS32 + '/alias-after-suggest-laptop.png', clip: await page.evaluate(() => { const a = document.querySelector('#ac').getBoundingClientRect(), t = document.querySelector('textarea.ed').getBoundingClientRect(); const x = Math.max(0, Math.min(a.left, t.left) - 20), y = Math.max(0, Math.min(a.top, t.top) - 20); return { x, y, width: Math.min(innerWidth - x, Math.max(a.right, t.right) - x + 20), height: Math.min(innerHeight - y, Math.max(a.bottom, t.bottom) - y + 20) }; }) });
await page.keyboard.press('Enter');
await sleep(200);
check((await ta.inputValue()).endsWith('see [[SB]]'), 'picking it writes the alias, as typed: [[SB]]', await ta.inputValue());
await page.keyboard.type(' and [[sb', { delay: 20 });
await sleep(300);
items = await acItems();
check(items[0] === 'SB → Sourdough Bread' && !items.some((t) => t.startsWith('New page')), 'in small letters too', JSON.stringify(items));
await page.keyboard.press('Escape');
await sleep(100);
await page.keyboard.type(']] #SB', { delay: 20 });
await sleep(300);
items = await acItems();
check(items[0] === 'SB → Sourdough Bread' && !items.some((t) => t.startsWith('New page')), 'a tag, #SB, the same', JSON.stringify(items));
await page.keyboard.press('Escape');
await sleep(100);
await page.keyboard.type(' [[Zebra crossing', { delay: 15 });
await sleep(300);
items = await acItems();
check(items.some((t) => t === 'New page: Zebra crossing'), 'a name that’s nobody’s still offers “New page”', JSON.stringify(items));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await sleep(1300);

console.log('the link, the search box, the page view');
const link = page.locator('.outline a[data-page="SB"]').first();
check(await link.count() === 1, 'the link shows', await page.locator('.outline').first().innerHTML().then((h) => h.slice(0, 300)));
await link.click();
await sleep(600);
check((await page.locator('.page-title').first().textContent()).includes('Sourdough Bread') && (await page.locator('.outline').first().textContent()).includes('Mix, fold'), 'it opens Sourdough Bread');
await page.keyboard.press('Control+k');
await sleep(250);
await page.locator('#search input').fill('SB');
await sleep(500);
const rows = await page.evaluate(() => [...document.querySelectorAll('#search .results li')].map((l) => [l.className, l.textContent.replace(/\s+/g, ' ').trim()]));
check(rows.some(([c, t]) => c.includes('r-page') && /^SB ?→ Sourdough Bread$/.test(t)), 'the search box: “SB → Sourdough Bread”', JSON.stringify(rows));
check(!rows.some(([c]) => c.includes('r-new')), 'and no “New page: SB”', JSON.stringify(rows));
await page.keyboard.press('Escape');
await go(page, '#/page/SB');
await sleep(300);
check((await page.locator('.page-title').first().textContent()).includes('Sourdough Bread') && (await page.locator('.outline').first().textContent()).includes('Mix, fold'), 'the page view of “SB” is Sourdough Bread, with its notes');
await go(page, '#/pages');
await sleep(500);
const names = await page.locator('.pg-name').allTextContents();
check(names.some((n) => n.trim() === 'Sourdough Bread') && !names.some((n) => n.trim() === 'SB'), 'All pages: Sourdough Bread, never “SB” as a page without a file', JSON.stringify(names.slice(0, 40)));

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

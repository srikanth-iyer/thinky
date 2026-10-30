// A page's History (⋯ → History…): its earlier versions from logseq/bak (Logseq's and this app's
// backups) and the safety copies, newest first, each with when, where it came from and how it differs
// from the page now; one drawn like the page (read-only); "Put this version back" keeps the page's
// text in logseq/bak first, then saves the usual way (merged with a change made elsewhere, or the
// clash screen); refused while a clash waits and for a file that isn't plain text. Laptop, narrow
// window and phone, in every look.
import fs from 'node:fs';
import { open, read, write, check, failures, sleep, go, lookIds, VAULT, SHOTS } from './lib.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** How the list says a time (local): "Today 01:32", "Yesterday 10:00", "Oct 24, 09:15". */
function said(ms) {
  const d = new Date(ms), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 864e5);
  if (ago === 0) return `Today ${hm}`;
  if (ago === 1) return `Yesterday ${hm}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? '' : `, ${d.getFullYear()}`}, ${hm}`;
}
// backup names: Logseq's ("…T01_32_00.000Z.android.md", UTC) and this app's ("…_01_32_00.md", UTC)
const logseqName = (ms, dev) => new Date(ms).toISOString().replace(/:/g, '_') + dev + '.md';
const appName = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '_') + '.md';
const BAK = 'logseq/bak/pages/Marta Pell';
const bakTexts = () => (fs.existsSync(VAULT + '/' + BAK) ? fs.readdirSync(VAULT + '/' + BAK).map((f) => read(BAK + '/' + f)) : []);

const NOW_TEXT = read('pages/Marta Pell.md'); // "- Wrote Notes on Wild Yeast\n"
const PHONE = '- Wrote Notes on Wild Yeast\n- Best loaf at the [[county show]], 1994\n- taught **folding**\n- patient proving\n';
const DESK = '- Wrote notes on wild yeast (2003)\n';
const t0 = Date.now();
const anHourAgo = Math.max(t0 - 3600e3, new Date(new Date(t0).setHours(0, 0, 30, 0)).getTime()); // (still today)
const yday = new Date(t0); yday.setDate(yday.getDate() - 1); yday.setHours(10, 0, 0, 0);
const before = new Date(t0); before.setDate(before.getDate() - 3); before.setHours(9, 15, 0, 0);
fs.mkdirSync(VAULT + '/' + BAK, { recursive: true });
write(`${BAK}/${logseqName(anHourAgo, '.android')}`, PHONE); // three more notes
write(`${BAK}/${logseqName(yday.getTime(), '.Desktop')}`, DESK); // one note changed
write(`${BAK}/${appName(before.getTime() + 60e3)}`, NOW_TEXT); // reads like the page now: not listed
write(`${BAK}/${appName(before.getTime())}`, DESK); // the same as the one above it (once the page's own text is left out): once

const { browser, page, errors } = await open();
const menuItem = async (label) => {
  await page.locator('.title-row [data-a="more"]').click();
  await sleep(150);
  await page.locator('.pop.menu button', { hasText: label }).click();
  await sleep(500);
};
const rows = page.locator('.hist .hv-list [data-k]');
const openHistory = async () => { await menuItem('History…'); await page.waitForFunction(() => document.querySelector('.hist') && !document.querySelector('.hist .hv-wait')); await sleep(150); };

console.log('the ⋯ menu has History…; the list: newest first, when, where from, how it differs');
await go(page, '#/page/Marta%20Pell');
await page.locator('.title-row [data-a="more"]').click();
await sleep(150);
const items = await page.locator('.pop.menu button').allTextContents();
check(items.join('|') === 'Add properties|Rename…|Find on this page|History…|Copy page as text…|Copy link|Open in a new tab|Open to the side|t wWide mode: use the whole width|Print or save as PDF|Delete page…', 'History… after Find on this page', items.join('|'));
await page.keyboard.press('Escape');
await openHistory();
check(await page.locator('.hist').isVisible() && (await page.locator('#hv-title').textContent()) === 'History of “Marta Pell”', 'a panel opens: “History of “Marta Pell””');
const texts = (await rows.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
check(texts.length === 2, 'two earlier versions: the one reading like the page now is left out, two the same in a row show once', JSON.stringify(texts));
check(texts[0] === `${said(anHourAgo)} Backup made by Logseq on your phone 3 more notes`, 'the newest first: when (local time), where from, how it differs', texts[0]);
check(texts[1] === `Yesterday 10:00 Backup made by Logseq on your computer 1 note changed`, '“Yesterday 10:00 · Backup made by Logseq on your computer · 1 note changed”', texts[1]);
check(await page.evaluate(() => document.activeElement?.dataset.k === '0'), 'the keyboard starts on the newest');
await page.keyboard.press('ArrowDown');
check(await page.evaluate(() => document.activeElement?.dataset.k === '1'), '↓ moves along the list');
await page.screenshot({ path: SHOTS + '/history-list.png' });

console.log('one version: drawn like the page, read-only');
await rows.first().click();
await page.waitForSelector('.hist .hv-page .outline');
await sleep(200);
check((await page.locator('.hv-sheet .page-title').textContent()) === 'Marta Pell' && await page.locator('.hv-sheet.sheet .outline .blk').count() === 4, 'its notes on a sheet under the page’s title, like the page');
check((await page.locator('.hv-about').textContent()).includes('Backup made by Logseq on your phone'), 'saying which version it is');
check(await page.locator('.hv-page .bc strong').count() === 1 && await page.locator('.hv-page a[data-page="county show"]').count() === 1, 'written as the page would show it (bold, links)');
await page.locator('.hv-page .bc', { hasText: 'patient proving' }).click();
await page.locator('.hv-page a[data-page="county show"]').click();
await sleep(400);
check(await page.locator('textarea.ed').count() === 0 && decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Marta Pell', 'clicking a note or a link in it does nothing (no editing, no other page)');
check(await page.locator('.hist .panel-foot [data-h="put"]').isVisible(), 'with “Put this version back”');
await page.screenshot({ path: SHOTS + '/history-version.png' });
await page.keyboard.press('Escape');
await sleep(200);
check(await rows.count() === 2 && await page.evaluate(() => document.activeElement?.dataset.k === '0'), 'Esc goes back to the list');
await page.keyboard.press('Escape');
await sleep(200);
check(await page.locator('.hist').count() === 0 && await page.evaluate(() => document.activeElement?.matches('.title-row [data-a="more"]')), 'Esc again closes it (the keyboard back on ⋯)');

console.log('putting one back: the page’s text kept in logseq/bak first, then saved; Undo');
const baks0 = bakTexts().length;
await openHistory();
await rows.first().click();
await page.waitForSelector('.hist [data-h="put"]');
await page.locator('.hist [data-h="put"]').click();
await sleep(1200);
check(read('pages/Marta Pell.md') === PHONE, 'the file reads exactly like that version', read('pages/Marta Pell.md'));
const kept = bakTexts();
check(kept.length === baks0 + 1 && kept.filter((t) => t === NOW_TEXT).length === 2, 'the text it replaced is kept in logseq/bak first (a new file there)', JSON.stringify(kept));
const toast = await page.locator('#toast').textContent();
check(/^Put back the version from today \d\d:\d\d\. Its text from before is kept in logseq\/bak\/pages\/Marta Pell\/\d{4}-\d\d-\d\d_\d\d_\d\d_\d\d(-\d+)?\.md\.Undo$/.test(toast), 'the message says so, and where the text from before is', toast);
check(await page.locator('.hist').count() === 0 && await page.locator('.view .outline .blk').count() === 4, 'the panel closed; the page shows the version put back');
await page.locator('#toast .toast-act').click();
await sleep(1200);
check(read('pages/Marta Pell.md') === NOW_TEXT && await page.locator('.view .outline .blk').count() === 1, 'Undo in the message brings back what was there (and saves it)', read('pages/Marta Pell.md'));

console.log('a change made elsewhere meanwhile, in another note: merged');
// (no looking for changes meanwhile: the page goes on showing what it read, as when Drive is slow)
await page.route('**/api/rescan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await openHistory();
const deskRow = rows.filter({ hasText: 'on your computer' });
await deskRow.click();
await page.waitForSelector('.hist [data-h="put"]');
write('pages/Marta Pell.md', NOW_TEXT + '- added on the phone\n'); // (the page hasn't read it yet)
await page.locator('.hist [data-h="put"]').click();
await sleep(1200);
check(read('pages/Marta Pell.md') === DESK + '- added on the phone\n', 'the version put back, and the note added elsewhere kept', read('pages/Marta Pell.md'));
check(bakTexts().includes(NOW_TEXT + '- added on the phone\n'), 'what the file said is kept in logseq/bak first');
check((await page.locator('#toast').textContent()).includes('with the changes made elsewhere meanwhile') && await page.locator('#toast .toast-act').count() === 0, 'the message says the changes made elsewhere were kept (no Undo)', await page.locator('#toast').textContent());
check(await page.locator('.clash').count() === 0, 'no clash screen');

console.log('a change made elsewhere meanwhile, in the same note: the clash screen; never written over');
const clashing = '- Wrote Notes on Wild Yeast (edited on the phone)\n- added on the phone\n';
await openHistory();
await rows.filter({ hasText: 'on your phone' }).first().click();
await page.waitForSelector('.hist [data-h="put"]');
write('pages/Marta Pell.md', clashing);
await page.locator('.hist [data-h="put"]').click();
await sleep(1500);
check(await page.locator('.clash').isVisible(), 'the clash screen opens');
check(read('pages/Marta Pell.md') === clashing, 'the file is as the phone left it until he chooses', read('pages/Marta Pell.md'));
check(bakTexts().includes(clashing), 'and that text was kept in logseq/bak first anyway');
await page.locator('.clash [data-c="later"]').click();
await sleep(300);
console.log('while that clash waits, nothing is put back');
await openHistory();
await rows.first().click();
await page.waitForSelector('.hist [data-h="put"]');
const n0 = bakTexts().length;
await page.locator('.hist [data-h="put"]').click();
await sleep(800);
check((await page.locator('#toast').textContent()).includes('First choose which version of “Marta Pell” to keep'), 'it says to choose first', await page.locator('#toast').textContent());
check(read('pages/Marta Pell.md') === clashing && bakTexts().length === n0 && await page.locator('.hist').count() === 0, 'nothing written or kept; the panel closed (the banner to choose is there)');
await page.locator('.banner [data-a="choose"]').click();
await sleep(500);
await page.locator('.clash [data-c="apply"]').click();
await sleep(1200);
check(!(await page.locator('.banner:not([hidden])').count()) && read('pages/Marta Pell.md').includes('Best loaf'), 'choosing settles it as usual');

console.log('a text from before a change made elsewhere (safety copy)');
await page.unroute('**/api/rescan');
const goodNow = read('pages/Marta Pell.md');
write('pages/Marta Pell.md', '- overwritten by a bad sync\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(600);
const hide = (s) => page.evaluate((st) => { Object.defineProperty(document, 'visibilityState', { value: st, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, s);
await hide('hidden'); // put away: the index is saved; the texts changes elsewhere replaced go into a safety copy first
await sleep(600);
await hide('visible');
await sleep(300);
await openHistory();
const beforeRow = rows.filter({ hasText: 'Before a change made elsewhere' });
check(await beforeRow.count() === 1 && (await beforeRow.textContent()).includes('Today'), 'listed: “Before a change made elsewhere”, today', await page.locator('.hist .hv-list').textContent());
await beforeRow.click();
await page.waitForSelector('.hist [data-h="put"]');
check((await page.locator('.hv-page').textContent()).includes('Best loaf'), 'holding the text the bad sync replaced');
await page.locator('.hist [data-h="put"]').click();
await sleep(1200);
check(read('pages/Marta Pell.md') === goodNow, 'put back', read('pages/Marta Pell.md'));
check(bakTexts().includes('- overwritten by a bad sync\n'), 'the overwritten text kept in logseq/bak first');

console.log('zoomed in on a note: putting a version back shows the whole page');
await go(page, '#/zoom/Marta%20Pell/1');
await sleep(300);
check(await page.locator('.view .crumbs:not([hidden])').count() === 1, '(zoomed in)');
await openHistory();
await rows.filter({ hasText: 'on your computer' }).first().click();
await page.waitForSelector('.hist [data-h="put"]');
await page.locator('.hist [data-h="put"]').click();
await sleep(1200);
check(read('pages/Marta Pell.md') === DESK, 'put back', read('pages/Marta Pell.md'));
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Marta Pell' && await page.locator('.view .crumbs:not([hidden])').count() === 0 && await page.locator('.view .outline .blk').count() === 1, 'the whole page shows, and the address says so');

console.log('page properties: drawn under the title in the version, and on the page once put back');
write(`${BAK}/${logseqName(Date.now() - 60e3, '.ios')}`, 'tags:: people, [[county show]]\n\n' + DESK);
await openHistory();
const propRow = rows.filter({ hasText: 'Page properties changed' });
check(await propRow.count() === 1 && (await propRow.textContent()).includes('on your phone'), 'only the properties differ: “Page properties changed”', await page.locator('.hist .hv-list').textContent());
await propRow.click();
await page.waitForSelector('.hist [data-h="put"]');
check((await page.locator('.hv-sheet .page-head .page-props').textContent()).includes('people'), 'the version’s properties under its title');
await page.locator('.hist [data-h="put"]').click();
await sleep(1500);
check((await page.locator('.view .page-head .page-props').textContent()).includes('people'), 'and under the page’s title once put back', await page.locator('.view .page-head .page-props').textContent());

console.log('a file that isn’t plain text: nothing put back');
fs.writeFileSync(VAULT + '/pages/Latin.md', Buffer.from('- caf\xe9 au lait\n', 'latin1'));
fs.mkdirSync(VAULT + '/logseq/bak/pages/Latin', { recursive: true });
write(`logseq/bak/pages/Latin/${logseqName(Date.now() - 600e3, '.Desktop')}`, '- café au lait, earlier\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(400);
await go(page, '#/page/Latin');
await sleep(300);
await openHistory();
check(await rows.count() === 1, 'its versions are listed');
await rows.first().click();
await page.waitForSelector('.hist [data-h="put"]');
await page.locator('.hist [data-h="put"]').click();
await sleep(600);
check((await page.locator('#toast').textContent()).includes('isn’t plain UTF-8 text'), 'putting one back is refused, saying why', await page.locator('#toast').textContent());
check(fs.readFileSync(VAULT + '/pages/Latin.md').equals(Buffer.from('- caf\xe9 au lait\n', 'latin1')) && fs.readdirSync(VAULT + '/logseq/bak/pages/Latin').length === 1, 'the file and the backups unchanged');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

console.log('a journal day has History too');
const dayName = await page.evaluate(() => window.leanApp.summary.today);
fs.mkdirSync(`${VAULT}/logseq/bak/Diary/${dayName}`, { recursive: true });
write(`logseq/bak/Diary/${dayName}/${logseqName(Date.now() - 120e3, '.android')}`, '- this morning, on the phone\n');
await go(page, '#/page/' + encodeURIComponent(dayName));
await sleep(300);
await openHistory();
check(await rows.count() === 1 && (await rows.first().textContent()).includes('Backup made by Logseq on your phone'), 'today’s journal lists its backup', await page.locator('.hist').textContent());
await page.keyboard.press('Escape');

console.log('no versions yet');
await go(page, '#/page/Orphan%20page');
await sleep(300);
await openHistory();
check((await page.locator('.hist .hv-body').textContent()).includes('No earlier versions of this page yet'), 'says there are none yet, and where they come from');
await page.locator('.hist [data-h="close"]').click();
await sleep(200);
check(await page.locator('.hist').count() === 0, '× closes it');
// changed elsewhere: the safety copy made when the folder opened now holds an earlier version
write('pages/Orphan page.md', '- somebody links here now\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(500);
await openHistory();
const copyRows = (await rows.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
check(copyRows.length === 1 && /^Today \d\d:\d\d Safety copy made by this computer 1 note changed$/.test(copyRows[0]), '“Safety copy made by this computer”, from when the folder opened', JSON.stringify(copyRows));
await page.keyboard.press('Escape');

console.log('every look');
await go(page, '#/page/Marta%20Pell');
await sleep(300);
for (const look of await lookIds(page)) {
  await page.evaluate((l) => window.leanApp.setSkin(l), look);
  await openHistory();
  await rows.filter({ hasText: 'on your phone' }).first().click();
  await page.waitForSelector('.hist [data-h="put"]');
  await sleep(150);
  const ok = await page.evaluate(() => {
    const p = document.querySelector('.hist'), r = p.getBoundingClientRect();
    const c = (el) => getComputedStyle(el).color, bg = getComputedStyle(p).backgroundColor;
    return r.width > 600 && r.left >= 0 && r.right <= innerWidth && bg !== 'rgba(0, 0, 0, 0)' && c(p) !== bg && !!document.querySelector('.hv-sheet .outline .blk');
  });
  check(ok, `${look}: the panel fits, its words and the version show`);
  await page.screenshot({ path: `${SHOTS}/history-${look}.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}
await page.evaluate(() => window.leanApp.setSkin('calm'));
check(!errors.length, 'no script errors (laptop)', errors.join(' | '));
await browser.close();

console.log('a narrow window and a phone: the whole screen; Back steps back');
for (const [what, opts] of [['narrow window', { viewport: { width: 600, height: 800 } }], ['phone', { viewport: { width: 360, height: 740 }, touch: true }]]) {
  const s = await open(opts);
  const p = s.page;
  await go(p, '#/page/Marta%20Pell');
  await sleep(300);
  const tap = (loc) => (opts.touch ? loc.tap() : loc.click());
  await tap(p.locator('.title-row [data-a="more"]'));
  await sleep(200);
  await tap(p.locator('.pop.menu button', { hasText: 'History…' }));
  await p.waitForSelector('.hist .hv-list');
  await sleep(200);
  const fill = await p.evaluate(() => { const r = document.querySelector('.hist').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(',') === `0,0,${innerWidth},${innerHeight}`; });
  check(fill, `${what}: the panel takes the whole screen`);
  await p.screenshot({ path: `${SHOTS}/history-${what.replace(' ', '-')}-list.png` });
  await tap(p.locator('.hist .hv-list [data-k]').first());
  await p.waitForSelector('.hist [data-h="put"]');
  await sleep(200);
  const fits = await p.evaluate(() => { const b = document.querySelector('.hist [data-h="put"]').getBoundingClientRect(); return b.bottom <= innerHeight && b.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  check(fits, `${what}: “Put this version back” on screen, nothing wider than it`);
  await p.screenshot({ path: `${SHOTS}/history-${what.replace(' ', '-')}-version.png` });
  await p.evaluate(() => window.leanApp.onBack());
  await sleep(200);
  check(await p.locator('.hist .hv-list').count() === 1, `${what}: Back goes to the list`);
  await p.evaluate(() => window.leanApp.onBack());
  await sleep(200);
  check(await p.locator('.hist').count() === 0 && decodeURIComponent(await p.evaluate(() => location.hash)) === '#/page/Marta Pell', `${what}: Back again closes it, staying on the page`);
  check(!s.errors.length, `${what}: no script errors`, s.errors.join(' | '));
  await s.browser.close();
}
process.exit(failures() ? 1 : 0);

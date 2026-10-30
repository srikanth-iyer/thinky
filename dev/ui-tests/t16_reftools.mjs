// The references' tools (he asked, Oct 29, round 3: "filter and sort and fold all as three small buttons",
// on the right): three small quiet icon buttons at the right end of the Linked references heading. Filter
// opens a box under the heading (with the focus when clicked); Filter again, or Esc in the empty box,
// closes it and empties it. Sort switches Last changed ↔ Name (its icon and tooltip say which); Fold all
// folds/opens every box (its icon and tooltip say which). Kept per page (localStorage `refTools`, at most
// 200 pages): the box open or not, and the sort; never the words typed. A day in the Journals list has its
// own. Laptop and phone.
import fs from 'node:fs';
import { open, write, read, check, failures, sleep, go, SHOTS, VAULT } from './lib.mjs';

const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const F = 'Tobias Wren Okafor';
const put = (rel, text, hours) => { write(rel, text); const t = Date.now() / 1000 - hours * 3600; fs.utimesSync(VAULT + '/' + rel, t, t); };
put(`pages/${F}.md`, '- Apprentice\n', 300);
put(`Diary/${title(ago(0))}.md`, `- Call with [[${F}]] about the pickles\n\t- try a weaker brine next\n`, 0.5);
put('pages/Recipe draft.md', `- Ask [[${F}]] for the jars\n- Read [[Topic]]\n`, 1);
put('pages/Supper club.md', `- [[${F}]] presents\n- More on [[Topic]]\n`, 50);
put('pages/Trip.md', `- Fly to Oslo on [[${title(ago(2))}]]\n`, 30);
put('pages/Errands.md', `- Parcel on [[${title(ago(2))}]]\n`, 40);
put('pages/Alpha.md', `- Also on [[${title(ago(2))}]]\n`, 60);
const PAGE = '#/page/Tobias%20Wren%20Okafor';
const linked = (page) => page.locator('#main .view > .sec:not(.unlinked)');
const order = (page, sec) => sec.locator('.refgrp').evaluateAll((gs) => gs.map((g) => g.dataset.page));
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('refTools') || '[]'));

let { browser, page, errors } = await open();
await go(page, PAGE);
await page.waitForSelector('#main .view > .sec .refgrp .refnote');
await sleep(400);

console.log('three small quiet buttons at the right of the heading; no box at first');
const sec = linked(page), acts = sec.locator('.sec-h .ref-acts'), btn = sec.locator('.ref-f'), sortB = sec.locator('.ref-s'), foldB = sec.locator('.ref-fa'), bar = sec.locator('.ref-tools');
const first = await acts.evaluate((a) => {
  const h = a.closest('.sec-h').getBoundingClientRect(), bs = [...a.querySelectorAll('button')], r = bs.map((b) => b.getBoundingClientRect());
  const words = a.closest('.sec-h').querySelector('.sec-t').getBoundingClientRect();
  return { n: bs.length, sizes: r.map((x) => [Math.round(x.width), Math.round(x.height)]), right: Math.round(h.right - r[2].right), afterWords: r[0].left > words.right, head: Math.round(h.height),
    labels: bs.map((b) => b.getAttribute('aria-label')), titles: bs.map((b) => b.title), text: a.textContent.trim(), svgs: bs.map((b) => !!b.querySelector('svg')) };
});
check(first.n === 3 && first.sizes.every(([w, h]) => w <= 30 && h <= 30) && first.text === '' && first.svgs.every(Boolean), 'three small icon buttons, no words', JSON.stringify(first));
check(first.right <= 6 && first.afterWords, 'at the right end of the heading, after its words', JSON.stringify(first));
check(JSON.stringify(first.labels) === JSON.stringify(['Filter references', 'Sorted: last changed, newest first (click to change)', 'Fold all']) && JSON.stringify(first.titles) === JSON.stringify(first.labels), 'each says what it is (label and tooltip)', JSON.stringify(first.labels));
check(first.head <= 30, 'the heading no taller for them', JSON.stringify(first));
check(!(await bar.isVisible()) && !(await sec.locator('.ref-filter').isVisible()) && await sec.locator('.ref-sort, .ref-foldall').count() === 0, 'no filter box, no row of tools');
const all = (await order(page, sec)).length;

console.log('Filter opens the box under the heading, ready to type');
await btn.click();
await sleep(300);
check(await bar.isVisible() && await btn.getAttribute('aria-expanded') === 'true', 'the box shows');
check(await page.evaluate(() => { const b = document.querySelector('.ref-tools'), h = b.previousElementSibling; return h.classList.contains('sec-h') && b.getBoundingClientRect().top >= h.getBoundingClientRect().bottom; }), 'under the heading');
check(await page.evaluate(() => document.activeElement?.classList.contains('ref-filter')), 'the filter box has the focus');
await page.keyboard.type('weaker');
await sleep(600);
check((await order(page, sec)).length === 1 && /of .* match/.test(await sec.locator('.sec-h .n').textContent()), 'typing filters', JSON.stringify(await order(page, sec)));
await page.screenshot({ path: SHOTS + '/reftools-open.png' });
await btn.click();
await sleep(500);
check(!(await bar.isVisible()) && (await order(page, sec)).length === all && /in \d+ pages/.test(await sec.locator('.sec-h .n').textContent()), 'clicked again: the box closes and the filter is emptied (everything back)');
await btn.click();
await sleep(300);
check(await sec.locator('.ref-filter').inputValue() === '', 'opened again: the box is empty');
await page.keyboard.type('x');
await page.keyboard.press('Escape');
await sleep(300);
check(await bar.isVisible() && await sec.locator('.ref-filter').inputValue() === '', 'Esc with words: empties the box, it stays');
await page.keyboard.press('Escape');
await sleep(300);
check(!(await bar.isVisible()) && await btn.getAttribute('aria-expanded') === 'false', 'Esc in the empty box closes it');

console.log('Sort: a menu of orders, each both ways (Build 33); its icon says which');
const icon0 = await sortB.innerHTML();
const byChanged = await order(page, sec);
await sortB.click();
await sleep(200);
const items = await page.locator('.sort-menu button').evaluateAll((bs) => bs.map((b) => [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('')));
check(items.join('|') === 'Newest first|Oldest first|A to Z|Z to A|Newest first|Oldest first' && await page.locator('.sort-menu .m-head').allTextContents().then((x) => x.join('|')) === 'Last changed|Name|Date created', 'the menu: Last changed, Name and Date created, each both ways', items.join('|'));
check((await page.locator('.sort-menu [data-k="1"] .mhint').textContent()) === '✓', 'the order in use is ticked');
await page.locator('.sort-menu [data-k="4"]').click();
await sleep(400);
const byName = await order(page, sec);
check(JSON.stringify(byName) !== JSON.stringify(byChanged) && JSON.stringify([...byName].sort()) === JSON.stringify([...byChanged].sort()), 'a click sorts the same pages by name', JSON.stringify([byChanged, byName]));
check(await sortB.getAttribute('data-sort') === 'name' && await sortB.innerHTML() !== icon0 && await sortB.getAttribute('aria-label') === 'Sorted: name, a to z (click to change)' && await sortB.getAttribute('title') === 'Sorted: name, a to z (click to change)', 'its icon and tooltip now say Name', await sortB.getAttribute('aria-label'));
check(!(await bar.isVisible()), 'sorting doesn’t open the filter box');
await sortB.click();
await page.locator('.sort-menu [data-k="5"]').click();
await sleep(400);
check(JSON.stringify(await order(page, sec)) === JSON.stringify([...byName].reverse()), 'Name, Z to A: the other way round', JSON.stringify(await order(page, sec)));
await sortB.click();
await page.locator('.sort-menu [data-k="2"]').click();
await sleep(400);
check(JSON.stringify(await order(page, sec)) === JSON.stringify([...byChanged].reverse()), 'Last changed, oldest first', JSON.stringify(await order(page, sec)));
await sortB.click();
await page.locator('.sort-menu [data-k="7"]').click();
await sleep(400);
check(await sortB.getAttribute('data-sort') === 'created' && (await order(page, sec)).length === byChanged.length, 'Date created, newest first', JSON.stringify(await order(page, sec)));
await sortB.click();
await page.locator('.sort-menu [data-k="1"]').click();
await sleep(400);
check(JSON.stringify(await order(page, sec)) === JSON.stringify(byChanged) && await sortB.innerHTML() === icon0, 'again: back to Last changed, and its icon', JSON.stringify(await order(page, sec)));

console.log('Fold all / Open all, its icon says which');
const fIcon = await foldB.innerHTML();
await foldB.click();
await sleep(500);
check(await sec.locator('.refgrp:not(.folded)').count() === 0 && await foldB.getAttribute('aria-label') === 'Open all' && await foldB.getAttribute('title') === 'Open all' && await foldB.innerHTML() !== fIcon, 'folds every box; now it says Open all, another icon');
await foldB.click();
await sleep(500);
check(await sec.locator('.refgrp.folded').count() === 0 && await foldB.getAttribute('aria-label') === 'Fold all' && await foldB.innerHTML() === fIcon, 'and opens them all again');

console.log('kept per page: open or not, and the sort; not the words');
await btn.click();
await sortB.click();
await page.locator('.sort-menu [data-k="4"]').click();
await sleep(400);
await sec.locator('.ref-filter').fill('brine');
await sleep(500);
check(JSON.stringify(await saved(page)) === JSON.stringify([[F.toLowerCase(), 1, 'name']]), 'saved: the page, open, by name', JSON.stringify(await saved(page)));
await go(page, '#/page/Topic');
await page.waitForSelector('#main .view > .sec .refgrp');
await sleep(300);
check(!(await linked(page).locator('.ref-tools').isVisible()) && await linked(page).locator('.ref-tbtn').count() === 3, 'another page: closed, as he left it (never opened)');
check(JSON.stringify(await order(page, linked(page))) === JSON.stringify(['Recipe draft', 'Supper club']) && await linked(page).locator('.ref-s').getAttribute('data-sort') === 'changed', 'and sorted by Last changed there', JSON.stringify(await order(page, linked(page))));
await go(page, PAGE);
await page.waitForSelector('#main .view > .sec .refgrp');
await sleep(400);
check(await bar.isVisible() && await sortB.getAttribute('data-sort') === 'name', 'back on the first page: still open, still by name');
check(await sec.locator('.ref-filter').inputValue() === '' && (await order(page, sec)).length === all, 'the words typed are not kept', JSON.stringify(await order(page, sec)));
check(JSON.stringify(await order(page, sec)) === JSON.stringify(byName), 'all the pages, in Name order', JSON.stringify(await order(page, sec)));
await page.reload();
await page.waitForSelector('#main .view > .sec .refgrp');
await sleep(400);
check(await bar.isVisible() && await sortB.getAttribute('data-sort') === 'name', 'after a restart too');
check(!(await page.evaluate(() => document.activeElement?.classList.contains('ref-filter'))), 'opened from memory: no focus taken (a phone keeps its keyboard down)');
await sortB.click();
await page.locator('.sort-menu [data-k="1"]').click();
await btn.click();
await sleep(300);
check(JSON.stringify(await saved(page)) === '[]', 'closed and Last changed again: the page leaves the list');
await sortB.click();
await page.locator('.sort-menu [data-k="4"]').click();
await sleep(400);
check(JSON.stringify(await saved(page)) === JSON.stringify([[F.toLowerCase(), 0, 'name']]), 'closed but by name: kept', JSON.stringify(await saved(page)));

console.log('the list stays small');
await page.evaluate(() => localStorage.setItem('refTools', JSON.stringify(Array.from({ length: 250 }, (_, i) => [`page ${i}`, 1, 'name']))));
await btn.click();
await sleep(200);
const big = await saved(page);
check(big.length === 200 && big[199][0] === F.toLowerCase() && big[0][0] === 'page 51', 'at most 200 pages, the oldest dropped', `${big.length} ${JSON.stringify(big[0])} ${JSON.stringify(big[199])}`);
await page.evaluate(() => localStorage.setItem('refTools', '{oops'));
await page.reload();
await page.waitForSelector('#main .view > .sec .refgrp');
await sleep(300);
check(await btn.count() === 1 && !(await bar.isVisible()), 'a damaged entry: closed, nothing breaks');

console.log('a day in the Journals list: its own button and memory');
await page.evaluate(() => localStorage.removeItem('refTools'));
await go(page, '#/journals');
await sleep(1500);
const day = page.locator('.sheet.day', { has: page.locator('.page-title', { hasText: title(ago(2)) }) }).locator('.day-refs .sec').first();
check(await day.locator('.ref-tbtn').count() === 3 && !(await day.locator('.ref-tools').isVisible()), 'a day linked from several pages: the three buttons, the box closed');
check(JSON.stringify(await order(page, day)) === JSON.stringify(['Trip', 'Errands', 'Alpha']), 'Last changed first', JSON.stringify(await order(page, day)));
check(await day.locator('.ref-s').getAttribute('data-sort') === 'changed', '(its Sort says Last changed)');
await day.locator('.ref-f').click();
await day.locator('.ref-s').click();
await page.locator('.sort-menu [data-k="4"]').click();
await sleep(400);
check(JSON.stringify(await order(page, day)) === JSON.stringify(['Alpha', 'Errands', 'Trip']), 'Name: A to Z', JSON.stringify(await order(page, day)));
await day.locator('.ref-filter').fill('parcel');
await sleep(500);
check(JSON.stringify(await order(page, day)) === JSON.stringify(['Errands']), 'its filter works', JSON.stringify(await order(page, day)));
await page.reload();
await sleep(1800);
check(await day.locator('.ref-tools').isVisible() && JSON.stringify(await order(page, day)) === JSON.stringify(['Alpha', 'Errands', 'Trip']), 'kept for that day', JSON.stringify(await order(page, day)));
check(await page.locator('.sheet.day.today .ref-tbtn').count() === 0, 'a day linked from one page only: no buttons');
check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();

console.log('on a phone');
({ browser, page, errors } = await open({ viewport: { width: 390, height: 844 }, touch: true }));
await go(page, PAGE);
await page.waitForSelector('#main .view > .sec .refgrp .refnote');
await sleep(400);
const s2 = linked(page), b2 = s2.locator('.ref-f');
const all2 = (await order(page, s2)).length;
const reach = await s2.locator('.ref-acts').evaluate((a) => {
  const bs = [...a.querySelectorAll('.ref-tbtn')];
  return { at: bs.map((b) => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return [[0, -19], [0, 19], [-19, 0], [19, 0]].every(([dx, dy]) => b.contains(document.elementFromPoint(x + dx, y + dy))); }),
    size: bs.map((b) => Math.round(b.getBoundingClientRect().width)), head: Math.round(a.closest('.sec-h').getBoundingClientRect().height), right: Math.round(a.closest('.sec-h').getBoundingClientRect().right - bs[2].getBoundingClientRect().right) };
});
check(reach.at.length === 3 && reach.at.every(Boolean) && reach.size.every((w) => w <= 32), 'each small button takes a finger (40px across, each its own)', JSON.stringify(reach));
check(reach.head <= 34 && reach.right <= 6, 'at the right end, the heading no taller', JSON.stringify(reach));
check(!(await s2.locator('.ref-tools').isVisible()), 'closed at first');
await b2.tap();
await sleep(400);
check(await s2.locator('.ref-tools').isVisible(), 'a tap on Filter opens the box');
await page.keyboard.type('weaker');
await sleep(600);
check((await order(page, s2)).length === 1, 'typing filters on a phone');
await page.screenshot({ path: SHOTS + '/reftools-phone.png' });
await b2.tap();
await sleep(500);
check(!(await s2.locator('.ref-tools').isVisible()) && (await order(page, s2)).length === all2, 'a tap again closes it, everything back');
await s2.locator('.ref-s').tap();
await sleep(200);
await page.locator('.sort-menu [data-k="4"]').tap();
await sleep(400);
check(await s2.locator('.ref-s').getAttribute('data-sort') === 'name', 'a tap on Sort: by name');
await s2.locator('.ref-fa').tap();
await sleep(400);
check(await s2.locator('.refgrp:not(.folded)').count() === 0, 'a tap on Fold all folds them');
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing sticks out sideways');
check(!errors.length, 'no script errors on the phone', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

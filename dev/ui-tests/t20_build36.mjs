// Build 36 (the maintainer's notes of Nov 4 and 5): Namespaces fold and only show groups of two or
// more pages; Ctrl+R / F5 show the notes as their files are now (not a window reload); to-dos count
// the links of the notes they sit under; the note menu shows a note's hidden properties; a property
// renamed (or merged) in every note; Check this folder lists notes linking to missing pictures.
import { open, check, failures, sleep, go, write, read, SHOTS } from './lib.mjs';

// a namespace of one page (not listed) beside APRON's (two pages under it), and one whose two pages
// are a level down (Deep/a/b and Deep/a/c: two under Deep, so it shows)
write('pages/Solo___only child.md', '- alone in its namespace\n');
write('pages/Deep___a___b.md', '- b\n');
write('pages/Deep___a___c.md', '- c\n');
// to-dos under a parent that carries the link
write('pages/Build list.md', '- [[Hartley]]\n\t- TODO ask about the oven\n\t- TODO and the flour [[Rosa Penhallow]]\n- TODO not under anything\n');
// properties to merge, and a hidden one
write('pages/Paper.md', 'authors:: Mitchell\n\n- read it\n  authors:: Crutchfield\n  author:: Hanson\n- a note with an id\n  id:: 6528aaaa-bbbb-4ccc-8ddd-eeeeffff7777\n  collapsed:: false\n');
// a link to a picture that isn't there
write('pages/Shots.md', '- from the phone ![shot](../assets/never-synced.jpg)\n');

const { browser, page, errors } = await open();
// a window reload would wipe this mark (a change of #/page/… doesn't)
await page.evaluate(() => { window.__b36 = 'still here'; });
const reloaded = async () => (await page.evaluate(() => window.__b36)) !== 'still here';

console.log('Namespaces: only groups of two or more pages, folded, the parent marked');
await go(page, '#/pages');
const tree = page.locator('.chips [data-o="tree"]');
if (await tree.getAttribute('aria-pressed') !== 'true') await tree.click();
await sleep(200);
const rows = () => page.locator('.tree-rows li').evaluateAll((lis) => lis.map((li) => `${li.style.getPropertyValue('--d')}:${li.className}:${li.querySelector('.pg-name').textContent.trim()}`));
let r = await rows();
check(r.length === 2 && /^0:ns-parent:APRON 2$/.test(r[0]) && /^0:ns-parent:Deep 3$/.test(r[1]), 'APRON (2 under it) and Deep (a, a/b, a/c) show, folded; Solo (one page) doesn’t', JSON.stringify(r));
// the keyboard: Tab to an arrow, Enter unfolds, the focus stays on it
await page.locator('.ns-fold').nth(1).focus();
await page.keyboard.press('Enter');
await sleep(150);
r = await rows();
check(r.length === 3 && /^1:ns-parent:a 2$/.test(r[2]) && await page.evaluate(() => document.activeElement?.classList.contains('ns-fold')), 'Enter on an arrow unfolds it; the keyboard stays there', JSON.stringify(r));
await page.keyboard.press('Enter');
await sleep(150);
check((await rows()).length === 2, 'Enter again folds it');
// Select all shown takes only the pages that show (not the folded ones)
await page.locator('[data-a="select"]').click();
await page.locator('[data-a="all"]').click();
await sleep(150);
check(/Delete 1 page/.test(await page.locator('[data-a="delete"]').textContent()), 'Select all shown: only APRON (Deep has no page of its own; the folded subpages aren’t shown)', await page.locator('[data-a="delete"]').textContent());
await page.locator('[data-a="none"]').click();
// typing a filter lists every matching page flat, folded or not
await page.locator('.list-tools input.filter').fill('spice');
await sleep(300);
check((await page.locator('.pg-rows li .pg-name').allTextContents()).some((t) => t.trim() === 'APRON/Spice jars'), 'typing a filter: the pages, flat, whatever is folded');
await page.locator('.list-tools input.filter').fill('');
await sleep(200);
const fold = page.locator('.ns-fold').first();
check(await fold.getAttribute('aria-expanded') === 'false', 'folded at first');
await fold.click();
await sleep(150);
r = await rows();
check(r.length === 3 && /^1:ns-parent:Spice jars 1$/.test(r[1]), 'unfolded: its subpage shows under it (bold, it has one under it)', JSON.stringify(r));
await page.locator('.ns-fold').nth(1).click();
await sleep(150);
r = await rows();
check(r.length === 4 && /^2:ns-sub:notes$/.test(r[2]), 'and one level more: a page with nothing under it has no arrow', JSON.stringify(r));
const look = await page.evaluate(() => { const w = (s) => getComputedStyle(document.querySelector(s + ' .pg-name')).fontWeight; return [w('.ns-parent'), w('.ns-sub')]; });
check(+look[0] >= 600 && +look[1] < 600, 'parents bold, subpages not', JSON.stringify(look));
await page.locator('.ns-fold').nth(1).click();
await sleep(150);
await page.screenshot({ path: SHOTS + '/b36-namespaces.png' });
await page.reload();
await page.waitForSelector('.tree-rows li');
await sleep(200);
check((await rows()).length === 3, 'stays unfolded after a reload', JSON.stringify(await rows()));
await page.locator('.ns-fold').first().click();
await sleep(150);
check((await rows()).length === 2, 'and folds again', JSON.stringify(await rows()));
await tree.click();

console.log('Ctrl+R and F5: the page as its file is now, without reloading the window');
await page.evaluate(() => { window.__b36 = 'still here'; }); // (the Namespaces part reloaded on purpose)
await go(page, '#/page/' + encodeURIComponent('Build list'));
await page.waitForSelector('.outline .blk');
write('pages/Build list.md', read('pages/Build list.md') + '- added elsewhere just now\n');
await page.keyboard.press('Control+r');
await page.waitForSelector('.outline .blk > .bc:has-text("added elsewhere just now")', { timeout: 4000 }).catch(() => {});
check(await page.locator('.outline .blk > .bc', { hasText: 'added elsewhere just now' }).count() === 1, 'Ctrl+R shows the change');
check(!(await reloaded()), 'the window wasn’t reloaded');
check(/Up to date/.test(await page.locator('#toast').textContent()), 'says so');
write('pages/Build list.md', read('pages/Build list.md').replace('added elsewhere just now', 'changed again'));
await page.keyboard.press('F5');
await page.waitForSelector('.outline .blk > .bc:has-text("changed again")', { timeout: 4000 }).catch(() => {});
check(await page.locator('.outline .blk > .bc', { hasText: 'changed again' }).count() === 1 && !(await reloaded()), 'F5 too');
// typing that hasn't saved yet: saved first, then the page shows both
await page.locator('.outline .blk > .bc', { hasText: 'not under anything' }).click();
await page.waitForSelector('textarea.ed');
await page.keyboard.press('End');
await page.keyboard.type(' typed just now');
write('pages/Build list.md', read('pages/Build list.md') + '- and from elsewhere\n');
await page.keyboard.press('Control+r'); // (while the box has the keyboard: never the window's reload)
await sleep(1500);
const file = read('pages/Build list.md');
check(/not under anything typed just now/.test(file) && /and from elsewhere/.test(file), 'typing waiting to save is saved first; the other change stays in the file', file);
check(!(await reloaded()), 'no window reload while editing either');
await page.keyboard.press('Escape');
await sleep(300);
await page.keyboard.press('Control+r');
await page.waitForSelector('.outline .blk > .bc:has-text("and from elsewhere")', { timeout: 4000 }).catch(() => {});
check(await page.locator('.outline .blk > .bc', { hasText: 'and from elsewhere' }).count() === 1, 'then a refresh shows it');
// Journals: a day changed elsewhere
await go(page, '#/journals');
await page.waitForSelector('.sheet .outline .blk');
const dayFile = (await import('node:fs')).readdirSync((await import('./lib.mjs')).VAULT + '/Diary').sort().at(-1);
write('Diary/' + dayFile, read('Diary/' + dayFile) + '- a line from the phone\n');
await page.keyboard.press('F5');
await page.waitForSelector('.outline .blk > .bc:has-text("a line from the phone")', { timeout: 4000 }).catch(() => {});
check(await page.locator('.outline .blk > .bc', { hasText: 'a line from the phone' }).count() === 1, 'Journals: today’s day shows the change', dayFile);
// the command list has it, with its keys
await page.keyboard.press('Control+Shift+P');
await page.waitForSelector('#search:not([hidden]) input');
await page.keyboard.type('refresh');
await sleep(300);
check(/Refresh/.test(await page.locator('#search').textContent()), 'Ctrl+Shift+P → Refresh');
await page.keyboard.press('Escape');
check(!(await reloaded()), 'and never a window reload');

console.log('to-dos: a parent’s link counts as the to-do’s own');
await go(page, '#/todos');
await page.waitForSelector('.todo-item');
const item = (t) => page.locator('.todo-item', { hasText: t });
check(/under\s+Hartley/.test(await item('ask about the oven').locator('.where').textContent()), 'shown: “under Hartley”', await item('ask about the oven').locator('.where').textContent());
check(!/under/.test(await item('not under anything').locator('.where').textContent()), 'a top-level to-do: nothing');
if (await page.locator('.todo-f').getAttribute('aria-expanded') !== 'true') await page.locator('.todo-f').click(); // (Build 37: behind the filter button)
const chip = page.locator('.todo-chips .ref-chip', { hasText: /^Hartley/i });
await chip.click();
await sleep(300);
const shown = await page.locator('.todo-item .bc').evaluateAll((b) => b.map((x) => x.textContent));
check(shown.length === 2 && shown.every((t) => /oven|flour/.test(t)), 'Hartley’s button shows the two under it', JSON.stringify(shown));
await chip.click();
await page.locator('.list-tools input.filter').fill('hartley');
await sleep(300);
check(await page.locator('.todo-item').count() === 2, 'typing its name finds them too');
await page.locator('.list-tools input.filter').fill('');
await sleep(300);
await item('ask about the oven').locator('.under a').click();
await sleep(500);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Hartley', 'a click on the page it’s under opens that page', await page.evaluate(() => location.hash));

console.log('the note menu: Show hidden properties');
await go(page, '#/page/Paper');
await page.waitForSelector('.outline .blk');
const dot = page.locator('.outline .blk', { has: page.locator(':scope > .bc', { hasText: 'a note with an id' }) }).first().locator(':scope > .bul');
await dot.click({ button: 'right' });
await page.waitForSelector('.note-menu');
const hidItem = page.locator('.note-menu .nm-item', { hasText: 'Show hidden properties' });
check(await hidItem.count() === 1, 'the menu has it (for a note with some)');
await hidItem.click();
await page.waitForSelector('.hid-props');
const props = await page.locator('.hid-props tr').allTextContents();
check(props.length === 2 && /id.*6528aaaa/.test(props[0]) && /collapsed.*false/.test(props[1]), 'lists id:: and collapsed:: with their values', JSON.stringify(props));
await sleep(500); // (the box's opening fade)
await page.screenshot({ path: SHOTS + '/b36-hidden.png' });
await page.locator('.modal [data-v="1"]').click(); // Copy
await sleep(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check(clip === 'id:: 6528aaaa-bbbb-4ccc-8ddd-eeeeffff7777\ncollapsed:: false', 'Copy: the lines as written', JSON.stringify(clip));
check(read('pages/Paper.md').includes('  id:: 6528aaaa-bbbb-4ccc-8ddd-eeeeffff7777\n  collapsed:: false\n'), 'and the file is untouched');
const other = page.locator('.outline .blk', { has: page.locator(':scope > .bc', { hasText: 'read it' }) }).first().locator(':scope > .bul');
await other.click({ button: 'right' });
await page.waitForSelector('.note-menu');
check(await page.locator('.note-menu .nm-item', { hasText: 'Show hidden properties' }).count() === 0, 'not for a note with none');
await page.keyboard.press('Escape');

console.log('Properties: Rename or merge… authors into author, in every note');
await go(page, '#/props/authors');
await page.locator('[data-a="rename"]').click();
await page.waitForSelector('.modal input');
await page.locator('.modal input').fill('id');
await page.locator('.modal [data-v="1"]').click();
await sleep(500);
check(/can't be renamed or merged|can’t be renamed or merged/.test(await page.locator('#toast').textContent()) && read('pages/Paper.md').includes('authors:: Mitchell'), 'refused: Logseq’s own names (nothing changed)', await page.locator('#toast').textContent());
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/props/authors', 'still on authors');
await page.locator('.modal [data-v="0"]').click().catch(() => {});
await page.locator('[data-a="rename"]').click();
await page.waitForSelector('.modal input');
await page.locator('.modal input').fill('author');
await page.locator('.modal [data-v="1"]').click();
await sleep(800);
const paper = read('pages/Paper.md');
check(paper.startsWith('author:: Mitchell\n') && /\n {2}author:: Hanson, Crutchfield\n/.test(paper) && !/authors::/.test(paper), 'renamed; a note with both keeps one line with both values', paper);
check(/Renamed in 1 file/.test(await page.locator('#toast').textContent()), 'says how many', await page.locator('#toast').textContent());
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/props/author', 'shows the merged property');
await sleep(500);
check(/Hanson, Crutchfield/.test(await page.locator('#view, main').first().textContent()), 'its page lists the merged values');
await go(page, '#/page/Paper');
await page.waitForSelector('.outline .blk');
check(/author/.test(await page.locator('.page-props').textContent()) && !/authors/.test(await page.locator('.page-props').textContent()), 'the page shows the new name', await page.locator('.page-props').textContent());

console.log('Check this folder: notes linking to pictures that aren’t there');
await go(page, '#/settings');
await page.locator('[data-a="check"]').click();
await page.waitForSelector('.missing-box', { timeout: 6000 });
const miss = await page.locator('.missing-box').textContent();
check(/Missing pictures/.test(miss) && /Shots/.test(miss) && /never-synced\.jpg/.test(miss) && !/dot\.png/.test(miss), 'Shots and its missing picture listed (not one that’s there)', miss);
check(!(await page.locator('.missing-box').textContent()).includes('Pictures nothing uses'), 'its own box, apart from the unused pictures');
await page.screenshot({ path: SHOTS + '/b36-missing.png', fullPage: true });
await page.locator('.missing-box a[data-page="Shots"]').click();
await sleep(500);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Shots', 'a click opens the page');

console.log('phone: pulling the page down from its top refreshes');
await browser.close();
{
  const { browser: b2, page: p2, errors: e2 } = await open({ viewport: { width: 390, height: 780 }, touch: true });
  await go(p2, '#/page/' + encodeURIComponent('Build list'));
  await p2.waitForSelector('.outline .blk');
  write('pages/Build list.md', read('pages/Build list.md') + '- pulled in\n');
  // a finger pulling down from near the top (CDP touch events, as a phone sends them)
  const cdp = await p2.context().newCDPSession(p2);
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }] });
  const pull = async (from, to) => { await touch('touchStart', from); for (let y = from + 10; y <= to; y += 15) { await touch('touchMove', y); await sleep(16); } await touch('touchEnd', to); await sleep(800); };
  await pull(160, 200);
  check(await p2.locator('.outline .blk > .bc', { hasText: 'pulled in' }).count() === 0, 'a short pull (40 px) doesn’t refresh');
  // scrolled down a long page: a pull is a scroll, not a refresh
  write('pages/Long.md', Array.from({ length: 80 }, (_, i) => `- line ${i}\n`).join(''));
  await go(p2, '#/page/Long');
  await p2.waitForSelector('.outline .blk');
  await p2.evaluate(() => document.scrollingElement.scrollTo(0, 600));
  await sleep(200);
  write('pages/Long.md', read('pages/Long.md') + '- long changed\n');
  await pull(200, 340);
  check(await p2.locator('.outline .blk > .bc', { hasText: 'long changed' }).count() === 0, 'not when the page is scrolled down');
  await p2.evaluate(() => document.scrollingElement.scrollTo(0, 0));
  await sleep(200);
  await pull(160, 300);
  await p2.waitForSelector('.outline .blk > .bc:has-text("long changed")', { timeout: 4000 }).catch(() => {});
  check(await p2.locator('.outline .blk > .bc', { hasText: 'long changed' }).count() === 1, 'back at the top: it does');
  await go(p2, '#/page/' + encodeURIComponent('Build list'));
  await p2.waitForSelector('.outline .blk');
  await touch('touchStart', 160);
  for (let y = 170; y <= 290; y += 15) { await touch('touchMove', y); await sleep(16); }
  await touch('touchEnd', 290);
  await p2.waitForSelector('.outline .blk > .bc:has-text("pulled in")', { timeout: 4000 }).catch(() => {});
  check(await p2.locator('.outline .blk > .bc', { hasText: 'pulled in' }).count() === 1, 'the change shows');
  // the pull-down's mark goes away after letting go
  check(!(await p2.locator('.pull-mark.on').count()), 'the mark is gone once it’s done');
  // Namespaces on a phone: the arrows are easy to tap, a tap unfolds
  await go(p2, '#/pages');
  const t2 = p2.locator('.chips [data-o="tree"]');
  if (await t2.getAttribute('aria-pressed') !== 'true') await t2.click();
  await sleep(200);
  const box = await p2.locator('.ns-fold').first().boundingBox();
  check(box && box.width >= 24 && box.height >= 30, 'phone: each arrow at least 24 × 30 px', JSON.stringify(box));
  await p2.locator('.ns-fold').first().tap();
  await sleep(200);
  check(await p2.locator('.tree-rows li').count() >= 3, 'phone: a tap unfolds');
  await p2.screenshot({ path: SHOTS + '/b36-namespaces-phone.png' });
  check(e2.length === 0, 'no page errors (phone)', e2.join('\n'));
  await b2.close();
}

// (made on purpose: the refused rename's 400, Shots' missing picture's 404)
const real = errors.filter((e) => !/^Failed to load resource: the server responded with a status of (400|404)/.test(e));
check(real.length === 0, 'no page errors', real.join('\n'));
process.exit(failures() ? 1 : 0);

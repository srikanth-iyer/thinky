// Build 61, three changes he asked for (Nov 25):
//  1. the note menu has a filter box at its top: typing finds any command, the "/" list's ones too, and
//     the colours and headings; More commands… opens on a click (or a tap) in the menu's own place, with a
//     way back, instead of beside it when the mouse rests on it ("not prominent enough");
//  2. "Move to page…" (in the menu, and Ctrl+Shift+M): a box to pick a page (today's journal and recent
//     pages first, a filter for the rest); the note goes there with all its sub-notes, at the end, and a
//     notice offers Undo and Open ("like how i can move a google task to another task list");
//  3. a note opened on its own (zoomed in): no big page title over it, only the small line of where it is
//     (page › parent notes), and the note itself at its normal size ("i don't want the focussed bullet to
//     become the new heading").
import { open, check, failures, sleep, go, read, write, readWhen } from './lib.mjs';

// two pages of our own, so nothing else in the sample folder changes
write('pages/Move me.md', '- first\n\t- child a\n\t- child b\n- second\n- third\n');
write('pages/Shelf.md', '- already here\n');

const { browser, page, errors } = await open();
const dot = (text) => page.locator('.outline .blk', { hasText: text }).first().locator(':scope > .bul');
const menuOn = async (text) => { await dot(text).click({ button: 'right' }); await page.waitForSelector('.note-menu'); };

console.log('1. the note menu: a filter at the top, More commands… opens in place');
await go(page, '#/page/Move me');
await page.waitForSelector('.outline .blk');
await menuOn('second');
const top = await page.evaluate(() => {
  const m = document.querySelector('.note-menu'), f = m.querySelector('.nm-find'), first = m.querySelector('.nm-item');
  return { has: !!f, focused: document.activeElement === f, above: f && first && f.getBoundingClientRect().bottom <= first.getBoundingClientRect().top + 1, ph: f?.placeholder };
});
check(top.has && top.above && top.focused, 'a filter box above the commands, ready to type in', JSON.stringify(top));
await page.keyboard.type('todo');
await sleep(150);
const found = await page.locator('.note-menu .nm-alt button:visible').allTextContents();
check(found.some((t) => /Next to-do state/.test(t)) && found.some((t) => /^TODO/.test(t)), 'typing finds the short list’s commands and the "/" list’s ones together', JSON.stringify(found));
await page.keyboard.press('Escape');
await sleep(150);
check(await page.locator('.note-menu').count() === 1 && await page.locator('.note-menu .nm-find').inputValue() === '' && await page.locator('.nm-main').isVisible(), 'Esc first clears the filter (the menu stays)');
await page.locator('.note-menu .nm-find').fill('red');
await sleep(150);
await page.locator('.note-menu .nm-alt button', { hasText: 'Background: Red' }).click();
const red = await readWhen('pages/Move me.md', (t) => /- second\n\s+background-color:: red/.test(t));
check(/- second\n\s+background-color:: red/.test(red), 'the colours can be found by name too', red);

await menuOn('third');
await page.locator('.note-menu button', { hasText: 'More commands' }).click();
await page.waitForSelector('.nm-alt .nm-cmd');
check(await page.locator('.nm-alt .nm-back').isVisible() && (await page.locator('.nm-alt .nm-cmd').count()) > 10 && await page.locator('.nm-main').isHidden(), 'a click on More commands…: its list in the same box, a way back on top');
await page.keyboard.press('Escape');
await sleep(150);
check(await page.locator('.note-menu').count() === 1 && await page.locator('.nm-main').isVisible(), 'Esc goes back to the short list first');
await page.keyboard.press('Escape');
await sleep(150);
check(await page.locator('.note-menu').count() === 0, 'then closes the menu');

console.log('2. Move to page…');
await menuOn('first');
const mv = page.locator('.note-menu .nm-item', { hasText: 'Move to page' });
check(await mv.count() === 1 && /Ctrl\+Shift\+M/i.test(await mv.textContent()), 'in the menu, with its shortcut beside it', await mv.textContent());
await mv.click();
await page.waitForSelector('.modal .pp-list .pp-row');
const box = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.modal .pp-row')].map((r) => r.textContent), focused: document.activeElement?.matches('.modal .pp-find') }));
check(/today/.test(box.rows[0] || '') && box.focused, 'a box to pick a page: today’s journal first, the filter ready', JSON.stringify(box));
check(!box.rows.some((r) => /^Move me/.test(r)), 'the page it’s on isn’t offered', JSON.stringify(box.rows));
await page.locator('.modal .pp-find').fill('shel');
await sleep(150);
check(/^Shelf/.test(await page.locator('.modal .pp-row').first().textContent()), 'typing narrows the list');
await page.keyboard.press('Enter');
const shelf = await readWhen('pages/Shelf.md', (t) => t.includes('first'));
const left = await readWhen('pages/Move me.md', (t) => !t.includes('first'));
check(shelf === '- already here\n- first\n\t- child a\n\t- child b\n', 'the note goes to the end of that page with all its sub-notes', shelf);
check(!left.includes('first') && !left.includes('child') && left.includes('- second'), 'and leaves the page it was on', left);
const toast = await page.locator('#toast').textContent();
check(await page.locator('#toast button', { hasText: 'Undo' }).count() === 1 && await page.locator('#toast button', { hasText: 'Open' }).count() === 1, 'a notice with Undo and Open', toast);
await page.locator('#toast button', { hasText: 'Undo' }).click();
const back = await readWhen('pages/Move me.md', (t) => t.includes('first'));
check(back.startsWith('- first\n\t- child a\n\t- child b\n') && (await readWhen('pages/Shelf.md', (t) => !t.includes('first'))) === '- already here\n', 'Undo puts it back on both pages', back);

console.log('2b. the shortcut, while typing in a note');
await sleep(500);
const third = page.locator('.outline .blk > .bc', { hasText: 'third' }).first();
await third.click();
await page.waitForSelector('textarea.ed');
await page.keyboard.press('Control+Shift+KeyM');
await page.waitForSelector('.modal .pp-find');
check(true, 'Ctrl+Shift+M opens the same box');
await page.locator('.modal .pp-find').fill('Shelf');
await sleep(150);
await page.locator('.modal .pp-row', { hasText: 'Shelf' }).first().click();
const shelf2 = await readWhen('pages/Shelf.md', (t) => t.includes('third'));
check(shelf2.endsWith('- third\n'), 'it moves that note', shelf2);
await page.locator('#toast button', { hasText: 'Open' }).click();
await page.waitForFunction(() => decodeURIComponent(location.hash).includes('Shelf'));
check(true, 'Open goes to the page it went to');

console.log('3. a note opened on its own: no big title, the note at its normal size');
await go(page, '#/page/Sourdough Bread');
await page.waitForSelector('.outline .blk');
const normal = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.outline .blk > .bc')).fontSize));
// (a click on a note's dot opens it on its own)
await dot('Mix, fold, rest, shape').click();
await page.waitForSelector('.sheet.zoomed-in');
await sleep(300);
const z = await page.evaluate(() => {
  const s = document.querySelector('.sheet.zoomed-in'), head = s.querySelector('.page-head'), crumbs = s.querySelector('.crumbs');
  const root = s.querySelector('.outline .blk > .bc');
  return { headShown: !!head && head.getBoundingClientRect().height > 0, crumbs: crumbs?.textContent || '', rootSize: parseFloat(getComputedStyle(root).fontSize), root: root.textContent };
});
check(!z.headShown, 'the big page title, its properties box and buttons are hidden', JSON.stringify(z));
check(/Sourdough Bread/.test(z.crumbs), 'the small line of where it is names the page', z.crumbs);
check(/Mix, fold/.test(z.root) && Math.abs(z.rootSize - normal) < 0.5, 'the note itself at its normal size, ready to edit', JSON.stringify({ normal, ...z }));
// the page's ✦ and ⋯ buttons stay, at the right end of the line of links, so the page actions are still there
const b = await page.evaluate(() => {
  const s = document.querySelector('.sheet.zoomed-in'), more = s.querySelector('.title-row [data-a="more"]'), crumbs = s.querySelector('.crumbs');
  const m = more.getBoundingClientRect(), c = crumbs.getBoundingClientRect(), t = s.querySelector('.page-title').getBoundingClientRect();
  const r = document.createRange(); r.selectNodeContents(crumbs); const words = r.getBoundingClientRect(); // (where the links' words end)
  return { titleH: t.height, mh: m.height, mid: (m.top + m.bottom) / 2, ctop: c.top, cbot: c.bottom, mleft: m.left, wordsRight: words.right };
});
check(b.titleH === 0 && b.mh > 0, 'the page name is hidden but its ⋯ button shows', JSON.stringify(b));
check(b.mid >= b.ctop && b.mid <= b.cbot && b.wordsRight < b.mleft, 'on the line of links, at its end, clear of the words', JSON.stringify(b));
await page.locator('.sheet.zoomed-in .title-row [data-a="more"]').click();
await page.waitForSelector('.pop.menu button');
check(await page.locator('.pop.menu button', { hasText: 'History' }).count() === 1, 'and opens the page’s menu (History… and the rest)');
await page.keyboard.press('Escape');
await sleep(150);
await page.locator('.sheet.zoomed-in .crumbs a', { hasText: 'Sourdough Bread' }).first().click();
await page.waitForFunction(() => !document.querySelector('.sheet.zoomed-in'));
check(await page.locator('.page-head').first().isVisible(), 'its page name goes back to the whole page, title and all');

check(errors.length === 0, 'no script errors', errors.join('\n'));
await browser.close();

console.log('3b. on a phone too: the ✦ and ⋯ buttons sit on the line of links when zoomed in');
{
  const { browser: b3, page: p3 } = await open({ touch: true, viewport: { width: 390, height: 800 } });
  await go(p3, '#/zoom/Sourdough%20Bread/2');
  await p3.waitForSelector('.sheet.zoomed-in');
  await sleep(300);
  const pb = await p3.evaluate(() => {
    const s = document.querySelector('.sheet.zoomed-in'), m = s.querySelector('.title-row [data-a="more"]').getBoundingClientRect(), c = s.querySelector('.crumbs').getBoundingClientRect();
    return { mid: (m.top + m.bottom) / 2, ctop: c.top, cbot: c.bottom, right: m.right, w: innerWidth };
  });
  check(pb.mid >= pb.ctop && pb.mid <= pb.cbot && pb.right <= pb.w, 'centred on the line, inside the screen', JSON.stringify(pb));
  await b3.close();
}

console.log('4. a thin scroll bar: in More commands, the menu and the Move to page list ("its more for indication", Nov 25)');
{
  const { browser: b2, page: p2 } = await open({ scrollbars: true, viewport: { width: 1100, height: 600 } });
  await go(p2, '#/page/Move me');
  await p2.waitForSelector('.outline .blk');
  await p2.locator('.outline .blk').first().locator(':scope > .bul').click({ button: 'right' });
  await p2.waitForSelector('.note-menu');
  await p2.locator('.note-menu button', { hasText: 'More commands' }).click();
  await p2.waitForSelector('.nm-alt .nm-cmd');
  const bar = await p2.evaluate(() => { const a = document.querySelector('.note-menu .nm-alt'); return { w: a.offsetWidth - a.clientWidth, scrolls: a.scrollHeight > a.clientHeight }; });
  check(bar.scrolls && bar.w > 0 && bar.w <= 5, 'More commands scrolls with a thin bar (4px; it was 15)', JSON.stringify(bar));
  await b2.close();
}
process.exit(failures() ? 1 : 0);

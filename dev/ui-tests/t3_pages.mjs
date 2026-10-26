// Pages: rename, delete (one and many), the bin, All pages switches, unlinked references,
// to-dos list, back and forward buttons, favourites, search, sidebar, text size, settings.
import { open, read, write, exists, check, failures, sleep, go } from './lib.mjs';
const { browser, page, errors } = await open();
const today = new Date();
const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

console.log('rename a page: links follow');
await go(page, '#/page/Dumplings%20recipe');
await page.locator('[data-a="more"]').click();
await page.locator('.menu button', { hasText: 'Rename' }).click();
await page.locator('.modal input').fill("Grandma's dumplings");
await page.locator('.modal [data-v="1"]').click();
await sleep(900);
check(exists("pages/Grandma's dumplings.md") && !exists('pages/Dumplings recipe.md'), 'file renamed');
check(read(`Diary/${title(yesterday)}.md`).includes("[[Grandma's dumplings]]"), 'link in the journal updated', read(`Diary/${title(yesterday)}.md`));
check(decodeURIComponent(await page.evaluate(() => location.hash)) === "#/page/Grandma's dumplings", 'now showing the renamed page');

console.log('rename clash is refused');
await page.locator('[data-a="more"]').click();
await page.locator('.menu button', { hasText: 'Rename' }).click();
await page.locator('.modal input').fill('sourdough bread');
await page.locator('.modal [data-v="1"]').click();
await sleep(500);
check((await page.locator('#toast').textContent()).includes('already a page'), 'clash message', await page.locator('#toast').textContent());
check(exists("pages/Grandma's dumplings.md"), 'nothing renamed');

console.log('a new page whose file name another page has (by its title::) gets a file of its own');
write('pages/bar.md', 'title:: Foo\n- notes of Foo\n');
write('pages/Links to bar.md', '- see [[bar]]\n');
write('pages/baz.md', 'title:: Qux\n- notes of Qux\n');
write('pages/Thing.md', '- a thing\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(500);
await go(page, '#/page/Links%20to%20bar');
await page.locator('.outline a[data-page]', { hasText: 'bar' }).first().click();
await sleep(700);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/bar', 'following [[bar]] opens the page "bar"', await page.evaluate(() => location.hash));
const barShown = await page.locator('#main .outline').first().textContent();
check(!barShown.includes('notes of Foo'), 'it is an empty new page, not Foo’s notes', barShown);
await page.locator('#main .outline .blk > .bc').first().click();
await page.waitForSelector('textarea.ed');
await page.keyboard.type('first words of bar');
await sleep(1300);
check(read('pages/bar.md') === 'title:: Foo\n- notes of Foo\n', 'Foo’s file is untouched', read('pages/bar.md'));
check(exists('pages/bar (2).md') && read('pages/bar (2).md') === 'title:: bar\n- first words of bar\n', 'the first save makes “bar (2).md” with title:: bar', exists('pages/bar (2).md') ? read('pages/bar (2).md') : 'no such file');
await page.keyboard.press('Escape');
await sleep(300);
await go(page, '#/page/Thing');
await page.locator('[data-a="more"]').click();
await page.locator('.menu button', { hasText: 'Rename' }).click();
await page.locator('.modal input').fill('baz');
await page.locator('.modal [data-v="1"]').click();
await sleep(900);
check(!exists('pages/Thing.md') && exists('pages/baz (2).md') && read('pages/baz (2).md') === 'title:: baz\n- a thing\n', 'renaming a page onto such a name: “baz (2).md” with title:: baz', exists('pages/baz (2).md') ? read('pages/baz (2).md') : 'no such file');
check(read('pages/baz.md') === 'title:: Qux\n- notes of Qux\n' && decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/baz', 'the other page’s file is untouched; the renamed page shows', await page.evaluate(() => location.hash));

console.log('delete one page from its menu, restore it from Settings');
await go(page, '#/page/Orphan%20page');
await page.locator('[data-a="more"]').click();
await page.locator('.menu button', { hasText: 'Delete' }).click();
await page.locator('.modal [data-v="1"]').click();
await sleep(800);
check(!exists('pages/Orphan page.md') && exists('logseq/.recycle/pages_Orphan page.md'), 'moved to logseq/.recycle');
await go(page, '#/settings/notes');
await sleep(400);
await page.locator('.bin button', { hasText: 'Restore' }).first().click();
await sleep(600);
check(exists('pages/Orphan page.md'), 'restored from the bin');

console.log('All pages: switches, select many, delete');
await go(page, '#/pages');
let names = await page.locator('.rows a span:not(.meta)').allTextContents();
check(!names.includes('Hartley'), 'pages without a file are hidden by default', names.join('|'));
await page.locator('[data-o="ghosts"]').click();
await sleep(200);
names = await page.locator('.rows a span:not(.meta)').allTextContents();
check(names.includes('Hartley'), 'switch shows pages without a file');
await page.locator('[data-o="ghosts"]').click();
await page.locator('[data-o="orphans"]').click();
await sleep(200);
names = await page.locator('.rows a span:not(.meta)').allTextContents();
check(names.includes('Orphan page') && !names.includes('Marta Pell'), 'only pages nothing links to', names.join('|'));
await page.locator('[data-o="orphans"]').click();
await page.locator('[data-o="tree"]').click();
await sleep(200);
const tree = await page.locator('.tree-rows li').evaluateAll((lis) => lis.map((li) => li.style.getPropertyValue('--d') + ':' + li.textContent.trim().split('\n')[0].trim()));
check(tree.some((t) => t.startsWith('1:') && t.includes('Spice jars')) && tree.some((t) => t.startsWith('2:') && t.includes('notes')), 'namespace tree nests APRON/Spice jars/notes', tree.join('|'));
await page.locator('[data-o="tree"]').click();
await page.locator('[data-a="select"]').click();
await page.locator('.rows a', { hasText: 'Orphan page' }).click();
await page.locator('.rows a', { hasText: 'Market stall' }).click();
await page.locator('[data-a="delete"]').click();
await page.locator('.modal [data-v="1"]').click();
await sleep(800);
check(!exists('pages/Orphan page.md') && !exists('pages/Market stall.md'), 'two pages deleted at once');
check(exists('logseq/.recycle/pages_Market stall.md'), 'both in the bin');

console.log('unlinked references');
await go(page, '#/page/Marta%20Pell');
await page.locator('.unlinked .disclose').click();
await sleep(500);
const hits = await page.locator('.unlinked .refhit').allTextContents();
check(hits.some((t) => t.includes('marta pell argued')), 'plain mention found', hits.join('|'));
await page.locator('.unlinked .refhit', { hasText: 'marta pell argued' }).locator('.linkit').click();
await sleep(600);
check(read('pages/Notes on Pell.md').startsWith('- [[marta pell]] argued'), 'Link turns it into a link', read('pages/Notes on Pell.md'));

console.log('to-dos list');
await go(page, '#/todos');
await sleep(300);
const items = await page.locator('.todo-item .bc').allTextContents();
check(items.some((t) => t.includes('overdue thing')) && items.some((t) => t.includes('next week thing')), 'open to-dos listed', items.length);
await page.locator('.todo-item', { hasText: 'next week thing' }).locator('.todo').click();
await sleep(700);
const tf = read('pages/Tasks.md');
check(/- LATER next week thing\n  SCHEDULED: <\d{4}-\d\d-\d\d \w{3} \.\+1w>/.test(tf) && !tf.includes('DONE next week'), 'repeating to-do moves to its next date', tf);
await page.locator('.todo-item', { hasText: 'overdue thing' }).locator('.todo').click();
await sleep(700);
check(read('pages/Tasks.md').includes('- DONE [#A] overdue thing'), 'ticking marks it DONE in the file', read('pages/Tasks.md'));
check(await page.locator('.todo-item', { hasText: 'overdue thing' }).count() === 0, 'and it leaves the open list');

console.log('back and forward buttons');
await go(page, '#/page/Sourdough%20Bread');
await go(page, '#/page/Maths');
const hashNow = async () => decodeURIComponent(await page.evaluate(() => location.hash));
check(await page.locator('#histbar [data-h="forward"]').isDisabled(), 'forward is greyed out with nothing ahead');
await page.locator('#histbar [data-h="back"]').click();
await sleep(500);
check(await hashNow() === '#/page/Sourdough Bread', 'back goes to the page before', await hashNow());
check(!(await page.locator('#histbar [data-h="forward"]').isDisabled()), 'forward works after going back');
await page.locator('#histbar [data-h="forward"]').click();
await sleep(500);
check(await hashNow() === '#/page/Maths', 'forward goes ahead again', await hashNow());
check(await page.locator('.nav a[data-view="calendar"]').count() === 0, 'no Calendar tab');

console.log('+ properties shows on hover and opens the properties box');
await go(page, '#/page/Marta%20Pell');
const addp = page.locator('.page-props .add-props');
check(await addp.count() === 1 && (await addp.textContent()) === '+ properties', 'a page without properties offers "+ properties"');
check(await addp.evaluate((b) => getComputedStyle(b).opacity) === '0', 'hidden while not pointed at');
await page.locator('.page-props').hover();
await sleep(300);
check(await addp.evaluate((b) => getComputedStyle(b).opacity) === '1', 'appears when the pointer is over it');
await addp.click();
check(await page.locator('.page-props textarea.preamble-ed').count() === 1, 'clicking it opens the properties box');
await page.keyboard.press('Escape');
await sleep(300);

console.log('Go to date: dots on days with notes');
await go(page, '#/journals');
await page.locator('[data-a="date"]').click();
await page.waitForSelector('.datepick .cal-grid');
await sleep(400);
check(await page.locator('.datepick .day.mark').count() >= 1, 'days with notes have a dot', await page.locator('.datepick .day.mark').count());
check((await page.locator('.datepick .pop-note').textContent()).includes('Dots mark days with notes'), 'the picker says what the dots mean');
await page.keyboard.press('Escape');
await sleep(200);

console.log('favourites');
await go(page, '#/page/Pickles%20in%20brine');
await page.locator('[data-a="fav"]').click();
await sleep(500);
check(read('logseq/config.edn').includes(':favorites ["Sourdough Bread" "to read" "Pickles in brine"]'), 'favourite saved in config.edn', read('logseq/config.edn'));
check(await page.locator('#favs a', { hasText: 'Pickles in brine' }).count() === 1, 'shows in the sidebar');

console.log('Favourites and Recent fold away, and stay that way');
const recentHead = page.locator('#side .side-sec[data-sec="recent"] .side-fold');
await recentHead.click();
await sleep(200);
check(!(await page.locator('#recent').isVisible()), 'Recent folds away');
check(await page.locator('#favs .side-list').isVisible(), 'Favourites stays open');
await page.locator('#side .side-sec[data-sec="favs"] .side-fold').click();
await sleep(200);
check(!(await page.locator('#favs .side-list').isVisible()), 'Favourites folds away');
await page.reload();
await page.waitForSelector('#side .side-sec[data-sec="recent"]');
await sleep(500);
check(!(await page.locator('#recent').isVisible()) && !(await page.locator('#favs .side-list').isVisible()), 'still folded after a restart');
await page.locator('#side .side-sec[data-sec="recent"] .side-fold').click();
await page.locator('#side .side-sec[data-sec="favs"] .side-fold').click();
await sleep(200);
check(await page.locator('#recent').isVisible() && await page.locator('#favs .side-list').isVisible(), 'and open again');

console.log('journals: older days load by themselves while scrolling');
for (let k = 3; k <= 26; k++) { const d = new Date(today); d.setDate(today.getDate() - k); write(`Diary/${title(d)}.md`, `- note from ${k} days ago\n`); }
await page.reload();
await page.waitForSelector('.sheet .outline');
await go(page, '#/journals');
await sleep(800);
await page.mouse.move(760, 500); // over the notes: in a wide window only they scroll
for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, 6000); await sleep(500); }
const shown = await page.locator('#main .view > div > section.sheet').count();
check(shown >= 25, 'scrolling to the end keeps loading older days (no button needed)', shown);

console.log('wide window: only the notes scroll, below the top strip');
const lay = await page.evaluate(() => {
  const m = document.querySelector('#main'), r = m.getBoundingClientRect(), hb = document.querySelector('#histbar').getBoundingClientRect();
  return { scrolls: m.scrollHeight > m.clientHeight, docOver: document.scrollingElement.scrollHeight - innerHeight, top: r.top, hbBottom: hb.bottom, right: r.right, w: innerWidth };
});
check(lay.scrolls && lay.docOver <= 0, 'the notes scroll in their own area; the window itself never does', JSON.stringify(lay));
check(lay.top >= lay.hbBottom - 0.5 && lay.right >= lay.w - 0.5, 'that area (and its scroll bar) starts below the top strip and reaches the right edge', JSON.stringify(lay));
const brand = await page.evaluate(() => { const b = document.querySelector('#side .brand').getBoundingClientRect(), s = document.querySelector('#side').getBoundingClientRect(); return { top: b.top - s.top, left: b.left - s.left, short: s.width - b.width }; });
check(brand.top === 0 && brand.left === 0 && brand.short <= 1.5, 'the sidebar’s name strip reaches its top and sides (all of it moves the window)', JSON.stringify(brand));
check(await page.locator('[data-tauri-drag-region]').count() === 0, 'outside the Windows app nothing is marked for moving the window');
await page.locator('.nav a[data-view="journals"]').click(); // focus is now in the sidebar
await sleep(800);
await page.keyboard.press('PageDown');
await sleep(300);
const pd = await page.evaluate(() => document.querySelector('#main').scrollTop);
check(pd > 300, 'Page Down scrolls the notes, even right after clicking in the sidebar', pd);
await page.keyboard.press('Home');
await sleep(300);
check(await page.evaluate(() => document.querySelector('#main').scrollTop) === 0, 'Home goes back to the top');
await page.focus('#side [data-a="looks"]');
await page.keyboard.press(' ');
await sleep(300);
check(await page.locator('.pop.looks').count() === 1, 'Space still presses a focused button (it doesn’t scroll instead)');
await page.keyboard.press('ArrowDown');
await sleep(100);
check(await page.evaluate(() => !!document.activeElement.closest('.pop.looks')), 'arrows stay in an open list');
await page.keyboard.press('Escape');
await sleep(200);
for (let k = 0; k < 6; k++) await page.keyboard.press('Control+='); // text 130%
await sleep(200);
const big = await page.evaluate(async () => {
  const m = document.querySelector('#main');
  const count = () => m.querySelectorAll('section.sheet').length;
  let n = -1; // scroll to the end until no more older days arrive
  for (let k = 0; k < 20 && n !== count(); k++) { n = count(); m.scrollTo(0, 1e9); await new Promise((r) => setTimeout(r, 400)); }
  const last = [...m.querySelectorAll('section.sheet')].pop().getBoundingClientRect();
  return { scale: getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim(), atEnd: m.scrollTop + m.clientHeight >= m.scrollHeight - 2, lastBottom: Math.round(last.bottom), mainBottom: Math.round(m.getBoundingClientRect().bottom), h: innerHeight };
});
check(big.scale === '1.3' && big.atEnd && big.mainBottom <= big.h && big.lastBottom <= big.h, 'with bigger text the end of the notes can still be reached', JSON.stringify(big));
await page.keyboard.press('Control+0');
await page.emulateMedia({ media: 'print' });
const pr = await page.evaluate(() => ({ docH: document.scrollingElement.scrollHeight, h: innerHeight, ov: getComputedStyle(document.querySelector('#main')).overflowY }));
check(pr.ov === 'visible' && pr.docH > pr.h * 2, 'printing lays out the whole page, not just what fits the window', JSON.stringify(pr));
await page.emulateMedia({ media: 'screen' });

console.log('narrow window: the whole page scrolls; the closed menu stays out of sight');
await go(page, '#/journals');
await sleep(800);
await page.setViewportSize({ width: 600, height: 800 }); // wide → narrow without leaving the page
await sleep(500);
const nar = await page.evaluate(() => { const s = document.querySelector('#side'); return { docOver: document.scrollingElement.scrollHeight - innerHeight, ov: getComputedStyle(document.querySelector('#main')).overflowY, sideRight: Math.round(s.getBoundingClientRect().right), vis: getComputedStyle(s).visibility }; });
check(nar.docOver > 0 && nar.ov === 'visible', 'the page itself scrolls, as on the phone', JSON.stringify(nar));
check(nar.sideRight <= -40 && nar.vis === 'hidden', 'the closed menu is fully off screen (its shadow too) and skipped by Tab', JSON.stringify(nar));
await page.mouse.move(300, 500);
for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 6000); await sleep(400); }
const shownNarrow = await page.locator('#main .view > div > section.sheet').count();
check(shownNarrow >= 25, 'older days still load by themselves after the window got narrow', shownNarrow);
await page.locator('#topbar [data-a="menu"]').click();
await sleep(350);
check(await page.evaluate(() => { const s = document.querySelector('#side'); return getComputedStyle(s).visibility === 'visible' && s.getBoundingClientRect().left === 0; }), 'the menu button opens it');
await page.mouse.click(560, 400); // on the dimmed page beside it
await sleep(350);
check(await page.evaluate(() => getComputedStyle(document.querySelector('#side')).visibility === 'hidden'), 'a click beside it closes it again');
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(300);

console.log('sidebar: fits the window, Recent shows only what fits');
for (const n of ['Sourdough Bread', 'Maths', 'Pictures', 'APRON', 'Tasks', 'Templates', 'Marta Pell', 'Rosa Penhallow', 'Orphan page', 'Pickles in brine']) await go(page, '#/page/' + encodeURIComponent(n));
await page.setViewportSize({ width: 1280, height: 560 });
await sleep(500);
const fit = await page.evaluate(() => { const s = document.querySelector('#side'); const r = document.querySelector('#recent'); const vis = [...r.querySelectorAll('a')].filter((a) => !a.hidden); const rb = r.getBoundingClientRect().bottom; return { over: s.scrollHeight - s.clientHeight, shown: vis.length, all: r.querySelectorAll('a').length, cut: vis.some((a) => a.getBoundingClientRect().bottom > rb + 0.5) }; });
check(fit.over <= 1, 'no scroll bar in the sidebar', JSON.stringify(fit));
check(fit.shown < fit.all && fit.shown >= 1 && !fit.cut, 'Recent shows only whole items that fit', JSON.stringify(fit));
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(400);
const fit2 = await page.evaluate(() => [...document.querySelectorAll('#recent a')].filter((a) => !a.hidden).length);
check(fit2 > fit.shown, 'a taller window shows more', fit2);

console.log('search, sidebar, text size, shortcuts');
await page.keyboard.press('Control+k');
await page.keyboard.type('spice order');
await sleep(400);
check((await page.locator('.results li').allTextContents()).some((t) => t.includes('spice order')), 'search finds text');
await page.keyboard.press('Escape');
await page.keyboard.press('t');
await page.keyboard.press('l');
await sleep(200);
check(await page.evaluate(() => document.body.classList.contains('side-hidden')), '"t l" hides the sidebar');
await page.locator('.show-side').click();
check(!(await page.evaluate(() => document.body.classList.contains('side-hidden'))), 'button brings it back');
await page.keyboard.press('Control+=');
await sleep(100);
check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim()) === '1.05', 'Ctrl+= makes text bigger');
await page.keyboard.press('Control+0');
await page.keyboard.press('g');
await page.keyboard.press('t');
await sleep(400);
check(await page.evaluate(() => location.hash) === '#/todos', '"g t" opens to-dos');

console.log('settings: tabs, quick capture format, check, problems');
await go(page, '#/settings');
await sleep(400);
const tabs = await page.locator('.set-tabs [data-tab]').allTextContents();
check(tabs.join('|') === 'Notes|Look|Capture|Shortcuts|About', 'Settings has tabs', tabs.join('|'));
check(await page.locator('.set-tabs [aria-selected="true"]').textContent() === 'Notes' && await page.locator('[data-a="check"]').isVisible() && !(await page.locator('.skin-card').count()),
  'it opens on Notes, showing only that');
await page.locator('.set-tabs [data-tab="capture"]').click();
await sleep(300);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/settings/capture' && await page.locator('[data-f="text"]').isVisible() && !(await page.locator('[data-a="check"]').isVisible()),
  'a tab shows its own settings, and the address says which');
await page.locator('[data-f="text"]').fill('{text} — {url} ({time})');
await page.locator('.card [data-a="save"]').click();
await sleep(500);
check(read('logseq/config.edn').includes(':quick-capture-templates {:text "{text} — {url} ({time})" :media "**{time}** [[quick capture]]: #inbox {url}"}'), 'capture format written to config.edn', read('logseq/config.edn'));
await go(page, '#/journals');
await go(page, '#/settings');
await sleep(300);
check(await page.locator('.set-tabs [aria-selected="true"]').textContent() === 'Capture', 'the last tab is remembered');
await page.locator('.set-tabs [data-tab="notes"]').click();
await sleep(300);
await page.locator('[data-a="check"]').click();
await sleep(800);
check((await page.locator('.check-out').textContent()).includes('Longest pages'), 'folder check reports', await page.locator('.check-out').textContent());
// two tabs picked in quick succession (the first still being built): only the last one shows
await page.evaluate(() => { document.querySelector('.set-tabs [data-tab="about"]').click(); document.querySelector('.set-tabs [data-tab="keys"]').click(); });
await sleep(600);
const shownPanels = await page.locator(".set-panel:not([hidden])").evaluateAll((ps) => ps.map((p) => p.id));
check(shownPanels.join() === "sp-keys" && decodeURIComponent(await page.evaluate(() => location.hash)) === '#/settings/keys', "quick clicks: only the last tab shows", shownPanels.join() + ' ' + await page.evaluate(() => location.hash));
// Settings in the sidebar while already in Settings: no extra step for Back
const steps = await page.evaluate(() => history.length);
await page.locator('#side a[data-view="settings"]').click();
await sleep(400);
check(await page.evaluate(() => history.length) === steps && decodeURIComponent(await page.evaluate(() => location.hash)) === '#/settings/keys', 'Settings again: stays put, no extra Back step');
check(await page.locator('#update').getAttribute('href') === '#/settings/about', '"A newer version is ready" opens About (where the update is)');

console.log('hover preview');
await go(page, `#/page/${encodeURIComponent(title(today))}`);
await page.locator('.bc a.pl', { hasText: 'Rosa Penhallow' }).first().hover();
await sleep(900);
check(await page.locator('.pop.preview:not([hidden])').count() === 1 && (await page.locator('.pop.preview').textContent()).includes('Baker'), 'preview shows the linked page');

const unexpected = errors.filter((e) => !e.includes('status of 400')); // the refused rename answers 400
console.log(unexpected.length ? 'script errors:\n' + unexpected.join('\n') : 'no script errors');
await browser.close();
process.exit(failures() ? 1 : 0);

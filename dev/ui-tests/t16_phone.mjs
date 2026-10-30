// The phone's chrome made quieter (Build 32): compact pop-ups close to where they were opened (the
// note menu from a held dot and from the toolbar's ⋯, the "/" list and the toolbar's date menu: one
// column, rows close together, as he asked; a page's ⋯; the look list), the search box where it was,
// over the darkened page, but more compact; a thinner top
// bar with the same buttons, and a thinner editing toolbar; the menu drawer about three quarters wide
// under the top bar (its button lit, and closing it again; a tap beside it, a swipe to the left and
// Back close it too); the "+" small and quiet, stepping aside while a finger scrolls down and back on
// the way up. Laptop menus as before.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, write, read, BASE, VAULT, SHOTS } from './lib.mjs';

write('pages/Phone menus.md', '- first note here\n- second note\n\t- its child\n- third note\n');
write('pages/Long phone.md', Array.from({ length: 80 }, (_, k) => `- long note ${k + 1}\n`).join(''));
const W = 390, H = 844;
const allErrors = [];
async function phone(look = 'calm', hash = '#/journals') {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/');
  await page.evaluate(([v, l]) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify(l)); }, [VAULT, look]);
  await page.goto(BASE + '/?t=' + Date.now() + hash);
  await page.waitForSelector('#main .view > *');
  await sleep(900);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  return { browser, page, errors, touch };
}
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) } : null; }, sel);
const heights = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().height)));
const onScreen = (r) => r && r.x >= 0 && r.y >= 0 && r.r <= W && r.b <= H;
async function edit(page, text) {
  await page.locator('.outline .blk > .bc', { hasText: text }).first().tap();
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('End');
  await sleep(200);
}

// --------------------------------------------------------------------------------------------
console.log('the top bar: thinner, the same buttons');
let { browser, page, errors, touch } = await phone();
const bar = await rect(page, '#topbar');
const btns = await page.$$eval('#topbar > button', (bs) => bs.filter((b) => b.offsetParent).map((b) => [b.dataset.a || b.dataset.h, Math.round(b.getBoundingClientRect().height), Math.round(b.getBoundingClientRect().width)]));
check(bar.h <= 46 && bar.y === 0, 'the bar is at most 46px tall (it was 55)', JSON.stringify(bar));
check(btns.map((b) => b[0]).join() === 'menu,home,back,forward,date,search' && btns.every(([, hh]) => hh >= 44), 'the same buttons, each a finger tall', JSON.stringify(btns));
check(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#topbar .t')).fontSize)) >= 15, 'the title is as readable as before');

console.log('the menu drawer: about three quarters wide, under the top bar');
const menuBtn = page.locator('#topbar [data-a="menu"]');
await menuBtn.tap();
await sleep(400);
let side = await rect(page, '#side');
const top = await rect(page, '#topbar');
check(side.w <= W * 0.75 && side.w <= 300 && side.w >= 240 && side.x === 0, 'narrower: the rest of the screen shows beside it', JSON.stringify(side));
check(Math.abs(side.y - top.b) <= 1 && await menuBtn.getAttribute('aria-expanded') === 'true', 'it opens under the top bar, which stays as it is; the menu button says it’s open', JSON.stringify({ side, top }));
const hitMenu = await page.evaluate(() => { const r = document.querySelector('#topbar [data-a="menu"]').getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button')?.dataset.a; });
check(hitMenu === 'menu', 'the menu button can still be tapped', hitMenu);
await page.screenshot({ path: SHOTS + '/phone16-drawer.png' });
await menuBtn.tap();
await sleep(400);
check(!(await page.evaluate(() => document.body.classList.contains('drawer'))) && await menuBtn.getAttribute('aria-expanded') === 'false', 'tapping it again closes it');
await menuBtn.tap();
await sleep(400);
await page.touchscreen.tap(W - 30, 500);
await sleep(400);
check(!(await page.evaluate(() => document.body.classList.contains('drawer'))), 'a tap on the dimmed page beside it closes it');
await menuBtn.tap();
await sleep(400);
await touch('touchStart', 200, 400);
for (let k = 1; k <= 8; k++) { await touch('touchMove', 200 - k * 15, 402); await sleep(16); }
await touch('touchEnd');
await sleep(400);
check(!(await page.evaluate(() => document.body.classList.contains('drawer'))), 'a swipe to the left closes it');
await menuBtn.tap();
await sleep(400);
await page.evaluate(() => window.leanApp.onBack());
await sleep(400);
check(!(await page.evaluate(() => document.body.classList.contains('drawer'))) && await page.evaluate(() => location.hash) === '#/journals', 'Android’s Back closes it (and stays on the page)');
await touch('touchStart', 6, 400);
for (let k = 1; k <= 8; k++) { await touch('touchMove', 6 + k * 15, 402); await sleep(16); }
await touch('touchEnd');
await sleep(400);
check(await page.evaluate(() => document.body.classList.contains('drawer')), 'a swipe in from the left edge still opens it');
// the look list from it: compact, the drawer stays
await page.locator('#side [data-a="looks"]').tap();
await sleep(400);
const looks = await rect(page, '.pop.looks');
check(looks && looks.h <= H * 0.62 && looks.w <= 290 && onScreen(looks) && Math.min(...await heights(page, '.looks [data-look]')) >= 44, 'the look list: about half the screen at most (it scrolls), rows a finger tall', JSON.stringify(looks));
await page.screenshot({ path: SHOTS + '/phone16-looks.png' });
await page.keyboard.press('Escape');
await page.evaluate(() => document.body.classList.remove('drawer'));
await sleep(300);

console.log('the "+": small and quiet, out of the way while scrolling down');
const fab = await page.evaluate(() => {
  const b = document.querySelector('#addnote'), cs = getComputedStyle(b), r = b.getBoundingClientRect();
  const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.append(probe);
  const accent = getComputedStyle(probe).color; probe.style.color = 'var(--ink)'; const look = getComputedStyle(probe).color; probe.remove();
  return { w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, accent, look, ink: cs.color, shadow: cs.boxShadow };
});
check(fab.w >= 44 && fab.w <= 48 && fab.h === fab.w, 'smaller (it was 56px), still a finger wide', JSON.stringify(fab));
check(fab.bg !== fab.accent && fab.ink === fab.look && fab.shadow !== 'none', 'no filled disc: a quiet one with a soft shadow, the “+” in the look’s ink (the logo’s pen line, Build 32: t16_logo)', JSON.stringify(fab));
await page.screenshot({ path: SHOTS + '/phone16-plus.png' });
await page.evaluate(() => { location.hash = '#/page/Long phone'; });
await sleep(900);
const swipe = async (from, to) => { await touch('touchStart', 200, from); for (let k = 1; k <= 10; k++) { await touch('touchMove', 200, from + (to - from) * k / 10); await sleep(16); } await touch('touchEnd'); await sleep(450); };
await swipe(650, 250);
check(await page.evaluate(() => scrollY > 100 && document.querySelector('#addnote').classList.contains('away')), 'a finger scrolling down: it steps aside', await page.evaluate(() => scrollY));
await swipe(300, 450);
check(!(await page.evaluate(() => document.querySelector('#addnote').classList.contains('away'))), 'scrolling back up: it’s back');
await sleep(1100); // (a scroll right after the finger lifts is its fling: that counts as the finger's)
await page.evaluate(() => window.scrollTo(0, 3000));
await sleep(300);
check(!(await page.evaluate(() => document.querySelector('#addnote').classList.contains('away'))), 'the app’s own scrolling leaves it as it is');
await page.locator('#addnote').tap();
await sleep(400);
check(await page.evaluate(() => document.activeElement?.matches('textarea.ed')), 'a tap still adds a note to type in');
await page.evaluate(() => { const a = window.leanApp; a.outlines.forEach((o) => { o.stopEdit(); o.clearSel(); }); document.activeElement?.blur(); a.updateToolbar(); });
await sleep(1200);
check(errors.length === 0, 'no script errors', errors.join('\n'));
allErrors.push(...errors);
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('the note menu: one column, rows close together, small colour dots, by the dot or by the toolbar’s ⋯');
({ browser, page, errors, touch } = await phone('calm', '#/page/Phone menus'));
const dot = await page.locator('.outline .blk > .bul').nth(1).boundingBox();
await touch('touchStart', dot.x + dot.width / 2, dot.y + dot.height / 2);
await sleep(650);
await touch('touchEnd');
await sleep(450);
let nm = await rect(page, '.note-menu');
const items = await page.$$eval('.note-menu .nm-item', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.height), b.querySelector('.nm-l').textContent]; }));
check(nm.w <= 300 && nm.h <= H * 0.5 && onScreen(nm), 'small: at most 300px wide and half the screen tall (it was 340 × 600)', JSON.stringify(nm));
check(new Set(items.map((it) => it[0])).size === 1 && items.every((it, k) => !k || it[1] > items[k - 1][1]), 'one column', JSON.stringify(items));
check(items.every(([, , hh]) => hh >= 32 && hh <= 36), 'rows close together (32px; they were 44) and still easy to tap', JSON.stringify(items));
check(items.some((it) => it[3] === 'Copy link to this note'), 'full names', JSON.stringify(items.map((it) => it[3])));
const sw = await page.evaluate(() => { const b = document.querySelectorAll('.note-menu .nm-sw')[2], r = b.getBoundingClientRect(); return { w: Math.round(r.width), hitAbove: document.elementFromPoint(r.left + r.width / 2, r.top - 5) === b, hitSide: document.elementFromPoint(r.right + 5, r.top + r.height / 2) === b }; });
check(sw.w <= 22 && sw.hitAbove && sw.hitSide, 'small colour dots (20px; they were 32), each one easy to hit a little past its edge', JSON.stringify(sw));
check(nm.y >= dot.y + dot.height - 2 && nm.y - (dot.y + dot.height) <= 20, 'right under the dot that was held', JSON.stringify({ nm, dot }));
await page.screenshot({ path: SHOTS + '/phone16-notemenu-hold.png' });
await page.locator('.note-menu .nm-item', { hasText: 'Next to-do state' }).tap();
await sleep(1200);
check(read('pages/Phone menus.md').includes('- TODO second note\n'), 'its buttons work as before', read('pages/Phone menus.md'));
await edit(page, 'third note');
const tbar = await rect(page, '#toolbar');
check(tbar.h <= 46 && tbar.b === H && Math.min(...await heights(page, '#toolbar button')) >= 44, 'the editing toolbar: thinner (it was 51px), its buttons a finger tall', JSON.stringify(tbar));
const more = await rect(page, '#toolbar [data-t="more"]');
await page.locator('#toolbar [data-t="more"]').tap();
await sleep(500);
nm = await rect(page, '.note-menu');
check(nm && nm.b <= more.y && more.y - nm.b <= 12 && nm.h <= H * 0.5, 'the toolbar’s ⋯: right above its button, small', JSON.stringify({ nm, more }));
check(await page.evaluate(() => document.activeElement?.matches('textarea.ed')), 'the keyboard stays up (the note keeps it)');
await page.screenshot({ path: SHOTS + '/phone16-notemenu-toolbar.png' });
await page.evaluate(() => window.leanApp.closeTop());
await sleep(300);

console.log('the "/" list and the date menu: one column, rows close together');
await page.locator('#toolbar [data-t="slash"]').tap();
await sleep(400);
const ac = await rect(page, '#ac');
const caret = await page.evaluate(() => document.querySelector('textarea.ed').getBoundingClientRect().bottom);
const acRows = await heights(page, '#ac li');
check(ac && ac.h <= 290 && ac.w <= 300 && onScreen(ac) && acRows.length > ac.h / 36, 'the "/" list: more rows showing than before (8½ in 280px; it was 6½ in 300), the rest scrolls', JSON.stringify({ ac, n: acRows.length }));
check(Math.min(...acRows) >= 32 && Math.max(...acRows.slice(0, 8)) <= 34, 'its rows close together (32px; they were 44)', JSON.stringify(acRows));
check(Math.abs(ac.y - caret) <= 40 || Math.abs(ac.b - caret) <= 60, 'by the note being typed in', JSON.stringify({ ac, caret }));
await page.screenshot({ path: SHOTS + '/phone16-slash.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace');
await page.locator('#toolbar [data-t="date"]').tap();
await sleep(400);
const dm = await rect(page, '.pop.menu.tb-menu');
const dmb = await page.$$eval('.pop.menu.tb-menu button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; }));
const date = await rect(page, '#toolbar [data-t="date"]');
const dmh = await page.$$eval('.pop.menu.tb-menu .m-head', (hs) => hs.map((x) => [x.textContent, getComputedStyle(x).textTransform, Math.round(x.getBoundingClientRect().height)]));
check(dm.h <= 270 && dm.w <= 260 && dmb.length === 6 && dmb.every(([, hh]) => hh >= 32 && hh <= 34) && dmb.every(([t], k) => !k || t > dmb[k - 1][0]), 'the date menu: one column, rows close together (32px; it was 290px tall)', JSON.stringify({ dm, dmb }));
check(dmh.length === 2 && dmh[0][0] === 'Link to a day' && dmh[1][0] === 'To-do date' && dmh.every(([, tt, hh]) => tt === 'uppercase' && hh <= 24), 'small headings over its two groups (LINK TO A DAY, TO-DO DATE; he picked these, Oct 29)', JSON.stringify(dmh));
check(dm.b <= date.y && date.y - dm.b <= 12, 'above its button', JSON.stringify({ dm, date }));
await page.screenshot({ path: SHOTS + '/phone16-datemenu.png' });
await page.keyboard.press('Escape');
await page.evaluate(() => { const a = window.leanApp; a.outlines.forEach((o) => { o.stopEdit(); o.clearSel(); }); document.activeElement?.blur(); a.updateToolbar(); });
await sleep(1200);

console.log('a page’s ⋯ menu and the search box');
await page.locator('.title-row [data-a="more"]').tap();
await sleep(400);
const pm = await rect(page, '.pop.menu');
check(pm.w <= 280 && onScreen(pm) && Math.min(...await heights(page, '.pop.menu button')) >= 44 && pm.h <= Math.min(H * 0.62, 440) + 1, 'a page’s ⋯: compact, scrolling if long, rows a finger tall', JSON.stringify(pm));
await page.keyboard.press('Escape');
await sleep(200);
await page.locator('#topbar [data-a="search"]').tap();
await sleep(300);
await page.keyboard.type('note', { delay: 20 });
await sleep(700);
const sb = await rect(page, '.search-box');
const dim = await page.evaluate(() => getComputedStyle(document.querySelector('#search')).backgroundColor);
check(Math.abs(sb.y - H * 0.1) <= 2 && sb.x === 16 && sb.h <= H * 0.6, 'the search box: where it was (a tenth of the way down), not too tall', JSON.stringify(sb));
check(/0\.28\)$/.test(dim), 'over the darkened page, as before', dim);
const sbRows = await heights(page, '#search .results li[data-k]:not(.r-hit)'); // (a note found has two lines: its words and its page)
const sbIn = await rect(page, '#search input');
check(Math.min(...sbRows) >= 36 && Math.max(...sbRows) < 44 && sbIn.h <= 46, 'compact: rows close together (36px; they were 44), a smaller box to type in', JSON.stringify({ sbRows, sbIn }));
check(await page.evaluate(() => document.activeElement === document.querySelector('#search input')), 'ready to type');
await page.screenshot({ path: SHOTS + '/phone16-search.png' });
await page.keyboard.press('Escape');
check(errors.length === 0, 'no script errors', errors.join('\n'));
allErrors.push(...errors);
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('a laptop: its menus stay as they were');
browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
await page.goto(BASE + '/');
await page.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
await page.goto(BASE + '/?t=' + Date.now() + '#/page/Phone menus');
await page.waitForSelector('.outline .blk');
await sleep(500);
await page.locator('.outline .blk > .bul').first().click({ button: 'right' });
await sleep(300);
const lm = await page.evaluate(() => { const m = document.querySelector('.note-menu'); const it = [...m.querySelectorAll('.nm-item')].map((b) => b.getBoundingClientRect()); return { w: Math.round(m.getBoundingClientRect().width), cols: new Set(it.map((r) => Math.round(r.left))).size, ih: Math.round(Math.max(...it.map((r) => r.height))), sw: Math.round(m.querySelector('.nm-sw').getBoundingClientRect().width) }; });
check(lm.w <= 260 && lm.cols === 1 && lm.ih < 30 && lm.sw === 20, 'the note menu: one column, compact rows, as before', JSON.stringify(lm));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await sleep(300);
const ls = await rect(page, '.search-box');
check(ls.y >= 60 && ls.w >= 600, 'the search box: in the middle as before', JSON.stringify(ls));
await browser.close();

check(allErrors.length === 0, 'no script errors anywhere', allErrors.join('\n'));
console.log(failures() ? `${failures()} FAILED` : 'all passed');
process.exit(failures() ? 1 : 0);

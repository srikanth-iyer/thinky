// Phone layout and Android pieces: outline lines with nothing drawn on them (fold arrows beside the dot
// on a laptop, at the right end on a phone), headings' dots centred, day headings (big date, small
// weekday), roomy days with a least height and equal gaps around the line between days (Plain),
// "Add properties" in the ⋯ menu, the editing toolbar, back/forward and Go to date in the phone bar,
// filter rows on one line, Android's Back button order,
// picking up file access without a restart, the widget's to-dos and the status bar colours;
// holding a note's dot (its menu, finger-sized; colours and headings as Logseq writes them; Select, then
// holding more dots), holding and dragging it (moved, in or out a level in place, edges scroll), a quick
// tap or swipe on a dot as before, the toolbar's ⋯ while typing, and the sideways swipe on a note's words.
// The Android bridge (window.LeanAndroid) is a stand-in that records what the app tells it.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, write, read, go, BASE, VAULT, SHOTS } from './lib.mjs';

write('pages/Nest.md', '- ## heading parent\n\t- child one\n\t\t- grandchild\n\t- child two\n- plain parent\n\t- kid\n');
// holding a note's dot: its menu, or (moving the finger) dragging it
const HOLD = '- hold one\n- hold two\n\t- hold two kid\n- hold three\n- hold four\n';
write('pages/Hold.md', HOLD);
write('pages/Tall.md', Array.from({ length: 60 }, (_, k) => `- tall note ${k + 1}\n`).join(''));
// a journal day with many notes (taller than a day's least height), three days ago
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const dayTitle = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
write(`Diary/${dayTitle(daysAgo(3))}.md`, Array.from({ length: 9 }, (_, k) => `- note ${k + 1} of a long day\n`).join(''));

async function start({ access = true, look = 'plain', hash = '#/journals', phone = true } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(phone ? { viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (phone) await page.addInitScript((acc) => {
    window.__access = acc;
    window.__calls = [];
    const rec = (name) => (...a) => { window.__calls.push([name, ...a]); };
    window.LeanAndroid = {
      hasAllFilesAccess: () => window.__access, openAllFilesSettings: rec('settings'), leave: rec('leave'),
      setBarColors: rec('bars'), setWidgetColors: rec('widgetColors'), setWidgetTasks: rec('tasks'),
      setWidgetConfig: rec('widgetConfig'), setCaptureConfig: rec('capture'), refreshWidget: rec('refresh'),
    };
  }, access);
  await page.goto(BASE + '/');
  await page.evaluate(([v, l]) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify(l)); }, [VAULT, look]);
  await page.goto(BASE + '/?t=' + Date.now() + hash);
  await page.waitForSelector('#main .view > *');
  await sleep(800);
  return { browser, page, errors };
}
const allErrors = [];
const calls = (page, name) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), name);

// --------------------------------------------------------------------------------------------
console.log('phone: outline lines, fold arrows and headings');
let { browser, page, errors } = await start({ hash: '#/page/Nest' });
const geo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.outline .blk')];
  const row = (t) => rows.find((b) => b.querySelector(':scope > .bc')?.textContent.trim() === t);
  const outline = document.querySelector('.outline').getBoundingClientRect();
  const folds = [...document.querySelectorAll('.outline .fold')].map((f) => f.getBoundingClientRect());
  const hp = row('heading parent');
  const bul = hp.querySelector(':scope > .bul').getBoundingClientRect();
  const fold = hp.querySelector(':scope > .fold').getBoundingClientRect();
  const h = hp.querySelector('.bc .h').getBoundingClientRect();
  const dot = parseFloat(getComputedStyle(hp.querySelector(':scope > .bul'), '::after').height);
  const lineTop = parseFloat(getComputedStyle(hp, '::after').top) + hp.getBoundingClientRect().top;
  const bc = hp.querySelector(':scope > .bc');
  const textRight = bc.getBoundingClientRect().right - parseFloat(getComputedStyle(bc).paddingRight);
  return {
    rightSide: folds.every((f) => f.left > outline.left + outline.width * 0.6), folds: folds.length,
    bulVsHeading: Math.round((bul.top + bul.height / 2) - (h.top + h.height / 2)),
    foldVsHeading: Math.round((fold.top + fold.height / 2) - (h.top + h.height / 2)),
    // (Build 32 round 2: a fixed gap, --guide-gap, under the heading's dot)
    belowDot: Math.round(lineTop - (bul.top + bul.height / 2 + dot / 2)),
    textClear: Math.round((fold.left + fold.width / 2 - 4.5) - textRight),
  };
});
check(geo.folds === 3 && geo.rightSide, 'the fold arrows sit at the right end of the notes, away from the lines', JSON.stringify(geo));
check(Math.abs(geo.bulVsHeading) <= 2 && Math.abs(geo.foldVsHeading) <= 2, 'a heading’s dot and arrow are centred on the heading', JSON.stringify(geo));
check(Math.abs(geo.belowDot - 8) <= 1, 'the line under a note starts a small gap (8px) below its dot', JSON.stringify(geo));
check(geo.textClear >= 4, 'the text of a note with children stops short of its arrow', JSON.stringify(geo));
await page.screenshot({ path: SHOTS + '/phone-lines.png' });
await page.locator('.blk', { has: page.locator(':scope > .bc', { hasText: /^plain parent$/ }) }).locator(':scope > .fold').tap();
await sleep(400);
check(await page.locator('.blk.collapsed').count() === 1 && await page.locator('.blk > .bc', { hasText: /^kid$/ }).isHidden(), 'tapping the arrow folds the note');

console.log('phone: a page without properties: its notes right under the title; ⋯ → Add properties');
const props = await page.evaluate(() => {
  const t = document.querySelector('.page-head .page-title').getBoundingClientRect();
  const first = document.querySelector('.outline .blk').getBoundingClientRect();
  return { empty: document.querySelector('.page-head .page-props').textContent.trim() === '', gap: Math.round(first.top - t.bottom) };
});
check(props.empty && props.gap <= 40, 'nothing between the title and the notes', JSON.stringify(props));
await page.locator('.title-row [data-a="more"]').tap();
await page.locator('.pop.menu button', { hasText: 'Add properties' }).tap();
await sleep(300);
check(await page.evaluate(() => document.activeElement?.matches('.page-head .page-props textarea.preamble-ed')), 'the ⋯ menu’s "Add properties" opens the properties box');
await page.evaluate(() => document.activeElement?.blur());
await sleep(400);

console.log('phone: editing toolbar');
await page.locator('.blk > .bc', { hasText: /^child two$/ }).tap();
await sleep(400);
const tb = await page.evaluate(() => {
  const pin = document.querySelector('#toolbar .tb-pin').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#toolbar .tb-scroll button')].map((b) => b.getBoundingClientRect());
  return { shown: !document.querySelector('#toolbar').hidden, pinRight: Math.round(innerWidth - pin.right), pinDone: document.querySelector('#toolbar .tb-pin').dataset.t, all: btns.length, visible: btns.filter((r) => r.right <= pin.left + 1).length, w: Math.round(btns[0].width),
    icon: Math.round(document.querySelector('#toolbar .tb-scroll svg').getBoundingClientRect().width), h: Math.round(document.querySelector('#toolbar').getBoundingClientRect().height) };
});
check(tb.shown && tb.pinDone === 'done' && tb.pinRight <= 6, 'the hide-keyboard button stays at the right end', JSON.stringify(tb));
check(tb.all === 18 && tb.visible >= 9 && tb.w <= 38, 'the other buttons are closer together: at least 9 show without scrolling (18 with the "/" one)', JSON.stringify(tb));
const tbIcons = await page.evaluate(() => ['link', 'tag', 'bold', 'italic'].map((k) => { const b = document.querySelector(`#toolbar [data-t="${k}"]`); return b ? (b.querySelector('svg') && !b.textContent.trim() ? 'svg' : 'text') : 'none'; }).join(' '));
check(tbIcons === 'svg svg svg svg', 'Italics is there, and [[ ]] and # are drawn like the other icons', tbIcons);
check(tb.icon >= 24 && tb.h <= 51, 'its icons are big, and the toolbar is no taller than before', JSON.stringify(tb));
await page.screenshot({ path: SHOTS + '/phone-toolbar.png' });
// a button acts on a tap, not as soon as a finger lands on it: a sideways swipe that starts on a
// button scrolls the toolbar and presses nothing
const tbTouch = await page.evaluate(async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = () => document.querySelector('textarea.ed')?.value;
  const before = text();
  const touch = (k, type, dx, id) => {
    const b = document.querySelector(`#toolbar [data-t="${k}"]`), r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 }));
  };
  touch('bold', 'pointerdown', 0, 7); touch('bold', 'pointermove', -30, 7); touch('bold', 'pointerup', -30, 7);
  await s(150);
  const afterSwipe = text();
  touch('bold', 'pointerdown', 0, 8); touch('bold', 'pointercancel', 0, 8); // the browser took it over to scroll
  await s(150);
  const afterCancel = text();
  touch('bold', 'pointerdown', 0, 9); touch('bold', 'pointerup', 3, 9);
  await s(150);
  const afterTap = text();
  touch('undo', 'pointerdown', 0, 10); touch('undo', 'pointerup', 0, 10);
  await s(150);
  return { before, afterSwipe, afterCancel, afterTap, afterUndo: text() };
});
check(tbTouch.afterSwipe === tbTouch.before && tbTouch.afterCancel === tbTouch.before, 'a sideways swipe that starts on a toolbar button presses nothing', JSON.stringify(tbTouch));
check(tbTouch.afterTap !== tbTouch.before && tbTouch.afterTap.includes('**') && tbTouch.afterUndo === tbTouch.before, 'a tap on a toolbar button still presses it (and Undo takes it back)', JSON.stringify(tbTouch));
await page.locator('#toolbar .tb-scroll').evaluate((s) => { s.scrollLeft = 1e4; });
await sleep(150);
check(await page.evaluate(() => { const pin = document.querySelector('#toolbar .tb-pin').getBoundingClientRect(); return pin.right <= innerWidth && pin.left > innerWidth - 60; }), 'scrolling the toolbar leaves the hide-keyboard button where it is');
await page.locator('#toolbar .tb-pin').tap();
await sleep(300);
check(await page.locator('textarea.ed').count() === 0 && await page.locator('#toolbar').isHidden(), 'it closes the editing');

console.log('phone: Undo goes back through changes made in different notes, newest first');
const nestBefore = read('pages/Nest.md');
for (const [note, add] of [[/^child one$/, ' ONE'], [/^grandchild$/, ' TWO']]) {
  await page.locator('.blk > .bc', { hasText: note }).tap();
  await sleep(300);
  await page.keyboard.press('End');
  await page.keyboard.type(add);
  await sleep(200);
}
await sleep(1200);
const nestTyped = read('pages/Nest.md');
await page.locator('#toolbar [data-t="undo"]').tap();
await sleep(1200);
const nestUndo1 = read('pages/Nest.md');
await page.locator('#toolbar [data-t="undo"]').tap();
await sleep(1200);
check(nestTyped.includes('child one ONE') && nestTyped.includes('grandchild TWO') && nestUndo1.includes('child one ONE') && !nestUndo1.includes('TWO')
  && read('pages/Nest.md') === nestBefore, 'two notes changed: the first Undo takes back the newer change, the second the other one', JSON.stringify([nestTyped, nestUndo1, read('pages/Nest.md')]));
await page.locator('#toolbar .tb-pin').tap();
await sleep(300);

console.log('phone: home, back and forward in the top bar');
const bar = page.locator('#topbar');
check(await bar.locator('[data-h="back"]').isVisible() && await bar.locator('[data-h="forward"]').isVisible(), 'the phone bar has back and forward');
const order = await page.evaluate(() => [...document.querySelectorAll('#topbar button')].filter((b) => b.offsetParent).map((b) => b.dataset.a || b.dataset.h));
check(order.join(' ') === 'menu home back forward search', 'and Home just left of them (no separate Today button); on a page, no Go to date', order.join(' '));
await page.evaluate(() => { location.hash = '#/page/Maths'; });
await sleep(600);
check(!(await bar.locator('[data-h="back"]').isDisabled()) && await bar.locator('[data-h="forward"]').isDisabled(), 'back works after moving on; forward is greyed out');
await bar.locator('[data-h="back"]').tap();
await sleep(600);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Nest', 'back goes to the page before');
await bar.locator('[data-h="forward"]').tap();
await sleep(600);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Maths', 'forward goes ahead again');
const title = await page.evaluate(() => { const t = document.querySelector('#topbar .t').getBoundingClientRect(); return { w: Math.round(t.width), text: document.querySelector('#topbar .t').textContent }; });
check(title.text === 'Maths' && title.w >= 150, 'the page name has the room', JSON.stringify(title));
await page.evaluate(() => window.scrollTo(0, 200));
await bar.locator('[data-a="home"]').tap();
await sleep(700);
check(await page.evaluate(() => location.hash) === '#/journals' && await page.locator('.sheet.today').count() === 1 && await page.evaluate(() => window.scrollY) === 0, 'Home goes to today in the Journals list');
check(await bar.locator('[data-a="home"]').isDisabled(), 'there, at today, Home is greyed out (nowhere to go)');
await page.evaluate(() => window.scrollTo(0, 700));
await sleep(400);
check(!(await bar.locator('[data-a="home"]').isDisabled()), 'scrolled down to older days, it works again');
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(400);
const jorder = await page.evaluate(() => [...document.querySelectorAll('#topbar button')].filter((b) => b.offsetParent).map((b) => b.dataset.a || b.dataset.h));
check(jorder.join(' ') === 'menu home back forward date search', 'on the Journals list, Go to date beside Search', jorder.join(' '));
await bar.locator('[data-a="date"]').tap();
await page.waitForSelector('.datepick .cal-grid', { timeout: 3000 }).catch(() => {});
check(await page.locator('.datepick .cal-grid').count() === 1, 'the calendar button opens Go to date');
await page.keyboard.press('Escape');
await sleep(300);
check(await page.locator('.datepick').count() === 0, 'and it closes again');
await page.evaluate(() => history.back());
await sleep(600);

console.log('phone: the status bar follows the look');
await page.evaluate(() => window.leanApp.setSkin('night'));
let bars = (await calls(page, 'bars')).pop();
check(bars && bars[1] === '#1b1e24' && bars[2] === false, 'a dark look: its colour, with light icons', JSON.stringify(bars));
await page.evaluate(() => window.leanApp.setSkin('plain'));
bars = (await calls(page, 'bars')).pop();
check(bars && bars[1] === '#fcfcfc' && bars[2] === true, 'a light look: its colour, with dark icons', JSON.stringify(bars)); // (Plain: Logseq's off-white)

console.log('phone: the widget gets only to-dos due today');
await sleep(1800);
const sent = (await calls(page, 'tasks')).pop();
const w = sent ? JSON.parse(sent[1]) : null;
const t = new Date();
check(w && w.day === `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}` && w.tasks.some((x) => x.text.includes('today thing')) && !w.tasks.some((x) => x.text.includes('overdue thing') || x.text.includes('next week')),
  'today’s to-dos only, with the day they were worked out for', sent?.[1]);

console.log('phone: filter rows stay on one line');
for (const [hash, n] of [['#/todos', 5], ['#/pages', 4]]) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await sleep(700);
  const row = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('.chips .chip')].map((c) => c.getBoundingClientRect());
    const box = document.querySelector('.chips').getBoundingClientRect();
    return { n: cs.length, lines: new Set(cs.map((r) => Math.round(r.top))).size, inside: cs.every((r) => r.right <= box.right + 0.5), fade: document.querySelector('.chips').classList.contains('fade-end') };
  });
  check(row.n === n && row.lines === 1 && row.inside && !row.fade, `${hash}: all ${n} filter buttons fit on one line`, JSON.stringify(row));
}
// a narrower phone (or bigger text): the row scrolls sideways and fades at its end, and stays still
// (it once flipped between one and two lines every frame, filling the problems log)
await page.setViewportSize({ width: 330, height: 760 });
for (const hash of ['#/todos', '#/pages']) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await sleep(700);
  let logs = 0;
  const onReq = (r) => { if (r.url().endsWith('/api/log')) logs++; };
  page.on('request', onReq);
  const errs = errors.length;
  await sleep(1200);
  page.off('request', onReq);
  const row = await page.evaluate(() => {
    const r = document.querySelector('.chips');
    const tops = [...r.querySelectorAll('.chip')].map((c) => Math.round(c.getBoundingClientRect().top));
    return { display: getComputedStyle(r).display, lines: new Set(tops).size, fade: r.classList.contains('fade-end'), scrolls: r.scrollWidth > r.clientWidth };
  });
  check(row.display === 'flex' && row.lines === 1 && row.fade && row.scrolls && !logs && errors.length === errs,
    `${hash}, 330px wide: one line that scrolls sideways and fades at the end, without flickering`, JSON.stringify({ ...row, logs, errors: errors.slice(errs) }));
}
// Settings' tabs on a narrow phone: no Shortcuts (they're for a keyboard); the rest fit
await page.setViewportSize({ width: 320, height: 700 });
await page.evaluate(() => { location.hash = '#/settings/notes'; });
await sleep(800);
const tabRow = await page.evaluate(() => {
  const r = document.querySelector('.set-tabs');
  const box = r.getBoundingClientRect();
  const cs = [...r.querySelectorAll('[data-tab]')];
  return { tabs: cs.map((c) => c.textContent).join('|'), inside: cs.every((c) => c.getBoundingClientRect().right <= box.right + 0.5), fade: r.classList.contains('fade-end') };
});
check(tabRow.tabs === 'Notes|Look|Capture|About' && tabRow.inside && !tabRow.fade, 'phone Settings, 320px: Notes, Look, Capture, About all in view', JSON.stringify(tabRow));
await page.setViewportSize({ width: 393, height: 851 });
await page.evaluate(() => { location.hash = '#/todos'; });
await sleep(600);
const labels = await page.locator('.chips .chip').allTextContents();
check(labels.join('|') === 'Open|To do|Doing|Done|Cancelled', 'short labels in the notes’ own words; no Waiting (Build 33)', labels.join('|'));
await page.locator('.chips [data-k="done"]').tap();
await sleep(600);
const onlyDone = await page.evaluate(() => ({ pressed: [...document.querySelectorAll('.chips [aria-pressed="true"]')].map((b) => b.dataset.k), done: document.querySelectorAll('.todo-item.marker-done').length, open: document.querySelectorAll('.todo-item:not(.marker-done)').length }));
check(onlyDone.pressed.join() === 'done' && onlyDone.done > 0 && onlyDone.open === 0, '"Done" shows only finished to-dos, one filter at a time (he asked)', JSON.stringify(onlyDone));
await page.locator('.chips [data-k="all"]').tap();
await sleep(500);
await page.screenshot({ path: SHOTS + '/phone-todos.png' });

console.log('phone: Android’s Back button closes things first, then goes back, then leaves');
await page.evaluate(() => { location.hash = '#/journals'; });
await sleep(800);
const hashNow = () => page.evaluate(() => decodeURIComponent(location.hash));
await bar.locator('[data-a="menu"]').tap();
await sleep(300);
await page.evaluate(() => window.leanApp.onBack());
await sleep(300);
check(!(await page.evaluate(() => document.body.classList.contains('drawer'))) && (await hashNow()) === '#/journals', 'Back closes the menu drawer and stays on the page');
await bar.locator('[data-a="search"]').tap();
await sleep(300);
await page.evaluate(() => window.leanApp.onBack());
await sleep(200);
check(await page.locator('#search').isHidden() && (await hashNow()) === '#/journals', 'Back closes the search box');
await page.locator('.sheet .blk > .bc').first().tap();
await sleep(300);
await page.evaluate(() => window.leanApp.onBack());
await sleep(300);
check(await page.locator('textarea.ed').count() === 0 && await page.locator('#toolbar').isHidden() && (await hashNow()) === '#/journals', 'Back stops editing the note');
await page.evaluate(() => document.querySelector('.sheet .page-title a').click());
await sleep(800);
const dayPage = await hashNow();
await page.locator('.title-row [data-a="more"]').tap();
await sleep(300);
await page.evaluate(() => window.leanApp.onBack());
await sleep(300);
check(await page.locator('.pop.menu').count() === 0 && (await hashNow()) === dayPage, 'Back closes a menu');
await page.evaluate(() => window.leanApp.onBack());
await sleep(700);
check((await hashNow()) === '#/journals', 'with nothing open, Back goes to the page before', await hashNow());
await browser.close();
allErrors.push(...errors);

// at the very start, Back leaves the app (to the home screen)
({ browser, page, errors } = await start({ hash: '#/journals' }));
await page.evaluate(() => window.leanApp.onBack());
await sleep(300);
check((await calls(page, 'leave')).length === 1 && (await hashNow()) === '#/journals', 'at the start, Back leaves the app');
console.log('phone: the day headings');
const day = await page.evaluate(() => {
  const s = document.querySelector('.sheet.day');
  const wd = s.querySelector('.day-head .weekday'), tt = s.querySelector('.day-head .page-title');
  return { icon: !!s.querySelector('.day-ic'), aligned: Math.round(wd.getBoundingClientRect().left - tt.getBoundingClientRect().left), title: parseFloat(getComputedStyle(tt).fontSize), weekday: parseFloat(getComputedStyle(wd).fontSize) };
});
check(!day.icon && Math.abs(day.aligned) <= 1 && day.title >= 28 && day.weekday <= day.title / 2, 'each date big, the small weekday lined up above it (no calendar icon)', JSON.stringify(day));
console.log('phone: roomy days, at least a set height (Plain: a hairline between them)');
const gaps = await page.evaluate((longDay) => {
  const textBox = (el, last) => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()].filter((x) => x.height > 0); return last ? rs[rs.length - 1] : rs[0]; };
  return [...document.querySelectorAll('.sheet.day')].slice(0, -1).map((s) => {
    const r = s.getBoundingClientRect(), line = r.bottom; // the hairline between days
    const last = [...s.querySelectorAll('.day-body .bc')].pop();
    return { long: s.querySelector('.page-title').textContent === longDay, today: s.classList.contains('today'), h: Math.round(r.height),
      above: Math.round(line - textBox(last, true).bottom), below: Math.round(textBox(s.nextElementSibling.querySelector('.weekday'), false).top - line) };
  });
}, dayTitle(daysAgo(3)));
check(gaps.length >= 3 && gaps.every((g) => g.h >= (g.today ? 300 : 200) - 1), 'each day is at least as tall as set, even with one note (today taller)', JSON.stringify(gaps));
check(gaps.every((g) => g.below >= 30 && g.below <= 50), 'roomy space under the line between days', JSON.stringify(gaps));
check(gaps.some((g) => g.long) && gaps.filter((g) => g.long).every((g) => Math.abs(g.above - g.below) <= 6), 'a day with many notes: the same space above the line as below it', JSON.stringify(gaps));
check(gaps.filter((g) => !g.today).every((g) => g.above >= g.below - 6), 'a short day: at least as much (its empty space) above it', JSON.stringify(gaps));
await page.screenshot({ path: SHOTS + '/phone-journals-plain.png' });
await browser.close();
allErrors.push(...errors);

// --------------------------------------------------------------------------------------------
console.log('phone without file access: a clear message, then picked up without a restart');
({ browser, page, errors } = await start({ access: false }));
const card = page.locator('.view > .card', { hasText: 'can’t be read yet' });
check(await card.isVisible(), 'Journals explains that the notes can’t be read yet');
await card.locator('button').tap();
check((await calls(page, 'settings')).length === 1, 'its button opens Android’s setting');
await page.evaluate(() => { location.hash = '#/settings'; });
await sleep(700);
await page.locator('[data-a="pick"]').tap();
await sleep(800);
const pick = await page.evaluate(() => ({ use: document.querySelector('.picker [data-use]')?.disabled, note: document.querySelector('.picker .foot .note')?.textContent }));
check(pick.use === true && /allow access/i.test(pick.note || ''), 'the folder picker asks for access first', JSON.stringify(pick));
await page.evaluate(() => { location.hash = '#/journals'; });
await sleep(700);
await page.evaluate(() => { window.__access = true; document.dispatchEvent(new Event('visibilitychange')); });
await sleep(1200);
check(await page.locator('.view > .card', { hasText: 'can’t be read yet' }).count() === 0 && await page.locator('.sheet .outline').count() > 0, 'coming back with access turned on opens the notes');
await browser.close();
allErrors.push(...errors);

// --------------------------------------------------------------------------------------------
console.log('phone: hold a note’s dot for its menu');
({ browser, page, errors } = await start({ hash: '#/page/Hold', look: 'calm' }));
await page.evaluate(() => { window.__buzz = []; navigator.vibrate = (ms) => { window.__buzz.push(ms); return true; }; });
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const hRow = (t) => page.locator('.outline .blk', { has: page.locator(':scope > .bc', { hasText: new RegExp('^' + t + '$') }) }).first();
const hDot = async (t) => { const b = await hRow(t).locator(':scope > .bul').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const hMenu = page.locator('.note-menu');
const hItem = (label) => hMenu.locator('.nm-item', { has: page.locator('.nm-l', { hasText: new RegExp('^' + label + '$') }) });
const buzz = () => page.evaluate(() => window.__buzz.splice(0));
async function hold(t, ms = 650) {
  const p = await hDot(t);
  await touch('touchStart', p.x, p.y);
  await sleep(ms);
  await touch('touchEnd');
  await sleep(450); // (the menu takes no tap in its first moment: a click that comes with the finger let go)
}
// hold t's dot, then move the finger by dx, dy (in steps); the line just before lifting it
async function holdDrag(t, dx, dy) {
  const p = await hDot(t);
  await touch('touchStart', p.x, p.y);
  await sleep(650);
  for (let k = 1; k <= 12; k++) { await touch('touchMove', p.x + dx * k / 12, p.y + dy * k / 12); await sleep(20); }
  await sleep(150);
  const line = await page.evaluate(() => { const l = document.querySelector('.drop-line'); return l && !l.hidden ? { ghost: !!document.querySelector('.drag-ghost') } : null; });
  await touch('touchEnd');
  await sleep(1300);
  return line;
}
const hash0 = await page.evaluate(() => location.hash);
await hold('hold three');
const hm = await page.evaluate(() => {
  const m = document.querySelector('.note-menu');
  if (!m) return null;
  const hs = (sel) => [...m.querySelectorAll(sel)].map((b) => Math.round(b.getBoundingClientRect().height));
  const r = m.getBoundingClientRect();
  return { items: [...m.querySelectorAll('.nm-item .nm-l')].map((x) => x.textContent), itemH: Math.min(...hs('.nm-item')), swH: Math.min(...hs('.nm-sw')), headH: Math.min(...hs('.nm-h')),
    inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, focusOut: !m.contains(document.activeElement), marked: document.querySelector('.blk.menu-on > .bc')?.textContent };
});
check(hm && hm.items[0] === 'Select' && hm.items.includes('Next to-do state') && hm.marked === 'hold three', 'holding a dot and lifting the finger opens the note’s menu (Select first)', JSON.stringify(hm));
check(hm && hm.itemH >= 32 && hm.swH >= 20 && hm.headH >= 30 && hm.inside, 'compact but easy to tap (rows 32px, colour dots 20px with a bigger reach, as he asked in Build 32), all on the screen', JSON.stringify(hm));
check((await buzz()).length === 1 && await page.evaluate(() => location.hash) === hash0, 'a short buzz when it lifts; the note isn’t opened on its own', hash0);
await page.evaluate(() => window.leanApp.onBack());
await sleep(200);
check(await hMenu.count() === 0 && await page.evaluate(() => location.hash) === hash0, 'Android’s Back closes it (and stays on the page)');
await hold('hold three');
const other = await hRow('hold one').locator(':scope > .bc').boundingBox();
await page.touchscreen.tap(other.x + other.width - 30, other.y + other.height / 2);
await sleep(400);
check(await hMenu.count() === 0 && await page.locator('textarea.ed').count() === 0, 'a tap elsewhere closes it, and does nothing else (no note starts being edited)');
await page.locator('.outline .blk > .bul').first().tap();
await sleep(600);
check(await page.evaluate(() => location.hash.startsWith('#/zoom/')), 'a quick tap on a dot still opens the note on its own');
await page.evaluate(() => history.back());
await sleep(700);

console.log('phone: colours and headings from the menu, as Logseq writes them');
await hold('hold three');
await hMenu.locator('[data-c="pink"]').tap();
await sleep(1300);
check(read('pages/Hold.md') === HOLD.replace('- hold three\n', '- hold three\n  background-color:: pink\n'), 'a colour: background-color:: pink', read('pages/Hold.md'));
await hold('hold three');
await hMenu.locator('[data-h="3"]').tap();
await sleep(1300);
check(read('pages/Hold.md') === HOLD.replace('- hold three\n', '- ### hold three\n  background-color:: pink\n'), 'a heading: "### "', read('pages/Hold.md'));
await hold('hold three');
await hMenu.locator('[data-h="0"]').tap();
await sleep(300);
await hold('hold three');
await hMenu.locator('[data-c=""]').tap();
await sleep(1300);
check(read('pages/Hold.md') === HOLD, 'no heading, no colour: the file as it was', read('pages/Hold.md'));
await page.screenshot({ path: SHOTS + '/phone-hold-menu.png' });

console.log('phone: Select, then hold more dots to add them');
await hold('hold one');
await hItem('Select').tap();
await sleep(300);
check(await page.locator('.blk.sel').count() === 1 && await page.locator('#toolbar').isVisible(), '"Select" selects the note (the toolbar shows)');
await hold('hold three');
check(await hMenu.count() === 0 && await page.locator('.blk.sel').count() === 4, 'holding another dot adds it (and the notes between), no menu', await page.locator('.blk.sel').count());
await hold('hold two');
check(await hMenu.count() === 1 && !(await hMenu.locator('.nm-item .nm-l').allTextContents()).includes('Select'), 'holding a selected one: the menu for all of them');
await hItem('Next to-do state').tap();
await sleep(1300);
check(read('pages/Hold.md') === '- TODO hold one\n- TODO hold two\n\t- hold two kid\n- TODO hold three\n- hold four\n', 'it acts on each selected note (their children aside)', read('pages/Hold.md'));
await page.locator('#toolbar [data-t="undo"]').tap();
await sleep(1300);
check(read('pages/Hold.md') === HOLD, 'the toolbar’s Undo takes it back', read('pages/Hold.md'));
await page.evaluate(() => window.leanApp.onBack());
await sleep(300);

console.log('phone: hold a dot and drag to move the note');
const rowBox = async (t) => hRow(t).locator(':scope > .bc').boundingBox();
const d0 = await hDot('hold four'), up = await rowBox('hold two');
let ln = await holdDrag('hold four', 0, up.y + 4 - d0.y);
check(ln && ln.ghost, 'after the hold the note lifts and follows the finger; a line shows where it goes', JSON.stringify(ln));
check(read('pages/Hold.md') === '- hold one\n- hold four\n- hold two\n\t- hold two kid\n- hold three\n', 'let go above "hold two": moved there', read('pages/Hold.md'));
check((await buzz()).length >= 1, 'a short buzz when it lifted');
check(await page.locator('#toast .toast-act').textContent().catch(() => '') === 'Undo', 'the message offers Undo (a phone has no Ctrl+Z)');
await page.locator('#toast .toast-act').tap();
await sleep(1300);
check(read('pages/Hold.md') === HOLD, 'Undo puts it back', read('pages/Hold.md'));
await holdDrag('hold three', 30, 0);
check(read('pages/Hold.md') === '- hold one\n- hold two\n\t- hold two kid\n\t- hold three\n- hold four\n', 'dragged right in place: in a level (a child of the note above)', read('pages/Hold.md'));
await holdDrag('hold three', -30, 0);
check(read('pages/Hold.md') === HOLD, 'and left: out again', read('pages/Hold.md'));
ln = await holdDrag('hold one', 0, 12); // (a little down: still over its own place)
check(ln === null && read('pages/Hold.md') === HOLD && await hMenu.count() === 0, 'let go where it was: nothing changes (and no menu)', read('pages/Hold.md'));
check(!(await page.evaluate(() => document.body.classList.contains('drawer'))), 'dragging from a dot near the left edge doesn’t open the side menu');
// a quick swipe from a dot (no hold) still scrolls the page
await go(page, '#/page/Tall');
await sleep(300);
const sy0 = await page.evaluate(() => scrollY);
const t5 = await hDot('tall note 12');
await touch('touchStart', t5.x, t5.y);
for (let k = 1; k <= 8; k++) { await touch('touchMove', t5.x, t5.y - 30 * k); await sleep(16); }
await touch('touchEnd');
await sleep(500);
const sy1 = await page.evaluate(() => scrollY);
check(sy1 > sy0 + 100 && await hMenu.count() === 0 && !read('pages/Tall.md').startsWith('- tall note 2'), 'a quick swipe that starts on a dot still scrolls the page', `${sy0} → ${sy1}`);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(200);
const tFirst = await hDot('tall note 1');
await touch('touchStart', tFirst.x, tFirst.y);
await sleep(650);
for (let k = 1; k <= 10; k++) { await touch('touchMove', tFirst.x, tFirst.y + (840 - tFirst.y) * k / 10); await sleep(16); }
await sleep(1000);
const sy2 = await page.evaluate(() => scrollY);
await touch('touchMove', tFirst.x, 420);
await sleep(100);
await touch('touchEnd');
await sleep(1300);
check(sy2 > 150 && read('pages/Tall.md').split('\n')[0] === '- tall note 2', 'dragging near the bottom edge scrolls the page; the note goes where it’s let go', `${sy2} ${read('pages/Tall.md').split('\n').indexOf('- tall note 1')}`);

console.log('phone: the toolbar’s menu button while typing; the swipe still works');
await go(page, '#/page/Hold');
await hRow('hold two').locator(':scope > .bc').tap();
await sleep(400);
await page.locator('#toolbar [data-t="more"]').tap();
await sleep(450);
check(await hMenu.count() === 1 && await page.evaluate(() => document.activeElement?.matches('textarea.ed')), 'the toolbar’s ⋯ opens the menu for the note being typed in, the keyboard staying up');
await hMenu.locator('[data-c="green"]').tap();
await sleep(300);
check(await page.evaluate(() => document.activeElement?.matches('textarea.ed')) && await page.locator('textarea.ed').inputValue() === 'hold two', 'a colour from there: typing goes on (the colour line stays out of the box)');
await page.locator('#toolbar [data-t="more"]').tap();
await sleep(450);
await page.keyboard.press('End');
await page.keyboard.type('!');
await sleep(200);
check(await hMenu.count() === 0 && await page.locator('textarea.ed').inputValue() === 'hold two!', 'typing while it’s open: it closes, and the letter goes into the note', await page.locator('textarea.ed').inputValue());
await page.keyboard.press('Backspace');
await page.evaluate(() => window.leanApp.onBack());
await sleep(1300);
check(read('pages/Hold.md') === HOLD.replace('- hold two\n', '- hold two\n  background-color:: green\n'), 'and is written as Logseq does', read('pages/Hold.md'));
const sw = await rowBox('hold three');
await touch('touchStart', 120, sw.y + 14);
for (let k = 1; k <= 8; k++) { await touch('touchMove', 120 + 110 * k / 8, sw.y + 14 + k * 0.5); await sleep(16); }
await touch('touchEnd');
await sleep(1300);
check(read('pages/Hold.md') === HOLD.replace('- hold two\n', '- hold two\n  background-color:: green\n').replace('- hold three\n', '\t- hold three\n'), 'a sideways swipe on a note’s words still moves it in a level', read('pages/Hold.md'));
await browser.close();
allErrors.push(...errors);

// --------------------------------------------------------------------------------------------
console.log('laptop: the fold arrow sits between the line and the dot');
({ browser, page, errors } = await start({ phone: false, look: 'calm', hash: '#/page/Nest' }));
const kid = page.locator('.blk', { has: page.locator(':scope > .bc', { hasText: /^child one$/ }) });
const kb = await kid.boundingBox();
await page.mouse.move(kb.x + kb.width - 20, kb.y + 6);
await sleep(250);
const lap = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.outline .blk')];
  const row = (t) => rows.find((b) => b.querySelector(':scope > .bc')?.textContent.trim() === t);
  const k = row('child one'), p = row('heading parent');
  const pb = p.querySelector(':scope > .bul').getBoundingClientRect();
  const kb = k.querySelector(':scope > .bul').getBoundingClientRect();
  const f = k.querySelector(':scope > .fold');
  const fr = f.getBoundingClientRect();
  const dot = parseFloat(getComputedStyle(k.querySelector(':scope > .bul'), '::after').width);
  const lineX = pb.left + pb.width / 2, glyphL = fr.left + fr.width / 2 - 4.5, glyphR = glyphL + 9, dotL = kb.left + kb.width / 2 - dot / 2;
  return { shown: +getComputedStyle(f).opacity > 0.5, fromLine: Math.round(glyphL - lineX), toDot: Math.round(dotL - glyphR) };
});
check(lap.shown && lap.fromLine >= 4 && lap.toDot >= 4, 'it shows on hover, clear of the line on its left and of the dot', JSON.stringify(lap));
await page.screenshot({ path: SHOTS + '/laptop-fold.png' });
await browser.close();
allErrors.push(...errors);

check(!allErrors.length, 'no script errors', allErrors.join(' | '));
process.exit(failures() ? 1 : 0);

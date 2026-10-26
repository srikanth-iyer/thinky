// Phone layout and Android pieces: outline lines with nothing drawn on them (fold arrows beside the dot
// on a laptop, at the right end on a phone), headings' dots centred, day headings with their icon,
// equal gaps around the line between days (Plain), "+ properties" under the title, the editing
// toolbar, back/forward in the phone bar, filter rows on one line, Android's Back button order,
// picking up file access without a restart, the widget's to-dos and the status bar colours.
// The Android bridge (window.LeanAndroid) is a stand-in that records what the app tells it.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, write, BASE, VAULT, SHOTS } from './lib.mjs';

write('pages/Nest.md', '- ## heading parent\n\t- child one\n\t\t- grandchild\n\t- child two\n- plain parent\n\t- kid\n');

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
    lineStart: Math.round(lineTop - (bul.top + bul.height / 2 + dot / 2 + 4)),
    textClear: Math.round((fold.left + fold.width / 2 - 4.5) - textRight),
  };
});
check(geo.folds === 3 && geo.rightSide, 'the fold arrows sit at the right end of the notes, away from the lines', JSON.stringify(geo));
check(Math.abs(geo.bulVsHeading) <= 2 && Math.abs(geo.foldVsHeading) <= 2, 'a heading’s dot and arrow are centred on the heading', JSON.stringify(geo));
check(Math.abs(geo.lineStart) <= 1, 'the line under a note starts just below its dot', JSON.stringify(geo));
check(geo.textClear >= 4, 'the text of a note with children stops short of its arrow', JSON.stringify(geo));
await page.screenshot({ path: SHOTS + '/phone-lines.png' });
await page.locator('.blk', { has: page.locator(':scope > .bc', { hasText: /^plain parent$/ }) }).locator(':scope > .fold').tap();
await sleep(400);
check(await page.locator('.blk.collapsed').count() === 1 && await page.locator('.blk > .bc', { hasText: /^kid$/ }).isHidden(), 'tapping the arrow folds the note');

console.log('phone: "+ properties" right under the title');
const props = await page.evaluate(() => {
  const t = document.querySelector('.page-head .page-title').getBoundingClientRect();
  const p = document.querySelector('.page-head .page-props .add-props')?.getBoundingClientRect();
  const first = document.querySelector('.outline .blk').getBoundingClientRect();
  return p ? { gapAbove: Math.round(p.top - t.bottom), gapBelow: Math.round(first.top - p.bottom) } : null;
});
check(props && props.gapAbove <= 12 && props.gapBelow <= 24, 'it sits close under the title, then a small gap, then the notes', JSON.stringify(props));

console.log('phone: editing toolbar');
await page.locator('.blk > .bc', { hasText: /^child two$/ }).tap();
await sleep(400);
const tb = await page.evaluate(() => {
  const pin = document.querySelector('#toolbar .tb-pin').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#toolbar .tb-scroll button')].map((b) => b.getBoundingClientRect());
  return { shown: !document.querySelector('#toolbar').hidden, pinRight: Math.round(innerWidth - pin.right), pinDone: document.querySelector('#toolbar .tb-pin').dataset.t, all: btns.length, visible: btns.filter((r) => r.right <= pin.left + 1).length, w: Math.round(btns[0].width) };
});
check(tb.shown && tb.pinDone === 'done' && tb.pinRight <= 6, 'the hide-keyboard button stays at the right end', JSON.stringify(tb));
check(tb.all === 15 && tb.visible >= 9 && tb.w <= 38, 'the other buttons are closer together: at least 9 show without scrolling', JSON.stringify(tb));
await page.screenshot({ path: SHOTS + '/phone-toolbar.png' });
await page.locator('#toolbar .tb-scroll').evaluate((s) => { s.scrollLeft = 1e4; });
await sleep(150);
check(await page.evaluate(() => { const pin = document.querySelector('#toolbar .tb-pin').getBoundingClientRect(); return pin.right <= innerWidth && pin.left > innerWidth - 60; }), 'scrolling the toolbar leaves the hide-keyboard button where it is');
await page.locator('#toolbar .tb-pin').tap();
await sleep(300);
check(await page.locator('textarea.ed').count() === 0 && await page.locator('#toolbar').isHidden(), 'it closes the editing');

console.log('phone: home, back and forward in the top bar');
const bar = page.locator('#topbar');
check(await bar.locator('[data-h="back"]').isVisible() && await bar.locator('[data-h="forward"]').isVisible(), 'the phone bar has back and forward');
const order = await page.evaluate(() => [...document.querySelectorAll('#topbar button')].filter((b) => b.offsetParent).map((b) => b.dataset.a || b.dataset.h));
check(order.join(' ') === 'menu home back forward search', 'and Home just left of them (no separate Today button)', order.join(' '));
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
check(title.text === 'Maths' && title.w >= 120, 'the page name still fits in the bar', JSON.stringify(title));
await page.evaluate(() => window.scrollTo(0, 200));
await bar.locator('[data-a="home"]').tap();
await sleep(700);
check(await page.evaluate(() => location.hash) === '#/journals' && await page.locator('.sheet.today').count() === 1 && await page.evaluate(() => window.scrollY) === 0, 'Home goes to today in the Journals list');
await page.evaluate(() => history.back());
await sleep(600);

console.log('phone: the status bar follows the look');
await page.evaluate(() => window.leanApp.setSkin('night'));
let bars = (await calls(page, 'bars')).pop();
check(bars && bars[1] === '#1b1e24' && bars[2] === false, 'a dark look: its colour, with light icons', JSON.stringify(bars));
await page.evaluate(() => window.leanApp.setSkin('plain'));
bars = (await calls(page, 'bars')).pop();
check(bars && bars[1] === '#ffffff' && bars[2] === true, 'a light look: its colour, with dark icons', JSON.stringify(bars));

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
check(labels.join('|') === 'Open|Doing|To do|Waiting|Done', 'short labels in the notes’ own words', labels.join('|'));
await page.locator('.chips [data-o="done"]').tap();
await sleep(600);
check(await page.locator('.chips [data-o="done"]').getAttribute('aria-pressed') === 'true' && await page.locator('.todo-item.marker-done').count() > 0, '"Done" is a button that shows finished ones too');
await page.locator('.chips [data-o="done"]').tap();
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
  const s = document.querySelector('.sheet');
  const ic = s.querySelector('.day-head .day-ic svg')?.getBoundingClientRect();
  const wd = s.querySelector('.day-head .weekday').getBoundingClientRect();
  const tt = s.querySelector('.day-head .page-title').getBoundingClientRect();
  return ic ? { iconLeftOfTitle: ic.right < tt.left, aligned: Math.round(wd.left - tt.left), iconMid: Math.round((ic.top + ic.bottom) / 2 - (tt.top + tt.bottom) / 2) } : null;
});
check(day && day.iconLeftOfTitle && Math.abs(day.aligned) <= 1 && Math.abs(day.iconMid) <= 6, 'a small calendar icon before each date; the weekday lines up with the date', JSON.stringify(day));
const gaps = await page.evaluate(() => {
  const sheets = [...document.querySelectorAll('.sheet')];
  const textBox = (el, last) => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()].filter((x) => x.height > 0); return last ? rs[rs.length - 1] : rs[0]; };
  const out = [];
  for (const k of [0, 1]) {
    const line = sheets[k].getBoundingClientRect().bottom; // the hairline between days
    const last = [...sheets[k].querySelectorAll('.bc, .onthisday')].pop();
    out.push({ above: Math.round(line - textBox(last, true).bottom), below: Math.round(textBox(sheets[k + 1].querySelector('.weekday'), false).top - line) });
  }
  return out;
});
check(gaps.every((g) => Math.abs(g.above - g.below) <= 6 && g.below <= 28), 'Plain: the same space above and below the line between days', JSON.stringify(gaps));
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

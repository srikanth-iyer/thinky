// Tabs and two pages side by side (wide windows): Ctrl+click and the middle button open a new tab, each
// tab keeps its own place and back/forward, closing tabs (×, middle button, Ctrl+W), Ctrl+T / Ctrl+Tab,
// a page with a clash can't be left, dragging a tab to the right half, "Open to the side", both sides
// editable and saving, the sidebar / Back / find acting on the active side, remembered after a reload
// and at the next start; a narrow window shows just the active side; Home, Settings' own tabs and a
// to-do ticked in a list with two sides; each side's own Home/Back/Forward; the strip from the keyboard
// and for a screen reader; very many tabs; Settings open on both sides; odd tabs kept from before;
// which parts of the strip move the Windows app's window; a phone is as before.
import { open, read, write, check, failures, sleep, go, BASE, SHOTS, VAULT } from './lib.mjs';

write('pages/Left.md', '- left one\n- see [[Right]] and [[Long tab]]\n');
write('pages/Right.md', '- right one\n- right two\n');
write('pages/Long tab.md', Array.from({ length: 150 }, (_, k) => `- long line ${k}\n`).join(''));

let { browser, page, errors } = await open();
const allErrors = [];
const hashNow = () => page.evaluate(() => decodeURIComponent(location.hash));
const names = (p = 0) => page.$$eval(`#histbar .tabs[data-p="${p}"]:not([hidden]) .tab-t`, (els) => els.map((e) => e.textContent));
const cur = (p = 0) => page.evaluate((k) => document.querySelector(`#histbar .tabs[data-p="${k}"] .tab.cur .tab-t`)?.textContent ?? null, p);
const title = (pane) => page.evaluate((s) => document.querySelector(s + ' h1.page-title')?.textContent.trim() ?? null, pane);
const tab = (text, p = 0) => page.locator(`#histbar .tabs[data-p="${p}"] .tab`, { hasText: text });
/** a side's own arrows in the top strip: can they go back / forward? */
const arrows = (p = 0) => page.evaluate((k) => ({ back: !document.querySelector(`#histbar .hb-nav[data-p="${k}"] [data-h="back"]`).disabled, fwd: !document.querySelector(`#histbar .hb-nav[data-p="${k}"] [data-h="forward"]`).disabled }), p);
const nav = (p, what) => page.locator(`#histbar .hb-nav[data-p="${p}"] ${what === 'home' ? '[data-a="home"]' : `[data-h="${what}"]`}`);
const act = () => page.evaluate(() => window.leanApp.tabs.act);
const scrollOf = (pane) => page.evaluate((s) => document.querySelector(s).scrollTop, pane);
/** the first note at the top of a pane's notes */
const topLine = (pane) => page.evaluate((s) => {
  const m = document.querySelector(s);
  const top = m.getBoundingClientRect().top;
  return [...m.querySelectorAll('.outline .blk')].find((b) => b.getBoundingClientRect().bottom > top + 2)?.querySelector('.bc')?.textContent;
}, pane);
const editIn = async (pane, text, add) => {
  await page.locator(`${pane} .outline .blk > .bc`, { hasText: text }).first().click();
  await page.waitForSelector(`${pane} textarea.ed`);
  await page.keyboard.press('End');
  await page.keyboard.type(add);
  await page.keyboard.press('Escape');
  await sleep(1200);
};
const quietSpot = (pane) => page.locator(pane).click({ position: { x: 6, y: 6 } }); // its padding: makes it the active side

console.log('one tab: nothing extra in the top strip');
await go(page, '#/page/Left');
check(await page.locator('#histbar .tabs:not([hidden])').count() === 0 && await page.locator('#main2').isHidden(), 'no tabs and one page while only one is open');

console.log('Ctrl+click opens a page in a new tab');
await page.locator('#main .outline a[data-page="Right"]').click({ modifiers: ['Control'] });
await sleep(700);
check((await names()).join() === 'Left,Right' && await cur() === 'Right', 'a new tab, after the one it came from, shown', (await names()).join());
check(await hashNow() === '#/page/Right' && await title('#main') === 'Right', 'its page shows, and the address follows', await hashNow());
check(!(await page.locator('textarea.ed').count()) && read('pages/Left.md') === '- left one\n- see [[Right]] and [[Long tab]]\n', 'the click didn’t start editing the note with the link');
let ar = await arrows();
check(!ar.back && !ar.fwd, 'a new tab has nothing to go back to', JSON.stringify(ar));
await page.screenshot({ path: SHOTS + '/tabs-strip.png' });

console.log('back and forward belong to each tab');
await go(page, '#/page/Long%20tab');
await page.keyboard.press('Alt+ArrowLeft');
await sleep(600);
check(await hashNow() === '#/page/Right' && await cur() === 'Right', 'Alt+← goes back in this tab', await hashNow());
await page.locator('#histbar [data-h="forward"]').click();
await sleep(600);
check(await hashNow() === '#/page/Long tab' && await cur() === 'Long tab', 'the strip’s Forward goes ahead again (the tab shows its page’s name)', await hashNow());
await tab('Left').click();
await sleep(600);
ar = await arrows();
check(await hashNow() === '#/page/Left' && ar.back && !ar.fwd, 'the first tab has its own places', JSON.stringify({ h: await hashNow(), ...ar }));
await page.keyboard.press('Alt+ArrowLeft');
await sleep(600);
check(await hashNow() === '#/journals' && await cur() === 'Journals', 'Back there goes to where that tab was before (Journals)', await hashNow());
await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 4 }))); // the mouse's forward button
await sleep(600);
check(await hashNow() === '#/page/Left', 'the mouse’s forward button acts on it too', await hashNow());
await tab('Long tab').click();
await sleep(600);
check(await hashNow() === '#/page/Long tab' && (await arrows()).back, 'the other tab kept its own back/forward', await hashNow());

console.log('switching tabs keeps each one’s place');
await page.waitForFunction(() => document.querySelector('#main').scrollHeight > 3000);
await page.evaluate(() => { document.querySelector('#main').scrollTop = 1500; });
await sleep(300);
const before = await topLine('#main');
await tab('Left').click();
await sleep(600);
check(await title('#main') === 'Left' && await scrollOf('#main') < 50, 'another tab: its page from the top', await scrollOf('#main'));
check(await page.evaluate(() => window.leanApp.outlines.map((o) => o.name).join()) === 'Left', 'only the tab shown is loaded');
await tab('Long tab').click();
await sleep(1000);
const back1500 = await scrollOf('#main');
const after = await topLine('#main');
check(Math.abs(back1500 - 1500) <= 2 && after === before, 'coming back: drawn again, at the same place', JSON.stringify({ back1500, before, after }));

console.log('new tab, next and previous, closing');
await page.keyboard.press('Control+t');
await sleep(700);
check((await names()).join() === 'Left,Long tab,Journals' && await cur() === 'Journals' && await hashNow() === '#/journals', 'Ctrl+T: a new tab on Journals', (await names()).join());
await page.keyboard.press('Control+Tab');
await sleep(500);
check(await cur() === 'Left', 'Ctrl+Tab: the next tab (round to the first)', await cur());
await page.keyboard.press('Control+Shift+Tab');
await sleep(500);
check(await cur() === 'Journals', 'Ctrl+Shift+Tab: the one before', await cur());
await page.keyboard.press('Control+w');
await sleep(600);
check((await names()).join() === 'Left,Long tab' && await cur() === 'Long tab' && await hashNow() === '#/page/Long tab', 'Ctrl+W closes it; the one beside it shows', (await names()).join());
await page.locator('#histbar .tab-new[data-p="0"]').click();
await sleep(600);
await tab('Left').hover();
await tab('Left').locator('.tab-x').click();
await sleep(500);
check((await names()).join() === 'Long tab,Journals' && await cur() === 'Journals' && await hashNow() === '#/journals', '× closes a tab that isn’t shown; the page shown stays', (await names()).join());
await tab('Journals').click({ button: 'middle' });
await sleep(600);
check((await names()).length === 0 && await hashNow() === '#/page/Long tab', 'the middle button closes one too; down to one tab, the strip is gone', JSON.stringify([await names(), await hashNow()]));
await go(page, '#/page/Left');
await page.locator('#main .outline a[data-page="Right"]').click({ button: 'middle' });
await sleep(700);
check((await names()).join() === 'Left,Right' && await cur() === 'Right', 'the middle button on a link opens it in a new tab', (await names()).join());

console.log('a page with a clash to settle can’t be left by its tab');
const clash = (on) => page.evaluate((v) => { const o = window.leanApp.pane.outlines[0]; o.conflict = v; if (v) o.showBanner('<span>Changed in two places</span>'); else o.banner.hidden = true; }, on);
await clash(true);
await tab('Left').click();
await sleep(700);
check(await cur() === 'Right' && await hashNow() === '#/page/Right' && await title('#main') === 'Right', 'another tab clicked: this one stays until he chooses', JSON.stringify([await cur(), await hashNow()]));
await page.keyboard.press('Control+w');
await sleep(600);
check((await names()).join() === 'Left,Right' && await cur() === 'Right' && await title('#main') === 'Right', 'nor can it be closed', (await names()).join());
await clash(false);

console.log('dragging a tab to the right half shows it side by side');
const tb = await tab('Left').boundingBox();
const mb = await page.locator('#main').boundingBox();
await page.mouse.move(tb.x + 30, tb.y + tb.height / 2);
await page.mouse.down();
await page.mouse.move(tb.x + 50, tb.y + 40, { steps: 4 });
await page.mouse.move(mb.x + mb.width * 0.75, mb.y + 300, { steps: 8 });
await sleep(150);
check(await page.locator('.tab-drop.zone').isVisible(), 'while dragging, the right half lights up');
await page.screenshot({ path: SHOTS + '/tabs-drag.png' });
await page.mouse.up();
await sleep(900);
check(await page.locator('#main2').isVisible() && await title('#main2') === 'Left' && await title('#main') === 'Right'
  && (await names(0)).join() === 'Right' && (await names(1)).join() === 'Left', 'dropped there: two pages side by side, each side with its tab', JSON.stringify([await names(0), await names(1)]));
const t1 = await page.locator('#histbar .tabs[data-p="1"] .tab').boundingBox();
const t0 = await page.locator('#histbar .tabs[data-p="0"] .tab').boundingBox();
await page.mouse.move(t1.x + 30, t1.y + t1.height / 2);
await page.mouse.down();
await page.mouse.move(t1.x - 40, t1.y + t1.height / 2, { steps: 4 });
await page.mouse.move(t0.x + t0.width - 6, t0.y + t0.height / 2, { steps: 8 });
await sleep(150);
check(await page.locator('.tab-drop:not(.zone)').isVisible(), 'over the left strip: a bar shows where it goes');
await page.mouse.up();
await sleep(900);
check(await page.locator('#main2').isHidden() && (await names(0)).join() === 'Right,Left' && await title('#main') === 'Left', 'dragged back into the left strip: one side again', JSON.stringify(await names(0)));
const tl = await tab('Left').boundingBox();
const tr = await tab('Right').boundingBox();
await page.mouse.move(tl.x + 30, tl.y + tl.height / 2);
await page.mouse.down();
await page.mouse.move(tr.x + 10, tr.y + tr.height / 2, { steps: 6 });
await page.mouse.up();
await sleep(500);
check((await names(0)).join() === 'Left,Right' && await cur() === 'Left' && await title('#main') === 'Left', 'and along the strip: the tabs change places, the page stays', (await names(0)).join());

console.log('"Open to the side": two pages, each editable and saving');
await page.locator('#main .title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Open to the side' }).click();
await sleep(900);
check(await page.locator('#main2').isVisible() && await title('#main2') === 'Left' && await title('#main') === 'Left', 'the page shows on the right as well', JSON.stringify([await title('#main'), await title('#main2')]));
check(await act() === 1 && await hashNow() === '#/page/Left' && (await names(1)).join() === 'Left', 'the right side is the active one, with its own tab', JSON.stringify(await names(1)));
const geo = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { l: r('#main'), r: r('#main2'), t1: r('#histbar .tabs[data-p="1"]') }; });
check(Math.abs(geo.l.right - geo.r.left) <= 1.5 && Math.abs(geo.l.width - geo.r.width) <= 2 && geo.t1.left >= geo.r.left - 1, 'side by side, half each, the right side’s tabs above it', JSON.stringify({ l: [geo.l.left, geo.l.right], r: [geo.r.left, geo.r.right], t1: geo.t1.left }));
await editIn('#main2', 'left one', ' (right side)');
check(read('pages/Left.md').startsWith('- left one (right side)\n'), 'typing on the right is saved', read('pages/Left.md'));
check((await page.locator('#main .outline .bc', { hasText: 'left one' }).textContent()).includes('(right side)'), 'and the same page on the left shows it');
await editIn('#main', 'see', ' (left side)');
check(read('pages/Left.md') === '- left one (right side)\n- see [[Right]] and [[Long tab]] (left side)\n', 'typing on the left is saved too; nothing lost on either side', read('pages/Left.md'));
check(await act() === 0 && await hashNow() === '#/page/Left', 'clicking on the left made it the active side');

console.log('the sidebar, Back, Shift+click and find act on the active side');
await quietSpot('#main2');
await page.locator('#side .nav a[data-view="pages"]').click();
await sleep(800);
check(await page.locator('#main2 h1.page-title').textContent() === 'All pages' && await title('#main') === 'Left' && await hashNow() === '#/pages', 'a sidebar link opens on the active (right) side; the left stays', await hashNow());
await quietSpot('#main');
await sleep(200);
check(await hashNow() === '#/page/Left' && await act() === 0, 'clicking on the left: the address follows that side', await hashNow());
await quietSpot('#main2');
await page.keyboard.press('Alt+ArrowLeft');
await sleep(700);
check(await title('#main2') === 'Left' && await title('#main') === 'Left' && await hashNow() === '#/page/Left', 'Alt+← goes back on the right side only');
await page.locator('#main .outline a[data-page="Right"]').click({ modifiers: ['Shift'] });
await sleep(800);
check(await title('#main2') === 'Right' && (await names(1)).join() === 'Left,Right' && await title('#main') === 'Left', 'Shift+click on a link opens it on the other side, in a new tab there', JSON.stringify(await names(1)));
await quietSpot('#main2');
await page.keyboard.press('Control+f');
await sleep(200);
await page.keyboard.type('one');
await sleep(500);
check(await page.locator('.fb-n').textContent() === '1 of 1', 'Ctrl+F on the right finds only its “right one” (not the left’s “left one”)', await page.locator('.fb-n').textContent());
const fbx = await page.evaluate(() => [document.querySelector('#findbar .fb-row').getBoundingClientRect().left, document.querySelector('#main2').getBoundingClientRect().left, document.querySelector('#main').getBoundingClientRect().top, document.querySelector('#main2').getBoundingClientRect().top]);
check(fbx[0] >= fbx[1] && fbx[3] > fbx[2], 'the find bar sits above the right side, and only it moves down', JSON.stringify(fbx));
await page.screenshot({ path: SHOTS + '/tabs-find.png' });
await page.keyboard.press('Escape');
for (const look of ['plain', 'calm', 'night', 'paper']) {
  await page.evaluate((l) => window.leanApp.setSkin(l), look);
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/tabs-${look}.png` });
}
await page.evaluate(() => window.leanApp.setSkin('calm'));

console.log('remembered after a reload, and at the next start');
await go(page, '#/page/Long%20tab'); // on the right
await page.waitForFunction(() => document.querySelector('#main2').scrollHeight > 3000);
await page.evaluate(() => { document.querySelector('#main2').scrollTop = 1200; });
await sleep(300);
const state = () => page.evaluate(() => ({
  act: window.leanApp.tabs.act,
  tabs: [...document.querySelectorAll('#histbar .tabs:not([hidden])')].map((b) => [...b.querySelectorAll('.tab')].map((t) => (t.classList.contains('cur') ? '*' : '') + t.textContent).join('|')),
  hash: decodeURIComponent(location.hash),
}));
const s1 = await state();
await page.reload();
await page.waitForSelector('#main2 .outline');
await sleep(1200);
const s2 = await state();
check(JSON.stringify(s1) === JSON.stringify(s2) && await title('#main') === 'Left' && await title('#main2') === 'Long tab', 'a reload: the same tabs, sides, active side and address', JSON.stringify({ s1, s2 }));
check(Math.abs(await scrollOf('#main2') - 1200) <= 2, 'the right side scrolled where it was', await scrollOf('#main2'));
check((await arrows(1)).back, 'and its back/forward still there');
const p2 = await page.context().newPage(); // another start (the tabs are kept for it; back/forward aren't)
const errors2 = [];
p2.on('pageerror', (e) => errors2.push(e.message));
await p2.goto(BASE + '/?t=' + Date.now());
await p2.waitForSelector('#main2 .outline');
await sleep(1200);
const s3 = await p2.evaluate(() => ({ act: window.leanApp.tabs.act, n: [...document.querySelectorAll('#histbar .tabs:not([hidden]) .tab')].length, hash: decodeURIComponent(location.hash), back: !document.querySelector('#histbar .hb-nav[data-p="1"] [data-h="back"]').disabled, left: document.querySelector('#main h1.page-title')?.textContent.trim(), right: document.querySelector('#main2 h1.page-title')?.textContent.trim() }));
check(s3.act === 1 && s3.n === 4 && s3.hash === '#/page/Long tab' && s3.left === 'Left' && s3.right === 'Long tab' && !s3.back, 'the next start: the tabs and both sides come back (a fresh start for back/forward)', JSON.stringify(s3));
await p2.close();
allErrors.push(...errors2);

console.log('a narrow window shows just the active side');
await page.setViewportSize({ width: 800, height: 900 });
await sleep(600);
check(await page.locator('#histbar').isHidden() && await page.locator('#main').isHidden() && await page.locator('#main2').isVisible(), 'only the active (right) side shows, no strip', JSON.stringify([await page.locator('#main').isVisible(), await page.locator('#main2').isVisible()]));
check(await page.locator('#topbar .t').textContent() === 'Long tab', 'the top bar names its page');
await page.screenshot({ path: SHOTS + '/tabs-narrow.png' });
await go(page, '#/page/Left');
await page.locator('#main2 .outline a[data-page="Right"]').click({ modifiers: ['Control'] });
await sleep(700);
check(await hashNow() === '#/page/Right' && await page.evaluate(() => window.leanApp.tabs.panes[1].tabs.length) === 2, 'Ctrl+click opens the page in place, no new tab', await hashNow());
await page.locator('#topbar [data-h="back"]').click();
await sleep(600);
check(await hashNow() === '#/page/Left', 'the top bar’s Back acts on that side', await hashNow());
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(700);
check(await page.locator('#main').isVisible() && await page.locator('#main2').isVisible() && await title('#main') === 'Left' && await title('#main2') === 'Left', 'wide again: both sides, nothing lost');

console.log('closing a side');
await page.locator('#main2 .title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Close this side' }).click();
await sleep(700);
check(await page.locator('#main2').isHidden() && await title('#main') === 'Left' && (await names(0)).join() === 'Left,Right', '"Close this side": one side again, the left as it was', JSON.stringify(await names(0)));

console.log('Home, Settings, and a page changed from a list, with two sides');
await page.locator('#main .title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Open to the side' }).click();
await sleep(900);
await nav(1, 'home').click();
await sleep(900);
check(await hashNow() === '#/journals' && await page.locator('#main2 .sheet.today').count() === 1 && await title('#main') === 'Left', 'the right side’s Home opens Journals there; the left stays', await hashNow());
await page.locator('#side .nav a[data-view="settings"]').click();
await sleep(900);
check(await hashNow() === '#/settings/notes' && await page.locator('#main2 .set-tabs').isVisible() && await cur(1) === 'Settings', 'Settings opens on the right, on its Notes tab', await hashNow());
await page.locator('#main2 .set-tabs [data-tab="look"]').click();
await sleep(600);
check(await hashNow() === '#/settings/look' && await cur(1) === 'Settings', 'its Look tab: the address says so, the tab still says Settings', await hashNow());
await page.keyboard.press('Alt+ArrowLeft');
await page.locator('#main2 .sched .todo-item', { hasText: 'today thing' }).waitFor();
check(await hashNow() === '#/journals', 'Back goes to Journals: the Settings tab added no step', await hashNow());
await quietSpot('#main');
await go(page, '#/page/Tasks');
await sleep(500);
await page.locator('#main2 .sched .todo-item', { hasText: 'today thing' }).locator('.todo').click();
await sleep(1500);
check(read('pages/Tasks.md').includes('- DONE today thing') && await page.locator('#main .outline .blk.marker-done', { hasText: 'today thing' }).count() === 1,
  'a to-do ticked in the right side’s "Scheduled & deadline": the page open on the left shows it done', read('pages/Tasks.md'));

console.log('each side has its own Home, Back and Forward');
await quietSpot('#main');
await sleep(200);
const a1 = await arrows(1);
check(await act() === 0 && a1.back && a1.fwd, 'the right side’s arrows follow its own tab while the left is the active side', JSON.stringify({ act: await act(), ...a1 }));
await nav(1, 'back').click();
await sleep(900);
check(await title('#main2') === 'Left' && await title('#main') === 'Tasks' && await act() === 1 && await hashNow() === '#/page/Left',
  'its Back: the right side goes back (and is the active side now); the left stays', JSON.stringify([await title('#main'), await title('#main2'), await hashNow()]));
await nav(0, 'home').click();
await sleep(900);
check(await act() === 0 && await hashNow() === '#/journals' && await page.locator('#main .sheet.today').count() === 1 && await title('#main2') === 'Left',
  'the left side’s Home: Journals on the left; the right stays', await hashNow());

console.log('the strip from the keyboard, and what a screen reader hears');
const focused = () => page.evaluate(() => {
  const a = document.activeElement;
  return a.matches('#histbar .tab') ? `${a.parentElement.dataset.p}:${a.querySelector('.tab-t').textContent}${a.classList.contains('cur') ? '*' : ''}` : `${a.tagName}.${a.className}`;
});
check((await names(0)).join() === 'Journals,Right', 'the left side has two tabs', JSON.stringify(await names(0)));
await tab('Right').click();
await sleep(700);
await tab('Journals').click();
await sleep(700);
check(!(await focused()).startsWith('0:'), 'a click on a tab doesn’t put the keyboard on it (Space and the arrows still scroll the page)', await focused());
await nav(0, 'home').focus();
for (let k = 0; k < 4 && !(await focused()).startsWith('0:'); k++) await page.keyboard.press('Tab');
check(await focused() === '0:Journals*', 'Tab reaches the shown tab (the others are an arrow key away)', await focused());
await page.keyboard.press('ArrowRight');
check(await focused() === '0:Right' && await hashNow() === '#/journals', '→ goes to the next tab without showing it', await focused());
await page.keyboard.press('Enter');
await sleep(800);
check(await hashNow() === '#/page/Right' && await title('#main') === 'Right' && await focused() === '0:Right*', 'Enter shows it; the keyboard stays on it', JSON.stringify([await hashNow(), await focused()]));
await page.keyboard.press('Home');
await page.keyboard.press(' ');
await sleep(800);
check(await hashNow() === '#/journals' && await focused() === '0:Journals*', 'Home goes to the first tab, Space shows it', JSON.stringify([await hashNow(), await focused()]));
await page.keyboard.press('ArrowLeft'); // (round to the last)
await page.keyboard.press('Delete');
await sleep(600);
check((await names(0)).join() === 'Journals' && await focused() === '0:Journals*' && await hashNow() === '#/journals', 'Delete closes the tab it is on; the keyboard goes to the shown one', JSON.stringify([await names(0), await focused()]));
const ax = await page.locator('#histbar').ariaSnapshot();
check(!ax.includes('Close tab') && ax.includes('tab "Journals" [selected]') && ax.includes('button "Back, on the right"'), 'a tab is named by its page alone (not “Journals Close tab”); the right side’s buttons say so', ax);
check(await page.evaluate(() => [...document.querySelectorAll('#histbar [role="tablist"]')].every((l) => [...l.children].every((c) => c.getAttribute('role') === 'tab'))), 'the tab lists hold only tabs (each side’s “+” comes after its list)');
check(await page.evaluate(() => [...document.querySelectorAll('#histbar .tab')].every((t) => t.getAttribute('aria-controls') === (t.parentElement.dataset.p === '0' ? 'main' : 'main2'))), 'each tab names the side it shows in (aria-controls)');
check(await page.getAttribute('#histbar', 'aria-label') === 'Back, forward and tabs', 'the strip’s name says what it holds');
await page.locator('#main').click({ position: { x: 6, y: 6 } });

console.log('very many tabs: still readable, “+” in sight');
await page.evaluate(() => { for (let k = 0; k < 14; k++) window.leanApp.tabs.open('#/page/Left'); });
await sleep(1500);
const many = await page.evaluate(() => {
  const box = document.querySelector('#histbar .tabs[data-p="0"]'), r = (e) => e.getBoundingClientRect();
  const tabs = [...box.querySelectorAll('.tab')].map((t) => r(t).width);
  const plus = r(document.querySelector('#histbar .tab-new[data-p="0"]')), b = r(box), cur = r(box.querySelector('.tab.cur')), half = r(document.querySelector('#histbar .hb-h'));
  return { n: tabs.length, min: Math.round(Math.min(...tabs)), scrolls: box.scrollWidth > box.clientWidth, plus: [plus.left, plus.right], box: [b.left, b.right], half: half.right, cur: [cur.left, cur.right] };
});
check(many.n === 15 && many.min >= 95 && many.scrolls, 'the tabs keep a readable width; the strip scrolls sideways instead', JSON.stringify(many));
check(many.plus[0] >= many.box[1] && many.plus[1] <= many.half + 1 && many.cur[0] >= many.box[0] - 1 && many.cur[1] <= many.box[1] + 1, '“+” stays in sight after the tabs, and so does the shown tab', JSON.stringify(many));
await page.screenshot({ path: SHOTS + '/tabs-many.png' });
await page.evaluate(() => { const T = window.leanApp.tabs; for (let k = 0; k < 14; k++) T.close(0, T.panes[0].cur); });
await sleep(900);
check((await names(0)).length === 1, 'closed again', JSON.stringify(await names(0)));

console.log('Settings open on both sides: each copy works on its own');
await page.locator('#main').click({ position: { x: 6, y: 6 } });
await go(page, '#/settings/capture');
await page.evaluate(() => window.leanApp.tabs.open('#/settings/capture', 'side'));
await sleep(1200);
const radios = () => page.evaluate(() => ['#main', '#main2'].map((s) => [...document.querySelectorAll(s + ' input[type=radio]')].map((r) => r.value + (r.checked ? '*' : '')).join(',')));
const r0 = await radios();
await page.locator('#main2 input[type=radio][value="page"]').check();
const r1 = await radios();
await page.locator('#main [data-a="save"]').click();
await sleep(800);
const savedNote = await page.locator('#main .saved').isVisible();
const twice = await page.evaluate(() => { const seen = {}; for (const e of document.querySelectorAll('[id]')) seen[e.id] = (seen[e.id] || 0) + 1; return Object.keys(seen).filter((k) => seen[k] > 1); });
check(r0[0] === r0[1] && r0[0].includes('*') && r1[0] === r0[0] && r1[1] === 'today,page*', 'a choice on the right leaves the left’s as it was', JSON.stringify({ r0, r1 }));
check(savedNote && !twice.length, 'Save on the left works; no id is used twice on screen', JSON.stringify({ savedNote, twice }));

console.log('odd or stale tabs kept from before: a normal start, no script errors');
const V = await page.evaluate(() => JSON.parse(localStorage.getItem('vault')));
const startWith = async (kept) => {
  await page.evaluate((t) => localStorage.setItem('tabs', JSON.stringify(t)), kept);
  const p3 = await page.context().newPage();
  const errs = [];
  p3.on('pageerror', (e) => errs.push(e.message));
  p3.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p3.goto(BASE + '/?t=' + Date.now());
  await p3.waitForSelector('#main .view');
  await sleep(1500);
  const st = await p3.evaluate(() => ({ panes: window.leanApp.tabs.panes.map((p) => p.tabs.map((t) => decodeURIComponent(t.hist[t.at]))), act: window.leanApp.tabs.act, hash: decodeURIComponent(location.hash) }));
  await p3.close();
  return { st, errs };
};
let k1 = await startWith({ vault: V, act: 5, panes: [{ cur: 9, tabs: [{ hist: ['#/page/Nope'], at: 0 }] }, { tabs: [{ hist: ['javascript:alert(1)', 7, '#/page/Left'], at: 7, top: 'x' }, { hist: ['#/page/%E0%A4%A'] }, { hist: '#/page/Left' }, null] }] });
check(!k1.errs.length && JSON.stringify(k1.st.panes) === '[["#/page/Left"]]' && k1.st.act === 0, 'odd kept tabs: only the sensible one comes back', JSON.stringify(k1));
k1 = await startWith({ vault: '/some/other/folder', act: 1, panes: [{ cur: 0, tabs: [{ hist: ['#/page/Left'] }] }, { cur: 0, tabs: [{ hist: ['#/page/Left'] }] }] });
check(!k1.errs.length && k1.st.panes.length === 1 && k1.st.panes[0].length === 1 && k1.st.hash === '#/journals', 'tabs kept for another notes folder: not used', JSON.stringify(k1));
k1 = await startWith('just a string');
check(!k1.errs.length && k1.st.panes.length === 1, 'garbage: a normal start', JSON.stringify(k1));
k1 = await startWith({ vault: V, act: 0, panes: [{ cur: 0, tabs: [{ hist: ['#/zoom/Left/abc'] }, { hist: ['#/page/'] }, { hist: ['#/whatever'] }] }] });
check(!k1.errs.length, 'odd places: no script errors', JSON.stringify(k1));
allErrors.push(...errors);
await browser.close();

console.log('the Windows app: the strip’s empty parts move the window, its buttons and tabs don’t');
{
  const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
  const b2 = await chromium.launch();
  const ctx2 = await b2.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx2.addInitScript(() => {
    const win = { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onResized: () => {}, setSize: async () => {} };
    window.__TAURI__ = { // a stand-in for the desktop app: its calls go to the dev server
      core: { invoke: async (_c, { cmd, args }) => { const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; } },
      event: { listen: async () => () => {} }, window: { getCurrentWindow: () => win }, app: { getVersion: async () => { throw new Error('test'); } },
    };
  });
  const pw = await ctx2.newPage();
  pw.on('pageerror', (e) => allErrors.push(e.message));
  await pw.goto(BASE + '/');
  await pw.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
  await pw.goto(BASE + '/?t=' + Date.now() + '#/page/Left');
  await pw.waitForSelector('#main .outline');
  await pw.evaluate(() => window.leanApp.tabs.open('#/page/Right', 'side'));
  await pw.waitForSelector('#main2 .outline');
  const moves = await pw.evaluate(() => {
    // Tauri 2's rule (its drag.js): a press moves the window when it lands right on an element marked
    // data-tauri-drag-region, not on a button, link, tab… inside one
    const CLICK = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
    const ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);
    const at = (x, y) => {
      const first = document.elementFromPoint(x, y);
      for (let el = first; el && el !== document.documentElement; el = el.parentElement) {
        const a = el.getAttribute('data-tauri-drag-region');
        if (a === null && (CLICK.has(el.tagName) || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') || ROLES.has(el.getAttribute('role')))) return false;
        if (a !== null) return a === 'deep' || ((a === '' || a === 'true') && el === first);
      }
      return false;
    };
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const home0 = r('#histbar .hb-nav[data-p="0"] [data-a="home"]'), y = home0.top + home0.height / 2;
    const plus0 = r('#histbar .tab-new[data-p="0"]'), half0 = r('#histbar .hb-h'), date1 = r('#histbar .hb-nav[data-p="1"] [data-a="date"]'), drag = r('#histbar .drag');
    return {
      winctl: document.querySelectorAll('#histbar .winctl button').length,
      gap: at(home0.left + home0.width / 2, home0.top - 4), end0: at((plus0.right + half0.right) / 2, y), gap1: at(date1.right + 4, y), drag: at(drag.left + drag.width / 2, y),
      tab: at(r('#histbar .tabs[data-p="1"] .tab').left + 20, y), button: at(home0.left + home0.width / 2, y),
    };
  });
  check(moves.winctl === 3 && moves.gap && moves.end0 && moves.gap1 && moves.drag, 'two sides: the strip above the buttons and the empty end of each half move the window', JSON.stringify(moves));
  check(!moves.tab && !moves.button, 'a press on a tab or a button never does', JSON.stringify(moves));
  const fits = [];
  for (const w of [861, 900, 940, 1000]) { // narrow, with the sidebar: the window buttons stay in the window
    await pw.setViewportSize({ width: w, height: 900 });
    await sleep(200);
    fits.push(await pw.evaluate(() => ({ w: innerWidth, right: Math.round(document.querySelector('#histbar .winctl').getBoundingClientRect().right), over: document.scrollingElement.scrollWidth - innerWidth })));
  }
  check(fits.every((f) => f.right <= f.w && f.over <= 0), 'two sides in a narrow window: the window buttons stay inside it', JSON.stringify(fits));
  await b2.close();
}

// --------------------------------------------------------------------------------------------
console.log('right-clicking a page link: open it in a new tab, or to the side');
({ browser, page, errors } = await open());
await go(page, '#/page/Left');
const leftWas = read('pages/Left.md');
const rclick = async () => { await page.locator('#main .outline a[data-page="Right"]').click({ button: 'right' }); await sleep(250); };
await rclick();
const rmenu = await page.$$eval('.pop.menu button', (bs) => bs.map((b) => {
  const r = b.getBoundingClientRect(), hr = b.querySelector('.mhint')?.getBoundingClientRect();
  return { label: b.lastChild.textContent, hint: b.querySelector('.mhint')?.textContent, oneLine: r.height < 44, right: !!hr && hr.right > r.right - 20 && hr.left > r.left + r.width / 2 };
}));
check(rmenu.map((m) => m.label + ' (' + m.hint + ')').join('|') === 'Open in a new tab (Ctrl+click)|Open to the side (Shift+click)', 'a small menu: a new tab, or to the side, with the keys that do the same', JSON.stringify(rmenu));
check(rmenu.every((m) => m.oneLine && m.right), 'each on one line, the keys quietly on the right', JSON.stringify(rmenu));
const rmb = await page.locator('.pop.menu').boundingBox();
const rlb = await page.locator('#main .outline a[data-page="Right"]').boundingBox();
check(rmb && rmb.x <= rlb.x + rlb.width && Math.abs(rmb.y - (rlb.y + rlb.height / 2)) < 60, 'it opens where the click was', JSON.stringify([rmb, rlb]));
check(!(await page.locator('textarea.ed').count()), 'the right-click didn’t start editing the note');
await page.screenshot({ path: SHOTS + '/tabs-rightclick.png' });
await page.locator('.pop.menu button', { hasText: 'Open in a new tab' }).click();
await sleep(700);
check((await names()).join() === 'Left,Right' && await cur() === 'Right' && await title('#main') === 'Right', '“Open in a new tab”: a new tab after this one, shown', (await names()).join());
check(read('pages/Left.md') === leftWas, 'the page with the link is untouched', read('pages/Left.md'));
await tab('Left').click();
await sleep(600);
await rclick();
await page.locator('.pop.menu button', { hasText: 'Open to the side' }).click();
await sleep(800);
check(await page.locator('#main2').isVisible() && await title('#main2') === 'Right' && await title('#main') === 'Left', '“Open to the side”: the page opens on the right, this one stays', JSON.stringify([await title('#main'), await title('#main2')]));
// not on a link: no menu of ours
await page.locator('#main .outline .blk > .bc', { hasText: 'left one' }).first().click({ button: 'right' });
await sleep(250);
check(await page.locator('.pop.menu').count() === 0 && !(await page.locator('textarea.ed').count()), 'a right-click on plain words: no menu of ours, no editing');
// Esc closes the menu
await rclick();
await page.keyboard.press('Escape');
await sleep(150);
check(await page.locator('.pop.menu').count() === 0, 'Esc closes it');
// a narrow window has no tabs or sides: no menu
await quietSpot('#main'); // (the left side, with the link, is the one it shows)
await page.setViewportSize({ width: 800, height: 900 });
await sleep(500);
await page.locator('#main .outline a[data-page="Right"]').click({ button: 'right' });
await sleep(250);
check(await page.locator('.pop.menu').count() === 0, 'a narrow window: no tab menu (there are no tabs there)');
allErrors.push(...errors);
await browser.close();

console.log('a phone-sized screen: as before');
({ browser, page, errors } = await open({ viewport: { width: 393, height: 851 }, touch: true }));
await go(page, '#/page/Left');
check(await page.locator('#histbar').isHidden() && await page.locator('#main2').isHidden(), 'no tab strip, one page');
await page.locator('.title-row [data-a="more"]').tap();
await sleep(200);
const items = await page.locator('.pop.menu button').allTextContents();
check(items.join('|') === 'Add properties|Rename…|Find on this page|History…|Copy page as text…|Copy link|Print or save as PDF|Delete page…', 'the page menu is as it was (no tab items)', items.join('|'));
await page.evaluate(() => window.leanApp.onBack());
await page.keyboard.press('Control+t');
await sleep(400);
check(await page.evaluate(() => window.leanApp.tabs.panes[0].tabs.length) === 1 && decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Left', 'tab keys do nothing');
await page.locator('.outline a[data-page="Right"]').tap();
await sleep(600);
await page.evaluate(() => window.leanApp.onBack());
await sleep(600);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Left', 'a link, then Back, as always');
allErrors.push(...errors);
await browser.close();

check(!allErrors.length, 'no script errors', allErrors.join(' | '));
process.exit(failures() ? 1 : 0);

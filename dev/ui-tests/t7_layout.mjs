// Layout and keyboard details: the block being edited never hides under the top bars, thread lines at
// other text sizes, opening a page while older days are still loading, back/forward after a reload
// and at the start, bar buttons and the keyboard focus, Recent re-fitting, a very long page,
// the sidebar with many favourites or very little height, the phone's font list, printing.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { open, read, write, check, failures, sleep, go, BASE, VAULT } from './lib.mjs';
const today = new Date();
const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
for (let k = 3; k <= 40; k++) { const d = new Date(today); d.setDate(today.getDate() - k); write(`Diary/${title(d)}.md`, `- day ${k} parent\n\t- day ${k} child\n`); }
write('pages/Long.md', Array.from({ length: 90 }, (_, k) => `- line ${k}\n`).join(''));
write('pages/Thread.md', '- top\n\t- a\n\t\t- a1\n\t\t\t- a2\n\t- b\n\t\t- b1\n- other\n');
const huge = ['- root'];
for (let k = 0; k < 1800; k++) huge.push(`\t- item ${k}`);
huge.push('\t- folded', '\t  collapsed:: true');
for (let k = 0; k < 2000; k++) huge.push(`\t\t- hidden ${k}`);
write('pages/Huge.md', huge.join('\n') + '\n');
const { browser, page, errors } = await open();

console.log('the logo, the sidebar’s button, Search, Home, back and forward are on one line');
const mid = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.top + r.height / 2; }, sel);
const homeMid = await mid('#histbar [data-a="home"]');
const rowMids = [await mid('#histbar .hb-logo'), await mid('#histbar [data-a="side"]'), await mid('#histbar [data-a="search"]'), await mid('#histbar [data-h="back"]'), await mid('#histbar [data-a="date"]')];
check(rowMids.every((m) => Math.abs(m - homeMid) <= 1), 'they sit level with each other', `${homeMid} vs ${rowMids.join(', ')}`);
const sideX = await page.evaluate(() => document.querySelector('#histbar [data-a="side"]').getBoundingClientRect().left);
await page.locator('#histbar [data-a="side"]').click();
await sleep(400);
check(await page.evaluate(() => document.querySelector('#histbar [data-a="side"]').getBoundingClientRect().left) === sideX && Math.abs(await mid('#histbar [data-a="side"]') - homeMid) <= 1, 'with the sidebar hidden, its button stays where it was');
await page.locator('#histbar [data-a="side"]').click();
await sleep(400);

console.log('the block being edited never hides under the top bar');
const editedVsBar = (bar) => page.evaluate((sel) => {
  const t = document.querySelector('textarea.ed');
  return { text: t?.value, taTop: Math.round(t?.getBoundingClientRect().top ?? -1), barBottom: Math.round(document.querySelector(sel).getBoundingClientRect().bottom) };
}, bar);
await go(page, '#/page/Long');
await sleep(400);
await page.locator('#main').evaluate((m) => m.scrollTo(0, 1e9));
await page.locator('.bc', { hasText: /^line 89$/ }).click();
for (let k = 0; k < 70; k++) await page.keyboard.press('ArrowUp');
await sleep(200);
let v = await editedVsBar('#histbar');
check(v.text === 'line 19' && v.taTop >= v.barBottom, 'wide window: the edited block stays below the top strip', JSON.stringify(v));
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 600, height: 800 });
await sleep(400);
await page.evaluate(() => window.scrollTo(0, 1e9));
await page.locator('.bc', { hasText: /^line 89$/ }).click();
for (let k = 0; k < 70; k++) await page.keyboard.press('ArrowUp');
await sleep(200);
v = await editedVsBar('#topbar');
check(v.text === 'line 19' && v.taTop >= v.barBottom, 'narrow window / phone: it stays below the top bar', JSON.stringify(v));
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(300);

console.log('thread lines at a bigger text size');
await go(page, '#/page/Thread');
await sleep(300);
for (let k = 0; k < 5; k++) await page.keyboard.press('Control+='); // 125%
await sleep(300);
const z = await page.evaluate(() => { const b = document.querySelector('.outline .blk'); return b.getBoundingClientRect().width / b.offsetWidth; });
const rowA1 = page.locator('.blk', { has: page.locator(':scope > .bc', { hasText: /^a1$/ }) }).first();
const bx = await rowA1.boundingBox();
const onLineOfA = [bx.x + (24 + 9.5) * z, bx.y + bx.height / 2]; // the second guide beside a1 is "a"'s line
await page.mouse.move(...onLineOfA);
await sleep(150);
const hl = await page.evaluate(() => {
  const l = document.querySelector('.thread-hl');
  if (!l) return null;
  const row = (t) => [...document.querySelectorAll('.blk')].find((b) => b.querySelector(':scope > .bc')?.textContent === t);
  const b = row('a').querySelector(':scope > .bul');
  const r = l.getBoundingClientRect(), bul = b.getBoundingClientRect(), a2 = row('a2').getBoundingClientRect();
  // it runs where the pale line does (.blk::before/::after, Build 32): from --guide-gap under "a"'s
  // dot to the words of the last block under it, --guide-end above the end of that row
  const zz = bul.width / b.offsetWidth, cs = getComputedStyle(b.closest('.blk'));
  const start = (parseFloat(cs.getPropertyValue('--bullet-h')) / 2 + parseFloat(cs.getPropertyValue('--guide-gap'))) * zz, end = parseFloat(cs.getPropertyValue('--guide-end')) * zz;
  return { top: Math.round(r.top - (bul.top + bul.height / 2 + start)), bottom: Math.round(r.bottom - (a2.bottom - end)), x: Math.round(r.left + r.width / 2 - (bul.left + bul.width / 2)), gap: Math.round((r.top - (bul.top + bul.height / 2)) / zz) };
});
check(z > 1.2 && hl && Math.abs(hl.top) <= 1 && Math.abs(hl.bottom) <= 1 && Math.abs(hl.x) <= 1 && hl.gap >= 10, 'at 125% the lit line runs from a gap under the dot to the last block’s words', JSON.stringify({ z, hl }));
await page.mouse.click(...onLineOfA);
await sleep(900);
const tf = read('pages/Thread.md');
check((tf.match(/collapsed:: true/g) || []).length === 1 && /a1\n\s*collapsed:: true/.test(tf), 'and clicking it folds what is under "a" (just a1, the only one with children)', tf);
await page.keyboard.press('Control+0');
await sleep(200);

console.log('lighting a thread line stays quick on a very long page');
await go(page, '#/page/Huge');
await page.waitForFunction(() => window.leanApp.outlines[0]?.drawn >= window.leanApp.outlines[0]?.end, null, { timeout: 15000 });
const ms = await page.evaluate(() => {
  const o = window.leanApp.outlines[0];
  const t0 = performance.now();
  for (let k = 0; k < 5; k++) { o.showThread(null); o.showThread(0); }
  return (performance.now() - t0) / 5;
});
const lit = await page.evaluate(() => { const l = document.querySelector('.thread-hl')?.getBoundingClientRect(); const fb = [...document.querySelectorAll('.blk')].find((b) => b.querySelector(':scope > .bc')?.textContent === 'folded'); const f = fb?.getBoundingClientRect(); return l && f ? Math.round(l.bottom - (f.bottom - parseFloat(getComputedStyle(fb).getPropertyValue('--guide-end')))) : null; });
check(ms < 40 && lit === 0, '3,800 blocks with 2,000 folded at the end: lit in a moment, down to the last block shown', JSON.stringify({ ms: Math.round(ms), lit }));
await page.evaluate(() => window.leanApp.outlines[0].showThread(null));

console.log('opening a page while older days are still loading');
await go(page, '#/journals');
await sleep(1500);
let slow = true;
await page.route('**/api/page', async (r) => { if (slow) await sleep(250); await r.continue(); });
await page.mouse.move(760, 500);
await page.mouse.wheel(0, 20000);
await sleep(150);
await page.evaluate(() => window.leanApp.go('page', 'Maths'));
await sleep(2500);
slow = false;
await page.unroute('**/api/page');
const outs = await page.evaluate(() => window.leanApp.outlines.map((o) => o.name + (o.el.isConnected ? '' : ' (not on screen)')));
check(outs.length === 1 && outs[0] === 'Maths', 'only the page on screen is open for editing (no journal days sneak in)', JSON.stringify(outs));
const daily = () => Object.fromEntries(fs.readdirSync(VAULT + '/Diary').map((f) => [f, read('Diary/' + f)]));
const before = daily();
await page.keyboard.press('t');
await page.keyboard.press('o');
await sleep(1200);
const after = daily();
check(Object.keys(before).every((f) => before[f] === after[f]), '"t o" there leaves the journal files alone');
await page.keyboard.press('t');
await page.keyboard.press('o');
await sleep(800);

console.log('back and forward: at the start and after a reload');
const p0 = await page.context().newPage(); // a fresh window, started without a page in its address
const steps0 = await p0.evaluate(() => history.length); // its blank start
await p0.goto(BASE + '/?t=' + Date.now());
await p0.waitForSelector('.sheet .outline');
await sleep(400);
const s0 = await p0.evaluate(() => ({ hash: location.hash, steps: history.length, n: history.state?.n, back: document.querySelector('#histbar [data-h="back"]').disabled }));
check(s0.hash === '#/journals' && s0.steps === steps0 + 1 && s0.n === 0 && s0.back, 'starting adds no extra step behind the first page (Back is greyed out)', JSON.stringify({ steps0, ...s0 }));
await p0.close();
await go(page, '#/journals');
await go(page, '#/page/Maths');
await go(page, '#/page/APRON');
await page.keyboard.press('Alt+ArrowLeft');
await sleep(600);
await page.reload();
await page.waitForSelector('#histbar [data-h="forward"]');
await sleep(800);
const s1 = await page.evaluate(() => ({ hash: decodeURIComponent(location.hash), back: document.querySelector('#histbar [data-h="back"]').disabled, fwd: document.querySelector('#histbar [data-h="forward"]').disabled }));
check(s1.hash === '#/page/Maths' && !s1.back && !s1.fwd, 'after a reload both arrows still know where they can go', JSON.stringify(s1));
if (!s1.fwd) await page.locator('#histbar [data-h="forward"]').click();
await sleep(600);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/APRON' && await page.locator('#histbar [data-h="forward"]').isDisabled(), 'Forward goes ahead, then greys out');

console.log('buttons in the bars and fold headings don’t keep the keyboard focus');
await page.locator('#histbar [data-h="back"]').click();
await sleep(600);
const h1 = await page.evaluate(() => location.hash);
await page.keyboard.press(' ');
await sleep(400);
check(await page.evaluate(() => location.hash) === h1, 'after clicking Back, Space doesn’t go back again');
const recentFold = page.locator('.side-sec[data-sec="recent"] .side-fold');
await recentFold.click();
await sleep(200);
await page.keyboard.press(' ');
await sleep(200);
check(!(await page.locator('#recent').isVisible()), 'after folding Recent with a click, Space doesn’t unfold it again');
await recentFold.click();
await sleep(200);

console.log('Recent re-fits whenever its space changes');
for (const n of ['Sourdough Bread', 'Pictures', 'Tasks', 'Templates', 'Marta Pell', 'Rosa Penhallow', 'Orphan page', 'Pickles in brine']) await go(page, '#/page/' + encodeURIComponent(n));
const halfCut = () => page.evaluate(() => { const r = document.querySelector('#recent'); const rb = r.getBoundingClientRect().bottom + 0.5; return [...r.querySelectorAll('a')].filter((a) => !a.hidden).some((a) => a.getBoundingClientRect().bottom > rb); });
await page.keyboard.press('t');
await page.keyboard.press('l');
await sleep(200);
await page.setViewportSize({ width: 1280, height: 560 });
await sleep(300);
await page.locator('#histbar [data-a="side"]').click();
await sleep(300);
const shownNow = await page.evaluate(() => [...document.querySelectorAll('#recent a')].filter((a) => !a.hidden).length);
check(!(await halfCut()) && shownNow >= 1, 'showing the sidebar again after the window changed: no page name cut in half', shownNow);
await page.evaluate(() => { document.querySelector('#update').hidden = false; });
await sleep(300);
check(!(await halfCut()), 'nor when the "newer version" notice appears');
await page.evaluate(() => { document.querySelector('#update').hidden = true; });
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(300);

console.log('the reading position survives the window switching between wide and narrow');
await go(page, '#/page/Long');
await sleep(400);
const topLine = () => page.evaluate(() => {
  const main = document.querySelector('#main');
  const wide = getComputedStyle(main).overflowY !== 'visible';
  const top = wide ? main.getBoundingClientRect().top : document.querySelector('#topbar').getBoundingClientRect().bottom;
  const b = [...document.querySelectorAll('.outline .blk')].find((x) => x.getBoundingClientRect().bottom > top + 2);
  return b?.querySelector(':scope > .bc')?.textContent;
});
await page.locator('#main').evaluate((m) => { const b = [...m.querySelectorAll('.outline .blk')].find((x) => x.querySelector(':scope > .bc')?.textContent === 'line 60'); m.scrollTop += b.getBoundingClientRect().top - m.getBoundingClientRect().top; });
await sleep(400); // it notes the top a moment after scrolling stops
const atWide = await topLine();
await page.setViewportSize({ width: 800, height: 900 });
await sleep(400);
const atNarrow = await topLine();
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(400);
const atWideAgain = await topLine();
const near = (t) => Math.abs(Number(t?.split(' ')[1]) - 60) <= 1;
check(atWide === 'line 60' && near(atNarrow) && near(atWideAgain), 'line 60 stays at the top (wide → narrow → wide)', JSON.stringify({ atWide, atNarrow, atWideAgain }));

console.log('moving quickly: only the newest page is open for editing');
write('pages/Middle.md', '- m parent\n\t- m child\n');
await go(page, '#/page/Thread');
await go(page, '#/page/Middle');
await go(page, '#/page/Maths');
let slowPages = true;
await page.route('**/api/page', async (r) => { if (slowPages) await sleep(300); await r.continue(); });
await page.keyboard.press('Alt+ArrowLeft');
await sleep(100);
await page.keyboard.press('Alt+ArrowLeft');
await sleep(2000);
slowPages = false;
await page.unroute('**/api/page');
const quick = await page.evaluate(() => ({ hash: decodeURIComponent(location.hash), outlines: window.leanApp.outlines.map((o) => o.name + (o.el.isConnected ? '' : ' (not on screen)')) }));
check(quick.hash === '#/page/Thread' && quick.outlines.join() === 'Thread', 'Back twice while a page loads: just the page on screen', JSON.stringify(quick));
const mid0 = read('pages/Middle.md');
await page.keyboard.press('t');
await page.keyboard.press('o');
await sleep(1000);
check(read('pages/Middle.md') === mid0, '"t o" then leaves the page passed on the way alone');
await page.keyboard.press('t');
await page.keyboard.press('o');
await sleep(800);

console.log('Ctrl+End, the star button, and the arrows after a page that couldn’t be left');
await go(page, '#/page/Long');
await sleep(300);
await page.locator('#recent a', { hasText: 'Long' }).first().focus(); // focus in the sidebar, as after opening a page from Recent
await page.keyboard.press('Control+End');
await sleep(400);
check(await page.locator('#main').evaluate((m) => m.scrollTop + m.clientHeight >= m.scrollHeight - 2), 'Ctrl+End goes to the end of the notes');
await page.locator('.title-row [data-a="fav"]').click();
await sleep(500);
const favd = read('logseq/config.edn').includes('"Long"');
await page.keyboard.press(' ');
await sleep(500);
check(favd && read('logseq/config.edn').includes('"Long"'), 'after clicking the star, Space doesn’t take the page off the favourites again');
await page.locator('.title-row [data-a="fav"]').click(); // and off again
await sleep(500);
const conflict = (on) => page.evaluate((v) => { const o = window.leanApp.outlines[0]; o.conflict = v; if (v) o.showConflict(); else o.banner.hidden = true; }, on);
const arrows = () => page.evaluate(() => ({ hash: decodeURIComponent(location.hash), back: !document.querySelector('#histbar [data-h="back"]').disabled, fwd: !document.querySelector('#histbar [data-h="forward"]').disabled }));
await go(page, '#/page/Tasks');
await go(page, '#/page/Templates');
await conflict(true);
await page.keyboard.press('Alt+ArrowLeft'); // stuck: stays on Templates
await sleep(600);
await conflict(false);
await page.keyboard.press('Alt+ArrowRight');
await sleep(600);
const ar = await arrows();
check(ar.hash === '#/page/Templates' && !ar.fwd, 'after a page that couldn’t be left, the arrows still match where you are', JSON.stringify(ar));

console.log('sidebar: many favourites, very little height');
await page.setViewportSize({ width: 1180, height: 480 }); // the smallest the window can be
await sleep(400);
check(await page.evaluate(() => { const s = document.querySelector('#side'); return s.scrollHeight - s.clientHeight; }) <= 0, 'at the smallest window height the sidebar needs no scroll bar (2 favourites)');
await page.setViewportSize({ width: 1280, height: 900 });
await sleep(300);
const cfg = read('logseq/config.edn');
write('logseq/config.edn', cfg.replace(/:favorites \[[^\]]*\]/, `:favorites [${Array.from({ length: 20 }, (_, k) => `"Fav page ${k + 1}"`).join(' ')}]`));
await page.reload();
await page.waitForSelector('.sheet .outline');
await page.setViewportSize({ width: 1280, height: 800 });
await sleep(500);
const sb = await page.evaluate(() => {
  const r = (q) => document.querySelector(q).getBoundingClientRect();
  const list = document.querySelector('#favs .side-list'), side = document.querySelector('#side');
  return { favsBottom: Math.round(r('#favs').bottom), recentHead: Math.round(r('.side-sec[data-sec="recent"] .side-h').top), recentBottom: Math.round(r('.side-sec[data-sec="recent"]').bottom), footTop: Math.round(r('.side-foot').top), shown: [...document.querySelectorAll('#recent a')].filter((a) => !a.hidden).length, favScrolls: list.scrollHeight > list.clientHeight, sideOver: side.scrollHeight - side.clientHeight };
});
check(sb.recentHead >= sb.favsBottom && sb.recentBottom <= sb.footTop, '20 favourites: nothing overlaps', JSON.stringify(sb));
check(sb.shown >= 1 && sb.favScrolls && sb.sideOver <= 1, 'Recent keeps some room, the long Favourites list scrolls by itself, the sidebar doesn’t', JSON.stringify(sb));
await page.setViewportSize({ width: 740, height: 360 }); // a phone on its side
await sleep(400);
await page.locator('#topbar [data-a="menu"]').click();
await sleep(400);
const sh = await page.evaluate(async () => {
  const r = (q) => document.querySelector(q).getBoundingClientRect();
  const s = document.querySelector('#side');
  const overlap = r('.side-sec[data-sec="recent"] .side-h').top < r('#favs .side-h').bottom - 0.5;
  s.scrollTop = 1e9;
  await new Promise((res) => setTimeout(res, 100));
  const set = r('#side a[data-view="settings"]');
  return { overlap, scrolls: s.scrollHeight > s.clientHeight, settings: set.top >= 0 && set.bottom <= innerHeight + 0.5 };
});
check(!sh.overlap && sh.scrolls && sh.settings, 'very little height: the menu scrolls instead of squashing (Settings stays reachable)', JSON.stringify(sh));
await page.mouse.click(720, 200);
await sleep(300);
write('logseq/config.edn', cfg);
await browser.close();

console.log('the phone’s font list');
const b2 = await chromium.launch();
const ctx2 = await b2.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
const p2 = await ctx2.newPage();
const errors2 = [];
p2.on('pageerror', (e) => errors2.push(e.message));
await p2.addInitScript(() => { window.LeanAndroid = { hasAllFilesAccess: () => true }; });
await p2.goto(BASE + '/');
await p2.evaluate((p) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(p)); }, VAULT);
await p2.goto(BASE + '/?t=' + Date.now() + '#/settings/look');
await p2.waitForSelector('#ts-body');
const fonts = await p2.locator('#ts-body option').allTextContents();
check(!fonts.some((t) => /Segoe|Calibri|Consolas/.test(t)) && fonts.some((t) => t.includes('phone’s own serif')) && fonts.some((t) => t.includes('this phone')), 'it offers the phone’s fonts, not Windows ones', fonts.join(' | '));
check(await p2.locator('[data-tauri-drag-region]').count() === 0, 'and nothing on the phone is marked for moving a window');
await b2.close();

console.log('grabbing the scroll bar while typing keeps the typing in the block');
const b3 = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }); // real scroll bars, as on Windows
const p3 = await b3.newPage({ viewport: { width: 1280, height: 800 } });
const errors3 = [];
p3.on('pageerror', (e) => errors3.push(e.message));
await p3.goto(BASE + '/');
await p3.evaluate((p) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(p)); }, VAULT);
await p3.goto(BASE + '/?t=' + Date.now() + '#/page/Long');
await p3.waitForSelector('.outline');
await sleep(500);
await p3.locator('.outline .bc', { hasText: /^line 2$/ }).click();
await p3.waitForSelector('textarea.ed');
await p3.keyboard.press('End');
const barY = await p3.evaluate(() => document.querySelector('#main').getBoundingClientRect().top + 30);
await p3.mouse.move(1272, barY);
await p3.mouse.down();
await p3.mouse.move(1272, barY + 200, { steps: 8 });
await p3.mouse.up();
await sleep(300);
const dragged = await p3.evaluate(() => ({ scrolled: document.querySelector('#main').scrollTop, focus: document.activeElement?.tagName }));
await p3.keyboard.type(' to');
await sleep(900);
check(dragged.scrolled > 100 && dragged.focus === 'TEXTAREA' && read('pages/Long.md').includes('- line 2 to\n') && !read('pages/Long.md').includes('collapsed'), 'the scroll bar moved the notes and the typing still went into the block', JSON.stringify(dragged));
await b3.close();

const all = [...errors, ...errors2, ...errors3];
console.log(all.length ? 'script errors:\n' + all.join('\n') : 'no script errors');
process.exit(failures() ? 1 : 0);

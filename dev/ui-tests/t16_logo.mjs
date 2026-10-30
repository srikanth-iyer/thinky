// The logo in the app (Build 32, his "yes to all" list, each its own commit): the start-up drawing;
// the red spark as a small mark (favourite, today, a new version, thanks); the saved spark; the scribble as the spinner; the phone's "+"; the look thinky; Calm's accent; the icon in each look's colours.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import zlib from 'node:zlib';
import { check, failures, sleep, open, go, read, BASE, VAULT, SHOTS } from './lib.mjs';

const errors = [];
const browser = await chromium.launch();
/** A page at `hash` with `look`, `init` run before it loads (e.g. a slowed command). */
async function start(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.phone ? { width: 390, height: 844 } : { width: 1280, height: 860 }, hasTouch: !!opts.phone, isMobile: !!opts.phone, reducedMotion: opts.still ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
  if (opts.init) await opts.init(page);
  await page.goto(BASE + '/');
  await page.evaluate(([v, l]) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify(l)); }, [VAULT, opts.look || 'calm']);
  await page.goto(BASE + '/?t=' + Date.now() + (opts.hash || '#/journals'));
  return page;
}
const slowOpen = (ms) => (pg) => pg.route('**/api/open', async (r) => { await sleep(ms); r.continue(); });

// --------------------------------------------------------------------------------------------
console.log('2. start-up: the scribble draws itself while the app opens, then fades');
{
  const page = await start({ init: slowOpen(2500), look: 'plainnight' });
  await sleep(300);
  const s = await page.evaluate(() => {
    const sp = document.getElementById('splash');
    if (!sp) return null;
    const r = sp.getBoundingClientRect(), svg = sp.querySelector('svg').getBoundingClientRect();
    const anims = document.getAnimations().filter((a) => sp.contains(a.effect.target));
    const end = (a) => { const t = a.effect.getComputedTiming(); return t.delay + t.activeDuration; };
    return {
      cover: r.width === innerWidth && r.height === innerHeight, clicks: getComputedStyle(sp).pointerEvents,
      bg: getComputedStyle(sp).backgroundColor, page: getComputedStyle(document.body).backgroundColor,
      centred: Math.abs(svg.left + svg.width / 2 - innerWidth / 2) < 2 && Math.abs(svg.top + svg.height / 2 - innerHeight / 2) < 2,
      drawing: anims.filter((a) => a.animationName !== 'sp-away').map((a) => [a.animationName, end(a)]),
      spark: getComputedStyle(sp.querySelector('.sp-spark')).fill,
      lookSpark: (() => { const x = document.createElement('i'); x.style.color = 'var(--logo-spark)'; document.body.append(x); const c = getComputedStyle(x).color; x.remove(); return c; })(),
      under: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#splash') === null,
    };
  });
  check(s && s.cover && s.clicks === 'none' && s.under, 'it covers the window while opening, but never takes a click', JSON.stringify(s));
  check(s && s.bg === 'rgb(244, 238, 227)' && s.centred, 'centred, on the brand\'s cream in every look (he asked, Oct 30; here Plain night)', JSON.stringify(s));
  check(s && s.drawing.some(([n]) => n === 'sp-draw') && s.drawing.some(([n]) => n === 'sp-spark') && Math.max(...s.drawing.map(([, e]) => e)) <= 700, 'the line draws itself and ends in the spark, about half a second', JSON.stringify(s?.drawing));
  check(s && s.spark === 'rgb(255, 75, 43)', 'the brand\'s ink line and red spark', JSON.stringify(s));
  await page.waitForSelector('.sheet .outline', { timeout: 15000 });
  await sleep(500);
  check(await page.evaluate(() => !document.getElementById('splash')), 'gone once the first page is drawn');
  await go(page, '#/pages');
  await go(page, '#/journals');
  check(await page.evaluate(() => !document.getElementById('splash')), 'not shown again on a page change');
  await page.context().close();
}
{
  // a quick start: it never waits for the drawing to finish
  const page = await start({});
  const t0 = Date.now();
  await page.waitForSelector('.sheet .outline');
  await page.waitForFunction(() => !document.getElementById('splash') || document.getElementById('splash').classList.contains('done'));
  check(Date.now() - t0 < 5000, 'a page that is ready sends it away at once (no delay added)');
  await page.context().close();
}
{
  const page = await start({ init: slowOpen(1500), still: true, phone: true });
  await sleep(300);
  const s = await page.evaluate(() => {
    const sp = document.getElementById('splash');
    const moving = document.getAnimations().filter((a) => sp.contains(a.effect.target) && a.animationName !== 'sp-away');
    return { moving: moving.length, offset: getComputedStyle(sp.querySelector('.sp-line')).strokeDashoffset, spark: getComputedStyle(sp.querySelector('.sp-spark')).transform };
  });
  check(s.moving === 0 && parseFloat(s.offset) === 0 && s.spark === 'none', 'reduced motion: the whole drawing, still', JSON.stringify(s));
  await page.waitForSelector('.sheet .outline', { timeout: 15000 });
  await sleep(400);
  check(await page.evaluate(() => !document.getElementById('splash')), 'reduced motion: gone when the page is drawn');
  await page.context().close();
}

// --------------------------------------------------------------------------------------------
console.log('3. the red spark as a small mark: favourite, today in the date picker, a new version, thanks');
const RED = 'rgb(255, 75, 43)';
for (const phone of [false, true]) {
  const page = await start({ phone, hash: '#/page/' + encodeURIComponent('Sourdough Bread') });
  await page.waitForSelector('.title-row [data-a="fav"]');
  const fav = () => page.evaluate(() => { const b = document.querySelector('.title-row [data-a="fav"]'), sv = b.querySelector('svg'); return { on: b.classList.contains('on'), color: getComputedStyle(b).color, fill: getComputedStyle(sv).fill, d: sv.querySelector('path').getAttribute('d'), w: b.getBoundingClientRect().width }; });
  let f = await fav();
  check(f.on && f.color === RED && f.fill === RED && /Q12 12/.test(f.d), `${phone ? 'phone' : 'laptop'}: a favourite page's button is the logo's spark, filled red`, JSON.stringify(f));
  await go(page, '#/page/' + encodeURIComponent('Marta Pell'));
  f = await fav();
  check(!f.on && f.color !== RED && f.fill === 'none', `${phone ? 'phone' : 'laptop'}: not a favourite: the spark's outline in the usual grey`, JSON.stringify(f));
  if (phone) check(f.w >= 32, 'phone: the button is still easy to tap', f.w);
  await page.click('.title-row [data-a="fav"]');
  await sleep(500);
  f = await fav();
  check(f.on && f.color === RED, 'a click makes it a favourite: red', JSON.stringify(f));
  await page.click('.title-row [data-a="fav"]'); // (put back)
  await sleep(400);
  await go(page, '#/journals');
  await page.locator('[data-a="date"]:visible').first().click();
  await page.waitForSelector('.cal .day.today');
  const t = await page.evaluate(() => { const d = document.querySelector('.cal .day.today'), b = getComputedStyle(d, '::before'); return { bg: b.backgroundColor, mask: b.maskImage || b.webkitMaskImage, w: b.width, ring: getComputedStyle(d).boxShadow, weight: getComputedStyle(d).fontWeight }; });
  check(t.bg === RED && /svg/.test(t.mask) && t.w === '9px' && t.ring === 'none' && +t.weight >= 700, `${phone ? 'phone' : 'laptop'}: today in the date picker: bold, with a small red spark at its corner`, JSON.stringify(t));
  await page.keyboard.press('Escape');
  await page.context().close();
}
{
  // a look could give the spark its own colour (the token)
  const page = await start({ hash: '#/page/' + encodeURIComponent('Sourdough Bread') });
  await page.waitForSelector('.title-row [data-a="fav"].on');
  const c = await page.evaluate(() => { document.documentElement.style.setProperty('--spark', 'rgb(1, 2, 3)'); return getComputedStyle(document.querySelector('.title-row [data-a="fav"]')).color; });
  check(c === 'rgb(1, 2, 3)', 'the spark\'s colour is a token, --spark', c);
  await page.context().close();
}
for (const phone of [false, true]) {
  const page = await start({ phone, hash: '#/settings/about' });
  await page.waitForSelector('.fb');
  const marks = () => page.evaluate(() => {
    const after = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e, '::after').backgroundColor : null; };
    return { settings: after('#side .nav a[data-view="settings"]'), about: after('.set-tabs [data-tab="about"]'), menu: after('#topbar [data-a="menu"]') };
  });
  const none = await marks();
  check(none.settings !== RED && none.about !== RED && none.menu !== RED, `${phone ? 'phone' : 'laptop'}: no spark while the app is up to date`, JSON.stringify(none));
  await page.evaluate(() => document.documentElement.classList.add('has-update')); // (what checkUpdate does when a newer build is out)
  const m = await marks();
  check(m.settings === RED && m.about === RED && m.menu === RED, `${phone ? 'phone' : 'laptop'}: a newer version: a small spark on Settings, the About tab (and the phone's menu button)`, JSON.stringify(m));
  await page.evaluate(() => { window.open = () => null; }); // (the browser isn't really opened)
  await page.fill('.fb-msg', 'hello');
  await page.click('.fb [data-a="send"]');
  await page.waitForFunction(() => /Opened/.test(document.querySelector('.fb-out').textContent));
  const out = await page.evaluate(() => { const o = document.querySelector('.fb-out'); return { text: o.textContent, spark: getComputedStyle(o.querySelector('.spark-mark') || o).backgroundColor }; });
  check(out.text === 'Opened in your browser. Thank you!' && out.spark === RED, `${phone ? 'phone' : 'laptop'}: "Opened in your browser. Thank you!" with the spark`, JSON.stringify(out));
  await page.context().close();
}

// --------------------------------------------------------------------------------------------
console.log('4. saved: a tiny spark by the title fades in and out when a save completes');
for (const still of [false, true]) {
  const page = await start({ still, hash: '#/page/' + encodeURIComponent('Marta Pell') });
  await page.waitForSelector('.sheet .outline');
  const box = () => page.evaluate(() => { const t = document.querySelector('.sheet .page-title'), r = t.getBoundingClientRect(), n = t.querySelector('.pt-name').getBoundingClientRect(); return [r.height, r.width, n.left, n.width].map(Math.round).join(); });
  const before = await box();
  await page.locator('.outline .blk > .bc', { hasText: 'Notes on Wild Yeast' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.waitForFunction(() => document.querySelector('.sheet .page-title .saved-mark.on'), null, { timeout: 5000 });
  const m = await page.evaluate(() => {
    const e = document.querySelector('.saved-mark'), a = document.getAnimations().find((x) => x.effect.target === e && x.effect.pseudoElement === '::before');
    return { n: document.querySelectorAll('.saved-mark').length, name: a?.animationName, ms: a?.effect.getComputedTiming().duration, color: getComputedStyle(e, '::before').backgroundColor, w: e.getBoundingClientRect().width, hidden: e.getAttribute('aria-hidden') };
  });
  check(m.n === 1 && m.name === (still ? 'saved-still' : 'saved-spark') && m.ms === 600 && m.color === RED && m.w === 0 && m.hidden === 'true', `${still ? 'reduced motion: shown briefly, no movement' : 'one small red spark by the title, 0.6 s'}`, JSON.stringify(m));
  check(await box() === before, 'nothing moves: the title keeps its size and place', `${before} → ${await box()}`);
  check(read('pages/Marta Pell.md').includes('Wild Yeast!'), 'and the page really was saved');
  if (!still) {
    await sleep(800);
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.saved-mark'), '::before').opacity) === '0', 'gone again afterwards');
    await page.keyboard.press('Escape');
    await go(page, '#/journals');
    await page.locator('.sheet.day.today .outline .blk > .bc', { hasText: 'cold-proving' }).first().click();
    await page.keyboard.press('End');
    await page.keyboard.type('.');
    await page.waitForFunction(() => document.querySelector('.sheet.day.today .page-title .saved-mark.on'), null, { timeout: 5000 });
    check(await page.evaluate(() => document.querySelectorAll('.saved-mark').length) === 1, 'a journal day: by its date (the same one element, moved)');
  }
  await page.context().close();
}

// --------------------------------------------------------------------------------------------
console.log('5. a slow wait: the scribble turns beside its words');
const slowCmd = (cmd, ms = 4000) => (pg) => pg.route(new RegExp(`/api/(${cmd})$`), async (r) => { await sleep(ms); r.continue(); });
const spinning = (page) => page.evaluate(() => {
  const w = [...document.querySelectorAll('.wait-mark')].find((e) => e.getClientRects().length);
  if (!w) return null;
  const s = w.querySelector('.spin'), run = s.querySelector('.sp-run'), base = s.querySelector('.sp-base');
  const a = document.getAnimations().find((x) => x.effect.target === run);
  const sb = s.getBoundingClientRect(), rb = base.getBoundingClientRect();
  return { words: w.textContent.trim(), role: w.getAttribute('role'), anim: a?.animationName, playing: a?.playState, w: Math.round(sb.width),
    inside: rb.left >= sb.left - 1 && rb.top >= sb.top - 1 && rb.right <= sb.right + 1 && rb.bottom <= sb.bottom + 1 };
});
const okSpin = (r, words) => r && r.words === words && r.role === 'status' && r.anim === 'spin-draw' && r.playing === 'running' && r.w <= 24 && r.inside;
{
  let page = await start({ hash: '#/page/' + encodeURIComponent('Marta Pell'), init: slowCmd('unlinked') });
  await page.waitForSelector('.sec.unlinked .disclose');
  await page.click('.sec.unlinked .disclose');
  await sleep(300);
  let r = await spinning(page);
  check(okSpin(r, 'Looking through your notes…'), 'unlinked references: the scribble turns while it looks', JSON.stringify(r));
  await page.waitForFunction(() => !document.querySelector('.sec.unlinked .wait-mark'), null, { timeout: 15000 });
  check(true, 'and goes when the answer comes');
  await page.context().close();
  page = await start({ hash: '#/settings/notes', init: slowCmd('check') });
  await page.locator('[data-a="check"]').first().click();
  await sleep(300);
  r = await spinning(page);
  check(okSpin(r, 'Reading every page…'), 'Check this folder: the scribble turns', JSON.stringify(r));
  await page.context().close();
  page = await start({ hash: '#/page/' + encodeURIComponent('Marta Pell'), init: slowCmd('history') });
  await page.waitForSelector('.title-row [data-a="more"]');
  await page.click('.title-row [data-a="more"]');
  await page.getByText('History…').click();
  await sleep(400);
  r = await spinning(page);
  check(okSpin(r, 'Looking for earlier versions…'), 'History: the scribble turns while it looks', JSON.stringify(r));
  await page.context().close();
  page = await start({ init: slowCmd('search', 1500) });
  await page.waitForSelector('.sheet .outline');
  await page.evaluate(() => window.leanApp.openSearch());
  await page.keyboard.type('brine');
  await sleep(600);
  r = await spinning(page);
  check(okSpin(r, 'Searching your notes…'), 'the first search: the scribble turns in the list', JSON.stringify(r));
  await page.waitForSelector('#search .results li.r-hit, #search .results li.r-page', { timeout: 10000 });
  await page.keyboard.type(' sweep');
  await sleep(500);
  check(!(await spinning(page)), 'later searches don\'t blank the list for it');
  await page.context().close();
  page = await start({ hash: '#/settings/notes' });
  await page.waitForSelector('.card');
  await page.route(/\/api\/open$/, async (rt) => { await sleep(2500); rt.continue(); });
  await page.evaluate((v) => import('/settings.js').then((m) => { m.useVault(window.leanApp, v); }), VAULT);
  await sleep(500);
  r = await spinning(page);
  check(okSpin(r, 'Opening your notes…'), 'opening a notes folder: the scribble turns where the page will be', JSON.stringify(r));
  await page.waitForSelector('.sheet .outline', { timeout: 15000 });
  await page.context().close();
  page = await start({ hash: '#/settings/notes', init: slowCmd('check'), still: true });
  await page.locator('[data-a="check"]').first().click();
  await sleep(300);
  r = await page.evaluate(() => { const run = document.querySelector('.wait-mark .sp-run'); return { n: document.getAnimations().filter((a) => a.effect.target === run).length, dash: getComputedStyle(run).strokeDasharray }; });
  check(r.n === 0 && r.dash === 'none', 'reduced motion: the scribble stands still, whole', JSON.stringify(r));
  await page.context().close();
}

// --------------------------------------------------------------------------------------------
console.log('6. the phone\'s "+": drawn in the logo\'s pen line, with the red spark');
for (const look of ['calm', 'plainnight']) {
  const page = await start({ phone: true, look });
  await page.waitForSelector('#addnote:not([hidden])');
  const f = await page.evaluate(() => {
    const b = document.querySelector('#addnote'), sv = b.querySelector('svg'), line = sv.querySelector('path:not(.fab-spark)'), sp = sv.querySelector('.fab-spark');
    const ink = (() => { const x = document.createElement('i'); x.style.color = 'var(--ink)'; document.body.append(x); const c = getComputedStyle(x).color; x.remove(); return c; })();
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), stroke: getComputedStyle(line).stroke, ink, cap: getComputedStyle(line).strokeLinecap, arms: (line.getAttribute('d').match(/M/g) || []).length, spark: getComputedStyle(sp).fill, label: b.getAttribute('aria-label') };
  });
  check(f.w === 46 && f.h === 46 && f.label === 'Add a note', `${look}: the same size and words as before`, JSON.stringify(f));
  check(f.stroke === f.ink && f.cap === 'round' && f.arms === 2, `${look}: a "+" of two pen strokes, round ends, in the look's ink`, JSON.stringify(f));
  check(f.spark === RED, `${look}: the red spark at its tip`, f.spark);
  const n = await page.locator('.sheet.day.today .outline .blk').count();
  await page.click('#addnote');
  await page.waitForSelector('textarea.ed');
  check(await page.locator('.sheet.day.today .outline .blk').count() === n + 1, `${look}: a tap still adds a note to today`);
  await page.context().close();
}

// --------------------------------------------------------------------------------------------
console.log('7. the look "thinky": the logo\'s cream, ink and red');
{
  const page = await start({ look: 'thinky' });
  await page.waitForSelector('.sheet .outline');
  const c = await page.evaluate(() => {
    const rgb = (v) => { const x = document.createElement('i'); x.style.color = v; document.body.append(x); const c = getComputedStyle(x).color; x.remove(); return c.match(/\d+/g).slice(0, 3).map(Number); };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const con = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    return {
      bg: rgb('var(--bg)').join(), ink: rgb('var(--ink)').join(), spark: rgb('var(--spark)').join(),
      inkOnSheet: con('var(--ink)', 'var(--surface)'), linkOnSheet: con('var(--link)', 'var(--surface)'), linkOnPage: con('var(--link)', 'var(--bg)'),
      accentOnPage: con('var(--accent)', 'var(--bg)'), accentOnSheet: con('var(--accent)', 'var(--surface)'), onAccent: con('var(--accent-ink)', 'var(--accent)'),
      faint: con('var(--ink-faint)', 'var(--surface)'), tag: con('var(--tag-ink)', 'var(--tag-bg)'),
      side: getComputedStyle(document.querySelector('#side')).backgroundImage,
      name: !!document.querySelector('#side .look-cur svg.wm-in'),
    };
  });
  check(c.bg === '255,255,255' && c.ink === '29,26,46' && c.spark === '255,75,43', 'a white page, no cards, as in Calm plain (he found the cream too creamy), the ink, the red spark', JSON.stringify(c));
  check(c.inkOnSheet >= 7 && c.linkOnSheet >= 4.5 && c.linkOnPage >= 4.5 && c.accentOnPage >= 4.5 && c.accentOnSheet >= 4.5 && c.onAccent >= 4.5 && c.faint >= 3.5 && c.tag >= 4.5, 'words, links, the accent and words on it are easy to read (≥ 4.5:1)', JSON.stringify(c));
  check(/thinky-corner\.svg/.test(c.side) && c.name, 'the scribble faint in the sidebar\'s corner; its name in the sidebar is the wordmark', JSON.stringify(c));
  const img = await page.evaluate(async () => { const t = await (await fetch('/skins/thinky-corner.svg')).text(); const d = new DOMParser().parseFromString(t, 'image/svg+xml'); return { ok: !d.querySelector('parsererror'), size: t.length }; });
  check(img.ok && img.size < 7000, 'the corner picture (etched: its line drawn twice) is small and well formed', JSON.stringify(img));
  await page.click('#side [data-a="looks"]');
  await page.waitForSelector('.pop.looks [data-look="thinky"]');
  check(await page.evaluate(() => !!document.querySelector('.pop.looks [data-look="thinky"] .look-txt svg.wm-in')), 'the Look list names it with the wordmark');
  await page.keyboard.press('Escape');
  await page.context().close();
}

// --------------------------------------------------------------------------------------------
console.log('9. Calm\'s accent: a warmer, creamier green');
for (const look of ['calm', 'calmplain']) {
  const page = await start({ look, hash: '#/settings/notes' });
  await page.waitForSelector('.card .btn');
  const c = await page.evaluate(() => {
    const rgb = (v) => { const x = document.createElement('i'); x.style.color = v; document.body.append(x); const c = getComputedStyle(x).color; x.remove(); return c.match(/\d+/g).slice(0, 3).map(Number); };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const con = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    const green = ([r, g, b]) => g > r + 20 && g > b; // (a green or teal)
    const btn = getComputedStyle(document.querySelector('.card .btn:not(.ghost)'));
    return { accent: rgb('var(--accent)').join(), tint: rgb('var(--accent-tint)'), edit: rgb('var(--edit-bg)'), onAccent: con('var(--accent-ink)', 'var(--accent)'), link: con('var(--link)', 'var(--surface)'),
      btn: btn.backgroundColor, greens: [rgb('var(--accent)'), rgb('var(--accent-tint)'), rgb('var(--edit-bg)')].filter(green).length };
  });
  check(c.accent === '47,110,82' && c.btn === 'rgb(47, 110, 82)', `${look}: the accent is the warmer green, buttons too`, JSON.stringify(c));
  check(c.onAccent >= 4.5 && c.link >= 4.5, `${look}: words on buttons and links stay easy to read`, JSON.stringify(c));
  await page.context().close();
}

// --------------------------------------------------------------------------------------------
console.log('10. the icon inside the app takes each look\'s colours');
/** The colour of one pixel of the page, as [r, g, b] (a 1-pixel screenshot, its PNG read by hand). */
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const idat = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)); // [filter, r, g, b, (a)]
  return [raw[1], raw[2], raw[3]];
}
const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 4);
const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
for (const [look, tile, spark] of [['calm', '#F4EEE3', '#FF4B2B'], ['plainnight', '#262626', '#FF6E52'], ['automaton', '#E1E9FD', '#FF4B2B'], ['paper', '#FFFEFA', '#B23A26']]) {
  const page = await start({ look, init: (pg) => pg.addInitScript(() => { try { localStorage.removeItem('vault'); } catch {} }) }); // (the welcome screen)
  await page.waitForSelector('.wl-logo .logo');
  await sleep(500);
  const r = await page.evaluate(() => { const b = document.querySelector('.wl-logo .logo').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, href: document.querySelector('.wl-logo .logo use').getAttribute('href'), tokens: ['--logo-tile', '--logo-ink', '--logo-spark'].map((t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim()) }; });
  const u = r.w / 1024;
  const t = await pixel(page, Math.round(r.x + 60 * u), Math.round(r.y + 512 * u)); // (the tile, left of the scribble)
  const sp = await pixel(page, Math.round(r.x + 765 * u), Math.round(r.y + 268 * u)); // (the spark's middle)
  check(r.href === 'brand/icon-in.svg#m' && near(t, hex(tile)) && near(sp, hex(spark)), `${look}: the welcome screen's icon in the look's colours (tile ${tile}, spark ${spark})`, JSON.stringify({ ...r, t, sp }));
  await page.context().close();
}
{
  const fs = await import('node:fs');
  const ui = new URL('../../ui/', import.meta.url).pathname;
  const small = fs.readFileSync(ui + 'brand/icon-small.svg', 'utf8');
  check(small.includes('fill="#F4EEE3"') && !small.includes('var(') && (await (await fetch(BASE + '/')).text()).includes('<link rel="icon" href="brand/icon-small.svg">'), 'the OS icons (and the browser tab\'s) stay the brand\'s cream ones');
  check(fs.readFileSync(ui + 'brand/icon-in.svg', 'utf8').length < 7000, 'the in-app drawing is small');
}

await browser.close();
check(!errors.length, 'no script errors', errors.join(' | '));
if (failures()) { console.log(`FAILED ${failures()}`); process.exit(1); }

// Build 38 (the maintainer's notes of Nov 7): a page's end without a line; the ⋯ menu closing from
// its own button and a tap beside it doing nothing else; the calendar's four buttons on one line; the
// phone's search box keeping its size when the keyboard comes; pages named under a page's alias in
// its "Pages in …" (two at one place both listed) and in "Check this folder"; closing fades and the
// Animations switch; YouTube videos written as Logseq writes them.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { open, check, failures, sleep, go, write, read, BASE, VAULT, SHOTS } from './lib.mjs';

// an aliased page with pages named under both of its names (one place taken twice)
write('pages/thnki.md', 'Alias:: thinky\n\n- my app\n');
write('pages/thinky___build ideas.md', '- new ideas\n');
write('pages/thnki___Build Ideas.md', '- old ideas\n');
write('pages/thinky___roadmap.md', '- plans\n');
write('pages/thinky___roadmap___2027.md', '- next year\n');
// YouTube videos, as Logseq writes them, and things that only look like them
const ID = 'dQw4w9WgXcQ';
write('pages/Videos.md', [
  `- watch {{video https://www.youtube.com/watch?v=${ID}}}`,
  `- short {{video https://youtu.be/${ID}?t=1m30s}}`,
  `- shorts {{video https://youtube.com/shorts/${ID}}}`,
  `- start {{youtube https://www.youtube.com/watch?v=${ID}&t=95}}`,
  `- mobile {{video https://m.youtube.com/watch?v=${ID}&start=2h}}`,
  '- not youtube {{video https://vimeo.com/123456}}',
  '- bad id {{video https://www.youtube.com/watch?v=short}}',
  '- a script {{video javascript:alert(1)}}',
  '- a lookalike {{video https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ}}',
  '- other macro {{query (todo now)}}',
  '',
].join('\n'));

// no network in tests: YouTube's picture and player are stood in for
async function stubYouTube(ctx) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await ctx.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: png }));
  await ctx.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title><p>player</p>' }));
}

let { browser, page, errors } = await open({ look: 'thinky' });
await stubYouTube(page.context());
if (process.env.SLOW) { const c = await page.context().newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: +process.env.SLOW }); }

// -------------------------------------------------------------------------------------------------
console.log('a page’s end: no line, room under the "+"');
const endOf = () => page.evaluate(() => {
  const s = document.querySelector('.sheet.page'), plus = s.querySelector('.add-end');
  const next = [...document.querySelectorAll('.view .sec-h, .view h2')].find((h) => h.getBoundingClientRect().top > s.getBoundingClientRect().top + 40);
  return { line: getComputedStyle(s).borderBottomStyle === 'none' || parseFloat(getComputedStyle(s).borderBottomWidth) === 0, plus: plus?.getBoundingClientRect().bottom, next: next?.getBoundingClientRect().top };
});
await go(page, '#/page/' + encodeURIComponent('Pickles in brine'));
await sleep(500);
let e1 = await endOf();
check(e1.line, 'no line under a page’s notes (thinky look)', JSON.stringify(e1));
check(e1.next - e1.plus >= 30 && e1.next - e1.plus <= 90, 'room between the "+" and what comes next, not a gap', JSON.stringify(e1));
for (const look of ['plain', 'calmplain', 'plainnight', 'plainteal']) {
  await page.evaluate((l) => { localStorage.setItem('skin', JSON.stringify(l)); document.documentElement.dataset.skin = l; }, look);
  await sleep(100);
  const e = await endOf();
  check(e.line, `no line in ${look} either (a look without cards)`, JSON.stringify(e));
}
for (const look of ['calm', 'paper', 'sticker', 'night']) { // cards keep their whole edge
  await page.evaluate((l) => { localStorage.setItem('skin', JSON.stringify(l)); document.documentElement.dataset.skin = l; }, look);
  await sleep(100);
  const b = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.sheet.page')); return [c.borderBottomWidth, c.borderTopWidth, c.borderBottomStyle]; });
  check(b[0] === b[1], `${look}: the card’s bottom edge as its top`, JSON.stringify(b));
}
await page.evaluate(() => { localStorage.setItem('skin', JSON.stringify('plain')); document.documentElement.dataset.skin = 'plain'; });
await go(page, '#/journals');
await sleep(500);
const dayLine = await page.evaluate(() => { const d = document.querySelector('.sheet.day'); return d ? getComputedStyle(d).borderBottomStyle : 'none'; });
check(dayLine !== 'none', 'the line between days in the Journals list stays (Plain)', dayLine);
await page.evaluate(() => { localStorage.setItem('skin', JSON.stringify('thinky')); document.documentElement.dataset.skin = 'thinky'; });

// -------------------------------------------------------------------------------------------------
console.log('"Pages in …": pages named under the page’s alias too');
await go(page, '#/page/thnki');
await sleep(700);
const sec = page.locator('section.sec', { hasText: 'Pages in thnki' });
check(await sec.count() === 1, 'the page has "Pages in thnki"');
const rows = await sec.locator('.tree li').evaluateAll((ls) => ls.map((l) => [l.textContent.trim(), +getComputedStyle(l).getPropertyValue('--d'), l.querySelector('a')?.dataset.page || '']));
const texts = rows.map((r) => r[0]);
check(texts.includes('thinky/build ideas') && texts.includes('thnki/Build Ideas'), 'two pages at one place: both listed, each by its whole name', JSON.stringify(rows));
check(texts.includes('roadmap') && texts.includes('2027'), 'the alias’s other pages by their short names, a level down under their parent', JSON.stringify(rows));
const deep = rows.find((r) => r[0] === '2027'), road = rows.find((r) => r[0] === 'roadmap');
check(deep && road && deep[1] === road[1] + 1 && texts.indexOf('2027') === texts.indexOf('roadmap') + 1, '"thinky/roadmap/2027" under "roadmap"', JSON.stringify(rows));
check(/\b4\b/.test(await sec.locator('.sec-t .n').textContent()), 'the count: every page listed', await sec.locator('.sec-t').textContent());
await sec.locator('.tree a', { hasText: 'thinky/build ideas' }).click();
await sleep(500);
check(decodeURIComponent(await page.evaluate(() => location.hash)).toLowerCase().includes('thinky/build ideas'), 'its link opens that page', await page.evaluate(() => location.hash));
await go(page, '#/page/thinky');
await sleep(600);
check(await page.locator('section.sec', { hasText: /Pages in/ }).count() === 1, 'opened by the alias, the same list shows');
// a page without an alias: as before
await go(page, '#/page/APRON');
await sleep(500);
check(await page.locator('section.sec', { hasText: 'Pages in APRON' }).locator('.tree li').count() >= 1, 'a page without an alias lists its own as before');

console.log('Check this folder: the pair is listed');
await go(page, '#/settings/notes');
await sleep(400);
await page.locator('[data-a="check"]').click();
await page.waitForSelector('.check-out p', { timeout: 15000 });
await sleep(300);
const out = await page.locator('.check-out').textContent();
check(/pair of pages sits at the same place under a page and its alias/.test(out) && /thnki: .*thinky\/build ideas.* and .*Build Ideas|thnki: .*Build Ideas.* and .*thinky\/build ideas/.test(out), 'listed with both names', out.slice(0, 600));
check(!/roadmap/.test(out.match(/alias[\s\S]{0,300}/)?.[0] || ''), 'pages that don’t meet aren’t listed');

// -------------------------------------------------------------------------------------------------
console.log('YouTube videos: the picture, the player on a click');
await go(page, '#/page/Videos');
await sleep(800);
const vids = await page.locator('.outline .yt').evaluateAll((v) => v.map((x) => [x.dataset.yt, x.dataset.start, x.querySelector('img')?.getAttribute('src'), x.querySelector('img')?.getAttribute('referrerpolicy')]));
check(vids.length === 5, 'the five YouTube addresses (watch, youtu.be, shorts, {{youtube}}, m.) show as videos', JSON.stringify(vids));
check(vids.every((v) => v[0] === ID && v[2] === `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` && v[3] === 'no-referrer'), 'each by its id, its picture from YouTube’s picture server, no referrer sent', JSON.stringify(vids));
check(JSON.stringify(vids.map((v) => +v[1])) === JSON.stringify([0, 90, 0, 95, 7200]), 'start times: t=1m30s, t=95, start=2h', JSON.stringify(vids.map((v) => v[1])));
const macros = await page.locator('.outline .macro:not(.bref)').allTextContents();
check(['vimeo', 'short}}', 'javascript:', 'evil.example', 'query'].every((w) => macros.some((m) => m.includes(w))), 'anything else stays as written: another site, a bad id, a script, a lookalike address, other macros', JSON.stringify(macros));
check(await page.locator('.outline iframe').count() === 0, 'no player is loaded before a click');
await page.screenshot({ path: SHOTS + '/b38-videos.png' });
const first = page.locator('.outline .yt').first();
const box0 = await first.boundingBox();
check(box0 && Math.abs(box0.width / box0.height - 16 / 9) < 0.05 && box0.width <= 481, '16:9, at most 480px wide', JSON.stringify(box0));
await first.locator('.yt-play').click();
await sleep(500);
const fr = await page.locator('.outline .yt iframe').evaluateAll((f) => f.map((x) => ({ src: x.src, sandbox: x.getAttribute('sandbox'), allow: x.allow })));
check(fr.length === 1 && fr[0].src === `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0`, 'a click: YouTube’s no-cookie player there, playing', JSON.stringify(fr));
check(fr[0] && !/allow-popups|allow-top-navigation/.test(fr[0].sandbox), 'the player can’t open windows or move the app’s page', fr[0]?.sandbox);
check(await page.locator('textarea.ed').count() === 0, 'the click didn’t start editing the note');
const frameUrl = await page.frames().find((f) => f.url().includes('youtube-nocookie'))?.url();
check(!!frameUrl, 'the player loaded (the app’s CSP lets this one address in)', String(frameUrl));
await page.locator('.outline .yt').nth(3).click();
await sleep(400);
check((await page.locator('.outline .yt iframe').nth(1).getAttribute('src')).endsWith('&start=95'), 'a start time is passed on');
// editing shows the words as written; leaving shows the picture again
await page.locator('.outline .blk > .bc', { hasText: /^start/ }).click({ position: { x: 6, y: 10 } });
await page.waitForSelector('textarea.ed');
await sleep(200);
const ta = await page.locator('textarea.ed').inputValue();
check(/^start \{\{youtube https:\/\/www\.youtube\.com\/watch\?v=/.test(ta), 'editing a video’s note shows it as written', ta);
await page.keyboard.press('Escape');
await sleep(300);
check(read('pages/Videos.md').includes(`{{video https://youtu.be/${ID}?t=1m30s}}`), 'the file is unchanged');
// only YouTube's player can be framed
const blocked = await page.evaluate(() => new Promise((res) => {
  const f = document.createElement('iframe');
  let v = null;
  document.addEventListener('securitypolicyviolation', (e) => { if (e.blockedURI.includes('example.com')) v = e.violatedDirective; }, { once: true });
  f.src = 'https://example.com/'; document.body.append(f);
  setTimeout(() => { f.remove(); res(v); }, 800);
}));
check(blocked === 'frame-src', 'any other site in a frame is refused (CSP frame-src)', String(blocked));
errors.splice(0, errors.length, ...errors.filter((e) => !e.includes('example.com'))); // (that refusal was the point)

// -------------------------------------------------------------------------------------------------
console.log('closing fades, and the Animations switch');
await go(page, '#/page/' + encodeURIComponent('Pickles in brine'));
await sleep(500);
const fadeHosts = () => page.evaluate(() => document.querySelectorAll('.fade-host').length);
await page.locator('.title-row [data-a="more"]').click();
await page.waitForSelector('.pop.menu');
await page.keyboard.press('Escape');
check(await page.locator('.pop.menu').count() === 0, 'Esc at once after the click: the menu itself is gone at once');
check(await fadeHosts() === 1, 'a copy fades away on its own');
const copy = await page.evaluate(() => { const h = document.querySelector('.fade-host'); return { inert: h.inert, hidden: h.getAttribute('aria-hidden'), pe: getComputedStyle(h).pointerEvents, shadow: h.shadowRoot === null }; });
check(copy.inert && copy.hidden === 'true' && copy.pe === 'none' && copy.shadow, 'the copy takes no clicks, isn’t read out, and can’t be found (closed shadow root)', JSON.stringify(copy));
await page.locator('.title-row [data-a="more"]').click(); // reopened while the copy still fades
await page.waitForSelector('.pop.menu', { timeout: 3000 }).catch(() => {});
const reo = await page.evaluate(() => ({ menus: document.querySelectorAll('.pop.menu').length, hosts: document.querySelectorAll('.fade-host').length, active: document.activeElement?.outerHTML.slice(0, 80), more: document.querySelectorAll('.title-row [data-a="more"]').length }));
check(reo.menus === 1, 'reopened at once: one menu (the fading copy isn’t one)', JSON.stringify(reo));
await sleep(100);
await page.keyboard.press('Escape');
await sleep(500);
check(await fadeHosts() === 0, 'gone within half a second');
// search fades too
await page.keyboard.press('Control+k');
await page.waitForSelector('#search:not([hidden])');
await page.keyboard.press('Escape');
check(await fadeHosts() === 1 && await page.evaluate(() => document.getElementById('search').hidden), 'search: hidden at once, its copy fading');
await sleep(500);
// the switch
await go(page, '#/settings/look');
await sleep(300);
const sw = page.locator('.motion-row input');
check(await sw.count() === 1 && await sw.isChecked(), 'Settings → Look: Animations, on by default');
await sw.uncheck();
check(await page.evaluate(() => document.documentElement.dataset.motion) === 'off', 'off: the whole app at once');
await go(page, '#/page/' + encodeURIComponent('Pickles in brine'));
await sleep(400);
await page.locator('.title-row [data-a="more"]').click();
await page.waitForSelector('.pop.menu');
const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.pop.menu')).animationDuration);
await page.keyboard.press('Escape');
check(await fadeHosts() === 0, 'off: nothing fades as it closes');
check(parseFloat(anim) < 0.01, 'off: nothing fades as it opens either', anim);
await page.reload();
await page.waitForSelector('.sheet .outline');
check(await page.evaluate(() => document.documentElement.dataset.motion) === 'off', 'remembered: off from the first paint after a reload');
await go(page, '#/settings/look');
await sleep(300);
await page.locator('.motion-row input').check();
check(await page.evaluate(() => document.documentElement.dataset.motion) === undefined, 'on again');
check(errors.length === 0, 'no script errors', errors.join('\n'));
await browser.close();

// reduced motion asked for by the system: no copies
browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
  await p.goto(BASE + '/?t=' + Date.now() + '#/page/' + encodeURIComponent('Pickles in brine'));
  await p.waitForSelector('.sheet .outline');
  await p.locator('.title-row [data-a="more"]').click();
  await p.waitForSelector('.pop.menu');
  await p.keyboard.press('Escape');
  check(await p.evaluate(() => document.querySelectorAll('.fade-host').length) === 0, 'with less motion asked for: nothing fades');
}
await browser.close();

// -------------------------------------------------------------------------------------------------
console.log('phone: the ⋯ menu, the calendar, the search box');
({ browser, page, errors } = await open({ look: 'thinky', viewport: { width: 390, height: 844 }, touch: true }));
await go(page, '#/page/' + encodeURIComponent('Pickles in brine'));
await sleep(600);
const more = page.locator('.title-row [data-a="more"]');
await more.tap();
await sleep(300);
check(await page.locator('.pop.menu').count() === 1, 'a tap on ⋯ opens its menu');
{ const b = await more.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); } // (where it is: since Build 41 the menu's copy of it lies over it)
await sleep(400);
check(await page.locator('.pop.menu').count() === 0, 'a second tap on ⋯ closes it (it doesn’t open again)');
await more.tap();
await sleep(300);
const before = await page.evaluate(() => location.hash);
// (a link the menu doesn't cover: since Build 48 the menu is a row longer)
const outside = await page.evaluate(() => {
  const m = document.querySelector('.pop.menu').getBoundingClientRect();
  const a = [...document.querySelectorAll('#main a.pl, #main a[data-page]')].find((x) => { const r = x.getBoundingClientRect(); const off = r.bottom < m.top - 4 || r.top > m.bottom + 4 || r.right < m.left - 4 || r.left > m.right + 4; return r.height && off && r.top > 50 && r.bottom < innerHeight; });
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return { x: r.left + Math.min(r.width / 2, 20), y: r.top + r.height / 2, name: a.dataset.page };
});
await page.touchscreen.tap(outside.x, outside.y);
await sleep(600);
check(await page.locator('.pop.menu').count() === 0 && await page.evaluate(() => location.hash) === before, 'with the menu open, a tap on a link only closes the menu', await page.evaluate(() => location.hash));
await page.touchscreen.tap(outside.x, outside.y);
await sleep(600);
check(decodeURIComponent(await page.evaluate(() => location.hash)).includes(outside.name), 'the next tap on it opens it');
await more.tap();
await sleep(300);
await page.locator('.pop.menu button', { hasText: 'Find on this page' }).tap();
await sleep(400);
check(await page.locator('.pop.menu').count() === 0, 'picking an item still works');
await page.keyboard.press('Escape');

// the calendar: Esc right as it opens, then its button opens it again (no press is eaten)
await go(page, '#/journals');
await sleep(600);
await page.locator('#topbar button[aria-label*="date" i]').first().tap();
await page.waitForSelector('.datepick');
await page.keyboard.press('Escape');
await sleep(100);
await page.locator('#topbar button[aria-label*="date" i]').first().tap();
await page.waitForSelector('.datepick', { timeout: 3000 }).catch(() => {});
check(await page.locator('.datepick').count() === 1, 'the calendar opens again after an Esc at once');
await page.keyboard.press('Escape');
await sleep(300);
// the calendar: four buttons, one line, inside the box
await go(page, '#/journals');
await sleep(600);
await page.locator('#topbar button[aria-label*="date" i]').first().tap();
await page.waitForSelector('.datepick');
const q = await page.evaluate(() => {
  const box = document.querySelector('.datepick').getBoundingClientRect();
  const bs = [...document.querySelectorAll('.datepick .quick button')].map((b) => b.getBoundingClientRect());
  return { n: bs.length, tops: new Set(bs.map((b) => Math.round(b.top))).size, inside: bs.every((b) => b.left >= box.left && b.right <= box.right), clipped: [...document.querySelectorAll('.datepick .quick button')].some((b) => b.scrollWidth > b.clientWidth + 1), h: Math.min(...bs.map((b) => b.height)) };
});
check(q.n === 4 && q.tops === 1, 'Today, Tomorrow, Next Monday, In a week: one line', JSON.stringify(q));
check(q.inside && !q.clipped, 'all inside the box, none cut off', JSON.stringify(q));
await page.locator('.datepick .quick button', { hasText: 'In a week' }).tap();
await sleep(600);
const wk = new Date(); wk.setDate(wk.getDate() + 7);
check(await page.evaluate(() => location.hash).then((h) => h !== '#/journals'), 'a quick button still goes to its day', await page.evaluate(() => location.hash));
await go(page, '#/journals');
await sleep(400);

// the search box: one size, before and after the keyboard (the window gets shorter)
await page.locator('#topbar [data-a="search"]').tap();
await page.waitForSelector('#search:not([hidden])');
await page.keyboard.type('a', { delay: 20 });
await sleep(600);
const r1 = await page.locator('.search-box').boundingBox();
await page.setViewportSize({ width: 390, height: 470 }); // a phone keyboard takes about 45% of the screen
await sleep(500);
const r2 = await page.locator('.search-box').boundingBox();
check(Math.abs(r1.height - r2.height) <= 1 && Math.abs(r1.y - r2.y) <= 1, 'the keyboard coming up doesn’t move or shrink it', JSON.stringify({ r1, r2 }));
check(r2.y + r2.height <= 470, 'it stays whole above the keyboard', JSON.stringify(r2));
check(r1.height <= 844 * 0.4, 'small from the start', JSON.stringify(r1));
await page.keyboard.press('Escape');
await sleep(300);
await page.setViewportSize({ width: 390, height: 844 });
await sleep(400);
// opened while typing in a note (the keyboard came up for the note): the same size as from the page
await page.locator('.outline .blk > .bc', { hasText: /^Meeting notes/ }).first().tap({ position: { x: 40, y: 10 } });
await page.waitForSelector('textarea.ed');
await page.setViewportSize({ width: 390, height: 470 }); // (the keyboard comes up as the note is focused)
await sleep(400);
await page.evaluate(() => document.querySelector('#topbar [data-a="search"]').click());
await page.waitForSelector('#search:not([hidden])');
await page.keyboard.type('a', { delay: 20 });
await sleep(600);
const r3 = await page.locator('.search-box').boundingBox();
check(Math.abs(r3.height - r1.height) <= 1, 'opened with the keyboard already up: the same size', JSON.stringify({ r1, r3 }));
await page.keyboard.press('Escape');
await page.screenshot({ path: SHOTS + '/b38-phone.png' });
check(errors.length === 0, 'no script errors', errors.join('\n'));
await browser.close();

// -------------------------------------------------------------------------------------------------
console.log('laptop: a click beside the menu only closes it (mouse)');
({ browser, page, errors } = await open({ look: 'thinky' }));
await go(page, '#/page/' + encodeURIComponent('Pickles in brine'));
await sleep(500);
await page.locator('.title-row [data-a="more"]').click();
await page.waitForSelector('.pop.menu');
{ const b = await page.locator('.title-row [data-a="more"]').boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); } // (where it is: the menu's copy of it lies over it)
await sleep(300);
check(await page.locator('.pop.menu').count() === 0, 'a second click on ⋯ closes it');
await page.locator('.title-row [data-a="more"]').click();
await page.waitForSelector('.pop.menu');
const h0 = await page.evaluate(() => location.hash);
await page.locator('.outline a', { hasText: 'Rosa Penhallow' }).first().click();
await sleep(600);
check(await page.locator('.pop.menu').count() === 0 && await page.evaluate(() => location.hash) === h0, 'with a mouse too, a click on a link beside the menu only closes it (Build 39: as every pop-up does)');
check(errors.length === 0, 'no script errors', errors.join('\n'));
await browser.close();

process.exit(failures() ? 1 : 0);

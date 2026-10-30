// The name and logo (Build 32, Oct 29 2026: "Lean Outliner" became thinky). The window's title; no
// "Lean Outliner" on the screens people see (welcome, journals, every Settings tab, About; also in
// tooltips and labels); the logo pictures load (ui/brand/, the icon at the size it's drawn for); the
// welcome screen has the big icon on top and the name, drawn as the wordmark, in its title; the name's letters take the look's
// ink (readable in night looks), its spark and [[ ]] stay red; the brand files stay small; the phone's
// menu shows the icon with the name beside it; About: "About" + the wordmark (no [[thinky]], he said).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { check, failures, sleep, open, go, BASE, SHOTS } from './lib.mjs';

const UI = new URL('../../ui/', import.meta.url).pathname;
const OLD = /Lean\s*Outliner/i;

console.log('the brand files');
for (const f of ['icon.svg', 'icon-mid.svg', 'icon-small.svg', 'wordmark.svg']) {
  const t = fs.readFileSync(UI + 'brand/' + f, 'utf8');
  check(t.length < 9000, `${f} is small (${t.length} bytes)`);
  if (f.startsWith('icon')) check(t.includes('#F4EEE3') && t.includes('#1D1A2E') && t.includes('#FF4B2B'), `${f}: cream tile, ink, red spark`);
  else check(t.includes('<symbol id="m"') && t.includes('fill="currentColor"') && t.includes('fill="#FF4B2B"') && !/<text|font-family/.test(t), `${f}: outlines (no font), letters in the look's ink, red spark`);
}

/** Everything a person can see or hear of the page: its words, tooltips, labels, the title. */
const seen = (page) => page.evaluate(() => {
  const attrs = [...document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')]
    .map((e) => ['title', 'aria-label', 'placeholder', 'alt'].map((a) => e.getAttribute(a) || '').join(' '));
  return [document.title, document.body.innerText, ...attrs].join('\n');
});
const pictures = (page) => page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 300));
  // (the icon is drawn inline in the look's colours since Build 32: <svg class="logo"><use href="brand/icon-in.svg#s|m">)
  const imgs = [...document.querySelectorAll('svg.logo')].filter((i) => i.getClientRects().length);
  const marks = [...document.querySelectorAll('svg.wordmark, svg.wm-in')].filter((s) => s.getClientRects().length);
  return {
    imgs: imgs.map((i) => ({ src: i.querySelector('use').getAttribute('href'), ok: i.querySelector('use').getBBox().width > 0, w: i.getBoundingClientRect().width })),
    marks: marks.map((s) => ({ href: s.querySelector('use').getAttribute('href'), w: s.querySelector('use').getBBox().width })),
  };
});
const allLoaded = (p) => p.imgs.every((i) => i.ok) && p.marks.every((m) => m.w > 0);

// --------------------------------------------------------------------------------------------
console.log('laptop: the welcome screen (no notes folder yet), Calm and Plain night');
const browser = await chromium.launch();
const errors = [];
for (const look of ['calm', 'plainnight']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
  await page.goto(BASE + '/');
  await page.evaluate((l) => { localStorage.clear(); localStorage.setItem('skin', JSON.stringify(l)); }, look);
  await page.goto(BASE + '/?t=' + Date.now());
  await page.waitForSelector('.welcome .wl-logo');
  await sleep(600);
  check(await page.title() === 'thinky', `${look}: the window's title is thinky`, await page.title());
  const text = await seen(page);
  check(!OLD.test(text), `${look}: no "Lean Outliner" on the welcome screen`, text.match(OLD)?.[0]);
  check(await page.evaluate(() => { const h = document.querySelector('.welcome h1'); return h.textContent.trim() === 'Welcome to' && h.querySelector('svg.wm-in')?.getAttribute('aria-label') === 'thinky'; }), `${look}: "Welcome to" + the name drawn as the wordmark (never plain words: he asked)`);
  const pics = await pictures(page);
  check(pics.imgs.length >= 1 && pics.marks.length === 1 && allLoaded(pics), `${look}: the icon and the name are drawn`, JSON.stringify(pics));
  check(pics.imgs[0]?.src === 'brand/icon-in.svg#m', `${look}: the big icon uses the drawing meant for that size`, pics.imgs[0]?.src);
  const lay = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const i = r(document.querySelector('.wl-logo .logo')), w = r(document.querySelector('.welcome h1 .wm-in'));
    return { iBottom: i.bottom, wTop: w.top, iw: i.width, wh: w.height };
  });
  check(lay.wTop >= lay.iBottom - 0.5 && lay.iw >= 100, `${look}: the big icon on top, the name in the title under it`, JSON.stringify(lay));
  const ink = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const rgb = (c) => { const x = document.createElement('i'); x.style.color = c; document.body.append(x); const v = getComputedStyle(x).color; x.remove(); return v.match(/\d+/g).slice(0, 3).map(Number); };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fg = rgb(getComputedStyle(document.querySelector('.welcome h1 .wm-in')).color), bg = rgb(getComputedStyle(document.body).backgroundColor);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { fg, ink: rgb(css.getPropertyValue('--ink')), contrast: (a + 0.05) / (b + 0.05) };
  });
  check(ink.fg.join() === ink.ink.join() && ink.contrast > 7, `${look}: the name's letters take the look's ink, easy to read (contrast ${ink.contrast.toFixed(1)})`, JSON.stringify(ink));
  check(await page.evaluate(() => document.querySelector('link[rel="icon"]').getAttribute('href')) === 'brand/icon-small.svg', `${look}: the tab's icon`);
  await page.screenshot({ path: `${SHOTS}/brand-welcome-${look}.png` });
  await ctx.close();
}
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('laptop with notes: the strip, Settings, About');
{
  const { browser, page, errors: e2 } = await open({ viewport: { width: 1280, height: 860 } });
  check(await page.title() === 'thinky', 'the title with a notes folder too');
  const strip = await pictures(page);
  check(strip.imgs.some((i) => i.src === 'brand/icon-in.svg#s' && i.w === 20) && allLoaded(strip), 'the strip starts with the small icon (20px)', JSON.stringify(strip));
  check(await page.locator('#histbar .hb-logo').getAttribute('title') === 'thinky', 'its tooltip says thinky');
  let all = await seen(page);
  for (const tab of ['notes', 'look', 'capture', 'shortcuts', 'about']) {
    await go(page, '#/settings/' + tab);
    await sleep(500);
    all += '\n' + await seen(page);
  }
  const hit = all.split('\n').find((l) => OLD.test(l));
  check(!hit, 'no "Lean Outliner" in Journals or any Settings tab', hit);
  const about = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent.trim() === 'About');
    const s = card?.querySelector('h2 svg.wm-in');
    const b = card && s ? [card.querySelector('h2').getBoundingClientRect(), s.getBoundingClientRect()] : null;
    return { label: s?.getAttribute('aria-label'), w: s?.querySelector('use').getBBox().width || 0, oneLine: b ? b[1].top >= b[0].top - 2 && b[1].bottom <= b[0].bottom + 8 : false,
      inNote: !!card?.querySelector('.note svg.wm-in'), brackets: !!document.querySelector('.wordmark-link') };
  });
  check(about.label === 'thinky' && about.w > 0 && about.oneLine && about.inNote && !about.brackets, 'About: "About" + the wordmark on one line, the wordmark in its note too, no [[thinky]]', JSON.stringify(about));
  check(e2.length === 0, 'no page errors (CSP included)', e2.join('\n'));
  await browser.close();
}

// --------------------------------------------------------------------------------------------
console.log('phone: the menu shows the icon with the name beside it (a row has room: he asked)');
{
  const { browser, page, errors: e3 } = await open({ viewport: { width: 390, height: 844 }, touch: true });
  await page.click('#topbar [data-a="menu"]');
  await sleep(600);
  const m = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const i = r(document.querySelector('.brand-mark .logo')), w = r(document.querySelector('.brand-mark .wordmark'));
    return { iRight: i.right, wLeft: w.left, iMid: i.top + i.height / 2, wMid: w.top + w.height / 2, label: document.querySelector('.brand-mark').getAttribute('aria-label') };
  });
  check(m.wLeft >= m.iRight - 0.5 && Math.abs(m.iMid - m.wMid) < 4 && m.label === 'thinky', 'the menu: the name beside the icon, level with it', JSON.stringify(m));
  const pics = await pictures(page);
  check(allLoaded(pics), 'its pictures load', JSON.stringify(pics));
  check(!OLD.test(await seen(page)), 'no "Lean Outliner" on the phone');
  await page.screenshot({ path: `${SHOTS}/brand-phone-menu.png` });
  check(e3.length === 0, 'no page errors (CSP included)', e3.join('\n'));
  await browser.close();
}

check(errors.length === 0, 'no page errors on the welcome screens (CSP included)', errors.join('\n'));
process.exit(failures() ? 1 : 0);

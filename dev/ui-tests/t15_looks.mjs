// Looks and the Logseq feel (Build 29): Calm plain on white, done to-dos struck clearly, no
// coloured "today" in any look, Plain = Logseq's look (colours, font, spacing, dots, hairline),
// Plain night = Logseq's dark one, tighter spacing elsewhere (Paper keeps its own), dots that grow on
// hover, the hand on everything clickable, properties in a pale box one per line, Settings → Look →
// Page links (underlined / colour only / [[ ]]), sidebar pages stepped in from their headings.
import { open, check, failures, sleep, write, SHOTS, BASE } from './lib.mjs';

write('pages/Look test.md', '- [[Marta Pell]] wrote [the book]([[Notes on Wild Yeast]]) #reading\n'
  + '- DONE ## a finished heading\n- DONE a done note with [[Rosa Penhallow]]\n  status:: closed\n'
  + '- a note with properties\n  type:: book\n  author:: [[Marta Pell]]\n\t- its child\n');

const LOOKS = ['plain', 'plainnight', 'calm', 'calmplain', 'night', 'paper', 'sticker', 'stickernight', 'grimoire', 'automaton', 'azulejo'];
const { browser, page, errors } = await open();
const look = async (id, hash = '#/journals') => {
  await page.evaluate((l) => localStorage.setItem('skin', JSON.stringify(l)), id);
  await page.goto(BASE + '/?t=' + Date.now() + hash);
  await page.waitForSelector(hash.startsWith('#/settings') ? '.lk-opts' : '.sheet .outline');
  await sleep(500);
};
// colours as [r, g, b, a]; contrast as WCAG counts it, a see-through colour seen over the background
const css = (sel, prop, pseudo) => page.evaluate(([s, p, ps]) => { const e = document.querySelector(s); return e ? getComputedStyle(e, ps || null)[p] : null; }, [sel, prop, pseudo]);
const rgba = (c) => { // rgb()/rgba(), or color(srgb r g b / a) with 0–1 values (what color-mix() gives)
  const m = String(c).match(/[\d.]+/g)?.map(Number) || [];
  return String(c).startsWith('color(') ? [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1] : [m[0], m[1], m[2], m[3] ?? 1];
};
const over = (fg, bg) => fg.slice(0, 3).map((v, k) => v * fg[3] + bg[k] * (1 - fg[3]));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---- every look: today like the other days; done notes struck in their own colour, clearly ----
for (const id of LOOKS) {
  await look(id);
  const days = await page.evaluate(() => [...document.querySelectorAll('.sheet.day')].slice(0, 3).map((s) => [s.classList.contains('today'), getComputedStyle(s).backgroundColor]));
  const today = days.find(([t]) => t), other = days.find(([t]) => !t);
  check(today && other && today[1] === other[1], `${id}: today's journal is the same colour as the other days`, JSON.stringify(days));
  const done = await page.evaluate(() => {
    const bc = document.querySelector('.sheet.today .blk.marker-done > .bc');
    const cs = getComputedStyle(bc);
    let bg = getComputedStyle(bc.closest('.sheet')).backgroundColor;
    if (/rgba\(0, 0, 0, 0\)/.test(bg)) bg = getComputedStyle(document.body).backgroundColor;
    return { line: cs.textDecorationLine, color: cs.color, deco: cs.textDecorationColor, bg };
  });
  const seen = over(rgba(done.deco), rgba(done.bg));
  check(done.line.includes('line-through') && done.deco === done.color, `${id}: a done to-do is struck through in its words' own colour`, JSON.stringify(done));
  check(contrast(seen, rgba(done.bg)) >= 2.2, `${id}: the line through it is clear (contrast ${contrast(seen, rgba(done.bg)).toFixed(1)})`, JSON.stringify(done));
}

// ---- Calm plain: a white page, the white of Calm's cards ----
await look('calm');
const calmCard = await css('.sheet.day', 'backgroundColor');
await look('calmplain');
check(await css('body', 'backgroundColor') === calmCard && calmCard === 'rgb(255, 255, 255)', 'Calm plain: the page is white, like a Calm card', calmCard);
check(await css('.sheet.day', 'backgroundColor') === 'rgb(255, 255, 255)', 'Calm plain: the days sit on it with no card of their own');

// ---- Plain = Logseq's look ----
await look('plain');
const m = await page.evaluate(() => {
  const one = [...document.querySelectorAll('.sheet.today .blk')].find((b) => b.textContent.includes('cold-prov'));
  const bc = one.querySelector('.bc'), cs = getComputedStyle(bc);
  const kid = one, parent = one.previousElementSibling;
  const a = document.querySelector('.sheet.today .bc a.pl');
  return {
    bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, font: getComputedStyle(document.body).fontFamily,
    size: cs.fontSize, lh: cs.lineHeight, h: one.getBoundingClientRect().height,
    step: kid.querySelector('.bul').getBoundingClientRect().left - parent.querySelector('.bul').getBoundingClientRect().left,
    link: getComputedStyle(a).color, under: getComputedStyle(a).borderBottomWidth,
    dot: getComputedStyle(one.querySelector('.bul'), '::after').width,
    hair: getComputedStyle(document.querySelector('.sheet.day')).borderBottom,
    title: getComputedStyle(document.querySelector('.day-head .page-title')).fontWeight,
  };
});
check(m.bg === 'rgb(252, 252, 252)' && m.ink === 'rgb(23, 23, 23)', 'Plain: Logseq’s off-white page and near-black words', JSON.stringify(m));
check(/^Inter, .*Segoe UI/.test(m.font), 'Plain: Inter first, then Windows’ Segoe UI (nothing bundled)', m.font);
check(m.size === '16px' && m.lh === '24px' && Math.abs(m.h - 28) < 0.6, 'Plain: Logseq’s spacing (16px words, 24px lines, a one-line note 28px)', JSON.stringify(m));
check(Math.abs(m.step - 29) < 0.6, 'Plain: each level steps in 29px, as in Logseq', m.step);
check(m.link === 'rgb(27, 104, 152)' && m.under === '0px', 'Plain: links in Logseq’s muted blue, not underlined', JSON.stringify(m));
check(m.dot === '6px' && m.hair.includes('rgb(219, 219, 219)') && m.title === '500', 'Plain: small dots, a thin grey line between days, a regular-weight date', JSON.stringify(m));
await page.screenshot({ path: SHOTS + '/t15-plain.png' });
await look('plainnight');
check(await css('body', 'backgroundColor') === 'rgb(0, 43, 54)' && await css('.sheet.today .bc a.pl', 'color') === 'rgb(155, 211, 212)', 'Plain night: Logseq’s dark look (deep blue-green, pale teal links)');
await page.screenshot({ path: SHOTS + '/t15-plainnight.png' });

// ---- spacing: other looks tighter than before (34.8px), Paper keeps its rhythm ----
const noteH = () => page.evaluate(() => [...document.querySelectorAll('.sheet.today .blk')].find((b) => b.textContent.includes('cold-prov')).getBoundingClientRect().height);
await look('calm');
check(await noteH() < 30, 'Calm: notes closer together (a one-line note under 30px)', await noteH());
await look('paper');
check(Math.abs(await noteH() - 34) < 1, 'Paper keeps its own rhythm', await noteH());

// ---- dots on hover (laptop): a soft round patch, the dot a little bigger; no motion if asked ----
await look('plain');
const bul = page.locator('.sheet.today .outline .blk > .bul').first();
const dotNow = () => bul.evaluate((b) => [getComputedStyle(b, '::before').content, getComputedStyle(b, '::before').width, getComputedStyle(b, '::after').transform, getComputedStyle(b, '::after').transitionDuration]);
const rest = await dotNow();
await bul.hover();
await sleep(300);
const hov = await dotNow();
check(rest[0] === 'none' && hov[0] === '""' && hov[1] === '16px' && /^matrix\(1\.2, 0, 0, 1\.2/.test(hov[2]) && hov[3] === '0.2s', 'a dot under the mouse grows on a soft round patch', JSON.stringify([rest, hov]));
await page.mouse.move(5, 500);
await page.emulateMedia({ reducedMotion: 'reduce' });
await bul.hover();
await sleep(100);
const still = await dotNow();
check(still[0] === '""' && still[3] === '0s' && await bul.evaluate((b) => getComputedStyle(b, '::before').animationName) === 'none', 'with less motion asked for: the same, without animating', JSON.stringify(still));
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ---- the hand on everything clickable; the text cursor where a click edits ----
const cursors = async (list) => page.evaluate((l) => l.map((s) => { const e = document.querySelector(s); return [s, e ? getComputedStyle(e).cursor : 'missing']; }), list);
await page.keyboard.press('Control+t'); // (a second tab, so the strip shows its tabs)
await sleep(500);
const hand = ['.bc a.pl', '.bc a.tag', '.day-head .page-title a', '.blk.has-kids > .fold', '.blk > .bul', '#side .nav a', '#side .side-list a', '#side .side-h', '#side .searchbtn', '#histbar .tab', '#histbar .tab-new', '.date-chip', '.todo', '.prop .pk', '.sched .disclose'];
let got = await cursors(hand);
check(got.every(([, c]) => c === 'pointer'), 'Journals: links, dates, dots, arrows, sidebar entries, tabs, chips show the hand', JSON.stringify(got.filter(([, c]) => c !== 'pointer')));
got = await cursors(['.sheet.today .blk > .bc', '.prop .pv']);
check(got.every(([, c]) => c === 'text'), 'a note’s words keep the text cursor (a click edits)', JSON.stringify(got));
await page.keyboard.press('Control+w');
await sleep(400);
await page.evaluate(() => { location.hash = '#/page/Sourdough%20Bread'; });
await sleep(800);
got = await cursors(['.refgrp h3 a', '.refhit', '.title-row .icon-btn', '.sec-h .disclose']);
check(got.every(([, c]) => c === 'pointer'), 'a page: references, page buttons show the hand', JSON.stringify(got));
await page.evaluate(() => { location.hash = '#/settings/look'; });
await sleep(800);
got = await cursors(['.set-tabs .chip', '.skin-card', '.sw', '.lk-opts .chip', '.text-style select', '.size-row input']);
check(got.every(([, c]) => c === 'pointer'), 'Settings: tabs, looks, swatches, choices, lists show the hand', JSON.stringify(got));

// ---- properties: a pale rounded box under the words, one per line (a page's too) ----
await page.evaluate(() => { location.hash = '#/page/Look%20test'; });
await sleep(800);
const box = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.outline .blk > .bc > .props')].find((x) => x.textContent.includes('type'));
  const rows = [...p.querySelectorAll('.prop')].map((r) => r.getBoundingClientRect());
  const cs = getComputedStyle(p);
  return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, rows: rows.length, below: rows[1].top >= rows[0].bottom - 1, left: Math.abs(rows[1].left - rows[0].left) < 1 };
});
check(box.bg === 'rgb(243, 243, 243)' && box.radius === '4px' && box.rows === 2 && box.below && box.left, 'a note’s properties sit in a pale rounded box, one per line', JSON.stringify(box));
const dprops = await page.evaluate(() => { const p = [...document.querySelectorAll('.blk.marker-done > .bc > .props')][0]; return p && [getComputedStyle(p).display, getComputedStyle(p.closest('.bc')).textDecorationLine]; });
check(dprops?.[0] === 'inline-block', 'a done note’s properties box isn’t struck through', JSON.stringify(dprops));
const hd = await page.evaluate(() => getComputedStyle([...document.querySelectorAll('.blk.marker-done .h')][0]).textDecorationLine);
check(hd.includes('line-through'), 'a done heading is struck through too', hd);
await page.evaluate(() => { location.hash = '#/page/Sourdough%20Bread'; });
await sleep(800);
const pp = await page.evaluate(() => { const p = document.querySelector('.page-head .page-props .props'); return p && [getComputedStyle(p).backgroundColor, p.querySelectorAll('.prop').length]; });
check(pp && pp[0] === 'rgb(243, 243, 243)' && pp[1] === 3, 'a page’s properties under its title: the same box', JSON.stringify(pp));
await page.screenshot({ path: SHOTS + '/t15-props-plain.png' });
await look('paper', '#/page/Sourdough%20Bread');
const paper = await page.evaluate(() => { const p = document.querySelector('.page-head .page-props .props'); const cs = getComputedStyle(p); return [cs.backgroundColor, cs.borderTopStyle]; });
check(paper[0] === 'rgba(0, 0, 0, 0)' && paper[1] === 'dashed', 'Paper: its own pencilled box', JSON.stringify(paper));

// ---- Settings → Look → Page links ----
await look('calm', '#/settings/look');
const pick = async (v) => { await page.locator(`.lk-opts [data-lk="${v}"]`).click(); await sleep(150); };
const linkLook = (sel = '.bc a.pl:not(.lbl)') => page.evaluate((s) => { const a = document.querySelector(s); const b = getComputedStyle(a, '::before').content; return [getComputedStyle(a).borderBottomWidth, b]; }, sel);
check(await page.locator('.lk-opts [data-lk=""]').getAttribute('aria-pressed') === 'true', 'Page links: “Look’s own” to start with');
await pick('brackets');
check(await page.evaluate(() => document.documentElement.dataset.links) === 'brackets' && await page.evaluate(() => localStorage.getItem('linkStyle')) === '"brackets"', 'choosing “Show [[ ]]” applies and is remembered');
await page.evaluate(() => { location.hash = '#/page/Look%20test'; });
await sleep(800);
let lk = await linkLook();
check(lk[0] === '0px' && lk[1] === '"[["', 'page links show [[ ]] (and no line under them)', JSON.stringify(lk));
check((await linkLook('.bc a.pl.lbl'))[1] === 'none', 'a link with words of its own shows no brackets');
check(await css('.bc a.tag', 'borderBottomWidth') !== null && (await css('.bc a.tag', 'content', '::before')) !== '"[["', 'tags stay as they are');
await page.reload();
await sleep(900);
check((await linkLook())[1] === '"[["', 'still there after a restart');
await page.evaluate(() => { location.hash = '#/settings/look'; });
await sleep(700);
await pick('color');
await page.evaluate(() => { location.hash = '#/page/Look%20test'; });
await sleep(800);
lk = await linkLook();
check(lk[0] === '0px' && lk[1] === 'none', 'colour only: no line, no brackets (in Calm, which underlines its own)', JSON.stringify(lk));
await page.evaluate(() => { location.hash = '#/settings/look'; });
await sleep(700);
await pick('underline');
await look('plain', '#/page/Look%20test');
lk = await linkLook();
check(lk[0] === '1px' && lk[1] === 'none', 'underlined: a line under links even in Plain (colour only of its own)', JSON.stringify(lk));
await page.evaluate(() => { location.hash = '#/settings/look'; });
await sleep(700);
await pick('');
check(await page.evaluate(() => document.documentElement.dataset.links) === undefined, '“Look’s own” again: the look decides');
await page.screenshot({ path: SHOTS + '/t15-settings-look.png' });

// ---- sidebar: the pages under Favourites and Recent step in from their headings ----
const side = await page.evaluate(() => {
  const h = document.querySelector('#favs .side-h'), a = document.querySelector('#favs .side-list a');
  const range = document.createRange(); range.selectNodeContents(h); const ht = range.getClientRects()[0].left;
  range.selectNodeContents(a); return [ht, range.getClientRects()[0].left];
});
check(side[1] - side[0] >= 10, 'sidebar: Favourites’ pages step in from the heading', JSON.stringify(side));
await browser.close();

// ---- phone: Plain fits, nothing sideways, the choices are finger-sized, no hover patch ----
const p = await open({ viewport: { width: 390, height: 844 }, touch: true });
await p.page.evaluate(() => localStorage.setItem('skin', '"plain"'));
await p.page.reload();
await p.page.waitForSelector('.sheet .outline');
await sleep(500);
const wide = await p.page.evaluate(() => document.documentElement.scrollWidth);
check(wide <= 390, 'phone: Plain has no sideways scrolling', wide);
const ph = await p.page.evaluate(() => [...document.querySelectorAll('.sheet.today .blk')].find((b) => b.textContent.includes('cold-prov')).getBoundingClientRect().height);
check(Math.abs(ph - 28) < 0.6, 'phone: Logseq’s spacing too', ph);
await p.page.screenshot({ path: SHOTS + '/t15-phone-plain.png' });
await p.page.evaluate(() => { location.hash = '#/settings/look'; });
await sleep(800);
const chipH = await p.page.evaluate(() => [...document.querySelectorAll('.lk-opts .chip')].map((b) => b.getBoundingClientRect().height));
check(chipH.length === 4 && chipH.every((x) => x >= 44), 'phone: the Page links choices are finger-sized', JSON.stringify(chipH));
await p.page.locator('.lk-opts').scrollIntoViewIfNeeded();
await p.page.screenshot({ path: SHOTS + '/t15-phone-settings.png' });
await p.browser.close();

const all = [...errors, ...p.errors];
check(all.length === 0, 'no script errors or CSP blocks', all.join(' | '));
console.log(failures() ? `${failures()} FAILED` : 'all passed');

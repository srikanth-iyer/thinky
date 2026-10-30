// Looks, Build 32 round 2 (his review, Oct 29): soft, diffused shadows on raised sheets (no hard offset
// or 1px edge lines; Sticker keeps its drawn hard shadow on purpose); the sunken reference boxes keep
// round 1's firmer inset (round 3: he asked for it back),
// Paper without the dot grid under the notes (it moved to the sidebar, faint), Calm's day cards closer
// together, a note's own thread line starting a fixed gap under its dot even when its words wrap
// (headings too, and on a phone), Automaton on a neutral background with the rule 30 pattern around
// plain cards (round 3: his pick, version B).
import { open, check, failures, sleep, write, SHOTS, BASE } from './lib.mjs';
import fs from 'node:fs';

write('pages/Wrapped.md', '- A parent note whose words are long enough to wrap onto a second and even a third line on a laptop window, so the line under its dot must not wait for its last line before it starts\n'
  + '\t- its child\n\t- and another\n- ## A heading with children\n\t- under the heading\n- Last note\n');

let { browser, page, errors } = await open();
const look = async (id, hash) => {
  await page.evaluate((l) => localStorage.setItem('skin', JSON.stringify(l)), id);
  await page.goto(BASE + '/?t=' + Date.now() + hash);
  await page.waitForSelector('.sheet .outline .blk');
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1, 1);
  await sleep(400);
};
/** Each layer of a computed box-shadow: {inset, x, y, blur}. */
const layers = (s) => s === 'none' ? [] : [...s.matchAll(/(?:rgba?\([^)]*\)|#\w+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+-?[\d.]+px)?(\s+inset)?/g)]
  .map((m) => ({ x: +m[1], y: +m[2], blur: +m[3], inset: !!m[4] }));

// ---------- shadows: the raised sheets soft and diffused, no hard lines; the reference wells as in round 1 ----------
for (const id of ['calm', 'calmplain', 'night', 'paper', 'automaton', 'azulejo']) {
  await look(id, '#/page/Tobias%20Wren%20Okafor');
  const s = await page.evaluate(() => ({ sheet: getComputedStyle(document.querySelector('.sheet.page')).boxShadow, refs: getComputedStyle(document.querySelector('.refgrp')).boxShadow }));
  const sh = layers(s.sheet), rf = layers(s.refs);
  if (id !== 'calmplain') check(sh.length >= 2 && sh.every((l) => l.blur >= 3 && !l.inset) && sh.some((l) => l.y >= 6), `${id}: the sheet is raised by soft shadows only (every layer blurred ≥ 3px, no hard offset)`, s.sheet);
  const well = { calm: 'rgba(26, 33, 48, 0.18) 0px 3px 6px -2px inset', calmplain: 'rgba(26, 33, 48, 0.14) 0px 3px 6px -2px inset', night: 'rgba(0, 0, 0, 0.38) 0px 2px 5px 0px inset',
    paper: 'rgba(70, 50, 20, 0.08) 0px 1px 3px 0px inset', automaton: 'rgba(23, 32, 51, 0.15) 0px 3px 6px -2px inset', azulejo: 'rgba(26, 33, 48, 0.18) 0px 3px 6px -2px inset' }[id];
  check(rf.some((l) => l.inset) && s.refs.startsWith(well), `${id}: the reference box pressed in as in round 1 (its inner shade at the top)`, s.refs);
}
await look('sticker', '#/journals');
const st = await page.evaluate(() => getComputedStyle(document.querySelector('.sheet.day')).boxShadow);
check(layers(st).some((l) => l.blur === 0 && l.x === 4), 'Sticker keeps its drawn hard offset shadow (that look is made of them)', st);

// ---------- Paper: plain paper under the notes, the dot grid faint on the sidebar ----------
await look('paper', '#/journals');
const pp = await page.evaluate(() => ({ sheet: getComputedStyle(document.querySelector('.sheet.day')).backgroundImage, side: getComputedStyle(document.querySelector('#side')).backgroundImage,
  sideSize: getComputedStyle(document.querySelector('#side')).backgroundSize }));
check(!pp.sheet.includes('radial-gradient') && pp.sheet.includes('grain.svg'), 'Paper: no dot grid behind the notes (the paper grain stays)', pp.sheet);
const alpha = +(pp.side.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1];
check(pp.side.includes('radial-gradient') && alpha > 0 && alpha <= 0.15 && pp.sideSize.startsWith('9px 9px'), 'Paper: the sidebar has the dot grid, faint (≤ .15)', JSON.stringify(pp));
await page.screenshot({ path: SHOTS + '/t16-paper.png' });

// ---------- Calm: day cards closer together; other looks as they were ----------
const dayGap = () => page.evaluate(() => { const d = [...document.querySelectorAll('.sheet.day')]; return Math.round(d[1].getBoundingClientRect().top - d[0].getBoundingClientRect().bottom); });
await look('calm', '#/journals');
const calmGap = await dayGap();
const calmPad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sheet.day')).paddingTop));
await look('night', '#/journals');
const nightGap = await dayGap();
await look('plain', '#/journals');
const plainGap = await dayGap();
check(calmGap === 32 && calmPad >= 50 && nightGap === 64 && plainGap === 20, 'Calm: 32px between day cards (was 64), the room inside each kept; Night 64, Plain 20 as before', JSON.stringify({ calmGap, calmPad, nightGap, plainGap }));

// ---------- thread lines: a fixed gap under the dot, also for wrapped notes and headings ----------
/** For note `text`: how far its own line starts below its dot, and how many lines its words take. */
const lineStart = (text) => page.evaluate((t) => {
  const row = [...document.querySelectorAll('.sheet .outline .blk')].find((b) => b.textContent.startsWith(t));
  const bul = row.querySelector(':scope > .bul'), r = bul.getBoundingClientRect(), dot = parseFloat(getComputedStyle(bul, '::after').height);
  const top = row.getBoundingClientRect().top + parseFloat(getComputedStyle(row, '::after').top);
  const bc = row.querySelector('.bc');
  return { gap: +(top - (r.top + r.height / 2 + dot / 2)).toFixed(1), lines: Math.round(bc.getBoundingClientRect().height / parseFloat(getComputedStyle(bc).lineHeight)) };
}, text);
for (const id of ['plain', 'calm', 'paper']) {
  await look(id, '#/page/Wrapped');
  const w = await lineStart('A parent note'), h = await lineStart('A heading');
  check(w.lines >= 2 && Math.abs(w.gap - 8) <= 0.6 && Math.abs(h.gap - 8) <= 0.6, `${id}: a wrapped note's line (and a heading's) starts 8px under its dot, not under its last line`, JSON.stringify({ w, h }));
}
await page.screenshot({ path: SHOTS + '/t16-wrapped-lines.png' });

// ---------- Automaton: no blue tint behind; the rule 30 pattern around plain cards (no band, no grid) ----------
await look('automaton', '#/journals');
const au = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, side: getComputedStyle(document.querySelector('#side')).backgroundColor,
  grid: getComputedStyle(document.body).backgroundImage, band: getComputedStyle(document.querySelector('.sheet.day')).backgroundImage }));
const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const neutral = (c) => { const [r, g, b] = rgb(c); return Math.max(r, g, b) - Math.min(r, g, b) <= 3; };
check(neutral(au.body) && neutral(au.side) && au.grid.includes('rule30.svg') && !au.grid.includes('linear-gradient(90deg') && !au.band.includes('rule30.svg'), 'Automaton: a neutral page and sidebar, the rule 30 pattern on the page around the cards, no grid, no band on the cards', JSON.stringify(au));
const card = await page.evaluate(() => { const s = document.querySelector('.sheet.day'), c = getComputedStyle(s); return { bg: c.backgroundColor, top: Math.round(parseFloat(c.paddingTop)) }; });
check(card.bg === 'rgb(255, 255, 255)', 'Automaton: the cards plain white', JSON.stringify(card));
const svg = fs.readFileSync(new URL('../../ui/skins/rule30.svg', import.meta.url), 'utf8');
const op = [...svg.matchAll(/fill-opacity='([\d.]+)'/g)].map((m) => +m[1]);
check(op[0] === 1 && op.at(-1) >= 0.3, 'Automaton: the pattern’s rows strong to faint (1 down to .3)', op.join(','));
// a heading that sits on the pattern (a page's Linked references) gets a plain band (he said yes, round 3)
await look('automaton', '#/page/Tobias%20Wren%20Okafor');
await page.waitForSelector('.view > .sec > .sec-h');
const band = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.view > .sec > .sec-h')); return { bg: c.backgroundColor, pad: c.paddingLeft }; });
check(band.bg !== 'rgba(0, 0, 0, 0)' && parseFloat(band.pad) > 0, 'Automaton: headings on the pattern sit on a plain band', JSON.stringify(band));
await look('calm', '#/page/Tobias%20Wren%20Okafor');
await page.waitForSelector('.view > .sec > .sec-h');
const noBand = await page.evaluate(() => getComputedStyle(document.querySelector('.view > .sec > .sec-h')).backgroundColor);
check(noBand === 'rgba(0, 0, 0, 0)', 'other looks: no band', noBand);
const errs1 = [...errors];
await browser.close();

// ---------- phone: Calm's gap, Paper's menu, the wrapped note's line ----------
({ browser, page, errors } = await open({ viewport: { width: 390, height: 844 }, touch: true }));
await look('calm', '#/journals');
const pg = await dayGap();
check(pg === 22, 'phone, Calm: 22px between day cards (was 40)', pg);
await look('calm', '#/page/Wrapped');
const pw = await lineStart('A parent note');
check(pw.lines >= 3 && Math.abs(pw.gap - 8) <= 0.6, 'phone: a wrapped note’s line starts 8px under its dot', JSON.stringify(pw));
await look('paper', '#/journals');
await page.locator('#topbar [data-a="menu"]').click();
await sleep(500);
const dr = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#side')); return { img: s.backgroundImage, bg: s.backgroundColor, page: getComputedStyle(document.body).backgroundColor }; });
check(dr.img.includes('radial-gradient') && dr.bg === dr.page, 'phone, Paper: the menu has the faint dot grid on the page colour', JSON.stringify(dr));
await page.screenshot({ path: SHOTS + '/t16-paper-menu.png' });
await browser.close();

const all = [...errs1, ...errors];
check(all.length === 0, 'no script errors or CSP blocks', all.join(' | '));
console.log(failures() ? `${failures()} FAILED` : 'all passed');

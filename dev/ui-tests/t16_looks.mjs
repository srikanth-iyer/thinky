// Looks, Build 32: the thread lines leave room by the dots (they start a small fixed gap under a
// parent's dot, also when its words wrap (round 2), and stop at its last note's words; measured in the
// pixels drawn), Plain's accent in its links'
// blue (ticked boxes, quotes' bar, the logo, icons, the sidebar's current place, buttons), Plain night
// and Plain teal in theirs, a link colour picked in Settings carrying Plain's accent along, Grimoire
// taken out (a saved Grimoire opens as Calm, before the first paint too), Automaton's stronger blue,
// and the phone's even sides (the space left of the dots = the space right of the words).
import { open, check, failures, sleep, write, SHOTS, BASE } from './lib.mjs';
import zlib from 'node:zlib';

write('pages/Thread test.md', '- Reading [[Marta Pell]] on bread #reading\n'
  + '\t- Cold-proving is the key idea\n\t\t- Starters fed twice a day stay lively\n\t\t\t- Warm inside, cool between\n'
  + '\t\t- A second thought under it\n\t- TODO email [[Rosa Penhallow]]\n\t- DONE send the order\n'
  + '- > A quote: the time a dough takes to rise depends on how warm the kitchen is.\n'
  + '- Last note on the page\n');

/** A PNG screenshot as {w, h, px(x, y) → [r, g, b]} (8-bit RGB/RGBA, as Playwright writes them). */
function decode(buf) {
  let o = 8, w = 0, h = 0, ch = 4;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ch = data[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { w, h, px: (x, y) => [...out.subarray(y * stride + x * ch, y * stride + x * ch + 3)] };
}

const LOOKS = ['plain', 'plainnight', 'plainteal', 'calm', 'calmplain', 'night', 'paper', 'sticker', 'stickernight', 'automaton', 'azulejo'];

// ---------- Grimoire taken out: a saved Grimoire opens as Calm, from the first paint ----------
let { browser, page, errors } = await open();
await page.evaluate(() => localStorage.setItem('skin', '"grimoire"'));
await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { window.firstSkin = document.documentElement.dataset.skin; }));
await page.goto(BASE + '/?t=' + Date.now() + '#/journals');
await page.waitForSelector('.sheet .outline');
await sleep(400);
check(await page.evaluate(() => window.firstSkin) === 'calm', 'a saved Grimoire is Calm before anything paints (boot.js)', await page.evaluate(() => window.firstSkin));
check(await page.evaluate(() => [document.documentElement.dataset.skin, localStorage.getItem('skin')]).then((x) => x[0] === 'calm' && x[1] === '"calm"'), 'and the app keeps Calm from then on');
await page.locator('#side [data-a="looks"]').click();
await sleep(200);
const listed = await page.evaluate(() => [...document.querySelectorAll('.pop.looks [data-look]')].map((b) => b.dataset.look));
check(listed.length === 12 && !listed.includes('grimoire') && LOOKS.every((l) => listed.includes(l)), 'the Look list has 12 looks (thinky added), no Grimoire', listed.join(','));
await page.keyboard.press('Escape');

const look = async (id, hash = '#/page/Thread%20test') => {
  await page.evaluate((l) => localStorage.setItem('skin', JSON.stringify(l)), id);
  await page.goto(BASE + '/?t=' + Date.now() + hash);
  await page.waitForSelector(hash.startsWith('#/todos') ? '.chips' : '.sheet .outline .blk');
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1, 1);
  await sleep(450);
};
// a colour's r, g, b (0–255): rgb()/rgba(), or color(srgb r g b / a) with 0–1 values (what color-mix() gives)
const col = (c) => { const m = (String(c).match(/[\d.]+/g) || []).map(Number); return String(c).startsWith('color(') ? m.slice(0, 3).map((v) => v * 255) : m.slice(0, 3); };
const blueish = (c) => { const [r, g, b] = col(c); return b - r > 40; };

// ---------- thread lines: room under the dot and above the next one, measured in the pixels ----------
/** The guide line in the column under note `text`'s dot: where its pixels start and stop, against
 *  that dot's bottom and the next dot below it in the same column. */
async function measure(p, text) {
  const g = await p.evaluate((t) => {
    const rows = [...document.querySelectorAll('.sheet .outline .blk')];
    const k = rows.findIndex((b) => b.textContent.startsWith(t));
    const row = rows[k], d = +row.style.getPropertyValue('--d');
    const dot = (b) => { const r = b.querySelector(':scope > .bul').getBoundingClientRect(); const s = getComputedStyle(b.querySelector(':scope > .bul'), '::after'); return { top: r.top + (r.height - parseFloat(s.height)) / 2, bottom: r.top + (r.height + parseFloat(s.height)) / 2 }; };
    const next = rows.slice(k + 1).find((b) => +b.style.getPropertyValue('--d') <= d);
    const pad = parseFloat(getComputedStyle(row).getPropertyValue('--bc-pad-y'));
    const last = rows[rows.indexOf(next) - 1].querySelector('.bc').getBoundingClientRect();
    return { x: row.getBoundingClientRect().left + parseFloat(getComputedStyle(row, '::after').left), me: dot(row), next: dot(next),
      lastEnd: last.bottom - pad, dpr: devicePixelRatio };
  }, text);
  const s = g.dpr, y0 = Math.ceil(g.me.bottom), y1 = Math.floor(g.next.top);
  // a strip from just below the dot to just above the next one: the line's own column (the pale line is
  // 1px at x), against the page 3px to its left in the same row
  const shot = decode(await p.screenshot({ clip: { x: Math.round(g.x) - 3, y: y0, width: 4, height: y1 - y0 } }));
  const on = [];
  for (let y = 0; y < shot.h; y++) {
    const a = shot.px(3 * s, y), b = shot.px(0, y);
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 6) on.push(y);
  }
  if (!on.length) return { none: true };
  const top = y0 + on[0] / s, end = y0 + (on.at(-1) + 1) / s;
  return { gapTop: +(top - g.me.bottom).toFixed(1), gapBottom: +(g.next.top - end).toFixed(1),
    stopsAtLastWords: +(end - g.lastEnd).toFixed(1), solid: on.length === on.at(-1) - on[0] + 1 };
}
const before = { plain: { gapTop: 4, gapBottom: 11 }, calm: { gapTop: 4, gapBottom: 11 } }; // (Build 31, measured the same way)
for (const id of ['plain', 'calm', 'plainnight', 'sticker', 'automaton']) {
  await look(id);
  for (const [t, what] of [['Reading', 'a top note'], ['Starters', 'a note 2 levels in']]) {
    const m = await measure(page, t);
    check(!m.none && m.solid && Math.abs(m.gapTop - 8) <= 1.5 && m.gapBottom >= 12 && Math.abs(m.stopsAtLastWords) <= 1.5,
      `${id}: ${what}'s line starts 8px under its dot and stops at its last note's words, room by both dots`
      + (before[id] && t === 'Reading' ? ` (was ${before[id].gapTop}px / ${before[id].gapBottom}px)` : ''), JSON.stringify(m));
    if (id === 'plain' && t === 'Reading') console.log(`  (Plain: ${m.gapTop}px under the dot, as Logseq's 9; ${m.gapBottom}px above the next dot, Logseq 14)`);
  }
}
// the line under the mouse lights up over the same stretch
await look('plain');
const hl = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.sheet .outline .blk')];
  const kid = rows.find((b) => b.textContent.startsWith('Cold-prov'));
  const r = kid.getBoundingClientRect();
  kid.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 9.5, clientY: r.top + r.height / 2 }));
  await new Promise((f) => setTimeout(f, 50));
  const line = document.querySelector('.thread-hl')?.getBoundingClientRect();
  const top = rows[0], last = rows.find((b) => b.textContent.includes('send the order'));
  const pad = parseFloat(getComputedStyle(top).getPropertyValue('--bc-pad-y'));
  const dot = getComputedStyle(top.querySelector(':scope > .bul'), '::after').height, b = top.querySelector(':scope > .bul').getBoundingClientRect();
  return line && { top: line.top - (b.top + b.height / 2 + parseFloat(dot) / 2 + 8), bottom: line.bottom - (last.getBoundingClientRect().bottom - pad) };
});
check(hl && Math.abs(hl.top) < 0.6 && Math.abs(hl.bottom) < 0.6, 'the line under the mouse lights up from 8px under the dot to the last note’s words', JSON.stringify(hl));
await page.screenshot({ path: SHOTS + '/t16-lines-plain.png' });
// folded notes, headings, a zoomed-in note: the last row before a shallower one always ends lines
const ends = await page.evaluate(() => [...document.querySelectorAll('.sheet .outline .blk')].map((b) => [b.textContent.slice(0, 12), b.style.getPropertyValue('--d'), b.style.getPropertyValue('--e')]));
check(ends.find((e) => e[0].startsWith('Warm inside'))?.[2] === '2' && ends.find((e) => e[0].startsWith('send'))?.[2] === '0' && ends.find((e) => e[0].startsWith('Reading'))?.[2] === '',
  'each branch’s last row says which lines end there (--e)', JSON.stringify(ends));

// ---------- Plain's accent, in its links' blue ----------
const accent = () => page.evaluate(() => {
  const g = (sel, p, ps) => { const e = document.querySelector(sel); return e ? getComputedStyle(e, ps || null)[p] : null; };
  const icon = document.querySelector('#side .nav a svg'), word = document.querySelector('#side .nav a');
  return {
    link: g('.sheet .bc a.pl', 'color'), tick: g('.sheet .todo:checked', 'backgroundColor'), quote: g('.sheet .bc blockquote', 'borderLeftColor'),
    logo: document.querySelector('#histbar .hb-logo use')?.getAttribute('href') /* (the icon has its own tokens, --logo-*) */, icon: getComputedStyle(icon).color, words: getComputedStyle(word).color,
    line: getComputedStyle(document.documentElement).getPropertyValue('--line').trim(),
  };
});
await look('plain');
let a = await accent();
check(a.tick === a.link && a.link === 'rgb(27, 104, 152)', 'Plain: a ticked box is in the links’ blue (was black)', JSON.stringify(a));
check(blueish(a.quote) && a.logo === 'brand/icon-in.svg#s', 'Plain: the quote’s bar in that blue too (the logo has its own colours)', JSON.stringify(a));
check(a.icon !== a.words && blueish(a.icon), 'Plain: the sidebar’s icons tinted with it, not loud', JSON.stringify(a));
await look('plain', '#/journals');
const cur = await page.evaluate(() => getComputedStyle(document.querySelector('#side .nav a[aria-current="page"]')).backgroundColor);
check(blueish(cur) || (() => { const [r, g, b] = col(cur); return b > r + 8; })(), 'Plain: the sidebar’s current place has a pale tint of it', cur);
await look('plain', '#/todos');
const chip = await page.evaluate(() => { const c = document.querySelector('.chip[aria-pressed="true"], .chip[aria-selected="true"]'); return c && getComputedStyle(c).backgroundColor; });
check(chip === 'rgb(27, 104, 152)', 'Plain: a pressed button is that blue (was black)', chip);
await page.screenshot({ path: SHOTS + '/t16-plain-todos.png' });
await look('plainnight');
a = await accent();
check(a.tick === a.link && a.link === 'rgb(138, 180, 248)' && blueish(a.quote) && a.icon !== a.words, 'Plain night: the same in its soft blue', JSON.stringify(a));
await look('plainteal');
a = await accent();
check(a.tick === 'rgb(142, 194, 194)' && a.quote !== 'rgb(14, 82, 99)' && a.icon !== a.words, 'Plain teal: its teal ticks, a teal quote bar and icons', JSON.stringify(a));
await look('calm');
a = await accent();
const calmLine = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--line)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
check(a.quote === calmLine && a.icon === a.words, 'Calm (and the other looks): quotes and icons as before', JSON.stringify([a, calmLine]));
// a link colour picked in Settings carries Plain's accent along
await page.evaluate(() => localStorage.setItem('linkColor', '"#AA3355"'));
await look('plain');
a = await accent();
check(a.link === 'rgb(170, 51, 85)' && a.tick === a.link, 'Plain: a link colour picked in Settings is its accent too', JSON.stringify(a));
await page.evaluate(() => localStorage.removeItem('linkColor'));

// ---------- Automaton: a stronger blue, labels in the blue ----------
await look('automaton', '#/journals');
const au = await page.evaluate(() => ({
  accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  weekday: getComputedStyle(document.querySelector('.weekday')).color, band: getComputedStyle(document.querySelector('.sheet.day')).backgroundImage,
  dot: getComputedStyle(document.querySelector('.sheet .blk > .bul'), '::after').backgroundColor,
}));
check(au.accent.toUpperCase() === '#1E56E6' && au.weekday === 'rgb(30, 86, 230)' && au.dot === au.weekday && !au.band.includes('rule30.svg'), 'Automaton: a stronger blue for its dots and day labels (its rule 30 is on the page now, not a band: t16_looks2)', JSON.stringify(au));
await page.screenshot({ path: SHOTS + '/t16-automaton.png' });
const errs1 = [...errors];
await browser.close();

// ---------- phone: even sides, lines, every look ----------
({ browser, page, errors } = await open({ viewport: { width: 390, height: 844 }, touch: true }));
for (const id of LOOKS) {
  await look(id);
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sheet .outline .blk')];
    const top = rows.find((b) => b.textContent.startsWith('Last note')), kid = rows.find((b) => b.textContent.startsWith('A second thought'));
    const dot = top.querySelector('.bul'), r = dot.getBoundingClientRect(), w = parseFloat(getComputedStyle(dot, '::after').width);
    const bc = kid.querySelector('.bc'), q = bc.getBoundingClientRect();
    const parent = rows.find((b) => b.textContent.startsWith('Reading')), pbc = parent.querySelector('.bc'), fold = parent.querySelector('.fold').getBoundingClientRect();
    return { left: r.left + (r.width - w) / 2, right: innerWidth - (q.right - parseFloat(getComputedStyle(bc).paddingRight)),
      arrowRoom: fold.left + fold.width / 2 - 4.5 - (pbc.getBoundingClientRect().right - parseFloat(getComputedStyle(pbc).paddingRight)), wide: document.documentElement.scrollWidth };
  });
  check(Math.abs(m.left - m.right) <= 1 && m.arrowRoom >= 8 && m.wide <= 390, `phone, ${id}: as much space left of the dots as right of the words; the words stop short of an arrow`, JSON.stringify(m));
}
await look('plain');
const pm = await measure(page, 'Reading');
check(!pm.none && pm.gapTop >= 7 && pm.gapBottom >= 12, 'phone: the lines leave room by the dots too', JSON.stringify(pm));
await page.screenshot({ path: SHOTS + '/t16-phone-plain.png' });
await browser.close();

const all = [...errs1, ...errors];
check(all.length === 0, 'no script errors or CSP blocks', all.join(' | '));
console.log(failures() ? `${failures()} FAILED` : 'all passed');

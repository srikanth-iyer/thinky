// Pictures (Build 20): a picture shows at the size Logseq writes right after its link
// ({:height …, :width …}), one without a size is kept small, and a handle on its corner resizes it
// (mouse or finger), writing Logseq's format into the note (one Undo step; double-click: no size).
import { open, read, write, check, failures, sleep, go, VAULT, SHOTS } from './lib.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync('python3', ['-c', 'import sys; from PIL import Image; Image.new("RGB", (1200, 900), "#2F6BFF").save(sys.argv[1])', VAULT + '/assets/big.png']);
fs.copyFileSync(VAULT + '/assets/dot.png', VAULT + '/assets/dot2.png'); // dot.png is 160 x 80
const PICS = [
  '- sized ![dot](../assets/dot.png){:height 100, :width 200} after',
  '- loose ![dot](../assets/dot.png){:width 120.6 :height 60.3} and ![dot](../assets/dot.png){:height 50}',
  '- plain ![big](../assets/big.png)',
  '- two ![one](../assets/dot.png) and ![two](../assets/dot2.png){:width 120}',
  '- same ![d](../assets/dot2.png) ![d](../assets/dot2.png)',
  '',
].join('\n');
write('pages/Pics.md', PICS);
write('pages/Board.md', '- see [[Pics]] ![dot](../assets/dot.png){:height 40, :width 80}\n');
fs.writeFileSync(VAULT + '/pages/Latin.md', Buffer.from('- caf\xe9 ![dot](../assets/dot.png)\n', 'latin1')); // not UTF-8: read-only
execFileSync('python3', ['-c', 'import sys; from PIL import Image; Image.new("RGB", (40, 40), "#E0457B").save(sys.argv[1])', VAULT + '/assets/tiny.png']);
const PROPS_PIC = '- first ![d](../assets/dot2.png)\n  cover:: ![d](../assets/dot2.png)\n  third ![d](../assets/dot2.png)\n';
write('pages/Props pic.md', PROPS_PIC);
write('pages/Odd pics.md', '- tiny ![t](../assets/tiny.png)\n- gone ![g](../assets/gone.png)\n');
const CLASH_PIC = '- words here ![dot](../assets/dot.png)\n- other note\n';
write('pages/Clash pic.md', CLASH_PIC);
const DAY = 'Diary/' + fs.readdirSync(VAULT + '/Diary').find((f) => read('Diary/' + f).includes('Walked to the bakery')); // yesterday
const DAY_TEXT = read(DAY) + '- a picture ![dot](../assets/dot.png)\n';
write(DAY, DAY_TEXT);
const lines = () => read('pages/Pics.md').split('\n');
/** PICS with line n replaced */
const withLine = (n, s) => PICS.split('\n').map((l, k) => (k === n ? s : l)).join('\n');
const SIZE = /\{:height (\d+), :width (\d+)\}$/; // exactly as Logseq writes it

let { browser, page, errors } = await open();
const allErrors = [];
const loaded = () => page.waitForFunction(() => [...document.querySelectorAll('.outline img.img')].every((i) => i.complete && i.naturalWidth > 0));
/** [width, height] on screen of each picture in note n of the page */
const sizes = (n) => page.evaluate((k) => [...document.querySelectorAll('.outline > .blk')[k].querySelectorAll('img.img')]
  .map((i) => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }), n);
/** the middle of the handle of picture k in note n (or of the handle `hd`), scrolled into sight */
const handle = async (n, k = 0, hd = page.locator('.outline > .blk').nth(n).locator('.pic-h').nth(k)) => {
  await hd.scrollIntoViewIfNeeded();
  const b = await hd.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
};
async function drag(n, k, dx, dy, hd) {
  const h = await handle(n, k, hd);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let s = 1; s <= 8; s++) { await page.mouse.move(h.x + dx * s / 8, h.y + dy * s / 8); await sleep(16); }
  await page.mouse.up();
  await sleep(1000);
}

console.log('a size written after the link');
await go(page, '#/page/Pics');
await loaded();
check(JSON.stringify(await sizes(0)) === '[[200,100]]', '{:height 100, :width 200}: shows at that size', JSON.stringify(await sizes(0)));
const loose = await sizes(1);
check(loose[0][0] === 121 && loose[1][1] === 50 && loose[1][0] === 100, 'read loosely: any order, no commas, decimals, one key alone', JSON.stringify(loose));
const texts = await page.locator('.outline .bc').allTextContents();
check(texts[0] === 'sized  after' && !texts.some((t) => t.includes('{') || t.includes('height')), 'the size never shows as text', texts.join(' | '));

console.log('a picture without a size is kept small');
const [[bw, bh]] = await sizes(2);
check(bh === 320 && Math.abs(bw - 427) <= 1, 'at most 320px tall on a laptop, in its own shape', `${bw} x ${bh}`);
const fit = await page.evaluate(() => [...document.querySelectorAll('.outline .pic')].every((p) => {
  const a = p.getBoundingClientRect(), b = p.querySelector('img').getBoundingClientRect();
  return Math.abs(a.right - b.right) < 1 && Math.abs(a.bottom - b.bottom) < 1;
}));
check(fit, 'each handle sits on its picture’s corner');

console.log('the handle (laptop)');
check(await page.locator('.outline .pic-h').count() === 8, 'every picture has one');
const shown = () => page.evaluate(() => [...document.querySelectorAll('.outline .pic-h')].map((h) => getComputedStyle(h, '::after').opacity));
check((await shown()).every((o) => o === '0'), 'hidden until the mouse is over the picture', (await shown()).join());
const big = page.locator('.outline > .blk').nth(2).locator('img.img');
await big.hover();
await sleep(250);
check((await shown())[3] === '1', 'shown when it is', (await shown()).join());
await page.screenshot({ path: SHOTS + '/pictures-laptop.png' });

console.log('a click opens the picture; a drag resizes it');
await big.click();
await sleep(200);
check(await page.locator('.lightbox').isVisible(), 'a click on the picture opens it full size');
await page.locator('.lightbox').click();
await sleep(150);
await drag(2, 0, 80, 60);
const m = lines()[2].match(SIZE);
check(m && lines()[2] === '- plain ![big](../assets/big.png)' + m[0], 'dragging the corner writes Logseq’s {:height …, :width …} after the link', lines()[2]);
check(m && +m[2] > 480 && +m[2] < 530 && Math.abs(+m[2] / +m[1] - 4 / 3) < 0.02, 'bigger, in the same shape', m?.[0]);
check(read('pages/Pics.md') === withLine(2, lines()[2]), 'nothing else in the page changed', read('pages/Pics.md'));
check(!(await page.locator('.lightbox').count()) && !(await page.locator('textarea.ed').count()), 'the drag neither opened the picture nor started editing');
const [[nw, nh]] = await sizes(2);
check(m && nw === +m[2] && Math.abs(nh - +m[1]) <= 1, 'it now shows at that size', `${nw} x ${nh}`);
await page.keyboard.press('Control+z');
await sleep(1000);
check(read('pages/Pics.md') === PICS, 'Undo takes the size out again', read('pages/Pics.md'));

console.log('only the picture dragged changes');
await page.mouse.move(5, 5);
await drag(3, 1, -30, -15);
const two = lines()[3].match(SIZE);
check(two && lines()[3] === '- two ![one](../assets/dot.png) and ![two](../assets/dot2.png)' + two[0] && +two[2] < 120, 'two pictures in a note: the second one’s size is replaced, the first is untouched', lines()[3]);
await drag(4, 1, 40, 20);
const same = lines()[4].match(SIZE);
check(same && lines()[4] === '- same ![d](../assets/dot2.png) ![d](../assets/dot2.png)' + same[0], 'the same picture twice: only the one dragged', lines()[4]);
check(read('pages/Pics.md') === withLine(3, lines()[3]).split('\n').map((l, k) => (k === 4 ? lines()[4] : l)).join('\n'), 'and nothing else', read('pages/Pics.md'));

console.log('double-click on the handle: the usual size');
await page.locator('.outline > .blk').nth(0).locator('img.img').hover();
const h0 = await handle(0);
await page.mouse.dblclick(h0.x, h0.y);
await sleep(1000);
check(lines()[0] === '- sized ![dot](../assets/dot.png) after', 'the size is taken out', lines()[0]);
check(!(await page.locator('.lightbox').count()) && !(await page.locator('textarea.ed').count()), 'without opening the picture or editing');

console.log('elsewhere: references, preview, read-only notes');
const refs = page.locator('.refhit', { hasText: 'see' });
check(await refs.count() === 1 && !(await refs.textContent()).includes('{'), 'linked references show the picture, not its size as text', await refs.textContent());
check(JSON.stringify(await refs.locator('img.img').evaluate((i) => [i.getBoundingClientRect().width, i.getBoundingClientRect().height])) === '[80,40]' && !(await refs.locator('.pic-h').count()), 'at its size, with no handle');
await go(page, '#/page/Board');
await page.locator('.outline a[data-page="Pics"]').hover();
await page.waitForSelector('.preview:not([hidden])', { timeout: 3000 }).catch(() => {});
const pv = await page.locator('.preview').textContent().catch(() => '');
check(pv.includes('sized') && !pv.includes('{:'), 'the page preview doesn’t show sizes as text either', pv);
await page.mouse.move(5, 5);
await go(page, '#/page/Latin');
check(await page.locator('.outline img.img').count() === 1 && !(await page.locator('.outline .pic-h').count()), 'a note that can’t be edited (not UTF-8) has no handle');

console.log('when it’s unclear which picture was dragged, nothing changes and it says why');
await go(page, '#/page/Props pic');
await loaded();
await drag(0, 2, 30, 15, page.locator('.outline > .blk').nth(0).locator('.bc > .pic .pic-h, .bc .pic-h').last());
check(read('pages/Props pic.md') === PROPS_PIC, 'the same picture also in a property: not changed', read('pages/Props pic.md'));
check((await page.locator('#toast').textContent()).includes('also in a property'), 'and the message says why', await page.locator('#toast').textContent());

console.log('small pictures and pictures that didn’t load');
await go(page, '#/page/Odd pics');
await page.waitForFunction(() => document.querySelector('.outline img.img')?.complete);
const tiny = await page.locator('.outline > .blk').nth(0).locator('img.img').boundingBox();
await page.mouse.click(tiny.x + tiny.width / 2, tiny.y + tiny.height / 2);
await sleep(300);
check(await page.locator('.lightbox').isVisible(), 'a click in the middle of a small picture opens it (the handle is small too)');
await page.locator('.lightbox').click();
await sleep(200);
await page.locator('.outline > .blk').nth(1).locator('.pic').hover();
await drag(1, 0, 30, 15);
check(!(await page.locator('textarea.ed').count()) && read('pages/Odd pics.md').includes('gone ![g](../assets/gone.png)\n'), 'dragging the corner of a picture that didn’t load does nothing (no editing)');
await page.mouse.move(5, 5);

console.log('a resize that clashes with words typed elsewhere: the words are suggested');
await go(page, '#/page/Clash pic');
await loaded();
write('pages/Clash pic.md', CLASH_PIC.replace('words here', 'words typed on the phone')); // the app hasn't seen this yet
await drag(0, 0, -30, -15);
await page.waitForSelector('.clash', { timeout: 4000 }).catch(() => {});
check(await page.locator('.clash').isVisible() && await page.locator('.clash .cl-col.theirs input').isChecked(), 'the clash screen pre-picks the other copy (only a size changed here)');
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read('pages/Clash pic.md').startsWith('- words typed on the phone ![dot](../assets/dot.png)\n'), 'keeping the suggestion keeps the typed words', read('pages/Clash pic.md'));
await page.mouse.move(5, 5);

console.log('journals');
await go(page, '#/journals');
await drag(0, 0, 40, 20, page.locator('.outline', { hasText: 'Walked to the bakery' }).locator('.pic-h'));
check(read(DAY) === DAY_TEXT.replace('dot.png)\n', 'dot.png){:height 100, :width 200}\n'), 'resizing a picture on yesterday’s journal', read(DAY));
await page.keyboard.press('Control+z');
await sleep(1000);
check(read(DAY) === DAY_TEXT, 'Ctrl+Z undoes it there (not on today’s)', read(DAY));
allErrors.push(...errors);
await browser.close();

// --------------------------------------------------------------------------------------------
write('pages/Pics.md', PICS);
({ browser, page, errors } = await open({ viewport: { width: 393, height: 851 }, touch: true }));
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

console.log('phone');
await go(page, '#/page/Pics');
await loaded();
const [[pw, ph]] = await sizes(2);
const noteW = await page.locator('.outline > .blk').nth(2).locator('.bc').evaluate((bc) => bc.clientWidth);
check(ph <= 260 && pw <= noteW && Math.abs(pw / ph - 4 / 3) < 0.02, 'a picture without a size: at most 260px tall, never wider than the note', `${pw} x ${ph}, note ${noteW}`);
const ph0 = await handle(2);
check((await shown()).every((o) => +o > 0.9) && ph0.w >= 32 && ph0.h >= 32, 'handles always show, big enough for a finger', `${(await shown()).join()} ${ph0.w}x${ph0.h}`);
await page.screenshot({ path: SHOTS + '/pictures-phone.png' });
const y0 = await page.evaluate(() => scrollY);
await touch('touchStart', ph0.x, ph0.y);
for (let s = 1; s <= 8; s++) { await touch('touchMove', ph0.x - 80 * s / 8, ph0.y - 60 * s / 8); await sleep(16); }
await touch('touchEnd');
await sleep(1100);
const pm = lines()[2].match(SIZE);
check(pm && read('pages/Pics.md') === withLine(2, '- plain ![big](../assets/big.png)' + pm[0]) && +pm[2] < pw - 40, 'a finger drag makes it smaller and writes the size (and nothing else)', lines()[2]);
check(await page.evaluate(() => scrollY) === y0 && !(await page.locator('.lightbox').count()) && !(await page.locator('textarea.ed').count()), 'without scrolling, opening the picture or editing');
await page.locator('.outline > .blk').nth(0).locator('img.img').tap();
await sleep(200);
check(await page.locator('.lightbox').isVisible(), 'a tap on a picture still opens it');
await page.evaluate(() => window.leanApp.onBack());
await sleep(200);
// a scroll that starts on a corner scrolls (it doesn't resize the picture)
const before = read('pages/Pics.md');
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(200);
const hc = await handle(2);
const sy0 = await page.evaluate(() => scrollY);
await touch('touchStart', hc.x, hc.y);
for (let s = 1; s <= 10; s++) { await touch('touchMove', hc.x + 2, hc.y - 300 * s / 10); await sleep(16); }
await touch('touchEnd');
await sleep(1100);
check(read('pages/Pics.md') === before && await page.evaluate(() => scrollY) > sy0 + 50, 'an up-and-down swipe from a corner scrolls the page and changes nothing', `scrolled ${await page.evaluate(() => scrollY) - sy0}`);

allErrors.push(...errors);
const real = allErrors.filter((e) => !/status of 404/.test(e)); // (gone.png is missing on purpose)
check(!real.length, 'no script errors', real.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

// Reading and writing (Build 18): coloured note boxes and quotes, page icons, easier links, find and
// replace on the page, press and hold a link to preview it (phone), parent notes pinned at the top
// while scrolling, and swiping notes in and out a level (phone).
import { open, read, write, check, failures, sleep, go, editBlock, SHOTS } from './lib.mjs';

write('pages/Boxes.md', 'icon:: 🧪\n\n- #+BEGIN_NOTE\n  Remember to buy more flour.\n  #+END_NOTE\n- > [!WARNING] Careful here\n  > this deletes things\n- > A plain quote from [[Marta Pell]]\n- #+BEGIN_QUOTE\n  Logseq-style quote\n  #+END_QUOTE\n- #+BEGIN_QUERY\n  {:title "Due"}\n  #+END_QUERY\n- plain words after\n');
write('pages/Marta Pell.md', '- Wrote Notes on Wild Yeast\n');
write('pages/Finds.md', '- the cat sat\n  id:: 64f1c2a0-1111-2222-3333-444455556666\n- The CAT and the cat\n- folded parent\n  collapsed:: true\n\t- hidden cat inside\n- no match here\n');
const deep = [];
for (let a = 1; a <= 2; a++) {
  deep.push(`- Chapter ${a}`);
  for (let b = 1; b <= 3; b++) {
    deep.push(`\t- Section ${a}.${b}`);
    for (let c = 1; c <= 8; c++) deep.push(`\t\t- point ${a}.${b}.${c} with enough words to fill a line`);
  }
}
write('pages/Deep.md', deep.join('\n') + '\n');
write('pages/Swipe.md', '- one\n- two with a [[Marta Pell]] link\n- three\n');
write('pages/Typing.md', '- three\n- four\n');
// text that isn't shown as typed: find must never match or change it
const HIDDEN = '- TODO [#A] alpha task\n  SCHEDULED: <2026-10-27 Tue>\n  :LOGBOOK:\n  CLOCK: [2026-10-20 Tue 10:00]--[2026-10-20 Tue 11:00] =>  01:00:00\n  :END:\n- see [the guide](https://example.com/guide) and {{embed [[Marta Pell]]}}\n- #+BEGIN_NOTE\n  inside the box\n  #+END_NOTE\n- # Big title\n  heading:: true\n';
write('pages/Hidden.md', HIDDEN);
write('pages/Odd boxes.md', '- #+BEGIN_NOTE\n  never closed\n  SCHEDULED: <2026-10-27 Tue>\n- #+BEGIN_TIP\n  ```\n  #+END_TIP\n  def f(**kwargs): pass\n  ```\n  after the code\n  #+END_TIP\n- > [!my-type] Custom kind\n  > inside\n- #+BEGIN_VERSE\n  first\n      indented\n  #+END_VERSE\n');
write('pages/Long walk.md', Array.from({ length: 4 }, (_, a) => `- part ${a}\n` + Array.from({ length: 3 }, (_, b) => `\t- section ${a}.${b}\n` + Array.from({ length: 8 }, (_, c) => `\t\t- line ${a}.${b}.${c} with words to fill it\n`).join('')).join('')).join(''));
write('pages/Formulas.md', '- the angle $\\alpha+\\beta$ here\n- $$\n  \\frac{\\alpha}{2}\n  $$\n- a picture ![zeta alpha](../assets/dot.png) and a ref ((64f1c2a0-1111-2222-3333-444455556666)) block\n');
// a word in two journal days, for replacing across days
const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
const today = new Date();
const yday = new Date(today); yday.setDate(today.getDate() - 1);
const dayFiles = [today, yday].map((d) => `Diary/${title(d)}.md`);
const dayTexts = dayFiles.map((f) => read(f) + '- a zebra crossing\n');
dayFiles.forEach((f, k) => write(f, dayTexts[k]));

let { browser, page, errors } = await open();
const allErrors = [];
await page.waitForTimeout(300);

console.log('coloured note boxes and quotes');
await go(page, '#/page/Boxes');
await sleep(400);
const boxes = await page.evaluate(() => [...document.querySelectorAll('.outline .blk > .bc')].map((bc) => {
  const c = bc.querySelector('.callout');
  return c ? `${c.className.replace('callout ', '')}:${c.querySelector('.callout-t').textContent}` : bc.querySelector('blockquote') ? 'quote' : bc.querySelector('pre') ? 'code' : 'text';
}));
check(boxes.join(' | ') === 'c-note:Note | c-warning:Careful here | quote | quote | code | text', '#+BEGIN_NOTE and > [!WARNING] become boxes, > and #+BEGIN_QUOTE quotes, a query shows as code', boxes.join(' | '));
const dotOff = await page.evaluate(() => {
  const blk = document.querySelector('.outline .blk');
  const dot = blk.querySelector('.bul').getBoundingClientRect();
  const t = blk.querySelector('.callout-t').getBoundingClientRect();
  return Math.abs((dot.top + dot.height / 2) - (t.top + t.height / 2));
});
check(dotOff <= 2.5, 'the dot lines up with the box’s title', dotOff);
await page.screenshot({ path: SHOTS + '/boxes.png' });

console.log('page icons');
check(await page.locator('.page-title .pg-ic').textContent() === '🧪', 'the icon:: emoji before the page title');
check(await page.locator('#recent a', { hasText: 'Boxes' }).locator('.pg-ic').count() === 1, 'and before its name under Recent');
await go(page, '#/pages');
await sleep(300);
await page.fill('.list-tools .filter', 'Boxes');
await sleep(300);
check(await page.locator('.rows .pg-ic, .list .pg-ic, .view .pg-ic').first().textContent().catch(() => '') === '🧪', 'and in All pages');
// typing on a page with an icon doesn't re-read the list of every page; changing the icon does
await go(page, '#/page/Boxes');
await sleep(300);
let listReads = 0;
const onList = (r) => { if (r.url().endsWith('/api/pages')) listReads++; };
page.on('request', onList);
await editBlock(page, 'plain words after');
await page.keyboard.type(' one');
await sleep(1100);
await page.keyboard.type(' two');
await sleep(1100);
page.off('request', onList);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
check(read('pages/Boxes.md').includes('plain words after one two') && listReads === 0, 'typing on a page with an icon doesn’t re-read every page name', listReads);

console.log('easier links');
write('pages/Links.md', '- read the menus today\n- see the docs\n');
await go(page, '#/page/Links');
await sleep(400);
await editBlock(page, 'read the menus');
await page.evaluate(() => { const ta = document.querySelector('textarea.ed'); ta.setSelectionRange(9, 14); }); // "menus"
await page.keyboard.type('[');
await page.keyboard.type('[');
await page.keyboard.press('Escape');
await sleep(900);
check(read('pages/Links.md').includes('- read the [[menus]] today'), 'words selected, then [ [: a page link', read('pages/Links.md'));
await editBlock(page, 'see the docs');
await page.evaluate(() => { const ta = document.querySelector('textarea.ed'); ta.setSelectionRange(8, 12); }); // "docs"
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'https://example.com/docs');
  document.querySelector('textarea.ed').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.keyboard.press('Escape');
await sleep(900);
check(read('pages/Links.md').includes('- see the [docs](https://example.com/docs)'), 'a web address pasted over selected words: a link', read('pages/Links.md'));

console.log('find and replace on the page');
await go(page, '#/page/Finds');
await sleep(400);
await page.keyboard.press('Control+f');
await sleep(150);
check(await page.locator('#findbar').isVisible() && await page.evaluate(() => document.activeElement?.classList.contains('fb-q')), 'Ctrl+F opens the find bar, ready to type');
await page.keyboard.type('cat');
await sleep(400);
const count = () => page.locator('.fb-n').textContent();
check(await count() === '1 of 4', 'it counts every place, upper or lower case, in folded notes too, not in hidden id:: lines', await count());
check(await page.evaluate(() => CSS.highlights.get('find')?.size) >= 3 && await page.evaluate(() => CSS.highlights.get('find-cur')?.size) === 1, 'the places are highlighted, the current one more strongly');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await sleep(150);
check(await count() === '4 of 4' && await page.locator('.blk', { hasText: 'hidden cat inside' }).isVisible(), 'Enter goes to the next; one inside a folded note is shown', await count());
await page.keyboard.press('Shift+Enter');
await sleep(100);
check(await count() === '3 of 4' && !(await page.locator('.blk', { hasText: 'hidden cat inside' }).isVisible()), 'Shift+Enter goes back, and the folded note closes again', await count());
await page.locator('[data-f="case"]').click();
await sleep(200);
check(await count() === '1 of 3', '"Aa" matches capital letters exactly', await count());
await page.locator('[data-f="case"]').click();
await page.locator('[data-f="rep"]').click();
await page.locator('.fb-r').fill('dog');
await page.locator('[data-f="one"]').click();
await sleep(900);
check(read('pages/Finds.md').startsWith('- the dog sat\n  id:: 64f1c2a0'), 'Replace changes the current place (and keeps the id line)', read('pages/Finds.md'));
await page.locator('[data-f="all"]').click();
await sleep(900);
check(read('pages/Finds.md') === '- the dog sat\n  id:: 64f1c2a0-1111-2222-3333-444455556666\n- The dog and the dog\n- folded parent\n  collapsed:: true\n\t- hidden dog inside\n- no match here\n', 'Replace all changes the rest, folded notes included', read('pages/Finds.md'));
check(await count() === 'Not found', 'nothing left to find', await count());
await page.keyboard.press('Escape');
await sleep(100);
check(!(await page.locator('#findbar').isVisible()) && !(await page.evaluate(() => CSS.highlights.get('find'))), 'Esc closes it and clears the highlights');
await page.keyboard.press('Control+z');
await sleep(900);
check(read('pages/Finds.md').includes('- The CAT and the cat'), 'Undo puts back what Replace all changed', read('pages/Finds.md'));
await page.keyboard.press('Control+f');
await go(page, '#/page/Deep');
check(!(await page.locator('#findbar').isVisible()), 'going to another page closes it');

console.log('find never matches or changes what isn’t shown as typed');
await go(page, '#/page/Hidden');
await sleep(400);
await page.keyboard.press('Control+h'); // find with replace
await sleep(150);
const findWord = async (w) => { await page.locator('.fb-q').fill(w); await sleep(350); return page.locator('.fb-n').textContent(); };
for (const w of ['tue', 'note', 'todo', 'true', 'end', 'embed', 'example.com', 'logbook']) check(await findWord(w) === 'Not found', `“${w}” (in hidden or app-made text) isn’t found`, await page.locator('.fb-n').textContent());
check(await findWord('guide') === '1 of 1' && await page.evaluate(() => CSS.highlights.get('find')?.size) === 1, 'a link’s words are found, not its address; what’s counted is what’s highlighted');
await page.locator('.fb-r').fill('manual');
await page.locator('[data-f="all"]').click();
await sleep(900);
check(read('pages/Hidden.md') === HIDDEN.replace('[the guide]', '[the manual]'), 'Replace all changes the words only: the address, to-do, dates, box and heading stay', read('pages/Hidden.md'));
check(await findWord('big') === '1 of 1', 'a heading’s words are found');
await page.locator('.fb-r').fill('Small');
await page.locator('[data-f="all"]').click();
await sleep(900);
check(read('pages/Hidden.md').includes('- # Small title\n  heading:: true\n'), 'and replaced without touching the # mark', read('pages/Hidden.md'));
await page.keyboard.press('Escape');

await go(page, '#/page/Formulas');
await sleep(400);
await page.keyboard.press('Control+f');
await sleep(150);
for (const w of ['alpha', 'frac', 'zeta', 'block']) {
  const n = await findWord(w);
  const lit = await page.evaluate(() => CSS.highlights.get('find')?.size || 0);
  check(w === 'block' ? n === '1 of 1' && lit === 1 : n === 'Not found', `“${w}”: formulas and picture text aren’t searched, the ref label isn’t highlighted`, `${n}, ${lit} lit`);
}
await page.keyboard.press('Escape');

console.log('replacing in several days asks first, and Ctrl+Z undoes it in every one');
await go(page, '#/journals');
await sleep(800);
await page.keyboard.press('Control+h');
await sleep(150);
await page.locator('.fb-q').fill('zebra');
await sleep(400);
check(await page.locator('.fb-n').textContent() === '1 of 2', 'found in both days', await page.locator('.fb-n').textContent());
await page.locator('.fb-r').fill('horse');
await page.locator('[data-f="all"]').click();
await sleep(300);
check(await page.locator('.modal').isVisible() && (await page.locator('.modal h2').textContent()).includes('2 pages'), 'it asks before replacing in 2 pages', await page.locator('.modal').textContent().catch(() => ''));
await page.locator('.modal [data-v="1"]').click();
await sleep(900);
check(dayFiles.every((f) => read(f).includes('a horse crossing')), 'both days changed');
check(await page.locator('#toast .toast-act').textContent() === 'Undo', 'the message offers Undo');
await page.keyboard.press('Control+z');
await sleep(1200);
check(dayFiles.every((f, k) => read(f) === dayTexts[k]), 'Ctrl+Z puts both days back', dayFiles.map(read).join(' || '));
await page.keyboard.press('Escape');

console.log('Ctrl+H set as "highlight" in config.edn stays that while typing');
await go(page, '#/page/Typing');
await sleep(300);
await editBlock(page, 'three');
await page.keyboard.press('Shift+Home');
await page.keyboard.press('Control+h');
await sleep(200);
check((await page.locator('textarea.ed').inputValue()) === '^^three^^' && !(await page.locator('#findbar').isVisible()), 'highlights the words, the find bar stays shut', await page.locator('textarea.ed').inputValue());
await page.keyboard.press('Control+z');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await sleep(900);

console.log('pasting an address over an address replaces it (no link of a link)');
await editBlock(page, 'three');
await page.keyboard.press('End');
await page.keyboard.type(' https://old.example.com/a');
await page.evaluate(() => { const t = document.querySelector('textarea.ed'); t.setSelectionRange(t.value.indexOf('https'), t.value.length); });
await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'https://new.example.com/b'); document.querySelector('textarea.ed').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
await sleep(100);
check(!(await page.locator('textarea.ed').inputValue()).includes('['), 'not made into [old](new)', await page.locator('textarea.ed').inputValue());
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await sleep(900);

console.log('unusual boxes');
await go(page, '#/page/Odd boxes');
await sleep(400);
const odd = await page.evaluate(() => [...document.querySelectorAll('.outline .blk > .bc')].map((bc) => ({ t: bc.textContent, box: !!bc.querySelector('.callout'), kind: bc.querySelector('.callout')?.className || '', chip: !!bc.querySelector('.dates'), code: bc.querySelector('pre')?.textContent || '', verse: bc.querySelector('.verse') ? getComputedStyle(bc.querySelector('.verse')).whiteSpace : '' })));
check(!odd[0].box && odd[0].t.includes('#+BEGIN_NOTE') && odd[0].chip, 'a box that’s never closed shows as typed, its date still a chip', JSON.stringify(odd[0]));
check(odd[1].box && odd[1].code.includes('#+END_TIP') && odd[1].code.includes('**kwargs') && odd[1].t.includes('after the code'), 'an “#+END_” inside code in a box doesn’t end it; the code stays code', JSON.stringify(odd[1]));
check(odd[2].box && odd[2].t.includes('Custom kind') && !odd[2].t.startsWith('>'), 'a [!kind-with-dashes] quote is a box', JSON.stringify(odd[2]));
check(odd[3].verse === 'pre-wrap' && odd[3].t.includes('    indented'), 'a verse keeps its spaces', JSON.stringify(odd[3]));

console.log('pinned parents never cover the note being typed (laptop)');
await go(page, '#/page/Long walk');
await sleep(400);
await page.evaluate(() => { const b = [...document.querySelectorAll('.outline .blk')].find((x) => x.textContent.includes('line 3.2.7')); b.scrollIntoView({ block: 'start' }); });
await sleep(300);
await editBlock(page, 'line 3.2.7');
let covered = 0, pinnedSeen = 0;
for (let k = 0; k < 20; k++) {
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  const r = await page.evaluate(() => {
    const ta = document.querySelector('textarea.ed'), rows = [...document.querySelectorAll('.pins:not([hidden]) .pins-in')];
    if (!ta || !rows.length) return [0, 0];
    const bottom = Math.max(...rows.map((p) => p.getBoundingClientRect().bottom));
    return [Math.max(0, bottom - ta.getBoundingClientRect().top), rows[0].childElementCount];
  });
  covered = Math.max(covered, r[0]);
  pinnedSeen = Math.max(pinnedSeen, r[1]);
}
check(covered <= 1 && pinnedSeen >= 2, 'walking up with ArrowUp keeps it below the pinned rows (two levels pinned)', `${covered}px covered, ${pinnedSeen} rows`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await go(page, '#/page/Deep');
await sleep(400);

console.log('parents pinned at the top while scrolling (laptop)');
await sleep(300);
// scroll so that a note's top is `off` px below the top of the notes
const scrollTo = (text, off) => page.evaluate(([t, o]) => {
  const blk = [...document.querySelectorAll('.outline .blk')].find((b) => b.textContent.includes(t));
  const main = document.querySelector('#main');
  main.scrollTop += blk.getBoundingClientRect().top - main.getBoundingClientRect().top - o;
}, [text, off]);
await scrollTo('point 1.2.5', 5);
await sleep(250);
const pins = () => page.locator('.pin').allTextContents();
check((await pins()).join(' > ') === 'Chapter 1 > Section 1.2', 'the parents of the note at the top are pinned', (await pins()).join(' > '));
const pinTop = await page.evaluate(() => document.querySelector('.pins-in').getBoundingClientRect().top - document.querySelector('#main').getBoundingClientRect().top);
check(Math.abs(pinTop) <= 1, 'right at the top of the notes', pinTop);
await page.screenshot({ path: SHOTS + '/pins-laptop.png' });
await page.locator('.pin', { hasText: 'Chapter 1' }).click();
await sleep(250);
check((await pins()).length === 0 && await page.evaluate(() => {
  const blk = [...document.querySelectorAll('.outline .blk')].find((b) => b.textContent.startsWith('Chapter 1'));
  const r = blk.getBoundingClientRect(), m = document.querySelector('#main').getBoundingClientRect();
  return r.top >= m.top - 1 && r.top < m.top + 40;
}), 'clicking one goes to that note');
await scrollTo('Chapter 2', -5);
await sleep(250);
check((await pins()).length === 0, 'none for a note at the top level', (await pins()).join(' > '));
allErrors.push(...errors);
await browser.close();

// --------------------------------------------------------------------------------------------
({ browser, page, errors } = await open({ viewport: { width: 393, height: 851 }, touch: true }));
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function swipe(x0, y, dx) {
  await touch('touchStart', x0, y);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', x0 + dx * k / 8, y + k * 0.5); await sleep(16); }
  await touch('touchEnd');
  await sleep(1100);
}
const rowY = async (text) => { const b = await page.locator('.outline .blk', { hasText: text }).last().boundingBox(); return b.y + 14; };

console.log('phone: press and hold a link to preview its page');
await go(page, '#/page/Swipe');
await sleep(400);
const a = await page.locator('.outline a[data-page]').first().boundingBox();
await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2);
await sleep(650);
await touch('touchEnd');
await sleep(400);
check(await page.locator('.preview').isVisible() && (await page.locator('.preview .pop-title').textContent()).startsWith('Marta Pell'), 'holding it shows the page’s notes');
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Swipe' && !(await page.locator('textarea.ed').count()), 'without opening the page or starting to edit');
await page.screenshot({ path: SHOTS + '/preview-phone.png' });
await page.evaluate(() => window.leanApp.onBack());
await sleep(150);
check(!(await page.locator('.preview').isVisible()) && decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Swipe', 'Back closes it first');
await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2);
await sleep(650);
await touch('touchEnd');
await sleep(400);
// a tap elsewhere only closes it (that tap doesn't also open or edit what's under it)
const three = await page.locator('.outline .blk', { hasText: 'three' }).locator('.bc').boundingBox();
await page.touchscreen.tap(three.x + 20, three.y + 10);
await sleep(400);
check(!(await page.locator('.preview').isVisible()) && !(await page.locator('textarea.ed').count()), 'a tap elsewhere closes it without starting to edit there');
await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2);
await sleep(650);
await touch('touchEnd');
await sleep(400);
await page.locator('.preview [data-open]').tap();
await sleep(500);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Marta Pell', '"Open" opens the page');
await page.evaluate(() => history.back());
await sleep(600);

console.log('phone: swipe a note in or out a level');
await swipe(120, await rowY('two with'), 110);
check(read('pages/Swipe.md') === '- one\n\t- two with a [[Marta Pell]] link\n- three\n' && !(await page.locator('textarea.ed').count()), 'a swipe to the right moves it in, without opening the keyboard', read('pages/Swipe.md'));
await swipe(200, await rowY('two with'), -110);
check(read('pages/Swipe.md') === '- one\n- two with a [[Marta Pell]] link\n- three\n', 'a swipe to the left moves it out', read('pages/Swipe.md'));
await swipe(120, await rowY('three'), 30);
check(read('pages/Swipe.md') === '- one\n- two with a [[Marta Pell]] link\n- three\n', 'a short one does nothing');
await swipe(120, await rowY('one'), 110);
check(read('pages/Swipe.md').startsWith('- one\n'), 'the first note can’t move in (nothing above it)');
// a sideways start that turns into a scroll, or a swipe that's cancelled, moves nothing
async function arc(x0, y, dx, dy) {
  await touch('touchStart', x0, y);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', x0 + dx * k / 8, y + dy * k / 8); await sleep(16); }
  await touch('touchEnd');
  await sleep(1100);
}
await arc(120, await rowY('two with'), 110, 90);
check(read('pages/Swipe.md') === '- one\n- two with a [[Marta Pell]] link\n- three\n', 'a swipe that drifts up or down (a scroll) moves nothing', read('pages/Swipe.md'));
await swipe(120, await rowY('two with'), 110);
check(await page.locator('#toast').isVisible() && await page.locator('#toast .toast-act').textContent() === 'Undo', 'after a swipe the message offers Undo');
await page.locator('#toast .toast-act').tap();
await sleep(1100);
check(read('pages/Swipe.md') === '- one\n- two with a [[Marta Pell]] link\n- three\n', 'Undo puts it back', read('pages/Swipe.md'));
// typing in between: the message's Undo doesn't undo the typing (only the move would be undone)
await swipe(120, await rowY('two with'), 110);
await page.locator('.outline .blk', { hasText: 'three' }).locator('.bc').tap();
await page.waitForSelector('textarea.ed');
await page.keyboard.press('End');
await page.keyboard.type(' plus');
const tb = await page.evaluate(() => { const t = document.querySelector('#toast'), b = document.querySelector('#toolbar'); return t.hidden || b.hidden ? 0 : Math.max(0, t.getBoundingClientRect().bottom - b.getBoundingClientRect().top); });
check(tb === 0, 'the message sits above the phone’s editing toolbar', tb);
if (await page.locator('#toast .toast-act').isVisible()) await page.locator('#toast .toast-act').tap();
await sleep(1200);
check((await page.locator('textarea.ed').inputValue().catch(() => read('pages/Swipe.md'))).includes('three plus'), 'Undo from the message doesn’t take back typing done since');
await page.evaluate(() => window.leanApp.onBack()); // (stops editing)
await sleep(1200);
write('pages/Swipe.md', '- one\n- two with a [[Marta Pell]] link\n- three\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(600);
await swipe(44, await rowY('two with'), 110);
check(read('pages/Swipe.md') === '- one\n- two with a [[Marta Pell]] link\n- three\n' && await page.evaluate(() => document.body.classList.contains('drawer')), 'a swipe starting 44px from the edge opens the menu, and moves no note', read('pages/Swipe.md'));
await swipe(260, 420, -120);
await swipe(30, 420, 120);
check(await page.evaluate(() => document.body.classList.contains('drawer')), 'a swipe in from the left edge opens the menu');
await swipe(260, 420, -120);
check(!(await page.evaluate(() => document.body.classList.contains('drawer'))), 'a swipe to the left closes it');

console.log('phone: parents pinned under the top bar');
await go(page, '#/page/Deep');
await sleep(300);
await page.evaluate(() => {
  const blk = [...document.querySelectorAll('.outline .blk')].find((b) => b.textContent.includes('point 2.1.4'));
  window.scrollBy(0, blk.getBoundingClientRect().top - document.querySelector('#topbar').getBoundingClientRect().bottom - 5);
});
await sleep(250);
check((await pins()).join(' > ') === 'Chapter 2 > Section 2.1', 'the parents show', (await pins()).join(' > '));
const under = await page.evaluate(() => document.querySelector('.pins-in').getBoundingClientRect().top - document.querySelector('#topbar').getBoundingClientRect().bottom);
check(Math.abs(under) <= 1, 'right under the top bar', under);
await page.screenshot({ path: SHOTS + '/pins-phone.png' });
await page.locator('.outline .blk', { hasText: 'point 2.1.7' }).locator('.bc').tap();
await sleep(300);
check(!(await page.locator('.pins').isVisible()), 'not while typing (little room above the keyboard)');

console.log('phone: find from the page menu');
await page.evaluate(() => window.leanApp.onBack());
await page.evaluate(() => window.scrollTo(0, 0));
await page.locator('.title-row [data-a="more"]').tap();
await page.getByText('Find on this page').tap();
await sleep(200);
check(await page.locator('#findbar').isVisible(), 'the page menu has "Find on this page"');
const fb = await page.evaluate(() => document.querySelector('#findbar').getBoundingClientRect().top - document.querySelector('#topbar').getBoundingClientRect().bottom);
check(Math.abs(fb) <= 1, 'it sits under the top bar', fb);
await page.keyboard.type('point 2.3.8');
await sleep(400);
check(await page.locator('.fb-n').textContent() === '1 of 1', 'and finds', await page.locator('.fb-n').textContent());
await page.evaluate(() => window.leanApp.onBack());
await sleep(100);
check(!(await page.locator('#findbar').isVisible()), 'Back closes it');

allErrors.push(...errors);
check(!allErrors.length, 'no script errors', allErrors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

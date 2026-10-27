// The note menu and moving notes by their dot, on a laptop (Logseq's block menu and drag and drop):
// right-click a dot (or, while editing, the context-menu key / Shift+F10) for the menu; colours and
// headings written exactly as Logseq writes them; Cut / Copy / Copy as text / Delete with Undo;
// number lists (drawn 1. 2. 3., continued by Enter, ended by Enter on an empty one); the to-do state;
// Expand / Collapse all; right-click inside a selection acts on all of it. Dragging a dot moves a note
// with its children (a line shows where it goes; sideways in place indents or outdents it the Logseq
// way; dropped where it was: nothing; near the bottom edge the page scrolls; one Undo step). Every
// check of a file compares all of it, so untouched notes are proved byte for byte the same. The menu
// and the colours in every look.
import { open, read, write, check, failures, sleep, go, editBlock, SHOTS } from './lib.mjs';

const ID = '6528aaaa-bbbb-4ccc-8ddd-eeeeffff0001';
const ID2 = ID.replace('0001', '0002'), ID3 = ID.replace('0001', '0003');
const COLOURS = `- alpha\n- beta parent\n\t- beta child one\n\t\t- beta grandchild\n\t- beta child two\n- gamma\n- delta\n  id:: ${ID}\n- epsilon\n`;
write('pages/Colours.md', COLOURS);
const NUMBERS = `- first\n- second\n  id:: ${ID2}\n- third\n\t- inner\n- after\n`;
write('pages/Numbers.md', NUMBERS);
const CLIP = `- keep me\n- parent to cut\n\t- child to cut\n\t  collapsed:: false\n\t\t- grandchild\n- with an id\n  id:: ${ID3}\n  status:: done\n- last one\n`;
write('pages/Clip.md', CLIP);
const FOLDS = '- top\n\t- middle\n\t\t- bottom\n\t- leaf\n- other\n';
write('pages/Folds.md', FOLDS);
const DRAG = '- one\n- two\n\t- two kid\n- three\n\t- three a\n\t\t- three a deep\n\t- three b\n- four\n';
write('pages/Drag.md', DRAG);
write('pages/Long.md', Array.from({ length: 70 }, (_, k) => `- long note ${k + 1}\n`).join(''));
const LOOKS = ['plain', 'plainnight', 'calm', 'night', 'paper', 'sticker', 'stickernight', 'grimoire', 'automaton', 'azulejo'];

const { browser, page, errors } = await open();
const row = (t) => page.locator('.outline .blk', { has: page.locator(':scope > .bc', { hasText: t instanceof RegExp ? t : new RegExp('^' + t + '$') }) }).first();
const dot = (t) => row(t).locator(':scope > .bul');
const menu = page.locator('.note-menu');
const item = (label) => menu.locator('.nm-item', { has: page.locator('.nm-l', { hasText: new RegExp('^' + label + '$') }) });
const settle = () => sleep(1300); // (saving waits 0.8 s)
const clip = () => page.evaluate(() => navigator.clipboard.readText());
async function rightClick(t) {
  await dot(t).click({ button: 'right' });
  await page.waitForSelector('.note-menu', { timeout: 3000 }).catch(() => {});
}

// --------------------------------------------------------------------------------------------
console.log('right-click a dot: the menu');
await go(page, '#/page/Colours');
await rightClick('gamma');
const m1 = await page.evaluate(() => {
  const m = document.querySelector('.note-menu');
  return {
    role: m.getAttribute('role'), sw: [...m.querySelectorAll('.nm-colors button')].map((b) => b.dataset.c), heads: [...m.querySelectorAll('.nm-heads button')].map((b) => b.dataset.h),
    items: [...m.querySelectorAll('.nm-item .nm-l')].map((x) => x.textContent), focus: document.activeElement?.closest('.note-menu') === m,
    marked: [...document.querySelectorAll('.blk.menu-on > .bc')].map((b) => b.textContent),
    named: [...m.querySelectorAll('button')].every((b) => b.getAttribute('aria-label') || b.textContent.trim()),
  };
});
check(m1.role === 'menu' && m1.sw.join() === 'yellow,red,pink,green,blue,purple,gray,' && m1.heads.join() === '1,2,3,4,5,6,auto,0', 'a row of colours (Logseq’s, and none) and a row of headings (H1–H6, auto, none)', JSON.stringify(m1));
check(m1.items.join('|') === 'Select|Cut|Delete|Copy|Copy as text|Copy link to this note|Numbered list|Next to-do state', 'then Select, Cut, Delete, Copy, Copy as text, Copy link to this note, Numbered list, Next to-do state', m1.items.join('|'));
check(m1.focus && m1.named && m1.marked.join() === 'gamma', 'real buttons with names; the keyboard is in the menu; the note it’s for is marked', JSON.stringify(m1));
await page.keyboard.press('Escape');
await sleep(200);
check(await menu.count() === 0 && await page.locator('.blk.menu-on').count() === 0 && read('pages/Colours.md') === COLOURS, 'Esc closes it and changes nothing');
await rightClick('gamma');
await page.mouse.click(1200, 860); // (a click elsewhere)
await sleep(200);
check(await menu.count() === 0, 'a click elsewhere closes it');

console.log('colours, as Logseq writes them');
await rightClick('gamma');
await menu.locator('[data-c="yellow"]').click();
await settle();
check(read('pages/Colours.md') === COLOURS.replace('- gamma\n', '- gamma\n  background-color:: yellow\n'), 'yellow: background-color:: yellow under the note’s first line, nothing else changed', read('pages/Colours.md'));
const tint = await page.evaluate(() => { const b = [...document.querySelectorAll('.outline .bc')].find((x) => x.textContent === 'gamma'); return { bg: getComputedStyle(b).backgroundColor, props: !!b.querySelector('.props'), data: b.dataset.bg }; });
check(tint.data === 'yellow' && tint.bg !== 'rgba(0, 0, 0, 0)' && !tint.props, 'the note shows a pale tint, and no property line', JSON.stringify(tint));
await rightClick('delta');
check(await menu.locator('[data-c=""]').getAttribute('aria-checked') === 'true', 'a note without a colour: "none" is the one ticked');
await menu.locator('[data-c="gray"]').click();
await settle();
check(read('pages/Colours.md').includes(`- delta\n  id:: ${ID}\n  background-color:: gray\n`), 'grey is written "gray"; it goes after the note’s other properties', read('pages/Colours.md'));
await rightClick('gamma');
check(await menu.locator('[data-c="yellow"]').getAttribute('aria-checked') === 'true', 'the colour now is ticked');
await menu.locator('[data-c="red"]').click();
await settle();
check(read('pages/Colours.md').includes('- gamma\n  background-color:: red\n- delta'), 'another colour replaces it in place', read('pages/Colours.md'));
for (const t of ['gamma', 'delta']) { await rightClick(t); await menu.locator('[data-c=""]').click(); await sleep(150); }
await settle();
check(read('pages/Colours.md') === COLOURS, '"none" takes it out again: the file is as it was', read('pages/Colours.md'));
for (const c of ['pink', 'green', 'blue', 'purple']) { await rightClick('epsilon'); await menu.locator(`[data-c="${c}"]`).click(); await sleep(250); }
await settle();
check(read('pages/Colours.md') === COLOURS.replace('- epsilon\n', '- epsilon\n  background-color:: purple\n'), 'pink, green, blue, purple: each replaces the one before', read('pages/Colours.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Colours.md') === COLOURS.replace('- epsilon\n', '- epsilon\n  background-color:: blue\n'), 'Ctrl+Z undoes a colour', read('pages/Colours.md'));
await rightClick('epsilon');
await menu.locator('[data-c=""]').click();
await settle();

console.log('headings, as Logseq writes them');
await rightClick('alpha');
await menu.locator('[data-h="2"]').click();
await settle();
check(read('pages/Colours.md') === COLOURS.replace('- alpha\n', '- ## alpha\n'), 'H2: "## " at the start of the note', read('pages/Colours.md'));
await rightClick('alpha');
check(await menu.locator('[data-h="2"]').getAttribute('aria-checked') === 'true', 'the heading now is ticked');
await menu.locator('[data-h="auto"]').click();
await settle();
check(read('pages/Colours.md') === COLOURS.replace('- alpha\n', '- alpha\n  heading:: true\n'), 'auto heading: heading:: true, and the "#"s go', read('pages/Colours.md'));
check(await row('alpha').locator(':scope > .bc .h.h2').count() === 1, 'a top-level auto heading shows as a level-2 heading (as in Logseq)');
await rightClick('beta child one');
await menu.locator('[data-h="auto"]').click();
await settle();
check(await row('beta child one').locator(':scope > .bc .h.h3').count() === 1 && read('pages/Colours.md').includes('\t- beta child one\n\t  heading:: true\n\t\t- beta grandchild'), 'one level down, a level-3 one', read('pages/Colours.md'));
await rightClick('alpha');
await menu.locator('[data-h="6"]').click();
await settle();
check(read('pages/Colours.md').startsWith('- ###### alpha\n- beta parent'), 'H6 after auto: "###### " and no heading::', read('pages/Colours.md'));
for (const t of ['alpha', 'beta child one']) { await rightClick(t); await menu.locator('[data-h="0"]').click(); await sleep(200); }
await settle();
check(read('pages/Colours.md') === COLOURS, '"no heading" takes either away: the file is as it was', read('pages/Colours.md'));
await page.screenshot({ path: SHOTS + '/note-menu-laptop.png' });

console.log('the keyboard: Shift+F10 or the context-menu key while editing');
await editBlock(page, 'epsilon');
await page.keyboard.press('Shift+F10');
await page.waitForSelector('.note-menu', { timeout: 3000 }).catch(() => {});
const kb = await page.evaluate(() => ({ open: !!document.querySelector('.note-menu'), focus: document.activeElement?.textContent }));
check(kb.open && kb.focus === 'Select', 'Shift+F10 opens it for the note being edited, the keyboard on its first item', JSON.stringify(kb));
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
const f2 = await page.evaluate(() => document.activeElement?.textContent);
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowUp');
const f3 = await page.evaluate(() => document.activeElement?.dataset.h);
await page.keyboard.press('ArrowRight');
const f4 = await page.evaluate(() => document.activeElement?.dataset.h);
await page.keyboard.press('ArrowUp');
const f5 = await page.evaluate(() => document.activeElement?.dataset.c);
check(f2 === 'Delete' && f3 === '1' && f4 === '2' && f5 === 'red', 'arrow keys move through the items, and along the rows of headings and colours', JSON.stringify([f2, f3, f4, f5]));
await page.keyboard.press('Escape');
await sleep(200);
check(await menu.count() === 0 && await page.evaluate(() => document.activeElement?.matches('textarea.ed')), 'Esc closes it and the note is still being edited, with the keyboard');
await page.keyboard.press('ContextMenu');
await page.waitForSelector('.note-menu', { timeout: 3000 }).catch(() => {});
check(await menu.count() === 1, 'the context-menu key opens it too');
await item('Next to-do state').focus();
await page.keyboard.press('Enter');
await sleep(300);
check(await page.locator('textarea.ed').inputValue().catch(() => '') === 'TODO epsilon' && await page.evaluate(() => document.activeElement?.matches('textarea.ed')), 'Next to-do state from the keyboard: TODO, and typing goes on', await page.locator('textarea.ed').inputValue().catch(() => ''));
await page.keyboard.press('Shift+F10');
await page.waitForSelector('.note-menu', { timeout: 3000 }).catch(() => {});
await item('Next to-do state').click();
await sleep(200);
await page.keyboard.press('Escape');
await settle();
check(read('pages/Colours.md') === COLOURS.replace('- epsilon\n', '- DOING epsilon\n'), 'again: DOING', read('pages/Colours.md'));
await page.keyboard.press('Escape');

console.log('right-click in a selection: it acts on all the selected notes');
await editBlock(page, 'gamma');
await page.keyboard.press('Escape');
await page.keyboard.press('Shift+ArrowDown');
await sleep(150);
await rightClick('delta');
const selItems = await menu.locator('.nm-item .nm-l').allTextContents();
check(!selItems.includes('Select') && await page.locator('.blk.sel').count() === 2, 'the menu is for both (no Select: they’re selected already)', selItems.join('|'));
await menu.locator('[data-c="green"]').click();
await settle();
check(read('pages/Colours.md') === COLOURS.replace('- gamma\n', '- gamma\n  background-color:: green\n').replace(`  id:: ${ID}\n`, `  id:: ${ID}\n  background-color:: green\n`).replace('- epsilon', '- DOING epsilon'), 'both get the colour', read('pages/Colours.md'));
check(await page.locator('.blk.sel').count() === 2, 'and stay selected');
await page.keyboard.press('Control+z');
await settle();
check(!read('pages/Colours.md').includes('green'), 'one Ctrl+Z undoes it for both', read('pages/Colours.md'));
await page.keyboard.press('Escape');
await rightClick('gamma');
await item('Select').click();
await sleep(200);
check(await page.locator('.blk.sel').count() === 1 && await page.locator('.blk.sel > .bc', { hasText: 'gamma' }).count() === 1, '"Select" selects the note');
await page.keyboard.press('Escape');

// --------------------------------------------------------------------------------------------
console.log('number lists');
await go(page, '#/page/Numbers');
for (const t of ['first', 'second', 'third']) { await rightClick(t); await item('Numbered list').click(); await sleep(250); }
await settle();
const NUM = (t, ind = '') => `${ind}${t}\n${ind}  logseq.order-list-type:: number`;
check(read('pages/Numbers.md') === `${NUM('- first')}\n- second\n  id:: ${ID2}\n  logseq.order-list-type:: number\n${NUM('- third')}\n\t- inner\n- after\n`, 'Numbered list: logseq.order-list-type:: number (after an id:: already there)', read('pages/Numbers.md'));
const marks = () => page.evaluate(() => [...document.querySelectorAll('.outline .blk')].map((b) => (b.querySelector(':scope > .bul').dataset.n || '•') + ' ' + (b.querySelector(':scope > .bc')?.textContent ?? b.querySelector(':scope > .ed').value)).join(' | '));
check(await marks() === '1. first | 2. second | 3. third | • inner | • after', 'drawn 1. 2. 3. instead of dots', await marks());
await rightClick('first');
check(await item('Numbered list').getAttribute('aria-checked') === 'true', 'the menu shows it ticked');
await page.keyboard.press('Escape');
await rightClick('inner');
await item('Numbered list').click();
await sleep(400);
check(await marks() === '1. first | 2. second | 3. third | a. inner | • after', 'a number list inside one counts a. b. c. (as in Logseq)', await marks());
await editBlock(page, 'second');
await page.keyboard.press('Enter');
await page.keyboard.type('two and a half');
await page.keyboard.press('Escape');
await settle();
check(await marks() === '1. first | 2. second | 3. two and a half | 4. third | a. inner | • after' && read('pages/Numbers.md').includes(`logseq.order-list-type:: number\n${NUM('- two and a half')}\n- third`), 'Enter at the end of a numbered note: the new note is numbered too', await marks() + ' :: ' + read('pages/Numbers.md'));
await editBlock(page, 'two and a half');
await page.keyboard.press('Enter');
await sleep(200);
check(await marks() === '1. first | 2. second | 3. two and a half | 4.  | 5. third | a. inner | • after', 'an empty one gets the next number…', await marks());
await page.keyboard.press('Enter');
await sleep(300);
check(await marks() === '1. first | 2. second | 3. two and a half | •  | 1. third | a. inner | • after' && await page.evaluate(() => document.activeElement?.matches('textarea.ed')), '…and Enter on it ends the list: a dot again (the list after it starts again at 1), still editing', await marks());
await page.keyboard.press('Backspace');
await sleep(200);
await page.keyboard.press('Home');
await page.keyboard.press('Backspace');
await page.keyboard.press('Escape');
await settle();
check(await marks() === '1. first | 2. second | • two and a half | 1. third | a. inner | • after' && read('pages/Numbers.md').includes('- two and a half\n- third'), 'Backspace at the start of a numbered note: a dot again first (as in Logseq)', await marks() + ' :: ' + read('pages/Numbers.md'));
await editBlock(page, 'third');
await page.keyboard.press('Enter');
await page.keyboard.type('first kid');
await page.keyboard.press('Escape');
await settle();
check(await marks() === '1. first | 2. second | • two and a half | 1. third | a. first kid | b. inner | • after', 'Enter on a note with children: its new first child joins the number list below it (as in Logseq)', await marks());
// several selected notes, some numbered: Numbered list takes it off all of them (as in Logseq)
await editBlock(page, 'first');
await page.keyboard.press('Escape');
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await rightClick('second');
await item('Numbered list').click();
await settle();
check(read('pages/Numbers.md') === `- first\n- second\n  id:: ${ID2}\n- two and a half\n${NUM('- third')}\n${NUM('- first kid', '\t')}\n${NUM('- inner', '\t')}\n- after\n`, 'selected notes, some numbered: Numbered list takes it off all of them (as in Logseq)', read('pages/Numbers.md'));
await page.keyboard.press('Escape');

// --------------------------------------------------------------------------------------------
console.log('cut, copy, copy as text, delete');
await go(page, '#/page/Clip');
await rightClick('parent to cut');
await item('Copy').click();
await sleep(300);
check(await clip() === '- parent to cut\n\t- child to cut\n\t  collapsed:: false\n\t\t- grandchild', 'Copy: the note with its children, as Logseq bullets', JSON.stringify(await clip()));
await rightClick(/^with an id/); // (its words, then its property)
await item('Copy as text').click();
await sleep(300);
check(await clip() === '- with an id\n  status:: done', 'Copy as text: plain Markdown, without Logseq’s bookkeeping (the id)', JSON.stringify(await clip()));
await rightClick('parent to cut');
await item('Cut').click();
await settle();
check(read('pages/Clip.md') === `- keep me\n- with an id\n  id:: ${ID3}\n  status:: done\n- last one\n` && (await clip()).startsWith('- parent to cut\n\t- child to cut'), 'Cut: gone from the page (with its children), on the clipboard', read('pages/Clip.md'));
check(await page.locator('#toast .toast-act').textContent().catch(() => '') === 'Undo', 'the message offers Undo');
await page.locator('#toast .toast-act').click();
await settle();
check(read('pages/Clip.md') === CLIP, 'Undo puts it back, byte for byte', read('pages/Clip.md'));
await rightClick('last one');
await item('Delete').click();
await settle();
check(read('pages/Clip.md') === CLIP.replace('- last one\n', ''), 'Delete takes it away', read('pages/Clip.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Clip.md') === CLIP, 'Ctrl+Z brings it back', read('pages/Clip.md'));

// --------------------------------------------------------------------------------------------
console.log('expand all, collapse all');
await go(page, '#/page/Folds');
await rightClick('top');
check(await item('Collapse all').count() === 1 && await item('Expand all').count() === 1, 'a note with children: Expand all and Collapse all');
await item('Collapse all').click();
await settle();
check(read('pages/Folds.md') === '- top\n  collapsed:: true\n\t- middle\n\t  collapsed:: true\n\t\t- bottom\n\t- leaf\n- other\n', 'Collapse all: the note and each note under it that has children are folded', read('pages/Folds.md'));
check(await row('middle').isHidden(), 'its children are hidden');
await rightClick('top');
await item('Expand all').click();
await settle();
check(read('pages/Folds.md') === FOLDS && await row('bottom').isVisible(), 'Expand all: all open again, the file as it was', read('pages/Folds.md'));
await rightClick('other');
check(await item('Collapse all').count() === 0, 'a note without children: no Expand / Collapse all');
await page.keyboard.press('Escape');

// --------------------------------------------------------------------------------------------
console.log('dragging a note by its dot');
await go(page, '#/page/Drag');
const box = async (t) => (await row(t).locator(':scope > .bc').boundingBox());
// drag t's dot to height toY, dx to the side; returns the line shown just before letting go
async function drag(t, toY, dx = 0) {
  const b = await dot(t).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(x + dx * k / 10, y + (toY - y) * k / 10); await sleep(16); }
  await sleep(120);
  const line = await page.evaluate(() => { const l = document.querySelector('.drop-line'); return l && !l.hidden ? { left: parseFloat(l.style.left), ghost: !!document.querySelector('.drag-ghost'), faded: document.querySelectorAll('.blk.dragging').length } : null; });
  await page.mouse.up();
  await settle();
  return line;
}
const below = async (t) => { const r = await box(t); return r.y + r.height - 3; };
const above = async (t) => { const r = await box(t); return r.y + 3; };
let line = await drag('four', await above('two'));
check(line && line.ghost && line.faded === 1, 'while dragging: a copy follows the pointer, the note fades, a line shows where it goes', JSON.stringify(line));
check(read('pages/Drag.md') === '- one\n- four\n- two\n\t- two kid\n- three\n\t- three a\n\t\t- three a deep\n\t- three b\n', 'dropped above "two": moved there (its line kept byte for byte)', read('pages/Drag.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Drag.md') === DRAG, 'Ctrl+Z puts it back (one step)', read('pages/Drag.md'));
await drag('two', await below('four'));
check(read('pages/Drag.md') === '- one\n- three\n\t- three a\n\t\t- three a deep\n\t- three b\n- four\n- two\n\t- two kid\n', 'a note with children: they move with it', read('pages/Drag.md'));
await page.keyboard.press('Control+z');
await settle();
await drag('one', await below('three a deep'), 3 * 24);
check(read('pages/Drag.md') === '- two\n\t- two kid\n- three\n\t- three a\n\t\t- three a deep\n\t\t\t- one\n\t- three b\n- four\n', 'how far right decides: three levels right of where it was, a child of the note above', read('pages/Drag.md'));
await page.keyboard.press('Control+z');
await settle();
await drag('one', await below('three a deep'), 24);
check(read('pages/Drag.md') === '- two\n\t- two kid\n- three\n\t- three a\n\t\t- three a deep\n\t- one\n\t- three b\n- four\n', 'never shallower than the note below the line: a little right, at the level of "three b" below it', read('pages/Drag.md'));
await page.keyboard.press('Control+z');
await settle();
const before = read('pages/Drag.md');
line = await drag('three', await above('three') + 4, 0);
check(line === null && read('pages/Drag.md') === before, 'dropped where it was: no line, and nothing changes', read('pages/Drag.md'));
await drag('four', await above('four') + 4, 26);
check(read('pages/Drag.md') === '- one\n- two\n\t- two kid\n- three\n\t- three a\n\t\t- three a deep\n\t- three b\n\t- four\n', 'dragged right in its own place: indented (a child of the note above)', read('pages/Drag.md'));
await drag('four', await above('four') + 4, -26);
check(read('pages/Drag.md') === DRAG, 'dragged left in place: out again', read('pages/Drag.md'));
await drag('three a', await above('three a') + 4, -26);
check(read('pages/Drag.md') === '- one\n- two\n\t- two kid\n- three\n- three a\n\t- three a deep\n\t- three b\n- four\n', 'dragged left in place, the Logseq way: the notes after it at its level become its children', read('pages/Drag.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Drag.md') === DRAG, 'Ctrl+Z puts it all back', read('pages/Drag.md'));
{ // Esc while dragging: nothing moves
  const b = await dot('one').boundingBox();
  await page.mouse.move(b.x + 7, b.y + 7);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(b.x + 7, b.y + 7 + 20 * k); await sleep(16); }
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  check(read('pages/Drag.md') === DRAG && await page.locator('.drag-ghost, .drop-line, .blk.dragging').count() === 0, 'Esc while dragging puts it back');
}
await dot('two').click();
await sleep(600);
check(await page.evaluate(() => location.hash.startsWith('#/zoom/')), 'a plain click on a dot still opens the note on its own');
await page.evaluate(() => history.back());
await sleep(600);
// selected notes move together
await editBlock(page, 'one');
await page.keyboard.press('Escape');
await page.keyboard.press('Shift+ArrowDown');
await sleep(100);
await drag('one', await below('four'));
check(read('pages/Drag.md') === '- three\n\t- three a\n\t\t- three a deep\n\t- three b\n- four\n- one\n- two\n\t- two kid\n' && await page.locator('.blk.sel').count() === 3, 'selected notes move together, and stay selected', read('pages/Drag.md'));
await page.keyboard.press('Control+z');
await settle();
await page.keyboard.press('Escape');
// zoomed in on a note: its notes move among themselves, and never out of it
check(read('pages/Drag.md') === DRAG, '(the page as it was)', read('pages/Drag.md'));
await dot('three').click();
await sleep(700);
await drag('three b', await above('three a'));
check(read('pages/Drag.md') === '- one\n- two\n\t- two kid\n- three\n\t- three b\n\t- three a\n\t\t- three a deep\n- four\n', 'zoomed in on a note: its notes move among themselves', read('pages/Drag.md'));
line = await drag('three b', await above('three b') + 4, -60);
const top0 = await row('three').boundingBox();
await drag('three a', top0.y - 30);
check(line === null && read('pages/Drag.md') === '- one\n- two\n\t- two kid\n- three\n\t- three b\n\t- three a\n\t\t- three a deep\n- four\n', 'and never out of it (far left, or above the zoomed note: nothing)', read('pages/Drag.md'));
await page.keyboard.press('Control+z');
await settle();
await page.evaluate(() => history.back());
await sleep(700);
check(read('pages/Drag.md') === DRAG, 'Ctrl+Z there too', read('pages/Drag.md'));
// a plain note dropped right after a numbered one joins its list (as in Logseq)
write('pages/Drag.md', '- one\n  logseq.order-list-type:: number\n- two\n  logseq.order-list-type:: number\n- loose\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(700);
await drag('loose', await below('one'));
check(read('pages/Drag.md') === '- one\n  logseq.order-list-type:: number\n- loose\n  logseq.order-list-type:: number\n- two\n  logseq.order-list-type:: number\n', 'a plain note dropped into a number list joins it (as in Logseq)', read('pages/Drag.md'));

console.log('dragging near the bottom edge scrolls');
await go(page, '#/page/Long');
const main = page.locator('#main');
const b0 = await dot('long note 1').boundingBox();
await page.mouse.move(b0.x + 7, b0.y + 7);
await page.mouse.down();
for (let k = 1; k <= 10; k++) { await page.mouse.move(b0.x + 7, b0.y + 7 + (893 - b0.y) * k / 10); await sleep(16); }
await sleep(900);
const st = await main.evaluate((m) => m.scrollTop);
await page.mouse.move(b0.x + 7, 450);
await sleep(100);
await page.mouse.up();
await settle();
const lines = read('pages/Long.md').split('\n');
check(st > 200 && lines[0] !== '- long note 1' && lines.includes('- long note 1'), 'the notes scroll while the pointer is near the bottom, and the note goes where it’s dropped', `${st} ${lines.indexOf('- long note 1')}`);

console.log('in the Journals list: within one day');
await go(page, '#/journals');
await sleep(500);
const days = page.locator('.sheet.day');
const todayFile = await page.evaluate(() => document.querySelector('.sheet.day .page-title').textContent);
const jRow = (t) => days.first().locator('.blk', { has: page.locator(':scope > .bc', { hasText: t }) }).first();
const jb = await jRow('submit market').locator(':scope > .bul').boundingBox();
const other = await days.nth(1).locator('.blk > .bc').first().boundingBox();
await page.mouse.move(jb.x + 7, jb.y + 7);
await page.mouse.down();
for (let k = 1; k <= 10; k++) { await page.mouse.move(jb.x + 7, jb.y + 7 + (other.y + 6 - jb.y - 7) * k / 10); await sleep(16); }
await sleep(120);
const offDay = await page.evaluate(() => document.querySelector('.drop-line')?.hidden ?? true);
await page.mouse.up();
await settle();
check(offDay && read(`Diary/${todayFile}.md`).includes('- DONE submit market order\n- Meeting notes'), 'below the window’s edge (the next day out of sight): no line, and letting go there changes nothing (moving to another day: t15_drag)', read(`Diary/${todayFile}.md`));
await main.evaluate((m) => { m.scrollTop = 0; }); // (that drag went near the bottom edge: the list scrolled)
await sleep(200);
const jb2 = await jRow('submit market').locator(':scope > .bul').boundingBox();
const tgt = await jRow('Reading').locator(':scope > .bc').boundingBox();
await page.mouse.move(jb2.x + 7, jb2.y + 7);
await page.mouse.down();
for (let k = 1; k <= 10; k++) { await page.mouse.move(jb2.x + 7, jb2.y + 7 + (tgt.y + 2 - jb2.y - 7) * k / 10); await sleep(16); }
await sleep(120);
await page.mouse.up();
await settle();
check(read(`Diary/${todayFile}.md`).startsWith('- DONE submit market order\n- Reading'), 'within the day: moved to the top', read(`Diary/${todayFile}.md`));

// --------------------------------------------------------------------------------------------
console.log('every look: the colours and the menu');
await go(page, '#/page/Colours');
await rightClick('gamma');
await menu.locator('[data-c="blue"]').click();
await settle();
const looks = [];
for (const id of LOOKS) {
  await page.evaluate((s) => window.leanApp.setSkin(s), id);
  await rightClick('gamma');
  looks.push(await page.evaluate((s) => {
    const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const b = [...document.querySelectorAll('.outline .bc')].find((x) => x.textContent === 'gamma');
    const m = document.querySelector('.note-menu');
    const sw = [...m.querySelectorAll('.nm-sw:not(.nm-none)')].map((x) => getComputedStyle(x).backgroundColor);
    const it = m.querySelector('.nm-item');
    return { s, tint: getComputedStyle(b).backgroundColor, swatches: new Set(sw).size, solid: sw.every((c) => rgb(c).length === 3 || rgb(c)[3] === 1),
      ink: getComputedStyle(it).color !== getComputedStyle(m).backgroundColor };
  }, id));
  if (id === 'night' || id === 'paper') await page.screenshot({ path: `${SHOTS}/note-menu-${id}.png` });
  await page.keyboard.press('Escape');
}
const bad = looks.filter((l) => !(l.tint !== 'rgba(0, 0, 0, 0)' && l.swatches === 7 && l.solid && l.ink));
check(looks.length === LOOKS.length && !bad.length, 'in every look the note’s tint shows, the 7 swatches are distinct solid colours, the menu’s words show', JSON.stringify(bad));
await page.evaluate(() => window.leanApp.setSkin('calm'));

console.log('a heading on a to-do with no words keeps the lines under it');
const heads = await page.evaluate(async () => {
  const { withHeading } = await import('/editor.js');
  return [['TODO\nid:: 6528aaaa', 2], ['DONE\nSCHEDULED: <2026-10-27 Tue>', 1], ['TODO\tbuy milk', 2], ['TODO ## old', 0], ['## \nid:: x', 2], ['LATER read\nid:: z', 1]].map(([t, n]) => withHeading(t, n));
});
check(JSON.stringify(heads) === JSON.stringify(['TODO ##\nid:: 6528aaaa', 'DONE #\nSCHEDULED: <2026-10-27 Tue>', 'TODO\t## buy milk', 'TODO old', '##\nid:: x', 'LATER # read\nid:: z']), 'the id::, SCHEDULED and tab stay where they were', JSON.stringify(heads));

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

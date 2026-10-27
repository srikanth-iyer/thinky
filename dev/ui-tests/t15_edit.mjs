// Writing and editing (Build 29), as Logseq 0.10.9 does it: more "/" commands (block reference with
// its "((" search and the target's id::, Link, Upload a file, Number list / children, Underline,
// H4–H6, CANCELED); Ctrl+A (the words, the note, its parent, all) and Ctrl+Shift+A; typing pairs
// (wrapping selected words, closing brackets, stepping over them, Backspace taking both, IME and
// AltGr untouched); pasting formatted words from a web page, Google Docs and Word (Ctrl+Shift+V:
// plain); "Copy page as text…" (Text / OPML / HTML, options, clipboard, file); on a phone the "+"
// button, the toolbar's "/" and its date menu. Every check of a file compares all of it, so
// untouched notes are proved byte for byte the same.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { open, read, write, exists, check, failures, sleep, go, editBlock, SHOTS, BASE, VAULT } from './lib.mjs';

const ID = '6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666'; // (Notes on Pell's "A block with an id", make_vault.py)
const PELL = read('pages/Notes on Pell.md');
const TARGETS = '- zebra crossing rules\n  status:: draft\n- plain note\n';
write('pages/Targets.md', TARGETS);
write('pages/Commands.md', '- one\n');
write('pages/Kids.md', '- parent\n\t- kid a\n\t- kid b\n\t\t- grandkid\n');
const SEL = '- top\n\t- middle\n\t\t- bottom note\n- other top\n';
write('pages/Sel.md', SEL);
write('pages/Pairs.md', '- \n');
write('pages/Paste.md', '- \n');
const EXPORT = 'tags:: demo\n\n- TODO first **bold** with [[Links]]\n  status:: done\n  id:: 6528aaaa-bbbb-4ccc-8ddd-eeeeffff7777\n\t- child [site](https://example.com)\n\t\t- grandchild\n- second\n- one\n  logseq.order-list-type:: number\n- two\n  logseq.order-list-type:: number\n';
write('pages/Export.md', EXPORT);
const settle = () => sleep(1300); // (saving waits 0.8 s)
const today = () => { const d = new Date(); const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };

const { browser, page, errors } = await open();
await page.evaluate(() => window.leanApp.rescan()); // (the pages written above, in the index for "((" search)
const ta = page.locator('textarea.ed');
const val = () => ta.inputValue();
const sel = () => ta.evaluate((t) => [t.selectionStart, t.selectionEnd]);
const ac = page.locator('#ac');
const acItems = () => page.evaluate(() => (document.querySelector('#ac').hidden ? [] : [...document.querySelectorAll('#ac li')].map((l) => l.firstChild?.textContent?.trim() ?? l.textContent.trim())));
// (the "((" list: each note's words, then its page)
async function slash(q, pick = null) {
  await page.keyboard.type('/' + q, { delay: 15 });
  await sleep(150);
  if (pick) await page.locator('#ac li', { hasText: pick }).first().click();
  else await page.keyboard.press('Enter');
  await sleep(250);
}
// a page written afresh, read again by the app (its index too: rescan) and drawn
async function fresh(file, text = '- \n') {
  write(file, text);
  await page.evaluate(() => window.leanApp.rescan());
  await page.evaluate((n) => window.leanApp.go('page', n), file.replace(/^pages\//, '').replace(/\.md$/, ''));
  await sleep(500);
}
async function editLast() {
  const bcs = page.locator('.outline .blk > .bc');
  await bcs.last().click();
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('End');
}

// --------------------------------------------------------------------------------------------
console.log('the / menu: Logseq’s commands that were missing');
await fresh('pages/Commands.md', '- one\n');
await editLast();
await page.keyboard.press('Enter');
await page.keyboard.type('/', { delay: 15 });
await sleep(200);
const all = await acItems();
const want = ['Block reference', 'Link…', 'Image link…', 'Upload a file…', 'Underline', 'Heading 4', 'Heading 5', 'Heading 6', 'CANCELED', 'Number list', 'Number children', 'Today', 'Tomorrow', 'Yesterday', 'Current time'];
check(want.every((w) => all.includes(w)) && all.length > 30, 'they are all there, the whole list (it scrolls)', JSON.stringify(all));
const scrolls = await ac.evaluate((el) => el.scrollHeight > el.clientHeight);
check(scrolls, 'the list scrolls rather than stopping at 12');
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace');
for (const [q, label] of [['image', 'Image…'], ['h4', 'Heading 4'], ['canc', 'CANCELED'], ['number ch', 'Number children'], ['block ref', 'Block reference'], ['url', 'Link…'], ['asset', 'Upload a file…'], ['date picker', 'Date…']]) {
  await page.keyboard.type('/' + q, { delay: 10 });
  await sleep(150);
  const got = await acItems();
  check(got[0] === label, `“/${q}” finds ${label} (also by Logseq’s name for it)`, JSON.stringify(got));
  if (got.length) await page.keyboard.press('Escape'); // (closes the list; with none, Esc would stop typing)
  for (let k = 0; k <= q.length; k++) await page.keyboard.press('Backspace');
}
await page.keyboard.type('fifth level');
await page.keyboard.press('Home');
await slash('h5');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await slash('canceled');
await page.keyboard.type('dropped idea');
await page.keyboard.press('Enter');
await page.keyboard.type('under ');
await slash('underline');
await page.keyboard.type('lined');
const ul = await sel();
await page.keyboard.press('Escape');
await settle();
check(read('pages/Commands.md') === '- one\n- ##### fifth level\n- CANCELED dropped idea\n- under <ins>lined</ins>\n', 'H5, CANCELED and Underline (<ins>…</ins>, the caret inside) written as Logseq writes them', read('pages/Commands.md'));
check(ul[0] === 'under <ins>lined'.length, 'Underline leaves the caret between the tags', JSON.stringify(ul));
const look = await page.evaluate(() => {
  const bcs = [...document.querySelectorAll('.outline .blk > .bc')];
  const b = (t) => bcs.find((x) => x.textContent.includes(t));
  return { h5: !!b('fifth level').querySelector('.h5'), cancel: b('dropped idea').closest('.blk').classList.contains('marker-done') && b('dropped idea').textContent.includes('CANCELED'),
    ins: b('lined').querySelector('ins')?.textContent, raw: b('lined').textContent.includes('<ins>') };
});
check(look.h5 && look.cancel && look.ins === 'lined' && !look.raw, 'they show as a heading, a cancelled to-do and underlined words', JSON.stringify(look));

console.log('Number list and Number children');
await fresh('pages/Kids.md', '- parent\n\t- kid a\n\t- kid b\n\t\t- grandkid\n');
await editBlock(page, 'parent');
await page.keyboard.press('Home');
await slash('number children');
await settle();
check(read('pages/Kids.md') === '- parent\n\t- kid a\n\t  logseq.order-list-type:: number\n\t- kid b\n\t  logseq.order-list-type:: number\n\t\t- grandkid\n', 'Number children numbers the note’s sub-notes one level down', read('pages/Kids.md'));
check(await page.evaluate(() => [...document.querySelectorAll('.bul.num')].map((b) => b.dataset.n).join()) === '1.,2.', 'drawn 1. 2.');
await page.keyboard.press('Home');
await slash('number children');
await settle();
check(read('pages/Kids.md') === '- parent\n\t- kid a\n\t- kid b\n\t\t- grandkid\n', 'again: back to dots', read('pages/Kids.md'));
await page.keyboard.press('Home');
await slash('number list');
await settle();
check(read('pages/Kids.md') === '- parent\n  logseq.order-list-type:: number\n\t- kid a\n\t- kid b\n\t\t- grandkid\n', 'Number list numbers the note itself', read('pages/Kids.md'));
check(await val() === 'parent', 'and the property stays out of the editing box');
await page.keyboard.press('Home');
await slash('number list');
await page.keyboard.press('Escape');
await settle();
check(read('pages/Kids.md') === '- parent\n\t- kid a\n\t- kid b\n\t\t- grandkid\n', 'again: a dot again', read('pages/Kids.md'));

console.log('Link: an address and a label');
await fresh('pages/Commands.md', '- see \n');
await editLast();
await slash('link…', 'Link…');
await page.waitForSelector('.modal');
const boxLook = await page.evaluate(() => [...document.querySelectorAll('.modal label')].map((l) => l.textContent.trim()).join('|'));
check(boxLook.startsWith('Address|Label'), 'a small box asks for the address and a label', boxLook);
await page.keyboard.type('https://logseq.com/docs');
await page.keyboard.press('Enter');
await page.keyboard.type('the docs');
await page.keyboard.press('Enter');
await sleep(250);
check(await val() === 'see [the docs](https://logseq.com/docs)' && await page.evaluate(() => document.activeElement?.matches('textarea.ed')), '[label](address) at the caret, and typing goes on in the note', await val());
await page.keyboard.type(' and ');
await slash('link…', 'Link…');
await page.waitForSelector('.modal');
await page.keyboard.type('www.example.org');
await page.locator('.modal [data-v="1"]').click();
await sleep(250);
check(await val() === 'see [the docs](https://logseq.com/docs) and https://www.example.org', 'no label: just the address (www. gets https://)', await val());
await page.keyboard.type(' ');
await slash('link…', 'Link…');
await page.waitForSelector('.modal');
await page.keyboard.press('Escape');
await sleep(200);
check(await val() === 'see [the docs](https://logseq.com/docs) and https://www.example.org ' && await ta.count() === 1, 'Esc: nothing added, still typing', await val());
await page.keyboard.type(' ');
await slash('image link', 'Image link…');
await page.waitForSelector('.modal');
await page.keyboard.type('https://upload.wikimedia.org/x.png');
await page.keyboard.press('Enter');
await page.keyboard.type('a picture');
await page.keyboard.press('Enter');
await sleep(250);
check(await val() === 'see [the docs](https://logseq.com/docs) and https://www.example.org  ![a picture](https://upload.wikimedia.org/x.png)', 'Image link: ![label](address), shown as the picture', await val());
await ta.fill('see [the docs](https://logseq.com/docs)'); // (no picture to fetch from the web here)
await page.keyboard.press('Escape');
await settle();

console.log('Upload a file');
await fresh('pages/Commands.md', '- attached: \n');
await editLast();
const chooser = page.waitForEvent('filechooser');
await slash('upload', 'Upload a file…');
const fc = await chooser;
check(fc.isMultiple() && !(await fc.element().getAttribute('accept')), 'any file, several at once');
await fc.setFiles([{ name: 'Report [final].pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test\n') }, { name: 'tiny.png', mimeType: 'image/png', buffer: fs.readFileSync(VAULT + '/assets/dot.png') }]);
await sleep(900);
const up = await val();
const pdf = up.match(/\[Report final\.pdf\]\(\.\.\/assets\/(Report__final_\d+\.pdf)\)/);
const png = up.match(/!\[tiny\]\(\.\.\/assets\/(tiny_\d+\.png)\)/);
check(pdf && png && exists('assets/' + pdf[1]) && exists('assets/' + png[1]), 'each is copied into assets/ (Logseq’s names) and linked as the capture box does: a file as [name](…), a picture as ![name](…)', up);
await page.keyboard.press('Escape');
await settle();
const upView = await page.evaluate(() => { const b = document.querySelector('.outline .blk > .bc'); return { file: b.textContent.includes('Report final.pdf'), img: !!b.querySelector('img') }; });
check(upView.file && upView.img, 'the file shows by its name, the picture as a picture', JSON.stringify(upView));

console.log('Block reference: "((" finds a note, the note gets an id:: the Logseq way');
await fresh('pages/Commands.md', '- see \n');
await editLast();
await slash('block ref', 'Block reference');
check(await val() === 'see (())' && (await sel())[0] === 6, '/Block reference writes (( )) with the caret inside', await val());
await sleep(150);
check((await ac.textContent()).includes('Type words'), 'the list says to type words from the note');
await page.keyboard.type('zebra cross', { delay: 20 });
await sleep(500);
const hits = await acItems();
check(hits[0] === 'zebra crossing rules' && (await ac.textContent()).includes('Targets'), 'the matching notes, with their page', JSON.stringify(hits));
await page.keyboard.press('Enter');
await sleep(800);
const v1 = await val();
const newId = v1.match(/^see \(\(([0-9a-f-]{36})\)\)$/)?.[1];
check(!!newId && (await sel())[0] === v1.length, 'the note’s id goes between the brackets, the caret after them', v1);
await page.keyboard.press('Escape');
await settle();
check(read('pages/Targets.md') === `- zebra crossing rules\n  status:: draft\n  id:: ${newId}\n- plain note\n`, 'the note gets id:: under its first line, after its other properties; nothing else in its file changes', read('pages/Targets.md'));
const shown = await page.evaluate(() => { const r = document.querySelector('.outline .bref'); return r && { text: r.textContent, page: r.dataset.page, line: r.dataset.line }; });
check(shown?.text === 'zebra crossing rules' && shown.page === 'Targets', 'the reference shows the note’s words', JSON.stringify(shown));
await page.locator('.outline .bref').click();
await sleep(600);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/zoom/Targets/0' && (await page.locator('.outline .blk:not([hidden]) > .bc').first().textContent()).includes('zebra'), 'a click on it opens that note');
// a note with an id already: its id, its file untouched; typed straight in with "(("
await fresh('pages/Commands.md', '- again \n');
await editLast();
await page.keyboard.type('((', { delay: 30 });
check(await val() === 'again (())', 'typing (( makes (( )) too', await val());
await page.keyboard.type('block with an', { delay: 20 });
await sleep(500);
await page.keyboard.press('Enter');
await sleep(600);
check(await val() === `again ((${ID}))`, 'a note with an id:: already: that id', await val());
await page.keyboard.press('Escape');
await settle();
check(read('pages/Notes on Pell.md') === PELL, 'and its file isn’t touched');
// a note on the page being typed in: changed there (Undo, its own save)
await fresh('pages/Commands.md', '- local target note\n- refer \n');
await editLast();
await page.keyboard.type('((local targ', { delay: 20 });
await sleep(500);
check((await acItems())[0] === 'local target note', 'notes on this page are found too (not the one being typed in)', JSON.stringify(await acItems()));
await page.keyboard.press('Enter');
await sleep(600);
const lid = (await val()).match(/\(\(([0-9a-f-]{36})\)\)/)?.[1];
await page.keyboard.press('Escape');
await settle();
check(!!lid && read('pages/Commands.md') === `- local target note\n  id:: ${lid}\n- refer ((${lid}))\n`, 'its id:: is added on this page and saved with it', read('pages/Commands.md'));
await page.keyboard.press('Escape');

console.log('block references never rewrite another note or file (review)');
const WEIRD = '- weird id note probe\n  id:: custom-123\n- other\n';
const PARA = 'Just a paragraph about paragraph probe.\n\nAnother paragraph here.\n\n- a bullet after the paragraph probe\n';
const OBS = '* obsidian star bullet probe\n* second star\n    * deeper star\n';
const CRLF = '\ufefftitle:: Crlf target\r\n\r\n- first   note  with  spaces\r\n\t- kid of first\r\n- crlf alpha target\r\n  status:: x\r\n\t- its kid\r\n- last note no newline';
write('pages/Weird id.md', WEIRD);
write('pages/Para target.md', PARA);
write('pages/Obs target.md', OBS);
write('pages/Crlf target.md', CRLF);
write('pages/Slow target.md', '- slow target words\n');
write('pages/Maths target.md', '- an x marks the spot\n');
await fresh('pages/Commands.md', '- start\n');
await editLast();
await page.keyboard.type(' ((weird id note', { delay: 15 });
await sleep(500);
await page.keyboard.press('Enter');
await sleep(800);
const weirdMsg = await page.locator('#toast').textContent();
check(read('pages/Weird id.md') === WEIRD && weirdMsg.includes('custom-123') && (await val()).includes('((weird id note))'), 'a note with an id:: of its own that Logseq can’t use (not a UUID): never replaced; it says so and adds nothing', weirdMsg);
await ta.fill('start ');
await page.keyboard.type('((paragraph probe', { delay: 15 });
await sleep(500);
check(JSON.stringify(await acItems()) === JSON.stringify(['a bullet after the paragraph probe']), 'plain paragraphs (before a file’s first bullet) aren’t offered: adding an id would make them bullets', JSON.stringify(await acItems()));
await page.keyboard.press('Enter');
await sleep(800);
const pid = (await val()).match(/\(\(([0-9a-f-]{36})\)\)/)?.[1];
await page.keyboard.press('Escape');
await settle();
check(!!pid && read('pages/Para target.md') === PARA.replace('- a bullet after the paragraph probe\n', `- a bullet after the paragraph probe\n  id:: ${pid}\n`), 'a bullet after them can be referred to; the paragraphs stay as they were', JSON.stringify(read('pages/Para target.md')));
await editLast();
await ta.fill('start ');
await page.keyboard.type('((obsidian star', { delay: 15 });
await sleep(500);
check((await ac.textContent()).includes('No note has these words') && read('pages/Obs target.md') === OBS, '"* " bullets (Obsidian) aren’t offered either', await ac.textContent());
await ta.fill('start ');
await page.keyboard.type('((crlf alpha', { delay: 15 });
await sleep(500);
await page.keyboard.press('Enter');
await sleep(800);
const cid = (await val()).match(/\(\(([0-9a-f-]{36})\)\)/)?.[1];
check(!!cid && read('pages/Crlf target.md') === CRLF.replace('  status:: x\r\n', `  status:: x\r\n  id:: ${cid}\r\n`), 'a file with CRLF, a BOM, tabs and no last line break: only the id line is added', JSON.stringify(read('pages/Crlf target.md')));
// "((" right after a letter (maths), or one letter typed: no list, Enter makes a new note as usual
await ta.fill('');
await page.keyboard.type('f((x', { delay: 25 });
await sleep(500);
check(await ac.isHidden() && await val() === 'f((x)', '“f((x”: no list right after a letter or digit', await val());
await page.keyboard.press('Enter');
await sleep(300);
await ta.fill('');
await page.keyboard.type('see ((x', { delay: 25 });
await sleep(500);
check(await page.locator('#ac li[data-k]').count() === 0 && (await ac.textContent()).includes('Type words'), 'one letter: no notes yet, only what to do', await ac.textContent());
await page.keyboard.press('Enter');
await sleep(300);
await page.keyboard.press('Escape');
await settle();
const touched = fs.readdirSync(VAULT + '/pages').filter((f) => /^- an x marks the spot\n\s+id::/.test(read('pages/' + f)));
check(read('pages/Maths target.md') === '- an x marks the spot\n' && touched.length === 0, 'Enter there is a new note: no id:: written anywhere', JSON.stringify(touched));
// a single ")" left by the pair is taken in
await fresh('pages/Commands.md', '- start\n');
await editLast();
await page.keyboard.type(' +((slow targ', { delay: 20 });
check(await val() === 'start +((slow targ)', '(“+((”: the first "(" stays single, so one ")" follows)', await val());
await sleep(500);
await page.keyboard.press('Enter');
await sleep(900);
const sid = read('pages/Slow target.md').match(/id:: ([0-9a-f-]{36})/)?.[1];
check(!!sid && await val() === `start +((${sid}))`, 'picking a note takes that one ")" in: ((id)), not ((id)))', await val());
// the note typed in closed while the id was being saved: nothing goes into another note
write('pages/Slow target.md', '- another slow target\n');
await page.evaluate(() => window.leanApp.rescan());
await ta.fill('wait ');
await page.keyboard.type('((another slow', { delay: 20 });
await sleep(500);
await page.route('**/api/save', async (r) => { await sleep(1500); await r.continue(); });
await page.keyboard.press('Enter');
await sleep(150);
await page.keyboard.press('Escape');
await sleep(2200);
await page.unroute('**/api/save');
const slowMsg = await page.locator('#toast').textContent();
await settle();
check(slowMsg.includes('wasn’t added') && read('pages/Commands.md') === '- wait ((another slow))\n', 'the note was closed while the id was saved: the reference isn’t put anywhere else, and it says so', slowMsg + ' / ' + read('pages/Commands.md'));
await page.keyboard.press('Escape');

console.log('Ctrl+A: the words, the note, its parent, all; Ctrl+Shift+A: all');
// with today folded away in the Journals list, nothing hidden there gets selected (review)
await go(page, '#/journals');
await sleep(600);
await page.locator('.sheet.day .day-fold').first().click({ force: true });
await sleep(300);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Control+a');
await sleep(200);
const foldSel = await page.evaluate(() => ({ hidden: document.querySelectorAll('.sheet.day.folded .blk.sel').length, shown: document.querySelectorAll('.sheet.day:not(.folded) .blk.sel').length }));
check(foldSel.hidden === 0 && foldSel.shown > 0, 'today folded: Ctrl+A selects the notes of the first day that shows, none of the folded one', JSON.stringify(foldSel));
await page.keyboard.press('Escape');
await page.locator('.sheet.day .day-fold').first().click({ force: true });
await sleep(200);
await fresh('pages/Sel.md', SEL);
await editBlock(page, 'bottom note');
await page.keyboard.press('Control+a');
check(JSON.stringify(await sel()) === '[0,11]' && await ta.count() === 1, 'first: all the note’s words, still typing');
await page.keyboard.press('Control+a');
const selected = () => page.evaluate(() => [...document.querySelectorAll('.blk.sel > .bc')].map((b) => b.textContent).join('|'));
check(await ta.count() === 0 && await selected() === 'bottom note', 'again: the note itself', await selected());
await page.keyboard.press('Control+a');
check(await selected() === 'middle|bottom note', 'again: its parent (with its sub-notes)', await selected());
await page.keyboard.press('Control+a');
check(await selected() === 'top|middle|bottom note', 'again: the parent’s parent', await selected());
await page.keyboard.press('Control+a');
check(await selected() === 'top|middle|bottom note|other top', 'at the top: every note on the page', await selected());
await page.keyboard.press('Escape');
await editBlock(page, 'middle');
await page.keyboard.press('Control+Shift+A');
check(await ta.count() === 0 && await selected() === 'top|middle|bottom note|other top', 'Ctrl+Shift+A while typing: every note on the page', await selected());
await page.keyboard.press('Escape');
await page.mouse.click(1200, 600);
await page.keyboard.press('Control+Shift+A');
check(await selected() === 'top|middle|bottom note|other top', 'and with nothing being typed', await selected());
await page.keyboard.press('Escape');
await fresh('pages/Sel.md', '- top\n- \n');
await editLast();
await page.keyboard.press('Control+a');
check(await ta.count() === 0 && await page.locator('.blk.sel').count() === 1, 'an empty note: Ctrl+A selects it at once');
await page.keyboard.press('Escape');
check(read('pages/Sel.md') === '- top\n- \n', 'selecting changes nothing');

console.log('typing pairs, as Logseq');
await fresh('pages/Pairs.md');
await editLast();
const typed = async (keys) => { await ta.fill(''); await page.keyboard.type(keys, { delay: 15 }); await sleep(60); return [await val(), (await sel())[0]]; };
check(JSON.stringify(await typed('a (')) === JSON.stringify(['a ()', 3]), '"(" after a space comes with ")", the caret between');
check(JSON.stringify(await typed('a (x)')) === JSON.stringify(['a (x)', 5]), 'typing ")" before the ")" steps over it');
check(JSON.stringify(await typed('f(x)')) === JSON.stringify(['f(x)', 4]), '"(" right after a word stays single (as in Logseq)');
check(JSON.stringify(await typed('{')) === JSON.stringify(['{}', 1]) && JSON.stringify(await typed('{{x}}')) === JSON.stringify(['{{x}}', 5]), '"{" pairs, "{{x}}" types as it is');
check(JSON.stringify(await typed('a [')) === JSON.stringify(['a []', 3]), '"[" pairs');
check(JSON.stringify(await typed('[[Pag')) === JSON.stringify(['[[Pag]]', 5]) && await ac.isVisible(), '"[[" makes [[ ]] and the page list opens');
await page.keyboard.press('Escape');
check(JSON.stringify(await typed('[[Page]] ok')) === JSON.stringify(['[[Page]] ok', 11]), 'typing "]]" steps over both');
check(JSON.stringify(await typed('say `x` y')) === JSON.stringify(['say `x` y', 9]), '"`" pairs inside a line, the closing one stepped over');
check(JSON.stringify(await typed('say ``')) === JSON.stringify(['say ``', 6]) && JSON.stringify(await typed('say ```')) === JSON.stringify(['say ```', 7]), 'two backticks in a line give two, three give three (review)', await val());
await ta.fill('');
await page.keyboard.type('```', { delay: 20 });
await sleep(60);
check(await val() === '```\n```', '``` at the start of a line still makes a code block (as before)', await val());
check(JSON.stringify(await typed('"q"')) === JSON.stringify(['"q"', 3]), '" isn’t paired (Logseq doesn’t)');
await typed('a (');
await page.keyboard.press('Backspace');
check(await val() === 'a ', 'Backspace right after an opening bracket takes the pair', await val());
await typed('x []');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('Backspace');
check(await val() === 'x ', 'also "[]"', await val());
// words selected
const wrapped = async (k, times = 1) => {
  await ta.fill('one word here');
  await ta.evaluate((t) => t.setSelectionRange(4, 8));
  for (let n = 0; n < times; n++) await page.keyboard.type(k);
  await sleep(60);
  return [await val(), await ta.evaluate((t) => t.value.slice(t.selectionStart, t.selectionEnd))];
};
const W = {};
for (const [k, n] of [['*', 1], ['*', 2], ['_', 1], ['~', 2], ['^', 2], ['=', 2], ['(', 1], ['{', 1], ['`', 1], ['[', 2]]) W[k + n] = await wrapped(k, n);
check(W['*1'][0] === 'one *word* here' && W['*2'][0] === 'one **word** here' && W['*2'][1] === 'word', '"*" goes round selected words, which stay selected: twice is bold', JSON.stringify([W['*1'], W['*2']]));
check(W._1[0] === 'one _word_ here' && W['~2'][0] === 'one ~~word~~ here' && W['^2'][0] === 'one ^^word^^ here' && W['=2'][0] === 'one ==word== here', '"_" "~" "^" "=" too (twice: strikethrough, highlight)', JSON.stringify(W));
check(W['(1'][0] === 'one (word) here' && W['{1'][0] === 'one {word} here' && W['`1'][0] === 'one `word` here' && W['[2'][0] === 'one [[word]] here', 'brackets and backticks go round them too ("[" twice: a page link)', JSON.stringify(W));
// input methods and AltGr: a word being composed isn't touched; Ctrl+Alt letters aren't shortcuts
await ta.fill('');
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.imeSetComposition', { text: '(', selectionStart: 1, selectionEnd: 1 });
await cdp.send('Input.insertText', { text: '(' });
await sleep(80);
check(await val() === '(', 'a "(" from an input method (being composed) goes in as it is', await val());
await ta.fill('ą');
const altgr = await ta.evaluate((t) => {
  const e = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
  t.dispatchEvent(e);
  const f = new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
  t.dispatchEvent(f);
  return [e.defaultPrevented, f.defaultPrevented];
});
check(JSON.stringify(altgr) === '[false,false]' && await ta.count() === 1, 'AltGr (Ctrl+Alt) letters are left to the keyboard: no select-all, no shortcut', JSON.stringify(altgr));
await page.keyboard.type('{', { delay: 10 });
check(await val() === 'ą{}', 'a "{" typed after it (AltGr+7 on many keyboards comes as typed text) pairs as usual', await val());
await ta.fill('');
await page.keyboard.press('Escape');
await settle();

console.log('pasting formatted words: a web page, Google Docs, Word');
const paste = (html, text, opts = {}) => ta.evaluate((t, [h, x, o]) => {
  if (o.plain) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  const dt = new DataTransfer();
  if (x !== null) dt.setData('text/plain', x);
  if (h !== null) dt.setData('text/html', h);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  t.dispatchEvent(ev);
  if (!ev.defaultPrevented && x !== null) t.setRangeText(x, t.selectionStart, t.selectionEnd, 'end'), t.dispatchEvent(new Event('input')); // (what the browser does)
  return ev.defaultPrevented;
}, [html, text, opts]);
const WEB = `<meta charset='utf-8'><html><head><style>p { color: red }</style><script>window.bad = 1</script></head><body><!--StartFragment--><h2 style="font-weight: 700; color: rgb(0,0,0)">Field notes</h2>
<p style="color: rgb(32, 33, 34); font-family: sans-serif">Some <b>bold</b>, <i>italic</i>, <s>old</s>, <code>x+1</code> and a <a href="https://en.wikipedia.org/wiki/Sourdough" title="SB">link</a>.<br>Second line<sup><a href="#cite-1">[1]</a></sup></p>
<!-- a comment --><ul><li>One<ul><li>One <strong>a</strong></li></ul></li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>
<blockquote><p>Quoted words</p></blockquote><pre><code>let x = 1;\n  y();</code></pre><p style="display:none">hidden</p><!--EndFragment--></body></html>`;
await fresh('pages/Paste.md');
await editLast();
await paste(WEB, 'Field notes\nSome bold…');
await sleep(400);
await page.keyboard.press('Escape');
await settle();
const webWant = '- ## Field notes\n- Some **bold**, *italic*, ~~old~~, `x+1` and a [link](https://en.wikipedia.org/wiki/Sourdough).\n  Second line[1]\n- One\n\t- One **a**\n- Two\n- First\n  logseq.order-list-type:: number\n- Second\n  logseq.order-list-type:: number\n- > Quoted words\n- ```\n  let x = 1;\n    y();\n  ```\n';
check(read('pages/Paste.md') === webWant, 'a web page: heading, links, bold, italics, strikethrough, code, line breaks, nested and numbered lists, a quote and a code block, each a note; styles, scripts, comments and hidden words dropped', read('pages/Paste.md'));
check(await page.evaluate(() => window.bad) === undefined, 'nothing in it runs');
const GDOCS = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-6c0e3f4b-7fff-a1b2-c3d4"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Bold start</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;font-style:normal;text-decoration:none;white-space:pre-wrap;">, then </span><span style="font-size:11pt;font-weight:400;font-style:italic;text-decoration:none;white-space:pre-wrap;">italic</span><span style="font-weight:400;white-space:pre-wrap;"> and </span><a href="https://www.google.com/" style="text-decoration:none;"><span style="font-size:11pt;color:#1155cc;font-weight:400;font-style:normal;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;white-space:pre-wrap;">a link</span></a></p><br /><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-weight:400;white-space:pre-wrap;">Item one</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;" aria-level="2"><p dir="ltr" role="presentation"><span style="font-weight:400;white-space:pre-wrap;">Nested item</span></p></li></ul><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-weight:400;text-decoration:line-through;white-space:pre-wrap;">Struck</span></p></li></ul><h3 dir="ltr" style="line-height:1.38;margin-top:16pt;margin-bottom:4pt;"><span style="font-size:13.999999999999998pt;color:#434343;font-weight:400;white-space:pre-wrap;">A Docs heading</span></h3></b>';
await fresh('pages/Paste.md');
await editLast();
await paste(GDOCS, 'Bold start, then italic and a link\nItem one');
await sleep(400);
await page.keyboard.press('Escape');
await settle();
check(read('pages/Paste.md') === '- **Bold start**, then *italic* and [a link](https://www.google.com/)\n- Item one\n\t- Nested item\n- ~~Struck~~\n- ### A Docs heading\n', 'Google Docs: its bold and italics (written as styles), its link, its nested list (written in its own way) and heading; its “not bold” wrapper ignored', read('pages/Paste.md'));
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=Generator content="Microsoft Word 15"><style><!--
 /* Style Definitions */ p.MsoNormal {margin:0in; font-size:11.0pt;} @list l0:level1 {mso-level-number-format:bullet;}
--></style><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head><body lang=EN-US style='tab-interval:.5in'><!--StartFragment-->
<h1>Heading One<o:p></o:p></h1>
<p class=MsoNormal>Some <b>bold</b> and <i>italic</i> words and a <a href="https://example.com/">link</a>, <b style='mso-bidi-font-weight:normal'>still bold</b>.<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>First item<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:1.0in;mso-add-space:auto;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";mso-fareast-font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Nested item<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Second item<o:p></o:p></p>
<p class=MsoListParagraph style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-bidi-font-family:Calibri'><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Numbered one<o:p></o:p></p>
<!--EndFragment--></body></html>`;
await fresh('pages/Paste.md');
await editLast();
await paste(WORD, 'Heading One\nSome bold…');
await sleep(400);
await page.keyboard.press('Escape');
await settle();
check(read('pages/Paste.md') === '- # Heading One\n- Some **bold** and *italic* words and a [link](https://example.com/), **still bold**.\n- First item\n\t- Nested item\n- Second item\n- Numbered one\n  logseq.order-list-type:: number\n', 'Word: heading, bold, italics and link; its lists (paragraphs with hidden bullets) as nested and numbered notes; its styles, comments and empty lines dropped', read('pages/Paste.md'));
// one paragraph: into the note, at the caret
await fresh('pages/Paste.md', '- before  after\n');
await editLast();
await ta.evaluate((t) => t.setSelectionRange(7, 7));
check(await paste('<meta charset="utf-8"><span style="font-weight:700;color:#333">bold words</span> and <a href="https://x.org/a">x</a>', 'bold words and x'), 'one paragraph’s words…');
check(await val() === 'before **bold words** and [x](https://x.org/a) after', '…go into the note at the caret', await val());
// Ctrl+Shift+V: plain words, as they are, in this note
await ta.fill('plain: ');
await paste(WEB, 'Field notes\n\nSome bold\n- One', { plain: true });
check(await val() === 'plain: Field notes\n\nSome bold\n- One' && await page.locator('.outline .blk').count() === 1, 'Ctrl+Shift+V puts the plain words in this note as they are', await val());
// a web address over selected words still makes a link
await ta.fill('read this now');
await ta.evaluate((t) => t.setSelectionRange(5, 9));
await paste('<a href="https://a.example/p">https://a.example/p</a>', 'https://a.example/p');
check(await val() === 'read [this](https://a.example/p) now', 'an address pasted over selected words still makes them a link', await val());
// a copy from a code editor (coloured lines, nothing more): plain, in this note, as before
await ta.fill('');
const vsc = '<meta charset="utf-8"><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Consolas, monospace;white-space: pre;"><div><span style="color: #569cd6;">const</span><span> a = 1;</span></div><div><span>call(a);</span></div></div>';
check(!(await paste(vsc, 'const a = 1;\ncall(a);')) && await val() === 'const a = 1;\ncall(a);' && await page.locator('.outline .blk').count() === 1, 'a code editor’s coloured lines: plain words in this note, as before', await val());
await ta.fill('');
const VSCODE = `<meta charset='utf-8'><div style="color: #cccccc;background-color: #1f1f1f;font-family: Consolas, 'Courier New', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;"><div><span style="color: #6a9955;font-style: italic;">// add two numbers</span></div><div><span style="color: #569cd6;">function</span><span style="color: #cccccc;"> add(a, b) {</span></div><div><span style="color: #cccccc;">    return a + b;</span></div><div><span style="color: #cccccc;">}</span></div></div>`;
const vsText = '// add two numbers\nfunction add(a, b) {\n    return a + b;\n}';
check(!(await paste(VSCODE, vsText)) && await val() === vsText && await page.locator('.outline .blk').count() === 1, 'VS Code with an italic comment: still plain words in this note, not notes (review)', await val());
const boxed = await page.evaluate(async (h) => (await import('./paste.js')).htmlToNotes('<p>Before</p>' + h.replace("<meta charset='utf-8'>", '')), VSCODE);
check(JSON.stringify(boxed.map((n) => n.text)) === JSON.stringify(['Before', '```\n' + vsText + '\n```']), 'such a box inside a longer copy: one code block, its lines as they were', JSON.stringify(boxed));
await page.keyboard.press('Escape');
await settle();

// several notes pasted into an empty zoomed-in note: they go under it, in view (review)
write('pages/Zoomed.md', '- top\n- \n- tail\n');
await page.evaluate(() => window.leanApp.rescan());
await page.evaluate(() => window.leanApp.go('zoom', 'Zoomed', { line: 1 }));
await sleep(700);
await page.locator('.outline .blk > .bc').first().click();
await page.waitForSelector('textarea.ed');
await paste('<p>one <b>pasted</b></p><p>two</p>', 'one pasted\ntwo');
await sleep(500);
const zoomedRows = await page.evaluate(() => [...document.querySelectorAll('.outline .blk:not([hidden]) > .bc, .outline .blk:not([hidden]) > textarea')].map((b) => b.value ?? b.textContent));
await page.keyboard.press('Escape');
await settle();
check(read('pages/Zoomed.md') === '- top\n- \n\t- one **pasted**\n\t- two\n- tail\n' && zoomedRows.length === 3, 'they become its sub-notes, and stay in view', JSON.stringify([read('pages/Zoomed.md'), zoomedRows]));

console.log('block references in a page’s linked references and in the preview (review)');
write('pages/Ref list.md', `- see ((${ID})) about [[Marta Pell]]\n`);
write('pages/Linker.md', '- go to [[Ref list]]\n');
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Marta%20Pell');
await sleep(800);
const inRefs = await page.evaluate(() => [...document.querySelectorAll('.refhit .bref')].map((b) => b.textContent));
check(inRefs.includes('A block with an id'), 'linked references show the words of the note a reference names', JSON.stringify(inRefs));
await go(page, '#/page/Linker');
await sleep(500);
await page.locator('.outline a[data-page="Ref list"]').hover();
await sleep(1500);
const inPreview = await page.evaluate(() => [...document.querySelectorAll('.preview .bref')].map((b) => b.textContent));
check(inPreview.includes('A block with an id'), 'so does the preview', JSON.stringify(inPreview));
await page.mouse.move(1200, 850);

console.log('Copy page as text…: Text, OPML, HTML');
await go(page, '#/page/Export');
await page.locator('.title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Copy page as text' }).click();
await page.waitForSelector('.modal.export');
const out = () => page.locator('.ex-out').inputValue();
check(await out() === 'tags:: demo\n- TODO first **bold** with [[Links]]\n  status:: done\n\t- child [site](https://example.com)\n\t\t- grandchild\n- second\n1. one\n2. two\n', 'Text: Logseq’s bullets with tabs, properties (not ids or number-list bookkeeping), numbered notes numbered', await out());
await page.locator('.ex-ind select').selectOption('spaces');
check((await out()).includes('\n  - child [site]') && (await out()).includes('\n    - grandchild'), 'Indentation: spaces', await out());
await page.locator('.ex-ind select').selectOption('none');
check(await out() === 'tags:: demo\nTODO first **bold** with [[Links]]\nstatus:: done\nchild [site](https://example.com)\ngrandchild\nsecond\none\ntwo\n', 'none: just the lines', await out());
await page.locator('.ex-ind select').selectOption('tabs');
await page.locator('[data-o="props"]').uncheck();
await page.locator('[data-o="plain"]').check();
check(await out() === '- TODO first **bold** with Links\n\t- child [site](https://example.com)\n\t\t- grandchild\n- second\n1. one\n2. two\n', 'without properties; [[links]] as plain words', await out());
await page.locator('[data-k="opml"]').click();
const opml = await out();
check(opml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">') && opml.includes('<title>Export</title>') && opml.includes('<outline text="TODO first **bold** with Links">\n      <outline text="child [site](https://example.com)">\n        <outline text="grandchild"/>\n      </outline>\n    </outline>') && opml.includes('<outline text="1. one"/>'), 'OPML: nested outlines, the indentation choice hidden', opml);
check(await page.locator('.ex-ind').isHidden(), '(indentation is for Text only)');
await page.locator('[data-o="props"]').check();
await page.locator('[data-k="html"]').click();
const htm = await out();
check(htm.startsWith('<p>tags:: demo</p>\n<ul>\n<li>TODO first <strong>bold</strong> with Links<br>status:: done\n<ul>\n<li>child <a href="https://example.com">site</a>') && htm.includes('<ol>\n<li>one\n</li>\n<li>two\n</li></ol>'), 'HTML: nested lists, numbered ones as <ol>, links and bold kept', htm);
await page.screenshot({ path: SHOTS + '/edit-export.png' });
await page.locator('[data-a="copy"]').click();
await sleep(300);
const clip = await page.evaluate(async () => { const it = (await navigator.clipboard.read())[0]; return { types: it.types, html: await (await it.getType('text/html')).text() }; });
check(clip.types.includes('text/html') && clip.html.includes('<strong>bold</strong>') && await page.locator('.modal.export').count() === 0, 'Copy: on the clipboard as formatted words (and its HTML as text); the box closes', JSON.stringify(clip.types));
// saved as a file (here the browser's download; the app on Windows shows its save dialog)
await page.locator('.title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Copy page as text' }).click();
await page.waitForSelector('.modal.export');
check(await page.locator('[data-k="html"]').getAttribute('aria-pressed') === 'true', 'it remembers the last choice');
await page.locator('[data-k="text"]').click();
await page.evaluate(() => { window.showSaveFilePicker = undefined; });
const dl = page.waitForEvent('download');
await page.locator('[data-a="save"]').click();
const d = await dl;
const saved = fs.readFileSync(await d.path(), 'utf8');
check(d.suggestedFilename() === 'Export.md' && saved.startsWith('tags:: demo\n- TODO first'), 'Save as file…: the text as a file named after the page', d.suggestedFilename());
await page.keyboard.press('Escape');
check(read('pages/Export.md') === EXPORT, 'the page itself is never changed');

// --------------------------------------------------------------------------------------------
console.log('looks: the / list, a block reference, the Link box (laptop)');
await fresh('pages/Commands.md', `- a reference to ((${ID})) here\n- \n`);
for (const lk of ['calm', 'plain', 'plainnight', 'paper']) {
  await page.evaluate((l) => window.leanApp.setSkin(l), lk);
  await editLast();
  await page.keyboard.type('/', { delay: 10 });
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}/edit-slash-${lk}.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('((pell', { delay: 10 });
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/edit-blockref-${lk}.png` });
  await page.keyboard.press('Escape');
  await ta.fill('');
  await page.keyboard.type('/link', { delay: 10 });
  await sleep(150);
  check((await acItems()).slice(0, 2).join('|') === 'Link…|Page link', `(${lk}) "/link": Link… first (names starting with what’s typed come first)`, JSON.stringify(await acItems()));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal');
  await page.screenshot({ path: `${SHOTS}/edit-linkbox-${lk}.png` });
  await page.keyboard.press('Escape');
  await ta.fill('');
  await page.keyboard.press('Escape');
  await sleep(150);
}
await page.evaluate(() => window.leanApp.setSkin('calm'));
check(errors.length === 0, 'no script errors (laptop)', errors.join('\n'));
await browser.close();

// --------------------------------------------------------------------------------------------
async function phone(look = 'calm', hash = '#/journals') {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + '/');
  await p.evaluate(([v, l]) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify(l)); }, [VAULT, look]);
  await p.goto(BASE + '/?t=' + Date.now() + hash);
  await p.waitForSelector('#main .view > *');
  await sleep(900);
  return { b, p, errs };
}
console.log('phone: the "+" button adds a note and opens the keyboard');
const TODAY = `Diary/${today()}.md`;
const day0 = read(TODAY);
let { b: pb, p, errs } = await phone();
const fab = p.locator('#addnote');
// today folded away: the "+" opens it, so the new note shows (review)
await p.locator('.sheet.day .day-fold').first().tap();
await sleep(300);
await fab.tap();
await sleep(400);
const foldPlus = await p.evaluate(() => ({ folded: document.querySelector('.sheet.day').classList.contains('folded'), shown: !!document.querySelector('textarea.ed')?.offsetParent }));
check(!foldPlus.folded && foldPlus.shown, 'today folded: the "+" opens it and the new note shows', JSON.stringify(foldPlus));
await p.locator('#toolbar .tb-pin').tap();
await sleep(1300);
const fr = await fab.boundingBox();
check(await fab.isVisible() && fr.width >= 44 && fr.height >= 44 && fr.x + fr.width <= 390 && fr.y + fr.height <= 844, 'a round "+" at the bottom of the Journals list, finger-sized', JSON.stringify(fr));
await p.screenshot({ path: SHOTS + '/edit-phone-fab.png' });
await fab.tap();
await sleep(400);
const fabEdit = await p.evaluate(() => ({ focus: document.activeElement?.matches('textarea.ed'), day: document.activeElement?.closest('.sheet')?.classList.contains('today'), last: !document.activeElement?.closest('.blk')?.nextElementSibling?.matches('.blk'), toolbar: !document.querySelector('#toolbar').hidden }));
check(fabEdit.focus && fabEdit.day && fabEdit.last && fabEdit.toolbar && !(await fab.isVisible()), 'a tap: a new note at the end of today, being typed in (the keyboard comes up), the toolbar instead of the "+"', JSON.stringify(fabEdit));
await p.keyboard.type('from the plus button');
await sleep(1300);
check(read(TODAY) === day0 + '- from the plus button\n', 'what’s typed is saved at the end of today’s journal', read(TODAY));
await p.locator('#toolbar .tb-pin').tap();
await sleep(300);
check(await fab.isVisible(), 'done typing: the "+" is back');
// the toolbar's "/" and date buttons
await fab.tap();
await sleep(400);
await p.locator('#toolbar [data-t="slash"]').tap();
await sleep(250);
check(await p.locator('textarea.ed').inputValue() === '/' && await p.locator('#ac').isVisible() && (await p.locator('#ac li').count()) > 30, 'the toolbar’s "/" opens the command list', await p.locator('textarea.ed').inputValue());
const rowH = await p.evaluate(() => Math.round(document.querySelector('#ac li').getBoundingClientRect().height));
check(rowH >= 44, 'its rows are finger-sized', rowH);
await p.keyboard.type('h2', { delay: 20 });
await sleep(150);
await p.locator('#ac li', { hasText: 'Heading 2' }).tap();
await sleep(250);
check(await p.locator('textarea.ed').inputValue() === '## ' && await p.evaluate(() => document.activeElement?.matches('textarea.ed')), 'typing after it filters the list; a tap runs the command, the keyboard stays', await p.locator('textarea.ed').inputValue());
await p.keyboard.type('Plans ');
await p.locator('#toolbar [data-t="date"]').tap();
await sleep(250);
const dm = await p.evaluate(() => ({ items: [...document.querySelectorAll('.pop.menu.tb-menu button')].map((b) => b.textContent), focus: document.activeElement?.matches('textarea.ed'), h: Math.round(document.querySelector('.pop.menu.tb-menu button')?.getBoundingClientRect().height ?? 0) }));
check(dm.items.join('|') === 'linkToday|linkTomorrow|linkYesterday|linkAnother day…|to-do dateScheduled…|Deadline…' && dm.focus && dm.h >= 44, 'the date button: a link to today, tomorrow, yesterday or another day, or the scheduled date / deadline (finger-sized; the keyboard stays)', JSON.stringify(dm));
await p.screenshot({ path: SHOTS + '/edit-phone-datemenu.png' });
await p.locator('.pop.menu.tb-menu button', { hasText: 'Tomorrow' }).tap();
await sleep(400);
const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
const tmrName = (() => { const n = tmr.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return tmr.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${tmr.getFullYear()}`; })();
check(await p.locator('textarea.ed').inputValue() === `## Plans [[${tmrName}]]`, 'Tomorrow: a link to tomorrow’s page', await p.locator('textarea.ed').inputValue());
const pics = p.waitForEvent('filechooser');
await p.locator('#toolbar [data-t="image"]').tap();
check((await (await pics).element().getAttribute('accept')) === 'image/*', 'the toolbar’s picture button still asks for pictures');
await p.locator('#toolbar [data-t="date"]').tap();
await sleep(250);
await p.locator('.pop.menu.tb-menu button', { hasText: 'Scheduled' }).tap();
await sleep(300);
check(await p.locator('.pop.datepick').count() === 1, 'Scheduled…: the date picker, as the button did before');
await p.keyboard.press('Escape');
await p.locator('#toolbar .tb-pin').tap();
await sleep(1300);
// on a page: at its end; an empty last note is used, not doubled
await go(p, '#/page/Kids');
await fab.tap();
await sleep(400);
await p.keyboard.type('new last');
await p.locator('#toolbar .tb-pin').tap();
await sleep(1300);
check(read('pages/Kids.md') === '- parent\n\t- kid a\n\t- kid b\n\t\t- grandkid\n- new last\n', 'on a page: a new note at its end, at the top level', read('pages/Kids.md'));
await go(p, '#/page/Sel');
const selBefore = read('pages/Sel.md');
await fab.tap();
await sleep(400);
check(await p.locator('.outline .blk').count() === 2 && await p.evaluate(() => document.activeElement?.closest('.blk')?.dataset.i) === '1', 'an empty note at the end: that one is used');
await p.locator('#toolbar .tb-pin').tap();
await sleep(1300);
check(read('pages/Sel.md') === selBefore, 'and nothing is added', read('pages/Sel.md'));
await go(p, '#/settings');
check(!(await fab.isVisible()), 'no "+" where there are no notes (Settings)');
for (const lk of ['calm', 'plain', 'plainnight', 'paper']) {
  await p.evaluate((l) => window.leanApp.setSkin(l), lk);
  await go(p, '#/page/Kids');
  await p.screenshot({ path: `${SHOTS}/edit-phone-fab-${lk}.png` });
}
// the Copy box at phone size
await p.locator('.title-row [data-a="more"]').tap();
await p.locator('.pop.menu button', { hasText: 'Copy page as text' }).tap();
await p.waitForSelector('.modal.export');
const exBox = await p.evaluate(() => { const r = document.querySelector('.modal.export').getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, save: !!document.querySelector('.modal.export [data-a="save"]'), kinds: Math.round(document.querySelector('.ex-kinds .btn').getBoundingClientRect().height) }; });
check(exBox.fits && exBox.kinds >= 44, 'phone: the Copy box fits the screen, its buttons finger-sized', JSON.stringify(exBox));
await p.screenshot({ path: SHOTS + '/edit-phone-export.png' });
await p.keyboard.press('Escape');
check(errs.length === 0, 'no script errors (phone)', errs.join('\n'));
await pb.close();
// a narrow window without a touch screen: no "+"; the same on Android (whose emulator may say it has a
// mouse rather than a touch screen): the "+" (review)
for (const android of [false, true]) {
  const b2 = await chromium.launch();
  const p2 = await (await b2.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  if (android) await p2.addInitScript(() => { window.LeanAndroid = { hasAllFilesAccess: () => true, setBarColors() {}, setWidgetColors() {}, setWidgetTasks() {}, setWidgetConfig() {}, setCaptureConfig() {}, refreshWidget() {} }; });
  await p2.goto(BASE + '/');
  await p2.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
  await p2.goto(BASE + '/?t=' + Date.now() + '#/journals');
  await p2.waitForSelector('#main .view > *');
  await sleep(900);
  check(await p2.locator('#addnote').isVisible() === android, android ? 'Android: the "+" shows (even without a touch screen reported)' : 'a narrow laptop window without a touch screen: no "+"');
  await b2.close();
}

console.log(failures() ? `${failures()} FAILED` : 'all passed');
process.exit(failures() ? 1 : 0);

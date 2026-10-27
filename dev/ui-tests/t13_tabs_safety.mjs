// Two sides and his notes: a clash waiting on one side survives a rename or delete started on the other;
// typing that can't be saved is kept in logseq/bak when a side closes; the same page on both sides
// never clashes with his own words (one editing box at a time; a page opened on the other side shows
// what was just typed; a note typed in on one side and straight away on the other starts from the first
// side's words, also after Enter, a moved note or with a save on its way; a side that is editing shows
// the other side's change at once); a zoomed-in note stays put; a long page keeps its place and isn't
// drawn again; keys (Tab, Backspace, Ctrl+Z, a replace's Undo) act only on the side he is on; a clash
// that comes from the other side says so; choosing another notes folder closes the first folder's
// pages first. (Several of these began as probes of the independent reviews.)
import { open, read, write, check, failures, sleep, go, VAULT, DIR, BASE } from './lib.mjs';
import fs from 'node:fs';
const all = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map((f) => d + '/' + f).filter((f) => fs.statSync(f).isFile()) : []);
const kept = (s) => all(VAULT + '/logseq').some((f) => fs.readFileSync(f, 'utf8').includes(s));
let { browser, page, errors } = await open();
const allErrors = [];
const sideBySide = async (left, right) => {
  await go(page, '#/page/' + encodeURIComponent(left));
  await page.evaluate((p) => window.leanApp.tabs.open(p, 'side'), '#/page/' + encodeURIComponent(right));
  await sleep(900);
};
const typeIn = async (pane, text, add, esc = true) => {
  await page.locator(`${pane} .outline .blk > .bc`, { hasText: text }).first().click({ position: { x: 4, y: 6 } });
  await page.waitForSelector(`${pane} textarea.ed`);
  await page.keyboard.press('End');
  await page.keyboard.type(add);
  if (esc) await page.keyboard.press('Escape');
};
const clashOnRight = async (text, mine) => {
  await typeIn('#main2', text, mine, false);
  write('pages/Notes on Pell.md', read('pages/Notes on Pell.md').replace(text, text + ' THEIRS'));
  await sleep(1500);
  await page.locator('.clash [data-c="later"]').click();
  await sleep(300);
};
const rightKeeps = (mine) => page.evaluate((m) => !!document.querySelector('#main2 .banner:not([hidden]) [data-a="choose"]') && window.leanApp.outlines.some((o) => o.conflict && JSON.stringify(o.doc).includes(m)), mine);

console.log('a clash waiting on the right: renaming or deleting a page on the left waits');
await sideBySide('Marta Pell', 'Notes on Pell');
await clashOnRight('third block', ' MINE1');
/** the page menu's item on the left: refused, saying to choose first (no box to rename or confirm) */
const refused = async (item) => {
  await page.locator('#main .title-row [data-a="more"]').click();
  await page.locator('.pop.menu button', { hasText: item }).click();
  await sleep(500);
  return !(await page.locator('.modal-back').count()) && (await page.locator('#toast').textContent()).includes('First choose which version of “Notes on Pell”');
};
check(await refused('Rename') && await rightKeeps(' MINE1') && read('pages/Marta Pell.md').length > 0, 'Rename: it says to choose first; nothing renamed, the right side still holds his version');
await page.locator('#main').click({ position: { x: 6, y: 6 } });
await go(page, '#/page/Notes%20on%20Pell');
check(await refused('Delete page') && fs.existsSync(VAULT + '/pages/Notes on Pell.md') && await rightKeeps(' MINE1'), 'Delete (that same page): the same; not deleted, his version still there');
await page.locator('#main2 .banner [data-a="choose"]').click();
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
await browser.close();
allErrors.push(...errors);

console.log('closing a side with typing that couldn\'t be saved: a copy in logseq/bak');
({ browser, page, errors } = await open());
await sideBySide('Marta Pell', 'Rosa Penhallow');
await page.route('**/api/save', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the file is offline' }) }));
await typeIn('#main2', 'Baker', ' UNSAVED1');
await sleep(1500);
await page.locator('#main2 .title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Close this side' }).click();
await sleep(1200);
await page.unroute('**/api/save');
check(await page.locator('#main2').isHidden() && kept('UNSAVED1'), 'the side closed, and the typing is in logseq/bak');

console.log('the same page on both sides');
write('pages/Twice.md', '- one note\n- another note\n');
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Twice');
await typeIn('#main', 'one note', ' L1', false);
await page.locator('#main .title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Open to the side' }).click();
await page.waitForSelector('#main2 .outline .blk');
check((await page.locator('#main2 .outline .bc').first().textContent()).includes('L1'), 'opened on the other side straight after typing: it shows the words just typed');
await typeIn('#main2', 'one note', ' R1', false);
await sleep(1300);
check(await page.locator('textarea.ed').count() === 1, 'one editing box at a time (the left one closed when he went to the right)');
await page.locator('#main .outline .blk > .bc', { hasText: 'one note' }).click({ position: { x: 4, y: 6 } });
check((await page.locator('#main textarea.ed').inputValue()).includes('L1 R1'), 'back on the left: the note shows the change made on the right');
await page.keyboard.press('End');
await page.keyboard.type(' L2');
await page.keyboard.press('Escape');
await sleep(1500);
check(!(await page.locator('.clash').isVisible()) && read('pages/Twice.md').startsWith('- one note L1 R1 L2\n'), 'no clash with himself; every word in the file', read('pages/Twice.md'));

console.log('the same note typed in on the left, then straight away on the right (before the left saved)');
await typeIn('#main', 'another note', ' Q1', false); // (saved 0.8 s after the last key)
await typeIn('#main2', 'another note', ' Q2', false);
check(await page.locator('#main2 textarea.ed').inputValue() === 'another note Q1 Q2' && await page.locator('textarea.ed').count() === 1,
  'the right side’s editing box starts from the words just typed on the left (one box)', await page.locator('#main2 textarea.ed').inputValue());
await page.keyboard.press('Escape');
await sleep(1600);
check(!(await page.locator('.clash').isVisible()) && read('pages/Twice.md') === '- one note L1 R1 L2\n- another note Q1 Q2\n', 'no clash with himself; both in the file, in the order typed', read('pages/Twice.md'));
check((await page.locator('#main .outline .bc', { hasText: 'another note' }).textContent()).includes('Q1 Q2'), 'and the left shows it');
console.log('…and when the left made a new note first (it is saved first, then the right opens on the newer words)');
await typeIn('#main', 'one note', '', false);
await page.keyboard.press('Enter');
await page.keyboard.type('a new note');
await page.locator('#main2 .outline .blk > .bc', { hasText: 'another note' }).first().click({ position: { x: 4, y: 6 } });
check(await page.locator('#main2 textarea.ed').inputValue() === 'another note Q1 Q2' && read('pages/Twice.md').includes('- a new note\n'), 'the left’s new note was saved before the right’s box opened', read('pages/Twice.md'));
await page.keyboard.press('End');
await page.keyboard.type(' Q3');
await page.keyboard.press('Escape');
await sleep(1600);
check(!(await page.locator('.clash').isVisible()) && read('pages/Twice.md') === '- one note L1 R1 L2\n- a new note\n- another note Q1 Q2 Q3\n', 'no clash; both changes in the file', read('pages/Twice.md'));
const shows = (pane) => page.locator(`${pane} .outline .bc`).allTextContents().then((t) => t.join(' | '));
check((await shows('#main')).includes('Q3') && (await shows('#main2')).includes('a new note'), 'and each side shows both', JSON.stringify([await shows('#main'), await shows('#main2')]));
console.log('the right side editing (nothing new typed) when the left saves: it shows the change at once, the note still open');
await typeIn('#main2', 'one note', ' R5', false);
await sleep(1200); // (the right saved its typing; its editing box is still open)
await page.evaluate(() => { const o = window.leanApp.tabs.panes[0].outlines[0]; o.setText(o.blocks.findIndex((b) => b.text.startsWith('a new note')), (t) => t + ' L5'); }); // a change on the left, as a ticked to-do would be
await sleep(1500);
check(read('pages/Twice.md') === '- one note L1 R1 L2 R5\n- a new note L5\n- another note Q1 Q2 Q3\n', 'both saved', read('pages/Twice.md'));
check((await shows('#main2')).includes('a new note L5') && await page.locator('#main2 textarea.ed').inputValue() === 'one note L1 R1 L2 R5'
  && await page.evaluate(() => document.activeElement?.matches('#main2 textarea.ed')), 'the right shows the left’s change, its note still open for typing', await shows('#main2'));
await page.keyboard.type(' R6');
await page.keyboard.press('Escape');
await sleep(1500);
check(read('pages/Twice.md') === '- one note L1 R1 L2 R5 R6\n- a new note L5\n- another note Q1 Q2 Q3\n' && !(await page.locator('.clash').isVisible()), 'typing there goes on, no clash', read('pages/Twice.md'));

const leftActive = () => page.locator('#main').click({ position: { x: 6, y: 6 } });
const click = (pane, text) => page.locator(`${pane} .outline .blk > .bc`, { hasText: text }).first().click({ position: { x: 4, y: 6 } });
console.log('a save on its way (a slow disk) when he goes on in the same note on the other side');
write('pages/Slow.md', '- one note\n- another note\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Slow', 'Slow');
await page.route('**/api/save', async (r) => { await sleep(600); await r.continue(); });
await typeIn('#main', 'one note', ' A', false);
await sleep(950); // the left's save started (0.8 s after the last key) and is on its way
const inFlight = await page.evaluate(() => !!window.leanApp.tabs.panes[0].outlines.find((o) => o.name === 'Slow')?.saving);
await click('#main2', 'one note');
const fromA = await page.locator('#main2 textarea.ed').inputValue();
await page.keyboard.press('End');
await page.keyboard.type(' B');
await page.keyboard.press('Escape');
await sleep(3800);
await page.unroute('**/api/save');
check(inFlight && fromA === 'one note A', 'the right side’s box opens once the left’s save is in, on its words', JSON.stringify({ inFlight, fromA }));
check(!(await page.locator('.clash').isVisible()) && read('pages/Slow.md') === '- one note A B\n- another note\n', 'no clash with himself; both in the file', read('pages/Slow.md'));

console.log('a new note made on the left (Enter), then the same note clicked on the right half a second later');
write('pages/Split.md', '- one note\n- another note\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Split', 'Split');
await typeIn('#main', 'one note', ' X', false);
await page.keyboard.press('Enter');
await page.keyboard.type('Y');
await sleep(500);
await click('#main2', 'one note');
const fromX = await page.locator('#main2 textarea.ed').inputValue();
await page.keyboard.press('End');
await page.keyboard.type(' Z');
await page.keyboard.press('Escape');
await sleep(2500);
check(fromX === 'one note X', 'the right side starts from the words just typed on the left', fromX);
check(!(await page.locator('.clash').isVisible()) && read('pages/Split.md') === '- one note X Z\n- Y\n- another note\n', 'no clash with himself; every word in the file', read('pages/Split.md'));

console.log('a note moved up on the left, then another note clicked on the right straight away');
write('pages/Move.md', '- alpha\n- beta\n- gamma\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Move', 'Move');
await click('#main', 'gamma');
await page.keyboard.press('Control+Shift+ArrowUp'); // (moving a note up: his keys in the sample config.edn)
await sleep(100);
await click('#main2', 'beta');
const moved = await page.locator('#main2 textarea.ed').inputValue();
await page.keyboard.press('End');
await page.keyboard.type(' X');
await page.keyboard.press('Escape');
await sleep(2000);
check(moved === 'beta' && read('pages/Move.md') === '- alpha\n- gamma\n- beta X\n', 'the right side opens the note he clicked, and the words go there', JSON.stringify({ moved, file: read('pages/Move.md') }));

console.log('a note zoomed in on the right, a note added above it on the left');
write('pages/Zoomy.md', '- first\n- second\n\t- child of second\n- third\n\t- child of third\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await go(page, '#/page/Zoomy');
await page.evaluate(() => window.leanApp.tabs.open('#/zoom/Zoomy/3', 'side')); // ("third" is on file line 3)
await sleep(1000);
const zoomed = () => page.evaluate(() => [...document.querySelectorAll('#main2 .outline .bc')].map((b) => b.textContent).join(' | '));
const z0 = await zoomed();
await typeIn('#main', 'first', '', false);
await page.keyboard.press('Enter');
await page.keyboard.type('a new note above');
await page.keyboard.press('Escape');
await sleep(2000);
const z1 = await zoomed();
const zplace = await page.evaluate(() => { const T = window.leanApp.tabs; const t = T.tab(T.panes[1]); return decodeURIComponent(t.hist[t.at]); });
check(z0.startsWith('third') && z1.startsWith('third') && zplace === '#/zoom/Zoomy/4', 'after the left saved, the right still shows "third", and its tab says its new line', JSON.stringify({ z0, z1, zplace }));

console.log('one long page on both sides: typing on the left, the right keeps its place (and isn’t drawn again)');
let big = '';
for (let k = 0; k < 3000; k++) big += `${k % 5 ? '\t' : ''}- block ${k} with [[link ${k % 40}]] and **bold** text, #tag${k % 9}\n`;
write('pages/Big page.md', big);
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await go(page, '#/page/Big%20page');
await page.evaluate(() => window.leanApp.tabs.open('#/page/Big%20page', 'side'));
await page.waitForFunction(() => document.querySelectorAll('#main2 .outline .blk').length > 2900, null, { timeout: 30000 });
await sleep(800);
const topLine = (pane) => page.evaluate((s) => {
  const m = document.querySelector(s);
  const top = m.getBoundingClientRect().top;
  return [...m.querySelectorAll('.outline .blk')].find((b) => b.getBoundingClientRect().bottom > top + 2)?.querySelector('.bc')?.textContent.slice(0, 18);
}, pane);
await page.evaluate(() => { document.querySelector('#main2').scrollTop = 60000; });
await sleep(500);
const line0 = await topLine('#main2');
await page.evaluate(() => { const o = window.leanApp.tabs.panes[1].outlines[0]; const r = o.render.bind(o); window.__draws = 0; o.render = () => { window.__draws++; r(); }; });
await click('#main', 'block 3 ');
await page.keyboard.press('End');
await page.keyboard.type(' typed on the left');
await sleep(2500);
await page.keyboard.press('Escape');
await sleep(2500);
const line1 = await topLine('#main2');
const draws = await page.evaluate(() => window.__draws);
check(line1 === line0 && draws === 0 && read('pages/Big page.md').includes('block 3 with [[link 3]] and **bold** text, #tag3 typed on the left'),
  'the right side kept its place, and only the changed note was drawn again', JSON.stringify({ line0, line1, draws }));

console.log('typing on the left, then the right page’s menu → Find on this page, Esc, Ctrl+Z');
write('pages/Lefty.md', '- left note\n');
write('pages/Righty.md', '- right note\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Lefty', 'Righty');
await typeIn('#main', 'left note', ' typed', false);
await sleep(1500); // saved
await page.locator('#main2 .title-row [data-a="more"]').click();
await sleep(400);
await page.locator('.pop.menu button', { hasText: 'Find on this page' }).click();
await sleep(300);
await page.keyboard.type('right');
await sleep(300);
await page.keyboard.press('Escape');
await sleep(300);
const menuState = await page.evaluate(() => ({ leftEditing: window.leanApp.tabs.panes[0].outlines[0].cur !== null, active: window.leanApp.active?.name ?? null }));
await page.keyboard.press('Control+z');
await sleep(1500);
check(!menuState.leftEditing && !menuState.active && read('pages/Lefty.md') === '- left note typed\n', 'the left stopped editing when he went to the right, and Ctrl+Z there leaves it alone', JSON.stringify({ menuState, left: read('pages/Lefty.md') }));

console.log('Replace all on the left, then Ctrl+Z on the right');
write('pages/Lefty.md', '- apple pie\n- apple tart\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sleep(600);
await page.keyboard.press('Control+h');
await sleep(200);
await page.keyboard.type('apple');
await page.locator('#findbar .fb-r').fill('pear');
await page.locator('#findbar [data-f="all"]').click();
await sleep(1500);
const replaced = read('pages/Lefty.md');
await page.locator('#main2').click({ position: { x: 6, y: 300 } });
await sleep(300);
await page.keyboard.press('Control+z');
await sleep(1500);
check(replaced === '- pear pie\n- pear tart\n' && read('pages/Lefty.md') === replaced, 'the replace on the left stays (Ctrl+Z on the right isn’t for it)', JSON.stringify({ replaced, now: read('pages/Lefty.md') }));

console.log('if a change from the other side still clashes, it says where it came from; a clean merge says nothing');
write('pages/Words.md', '- the note\n- other note\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Words', 'Words');
/** the left's "Words" changes note k (not by typing there: as a ticked to-do would) */
const leftChanges = (k, add) => page.evaluate(([i, a]) => { const o = window.leanApp.tabs.panes[0].outlines.find((x) => x.name === 'Words'); o.setText(i, (t) => t + a); }, [k, add]);
await typeIn('#main2', 'the note', ' R', false); // (saved 0.8 s later)
await leftChanges(0, ' L'); // the same note changed on the left meanwhile
await page.locator('.clash').waitFor({ timeout: 8000 });
const said = await page.locator('.clash .cl-head .note').textContent();
check(said.includes('on the other side of this window') && !said.includes('your phone'), 'the clash screen says the change came from the other side of this window', said);
await page.locator('.clash [data-c="apply"], .clash [data-c="mine"]').first().click();
await sleep(4500); // (its message goes away)
const toasts = [];
await page.exposeFunction('noteToast', (t) => toasts.push(t));
await page.evaluate(() => new MutationObserver(() => { const t = document.querySelector('#toast'); if (t && !t.hidden) window.noteToast(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }));
await typeIn('#main2', 'other note', ' R2', false);
await leftChanges(0, ' L2');
await sleep(2500);
await page.keyboard.press('Escape');
await sleep(1200);
check(!(await page.locator('.clash').isVisible()) && /- the note .*L2\n- other note R2\n/.test(read('pages/Words.md')) && !toasts.some((t) => t.includes('elsewhere')), 'the two sides’ changes to different notes merge without a word', JSON.stringify({ file: read('pages/Words.md'), toasts }));

console.log('typed straight away while the note waits for the other side: the words, Enter and Tab go in as typed');
write('pages/Held.md', '- one note\n- another note\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Held', 'Held');
await page.route('**/api/save', async (r) => { await sleep(500); await r.continue(); });
await typeIn('#main', 'one note', ' X', false);
await page.keyboard.press('Enter');
await page.keyboard.type('Y');
await click('#main2', 'another note'); // (x 4: the caret at the start of the note)
const waiting = !(await page.locator('#main2 textarea.ed').count());
await page.keyboard.type('xyz');
await page.keyboard.press('Enter');
await page.keyboard.type('uvw');
await page.keyboard.press('Tab');
await page.keyboard.type('rst€{}@ ');
await page.evaluate(() => navigator.clipboard.writeText('pasted'));
await page.keyboard.press('Control+v');
await sleep(2800);
await page.keyboard.press('Escape');
await sleep(2000);
await page.unroute('**/api/save');
check(waiting && read('pages/Held.md') === '- one note X\n- Y\n- xyz\n\t- uvwrst€{}@ pastedanother note\n' && !(await page.locator('.clash').isVisible()),
  'the box opens once the left is saved; what he typed meanwhile went in: a new note at Enter, a level in at Tab, the € { } @ and the pasted words too', read('pages/Held.md'));
console.log('…and Backspace or Delete pressed first takes a whole letter (an emoji too)');
write('pages/Held2.md', '- smile 😀\n- 😀 grin\n- left side\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Held2', 'Held2');
await page.route('**/api/save', async (r) => { await sleep(500); await r.continue(); });
await typeIn('#main', 'left side', ' L', false);
await page.keyboard.press('Enter'); // (a new note: the right waits for the left's save)
await page.keyboard.type('M');
const smile = page.locator('#main2 .outline .blk > .bc', { hasText: 'smile' }).first();
await smile.click({ position: { x: (await smile.boundingBox()).width - 8, y: 6 } }); // (the end of the note)
await page.keyboard.press('Backspace');
await page.keyboard.type('!');
await sleep(2000);
await page.keyboard.press('Escape');
await sleep(1200);
await typeIn('#main', 'left side', '', false);
await page.keyboard.press('Enter');
await page.keyboard.type('P');
await click('#main2', 'grin'); // (the start of the note)
await page.keyboard.press('Delete');
await page.keyboard.type('ok');
await sleep(2000);
await page.keyboard.press('Escape');
await sleep(2000);
await page.unroute('**/api/save');
check(read('pages/Held2.md') === '- smile !\n- ok grin\n- left side L\n- P\n- M\n', 'the emoji went whole (no half a character in the file)', read('pages/Held2.md'));
console.log('…and a word made with an input method (Japanese): committed while waiting, or still being composed when the left is saved');
{
  const cdp = await page.context().newCDPSession(page);
  let ms = 1800;
  await page.route('**/api/save', async (r) => { await sleep(ms); await r.continue(); });
  const imeWait = async (name) => { // the left makes a new note, then the right's "another note" is clicked (the caret at its start)
    write(`pages/${name}.md`, '- one note\n- another note\n');
    await page.evaluate(() => window.leanApp.rescan());
    await leftActive();
    await sideBySide(name, name);
    await typeIn('#main', 'one note', ' X', false);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Y');
    await click('#main2', 'another note');
    return page.evaluate(() => !!document.activeElement?.matches('.ed-wait'));
  };
  const opened = () => page.locator('#main2 textarea.ed').waitFor({ timeout: 6000 }).then(() => true, () => false);
  // committed while the left is still being saved
  const box1 = await imeWait('Ime1');
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await sleep(150);
  await cdp.send('Input.insertText', { text: '日本' }); // (Space, then Enter: the input method commits the word)
  const waiting1 = !(await page.locator('#main2 textarea.ed').count());
  const open1 = await opened();
  await page.keyboard.press('Escape');
  await sleep(2500);
  // still being composed when the left is saved (the reviewer's probe): the note waits for the word
  ms = 1200;
  const box2 = await imeWait('Ime2');
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await sleep(2600); // (the left is saved by now)
  const waiting2 = !(await page.locator('#main2 textarea.ed').count());
  await cdp.send('Input.insertText', { text: '日本' });
  const open2 = await opened();
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await sleep(2500);
  await page.unroute('**/api/save');
  await cdp.detach();
  const st = { box1, waiting1, open1, box2, waiting2, open2, f1: read('pages/Ime1.md'), f2: read('pages/Ime2.md') };
  check(box1 && waiting1 && open1 && st.f1 === '- one note X\n- Y\n- 日本another note\n', 'committed while waiting: the word goes in once', JSON.stringify(st));
  check(box2 && waiting2 && open2 && st.f2 === '- one note X\n- Y\n- 日本!another note\n', 'still being composed: the note opens once it is committed; the word goes in once, as committed', JSON.stringify(st));
}

console.log('the app closes while a note waits for the other side, with words typed into it: saved first (or kept in logseq/bak)');
{
  const bakHas = (t) => { const d = VAULT + '/logseq/bak'; return fs.existsSync(d) && fs.readdirSync(d, { recursive: true }).some((f) => fs.statSync(d + '/' + f).isFile() && fs.readFileSync(d + '/' + f, 'utf8').includes(t)); };
  await page.route('**/api/save', async (r) => { await sleep(1200); await r.continue(); });
  const waitWith = async (name, words) => { // the left makes a new note, the right's "another note" is clicked, words typed meanwhile
    write(`pages/${name}.md`, '- one note\n- another note\n');
    await page.evaluate(() => window.leanApp.rescan());
    await leftActive();
    await sideBySide(name, name);
    await typeIn('#main', 'one note', ' X', false);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Y');
    await click('#main2', 'another note');
    const waits = await page.evaluate(() => !!document.activeElement?.matches('.ed-wait'));
    await page.keyboard.type(words);
    return waits;
  };
  // what closing the window does (lean-close); the app then quits at once, so the file is read straight away
  const c1 = await waitWith('Close1', 'TYPEDWHILEWAITING');
  const ok1 = await page.evaluate(async () => { window.leanApp.tabs.save(true); return window.leanApp.saveAll(); });
  const f1 = read('pages/Close1.md');
  await sleep(500);
  // a close that can't wait that long (here half a second): the words go to logseq/bak
  const c2 = await waitWith('Close2', 'KEPTWHENCLOSING');
  const ok2 = await page.evaluate(() => window.leanApp.saveAll(500));
  await sleep(300);
  const bak2 = bakHas('KEPTWHENCLOSING');
  await sleep(2500);
  // he goes elsewhere while it waits: the words go to logseq/bak too, and the message says so
  const c3 = await waitWith('Close3', 'CLICKEDAWAY');
  await leftActive();
  await sleep(2500);
  const said3 = await page.locator('#toast').textContent();
  await page.unroute('**/api/save');
  const st = { c1, ok1, f1, c2, ok2, bak2, f2: read('pages/Close2.md'), c3, bak3: bakHas('CLICKEDAWAY'), said3 };
  check(c1 && ok1 === true && f1 === '- one note X\n- Y\n- TYPEDWHILEWAITINGanother note\n', 'closing: the note opened, took the words and was saved before the app quit', JSON.stringify(st));
  check(c2 && ok2 === false && bak2 && !st.f2.includes('KEPTWHENCLOSING'), 'a close that can’t wait that long: the words are in logseq/bak (and it says not all is saved)', JSON.stringify(st));
  check(c3 && st.bak3 && said3.includes('CLICKEDAWAY') && said3.includes('logseq/bak'), 'he went elsewhere: the words are in logseq/bak, and the message says so', JSON.stringify(st));
}

console.log('the other side’s save hangs for a while: the note waits for it (no older copy opens), and says so');
write('pages/Hang.md', '- one note\n- another note\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Hang', 'Hang');
let hang = true;
await page.route('**/api/save', async (r) => { if (hang) { hang = false; await sleep(4500); } await r.continue(); }); // (only the first save)
await typeIn('#main', 'one note', ' X', false);
await page.keyboard.press('Enter');
await page.keyboard.type('Y');
await page.keyboard.press('Escape'); // (saved 0.3 s later: that save hangs)
await sleep(600);
await click('#main2', 'one note');
await sleep(2200);
const told = (await page.locator('#toast').isVisible()) && (await page.locator('#toast').textContent()).startsWith('Saving the other side first');
// another window takes the keyboard for a moment (the box loses it, and gets it back when he returns)
const away = await page.evaluate(() => { const b = document.querySelector('.ed-wait'); b?.dispatchEvent(new FocusEvent('blur')); return !!b && document.activeElement === b; });
await page.locator('#main2 textarea.ed').waitFor({ timeout: 8000 });
const fromHang = await page.locator('#main2 textarea.ed').inputValue();
await page.keyboard.press('End');
await page.keyboard.type(' Z');
await page.keyboard.press('Escape');
await sleep(2500);
await page.unroute('**/api/save');
check(told && away && fromHang === 'one note X' && read('pages/Hang.md') === '- one note X Z\n- Y\n- another note\n' && !(await page.locator('.clash').isVisible()),
  'it said it was saving the other side first, then opened on the newer words (another window meanwhile didn’t stop it); no clash, every word in the file', JSON.stringify({ told, away, fromHang, file: read('pages/Hang.md') }));

console.log('a zoomed-in note on the right, a second line added to a note above it on the left (Shift+Enter)');
write('pages/Zoomy2.md', '- first\n- second\n\t- child of second\n- third\n\t- child of third\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await go(page, '#/page/Zoomy2');
await page.evaluate(() => window.leanApp.tabs.open('#/zoom/Zoomy2/3', 'side'));
await sleep(1000);
const zplace2 = () => page.evaluate(() => { const T = window.leanApp.tabs; const t = T.tab(T.panes[1]); return decodeURIComponent(t.hist[t.at]); });
const zoomed2 = () => page.evaluate(() => [...document.querySelectorAll('#main2 .outline .bc')].map((b) => b.textContent).join(' | '));
await typeIn('#main', 'first', '', false);
await page.keyboard.press('Shift+Enter');
await page.keyboard.type('more words');
await page.keyboard.press('Escape');
await sleep(1500);
const zp = await zplace2(), zz = await zoomed2();
await page.locator('#main2').click({ position: { x: 6, y: 6 } });
await page.keyboard.press('Control+t');
await sleep(800);
await page.keyboard.press('Control+w');
await sleep(1200);
check(zz.startsWith('third') && zp === '#/zoom/Zoomy2/4' && (await zoomed2()).startsWith('third'), 'its tab says the new line of "third", so showing the tab again shows "third"', JSON.stringify({ zz, zp, again: await zoomed2() }));
console.log('…and the dot of a note below a note with a new line zooms into that note (one side, and on the other side)');
await page.locator('#main').click({ position: { x: 6, y: 6 } });
await go(page, '#/page/Zoomy2');
await sleep(600);
await page.locator('#main .outline .blk', { hasText: 'third' }).first().locator(':scope > .bul').click();
await sleep(1200);
const one = await page.evaluate(() => [...document.querySelectorAll('#main .outline .bc')].map((b) => b.textContent).join(' | '));
await go(page, '#/page/Zoomy2');
await page.locator('#main2').click({ position: { x: 6, y: 6 } });
await go(page, '#/page/Zoomy2');
await sleep(600);
await leftActive();
await typeIn('#main', 'second', '', false);
await page.keyboard.press('Shift+Enter');
await page.keyboard.type('and more');
await page.keyboard.press('Escape');
await sleep(1500);
await page.locator('#main2 .outline .blk', { hasText: 'third' }).first().locator(':scope > .bul').click();
await sleep(1200);
const two = await zoomed2();
check(one.startsWith('third') && two.startsWith('third'), 'the dot of "third" zooms into "third"', JSON.stringify({ one, two }));

console.log('typing that can’t be saved on a page open on both sides: rename waits, delete keeps a copy');
write('pages/Offline.md', '- a note\n');
await page.evaluate(() => window.leanApp.rescan());
await leftActive();
await sideBySide('Offline', 'Offline');
await page.route('**/api/save', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the file is offline' }) }));
await typeIn('#main2', 'a note', ' UNSAVED7');
await sleep(1500);
await leftActive();
await page.locator('#main .title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Rename' }).click();
await page.locator('.modal-back input').fill('Offline renamed');
await page.locator('.modal-back button', { hasText: 'Rename' }).click();
await sleep(1500);
const said7 = await page.locator('#toast').textContent();
check(fs.existsSync(VAULT + '/pages/Offline.md') && !fs.existsSync(VAULT + '/pages/Offline renamed.md') && said7.includes('couldn’t be saved'), 'rename refused while that typing couldn’t be saved (it says so)', said7);
await page.locator('#main .title-row [data-a="more"]').click();
await page.locator('.pop.menu button', { hasText: 'Delete page' }).click();
await page.locator('.modal-back button', { hasText: 'Delete' }).click();
await sleep(2000);
await page.unroute('**/api/save');
check(!fs.existsSync(VAULT + '/pages/Offline.md') && kept('UNSAVED7'), 'deleted; the typing that couldn’t be saved is in logseq/bak');

console.log('typing on the left while the right is scrolled (wheel, scroll bar, middle button): the typing goes on there');
{
  write('pages/Notes.md', '- my note\n');
  write('pages/Reading.md', Array.from({ length: 200 }, (_, k) => `- reading line ${k}${k ? '' : ' [[Linked]]'}\n`).join(''));
  await page.evaluate(() => window.leanApp.rescan());
  const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
  const b3 = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }); // real scroll bars, as on Windows
  const p3 = await b3.newPage({ viewport: { width: 1280, height: 900 } });
  p3.on('pageerror', (e) => allErrors.push(e.message));
  await p3.goto(BASE + '/');
  await p3.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
  await p3.goto(BASE + '/?t=' + Date.now() + '#/page/Notes');
  await p3.waitForSelector('#main .outline');
  await p3.evaluate(() => window.leanApp.tabs.open('#/page/Reading', 'side'));
  await sleep(1000);
  await p3.locator('#main').click({ position: { x: 6, y: 6 } });
  await p3.locator('#main .outline .blk > .bc', { hasText: 'my note' }).click({ position: { x: 4, y: 6 } });
  await p3.keyboard.press('End');
  await p3.keyboard.type(' one');
  const r3 = await p3.locator('#main2').boundingBox();
  const now = () => p3.evaluate(() => ({ editing: !!document.activeElement?.matches('#main textarea.ed'), act: window.leanApp.tabs.act, top: Math.round(document.querySelector('#main2').scrollTop) }));
  await p3.mouse.move(r3.x + r3.width / 2, r3.y + 300);
  await p3.mouse.wheel(0, 600);
  await sleep(400);
  const wheel = await now();
  await p3.keyboard.type(' two');
  // the scroll bar's handle (the arrows at its ends are 15px), pressed and dragged down
  const thumb = await p3.evaluate(() => { const m = document.querySelector('#main2'), r = m.getBoundingClientRect(), track = m.clientHeight - 30; return r.top + m.clientTop + 15 + track * (m.scrollTop + m.clientHeight / 2) / m.scrollHeight; });
  await p3.mouse.move(r3.x + r3.width - 8, thumb);
  await p3.mouse.down();
  await p3.mouse.move(r3.x + r3.width - 8, thumb + 200, { steps: 6 });
  await p3.mouse.up();
  await sleep(400);
  const bar = await now();
  // the middle button on the right's page, away from a link (on Windows it scrolls)
  await p3.mouse.move(r3.x + r3.width - 60, r3.y + 400);
  await p3.mouse.down({ button: 'middle' });
  await p3.mouse.up({ button: 'middle' });
  await sleep(300);
  const mid = await now();
  await p3.keyboard.type(' three to'); // (on a side he didn't click into, "t o" would be a shortcut)
  await p3.keyboard.press('Escape');
  await sleep(1500);
  check(wheel.editing && wheel.act === 0 && wheel.top >= 500, 'the wheel scrolled the right side; the left kept its note open', JSON.stringify(wheel));
  check(bar.editing && bar.act === 0 && bar.top > wheel.top + 500, 'the right side’s scroll bar dragged; the left kept its note open and active', JSON.stringify(bar));
  check(mid.editing && mid.act === 0, 'the middle button on the right’s page: the left kept its note open and active', JSON.stringify(mid));
  check(read('pages/Notes.md') === '- my note one two three to\n', 'every word went into the note', read('pages/Notes.md'));
  await p3.evaluate(() => { document.querySelector('#main2').scrollTop = 0; });
  await sleep(300);
  await p3.locator('#main2 .outline a[data-page="Linked"]').first().click({ button: 'middle' });
  await sleep(800);
  const link = await p3.evaluate(() => ({ act: window.leanApp.tabs.act, n: window.leanApp.tabs.panes[1]?.tabs.length, hash: decodeURIComponent(location.hash) }));
  check(link.act === 1 && link.n === 2 && link.hash === '#/page/Linked', '…the middle button on a link there opens it in a new tab on that side', JSON.stringify(link));
  await b3.close();
}

console.log('keys act on the side he is on: a note selected on the left, then a click on the right');
write('pages/Sel.md', '- first note\n- second note\n');
await page.evaluate(() => window.leanApp.rescan());
await page.locator('#main').click({ position: { x: 6, y: 6 } });
await go(page, '#/page/Sel');
await typeIn('#main', 'second note', ' edited', false);
await page.keyboard.press('Escape'); // stops editing and selects the note
await sleep(1200);
await page.locator('#main2').click({ position: { x: 6, y: 300 } });
await sleep(300);
await page.keyboard.press('Tab');
await page.keyboard.press('Backspace');
await page.keyboard.press('Control+z');
await sleep(1200);
check(read('pages/Sel.md') === '- first note\n- second note edited\n', 'Tab, Backspace and Ctrl+Z there leave the left side\'s note alone', read('pages/Sel.md'));

console.log('another notes folder chosen on the left, a page of this one open on the right');
const V2 = DIR + '/vault2';
fs.rmSync(V2, { recursive: true, force: true });
for (const d of ['logseq', 'pages', 'journals']) fs.mkdirSync(V2 + '/' + d, { recursive: true });
fs.writeFileSync(V2 + '/logseq/config.edn', '{:meta/version 1}\n');
fs.writeFileSync(V2 + '/pages/Twice.md', '- the other folder\'s note\n');
await page.locator('#main').click({ position: { x: 6, y: 6 } });
await page.locator('#side .nav a[data-view="settings"]').click();
await sleep(800);
await page.locator('#main .set-tabs [data-tab="notes"]').click();
await sleep(300);
await page.locator('#main [data-a="pick"]').click();
await page.locator('#main .picker button', { hasText: 'Up' }).click();
await page.locator(`#main .picker button[data-p="${V2}"]`).click();
await page.locator('#main .picker [data-use]').click();
await sleep(1500);
check(await page.locator('#main2').isHidden() && await page.evaluate(() => window.leanApp.tabs.panes[0].tabs.length) === 1, 'one side, one tab: the first folder\'s pages are closed');
check(fs.readFileSync(V2 + '/pages/Twice.md', 'utf8') === '- the other folder\'s note\n' && read('pages/Twice.md').startsWith('- one note L1 R1 L2'), 'neither folder\'s note changed');
allErrors.push(...errors.filter((e) => !e.includes('status of 500'))); // (the refused saves)
await browser.close();
check(!allErrors.length, 'no script errors', allErrors.join(' | '));
process.exit(failures() ? 1 : 0);

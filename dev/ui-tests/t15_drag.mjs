// Dragging notes anywhere (move.js) and dropping files from outside (filedrop.js), on a laptop and a
// phone. A note dragged by its dot: to another day in the Journals list, to the page on the other side,
// onto a page in the sidebar (Favourites, Recent: its end; a favourite with no page yet gets one); Alt
// held: a block reference instead (an id:: added to the note if it has none). The note's own words and
// id:: go with it (a reference to it still finds it). One Undo step for both pages (Ctrl+Z, the
// message's Undo), Redo too. Two files change, in a safe order: the other page first, saved, then this
// one; a save that fails or clashes (page.route) leaves both files as they were (or, if even taking it
// back fails, says the notes are in both). Files dropped on a note: copied into assets/, linked under
// its words (at the caret while typing in it; on the page but not on a note: a new note at its end);
// not on a page: nothing copied. Every check of a file compares all of it. Screenshots in four looks.
import { open, read, write, exists, check, failures, sleep, go, editBlock, SHOTS, VAULT } from './lib.mjs';
import fs from 'node:fs';

const ID = '6528aaaa-bbbb-4ccc-8ddd-eeeeffff7777';
const SOURCE = `- alpha\n- beta\n\t- beta kid\n- gamma\n  id:: ${ID}\n- delta\n`;
const TARGET = '- one\n- two\n';
const CRLF = '- c one\r\n- c two\r\n';
write('pages/Source.md', SOURCE);
write('pages/Target.md', TARGET);
write('pages/Spaced.md', CRLF);
write('pages/Refs.md', `- see ((${ID}))\n`);
write('pages/Drops.md', '- first note\n- second note\n');
const SB = read('pages/Sourdough Bread.md');

let { browser, page, errors } = await open({ viewport: { width: 1280, height: 1400 } });
const settle = () => sleep(1400); // (saving waits 0.8 s)
const row = (t, scope = '') => page.locator(`${scope} .outline .blk`, { has: page.locator(':scope > .bc', { hasText: t instanceof RegExp ? t : new RegExp('^' + t + '$') }) }).first();
const dot = (t, scope) => row(t, scope).locator(':scope > .bul');
const toast = () => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; });
/** Drag from the dot of note t to x, y (by the mouse; alt: Alt held). What showed just before letting go. */
async function drag(t, x, y, { scope = '', alt = false, steps = 12 } = {}) {
  const b = await dot(t, scope).boundingBox();
  const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) { await page.mouse.move(x0 + (x - x0) * k / steps, y0 + (y - y0) * k / steps); await sleep(16); }
  await sleep(150);
  const seen = await page.evaluate(() => {
    const l = document.querySelector('.drop-line');
    return { line: !!l && !l.hidden, in: l?.closest('.sheet')?.querySelector('.page-title')?.textContent ?? null, left: l ? parseFloat(l.style.left) : null,
      to: document.querySelector('.drag-ghost .dg-to')?.textContent ?? null, lit: document.querySelector('#side a.drop-to')?.dataset.page ?? null,
      faded: document.querySelectorAll('.blk.dragging').length, refLook: !!document.querySelector('.drag-ghost.ref') };
  });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await settle();
  return seen;
}
const box = async (loc) => loc.boundingBox();
const above = async (t, scope) => { const r = await box(row(t, scope).locator(':scope > .bc')); return r.y + 3; };
const below = async (t, scope) => { const r = await box(row(t, scope).locator(':scope > .bc')); return r.y + r.height - 3; };

// --------------------------------------------------------------------------------------------
console.log('Journals: a note to another day');
await go(page, '#/journals');
await sleep(600);
const days = await page.evaluate(() => [...document.querySelectorAll('.sheet.day .page-title')].map((x) => x.textContent));
const [TODAY, YDAY] = days;
const TODAY0 = read(`Diary/${TODAY}.md`), YDAY0 = read(`Diary/${YDAY}.md`);
const dayScope = (n) => `.sheet.day:nth-child(${n})`;
const later = await row(/read Bramble/, dayScope(2)).locator(':scope > .bc').boundingBox();
const dotX = (await dot('submit market order', dayScope(1)).boundingBox()).x + 7;
let seen = await drag('submit market order', dotX, later.y + 3, { scope: dayScope(1) });
check(seen.line && seen.in === YDAY && seen.to === `→ ${YDAY}` && seen.faded === 1, 'over another day: the line is in that day, and the copy says where to', JSON.stringify(seen));
const TODAY1 = TODAY0.replace('- DONE submit market order\n', '');
const YDAY1 = YDAY0.replace('- LATER', '- DONE submit market order\n- LATER');
check(read(`Diary/${TODAY}.md`) === TODAY1 && read(`Diary/${YDAY}.md`) === YDAY1, 'let go: moved there (out of today, into that day, between its notes)', read(`Diary/${YDAY}.md`) + ' :: ' + read(`Diary/${TODAY}.md`));
check(/^Moved to “.+”\.Undo$/.test(await toast()), 'a message says where it went, with Undo', await toast());
check(await row('DONE submit market order', dayScope(2)).count() === 0 && await page.locator(`${dayScope(2)} .blk > .bc`, { hasText: 'submit market order' }).count() === 1
  && await page.locator(`${dayScope(1)} .blk > .bc`, { hasText: 'submit market order' }).count() === 0, 'both days show it');
await page.keyboard.press('Control+z');
await settle();
check(read(`Diary/${TODAY}.md`) === TODAY0 && read(`Diary/${YDAY}.md`) === YDAY0, 'Ctrl+Z: one step puts it back in both days, byte for byte', read(`Diary/${YDAY}.md`));
await page.keyboard.press('Control+Shift+z');
await settle();
check(read(`Diary/${TODAY}.md`) === TODAY1 && read(`Diary/${YDAY}.md`) === YDAY1, 'Ctrl+Shift+Z: moved again, both days');
await page.keyboard.press('Control+z');
await settle();
check(read(`Diary/${TODAY}.md`) === TODAY0 && read(`Diary/${YDAY}.md`) === YDAY0, '…and undone again');
// with its sub-notes, a level in (a child of the note above the line), by the message's Undo
const meet = await row(/^Walked to the bakery/, dayScope(2)).locator(':scope > .bc').boundingBox();
seen = await drag(/^Meeting notes/, dotX + 30, meet.y + meet.height - 3, { scope: dayScope(1) });
const YDAY2 = YDAY0.replace('fillings\n', 'fillings\n\t- Meeting notes\n\t  project:: [[Pickles in brine]]\n\t  status:: done\n\t\t- Jars seal better with **less salt**\n');
check(read(`Diary/${YDAY}.md`) === YDAY2 && read(`Diary/${TODAY}.md`) === TODAY0.replace(/- Meeting notes\n[^]*$/, ''), 'a note with its sub-notes and properties, a level in: written the way that day writes notes', read(`Diary/${YDAY}.md`) + ' :: ' + read(`Diary/${TODAY}.md`));
await page.locator('#toast .toast-act').click();
await settle();
check(read(`Diary/${TODAY}.md`) === TODAY0 && read(`Diary/${YDAY}.md`) === YDAY0, 'the message’s Undo puts both days back', read(`Diary/${TODAY}.md`));
await page.screenshot({ path: SHOTS + '/drag-day-done.png' });

// --------------------------------------------------------------------------------------------
console.log('two sides: to the page on the other side; Alt for a reference');
await go(page, '#/page/Source');
await page.evaluate(() => window.leanApp.tabs.open('#/page/Target', 'side'));
await page.waitForSelector('#main2 .outline .blk');
await sleep(500);
const oneDot = await dot('one', '#main2').boundingBox();
const twoTop = await above('two', '#main2');
const alphaDot = await dot('alpha', '#main').boundingBox();
const rowLeft = await page.evaluate(() => document.querySelector('#main2 .outline').getBoundingClientRect().left);
check(Math.abs(oneDot.x + oneDot.width / 2 - rowLeft - 9.5) < 4, '(a dot sits 9.5px in from its outline’s edge)', oneDot.x + oneDot.width / 2 - rowLeft);
seen = await drag('alpha', oneDot.x + oneDot.width / 2 + 26, twoTop, { scope: '#main' });
check(seen.line && seen.to === '→ Target' && Math.abs(seen.left - (24 + 9.5)) < 6, 'over the right side: its line, a level in from how far right', JSON.stringify(seen));
check(read('pages/Target.md') === '- one\n\t- alpha\n- two\n' && read('pages/Source.md') === SOURCE.replace('- alpha\n', ''), 'moved to the other side, as a child of the note above', read('pages/Target.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Target.md') === TARGET && read('pages/Source.md') === SOURCE, 'Ctrl+Z: both sides back');
// a note with an id:: keeps it, and a reference to it still finds it
seen = await drag('gamma', oneDot.x + oneDot.width / 2, await below('two', '#main2') + 12, { scope: '#main' });
check(read('pages/Target.md') === `- one\n- two\n- gamma\n  id:: ${ID}\n` && read('pages/Source.md') === SOURCE.replace(`- gamma\n  id:: ${ID}\n`, ''), 'a note with an id:: keeps it (to the end, below the last note)', read('pages/Target.md'));
const hits = await page.evaluate((id) => fetch('/api/blocks_by_id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) }).then((r) => r.json()), ID);
check(hits?.[0]?.page === 'Target' && hits[0].text.startsWith('gamma'), 'references to it find it in its new page', JSON.stringify(hits));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Target.md') === TARGET && read('pages/Source.md') === SOURCE, '(undone)');
// Alt: a block reference instead; the note gets an id:: (it had none) and stays
seen = await drag('alpha', oneDot.x + oneDot.width / 2, twoTop, { scope: '#main', alt: true });
check(seen.line && seen.refLook && seen.faded === 1 && seen.to === '↗ reference in Target', 'Alt held: the copy says “reference”, and the notes don’t fade', JSON.stringify(seen));
const src = read('pages/Source.md'), newId = src.match(/^- alpha\n  id:: ([0-9a-f-]{36})\n/)?.[1];
check(!!newId && src === SOURCE.replace('- alpha\n', `- alpha\n  id:: ${newId}\n`) && read('pages/Target.md') === `- one\n- ((${newId}))\n- two\n`, 'a reference goes there, ((id)); the note stays, with a new id:: as Logseq writes it', src + ' :: ' + read('pages/Target.md'));
check(/Reference added in “Target”/.test(await toast()), 'the message says so', await toast());
await sleep(400);
check(await page.locator('#main2 .bref').first().textContent() === 'alpha', 'the reference shows the note’s words', await page.locator('#main2 .bref').first().textContent());
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Target.md') === TARGET && read('pages/Source.md') === SOURCE, 'Ctrl+Z takes the reference and the new id:: away (both pages)', read('pages/Source.md'));
// a note with an id:: already: only the other page changes, and Ctrl+Z on this side still takes it away there
seen = await drag('gamma', oneDot.x + oneDot.width / 2, await above('two', '#main2'), { scope: '#main', alt: true });
check(read('pages/Target.md') === `- one\n- ((${ID}))\n- two\n` && read('pages/Source.md') === SOURCE, 'a note with an id:: already: only the other page changes', read('pages/Target.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Target.md') === TARGET && read('pages/Source.md') === SOURCE, '…and Ctrl+Z on this side takes it away there', read('pages/Target.md'));
// a note that has an id: the reference only, in its own page
seen = await drag('gamma', alphaDot.x + 7, await below('delta', '#main') + 10, { scope: '#main', alt: true });
check(read('pages/Source.md') === SOURCE + `- ((${ID}))\n` && read('pages/Target.md') === TARGET, 'Alt in its own page: a reference at the end, its id:: as it was', read('pages/Source.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Source.md') === SOURCE, '(undone)');
// the same page on both sides: a move within it
await page.evaluate(() => window.leanApp.tabs.open('#/page/Source', 'side'));
await page.waitForSelector('#main2 .outline .blk');
await sleep(500);
const dd = await dot('delta', '#main2').boundingBox();
seen = await drag('alpha', dd.x + 7, await below('delta', '#main2') + 10, { scope: '#main' });
check(read('pages/Source.md') === '- beta\n\t- beta kid\n- gamma\n  id:: ' + ID + '\n- delta\n- alpha\n' && await page.locator('#main2 .outline .blk > .bc').last().textContent() === 'alpha', 'the same page on the other side: moved within it, both sides show it', read('pages/Source.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Source.md') === SOURCE, '(one step)');
// …but not while the other side holds typing not saved yet: its notes would count differently
await row('alpha', '#main2').locator(':scope > .bc').click({ position: { x: 2, y: 8 } });
await page.waitForSelector('#main2 textarea.ed');
await page.keyboard.press('Home');
await page.keyboard.type('x');
const kidBox = await row('beta kid', '#main2').locator(':scope > .bc').boundingBox();
const b0 = await dot('beta', '#main').boundingBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down();
for (let k = 1; k <= 8; k++) { await page.mouse.move(b0.x + (kidBox.x + 5 - b0.x) * k / 8, b0.y + (kidBox.y + 3 - b0.y) * k / 8); await sleep(16); }
const shown = await page.evaluate(() => { const l = document.querySelector('.drop-line'); return !!l && !l.hidden && l.closest('.pane')?.id === 'main2'; });
await page.mouse.up();
await sleep(2500);
check(!shown && read('pages/Source.md') === SOURCE.replace('- alpha', '- xalpha'), 'the other side with unsaved typing: no place to drop there, nothing moved', read('pages/Source.md'));
await row('xalpha', '#main2').locator(':scope > .bc').click({ position: { x: 2, y: 8 } });
await page.waitForSelector('#main2 textarea.ed');
await page.keyboard.press('Home');
await page.keyboard.press('Delete');
await page.keyboard.press('Escape');
await settle();
check(read('pages/Source.md') === SOURCE, '(the typing taken out again)', read('pages/Source.md'));

// --------------------------------------------------------------------------------------------
console.log('onto a page in the sidebar: to its end');
await page.evaluate(() => window.leanApp.tabs.closePane(1));
await sleep(400);
await go(page, '#/page/Source');
await sleep(400);
const fav = page.locator('#favs .side-list a[data-page="Sourdough Bread"]');
let fb = await fav.boundingBox();
seen = await drag('delta', fb.x + fb.width / 2, fb.y + fb.height / 2, { scope: '#main' });
check(seen.lit === 'Sourdough Bread' && !seen.line && seen.to === '→ Sourdough Bread', 'over a favourite: it lights up, no line', JSON.stringify(seen));
check(read('pages/Sourdough Bread.md') === SB + '- delta\n' && read('pages/Source.md') === SOURCE.replace('- delta\n', ''), 'let go: moved to the end of that page', read('pages/Sourdough Bread.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Sourdough Bread.md') === SB && read('pages/Source.md') === SOURCE, 'Ctrl+Z: back from a page that isn’t open, byte for byte', read('pages/Sourdough Bread.md'));
await page.keyboard.press('Control+Shift+z');
await settle();
check(read('pages/Sourdough Bread.md') === SB + '- delta\n' && read('pages/Source.md') === SOURCE.replace('- delta\n', ''), 'Ctrl+Shift+Z: moved there again');
await page.keyboard.press('Control+z');
await settle();
// a favourite with no page yet: the page is made
const toRead = page.locator('#favs .side-list a[data-page="to read"]');
fb = await toRead.boundingBox();
await drag('beta', fb.x + fb.width / 2, fb.y + fb.height / 2, { scope: '#main' });
check(exists('pages/to read.md') && read('pages/to read.md') === '- beta\n\t- beta kid\n' && read('pages/Source.md') === SOURCE.replace('- beta\n\t- beta kid\n', ''), 'a favourite with no page yet: made, with the notes', exists('pages/to read.md') && read('pages/to read.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Source.md') === SOURCE && read('pages/to read.md').trim() === '', '(undone)', read('pages/to read.md'));
// a page in Recent (not open: its file)
const rec = page.locator('#recent a[data-page="Spaced"]');
await page.evaluate(() => { location.hash = '#/page/Spaced'; });
await sleep(500);
await go(page, '#/page/Source');
fb = await rec.boundingBox();
await drag('beta', fb.x + fb.width / 2, fb.y + fb.height / 2, { scope: '#main' });
check(read('pages/Spaced.md') === '- c one\r\n- c two\r\n- beta\r\n\t- beta kid\r\n', 'a page in Recent: to its end, written with its line ends', JSON.stringify(read('pages/Spaced.md')));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Spaced.md') === CRLF && read('pages/Source.md') === SOURCE, '(undone)');
// its own page in Recent: to its end
fb = await page.locator('#recent a[data-page="Source"]').boundingBox();
await drag('alpha', fb.x + fb.width / 2, fb.y + fb.height / 2, { scope: '#main' });
check(read('pages/Source.md') === SOURCE.replace('- alpha\n', '') + '- alpha\n' && /^Moved to the end of the page/.test(await toast()), 'onto its own page: to its end', read('pages/Source.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Source.md') === SOURCE, '(undone)');
await page.screenshot({ path: SHOTS + '/drag-sidebar.png' });

// --------------------------------------------------------------------------------------------
console.log('a save that fails or clashes: both files stay as they were');
await page.evaluate(() => window.leanApp.tabs.open('#/page/Target', 'side'));
await page.waitForSelector('#main2 .outline .blk');
await sleep(500);
const toTarget = async () => { const o = await dot('one', '#main2').boundingBox(); return drag('alpha', o.x + o.width / 2, await above('two', '#main2'), { scope: '#main' }); };
const asIs = async (what) => {
  await sleep(1200); // (nothing saved later either)
  const shown = await page.evaluate(() => [...document.querySelectorAll('#main2 .outline .blk > .bc')].map((x) => x.textContent).join('|') + ' / ' + [...document.querySelectorAll('#main .outline .blk > .bc')].map((x) => x.textContent).join('|'));
  check(read('pages/Target.md') === TARGET && read('pages/Source.md') === SOURCE && shown === `one|two / alpha|beta|beta kid|gamma|delta`, what, read('pages/Target.md') + ' :: ' + read('pages/Source.md') + ' :: ' + shown);
};
const fail = (name, how) => page.route('**/api/save', (r) => {
  if (r.request().postDataJSON().name !== name) return r.continue();
  if (how === 'clash') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, hash: 'elsewhere', conflict: true, merged: null }) });
  return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the disk is full' }) });
});
await fail('Target', 'error');
await toTarget();
check(/^Nothing was moved: couldn’t save “Target” \(the disk is full\)/.test(await toast()), 'the other page can’t be saved: nothing moved, and the message says why', await toast());
await asIs('…both files and both sides as they were');
await page.unroute('**/api/save');
let saves = [];
await page.route('**/api/save', (r) => { const n = r.request().postDataJSON().name; saves.push(n); if (n === 'Source') return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'offline' }) }); return r.continue(); });
await toTarget();
check(/^Nothing was moved: couldn’t save “Source” \(offline\)/.test(await toast()) && saves.join() === 'Target,Source,Target', 'this page can’t be saved: added there first, then taken out of there again', saves.join() + ' :: ' + await toast());
await asIs('…both files and both sides as they were');
await page.unroute('**/api/save');
await fail('Target', 'clash');
await toTarget();
check(/^Nothing was moved: “Target” was changed elsewhere just now/.test(await toast()) && await page.locator('.panel').count() === 0, 'a clash there: nothing moved, no clash screen', await toast());
await asIs('…both files as they were');
await page.unroute('**/api/save');
await fail('Source', 'clash');
await toTarget();
check(/^Nothing was moved: “Source” was changed elsewhere just now/.test(await toast()), 'a clash here: taken out of there again', await toast());
await asIs('…both files as they were');
await page.unroute('**/api/save');
// even taking it back fails: it says the notes are in both, and both pages show what their files have
saves = [];
await page.route('**/api/save', (r) => { const n = r.request().postDataJSON().name; saves.push(n); if (saves.length === 1) return r.continue(); return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'offline' }) }); });
await toTarget();
check(/the notes are now in both “Source” and “Target”/.test(await toast()) && read('pages/Target.md') === '- one\n- alpha\n- two\n' && read('pages/Source.md') === SOURCE, 'taking it back fails too: the message says it’s in both (and it is)', await toast());
check(await page.locator('#main2 .outline .blk > .bc', { hasText: /^alpha$/ }).count() === 1 && await page.locator('#main .outline .blk > .bc', { hasText: /^alpha$/ }).count() === 1, '…and both sides show what their files have');
await page.unroute('**/api/save');
write('pages/Target.md', TARGET);
await page.evaluate(() => window.leanApp.rescan());
await sleep(800);
// a change made elsewhere meanwhile, in another part of the page: merged in; no Undo then
write('pages/Target.md', TARGET + '- three\n');
await toTarget();
check(read('pages/Target.md') === '- one\n- alpha\n- two\n- three\n' && read('pages/Source.md') === SOURCE.replace('- alpha\n', ''), 'the other page changed elsewhere meanwhile: merged, moved', read('pages/Target.md'));
check(/^Moved to “Target”\.$/.test(await toast()), '…with no Undo (it would take the change made elsewhere away too)', await toast());
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Target.md') === '- one\n- alpha\n- two\n- three\n' && read('pages/Source.md') === SOURCE.replace('- alpha\n', ''), '…and Ctrl+Z doesn’t undo half of it', read('pages/Source.md'));
write('pages/Target.md', TARGET);
write('pages/Source.md', SOURCE);
await page.evaluate(() => window.leanApp.rescan());
await sleep(800);

// --------------------------------------------------------------------------------------------
console.log('files dropped from outside (Explorer)');
await page.evaluate(() => window.leanApp.tabs.closePane(1));
await sleep(400);
await go(page, '#/page/Drops');
await sleep(400);
const PNG = fs.readFileSync(VAULT + '/assets/dot.png').toString('base64');
const assetsNow = () => fs.readdirSync(VAULT + '/assets').sort();
const assets0 = assetsNow();
/** Drop files ([name, type, base64]) at x, y the way a browser does; whether a note or the end lit up while over it. */
async function dropAt(x, y, files) {
  return page.evaluate(({ x, y, files }) => {
    const dt = new DataTransfer();
    for (const [name, type, b64] of files) dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type }));
    const el = document.elementFromPoint(x, y);
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const lit = document.querySelector('.blk.file-over > .bc')?.textContent ?? (document.querySelector('.outline.file-end') ? 'end' : null);
    const ev = new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return { lit, stopped: ev.defaultPrevented };
  }, { x, y, files });
}
let fbx = await row('first note').locator(':scope > .bc').boundingBox();
let dr = await dropAt(fbx.x + 30, fbx.y + 8, [['Holiday photo.png', 'image/png', PNG]]);
await settle();
let added = assetsNow().filter((f) => !assets0.includes(f));
check(dr.lit === 'first note' && dr.stopped, 'files over a note: it lights up', JSON.stringify(dr));
check(added.length === 1 && /^Holiday_photo_\d+\.png$/.test(added[0]) && fs.readFileSync(VAULT + '/assets/' + added[0]).toString('base64') === PNG
  && read('pages/Drops.md') === `- first note\n  ![Holiday photo](../assets/${added[0]})\n- second note\n`, 'a picture dropped on a note: copied into assets/ (Logseq’s name), shown under its words', read('pages/Drops.md'));
await page.keyboard.press('Control+z');
await settle();
check(read('pages/Drops.md') === '- first note\n- second note\n', 'Ctrl+Z takes the link away (one step)', read('pages/Drops.md'));
const lastB = await row('second note').locator(':scope > .bc').boundingBox();
dr = await dropAt(lastB.x + 30, lastB.y + lastB.height + 16, [['Report Q3.pdf', 'application/pdf', Buffer.from('%PDF-1.4 x').toString('base64')], ['b.png', 'image/png', PNG]]);
await settle();
added = assetsNow().filter((f) => !assets0.includes(f));
const pdf = added.find((f) => f.endsWith('.pdf')), b2 = added.find((f) => f.startsWith('b_'));
check(dr.lit === 'end' && pdf && b2 && read('pages/Drops.md') === `- first note\n- second note\n- [Report Q3.pdf](../assets/${pdf})\n- ![b](../assets/${b2})\n`, 'two files on the page below its notes: a new note for each, a file as a link', read('pages/Drops.md'));
await page.keyboard.press('Control+z');
await settle();
await editBlock(page, 'second note');
const ed = await page.locator('textarea.ed').boundingBox();
dr = await dropAt(ed.x + 20, ed.y + 8, [['scan.png', 'image/png', PNG]]);
await settle();
added = assetsNow().filter((f) => !assets0.includes(f));
const scan = added.find((f) => f.startsWith('scan_'));
check(await page.locator('textarea.ed').inputValue() === `second note ![scan](../assets/${scan})`, 'on the note being typed in: at the caret', await page.locator('textarea.ed').inputValue());
await page.keyboard.press('Escape');
await settle();
check(read('pages/Drops.md') === `- first note\n- second note ![scan](../assets/${scan})\n`, '(saved)', read('pages/Drops.md'));
const n0 = assetsNow().length;
const sideB = await page.locator('#side .nav a').first().boundingBox();
dr = await dropAt(sideB.x + 20, sideB.y + 8, [['x.png', 'image/png', PNG]]);
await sleep(600);
check(assetsNow().length === n0 && /drop them onto a note or a page/.test(await toast()) && dr.stopped, 'not on a page (the sidebar): nothing copied, a word on where to drop, and the file doesn’t open in place of the app', await toast());

// --------------------------------------------------------------------------------------------
console.log('every look: dragging to another day, onto the sidebar, files over a note');
for (const look of ['calm', 'plain', 'plainnight', 'paper']) {
  await page.evaluate((l) => { localStorage.setItem('skin', JSON.stringify(l)); document.documentElement.dataset.skin = l; }, look);
  await go(page, '#/journals');
  await sleep(500);
  const lt = await row(/read Bramble/, dayScope(2)).locator(':scope > .bc').boundingBox();
  const d0 = await dot('submit market order', dayScope(1)).boundingBox();
  await page.mouse.move(d0.x + 7, d0.y + 7);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(d0.x + 7, d0.y + 7 + (lt.y + 3 - d0.y - 7) * k / 10); await sleep(16); }
  await sleep(150);
  await page.screenshot({ path: `${SHOTS}/drag-day-${look}.png`, clip: { x: 0, y: Math.max(0, lt.y - 500), width: 1280, height: 640 } });
  const fv = await page.locator('#favs .side-list a').first().boundingBox();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(d0.x + 7 + (fv.x + 30 - d0.x - 7) * k / 8, lt.y + 3 + (fv.y + 8 - lt.y - 3) * k / 8); await sleep(16); }
  await sleep(150);
  await page.screenshot({ path: `${SHOTS}/drag-sidebar-${look}.png`, clip: { x: 0, y: 0, width: 640, height: 420 } });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  check(read(`Diary/${TODAY}.md`) === TODAY0, `${look}: Esc puts it back`);
  // files dragged over a note (not let go)
  const rb = await row(/^Reading/, dayScope(1)).locator(':scope > .bc').boundingBox();
  await page.evaluate(({ x, y, b64 }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'photo.png', { type: 'image/png' }));
    document.elementFromPoint(x, y).dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { x: rb.x + 40, y: rb.y + 8, b64: PNG });
  await page.screenshot({ path: `${SHOTS}/file-over-${look}.png`, clip: { x: 250, y: Math.max(0, rb.y - 120), width: 1030, height: 320 } });
  check(await page.locator('.blk.file-over').count() === 1, `${look}: files over a note light it up`);
  await page.evaluate(() => document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null })));
}
await page.evaluate(() => { localStorage.setItem('skin', JSON.stringify('calm')); document.documentElement.dataset.skin = 'calm'; });
check(!errors.filter((e) => !/status of 500/.test(e)).length, 'no script errors (but the failed saves asked for)', errors.join('\n'));
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('phone: hold a dot and drag it to another day');
({ browser, page, errors } = await open({ viewport: { width: 390, height: 844 }, touch: true }));
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await page.evaluate(() => { navigator.vibrate = () => true; });
await go(page, '#/journals');
await sleep(600);
await page.locator('.sched-h .disclose').first().tap(); // (today's "Scheduled & deadline" folded: the next day comes into sight)
await sleep(300);
const pd0 = await dot('submit market order', dayScope(1)).boundingBox();
await page.evaluate((y) => window.scrollTo(0, scrollY + y - 160), pd0.y); // (that note near the top, but not where the page scrolls by itself)
await sleep(300);
const pd = await dot('submit market order', dayScope(1)).boundingBox();
const pl = await row(/read Bramble/, dayScope(2)).locator(':scope > .bc').boundingBox();
check(pl.y + 3 < 844 - 70 && pd.y > 120, '(both days on the screen)', `${pd.y} ${pl.y}`);
await touch('touchStart', pd.x + pd.width / 2, pd.y + pd.height / 2);
await sleep(650);
for (let k = 1; k <= 14; k++) { await touch('touchMove', pd.x + pd.width / 2, pd.y + pd.height / 2 + (pl.y + 3 - pd.y - pd.height / 2) * k / 14); await sleep(20); }
await sleep(200);
const pseen = await page.evaluate(() => ({ line: !document.querySelector('.drop-line')?.hidden, to: document.querySelector('.drag-ghost .dg-to')?.textContent }));
await page.screenshot({ path: SHOTS + '/drag-day-phone.png' });
await touch('touchEnd');
await settle();
check(pseen.line && pseen.to === `→ ${YDAY}`, 'phone: the line shows in the other day', JSON.stringify(pseen));
check(read(`Diary/${TODAY}.md`) === TODAY1 && read(`Diary/${YDAY}.md`) === YDAY1, 'phone: moved to that day', read(`Diary/${YDAY}.md`));
check(/^Moved to “.+”\.Undo$/.test(await toast()), 'phone: the message has Undo', await toast());
await page.locator('#toast .toast-act').tap();
await settle();
check(read(`Diary/${TODAY}.md`) === TODAY0 && read(`Diary/${YDAY}.md`) === YDAY0, 'phone: Undo puts it back in both days');
for (const look of ['calm', 'plain', 'plainnight', 'paper']) { // (each look: held over the other day, then back and let go: nothing moves)
  await page.evaluate((l) => { localStorage.setItem('skin', JSON.stringify(l)); document.documentElement.dataset.skin = l; }, look);
  await sleep(300);
  const a = await dot('submit market order', dayScope(1)).boundingBox();
  await page.evaluate((y) => window.scrollTo(0, scrollY + y - 160), a.y);
  await sleep(300);
  const q = await dot('submit market order', dayScope(1)).boundingBox();
  const l = await row(/read Bramble/, dayScope(2)).locator(':scope > .bc').boundingBox();
  const x = q.x + q.width / 2, y = q.y + q.height / 2;
  await touch('touchStart', x, y);
  await sleep(650);
  for (let k = 1; k <= 12; k++) { await touch('touchMove', x, y + (l.y + 3 - y) * k / 12); await sleep(20); }
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}/drag-day-phone-${look}.png` });
  for (let k = 11; k >= 0; k--) { await touch('touchMove', x, y + (l.y + 3 - y) * k / 12); await sleep(20); }
  await sleep(200);
  await touch('touchEnd');
  await settle();
  check(read(`Diary/${TODAY}.md`) === TODAY0 && read(`Diary/${YDAY}.md`) === YDAY0, `phone, ${look}: back where it was and let go: nothing moves`);
}
check(!errors.length, 'no script errors (phone)', errors.join('\n'));
await browser.close();
if (failures()) { console.log(`FAILED: ${failures()}`); process.exit(1); }

// Pages (Build 30): All pages sorted by name, links, when each page was made and when it last
// changed (both ways round, remembered; a phone shows the column it's sorted by); renaming a page
// by clicking its title (Enter or leaving it renames, Esc puts it back; not a journal day; a tap on
// a phone); renaming to a name another page has offers to merge the two, as Logseq does (the notes at
// its end, links follow, the old file to the bin, Undo); "Copy link" (page ⋯ menu) and "Copy link to
// this note" (note menu: an id:: the Logseq way if needed); leanoutliner:// links opening a page or
// a note (in a note, from another program, at start); "Show file in Explorer" (the Windows app only).
// Every check of a file compares all of it, so untouched notes are proved byte for byte the same.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { open, read, write, exists, check, failures, sleep, go, SHOTS, BASE, VAULT } from './lib.mjs';

const today = () => { const d = new Date(); const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
const TODAY = `Diary/${today()}.md`;
const settle = () => sleep(1300); // (saving waits 0.8 s)
const hashNow = (p) => p.evaluate(() => decodeURIComponent(location.hash));
const LOOKS = ['calm', 'plain', 'plainnight', 'paper'];

// pages made one after another (the disk keeps when each was made), changed in the other order
const now = Date.now() / 1000;
write('pages/Made first.md', '- the oldest of the two\n');
await sleep(1100);
write('pages/Made second.md', '- the newer of the two\n');
fs.utimesSync(VAULT + '/pages/Made first.md', now, now); // changed just now
fs.utimesSync(VAULT + '/pages/Made second.md', now - 86400 * 40, now - 86400 * 40); // changed 40 days ago (so made by then)
for (const f of fs.readdirSync(VAULT + '/pages')) if (!f.startsWith('Made ')) fs.utimesSync(VAULT + '/pages/' + f, now - 86400 * 5, now - 86400 * 5);

const { browser, page, errors } = await open();
await page.evaluate(() => window.leanApp.rescan());
const clip = () => page.evaluate(() => navigator.clipboard.readText());
const toast = () => page.locator('#toast').textContent();
const names = () => page.evaluate(() => [...document.querySelectorAll('.pg-rows li a .pg-name')].map((x) => x.textContent.trim()));
const col = (k) => page.locator(`.pg-cols [data-s="${k}"]`);

// --------------------------------------------------------------------------------------------
console.log('All pages: sorted by name, links, Created and Changed, both ways, remembered');
await go(page, '#/pages');
await sleep(300);
const heads = await page.evaluate(() => [...document.querySelectorAll('.pg-cols [data-s]')].map((b) => [b.dataset.s, b.textContent, b.getAttribute('aria-pressed')]));
check(JSON.stringify(heads) === JSON.stringify([['name', 'Name↑', 'true'], ['links', 'Links', 'false'], ['created', 'Created', 'false'], ['changed', 'Changed', 'false']]), 'column heads Name (sorted, A to Z), Links, Created, Changed', JSON.stringify(heads));
let n = await names();
check(n[0] === 'APRON' && n.indexOf('Made first') < n.indexOf('Made second'), 'A to Z at first', n.join('|'));
const cells = await page.evaluate(() => { const a = [...document.querySelectorAll('.pg-rows li a')].find((x) => x.dataset.page === 'Made second'); return [...a.querySelectorAll('.meta')].map((m) => [m.className, m.textContent.trim(), getComputedStyle(m).display]); });
check(cells[2][1] && cells[2][1].endsWith(String(new Date((now - 86400 * 40) * 1000).getFullYear())) && cells[1][1] === cells[2][1] && cells.every((c) => c[2] !== 'none'), 'each row shows links, Created and Changed (made by the time it last changed: 40 days ago, both)', JSON.stringify(cells));
await col('name').click();
n = await names();
check(n[0] === 'Templates' && n[n.length - 1] === 'APRON' && (await col('name').textContent()) === 'Name↓', 'Name again: Z to A', n.slice(0, 3).join('|'));
await col('changed').click();
n = await names();
check(n[0] === 'Made first' && n[n.length - 1] === 'Made second' && (await col('changed').textContent()) === 'Changed↓', 'Changed: newest first (the page changed 40 days ago last)', n.join('|'));
await col('changed').click();
n = await names();
check(n[0] === 'Made second' && (await col('changed').getAttribute('aria-label')) === 'Changed, sorted oldest first', 'again: oldest first', n.join('|'));
await col('created').click();
n = await names();
// (Made second's file was made after Made first's, but it was changed 40 days ago, so it was made by then)
check(n[n.length - 1] === 'Made second' && n[0] === 'Made first', 'Created, newest first: “Made first” (made today) first, “Made second” (made by 40 days ago) last', n.join('|'));
await col('links').click();
n = await names();
check(n[0] === 'Rosa Penhallow', 'Links: most linked first', n.slice(0, 3).join('|'));
await col('created').click();
await col('created').click(); // oldest first
await page.reload();
await page.waitForSelector('.pg-rows li');
check((await col('created').getAttribute('aria-pressed')) === 'true' && (await col('created').textContent()) === 'Created↑' && (await names())[0] === 'Made second', 'remembered after a reload (Created, oldest first)', await col('created').textContent());
await page.locator('.chips [data-o="tree"]').click();
await sleep(150);
check(await col('created').isDisabled() && (await col('name').getAttribute('aria-pressed')) === 'true', 'Namespaces: listed A to Z under their parents (the heads wait)');
await page.locator('.chips [data-o="tree"]').click();
await page.locator('.chips [data-o="ghosts"]').click();
await col('changed').click();
const ghosts = await page.evaluate(() => [...document.querySelectorAll('.pg-rows .pg-name')].map((x) => x.classList.contains('ghost')));
check(ghosts.indexOf(true) > 0 && ghosts.slice(ghosts.indexOf(true)).every(Boolean), 'names with no file yet: last (they have no times)', JSON.stringify(ghosts));
await page.locator('.chips [data-o="ghosts"]').click(); // (sorted by Changed, newest first)
for (const lk of LOOKS) {
  await page.evaluate((l) => window.leanApp.setSkin(l), lk);
  await sleep(150);
  await page.screenshot({ path: `${SHOTS}/pages-all-${lk}.png` });
}
await page.evaluate(() => window.leanApp.setSkin('calm'));

// --------------------------------------------------------------------------------------------
console.log('rename a page by clicking its title');
const ORPHAN = read('pages/Orphan page.md');
await go(page, '#/page/Orphan%20page');
const title = page.locator('#main h1.page-title .pt-name');
await title.click();
check(await page.evaluate(() => document.activeElement?.matches('.pt-name[contenteditable]') && document.activeElement.closest('h1').classList.contains('renaming')), 'a click makes the name editable, with the caret in it');
await page.keyboard.press('Control+a');
await page.keyboard.type('t w lonely page', { delay: 10 });
check(!(await page.evaluate(() => document.documentElement.classList.contains('wide'))), 'its letters are the name’s, not the app’s keys ("t w")');
await page.screenshot({ path: SHOTS + '/pages-title-editing.png' });
await page.keyboard.press('Escape');
await sleep(300);
check(exists('pages/Orphan page.md') && (await title.textContent()) === 'Orphan page' && !(await title.getAttribute('contenteditable')), 'Esc: nothing renamed, the name as it was', await title.textContent());
await title.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('Lonely page');
await page.keyboard.press('Enter');
await sleep(900);
check(!exists('pages/Orphan page.md') && read('pages/Lonely page.md') === ORPHAN && await hashNow(page) === '#/page/Lonely page' && (await page.locator('#main h1.page-title').textContent()) === 'Lonely page', 'Enter renames it (the file too, its words untouched); the page shows under its new name', await hashNow(page));
// leaving the name (a click elsewhere) renames too; a link to it follows
write('pages/Points here.md', '- see [[Lonely page]]\n');
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Lonely%20page');
await title.click();
await page.keyboard.press('End');
await page.keyboard.type(' (moved)');
await page.locator('#main .outline .blk > .bc').first().click();
await sleep(900);
check(read('pages/Lonely page (moved).md') === ORPHAN && read('pages/Points here.md') === '- see [[Lonely page (moved)]]\n', 'clicking elsewhere renames; links follow', read('pages/Points here.md'));
await page.keyboard.press('Escape');
// a namespaced page: the last part is edited, its parents stay
await go(page, '#/page/' + encodeURIComponent('APRON/Spice jars/notes'));
check((await title.textContent()) === 'notes', 'a namespaced page shows its last part as its title');
await title.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('field notes');
await page.keyboard.press('Enter');
await sleep(900);
check(exists('pages/APRON___Spice jars___field notes.md') && !exists('pages/APRON___Spice jars___notes.md') && await hashNow(page) === '#/page/APRON/Spice jars/field notes', 'renaming it keeps its parents (APRON/Spice jars/field notes)', await hashNow(page));
// a journal day isn't renamed this way
await go(page, '#/page/' + encodeURIComponent(today()));
await page.locator('#main h1.page-title').click();
check(!(await page.locator('#main h1.page-title.renamable').count()) && !(await page.locator('#main .pt-name[contenteditable]').count()), 'a journal day’s title (its date) isn’t editable');
// a name that can't be used: said, and the name as it was
await go(page, '#/page/Maths');
await title.click();
await page.keyboard.press('Control+a');
await page.keyboard.type(today());
await page.keyboard.press('Enter');
await sleep(500);
check((await toast()).includes('journal date') && exists('pages/Maths.md') && (await title.textContent()) === 'Maths', 'a date as the name: refused, says why, the name as it was', await toast());

// --------------------------------------------------------------------------------------------
console.log('renaming to a name another page has: merge the two (with Undo)');
const PELL = read('pages/Marta Pell.md');
const NOTES = read('pages/Notes on Pell.md');
const DAY = read(TODAY);
await go(page, '#/page/Marta%20Pell');
await title.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('notes on pell');
await page.keyboard.press('Enter');
await page.waitForSelector('.modal');
const ask = await page.locator('.modal').textContent();
check(ask.includes('“Notes on Pell” already exists') && ask.includes('Merge “Marta Pell” into it?') && ask.includes('logseq/.recycle'), 'it offers to merge them, in plain words', ask);
await page.screenshot({ path: SHOTS + '/pages-merge-ask.png' });
await page.locator('.modal [data-v="0"]').click();
await sleep(400);
check(read('pages/Marta Pell.md') === PELL && read('pages/Notes on Pell.md') === NOTES && (await title.textContent()) === 'Marta Pell', 'Cancel: nothing changes, the name as it was');
await title.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('Notes on Pell');
await page.keyboard.press('Enter');
await page.waitForSelector('.modal');
await page.locator('.modal [data-v="1"]').click();
await sleep(1000);
check(read('pages/Notes on Pell.md') === NOTES + PELL && !exists('pages/Marta Pell.md') && read('logseq/.recycle/pages_Marta Pell.md') === PELL, 'Merge: its notes at the end of the other page (every byte of that one kept), its file in the bin', read('pages/Notes on Pell.md'));
check(read(TODAY) === DAY.replace('[[Marta Pell]]', '[[Notes on Pell]]'), 'links to it now point at the other page', read(TODAY));
check(await hashNow(page) === '#/page/Notes on Pell' && (await page.locator('#main .outline').textContent()).includes('Wrote Notes on Wild Yeast'), 'the other page shows, with the notes', await hashNow(page));
const said = await toast();
check(said.includes('Merged “Marta Pell” into “Notes on Pell”') && said.includes('1 note added at its end') && said.includes('Links updated in 1 other page') && await page.locator('#toast button', { hasText: 'Undo' }).count() === 1, 'it says what it did, with an Undo', said);
await page.screenshot({ path: SHOTS + '/pages-merged.png' });
await page.locator('#toast button', { hasText: 'Undo' }).click();
await sleep(1000);
check(read('pages/Marta Pell.md') === PELL && read('pages/Notes on Pell.md') === NOTES && read(TODAY) === DAY && !exists('logseq/.recycle/pages_Marta Pell.md') && await hashNow(page) === '#/page/Marta Pell', 'Undo: both pages and the link as they were, byte for byte', await hashNow(page));
// not while a clash waits for his choice
await go(page, '#/page/Marta%20Pell');
await page.evaluate(() => { window.leanApp.outlines[0].conflict = true; });
await title.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('Notes on Pell');
await page.keyboard.press('Enter');
await sleep(500);
check((await toast()).includes('First choose which version') && !(await page.locator('.modal').count()) && read('pages/Marta Pell.md') === PELL, 'while a clash waits: refused, says to choose first', await toast());
await page.evaluate(() => { window.leanApp.outlines[0].conflict = false; });
await go(page, '#/journals');

// --------------------------------------------------------------------------------------------
console.log('copy a link to a page and to a note; links open the page and the note');
await go(page, '#/page/Tasks');
await page.locator('#main [data-a="more"]').click();
const items = await page.locator('.pop.menu button').allTextContents();
check(items.includes('Copy link') && !items.includes('Show file in Explorer'), 'the page menu has “Copy link” (no Explorer outside the Windows app)', items.join('|'));
await page.locator('.pop.menu button', { hasText: 'Copy link' }).click();
await sleep(200);
check(await clip() === 'leanoutliner://page/Tasks' && (await toast()).includes('Link to this page copied'), 'Copy link: leanoutliner://page/Tasks', await clip());
// the page's own link rule (api.js, encodeURIComponent) is what the core reads back (link.rs)
const trip = await page.evaluate(async (names) => {
  const api = await import('/api.js');
  const out = [];
  for (const n of names) out.push([n, api.pageLinkUrl(n), (await api.call('link', { link: api.pageLinkUrl(n) })).name]);
  const note = await api.call('link', { link: api.noteLinkUrl('6528AAAA-bbbb-4ccc-8ddd-eeeeffff6666') });
  return { out, note };
}, ['Marta Pell', 'APRON/Spice jars', 'C++ & Rust?', '100% done #1', 'Café ☕ notes', 'a/b/c', 'it’s “quoted”', 'x=1&y=2']);
check(trip.out.every(([n, , back]) => back === n) && trip.out[1][1] === 'leanoutliner://page/APRON%2FSpice%20jars', 'page links made by the page open the same page in the core', JSON.stringify(trip.out));
check(trip.note.kind === 'note' && trip.note.id === '6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666', 'a note link names the note (small letters)', JSON.stringify(trip.note));
const TASKS = read('pages/Tasks.md');
await page.locator('#main .outline .blk', { hasText: 'undated thing' }).first().locator(':scope > .bul').click({ button: 'right' });
await page.waitForSelector('.note-menu');
await page.screenshot({ path: SHOTS + '/pages-note-menu.png' });
await page.locator('.note-menu .nm-item', { hasText: 'Copy link to this note' }).click();
await settle();
const link = await clip();
const id = link.replace('leanoutliner://note/', '');
check(/^[0-9a-f-]{36}$/.test(id) && read('pages/Tasks.md') === TASKS.replace('- WAITING undated thing\n', `- WAITING undated thing\n  id:: ${id}\n`), 'Copy link to this note: the note gets an id:: the Logseq way (one line under it), the link names it', link + '\n' + read('pages/Tasks.md'));
const ID = '6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666'; // (Notes on Pell's "A block with an id")
await go(page, '#/page/Notes%20on%20Pell');
await page.locator('#main .outline .blk', { hasText: 'A block with an id' }).first().locator(':scope > .bul').click({ button: 'right' });
await page.locator('.note-menu .nm-item', { hasText: 'Copy link to this note' }).click();
await settle();
check(await clip() === 'leanoutliner://note/' + ID && read('pages/Notes on Pell.md') === NOTES, 'a note with an id: its link, the file untouched', await clip());
// links: a page, a note (zoomed in, as Logseq's block links), one that names nothing there
await go(page, '#/journals');
await page.evaluate(() => window.leanApp.openLink('leanoutliner://page/Maths'));
await sleep(500);
check(await hashNow(page) === '#/page/Maths', 'a page link opens the page', await hashNow(page));
await page.evaluate((l) => window.leanApp.openLink(l), link);
await sleep(600);
check((await hashNow(page)).startsWith('#/zoom/Tasks/') && (await page.locator('#main .outline .blk:not([hidden]) > .bc').first().textContent()).includes('undated thing'), 'a note link opens that note, zoomed in', await hashNow(page));
await page.evaluate(() => window.leanApp.openLink('leanoutliner://note/6528aaaa-0000-4ccc-8ddd-eeeeffff0000'));
await sleep(400);
check((await toast()).includes('isn’t in your notes any more') && (await hashNow(page)).startsWith('#/zoom/Tasks/'), 'a note that’s gone: said, nothing moves', await toast());
// a link written in a note is a link, opened here
write('pages/Hub.md', `- see leanoutliner://page/Rosa%20Penhallow and [the note](leanoutliner://note/${ID})\n`);
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Hub');
await page.locator('#main .outline a.ext', { hasText: 'leanoutliner://page/Rosa%20Penhallow' }).click();
await sleep(600);
check(await hashNow(page) === '#/page/Rosa Penhallow', 'a leanoutliner link in a note opens the page right here', await hashNow(page));
await go(page, '#/page/Hub');
await page.locator('#main .outline a.ext', { hasText: 'the note' }).click();
await sleep(600);
check((await hashNow(page)).startsWith('#/zoom/Notes on Pell/'), '…and a note link the note', await hashNow(page));
// every look: the name being changed, and the page menu
await go(page, '#/page/Maths');
for (const lk of LOOKS) {
  await page.evaluate((l) => window.leanApp.setSkin(l), lk);
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and more');
  await page.screenshot({ path: `${SHOTS}/pages-title-${lk}.png` });
  await page.keyboard.press('Escape');
  await page.locator('#main [data-a="more"]').click();
  await page.screenshot({ path: `${SHOTS}/pages-menu-${lk}.png` });
  await page.keyboard.press('Escape');
}
check(read('pages/Maths.md').length > 0 && exists('pages/Maths.md'), 'Esc in every look: nothing renamed');
await page.evaluate(() => window.leanApp.setSkin('calm'));
check(errors.filter((e) => !e.includes('status of 400')).length === 0, 'no script errors (laptop)', errors.join('\n'));
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('the Windows app (a stand-in for its bridge): Show file in Explorer, links from other programs and at start');
{
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + '/');
  await p.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
  // what lib.rs answers itself; anything else goes to the same core as the dev server's
  await p.addInitScript(() => {
    const seen = (window.__seen = []);
    const on = (window.__on = {});
    let start = 'leanoutliner://page/Pickles%20in%20brine';
    window.__TAURI__ = {
      core: {
        async invoke(_c, { cmd, args }) {
          seen.push([cmd, args]);
          if (cmd === 'start_link') { const l = start; start = null; return l; }
          if (cmd === 'reveal_file') cmd = 'page_file';
          const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
          const j = await r.json();
          if (!r.ok) throw j.error;
          return j;
        },
      },
      event: { listen: async (name, fn) => { on[name] = fn; return () => {}; } },
    };
  });
  await p.goto(BASE + '/?t=' + Date.now() + '#/journals');
  await p.waitForSelector('#main .view > *');
  await sleep(1200);
  check(await hashNow(p) === '#/page/Pickles in brine', 'started by a page link: that page opens once the notes are open', await hashNow(p));
  await p.evaluate(() => window.__on['lean-link']({ payload: 'leanoutliner://page/Rosa%20Penhallow' }));
  await sleep(500);
  check(await hashNow(p) === '#/page/Rosa Penhallow', 'a link clicked in another program while the app is open: that page', await hashNow(p));
  await p.locator('#main [data-a="more"]').click();
  const its = await p.locator('.pop.menu button').allTextContents();
  check(its.includes('Show file in Explorer'), 'the page menu has “Show file in Explorer”', its.join('|'));
  await p.locator('.pop.menu button', { hasText: 'Show file in Explorer' }).click();
  await sleep(300);
  const asked = await p.evaluate(() => window.__seen.filter(([c]) => c === 'reveal_file'));
  check(JSON.stringify(asked) === JSON.stringify([['reveal_file', { name: 'Rosa Penhallow' }]]), 'it asks the app to show that page’s file', JSON.stringify(asked));
  await p.evaluate(() => window.leanApp.go('page', 'No file here'));
  await sleep(400);
  await p.locator('#main [data-a="more"]').click();
  check(!(await p.locator('.pop.menu button', { hasText: 'Show file in Explorer' }).count()), 'not for a page with no file yet');
  await p.keyboard.press('Escape');
  check(errs.length === 0, 'no script errors (the app)', errs.join('\n'));
  await b.close();
}

// --------------------------------------------------------------------------------------------
console.log('phone: All pages shows the column it’s sorted by; a tap on the title renames');
async function phone(look = 'calm', hash = '#/journals') {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE + '/');
  await p.evaluate(([v, l]) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify(l)); localStorage.setItem('pagesOpts', JSON.stringify({ sort: 'changed', desc: true })); }, [VAULT, look]);
  await p.goto(BASE + '/?t=' + Date.now() + hash);
  await p.waitForSelector('#main .view > *');
  await sleep(900);
  return { b, p, errs };
}
for (const lk of LOOKS) {
  const { b, p, errs } = await phone(lk, '#/pages');
  if (lk === 'calm') {
    const shown = await p.evaluate(() => { const a = document.querySelector('.pg-rows li a'); return [...a.querySelectorAll('.meta')].filter((m) => getComputedStyle(m).display !== 'none').map((m) => m.className); });
    check(JSON.stringify(shown) === JSON.stringify(['meta c-changed']), 'a phone shows only the column it’s sorted by (Changed)', JSON.stringify(shown));
    const hs = await p.evaluate(() => [...document.querySelectorAll('.pg-cols [data-s]')].map((x) => Math.round(x.getBoundingClientRect().height)));
    const wide = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check(hs.every((x) => x >= 44) && wide, 'its sort buttons are finger-sized, nothing wider than the screen', JSON.stringify(hs));
    await p.locator('.pg-cols [data-s="name"]').tap();
    await sleep(200);
    check((await p.evaluate(() => [...document.querySelectorAll('.pg-rows .pg-name')][0].textContent.trim())) === 'APRON', 'a tap sorts by name');
    await p.locator('.pg-cols [data-s="changed"]').tap();
  }
  await p.screenshot({ path: `${SHOTS}/pages-phone-all-${lk}.png` });
  if (lk === 'calm') {
    await p.evaluate(() => window.leanApp.go('page', 'Pictures'));
    await sleep(700);
    await p.locator('#main h1.page-title .pt-name').tap();
    await p.keyboard.type('xyz');
    await p.evaluate(() => window.leanApp.onBack()); // (Android's Back)
    await sleep(500);
    check(exists('pages/Pictures.md') && await hashNow(p) === '#/page/Pictures' && (await p.locator('#main h1.page-title').textContent()) === 'Pictures', 'Android’s Back while changing the name: as it was, still on the page', await hashNow(p));
    await p.locator('#main h1.page-title .pt-name').tap();
    await sleep(200);
    check(await p.evaluate(() => document.activeElement?.matches('.pt-name[contenteditable]')), 'a tap on the title makes the name editable');
    await p.keyboard.press('End');
    await p.keyboard.type(' of mine');
    await p.screenshot({ path: SHOTS + '/pages-phone-title.png' });
    await p.keyboard.press('Enter');
    await sleep(900);
    check(exists('pages/Pictures of mine.md') && !exists('pages/Pictures.md') && await hashNow(p) === '#/page/Pictures of mine', 'Enter renames it', await hashNow(p));
    check(errs.length === 0, 'no script errors (phone)', errs.join('\n'));
  }
  await b.close();
}

console.log(failures() ? `${failures()} FAILED` : 'all passed');
process.exit(failures() ? 1 : 0);

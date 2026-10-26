// Changes made elsewhere while editing: merged when they don't overlap, a choice when they do;
// navigation waits for the choice; a reload never drops typing.
import { open, read, write, exists, check, failures, sleep, go, editBlock, VAULT, SHOTS } from './lib.mjs';
const { browser, page, errors } = await open();

console.log('edits elsewhere in another place are merged');
await go(page, '#/page/Rosa%20Penhallow');
await editBlock(page, 'Baker at Millbrook');
await page.keyboard.type(' (laptop)');
// the phone adds a bullet before the laptop's save goes out
write('pages/Rosa Penhallow.md', read('pages/Rosa Penhallow.md') + '- added on the phone\n');
await sleep(1500);
let f = read('pages/Rosa Penhallow.md');
check(f === 'tags:: people\n\n- Baker at Millbrook, [[Apron club]] (laptop)\n- added on the phone\n', 'both kept', JSON.stringify(f));
check(await page.locator('.banner:not([hidden])').count() === 0, 'no conflict banner');
await page.keyboard.type(' more');
await sleep(1500);
f = read('pages/Rosa Penhallow.md');
check(f.includes('(laptop) more\n- added on the phone'), 'editing continues normally after the merge', JSON.stringify(f));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

console.log('the same note changed in both places: the clash screen');
await editBlock(page, 'Baker at Millbrook');
await page.keyboard.type(' X');
write('pages/Rosa Penhallow.md', read('pages/Rosa Penhallow.md').replace('Baker', 'Cook'));
await sleep(1500);
const scr = page.locator('.clash');
check(await scr.isVisible(), 'the clash screen opens');
check(await scr.locator('.cl-item').count() === 1, 'with only the note that differs');
check((await scr.locator('.cl-col.mine .cl-notes').textContent()).includes('(laptop) more X') && (await scr.locator('.cl-col.theirs .cl-notes').textContent()).includes('Cook at Millbrook'),
  'this device’s version and the other copy’s, side by side');
check((await scr.locator('.cl-base .cl-notes').textContent()).includes('Baker at Millbrook, Apron club (laptop) more'), 'and how it was before both changes');
check(await scr.locator('.cl-col.mine input').isChecked() && await scr.locator('.cl-col.mine em').count() === 1, 'this device’s is pre-picked as the suggestion');
check((await page.locator('.banner').textContent()).includes('Nothing on this page is saved until you choose'), 'the page says nothing is saved until he chooses');
await scr.locator('[data-c="later"]').click();
await sleep(200);
check(!(await scr.count()) && await page.locator('.banner:not([hidden]) [data-a="choose"]').count() === 1, '"Decide later" leaves a banner to come back to it');
// navigation is held back until the user chooses
await page.evaluate(() => { location.hash = '#/pages'; });
await sleep(700);
check(await page.evaluate(() => location.hash) === '#/page/Rosa%20Penhallow', 'stays on the page with the clash', await page.evaluate(() => location.hash));
await page.locator('.banner [data-a="choose"]').click();
await sleep(500);
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
f = read('pages/Rosa Penhallow.md');
check(f.includes('- Baker at Millbrook, [[Apron club]] (laptop) more X'), 'keeping the suggested one saved this device’s', f);
check(await page.locator('.banner:not([hidden])').count() === 0, 'and the banner went');
const fs = await import('node:fs');
const bakDir = VAULT + '/logseq/bak/pages/Rosa Penhallow';
const bakTexts = () => (fs.existsSync(bakDir) ? fs.readdirSync(bakDir).map((b) => fs.readFileSync(bakDir + '/' + b, 'utf8')) : []);
let baks = bakTexts();
check(baks.length === 2 && baks.some((t) => t.includes('Cook at')), 'the other version kept in logseq/bak', baks.join(' | '));
check(baks.some((t) => t.includes('Baker at Millbrook, [[Apron club]] (laptop) more X')), 'and this device’s, from when the clash showed (it was only in memory until he chose)', baks.join(' | '));

console.log('a file changed elsewhere reloads, but never under the user’s typing');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await sleep(300);
write('pages/Rosa Penhallow.md', 'tags:: people\n\n- rewritten elsewhere\n');
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await sleep(800);
check((await page.locator('.outline .bc').allTextContents()).some((t) => t.includes('rewritten elsewhere')), 'page shows the new version');
await editBlock(page, 'rewritten elsewhere');
write('pages/Rosa Penhallow.md', 'tags:: people\n\n- rewritten again\n');
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.keyboard.type(' typing');
await sleep(400);
check((await page.locator('textarea.ed').inputValue()).includes('typing'), 'typing kept while a reload was possible');
await page.keyboard.press('Escape');
await sleep(1500);
check(await page.locator('.clash').isVisible(), 'and the clash is offered as a choice, not lost');
await page.locator('.clash .cl-col.theirs').click();
await sleep(100);
check(await page.locator('.clash [data-c="apply"]').textContent() === 'Keep my choices', 'picking the other copy');
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read('pages/Rosa Penhallow.md') === 'tags:: people\n\n- rewritten again\n', 'keeping the other copy leaves the file as it was');
baks = bakTexts();
check(baks.length === 3 && baks.filter((t) => t.includes('rewritten elsewhere typing')).length === 1, 'my version kept as a backup copy, once', baks.join(' | '));

console.log('several differences, page properties too');
write('pages/Two.md', 'tags:: a\n\n- first\n- middle\n- last\n');
await go(page, '#/page/Two');
await sleep(300);
await editBlock(page, 'first');
await page.keyboard.type(' (here)');
await page.keyboard.press('Escape');
await editBlock(page, 'last');
await page.keyboard.type(' (here)');
await page.keyboard.press('Escape');
await page.evaluate(() => { const o = window.leanApp.outlines[0]; o.doc.preamble = 'tags:: a, here\n\n'; });
write('pages/Two.md', 'tags:: a, there\n\n- first (there)\n- middle\n- last (there)\n- added there\n');
await sleep(1600);
check(await page.locator('.clash .cl-item').count() === 3, 'three differences: the page properties and two notes', await page.locator('.clash .cl-item').count());
check(await page.locator('.clash .cl-item').first().locator('.cl-what').textContent() === 'Page properties', 'page properties first');
check(await page.locator('.clash .cl-n').textContent() === '1 of 3', 'counted');
await page.locator('.clash [data-c="next"]').click();
await sleep(400);
check(await page.locator('.clash .cl-n').textContent() === '2 of 3' && await page.locator('.clash .cl-item.cur').getAttribute('data-k') === '1', 'the arrows go from one to the next');
await page.locator('.clash [data-c="all-theirs"]').click();
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read('pages/Two.md') === 'tags:: a, there\n\n- first (there)\n- middle\n- last (there)\n- added there\n', '"All: other copy" keeps the other copy everywhere', read('pages/Two.md'));
await editBlock(page, 'middle');
await page.keyboard.type(' (later)');
await page.keyboard.press('Escape');
await sleep(1200);
check(read('pages/Two.md').includes('- middle (later)\n'), 'editing carries on normally afterwards', read('pages/Two.md'));

console.log('a clash on the Journals list: Home (the same place again) keeps the choice');
await go(page, '#/journals');
await sleep(400);
const todayFile = 'Diary/' + (await page.evaluate(() => window.leanApp.summary.today)) + '.md';
await editBlock(page, 'Meeting notes');
await page.keyboard.type(' MINE');
write(todayFile, read(todayFile).replace('Meeting notes', 'Meeting notes THEIRS'));
await sleep(1500);
check(await page.locator('.clash').isVisible(), 'the clash screen opens');
await page.locator('.clash [data-c="later"]').click();
await sleep(200);
check(await page.locator('.banner:not([hidden]) [data-a="choose"]').count() === 1, '"Decide later": a banner');
await page.locator('#histbar [data-a="home"]').click();
await sleep(800);
check(await page.locator('.banner:not([hidden]) [data-a="choose"]').count() === 1 && await page.evaluate(() => location.hash) === '#/journals', 'Home keeps the page and its choice', await page.evaluate(() => location.hash));
f = read(todayFile);
check(f.includes('Meeting notes THEIRS') && !f.includes('MINE'), 'nothing written over the other version', f);
const dayBak = VAULT + '/logseq/bak/' + todayFile.slice(0, -3);
const dayBaks = fs.existsSync(dayBak) ? fs.readdirSync(dayBak) : [];
check(dayBaks.length === 1 && fs.readFileSync(dayBak + '/' + dayBaks[0], 'utf8').includes('Meeting notes MINE'), 'only the copy made when the clash showed, nothing put away as "couldn’t save"', dayBaks.join(','));
await page.locator('.banner [data-a="choose"]').click();
await sleep(500);
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read(todayFile).includes('Meeting notes MINE'), 'choosing still works afterwards', read(todayFile));

console.log('a note typed at the end of today’s journal while the phone adds one: both kept, no clash');
write(todayFile, '- morning\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(500);
await editBlock(page, 'morning');
await page.keyboard.press('Enter');
await page.keyboard.type('typed on the laptop');
write(todayFile, '- morning\n- added from the phone widget\n');
await sleep(1600);
check(read(todayFile) === '- morning\n- typed on the laptop\n- added from the phone widget\n', 'this device’s first, then the phone’s', JSON.stringify(read(todayFile)));
check(!(await page.locator('.clash').count()) && !(await page.locator('.banner:not([hidden])').count()), 'without asking');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

const bakOf = (stem) => { const d = VAULT + '/logseq/bak/pages/' + stem; return fs.existsSync(d) ? fs.readdirSync(d).map((b) => fs.readFileSync(d + '/' + b, 'utf8')) : []; };
const clashOn = async (name, before, mineFrom, mineTyped, theirs) => {
  write(`pages/${name}.md`, before);
  await page.evaluate(() => window.leanApp.rescan());
  await go(page, '#/page/' + name);
  await sleep(300);
  await editBlock(page, mineFrom);
  await page.keyboard.type(mineTyped);
  write(`pages/${name}.md`, theirs);
  await sleep(1600);
};

console.log('both added notes where nothing (or an empty bullet) was: "Keep both" is offered and pre-picked');
write('pages/Fresh.md', '-\n'); // a page holding just "-" (Logseq makes these)
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Fresh');
await sleep(300);
await page.locator('.outline .blk > .bc').first().click();
await page.waitForSelector('textarea.ed');
await page.keyboard.type('typed on the laptop');
write('pages/Fresh.md', '- added from the phone\n'); // the phone's pop-up took the place of the "-"
await sleep(1600);
let both = page.locator('.clash .cl-col.both');
check(await both.count() === 1 && await both.locator('input').isChecked() && (await both.textContent()).includes('Keep both') && await both.locator('em').count() === 1, '“Keep both” is there, suggested and picked');
await page.screenshot({ path: SHOTS + '/clash-keep-both.png' });
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read('pages/Fresh.md') === '- typed on the laptop\n- added from the phone\n', 'keeping both: this device’s note, then the other copy’s', JSON.stringify(read('pages/Fresh.md')));
check((await page.locator('#toast').textContent()).includes('Kept both'), 'and it says so', await page.locator('#toast').textContent());
// he adds a to-do that's already on the page while the phone adds a note at the end
write('pages/Again.md', '- TODO water plants\n- B\n');
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Again');
await sleep(300);
await editBlock(page, 'B');
await page.keyboard.press('Enter');
await page.keyboard.type('TODO water plants');
write('pages/Again.md', '- TODO water plants\n- B\n- from the phone\n');
await sleep(1600);
both = page.locator('.clash .cl-col.both');
check(await both.count() === 1 && await both.locator('input').isChecked(), 'a repeated to-do next to a note from the phone: “Keep both” too');
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read('pages/Again.md') === '- TODO water plants\n- B\n- TODO water plants\n- from the phone\n', 'both kept', JSON.stringify(read('pages/Again.md')));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
// both moved the same note to the end, and the phone added one there too
write('pages/Moved.md', '- A\n- B\n- C\n');
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Moved');
await sleep(300);
await editBlock(page, 'A');
await page.keyboard.press('Control+Shift+ArrowDown'); // his Logseq keys (as in t2_blocks)
await page.keyboard.press('Control+Shift+ArrowDown');
write('pages/Moved.md', '- B\n- C\n- A\n- from the phone\n');
await sleep(1600);
const otherCol = page.locator('.clash .cl-col.theirs');
check(await page.locator('.clash .cl-col.both').count() === 1 && await otherCol.locator('input').isChecked() && await otherCol.locator('em').count() === 1,
  'the other copy has every note this device’s has: it is suggested (“Keep both” would show the moved note twice), “Keep both” still offered');
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read('pages/Moved.md') === '- B\n- C\n- A\n- from the phone\n', 'no note twice', JSON.stringify(read('pages/Moved.md')));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
// each device moved a different note to the end: keeping both there would show B twice (the laptop
// still has B at the top), so "Keep both" is offered but not pre-picked
write('pages/Moved2.md', '- A\n- B\n- C\n');
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Moved2');
await sleep(300);
await editBlock(page, 'A');
await page.keyboard.press('Control+Shift+ArrowDown');
await page.keyboard.press('Control+Shift+ArrowDown');
write('pages/Moved2.md', '- A\n- C\n- B\n'); // the phone moved B to the end
await sleep(1600);
const both2 = page.locator('.clash .cl-col.both');
check(await page.locator('.clash .cl-item').count() === 2 && await both2.count() === 1 && !(await both2.locator('input').isChecked()) && !(await both2.locator('em').count()),
  'two notes moved to the end, one on each device: “Keep both” is offered but not suggested (B would be there twice)');
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
check(read('pages/Moved2.md') === '- B\n- C\n- A\n', 'the suggested choices: no note twice', JSON.stringify(read('pages/Moved2.md')));
check(bakOf('Moved2').includes('- A\n- C\n- B\n'), 'the other copy’s order is kept in logseq/bak', JSON.stringify(bakOf('Moved2')));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

console.log('Undo after changes made elsewhere were merged in never takes them out again');
await clashOn('Undo1', '- one\n- two\n- three\n', 'two', ' typed here', '- one\n- two\n- three\n- added on the phone\n');
check(read('pages/Undo1.md') === '- one\n- two typed here\n- three\n- added on the phone\n', 'merged', JSON.stringify(read('pages/Undo1.md')));
await page.keyboard.press('Control+z');
await sleep(100);
await page.keyboard.press('Escape');
await sleep(1500);
check(read('pages/Undo1.md') === '- one\n- two typed here\n- three\n- added on the phone\n', 'Undo leaves the phone’s note (and the merged page) alone', JSON.stringify(read('pages/Undo1.md')));

console.log('Undo after keeping the other copy on the clash screen never brings this device’s back');
await clashOn('Undo2', '- one\n- two\n- three\n', 'two', ' typed here', '- one\n- two typed on the phone\n- three\n- added on the phone\n');
await page.locator('.clash .cl-col.theirs').click();
await page.locator('.clash [data-c="apply"]').click();
await sleep(1000);
const kept2 = '- one\n- two typed on the phone\n- three\n- added on the phone\n';
check(read('pages/Undo2.md') === kept2, 'the other copy kept', JSON.stringify(read('pages/Undo2.md')));
await editBlock(page, 'three');
await page.keyboard.type('!');
await page.keyboard.press('Control+z');
await sleep(100);
await page.keyboard.press('Control+z');
await sleep(100);
await page.keyboard.press('Escape');
await sleep(1500);
check(read('pages/Undo2.md') === kept2, 'two Undos only take back what was typed after the choice', JSON.stringify(read('pages/Undo2.md')));
check(bakOf('Undo2').length === 1 && bakOf('Undo2')[0] === '- one\n- two typed here\n- three\n', 'this device’s version is in logseq/bak, once', bakOf('Undo2').join(' | '));

console.log('"Decide later", more typing: copies in logseq/bak when the app is put away or closed');
await clashOn('Later', '- one\n- two\n', 'two', ' typed here', '- one\n- two typed there\n');
await page.locator('.clash [data-c="later"]').click();
await sleep(200);
await editBlock(page, 'one');
await page.keyboard.type(' more typing after decide later');
await page.keyboard.press('Escape');
await sleep(1200);
check(read('pages/Later.md') === '- one\n- two typed there\n', 'nothing saved over the other version meanwhile');
check(bakOf('Later').length === 1 && bakOf('Later')[0] === '- one\n- two typed here\n', 'a copy from when the clash showed', bakOf('Later').join(' | '));
const hide = (state) => page.evaluate((s) => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, state);
await hide('hidden');
await sleep(600);
check(bakOf('Later').includes('- one more typing after decide later\n- two typed here\n'), 'put away: the newer typing gets a copy', bakOf('Later').join(' | '));
await hide('visible');
await hide('hidden');
await sleep(600);
check(bakOf('Later').length === 2, 'put away again with nothing new typed: no second copy', bakOf('Later').length);
await hide('visible');
console.log('while a clash waits, pages can’t be renamed or deleted');
await page.evaluate(() => { window.leanApp.renamePage('Later'); });
await sleep(400);
const renameBox = await page.locator('.modal input').count();
if (renameBox) await page.keyboard.press('Escape');
check(!renameBox && (await page.locator('#toast').textContent()).includes('First choose which version of “Later” to keep'), 'renaming says to choose first', await page.locator('#toast').textContent());
const deleted = await Promise.race([page.evaluate(() => window.leanApp.deletePages(['Later'])), sleep(1500).then(() => 'a box opened')]);
if (deleted === 'a box opened') await page.keyboard.press('Escape');
check(deleted === false && exists('pages/Later.md'), 'deleting too', deleted);
await editBlock(page, 'one more typing');
await page.keyboard.type(' and before closing');
await page.keyboard.press('Escape');
await sleep(300);
await page.goto(page.url().replace(/\?t=\d+/, '?t=' + Date.now())); // like closing and starting again
await page.waitForSelector('.sheet .outline');
await sleep(800);
check(bakOf('Later').includes('- one more typing after decide later and before closing\n- two typed here\n'), 'closed: the last typing gets a copy too', bakOf('Later').join(' | '));
check(read('pages/Later.md') === '- one\n- two typed there\n', 'and the file is still the other version');

console.log('keeping a choice: the screen stays up until the backups are made');
await clashOn('Slow', '- one\n- two\n', 'two', ' mine', '- one\n- two theirs\n');
await page.route('**/api/backup', async (route) => { await sleep(1200); await route.continue(); });
await page.locator('.clash [data-c="apply"]').click(); // the suggested one: this device's
await sleep(400);
check(await page.locator('.clash').isVisible() && await page.locator('.clash [data-c="apply"]').isDisabled(), 'still there (buttons off) while the other copy is backed up');
await page.keyboard.press('Escape');
await sleep(1500);
await page.unroute('**/api/backup');
check(!(await page.locator('.clash').count()) && read('pages/Slow.md') === '- one\n- two mine\n', 'then gone, the choice saved (Escape meanwhile changed nothing)', JSON.stringify(read('pages/Slow.md')));
check(bakOf('Slow').includes('- one\n- two theirs\n'), 'the other copy in logseq/bak');

console.log('if the two versions can’t be compared: keep mine / use the other version, as before');
await page.route('**/api/clash', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the file is offline' }) }));
await clashOn('NoCmp', '- one\n- two\n', 'two', ' mine', '- one\n- two theirs\n');
check(!(await page.locator('.clash').count()) && await page.locator('.banner [data-a="mine"]').count() === 1 && await page.locator('.banner [data-a="theirs"]').count() === 1, 'the page offers both whole versions');
check(read('pages/NoCmp.md') === '- one\n- two theirs\n', 'nothing saved yet');
let failOnce = true; // "Keep mine" can't save the first time (say the file went offline)
await page.route('**/api/save', (route) => {
  if (!failOnce) return route.continue();
  failOnce = false;
  return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the file is offline' }) });
});
await page.locator('.banner [data-a="mine"]').click();
await sleep(600);
check(await page.locator('.banner [data-a="mine"]').count() === 1 && await page.evaluate(() => window.leanApp.outlines[0].conflict), 'if that can’t save, the page still waits for the choice', await page.locator('.banner').textContent());
await page.evaluate(() => { location.hash = '#/pages'; });
await sleep(600);
check(await page.evaluate(() => location.hash) === '#/page/NoCmp', 'and can’t be left meanwhile');
await page.locator('.banner [data-a="mine"]').click();
await sleep(1000);
await page.unroute('**/api/save');
await page.unroute('**/api/clash');
check(read('pages/NoCmp.md') === '- one\n- two mine\n' && bakOf('NoCmp').includes('- one\n- two theirs\n'), '"Keep mine" saves it, the other version goes to logseq/bak', JSON.stringify(read('pages/NoCmp.md')));
check(!(await page.locator('.banner:not([hidden])').count()), 'and the page works normally again');
await go(page, '#/pages');
check(await page.evaluate(() => location.hash) === '#/pages', 'can leave the page');

console.log('"Keep mine" while a save is on its way: it waits for that one, then saves this device’s version');
await page.route('**/api/clash', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the file is offline' }) }));
await clashOn('InFlight', '- one\n- two\n', 'two', ' mine', '- one\n- two theirs\n');
let slowFail = true; // the save on its way takes a while, then fails
await page.route('**/api/save', async (route) => {
  if (!slowFail) return route.continue();
  slowFail = false;
  await sleep(800);
  return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the file is busy' }) });
});
await page.evaluate(() => { const o = window.leanApp.outlines[0]; o.conflict = false; o.save(); o.conflict = true; });
await page.locator('.banner [data-a="mine"]').click();
await sleep(2000);
await page.unroute('**/api/save');
await page.unroute('**/api/clash');
check(read('pages/InFlight.md') === '- one\n- two mine\n' && bakOf('InFlight').includes('- one\n- two theirs\n'), 'this device’s version is saved (the other in logseq/bak), not asked about again', JSON.stringify(read('pages/InFlight.md')));
check(!(await page.locator('.banner:not([hidden])').count()) && !(await page.evaluate(() => window.leanApp.outlines[0].conflict)), 'and nothing waits any more');
// the failed comparison is reported by the browser as a failed request: expected here
errors.splice(0, errors.length, ...errors.filter((e) => !/status of 500/.test(e)));

console.log(errors.length ? 'script errors:\n' + errors.join('\n') : 'no script errors');
await browser.close();
process.exit(failures() ? 1 : 0);

// Changes made elsewhere while editing: merged when they don't overlap, a choice when they do;
// navigation waits for the choice; a reload never drops typing.
import { open, read, write, check, failures, sleep, go, editBlock, VAULT } from './lib.mjs';
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

console.log('same block changed in both places: the user chooses');
await editBlock(page, 'Baker at Millbrook');
await page.keyboard.type(' X');
write('pages/Rosa Penhallow.md', read('pages/Rosa Penhallow.md').replace('Baker', 'Cook'));
await sleep(1500);
check(await page.locator('.banner:not([hidden])').count() === 1, 'conflict banner shown');
// navigation is held back until the user chooses
await page.evaluate(() => { location.hash = '#/pages'; });
await sleep(700);
check(await page.evaluate(() => location.hash) === '#/page/Rosa%20Penhallow', 'stays on the page with the conflict', await page.evaluate(() => location.hash));
await page.locator('.banner [data-a="keep"]').click();
await sleep(800);
f = read('pages/Rosa Penhallow.md');
check(f.includes('- Baker at Millbrook, [[Apron club]] (laptop) more X'), '"Keep mine" saved mine', f);
const fs = await import('node:fs');
const bakDir = VAULT + '/logseq/bak/pages/Rosa Penhallow';
const baks = fs.existsSync(bakDir) ? fs.readdirSync(bakDir) : [];
check(baks.length === 1 && fs.readFileSync(bakDir + '/' + baks[0], 'utf8').includes('Cook at'), 'the other version kept in logseq/bak', baks.join(','));

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
check(await page.locator('.banner:not([hidden])').count() === 1, 'and the clash is offered as a choice, not lost');
await page.locator('.banner [data-a="load"]').click();
await sleep(600);
check(read('pages/Rosa Penhallow.md') === 'tags:: people\n\n- rewritten again\n', '"Use the other version" leaves the file as it was');
const baks2 = fs.readdirSync(bakDir);
check(baks2.length === 2, 'my version kept as a backup copy', baks2.join(','));

console.log('a clash on the Journals list: Home (the same place again) keeps the choice');
await go(page, '#/journals');
await sleep(400);
const todayFile = 'Diary/' + (await page.evaluate(() => window.leanApp.summary.today)) + '.md';
await editBlock(page, 'Meeting notes');
await page.keyboard.type(' MINE');
write(todayFile, read(todayFile).replace('Meeting notes', 'Meeting notes THEIRS'));
await sleep(1500);
check(await page.locator('.banner:not([hidden])').count() === 1, 'conflict banner shown');
await page.locator('#histbar [data-a="home"]').click();
await sleep(800);
check(await page.locator('.banner:not([hidden])').count() === 1 && await page.evaluate(() => location.hash) === '#/journals', 'Home keeps the page and its choice', await page.evaluate(() => location.hash));
f = read(todayFile);
check(f.includes('Meeting notes THEIRS') && !f.includes('MINE'), 'nothing written over the other version', f);
check(!fs.existsSync(VAULT + '/logseq/bak/Diary'), 'and nothing put away as "couldn’t save"');
await page.locator('.banner [data-a="keep"]').click();
await sleep(800);
check(read(todayFile).includes('Meeting notes MINE'), 'choosing still works afterwards', read(todayFile));

console.log(errors.length ? 'script errors:\n' + errors.join('\n') : 'no script errors');
await browser.close();
process.exit(failures() ? 1 : 0);

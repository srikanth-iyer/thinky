// The notes' settings (logseq/config.edn): never opened with guessed settings when the file can't be
// read just now (Settings says so, with Try again), and taken in when they change on disk while the
// app is open (Logseq, the phone, or Google Drive bringing them late).
import fs from 'node:fs';
import { open, read, write, check, failures, sleep, VAULT, SHOTS, BASE } from './lib.mjs';

const CFG = VAULT + '/logseq/config.edn';
const cfg = read('logseq/config.edn');
const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
const now = new Date();
const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const days = (page) => page.evaluate(() => [...document.querySelectorAll('.sheet.day .page-title')].map((x) => x.textContent));
const daily = () => fs.readdirSync(VAULT + '/Diary').sort().join('|');

const { browser, page, errors } = await open();
await sleep(800);
check((await days(page))[0] === title(now), 'the journals open with his settings', (await days(page)).join(' / '));

console.log('settings changed on disk while the app is open');
// Logseq adds a favourite: the sidebar shows it after the next look for changes
write('logseq/config.edn', cfg.replace(':favorites ["Sourdough Bread" "to read"]', ':favorites ["Sourdough Bread" "to read" "Notes"]'));
await page.evaluate(() => window.leanApp.rescan());
await sleep(400);
check(await page.locator('#favs', { hasText: 'Notes' }).count() === 1, 'a favourite added in Logseq shows in the sidebar');
// journal titles written another way: every day drawn again with the new titles, files untouched
const before = daily();
write('logseq/config.edn', read('logseq/config.edn').replace(':journal/page-title-format "MMMM do, yyyy"', ':journal/page-title-format "yyyy-MM-dd"'));
await page.evaluate(() => window.leanApp.rescan());
await sleep(900);
check((await days(page))[0] === iso, 'journal titles in a new format show at once', (await days(page)).join(' / '));
check(await page.evaluate(() => window.leanApp.summary.today) === iso, 'the app’s own idea of today’s name follows');
await page.screenshot({ path: SHOTS + '/gaps-settings-changed-laptop.png' });
write('logseq/config.edn', cfg);
await page.evaluate(() => window.leanApp.rescan());
await sleep(900);
check((await days(page))[0] === title(now), 'and back again', (await days(page)).join(' / '));
check(daily() === before, 'no journal file was made or renamed by it', daily());

console.log('settings that can’t be read just now: the notes aren’t opened with guessed ones');
fs.rmSync(CFG);
fs.mkdirSync(CFG); // (on Google Drive: config.edn not fetched just then)
await page.goto(BASE + '/?t=' + Date.now() + '#/journals');
await page.waitForSelector('.card .err', { timeout: 15000 });
const err = await page.locator('.card .err').first().textContent();
check(/notes settings \(logseq\/config\.edn\)/.test(err) && /Try again/.test(err), 'Settings says why', err);
check(await page.locator('h1.page-title').first().textContent() === 'Settings', '…under “Settings”, not the first-start “Welcome”');
check(await page.locator('text=Choose the folder that holds your notes').count() === 0, 'and doesn’t ask to choose the folder as if none was chosen');
const again = page.locator('.card [data-a="again"]');
check(await again.isVisible(), 'a Try again button');
check(await page.locator('.sheet.day').count() === 0, 'no journals shown with guessed settings');
check(daily() === before && !fs.existsSync(VAULT + '/journals'), 'nothing written: no journal in the wrong folder', daily());
await page.screenshot({ path: SHOTS + '/gaps-config-unreadable-laptop.png' });
// still not readable: Try again says so again
await again.click();
await page.waitForSelector('.card .err', { timeout: 15000 });
check(await page.locator('.card [data-a="again"]').isVisible(), 'trying again while it still can’t be read: the same message and button');
// readable again: Try again opens the notes as at a start
fs.rmdirSync(CFG);
fs.writeFileSync(CFG, cfg);
await page.locator('.card [data-a="again"]').click();
await page.waitForSelector('.sheet.day .outline', { timeout: 15000 });
await sleep(500);
check((await days(page))[0] === title(now), 'Try again opens the journals, with his settings', (await days(page)).join(' / '));
check(await page.evaluate(() => location.hash) === '#/journals', 'on the Journals list', await page.evaluate(() => location.hash));

console.log('phone');
fs.rmSync(CFG);
fs.mkdirSync(CFG);
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p2 = await phone.newPage();
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto(BASE + '/');
await p2.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
await p2.goto(BASE + '/?t=' + Date.now() + '#/journals');
await p2.waitForSelector('.card [data-a="again"]', { timeout: 15000 });
const b = await p2.locator('.card [data-a="again"]').boundingBox();
const vw = await p2.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
check(b && b.height >= 44 && b.x >= 0 && b.x + b.width <= 390, 'the button fits the phone and is big enough to tap', JSON.stringify(b));
check(vw[0] <= vw[1], 'no sideways scrolling', vw.join(' > '));
await p2.screenshot({ path: SHOTS + '/gaps-config-unreadable-phone.png' });
fs.rmdirSync(CFG);
fs.writeFileSync(CFG, cfg);
await p2.locator('.card [data-a="again"]').tap();
await p2.waitForSelector('.sheet.day .outline', { timeout: 15000 });
check((await days(p2))[0] === title(now), 'Try again on the phone opens the journals');

const unexpected = errors.filter((e) => !e.includes('status of 400')); // (the refused opening answers 400)
check(unexpected.length === 0, 'no script errors', unexpected.join(' | '));
await browser.close();
console.log(failures() ? `${failures()} FAILED` : 'all passed');
process.exit(failures() ? 1 : 0);

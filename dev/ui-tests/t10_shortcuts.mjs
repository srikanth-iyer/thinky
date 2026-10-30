// Android's long-press shortcuts on the app icon ("Today", "Search"): MainActivity keeps the one
// picked and the page takes it when it's ready (App.openShortcut): at the end of start(), or at once
// when the app was already open (onNewIntent calls openShortcut). The Android bridge
// (window.LeanAndroid) is a stand-in that hands out window.__shortcut and records the rest.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, BASE, VAULT, SHOTS } from './lib.mjs';

async function start(shortcut, vault = VAULT) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((s) => {
    window.__shortcut = s;
    window.__calls = [];
    const rec = (name) => (...a) => { window.__calls.push([name, ...a]); };
    window.LeanAndroid = {
      hasAllFilesAccess: () => true, openAllFilesSettings: rec('settings'), leave: rec('leave'),
      setBarColors: rec('bars'), setWidgetColors: rec('widgetColors'), setWidgetTasks: rec('tasks'),
      setWidgetConfig: rec('widgetConfig'), setCaptureConfig: rec('capture'), refreshWidget: rec('refresh'),
      takeShortcut: () => { const k = window.__shortcut; window.__shortcut = null; window.__calls.push(['take', k]); return k; },
      showKeyboard: rec('keyboard'),
    };
  }, shortcut);
  await page.goto(BASE + '/');
  await page.evaluate((v) => { localStorage.clear(); if (v) localStorage.setItem('vault', JSON.stringify(v)); }, vault);
  await page.goto(BASE + '/?t=' + Date.now()); // no address: like the app's first page
  await page.waitForSelector('#main .view > *');
  await sleep(1200);
  return { browser, page, errors };
}
const allErrors = [];
const calls = (page, name) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), name);
const hashNow = (page) => page.evaluate(() => decodeURIComponent(location.hash));
const searchOpen = (page) => page.evaluate(() => !document.querySelector('#search').hidden && document.activeElement === document.querySelector('#search input'));

console.log('shortcut "Today" with the app not running: it starts on today’s journal page');
let { browser, page, errors } = await start('today');
const todayName = await page.evaluate(() => window.leanApp.summary.today);
check((await hashNow(page)) === '#/page/' + todayName && await page.locator('h1.page-title', { hasText: todayName }).count() === 1, 'today’s journal page is open', await hashNow(page));
check((await calls(page, 'take')).length === 1 && await page.evaluate(() => window.leanApp.histN === 1), 'the shortcut is taken once, and Back goes to the journals');
await page.screenshot({ path: SHOTS + '/shortcut-today.png' });

console.log('shortcut "Search" with the app open: the search box, ready to type');
await page.evaluate(() => { location.hash = '#/page/Maths'; });
await sleep(600);
await page.evaluate(() => { window.__shortcut = 'search'; window.leanApp.openShortcut(); }); // what onNewIntent does
await sleep(300);
check(await searchOpen(page) && (await hashNow(page)) === '#/page/Maths', 'the search box opens over the page, with the cursor in it');
check((await calls(page, 'keyboard')).length === 1, 'and asks Android for the keyboard');
await page.screenshot({ path: SHOTS + '/shortcut-search.png' });

console.log('shortcut "Today" while searching: the search box closes');
await page.evaluate(() => { window.__shortcut = 'today'; window.leanApp.openShortcut(); });
await sleep(800);
check((await hashNow(page)) === '#/page/' + todayName && await page.locator('#search').isHidden(), 'today’s page, search box closed', await hashNow(page));

console.log('nothing picked, or the page still starting: nothing happens, nothing is lost');
await page.evaluate(() => window.leanApp.openShortcut());
await sleep(300);
check((await hashNow(page)) === '#/page/' + todayName && await page.locator('#search').isHidden(), 'no shortcut picked: the page stays as it is');
await page.evaluate(() => { window.leanApp.started = false; window.__shortcut = 'search'; window.leanApp.openShortcut(); });
await sleep(300);
check(await page.evaluate(() => window.__shortcut) === 'search' && await page.locator('#search').isHidden(), 'while starting, the shortcut is left for start() to take');
await page.evaluate(() => { window.leanApp.started = true; window.leanApp.openShortcut(); });
await sleep(300);
check(await searchOpen(page), 'and taken once the page is ready');
await browser.close();
allErrors.push(...errors);

console.log('shortcut "Search" with the app not running: the search box stays open while the journals load');
({ browser, page, errors } = await start('search'));
check(await searchOpen(page) && (await hashNow(page)) === '#/journals' && await page.locator('.sheet .outline').count() > 0, 'the journals behind, the search box in front with the cursor in it', await hashNow(page));
check((await calls(page, 'keyboard')).length === 1, 'and the keyboard asked for once');
await browser.close();
allErrors.push(...errors);

console.log('a shortcut before a notes folder was chosen: ignored');
({ browser, page, errors } = await start('search', null));
check((await hashNow(page)) === '#/welcome' && await page.locator('#search').isHidden() && await page.evaluate(() => window.__shortcut) === null, 'the welcome screen shows (to choose or make a notes folder; Build 32, before: Settings); the shortcut is used up', await hashNow(page));
await browser.close();
allErrors.push(...errors);

check(!allErrors.length, 'no script errors', allErrors.join(' | '));
process.exit(failures() ? 1 : 0);

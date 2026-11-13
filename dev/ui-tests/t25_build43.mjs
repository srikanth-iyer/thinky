// Build 43 (the maintainer's notes of Nov 10): the Tags list filters and sorts like Properties, a
// property's own page sets how it shows (the same rule as Settings → Writing → Property display), and
// Settings' tab row on a phone shows that it scrolls.
import { open, check, failures, sleep, go } from './lib.mjs';

// ---------- Tags: filter and sort ----------
{
  const { browser, page, errors } = await open();
  await go(page, '#/tags');
  await page.waitForSelector('.list-tools .filter');
  const names = () => page.$$eval('ul.rows li a[data-page]', (as) => as.map((a) => a.dataset.page));
  const all = await names();
  check(all.length >= 3, 'the Tags list shows the tags', all.join(', '));
  check(JSON.stringify(all) === JSON.stringify([...all].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))), 'A to Z by default', all.join(', '));
  await page.fill('.list-tools .filter', 'bak');
  await sleep(100);
  const some = await names();
  check(some.length >= 1 && some.every((t) => t.toLowerCase().includes('bak')), 'the box narrows the tags as he types', some.join(', '));
  await page.fill('.list-tools .filter', 'zzzz');
  await sleep(100);
  check((await page.locator('ul.rows').textContent()).includes('No tags match'), 'nothing matches: it says so');
  await page.fill('.list-tools .filter', '');
  await page.click('.list-tools [data-s="count"]');
  await sleep(100);
  const used = await page.$$eval('ul.rows li a[data-page] .meta', (ms) => ms.map((m) => [...m.textContent.matchAll(/(\d+)/g)].reduce((s, x) => s + Number(x[1]), 0)));
  check(used.every((n, i) => i === 0 || used[i - 1] >= n), 'Most used: the most used first', used.join(','));
  check(await page.getAttribute('.list-tools [data-s="count"]', 'aria-pressed') === 'true', 'the order button says it is on');
  await go(page, '#/journals');
  await go(page, '#/tags');
  await page.waitForSelector('.list-tools .filter');
  check(await page.getAttribute('.list-tools [data-s="count"]', 'aria-pressed') === 'true', 'the order is remembered');
  check(errors.length === 0, 'no script errors (tags)', errors.join('\n'));
  await browser.close();
}

// ---------- a property's page: how it shows ----------
{
  const { browser, page, errors } = await open();
  await go(page, '#/props/status');
  await page.waitForSelector('.prop-show-row .pr-show');
  check(await page.inputValue('.prop-show-row .pr-show') === 'show', 'a property with no rule: Show');
  await page.selectOption('.prop-show-row .pr-show', 'quiet');
  await sleep(400);
  const saved = () => page.evaluate(async () => (await (await fetch('/api/folder_settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()));
  let s = await saved();
  const rule = (x) => (x.propertyDisplay || x.result?.propertyDisplay || x.ok?.propertyDisplay || {}).status;
  check(rule(s)?.show === 'quiet', 'chosen on its page: saved in the notes folder', JSON.stringify(s));
  await page.selectOption('.prop-show-row .pr-mark', 'blue');
  await sleep(400);
  check(rule(await saved())?.mark === 'blue', 'a mark too');
  // Settings shows the same rule, and a change there shows on the property's page
  await go(page, '#/settings/look');
  await page.waitForSelector('.prop-rules li[data-k="status"]');
  check(await page.inputValue('.prop-rules li[data-k="status"] .pr-show') === 'quiet', 'Settings shows the rule chosen on the page');
  await page.selectOption('.prop-rules li[data-k="status"] .pr-show', 'hidden');
  await sleep(400);
  await go(page, '#/props/status');
  await page.waitForSelector('.prop-show-row .pr-show');
  check(await page.inputValue('.prop-show-row .pr-show') === 'hidden', 'changed in Settings: the page shows it');
  // back to usual (Show, no mark) leaves no rule behind
  await page.selectOption('.prop-show-row .pr-mark', '');
  await sleep(300);
  await page.selectOption('.prop-show-row .pr-show', 'show');
  await sleep(400);
  check(!rule(await saved()), 'back to Show with no mark: the rule goes');
  await go(page, '#/props/id');
  await sleep(300);
  check((await page.locator('.prop-show-row').textContent()).includes('always hides'), 'id:: says the app always hides it');
  check(errors.length === 0, 'no script errors (property page)', errors.join('\n'));
  await browser.close();
}

// ---------- Settings' tabs on a phone ----------
{
  const { browser, page, errors } = await open({ viewport: { width: 360, height: 740 }, touch: true });
  await go(page, '#/settings/notes');
  await page.waitForSelector('.set-tabs-wrap');
  await sleep(1200); // (the first-time nudge goes out and back)
  const st = () => page.evaluate(() => {
    const bar = document.querySelector('.set-tabs');
    const shown = (s) => { const b = document.querySelector(s); return !!b && !b.hidden && getComputedStyle(b).display !== 'none'; };
    return { left: bar.scrollLeft, more: bar.scrollWidth > bar.clientWidth, prev: shown('.tab-arrow.prev'), next: shown('.tab-arrow.next'), nudged: localStorage.getItem('setTabsNudged') };
  });
  let a = await st();
  check(a.more, 'on a phone the tabs don\'t all fit', JSON.stringify(a));
  check(a.next && !a.prev, 'a › shows at the end, no ‹ at the start', JSON.stringify(a));
  check(a.nudged === 'true' && a.left < 4, 'the row was nudged once and came back', JSON.stringify(a));
  check(await page.evaluate(() => document.querySelector('.set-tabs').getBoundingClientRect().height < 60), 'still one line');
  await page.click('.tab-arrow.next');
  await sleep(700);
  a = await st();
  check(a.left > 20 && a.prev, 'the › scrolls the row; then a ‹ shows', JSON.stringify(a));
  await page.click('.tab-arrow.prev');
  await sleep(700);
  check((await st()).left < 4, 'the ‹ scrolls back');
  check(await page.evaluate(() => document.querySelector('.tab-arrow.next').getAttribute('aria-hidden') === 'true'), 'screen readers skip the arrows (the tabs are reachable)');
  check(errors.length === 0, 'no script errors (phone tabs)', errors.join('\n'));
  await browser.close();
}
// a laptop: every tab fits, no arrows
{
  const { browser, page, errors } = await open();
  await go(page, '#/settings/notes');
  await page.waitForSelector('.set-tabs-wrap');
  await sleep(300);
  check(await page.evaluate(() => [...document.querySelectorAll('.tab-arrow')].every((b) => b.hidden)), 'a laptop: no arrows');
  check(errors.length === 0, 'no script errors (laptop tabs)', errors.join('\n'));
  await browser.close();
}
// ---------- a hidden sidebar peeks out on the mouse (as in Notion) ----------
{
  const { browser, page, errors } = await open();
  await page.click('#histbar [data-a="side"]'); // hide it
  await sleep(500);
  check(!(await page.evaluate(() => document.body.classList.contains('side-peek'))), 'hidden by a click: it doesn\'t peek straight back out');
  await page.mouse.move(900, 500); // (away, then back to the button)
  await sleep(200);
  const st = () => page.evaluate(() => {
    const side = document.getElementById('side'), r = side.getBoundingClientRect(), cs = getComputedStyle(side);
    return { hidden: document.body.classList.contains('side-hidden'), peek: document.body.classList.contains('side-peek'), seen: cs.visibility === 'visible' && r.right > 50, view: document.querySelector('#main .view')?.getBoundingClientRect().left };
  });
  const before = await st();
  check(before.hidden && !before.seen, 'hidden: the sidebar is out of sight', JSON.stringify(before));
  await page.hover('#histbar [data-a="side"]');
  await sleep(450);
  let a = await st();
  check(a.peek && a.seen, 'the mouse on its button: the sidebar peeks out', JSON.stringify(a));
  check(a.hidden && Math.abs(a.view - before.view) < 2, 'it floats over the notes: nothing moves, still hidden', JSON.stringify(a));
  // into it and click a link: it works, and the sidebar stays while the mouse is on it
  const link = page.locator('#side .nav a').nth(1);
  const want = await link.getAttribute('href');
  await link.hover();
  await sleep(400);
  check((await st()).peek, 'moving into it keeps it out');
  await link.click();
  await sleep(500);
  check((await page.evaluate(() => location.hash)) === want && (await st()).peek, 'a link in it works, and it stays out under the mouse', want);
  await page.mouse.move(900, 500);
  await sleep(700);
  a = await st();
  check(!a.peek && !a.seen && a.hidden, 'the mouse leaves: it slides away, still hidden', JSON.stringify(a));
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('sideHidden'))) === true, 'peeking doesn\'t change the saved choice');
  // Esc puts it away; a click on the button still pins it open
  await page.mouse.move(900, 500);
  await page.hover('#histbar [data-a="side"]');
  await sleep(450);
  await page.keyboard.press('Escape');
  await sleep(300);
  check(!(await st()).peek, 'Esc puts it away');
  await page.click('#histbar [data-a="side"]');
  await sleep(500);
  a = await st();
  check(!a.hidden && !a.peek && a.seen, 'a click pins it open as before', JSON.stringify(a));
  check(errors.length === 0, 'no script errors (peek)', errors.join('\n'));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

// Build 41 (the maintainer's picks of Nov 9): the laptop's top strip with buttons that never move, search
// opening in place out of the magnifier, pop-ups opening out of their button, and the version shown.
import { open, check, failures, sleep, BASE, SHOTS } from './lib.mjs';

const place = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), shown: !!el.offsetParent && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' };
}, sel);
const PAGE = '#/page/' + encodeURIComponent('Pickles in brine');

// ---------- the strip ----------
{
  const { browser, page, errors } = await open({ look: 'thinky' });
  await sleep(800);
  const spots = async () => ({
    side: await place(page, '#histbar [data-a="side"]'),
    search: await place(page, '#histbar .hb-app [data-a="search"]'),
    back: await place(page, '#histbar .hb-nav[data-p="0"] [data-h="back"]'),
    fwd: await place(page, '#histbar .hb-nav[data-p="0"] [data-h="forward"]'),
    home: await place(page, '#histbar .hb-nav[data-p="0"] [data-a="home"]'),
    date: await place(page, '#histbar .hb-nav[data-p="0"] [data-a="date"]'),
    plus: await place(page, '#histbar .tab-new[data-p="0"]'),
  });
  const a = await spots();
  const edge = await page.evaluate(() => document.getElementById('side').getBoundingClientRect().right);
  check(!a.back.shown && !a.fwd.shown, 'today\'s journal, nowhere to go back: Back and Forward hidden', JSON.stringify(a));
  check(a.date.shown && !a.home.shown, 'today\'s journal: the calendar shows in Home\'s spot');
  check(a.back.x > a.search.x && a.fwd.x > a.back.x && a.date.x > a.fwd.x, 'sidebar, Search, Back, Forward, then the calendar');
  check(Math.abs(a.plus.x - (edge + 6)) <= 1, 'the "+" starts just outside the sidebar\'s edge', `${a.plus.x} vs ${edge}`);
  check(!(await place(page, '#histbar .hb-logo')), 'no logo in the strip');
  check((await place(page, '#side .brand'))?.shown, 'the logo and name at the top of the sidebar');
  check(!(await place(page, '#side .searchbtn'))?.shown, 'no Search row in the sidebar on a laptop');
  check((await page.locator('#histbar .tabs[data-p="0"] .tab').count()) === 0, 'one tab: no tab names');
  // the sidebar hidden: nothing in the strip moves
  await page.click('#histbar [data-a="side"]');
  await sleep(600);
  const b = await spots();
  check(['side', 'search', 'back', 'fwd', 'date', 'plus'].every((k) => b[k].x === a[k].x), 'sidebar hidden: every button and the "+" stay where they were', JSON.stringify(b));
  await page.click('#histbar [data-a="side"]');
  await sleep(600);
  // a page: Back shows in its spot, Home takes the calendar's
  await page.evaluate((h) => { location.hash = h; }, PAGE);
  await sleep(700);
  const c = await spots();
  check(c.back.shown && !c.fwd.shown && c.back.x === a.back.x, 'on a page: Back appears in its own spot, Forward still hidden');
  check(c.home.shown && !c.date.shown && c.home.x === a.date.x, 'on a page: Home in the calendar\'s spot');
  await page.click('#histbar .hb-nav[data-p="0"] [data-h="back"]');
  await sleep(600);
  const d = await spots();
  check(d.fwd.shown && d.fwd.x === a.fwd.x, 'after going back: Forward appears in its spot');
  // "+": a new tab on today's journal, nothing else opens; two tabs show their names from the sidebar's edge
  await page.click('#histbar .tab-new[data-p="0"]');
  await sleep(700);
  check(await page.evaluate(() => document.getElementById('search').hidden), '"+" opens a tab, not search');
  check((await page.locator('#histbar .tabs[data-p="0"] .tab').count()) === 2, 'two tabs: their names show');
  const t0 = await place(page, '#histbar .tabs[data-p="0"] .tab');
  check(Math.abs(t0.x - (edge + 6)) <= 3, 'the tabs start just outside the sidebar\'s edge', `${t0.x} vs ${edge}`);
  await page.screenshot({ path: SHOTS + '/t24_strip.png', clip: { x: 0, y: 0, width: 900, height: 120 } });
  check(errors.length === 0, 'no script errors (strip)', errors.join('\n'));
  await browser.close();
}

// ---------- search in place ----------
{
  const { browser, page, errors } = await open({ look: 'thinky' });
  await sleep(800);
  const mag = await page.evaluate(() => { const r = document.querySelector('#histbar .hb-app [data-a="search"] svg').getBoundingClientRect(); return [r.left, r.top]; });
  await page.click('#histbar .hb-app [data-a="search"]');
  await sleep(400);
  const s = await page.evaluate(() => {
    const el = document.getElementById('search'), box = el.querySelector('.search-box'), ic = el.querySelector('.sb-ic svg').getBoundingClientRect(), b = box.getBoundingClientRect();
    return { inplace: el.classList.contains('inplace'), ic: [ic.left, ic.top], box: [b.left, b.top, b.width], dim: getComputedStyle(el).backgroundColor, focus: document.activeElement === el.querySelector('input') };
  });
  check(s.inplace, 'Search opens in place on a laptop');
  check(Math.abs(s.ic[0] - mag[0]) < 1 && Math.abs(s.ic[1] - mag[1]) < 1, 'its magnifier sits exactly over the strip\'s', JSON.stringify([s.ic, mag]));
  check(s.box[2] >= 400, 'it opens wide, to the right', JSON.stringify(s.box));
  check(/rgba\(0, 0, 0, 0\)|transparent/.test(s.dim), 'nothing dims the page', s.dim);
  check(s.focus, 'the cursor is in it');
  await page.keyboard.type('pickles');
  await sleep(500);
  check((await page.locator('#search .results li.r-page').count()) > 0, 'typing shows pages in it');
  await page.screenshot({ path: SHOTS + '/t24_search.png', clip: { x: 0, y: 0, width: 900, height: 420 } });
  await page.keyboard.press('Escape');
  await sleep(500);
  check(await page.evaluate(() => document.getElementById('search').hidden && !document.querySelector('.fade-host')), 'Esc closes it, and its folding copy is gone after');
  // Ctrl+K opens it in place too; a press outside closes it
  await page.keyboard.press('Control+k');
  await sleep(400);
  check(await page.evaluate(() => document.getElementById('search').classList.contains('inplace')), 'Ctrl+K opens it in place');
  await page.mouse.click(700, 500);
  await sleep(400);
  check(await page.evaluate(() => document.getElementById('search').hidden), 'a press outside closes it');
  // the magnifier pressed again closes it (and doesn't open it again)
  await page.click('#histbar .hb-app [data-a="search"]');
  await sleep(400);
  await page.click('#histbar .hb-app [data-a="search"]', { force: true });
  await sleep(500);
  check(await page.evaluate(() => document.getElementById('search').hidden), 'the magnifier pressed again closes it');
  // picking a page goes there
  await page.keyboard.press('Control+k');
  await sleep(300);
  await page.keyboard.type('pickles');
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(700);
  check(decodeURIComponent(await page.evaluate(() => location.hash)).includes('Pickles in brine'), 'Enter opens the page');
  // the command list stays the centred box
  await page.keyboard.press('Control+Shift+P');
  await sleep(400);
  check(await page.evaluate(() => { const el = document.getElementById('search'); return !el.hidden && !el.classList.contains('inplace'); }), 'the command list is the centred box');
  await page.keyboard.press('Escape');
  await sleep(300);
  check(errors.length === 0, 'no script errors (search)', errors.join('\n'));
  await browser.close();
}

// ---------- the phone keeps its search screen ----------
{
  const { browser, page, errors } = await open({ touch: true, viewport: { width: 390, height: 800 } });
  await sleep(600);
  await page.locator('#topbar [data-a="search"]').tap();
  await sleep(400);
  check(await page.evaluate(() => { const el = document.getElementById('search'); return !el.hidden && !el.classList.contains('inplace'); }), 'phone: search is its own screen, as before');
  check(errors.length === 0, 'no script errors (phone)', errors.join('\n'));
  await browser.close();
}

// ---------- pop-ups open out of their button ----------
{
  const { browser, page, errors } = await open({ look: 'thinky' });
  await page.evaluate((h) => { location.hash = h; }, PAGE);
  await sleep(900);
  const btn = page.locator('.title-row .icon-btn[aria-label="Page actions"]');
  const bi = await btn.evaluate((e) => { const r = e.querySelector('svg').getBoundingClientRect(); return [r.left, r.top]; });
  await btn.click();
  await sleep(400);
  const m = await page.evaluate(() => { const ic = document.querySelector('.pop.menu .pop-hic svg')?.getBoundingClientRect(); return ic && [ic.left, ic.top]; });
  check(m && Math.abs(m[0] - bi[0]) < 1 && Math.abs(m[1] - bi[1]) < 1, 'the page ⋯ menu opens out of its button: its icon exactly over the button\'s', JSON.stringify([m, bi]));
  await page.keyboard.press('Escape');
  await sleep(400);
  check(await page.evaluate(() => !document.querySelector('.pop.menu') && !document.querySelector('.fade-host')), 'Esc: the menu folds away and is gone');
  // a note's dot (right-click): the note menu opens out of the dot
  const dot = page.locator('.outline .blk > .bul').first();
  const db = await dot.boundingBox();
  await dot.click({ button: 'right' });
  await sleep(400);
  const nm = await page.evaluate(() => { const r = document.querySelector('.note-menu .pop-hic')?.getBoundingClientRect(); return r && [r.left, r.top]; });
  check(nm && Math.abs(nm[0] - db.x) < 1 && Math.abs(nm[1] - db.y) < 1, 'the note menu opens out of the dot', JSON.stringify([nm, db]));
  check((await page.locator('.note-menu .pop-head .nm-colors').count()) === 1, 'the colours sit beside the dot');
  await page.keyboard.press('Escape');
  await sleep(400);
  // Go to date: out of the calendar button, its title beside it
  await page.evaluate(() => { location.hash = '#/journals'; });
  await sleep(800);
  const cal = page.locator('#histbar .hb-nav[data-p="0"] [data-a="date"]');
  await cal.click();
  await sleep(400);
  check((await page.locator('.datepick .pop-head .pop-title').count()) === 1, 'Go to date opens out of its button, its title beside it');
  await page.screenshot({ path: SHOTS + '/t24_date.png', clip: { x: 0, y: 0, width: 600, height: 420 } });
  const cb = await cal.boundingBox(); // (pressed where it is, as a mouse would: the picker's copy of it is over it now)
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await sleep(400);
  check(!(await page.locator('.datepick').count()), 'the calendar button pressed again closes it');
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await sleep(400);
  check((await page.locator('.datepick').count()) === 1, '… and a third press opens it again');
  await page.keyboard.press('Escape');
  await sleep(300);
  // animations off: nothing is left behind and everything still opens
  await page.evaluate(() => { document.documentElement.dataset.motion = 'off'; });
  await btn.count();
  await page.click('#histbar .hb-app [data-a="search"]');
  await sleep(200);
  check(await page.evaluate(() => !document.getElementById('search').hidden), 'animations off: search still opens');
  await page.keyboard.press('Escape');
  await sleep(200);
  check(await page.evaluate(() => !document.querySelector('.fade-host')), 'animations off: no copy left behind');
  check(errors.length === 0, 'no script errors (pop-ups)', errors.join('\n'));
  await browser.close();
}

// ---------- the version ----------
{
  const { browser, page, errors } = await open();
  const v = await page.evaluate(async () => (await import('/version.js')).VERSION);
  check(/^\d+\.\d+\.\d+$/.test(v), 'ui/version.js has a version', v);
  await page.evaluate(() => { location.hash = '#/settings/about'; });
  await sleep(900);
  check((await page.locator('.card h2:has-text("About") + .note').textContent()).includes(v), 'About shows it');
  check(errors.length === 0, 'no script errors (version)', errors.join('\n'));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

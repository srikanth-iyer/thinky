// Build 39 (the maintainer's note of Nov 8: "check all the menu buttons to see if they close if I press
// them again"): every button that opens something closes it when pressed again, and opens it again
// on a third press, on a laptop (mouse) and a phone (finger). Each press lands where the button is,
// as a finger or mouse would, even when what opened is drawn over it (search's dimmed backdrop).
// Also: the "/" toolbar button pressed again takes away the "/" it typed (only when nothing came after).
import { open, check, failures, sleep, write, BASE, SHOTS } from './lib.mjs';

write('pages/Garden.md', '- parent\n');
write('pages/Garden___Beds.md', '- a\n');
write('pages/Garden___Tools.md', '- b\n');
write('pages/Mentions.md', '- see [[Rosa Penhallow]]\n');
write('pages/Mentions again.md', '- and [[Rosa Penhallow]] again\n');

const PAGE = '#/page/' + encodeURIComponent('Pickles in brine');
const ROSA = '#/page/' + encodeURIComponent('Rosa Penhallow');

async function fresh(page, place) {
  await page.goto(BASE + '/?t=' + Date.now() + place);
  await page.waitForSelector('.view');
  await sleep(900);
}
const editFirst = async (page) => {
  await page.locator('.outline .blk > .bc').first().tap({ position: { x: 40, y: 10 } });
  await page.waitForSelector('textarea.ed');
  await sleep(300);
};

async function toggles(page, phone, name, place, opener, popup, before) {
  await fresh(page, place);
  if (before) await before(page);
  const btn = page.locator(opener).first();
  if (!(await btn.count())) { check(false, `${name}: its button is there`); return; }
  await btn.scrollIntoViewIfNeeded();
  await sleep(200);
  const r = await btn.boundingBox();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const press = async () => { if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); await sleep(450); };
  const shown = () => popup === 'body.drawer'
    ? page.evaluate(() => document.body.classList.contains('drawer'))
    : page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => !e.hidden && e.getBoundingClientRect().height > 0), popup);
  await press(); const a = await shown();
  await press(); const b = await shown();
  await press(); const c = await shown();
  check(a && !b && c, `${phone ? 'phone' : 'laptop'}: ${name} opens, closes when pressed again, opens on a third press`, JSON.stringify({ first: a, second: b, third: c }));
}

for (const phone of [false, true]) {
  console.log(phone ? 'phone' : 'laptop');
  const { browser, page, errors } = await open(phone ? { look: 'thinky', viewport: { width: 390, height: 844 }, touch: true } : { look: 'thinky' });
  await toggles(page, phone, 'the page ⋯ menu', PAGE, '.title-row [data-a="more"]', '.pop.menu');
  await toggles(page, phone, 'Go to date', '#/journals', phone ? '#topbar [data-a="date"]' : '#histbar [data-a="date"]', '.datepick');
  await toggles(page, phone, 'Search', '#/journals', phone ? '#topbar [data-a="search"]' : '#histbar [data-a="search"]', '#search:not([hidden])');
  await toggles(page, phone, 'linked references’ Sort', ROSA, '.ref-s', '.pop.menu.sort-menu');
  await toggles(page, phone, 'linked references’ Filter', ROSA, '.ref-f', '.ref-tools:not([hidden])');
  await toggles(page, phone, '"Pages in …" Sort', '#/page/Garden', '.ref-s', '.pop.menu.sort-menu');
  await toggles(page, phone, 'the To-dos filter', '#/todos', '.todo-f', '.todo-panel:not([hidden])');
  if (!phone) {
    await toggles(page, phone, 'Look', '#/journals', '[data-a="looks"]', '.pop.looks');
    await toggles(page, phone, 'a favourite’s ⋯', '#/journals', '.side-more', '.pop.menu', async (p) => { await p.locator('#favs a, #recent a').first().hover(); await sleep(300); });
  } else {
    await toggles(page, phone, 'the menu (drawer)', '#/journals', '#topbar [data-a="menu"]', 'body.drawer');
    await toggles(page, phone, 'the toolbar’s ⋯ (note menu)', PAGE, '#toolbar [data-t="more"]', '.note-menu', editFirst);
    await toggles(page, phone, 'the toolbar’s date button', PAGE, '#toolbar [data-t="date"]', '.pop.tb-menu', editFirst);
    await toggles(page, phone, 'the toolbar’s "/"', PAGE, '#toolbar [data-t="slash"]', '#ac:not([hidden])', editFirst);

    // "/" pressed again: its "/" goes too, the note's words as they were; nothing else changes
    await fresh(page, PAGE);
    await editFirst(page);
    const before = await page.locator('textarea.ed').inputValue();
    const slash = page.locator('#toolbar [data-t="slash"]');
    await slash.tap(); await sleep(400);
    check((await page.locator('textarea.ed').inputValue()).length === before.length + 1, 'the "/" button types a "/" and opens the list');
    await slash.tap(); await sleep(400);
    check(await page.locator('textarea.ed').inputValue() === before && await page.locator('#ac:not([hidden])').count() === 0, 'pressed again: the list and its "/" go, the words as they were');
    check(await page.locator('textarea.ed').count() === 1, 'the note is still being edited (the keyboard stays)');
    // with words typed after the "/": they stay, only the list closes
    await slash.tap(); await sleep(300);
    await page.keyboard.type('ta', { delay: 30 }); await sleep(300);
    const typed = await page.locator('textarea.ed').inputValue();
    await slash.tap(); await sleep(400);
    check(await page.locator('textarea.ed').inputValue() === typed && await page.locator('#ac:not([hidden])').count() === 0, 'with words after the "/": the list closes, the words stay', typed.slice(-12));
    // the other toolbar buttons still act on one press (one "#" from the # button)
    const t0 = await page.locator('textarea.ed').inputValue();
    await page.locator('#toolbar [data-t="tag"]').tap(); await sleep(300);
    const t1 = await page.locator('textarea.ed').inputValue();
    check(t1.length === t0.length + 1 && (t1.match(/#/g) || []).length === (t0.match(/#/g) || []).length + 1, 'other toolbar buttons act as before (one "#")');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: SHOTS + '/b39-phone.png' });
  }
  // ---- the same rules for every pop-up (Build 39's wider check) ----
  const outside = async (name, place, sel, pop, edit, how) => {
    await fresh(page, place); if (edit) await editFirst(page);
    const btn = page.locator(sel).first();
    if (how === 'right') await btn.click({ button: 'right' }); else if (phone) await btn.tap(); else await btn.click();
    await sleep(450);
    const link = await page.evaluate((s) => {
      const p = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().height > 0)?.getBoundingClientRect();
      for (const a of document.querySelectorAll('.outline a, .view a')) {
        const r = a.getBoundingClientRect();
        if (!r.width || r.top < 60 || r.bottom > innerHeight - 60) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (p && x > p.left - 4 && x < p.right + 4 && y > p.top - 4 && y < p.bottom + 4) continue;
        if (document.elementFromPoint(x, y) !== a && !a.contains(document.elementFromPoint(x, y))) continue;
        return { x, y };
      }
      return null;
    }, pop);
    if (!link) { check(false, `${name}: a link beside it to press`); return; }
    const h0 = await page.evaluate(() => location.hash);
    if (phone) await page.touchscreen.tap(link.x, link.y); else await page.mouse.click(link.x, link.y);
    await sleep(600);
    const open = await page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => !e.hidden && e.getBoundingClientRect().height > 0), pop);
    check(!open && await page.evaluate(() => location.hash) === h0, `${phone ? 'phone' : 'laptop'}: ${name}: a press on a link beside it only closes it`);
  };
  await outside('the page ⋯ menu', PAGE, '.title-row [data-a="more"]', '.pop.menu');
  await outside('Go to date', '#/journals', phone ? '#topbar [data-a="date"]' : '#histbar [data-a="date"]', '.datepick');
  await outside('linked references’ Sort', ROSA, '.ref-s', '.pop.menu.sort-menu');
  if (!phone) await outside('the note menu (right-click on a dot)', PAGE, '.outline .blk .bul', '.note-menu', false, 'right');
  else await outside('the toolbar’s date menu', PAGE, '#toolbar [data-t="date"]', '.pop.tb-menu', true);

  if (!phone) {
    // the buttons say what's open; Esc puts the keyboard back on the button that opened it
    for (const [name, place, sel, pop] of [['the page ⋯ menu', PAGE, '.title-row [data-a="more"]', '.pop.menu'], ['Go to date', '#/journals', '#histbar [data-a="date"]', '.datepick'], ['Sort', ROSA, '.ref-s', '.pop.menu'], ['Search', '#/journals', '#histbar [data-a="search"]', '#search:not([hidden])']]) {
      await fresh(page, place);
      const btn = page.locator(sel).first();
      await btn.focus(); await page.keyboard.press('Enter'); await sleep(400);
      const exp = await btn.getAttribute('aria-expanded');
      await page.keyboard.press('Escape'); await sleep(400);
      const exp2 = await btn.getAttribute('aria-expanded');
      const back = await btn.evaluate((b) => document.activeElement === b);
      check(exp === 'true' && exp2 === 'false' && back && await page.locator(pop).count() === 0, `${name}: aria-expanded true then false, Esc gives its button the keyboard back`, JSON.stringify({ exp, exp2, back }));
    }
    // the look list doesn't stay open under the search box
    await fresh(page, '#/journals');
    await page.locator('[data-a="looks"]').click(); await sleep(300);
    await page.keyboard.press('Control+k'); await sleep(400);
    check(await page.locator('.pop.looks').count() === 0 && await page.evaluate(() => !document.getElementById('search').hidden), 'Ctrl+K with the look list open: the search box, the list closed');
    await page.keyboard.press('Escape');
    // the look list fades out like the others
    await page.locator('[data-a="looks"]').click(); await sleep(300);
    await page.keyboard.press('Escape'); await sleep(30);
    check(await page.evaluate(() => document.querySelectorAll('.fade-host').length) === 1, 'the look list fades out as it closes');
  } else {
    // the menu (drawer) closes on Esc too (a tablet's keyboard)
    await fresh(page, '#/journals');
    await page.locator('#topbar [data-a="menu"]').tap(); await sleep(400);
    await page.keyboard.press('Escape'); await sleep(300);
    check(!(await page.evaluate(() => document.body.classList.contains('drawer'))), 'Esc closes the menu (drawer)');
    // finger-sized: the fold arrows and the section headings reach 40px with their invisible edge
    await fresh(page, PAGE);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.fold, .disclose')].filter((e) => e.getBoundingClientRect().height).map((e) => {
      const a = getComputedStyle(e, '::after'); const r = e.getBoundingClientRect();
      return [e.className, Math.round(r.height - parseFloat(a.top || 0) - parseFloat(a.bottom || 0))];
    }));
    check(sizes.length > 0 && sizes.every(([, h]) => h >= 40), 'fold arrows and headings are at least 40px tall to a finger', JSON.stringify(sizes));
  }
  check(errors.length === 0, 'no script errors', errors.join('\n'));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

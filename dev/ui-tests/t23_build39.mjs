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
  // ---- speed and polish (Build 39's review) ----
  // modules that aren't needed at start load on first use
  await fresh(page, '#/journals');
  const loaded = () => page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()));
  const atStart = await loaded();
  check(!['settings.js', 'history.js', 'clash.js', 'commands.js'].some((f) => atStart.includes(f)), 'Settings, History, the clash screen and the command list aren’t loaded at start', atStart.filter((f) => f.endsWith('.js')).join(' '));
  await page.evaluate(() => { location.hash = '#/settings/look'; });
  await page.waitForSelector('.skin-card');
  check((await loaded()).includes('settings.js'), 'Settings loads when opened');
  // the look previews: two to a row on a phone; off-screen ones not drawn until scrolled to
  const cols = await page.evaluate(() => new Set([...document.querySelectorAll('.skin-card')].slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().top))).size);
  check(phone ? cols === 2 : true, 'phone: two look previews to a row', String(cols));
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.skin-card')).contentVisibility) === 'auto', 'look previews out of view aren’t drawn until scrolled to');
  await page.locator('.skin-card').nth(1).click(); await sleep(200);
  check(await page.evaluate(() => document.documentElement.dataset.skin) === await page.locator('.skin-card').nth(1).getAttribute('data-skin'), 'picking a look still works');
  // the command list loads when commands mode first opens, and works
  await fresh(page, '#/journals');
  if (!phone) {
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('#search:not([hidden]) .results li[data-k]', { timeout: 5000 }).catch(() => {});
    check(await page.locator('#search .results li[data-k]').count() > 5, 'Ctrl+Shift+P: the command list (loaded on first use)');
    await page.keyboard.type('new tab'); await sleep(300);
    check((await page.locator('#search .results li[data-k]').first().textContent()).toLowerCase().includes('new tab'), 'typing finds a command');
    await page.keyboard.press('Escape');
    // search: arrowing down keeps the chosen row in view, and only the list scrolls (not the page)
    await page.keyboard.press('Control+k'); await page.keyboard.type('note', { delay: 20 }); await sleep(800);
    const y0 = await page.evaluate(() => [scrollY, document.getElementById('main').scrollTop]);
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown');
    await sleep(200);
    const vis = await page.evaluate(() => { const ul = document.querySelector('#search .results'), li = ul.querySelector('[aria-selected="true"]'); const a = ul.getBoundingClientRect(), b = li.getBoundingClientRect(); return b.top >= a.top - 1 && b.bottom <= a.bottom + 1; });
    const y1 = await page.evaluate(() => [scrollY, document.getElementById('main').scrollTop]);
    check(vis && JSON.stringify(y0) === JSON.stringify(y1), 'search: the chosen row stays in view; the page behind doesn’t move', JSON.stringify({ vis, y0, y1 }));
    await page.keyboard.press('Escape');
  }
  // the editing box grows and shrinks with its words (by CSS where the engine can)
  await fresh(page, PAGE);
  if (phone) await editFirst(page);
  else { await page.locator('.outline .blk > .bc').first().click({ position: { x: 40, y: 10 } }); await page.waitForSelector('textarea.ed'); }
  const h0 = await page.locator('textarea.ed').evaluate((t) => t.getBoundingClientRect().height);
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.type('a second line'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('a third');
  await sleep(200);
  const h1 = await page.locator('textarea.ed').evaluate((t) => [t.getBoundingClientRect().height, t.scrollHeight, t.clientHeight]);
  check(h1[0] > h0 + 20 && h1[1] <= h1[2] + 1, 'the editing box grows with new lines, nothing hidden', JSON.stringify({ h0, h1 }));
  for (let i = 0; i < 'a third'.length + 1 + 'a second line'.length + 1; i++) await page.keyboard.press('Backspace');
  await sleep(200);
  const h2 = await page.locator('textarea.ed').evaluate((t) => t.getBoundingClientRect().height);
  check(Math.abs(h2 - h0) < 2, 'and shrinks back', JSON.stringify({ h0, h2 }));
  await page.keyboard.press('Escape');
  // Home greys out at the top of the Journals list and not elsewhere, as before (now cheaper)
  await fresh(page, '#/journals');
  const homeSel = phone ? '#topbar [data-a="home"]' : '#histbar [data-a="home"]';
  const homeOff = () => page.locator(homeSel).first().isDisabled();
  check(await homeOff(), 'Home greyed at the top of the Journals list');
  await page.evaluate(() => { const m = document.getElementById('main'); (getComputedStyle(m).overflowY === 'visible' ? document.scrollingElement : m).scrollTop = 600; });
  await sleep(300);
  check(!(await homeOff()), 'Home active once scrolled down');
  if (phone) {
    // the toolbar's menu buttons say what they open and whether it's open
    await fresh(page, PAGE); await editFirst(page);
    const more = page.locator('#toolbar [data-t="more"]');
    check(await more.getAttribute('aria-haspopup') === 'menu' && await more.getAttribute('aria-expanded') === 'false', 'toolbar ⋯: aria-haspopup menu, closed');
    await more.tap(); await sleep(400);
    check(await more.getAttribute('aria-expanded') === 'true', 'toolbar ⋯: open while the note menu shows');
    await more.tap(); await sleep(400);
    check(await more.getAttribute('aria-expanded') === 'false', 'toolbar ⋯: closed again');
    const date = page.locator('#toolbar [data-t="date"]');
    await date.tap(); await sleep(400);
    check(await date.getAttribute('aria-expanded') === 'true', 'toolbar date: open while its menu shows');
    await date.tap(); await sleep(400);
    check(await date.getAttribute('aria-expanded') === 'false', 'toolbar date: closed again');
  }
  check(errors.length === 0, 'no script errors', errors.join('\n'));
  await browser.close();
}

// Also Build 39 (he asked, Nov 8): a night look for thinky (his pick: "Charcoal"), and Settings → Look's
// Light / Dark / Match system with a day look and a night look (his pick of two layouts).
{
  const { browser, page, errors } = await open({ look: 'thinky' });
  const st = () => page.evaluate(() => ({ skin: document.documentElement.dataset.skin, mode: JSON.parse(localStorage.getItem('lookMode') || 'null'), day: JSON.parse(localStorage.getItem('skinDay') || 'null'), night: JSON.parse(localStorage.getItem('skinNight') || 'null') }));
  // before Build 39 there was one look: it decides Light or Dark, and its family's other half fills the other slot
  const guess = (old) => page.evaluate(async (old) => { localStorage.removeItem('lookMode'); localStorage.setItem('skin', JSON.stringify(old)); return (await import('/app.js')).lookState(); }, old);
  check(JSON.stringify(await guess('thinky')) === JSON.stringify({ mode: 'light', day: 'thinky', night: 'thinkynight' }), 'an older thinky: Light, thinky by day, thinky night at night');
  check(JSON.stringify(await guess('plainnight')) === JSON.stringify({ mode: 'dark', day: 'plain', night: 'plainnight' }), 'an older Plain night: Dark, Plain by day');
  check(JSON.stringify(await guess('paper')) === JSON.stringify({ mode: 'light', day: 'paper', night: 'thinkynight' }), 'an older Paper (no night of its own): thinky night at night');
  check(JSON.stringify(await guess('grimoire')) === JSON.stringify({ mode: 'light', day: 'calm', night: 'night' }), 'a removed look still opens as Calm');
  check(JSON.stringify(await guess('azulejo')) === JSON.stringify({ mode: 'light', day: 'thinky', night: 'thinkynight' }), 'Azulejo (taken out in Build 44) opens as thinky');
  const slots = await page.evaluate(async () => { localStorage.setItem('lookMode', '"system"'); localStorage.setItem('skinDay', '"azulejo"'); localStorage.setItem('skinNight', '"night"'); const r = (await import('/app.js')).lookState(); ['lookMode', 'skinDay', 'skinNight'].forEach((k) => localStorage.removeItem(k)); return r; });
  check(JSON.stringify(slots) === JSON.stringify({ mode: 'system', day: 'thinky', night: 'night' }), 'a saved day look of Azulejo becomes thinky, the mode and the night look kept', JSON.stringify(slots));
  await page.evaluate(() => localStorage.setItem('skin', '"thinky"'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE + '/?t=' + Date.now() + '#/settings/look');
  await page.waitForSelector('.look-mode');
  await sleep(500);
  const shown = async (which) => page.locator(`.skin-cards[data-for="${which}"]`).isVisible();
  check(await page.locator('.look-mode [aria-checked="true"]').textContent() === 'Light' && await shown('day') && !(await shown('night')), 'Settings → Look: Light, only the day looks');
  await page.click('.look-mode [data-mode="dark"]'); await sleep(300);
  let s1 = await st();
  check(s1.skin === 'thinkynight' && s1.mode === 'dark' && !(await shown('day')) && await shown('night'), 'Dark: thinky night shows, only the night looks', JSON.stringify(s1));
  await page.click('.look-mode [data-mode="system"]'); await sleep(300);
  s1 = await st();
  check(s1.skin === 'thinky' && s1.mode === 'system' && await shown('day') && await shown('night'), 'Match system (system light): thinky, both lists', JSON.stringify(s1));
  await page.emulateMedia({ colorScheme: 'dark' }); await sleep(300);
  check((await st()).skin === 'thinkynight', 'the system turning dark while open: thinky night at once');
  // a day look picked while the system is dark: saved for the day, said so, nothing changes now
  await page.locator('.skin-cards[data-for="day"] .skin-card[data-skin="plain"]').click(); await sleep(300);
  s1 = await st();
  check(s1.skin === 'thinkynight' && s1.day === 'plain' && /Day look saved/.test(await page.locator('.toast, #toast').first().textContent().catch(() => '')), 'a day look picked at night: saved for the day, a message says so', JSON.stringify(s1));
  check(await page.locator('.skin-card[data-skin="plain"]').getAttribute('aria-pressed') === 'true' && await page.locator('.skin-card[data-skin="thinky"]').getAttribute('aria-pressed') === 'false', 'its card is marked');
  await page.emulateMedia({ colorScheme: 'light' }); await sleep(300);
  check((await st()).skin === 'plain', 'the system turning light: the day look, Plain');
  // before the first paint (boot.js): a fresh start with the system dark shows the night look straight away
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(BASE + '/?t=' + Date.now() + '#/journals');
  const first = await page.evaluate(() => document.documentElement.dataset.skin);
  check(first === 'thinkynight', 'a start with the system dark: thinky night from the first picture', first);
  // the sidebar's Look list: Day and Night groups; a night look picked with Light set turns Dark on
  await page.click('.look-mode [data-mode="light"]').catch(() => {});
  await page.evaluate(async () => (await import('/app.js')).lookState()); // (warm)
  await page.evaluate(() => window.leanApp?.setLookMode?.('light'));
  await page.goto(BASE + '/?t=' + Date.now() + '#/journals'); await page.waitForSelector('.sheet .outline'); await sleep(500);
  await page.click('#side [data-a="looks"]'); await sleep(300);
  const heads = await page.locator('.pop.looks .looks-h').allTextContents();
  check(heads.join('|') === 'Day look|Night look', 'the Look list: Day look, Night look', heads.join('|'));
  check(await page.locator('.pop.looks [data-look="plain"]').getAttribute('aria-pressed') === 'true' && await page.locator('.pop.looks [data-look="thinkynight"]').getAttribute('aria-pressed') === 'true', 'each group marks its look');
  await page.click('.pop.looks [data-look="stickernight"]'); await sleep(300);
  s1 = await st();
  check(s1.skin === 'stickernight' && s1.mode === 'dark' && s1.night === 'stickernight' && s1.day === 'plain', 'a night look picked with Light: Dark, that look', JSON.stringify(s1));
  await page.keyboard.press('Escape');
  // thinky night: its faint words and links readable (≥ 4.5:1 on its page), its corner drawing loads
  await page.evaluate(() => window.leanApp?.setSkin?.('thinkynight'));
  await page.evaluate(async () => (await import('/app.js'))); await sleep(200);
  const con = await page.evaluate(() => {
    document.documentElement.dataset.skin = 'thinkynight';
    const hex = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const L = (h) => { const n = parseInt(h.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const r = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    return { faint: r(hex('--ink-faint'), hex('--bg')), link: r(hex('--link'), hex('--bg')), ink: r(hex('--ink'), hex('--bg')), accentInk: r(hex('--accent-ink'), hex('--accent')) };
  });
  check(con.faint >= 4.5 && con.link >= 4.5 && con.ink >= 7 && con.accentInk >= 4.5, 'thinky night: words, faint words, links and words on its accent readable', JSON.stringify(con));
  const corner = await page.evaluate(async () => (await fetch('/skins/thinky-night-corner.svg')).status);
  check(corner === 200, 'its corner drawing is there');
  // the commands list has the three
  const cmds = await page.evaluate(async () => { const m = await import('/commands.js'); return m.commandList ? m.commandList(window.leanApp, null).filter((c) => /^Look: (Light|Dark|Match system)$/.test(c.label || c.name || '')).length : -1; }).catch(() => -2);
  check(cmds === 3, 'the commands: Look: Light, Dark, Match system', String(cmds));
  check(errors.length === 0, 'no script errors (looks)', errors.join('\n'));
  await browser.close();
}

// Also Build 39 (he asked, Nov 9, as in Logseq): on a phone, a sideways swipe on the note being typed in moves it
// out or in a level with the keyboard still up (a blank new note too); the whole line under the last note adds one
{
  write('pages/Swipe test.md', '- parent\n\t- child\n');
  const { browser, page, errors } = await open({ touch: true, viewport: { width: 390, height: 780 } });
  await page.goto(BASE + '/?t=' + Date.now() + '#/page/' + encodeURIComponent('Swipe test'));
  await page.waitForSelector('.outline .blk');
  await sleep(600);
  const cdp = await page.context().newCDPSession(page);
  const st = () => page.evaluate(() => { const o = window.leanApp.pane.outlines[0]; return { d: o.blocks.map((x) => x.depth).join(''), t: o.blocks.map((x) => x.text).join('|'), cur: o.cur, kb: document.activeElement?.tagName }; });
  await page.locator('.outline .blk > .bc').first().tap(); await page.waitForSelector('textarea.ed');
  await page.evaluate(() => { const t = document.querySelector('textarea.ed'); t.setSelectionRange(t.value.length, t.value.length); });
  await page.keyboard.press('Enter'); await sleep(300);
  let s1 = await st();
  check(s1.d === '011' && s1.cur === 1, 'Enter on a note with sub-notes: a blank note under it, being typed in', JSON.stringify(s1));
  const swipe = async (dx, hold = 0) => {
    const bb = await page.locator('textarea.ed').boundingBox(); const x0 = bb.x + 80, y0 = bb.y + bb.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    if (hold) await sleep(hold);
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * k / 8, y: y0 }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400);
  };
  await swipe(-110); s1 = await st();
  check(s1.d.startsWith('00') && s1.cur === 1 && s1.kb === 'TEXTAREA', 'swipe left on the blank note being typed in: out a level, still typing in it', JSON.stringify(s1));
  await swipe(110); s1 = await st();
  check(s1.d.startsWith('01') && s1.cur === 1 && s1.kb === 'TEXTAREA', 'swipe right: in a level again, still typing', JSON.stringify(s1));
  await swipe(-110, 500); const s2 = await st();
  check(s2.d === s1.d, 'a press held before moving (choosing words) moves nothing', JSON.stringify(s2));
  await page.keyboard.type('x'); await sleep(200);
  check((await st()).t.split('|')[1] === 'x', 'what is typed next goes into that note');
  await page.evaluate(() => { window.leanApp.outlines.forEach((o) => o.stopEdit()); document.activeElement?.blur(); }); await sleep(400);
  const n0 = (await st()).t.split('|').length;
  const ae = await page.locator('.add-end').first().boundingBox();
  check(ae && ae.width > 300, 'the line under the last note is as wide as the notes', JSON.stringify(ae));
  await page.touchscreen.tap(ae.x + ae.width - 20, ae.y + ae.height / 2); await sleep(500);
  s1 = await st();
  check(s1.t.split('|').length === n0 + 1 && s1.cur === n0 && s1.kb === 'TEXTAREA', 'a tap at the far end of that line: a new note, being typed in', JSON.stringify(s1));
  check(errors.length === 0, 'no script errors (swipe while typing, the + line)', errors.join('\n'));
  await browser.close();
}
{
  const { browser, page, errors } = await open({});
  await page.goto(BASE + '/?t=' + Date.now() + '#/page/' + encodeURIComponent('Swipe test'));
  await page.waitForSelector('.outline .blk'); await sleep(500);
  const n0 = await page.evaluate(() => window.leanApp.pane.outlines[0].blocks.length);
  const ae = await page.locator('.add-end').first().boundingBox();
  await page.mouse.click(ae.x + ae.width * 0.7, ae.y + ae.height / 2); await sleep(400);
  const n1 = await page.evaluate(() => [window.leanApp.pane.outlines[0].blocks.length, window.leanApp.pane.outlines[0].cur]);
  check(n1[0] === n0 + 1 && n1[1] === n0, 'laptop: a click well right of the "+" under the last note adds a note too', JSON.stringify(n1));
  check(errors.length === 0, 'no script errors (laptop + line)', errors.join('\n'));
  await browser.close();
}
{
  // the dots and level lines are softer than each look's own colour for them, in every look (he asked, Nov 9):
  // measured as drawn, against the page under them
  const { browser, page, errors } = await open({});
  await page.goto(BASE + '/?t=' + Date.now() + '#/page/' + encodeURIComponent('Sourdough Bread'));
  await page.waitForSelector('.outline .blk'); await sleep(400);
  const r = await page.evaluate(async () => {
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); if (c.startsWith('color(srgb')) m.splice(0, 0); const [r, g, b] = (c.startsWith('color(') ? m.slice(0, 3) : m.slice(0, 3).map((v) => v / 255)); const a = c.startsWith('color(') ? (m[3] ?? 1) : (m[3] ?? 1); return { rgb: [r, g, b], a }; };
    const L = ([r, g, b]) => { const f = (c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const cr = (x, y) => { const [a, b] = [L(x), L(y)].sort((p, q) => p - q); return (b + 0.05) / (a + 0.05); };
    const out = {};
    for (const id of ['calm', 'calmplain', 'thinky', 'thinkynight', 'night', 'paper', 'sticker', 'stickernight', 'automaton', 'plainnight', 'plainteal']) {
      const el = document.createElement('div'); el.dataset.skin = id;
      el.innerHTML = '<i style="background:var(--bullet)"></i><i style="background:var(--sheet-bg)"></i><i style="background:var(--guide)"></i>';
      document.body.append(el);
      const [b, s, g] = [...el.children].map((i) => lum(getComputedStyle(i).backgroundColor));
      const over = (c) => c.rgb.map((v, k) => v * c.a + s.rgb[k] * (1 - c.a));
      out[id] = [cr(over(b), s.rgb).toFixed(2), g.a === 0 ? '-' : cr(over(g), s.rgb).toFixed(2)];
      el.remove();
    }
    return out;
  });
  const bad = Object.entries(r).filter(([, [d, g]]) => +d > 2.35 || +d < 1.9 || (g !== '-' && (+g > 1.25 || +g < 1.1)));
  check(bad.length === 0, 'every look: dots about 2.2:1 and level lines about 1.2:1 from the page', JSON.stringify(r));
  check(errors.length === 0, 'no script errors (soft dots)', errors.join('\n'));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

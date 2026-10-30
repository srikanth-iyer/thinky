// Starting fresh (Build 32): the welcome screen on the first start (no notes folder chosen yet), on a
// laptop and a phone; "Create a new notes folder" (a folder made where he picks, set up in Logseq's
// layout with the short tour, opened at its first page); the folder picker taking any folder: a notes
// folder opens, one inside a notes folder offers that one, an empty one is started after asking, one
// holding other things warns first (Cancel leaves it untouched); "New folder" (names checked, never over
// one that's there); Android without file access; nothing changes for someone with a notes folder.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { check, failures, sleep, BASE, DIR, VAULT, SHOTS } from './lib.mjs';

const T = DIR + '/start'; // everything this test makes is in here
fs.rmSync(T, { recursive: true, force: true });
for (const d of ['new-here', 'empty', 'busy/old', 'made']) fs.mkdirSync(`${T}/${d}`, { recursive: true });
fs.writeFileSync(`${T}/busy/letter.txt`, 'mine');
fs.writeFileSync(`${T}/busy/old/a.md`, '- old\n');
const listing = (d) => fs.readdirSync(d).sort().join(',');
const allErrors = [];
const dayFile = (() => { const d = new Date(); return `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}`; })();

/** A fresh window with no notes folder chosen (the first start). */
async function first({ phone = false, android = null, look = 'calm' } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // (a refusal — a name that can't be used, a folder that can't be opened — is the dev server's 400: expected)
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errors.push(m.text()); });
  if (android !== null) await page.addInitScript((acc) => {
    window.__access = acc;
    window.LeanAndroid = { hasAllFilesAccess: () => window.__access, openAllFilesSettings: () => { window.__settings = true; }, setBarColors() {}, setWidgetColors() {}, setWidgetTasks() {}, setWidgetConfig() {}, setCaptureConfig() {}, refreshWidget() {} };
  }, android);
  await page.goto(BASE + '/');
  await page.evaluate((l) => { localStorage.clear(); localStorage.setItem('skin', JSON.stringify(l)); }, look);
  await page.goto(BASE + '/?t=' + Date.now());
  await page.waitForSelector('#main .view > *');
  await sleep(700);
  return { browser, page, errors };
}
/** Step the folder picker to `path`: up to the top, then down through each folder on the way. */
async function pickerTo(page, path) {
  for (let k = 0; k < 40; k++) {
    const up = page.locator('.picker .crumbs button', { hasText: 'Up' });
    if (!(await up.count())) break;
    await up.click();
    await sleep(150);
  }
  const parts = path.split('/').filter(Boolean);
  for (let k = 1; k <= parts.length; k++) {
    await page.locator(`.picker li button[data-p="${'/' + parts.slice(0, k).join('/')}"]`).click();
    await sleep(150);
  }
  check(await page.locator('.picker .path').textContent() === path, 'the picker shows ' + path.replace(DIR, '…'), await page.locator('.picker .path').textContent());
}
const shown = (page) => page.evaluate(() => ({ hash: decodeURIComponent(location.hash), vault: JSON.parse(localStorage.getItem('vault') || 'null') }));

// --------------------------------------------------------------------------------------------
console.log('laptop: the welcome screen on the first start');
let { browser, page, errors } = await first();
const w = await page.evaluate(() => ({
  hash: location.hash, h1: (() => { const e = document.querySelector('.welcome h1')?.cloneNode(true); e?.querySelectorAll('svg[aria-label]').forEach((s) => s.replaceWith(s.getAttribute('aria-label'))); return e?.textContent; })(), choices: [...document.querySelectorAll('.wl-choice b')].map((b) => b.textContent),
  side: !!document.querySelector('#side')?.offsetParent, cls: document.documentElement.classList.contains('welcome'),
  lead: document.querySelector('.wl-lead')?.textContent || '',
}));
check(w.hash === '#/welcome' && w.h1 === 'Welcome to thinky', 'no notes folder yet: the welcome screen', JSON.stringify(w));
check(w.choices.join('|') === 'Open an existing notes folder|Create a new notes folder', 'two ways in: open a folder, or create a new one', JSON.stringify(w.choices));
check(/Markdown/.test(w.lead) && /Logseq/.test(w.lead), 'one line saying what it is', w.lead);
check(!w.side && w.cls, 'the sidebar is put away while it shows');
await page.screenshot({ path: SHOTS + '/start-welcome.png' });
await page.locator('[data-w="open"]').click();
await sleep(400);
await page.keyboard.press('Escape');
await sleep(200);
check(await page.locator('.wl-choice').count() === 2 && (await shown(page)).hash === '#/welcome', 'Esc in the picker: back to the first step');
await page.keyboard.press('Escape');
await sleep(400);
check((await shown(page)).hash.startsWith('#/settings'), 'Esc there: closed, like the ×');
await page.evaluate(() => { location.hash = '#/welcome'; });
await sleep(500);
await page.locator('.wl-close').click();
await sleep(500);
check((await shown(page)).hash.startsWith('#/settings') && await page.locator('.picker').count() === 1 && !(await page.evaluate(() => document.documentElement.classList.contains('welcome'))), 'its × closes it: Settings, with the folder picker');
await page.evaluate(() => { location.hash = '#/journals'; });
await sleep(500);
check((await shown(page)).hash === '#/welcome', 'still no notes folder: the Journals lead back to the welcome screen');

console.log('laptop: create a new notes folder, with the tour');
await page.locator('[data-w="new"]').click();
await sleep(500);
check(await page.locator('.picker[data-mode="new"] .pk-name input').inputValue() === 'Notes' && await page.locator('.pk-tour input').isChecked(), 'a name to start from (“Notes”), the tour ticked');
await pickerTo(page, `${T}/new-here`);
await page.locator('.pk-name input').fill('My notes');
await page.screenshot({ path: SHOTS + '/start-create.png' });
await page.locator('[data-create]').click();
await sleep(1500);
const NEW = `${T}/new-here/My notes`;
let st = await shown(page);
check(st.hash === '#/page/Start here' && st.vault === NEW, 'made, opened, at the tour’s first page', JSON.stringify(st));
check(['logseq/config.edn', 'pages/Start here.md', 'pages/Links and tags.md', 'pages/Journal and to-dos.md', 'pages/Finding things.md', `journals/${dayFile}.md`].every((f) => fs.existsSync(`${NEW}/${f}`)), 'Logseq’s layout: config.edn, the tour’s pages, today’s journal', listing(NEW));
const cfg = fs.readFileSync(`${NEW}/logseq/config.edn`, 'utf8');
check(cfg.includes(':journal/page-title-format "MMM do, yyyy"') && cfg.includes(':journal/file-name-format "yyyy_MM_dd"') && cfg.includes(':favorites ["Start here"]'), 'Logseq 0.10’s date formats; the tour’s first page a favourite');
const tour = await page.evaluate(() => ({ title: document.querySelector('h1.page-title')?.textContent, notes: document.querySelectorAll('.outline .blk').length, favs: [...document.querySelectorAll('#favs a')].map((a) => a.textContent), welcome: document.documentElement.classList.contains('welcome') }));
check(tour.title === 'Start here' && tour.notes >= 10 && tour.favs.join() === 'Start here' && !tour.welcome, 'the page shows, with its notes; Favourites has it; the sidebar is back', JSON.stringify(tour));
await page.screenshot({ path: SHOTS + '/start-tour.png' });
await page.locator('.outline .bc a', { hasText: 'Links and tags' }).click();
await sleep(700);
check((await shown(page)).hash === '#/page/Links and tags' && (await page.locator('.outline').first().textContent()).includes('double square brackets'), 'its links lead through the tour');
await page.evaluate(() => { location.hash = '#/journals'; });
await sleep(800);
check((await page.locator('.sheet.day.today .outline').textContent()).includes('Start here'), 'today’s journal points to it');
check(errors.length === 0, 'no script errors (laptop, create)', errors.join('\n'));
allErrors.push(...errors);
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('laptop: the picker takes any folder');
({ browser, page, errors } = await first());
await page.locator('[data-w="open"]').click();
await sleep(500);
check(await page.locator('.picker[data-mode="open"] [data-use]').count() === 1 && await page.locator('.picker [data-new]').count() === 1, 'Open: the picker, with Use this folder and New folder');
// an empty folder: started after asking (here without the tour)
await pickerTo(page, `${T}/empty`);
check(!(await page.locator('.picker [data-use]').isDisabled()) && /can start here/.test(await page.locator('.picker .pk-msg').textContent()), 'an empty folder can be chosen (before: only folders with pages)', await page.locator('.picker .pk-msg').textContent());
await page.locator('.picker [data-use]').click();
await sleep(300);
check(await page.locator('.modal h2').textContent() === 'Start a new notes folder here?', 'it asks first', await page.locator('.modal h2').textContent());
await page.screenshot({ path: SHOTS + '/start-empty-ask.png' });
await page.locator('.modal .pk-tour input').uncheck();
await page.locator('.modal [data-v="1"]').click();
await sleep(1200);
st = await shown(page);
check(st.hash === '#/journals' && st.vault === `${T}/empty` && listing(`${T}/empty`) === 'journals,logseq,pages' && listing(`${T}/empty/pages`) === '', 'without the tour: just the folders and settings, opened at the Journals', listing(`${T}/empty`));
// a folder holding other things: a warning; Cancel leaves it as it was
await page.evaluate(() => { location.hash = '#/settings/notes'; });
await sleep(700);
await page.locator('[data-a="pick"]').click();
await sleep(400);
await pickerTo(page, `${T}/busy`);
const busyBefore = listing(`${T}/busy`);
await page.locator('.picker [data-use]').click();
await sleep(300);
const warn = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, body: document.querySelector('.modal .note')?.textContent }));
check(warn.title === 'Start a notes folder among other things?' && /1 file and 1 folder/.test(warn.body) && /nothing that’s there is changed/.test(warn.body), 'a folder of other things: a warning that says what’s there', JSON.stringify(warn));
await page.screenshot({ path: SHOTS + '/start-busy-warn.png' });
await page.locator('.modal [data-v="0"]').click();
await sleep(300);
check(listing(`${T}/busy`) === busyBefore && fs.readFileSync(`${T}/busy/letter.txt`, 'utf8') === 'mine', 'Cancel: nothing made, nothing changed');
// New folder: a name that can't be used says why; then made and stepped into; never over one that's there
await page.locator('.picker [data-new]').click();
await sleep(300);
check(await page.locator('.modal input').inputValue() === 'New folder', 'New folder: a name to start from');
await page.locator('.modal input').fill('a/b');
await page.locator('.modal [data-v="1"]').click();
await sleep(300);
check(/can’t have/.test(await page.locator('.modal .err').textContent()), 'a name with “/” is refused, saying why', await page.locator('.modal').textContent());
await page.locator('.modal input').fill('Fresh');
await page.locator('.modal [data-v="1"]').click();
await sleep(600);
check(fs.statSync(`${T}/busy/Fresh`).isDirectory() && await page.locator('.picker .path').textContent() === `${T}/busy/Fresh`, 'made, and the picker shows it (empty)');
await page.locator('.picker .crumbs button', { hasText: 'Up' }).click();
await sleep(300);
await page.locator('.picker [data-new]').click();
await sleep(300);
await page.locator('.modal input').fill('FRESH');
await page.locator('.modal [data-v="1"]').click();
await sleep(400);
check(/already/.test(await page.locator('.modal .err').textContent()), 'the same name again (any capitals): refused', await page.locator('.modal .err').textContent());
await page.keyboard.press('Escape');
await sleep(200);
// inside a notes folder: that one is offered
await pickerTo(page, `${VAULT}/pages`);
check(/inside the notes folder/.test(await page.locator('.picker .pk-msg').textContent()), 'a folder inside a notes folder says so');
await page.locator('.picker [data-use]').click();
await sleep(300);
check(await page.locator('.modal h2').textContent() === 'This folder is inside a notes folder', 'and offers that one', await page.locator('.modal').textContent());
await page.locator('.modal [data-v="1"]').click();
await sleep(1200);
st = await shown(page);
check(st.vault === VAULT && st.hash === '#/journals' && !fs.existsSync(`${VAULT}/pages/pages`), 'it opens the notes folder itself; nothing is made inside it', JSON.stringify(st));
check(errors.length === 0, 'no script errors (laptop, picker)', errors.join('\n'));
allErrors.push(...errors);
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('phone: the welcome screen, and creating a folder there');
({ browser, page, errors } = await first({ phone: true, look: 'plain' }));
const pw = await page.evaluate(() => {
  const r = (el) => el?.getBoundingClientRect();
  return { hash: location.hash, top: !!document.querySelector('#topbar')?.offsetParent, wide: document.documentElement.scrollWidth, choices: [...document.querySelectorAll('.wl-choice')].map((b) => [Math.round(r(b).height), Math.round(r(b).right)]), close: [Math.round(r(document.querySelector('.wl-close')).width), Math.round(r(document.querySelector('.wl-close')).height)] };
});
check(pw.hash === '#/welcome' && !pw.top && pw.wide <= 390, 'the welcome screen, the whole phone screen, no sideways scrolling', JSON.stringify(pw));
check(pw.choices.length === 2 && pw.choices.every(([hh, right]) => hh >= 44 && right <= 390 - 12) && pw.close.every((x) => x >= 44), 'big choices and a finger-sized ×', JSON.stringify(pw));
await page.screenshot({ path: SHOTS + '/start-welcome-phone.png' });
await page.locator('[data-w="new"]').tap();
await sleep(500);
await page.evaluate(() => window.leanApp.onBack());
await sleep(300);
check(await page.locator('.wl-choice').count() === 2 && (await shown(page)).hash === '#/welcome', 'Android’s Back in the picker: back to the first step (not out of the app)');
await page.locator('[data-w="new"]').tap();
await sleep(500);
await pickerTo(page, `${T}/made`);
await page.locator('.pk-name input').fill('Phone notes');
await page.locator('[data-create]').tap();
await sleep(1500);
st = await shown(page);
check(st.hash === '#/page/Start here' && st.vault === `${T}/made/Phone notes` && !(await page.evaluate(() => document.documentElement.classList.contains('welcome'))) && await page.locator('#topbar').isVisible(), 'phone: made and opened at the tour; the top bar is back', JSON.stringify(st));
await page.screenshot({ path: SHOTS + '/start-tour-phone.png' });
check(errors.length === 0, 'no script errors (phone)', errors.join('\n'));
allErrors.push(...errors);
await browser.close();

console.log('Android without file access: asked first, as before');
({ browser, page, errors } = await first({ phone: true, android: false }));
const card = page.locator('.welcome .wl-access .card');
check(await card.isVisible() && /allow access/i.test(await card.textContent()), 'the welcome screen asks for file access first');
await card.locator('button').tap();
check(await page.evaluate(() => window.__settings === true), 'its button opens Android’s setting');
await page.locator('[data-w="open"]').tap();
await sleep(500);
check(await page.locator('.picker [data-use]').isDisabled() && await page.locator('.picker [data-new]').isDisabled() && /allow access/i.test(await page.locator('.picker .pk-msg').textContent()), 'the picker waits for it (Use this folder and New folder off)');
await page.evaluate(() => { window.__access = true; document.dispatchEvent(new Event('visibilitychange')); });
await sleep(800);
await page.locator('[data-w="open"]').tap();
await sleep(500);
check(!(await page.locator('.picker [data-use]').isDisabled()) && await page.locator('.wl-access .card').count() === 0, 'with access: the card goes, the picker works');
check(errors.length === 0, 'no script errors (Android)', errors.join('\n'));
allErrors.push(...errors);
await browser.close();

console.log('a notes folder chosen before: no welcome screen');
({ browser, page, errors } = await first());
await page.evaluate((v) => localStorage.setItem('vault', JSON.stringify(v)), VAULT);
await page.goto(BASE + '/?t=' + Date.now());
await page.waitForSelector('.sheet .outline');
check((await shown(page)).hash === '#/journals' && !(await page.evaluate(() => document.documentElement.classList.contains('welcome'))), 'it opens at the Journals as always');
await page.evaluate(() => localStorage.setItem('vault', JSON.stringify('/no/such/folder')));
await page.goto(BASE + '/?t=' + Date.now());
await sleep(1200);
check((await shown(page)).hash.startsWith('#/settings') && await page.locator('.err').count() > 0, 'a folder that can’t be opened: Settings, saying why (not the welcome screen)', (await shown(page)).hash);
allErrors.push(...errors);
await browser.close();

fs.rmSync(T, { recursive: true, force: true });
check(allErrors.length === 0, 'no script errors', allErrors.join('\n'));
console.log(failures() ? `${failures()} FAILED` : 'all passed');
process.exit(failures() ? 1 : 0);

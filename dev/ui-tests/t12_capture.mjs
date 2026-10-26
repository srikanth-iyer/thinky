// The Windows "Add to journal" box (ui/capture.html + capture.js). Its commands live in the
// Tauri shell (src-tauri/src/lib.rs), not in the dev server, so they are stood in for here:
// capture_where, prefill, quick_capture and quit answer from this test and are recorded.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, BASE, SHOTS } from './lib.mjs';

/** Open the box. `prefill` is what a browser link or the clipboard hands it; `slow` delays it. */
async function openBox({ prefill = { text: '', url: '', from: 'clipboard' }, slow = 0, captureError = '', captureSlow = 0 } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 98 } });
  const errors = [];
  const calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/500/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
  const answer = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(BASE + '/api/*', async (route) => {
    const cmd = route.request().url().split('/api/')[1];
    const args = JSON.parse(route.request().postData() || '{}');
    calls.push([cmd, args]);
    if (cmd === 'capture_where') return answer(route, { today: true, page: 'October 26th, 2026' });
    if (cmd === 'prefill') { await sleep(slow); return answer(route, prefill); }
    if (cmd === 'quick_capture') { await sleep(captureSlow); return captureError ? answer(route, { error: captureError }, 500) : answer(route, 'ok'); }
    if (cmd === 'quit') return answer(route, true);
    return answer(route, { error: 'not in this test' }, 500);
  });
  await page.goto(BASE + '/capture.html');
  const ta = page.locator('textarea');
  const where = page.locator('.cap-where');
  const did = (cmd) => calls.filter((c) => c[0] === cmd);
  const ready = () => page.waitForFunction(() => document.querySelector('.cap-where').textContent.startsWith('To ') && document.activeElement === document.querySelector('textarea'));
  return { browser, page, ta, where, did, ready, errors };
}
const allErrors = [];

console.log('a browser link hands it a text: it shows where the note goes, with the text ready to add');
let b = await openBox({ prefill: { text: 'From a web page', url: 'https://example.com', from: 'link' }, slow: 400 });
// it was clicked away while still starting (its text not filled in yet): it must stay open
await sleep(150);
await b.page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); });
await b.ready();
check(b.did('quit').length === 0, 'focus lost while it was starting: the box stays open');
check(await b.where.textContent() === 'To today’s journal (October 26th, 2026)', 'it says where the note goes', await b.where.textContent());
check(await b.ta.inputValue() === 'From a web page https://example.com', 'the text from the link is in the box', await b.ta.inputValue());
check(await b.page.evaluate(() => { const t = document.querySelector('textarea'); return t.selectionStart === 0 && t.selectionEnd === t.value.length; }), 'and selected, so typing replaces it');
await b.page.screenshot({ path: SHOTS + '/capture-box.png' });
await b.page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); });
await sleep(100);
check(b.did('quit').length === 0, 'clicking elsewhere keeps text from a web page (it isn’t on the clipboard)');

console.log('an Enter right as it appears (meant for another window) is ignored');
await b.page.keyboard.press('Enter');
await sleep(250);
check(b.did('quick_capture').length === 0 && b.did('quit').length === 0, 'nothing added, the box still open');

console.log('Shift+Enter is a new line and the box grows; Enter adds the note and closes the box');
await sleep(400);
await b.page.keyboard.press('End');
const h1 = await b.ta.evaluate((t) => t.offsetHeight);
await b.page.keyboard.press('Shift+Enter');
await b.page.keyboard.type('more words');
const h2 = await b.ta.evaluate((t) => t.offsetHeight);
check(b.did('quick_capture').length === 0 && h2 > h1, 'a new line, the text box taller', `${h1} → ${h2}`);
await b.page.keyboard.press('Enter');
await b.page.keyboard.press('Enter'); // pressed twice: still one note
await sleep(150);
const added = b.did('quick_capture');
check(added.length === 1 && added[0][1].text === 'From a web page https://example.com\nmore words', 'Enter adds the note as typed, once', JSON.stringify(added));
check(await b.where.textContent() === '✓ Added to October 26th, 2026' && await b.ta.evaluate((t) => t.readOnly), 'it says so (and stops taking typing)', await b.where.textContent());
await sleep(800);
check(b.did('quit').length === 1, 'then it closes');
allErrors.push(...b.errors);
await b.browser.close();

console.log('opened with the shortcut key, nothing typed: clicking elsewhere closes it; Esc too');
b = await openBox();
await b.ready();
await b.page.keyboard.type('half a thought');
await b.page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); });
await sleep(100);
check(b.did('quit').length === 0, 'with words in it, clicking elsewhere keeps it (nothing is lost)');
await b.page.keyboard.press('Control+A');
await b.page.keyboard.press('Delete');
await b.page.evaluate(() => window.dispatchEvent(new Event('blur')));
await sleep(100);
check(b.did('quit').length === 1, 'empty: clicking elsewhere closes it');
allErrors.push(...b.errors);
await b.browser.close();
b = await openBox();
await b.ready();
await b.page.keyboard.press('Escape');
await sleep(100);
check(b.did('quit').length === 1 && b.did('quick_capture').length === 0, 'Esc closes it without adding');
allErrors.push(...b.errors);
await b.browser.close();

console.log('opened with the shortcut key, the clipboard’s text filled in: clicking elsewhere untouched closes it');
b = await openBox({ prefill: { text: 'copied earlier', url: '', from: 'clipboard' } });
await b.ready();
await b.page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); });
await sleep(100);
check(b.did('quit').length === 1, 'untouched: it closes (the text is still on the clipboard)');
allErrors.push(...b.errors);
await b.browser.close();
b = await openBox({ prefill: { text: 'copied earlier', url: '', from: 'clipboard' } });
await b.ready();
await b.page.keyboard.press('End');
await b.page.keyboard.type(' and my thoughts');
await b.page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); });
await sleep(100);
check(b.did('quit').length === 0, 'with typing added: it stays');
allErrors.push(...b.errors);
await b.browser.close();

console.log('Esc or × while the note is being added wait for it (closing would cut the writing short)');
b = await openBox({ captureSlow: 600 });
await b.ready();
await sleep(600);
await b.page.keyboard.type('slow drive');
await b.page.keyboard.press('Enter');
await sleep(100);
await b.page.keyboard.press('Escape');
await b.page.locator('[data-a="close"]').click();
await sleep(200);
check(b.did('quit').length === 0, 'not closed while adding');
await sleep(1200);
check(b.did('quick_capture').length === 1 && b.did('quit').length === 1, 'added, then it closes by itself');
allErrors.push(...b.errors);
await b.browser.close();

console.log('the note can’t be added (say, the folder is gone): it says why and keeps the text');
b = await openBox({ captureError: 'Couldn’t find your notes folder.' });
await b.ready();
await sleep(600);
await b.page.keyboard.type('keep me');
await b.page.keyboard.press('Enter');
await sleep(200);
check((await b.where.textContent()).includes('Couldn’t find your notes folder.') && await b.ta.inputValue() === 'keep me' && !(await b.ta.evaluate((t) => t.readOnly)), 'the reason shows, the text stays and can be edited', await b.where.textContent());
check(b.did('quit').length === 0, 'and the box stays open');
allErrors.push(...b.errors);
await b.browser.close();

check(!allErrors.length, 'no script errors', allErrors.join(' | '));
process.exit(failures() ? 1 : 0);

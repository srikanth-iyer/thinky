// The outside review's fixes (Nov 21) for the page and the dev server: an AI key goes only to its own
// service (claim 1), Android opens a video outside the app (2), the Play version never says "ready to
// install" (10d), the dev server serves only ui/ and its API only to its own page (20), formulas that
// would draw too much (22a), the AI's preview notes keep their looks to themselves (22b), and the medium
// rows: Ollama/LM Studio not offered on Android, the calendar's PageUp/PageDown, breadcrumbs escaped once,
// a link's label holds no other link, code beats a formula, a property icon tapped on a phone, a save
// asked for while one runs, a change told of while one is looked at, a phone shortcut before the folder
// opens, the AI panels' Esc listeners, popups placed with the text size zoomed and above the phone toolbar,
// the phone's search box height when the phone is turned while typing. The Android timeout: unit.mjs.
// (The extension's fixes: t16_browser. The modules alone: unit.mjs. The dev server's rules: cargo test -p devserver.)
import http from 'node:http';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { open, check, failures, go, sleep, write, read, BASE, VAULT } from './lib.mjs';

// ---- two stand-in AI services on this computer: the one the key is saved for, and another one
const seen = { a: [], b: [] };
let ANSWER = '- DONE finished the report\n- ## A heading the AI wrote';
const service = (who) => http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen[who].push({ url: req.url, auth: req.headers.authorization || '', xkey: req.headers['x-api-key'] || '' });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'fake-small' }] }));
    if (req.url.endsWith('/chat/completions')) return res.end(JSON.stringify({ choices: [{ message: { content: ANSWER } }] }));
    res.statusCode = 404; res.end('{}');
  });
});
const A = service('a'), B = service('b');
await new Promise((r) => A.listen(0, '127.0.0.1', r));
await new Promise((r) => B.listen(0, '127.0.0.1', r));
const baseA = `http://127.0.0.1:${A.address().port}/v1`, baseB = `http://127.0.0.1:${B.address().port}/v1`;

// ---- raw requests to the dev server (as another program would send them)
const raw = (method, path, headers = {}, body = '') => new Promise((resolve) => {
  const u = new URL(BASE);
  const r = http.request({ host: u.hostname, port: u.port, method, path, headers: { Host: u.host, ...headers }, setHost: false }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', (e) => resolve({ status: 0, body: String(e) }));
  r.end(body);
});

console.log('20. the dev server: files from ui/ only, its API only for its own page');
{
  const ok = await raw('GET', '/index.html');
  check(ok.status === 200 && /default-src/.test(ok.headers['content-security-policy'] || ''), 'index.html, with the app’s Content-Security-Policy');
  const root = await raw('GET', '/');
  check(root.status === 200 && !!root.headers['content-security-policy'], '/ is index.html, with it too');
  const js = await raw('GET', '/app.js');
  check(js.status === 200 && !js.headers['content-security-policy'], 'a script as before');
  const svg = await raw('GET', '/brand/' + (await import('node:fs')).readdirSync(new URL('../../ui/brand/', import.meta.url)).find((f) => f.endsWith('.svg')));
  check(svg.status === 200 && !!svg.headers['content-security-policy'], 'an SVG (it can run script when opened) gets the policy too');
  for (const p of ['/%2fetc/passwd', '/%2Fetc%2Fhostname', '//etc/passwd', '/%5c%5cserver%5cshare%5ca.js', '/..%2fCargo.toml', '/%2e%2e/Cargo.toml', '/%2e%2e%2fCargo.toml', '/../Cargo.toml', '/brand/../index.html', '/C:/Windows/win.ini', '/C%3a/Windows/win.ini', '/index.html%00.js', '/./index.html', '/brand/', '/brand', '/nosuch.js']) {
    const r = await raw('GET', p);
    check(r.status === 404 && r.body === 'not found', `refused: ${p}`, r.status + ' ' + r.body.slice(0, 60));
  }
  const noOrigin = await raw('POST', '/api/summary', { 'Content-Type': 'application/json' }, '{}');
  check(noOrigin.status === 403, 'the API with no Origin: refused', noOrigin.status);
  const other = await raw('POST', '/api/summary', { Origin: 'http://evil.example' }, '{}');
  check(other.status === 403, 'from another page: refused', other.status);
  const nul = await raw('POST', '/api/summary', { Origin: 'null' }, '{}');
  check(nul.status === 403, 'from a page that hides where it is (Origin: null): refused', nul.status);
  const mine = await raw('POST', '/api/summary', { Origin: BASE }, '{}');
  check(mine.status === 200 && mine.body.startsWith('{'), 'from its own page: answered', mine.status);
  const get = await raw('GET', '/api/summary', { Origin: BASE });
  check(get.status === 403, 'never by GET', get.status);
  const host = await raw('GET', '/index.html', { Host: 'evil.example:' + new URL(BASE).port });
  check(host.status === 403, 'another name for this computer (DNS rebinding): refused', host.status);
}

write('pages/Review.md', [
  '- a & b < c',
  '\t- the child',
  '- cost `$x$` and $y$',
  '- [see #tag and https://x.example/a](https://example.org)',
  '- matrix $$\\begin{matrix}' + Array(200).fill('&'.repeat(199)).join('\\\\') + '\\end{matrix}$$',
  '- deep $' + '{'.repeat(300) + 'x' + '}'.repeat(300) + '$',
  '- small $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$',
  '- video {{video https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95}}',
  '- polish me please',
  '- from the AI\n  by:: claude',
].join('\n') + '\n');
// by:: shown as an icon (Settings → Notes → Property display, Build 37)
write('logseq/thinky.json', JSON.stringify({ propertyDisplay: { by: { show: 'icon', icon: '✦' } } }));

const { browser, page, errors } = await open();
await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>player</p>' }));

console.log('1. an AI key goes only to its own service');
{
  const call = (cmd, args) => page.evaluate(async ([c, a]) => { try { return { ok: await (await import('/api.js')).call(c, a) }; } catch (e) { return { err: String(e.message || e) }; } }, [cmd, args]);
  // Settings → AI: "Other", its address, its key
  await go(page, '#/settings/ai');
  await page.waitForSelector('.ai-card');
  await page.selectOption('[data-f="provider"]', 'other');
  await page.fill('[data-f="key"]', 'sk-other-1');
  await page.click('[data-a="savekey"]');
  await page.waitForFunction(() => /address first/.test(document.querySelector('.ai-keysay')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
  check(/Type the address first/.test(await page.locator('.ai-keysay').innerText()), 'Other with no address: the key isn’t saved (it would belong nowhere)', await page.locator('.ai-keysay').innerText());
  check((await call('ai_key_has', { provider: 'other' })).ok === false, 'nothing saved');
  await page.fill('[data-f="base"]', baseA);
  await page.locator('[data-f="base"]').dispatchEvent('change');
  await sleep(500);
  await page.fill('[data-f="key"]', 'sk-other-1');
  await page.click('[data-a="savekey"]');
  for (let k = 0; k < 40 && !seen.a.some((r) => r.auth); k++) await sleep(100);
  check(seen.a.some((r) => r.auth === 'Bearer sk-other-1'), 'saved with its address: the key goes there', JSON.stringify(seen.a));
  // the page (or anything running in it) points the request elsewhere: refused, nothing sent there
  const req = (url, auth = 'bearer') => ({ method: 'GET', url, auth, headers: [], body: null, local: true, key_required: false });
  const r1 = await call('ai_send', { provider: 'other', req: req(baseB + '/models') });
  check(/isn't the one this service's key belongs to/.test(r1.err || ''), 'Other’s key to another address: refused', JSON.stringify(r1));
  check(seen.b.length === 0, 'and the other address heard nothing', JSON.stringify(seen.b));
  const r2 = await call('ai_send', { provider: 'other', req: req(baseA + '/models', 'x-api-key') });
  check(r2.ok && seen.a.at(-1).auth === 'Bearer sk-other-1' && !seen.a.at(-1).xkey, 'where the key goes comes from the service, not the page’s request', JSON.stringify(seen.a.at(-1)));
  // a preset service's key never goes anywhere but its own address
  check((await call('ai_key_set', { provider: 'openai', key: 'sk-openai-1', base: baseB })).ok === true, 'an OpenAI key saved (an address given with it is ignored)');
  const r3 = await call('ai_send', { provider: 'openai', req: req(baseB + '/models') });
  check(/isn't the one/.test(r3.err || '') && seen.b.length === 0, 'OpenAI’s key to a stand-in address: refused, nothing sent', JSON.stringify(r3));
  const r4 = await call('ai_send', { provider: 'claude', req: req(baseB + '/models', 'x-api-key') });
  check(r4.ok && seen.b.length === 1 && !seen.b[0].xkey && !seen.b[0].auth, 'no key saved for it: the request goes, with no key', JSON.stringify([r4, seen.b]));
  seen.b.length = 0;
  const r5 = await call('ai_send', { provider: 'ollama', req: req(baseB + '/models') });
  check(r5.ok && seen.b.length === 1 && !seen.b[0].auth, 'a local program: never a key', JSON.stringify(seen.b));
  seen.b.length = 0;
  // the address changed after the key was saved: the key stays behind until it is saved again
  await page.fill('[data-f="base"]', baseB);
  await page.locator('[data-f="base"]').dispatchEvent('change');
  await page.waitForFunction(() => /Paste the key again/.test(document.querySelector('.ai-keysay')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check(/Paste the key again/.test(await page.locator('.ai-keysay').innerText()), 'a new address: it says to paste the key again', await page.locator('.ai-keysay').innerText());
  await sleep(800);
  check(!seen.b.some((r) => r.auth), 'and the key never went to the new address', JSON.stringify(seen.b));
  await page.fill('[data-f="key"]', 'sk-other-2');
  await page.click('[data-a="savekey"]');
  for (let k = 0; k < 40 && !seen.b.some((r) => r.auth); k++) await sleep(100);
  check(seen.b.some((r) => r.auth === 'Bearer sk-other-2'), 'saved again: it goes to the new address', JSON.stringify(seen.b));
  const saved = await page.evaluate(() => localStorage.getItem('ai'));
  check(!saved.includes('sk-other'), 'the key is never in the page’s own storage');
  // (each refused request above shows in the console as a 400 from the dev server: expected here)
  errors.splice(0, errors.length, ...errors.filter((e) => !/status of 400/.test(e)));
}

console.log('22a. formulas that would draw too much; render: code and links');
{
  await go(page, '#/page/Review');
  await page.waitForSelector('.blk');
  const rows = page.locator('.outline .blk');
  const html = (k) => rows.nth(k).locator('> .bc').innerHTML();
  const big = await html(4);
  check(big.includes('m-src') && !big.includes('m-mat'), 'a 200 × 200 matrix shows as its source', big.slice(0, 120));
  check(await rows.nth(4).locator('span').count() < 10, 'a handful of elements, not 40,000', await rows.nth(3).locator('span').count());
  check((await html(5)).includes('m-src'), 'groups 300 deep: the source');
  check((await html(6)).includes('m-mat'), 'a small matrix still draws');
  const code = await html(2);
  check(code.includes('<code>$x$</code>') && (code.match(/class="math"/g) || []).length === 1, 'a formula inside inline code is code', code);
  const lnk = rows.nth(3).locator('> .bc');
  check(await lnk.locator('a').count() === 1 && await lnk.locator('a a').count() === 0, 'a link’s label holds no other link', await lnk.innerHTML());
  check(errors.length === 0, 'no script errors', errors.join('; '));
}

console.log('breadcrumbs: escaped once');
{
  await go(page, '#/zoom/Review/1');
  await page.waitForSelector('.crumbs:not([hidden])', { timeout: 4000 }).catch(() => {});
  const crumbs = await page.locator('.crumbs').first().innerText();
  check(crumbs.includes('a & b < c') && !crumbs.includes('&amp;') && !crumbs.includes('&lt;'), 'a note with & and < in its breadcrumb', crumbs);
}

console.log('22b. the AI’s preview: each note’s look stays its own');
{
  await page.evaluate((b) => localStorage.setItem('ai', JSON.stringify({ provider: 'other', base: b, textModel: 'fake-small', mark: false })), baseB);
  await page.reload();
  await go(page, '#/page/Review');
  await page.waitForSelector('.blk');
  await page.evaluate(async () => { const o = window.leanApp.outlines.find((x) => x.name === 'Review'); const n = o.blocks.findIndex((b) => b.text.startsWith('polish me')); await (await import('/polish.js')).startPolish(o, n); });
  await page.waitForSelector('.pz-bar', { timeout: 8000 });
  await sleep(100);
  const looks = await page.evaluate(() => {
    const notes = document.querySelector('.pz-notes');
    const items = [...notes.children];
    return {
      container: [notes.className, notes.dataset.mark || '', notes.style.cssText, document.querySelector('.pz').className, document.querySelector('.pz').style.cssText],
      items: items.map((x) => [x.className, x.style.getPropertyValue('--hf')]),
      struck: items.map((x) => getComputedStyle(x.querySelector('.bc')).textDecorationLine),
    };
  });
  check(looks.container[0] === 'pz-notes' && !looks.container[2] && looks.container[3] === 'pz' && !looks.container[4], 'the box holding them all gets no note’s look', JSON.stringify(looks));
  check(looks.items.length === 2 && looks.items[0][0].includes('marker-done') && !looks.items[1][0].includes('marker-done'), 'the DONE note’s look is on its own box only', JSON.stringify(looks.items));
  check(looks.struck[0] === 'line-through' && looks.struck[1] === 'none', 'struck through, as it will be', JSON.stringify(looks.struck));
  check(!!looks.items[1][1] && !looks.items[0][1], 'the heading’s height on the heading only', JSON.stringify(looks.items));
  // still edited by a click, as Build 54 made it
  await page.locator('.pz .pz-note').nth(1).click();
  check(await page.locator('.pz .pz-ed').count() === 2, 'a click on the AI’s words still edits them');
  await page.keyboard.press('Escape');
  await page.click('[data-pz="undo"]');
  check(await page.locator('.pz').count() === 0, 'Undo closes it');
}

console.log('AI panels: their Esc listeners go with them');
{
  // count the document's capturing keydown listeners the AI adds and takes away
  const count = () => page.evaluate(() => window.__keys);
  await page.evaluate(() => {
    window.__keys = 0;
    const add = document.addEventListener.bind(document), rem = document.removeEventListener.bind(document);
    const mine = new WeakSet();
    document.addEventListener = (t, f, o) => { if (t === 'keydown' && o === true && !mine.has(f)) { mine.add(f); window.__keys++; } return add(t, f, o); };
    document.removeEventListener = (t, f, o) => { if (t === 'keydown' && o === true && mine.has(f)) { mine.delete(f); window.__keys--; } return rem(t, f, o); };
  });
  for (let k = 0; k < 3; k++) {
    await page.click('.title-row [data-a="more"]');
    await page.waitForSelector('.pop:not([hidden])');
    await page.locator('.pop:not([hidden]) :text("Ask about this page")').click();
    await page.waitForSelector('.ai-panel');
  }
  check(await page.locator('.ai-panel').count() === 1, 'one panel at a time');
  check(await count() === 1, 'three opened, one listener left (the open one’s)', await count());
  await page.keyboard.press('Escape');
  check(await page.locator('.ai-panel').count() === 0 && await count() === 0, 'Esc closes it and its listener goes', await count());
  // a polish closed by the page being drawn again: its listener goes at the next key
  await page.evaluate(async () => { const o = window.leanApp.outlines.find((x) => x.name === 'Review'); const n = o.blocks.findIndex((b) => b.text.startsWith('polish me')); await (await import('/polish.js')).startPolish(o, n); });
  await page.waitForSelector('.pz-bar', { timeout: 8000 });
  check(await count() === 1, 'a polish open: one listener');
  await page.evaluate(() => { const o = window.leanApp.outlines.find((x) => x.name === 'Review'); o.pz?.box.remove(); });
  await page.keyboard.press('Shift');
  check(await count() === 0, 'its note drawn again without it: the listener goes', await count());
}

console.log('the medium rows: saves, rescans, calendar, popups');
{
  // a save asked for while one runs resolves once the later typing is saved too
  await page.route('**/api/save', async (r) => { await sleep(500); await r.continue(); });
  const got = await page.evaluate(async () => {
    const o = window.leanApp.outlines.find((x) => x.name === 'Review');
    const n = o.blocks.findIndex((b) => b.text.startsWith('a & b'));
    o.blocks[n].text = 'a & b < c first'; o.markDirty();
    const first = o.save();
    await new Promise((r) => setTimeout(r, 100));
    o.blocks[n].text = 'a & b < c second'; o.markDirty();
    await o.save();
    return { first: !!first };
  });
  check(read('pages/Review.md').includes('a & b < c second'), 'await save() while one runs: the later words are on disk when it resolves', read('pages/Review.md').split('\n')[0]);
  await page.unroute('**/api/save');
  // a change told of while one is looked at is looked at after it, not dropped
  let scans = 0;
  await page.route('**/api/rescan', async (r) => { scans++; await sleep(400); await r.continue(); });
  await page.evaluate(async () => { const a = window.leanApp; const p = a.rescan(); await new Promise((r) => setTimeout(r, 50)); a.rescan(); a.rescan(); await p; });
  for (let k = 0; k < 30 && scans < 2; k++) await sleep(100);
  await sleep(600);
  check(scans === 2, 'two changes told of during a look: one more look after it (not two, not none)', scans);
  await page.unroute('**/api/rescan');
  // the calendar: PageUp/PageDown across a year's end (in the date picker, keys pressed as a person would)
  await page.evaluate(async () => { (await import('/popups.js')).pickDate(document.querySelector('.title-row [data-a="more"]'), { date: [2026, 12, 31] }); });
  await page.waitForSelector('.datepick .day.focus');
  await page.evaluate(() => document.querySelector('.datepick .day.focus').focus());
  const state = () => page.evaluate(() => { const c = document.querySelector('.datepick .cal'); return [c.querySelector('.cal-title').textContent, document.activeElement?.dataset?.d ?? null, c.querySelectorAll('[tabindex="0"]').length]; });
  const cal = [];
  await page.keyboard.press('PageDown'); cal.push(await state());
  await page.keyboard.press('PageDown'); cal.push(await state());
  for (let k = 0; k < 3; k++) await page.keyboard.press('PageUp');
  cal.push(await state());
  await page.click('.datepick [data-nav="1"]'); await page.click('.datepick [data-nav="1"]'); cal.push(await state());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  check(JSON.stringify(cal[0]) === JSON.stringify(['January 2027', '2027-1-31', 1]), 'PageDown on Dec 31: January 31, next year, focused', JSON.stringify(cal[0]));
  check(JSON.stringify(cal[1]) === JSON.stringify(['February 2027', '2027-2-28', 1]), 'again: February 28 (no 31st)', JSON.stringify(cal[1]));
  check(JSON.stringify(cal[2]) === JSON.stringify(['November 2026', '2026-11-28', 1]), 'three back: November, focused', JSON.stringify(cal[2]));
  check(cal[3][0] === 'January 2027' && cal[3][2] === 1, '› twice (November 28 not in view): still one day Tab reaches', JSON.stringify(cal[3]));
  // the caret's place with the text size zoomed (#main's zoom): measured where the note wraps
  await page.evaluate(() => window.leanApp.textSize?.(1.5));
  await go(page, '#/page/Review');
  await page.waitForSelector('.blk');
  await page.locator('.outline .blk', { hasText: 'from the AI' }).locator('> .bc').click({ position: { x: 4, y: 6 } });
  await page.waitForSelector('textarea.ed');
  const was = await page.locator('textarea.ed').inputValue();
  const words = 'many words that wrap across several lines of the note when the text is large '.repeat(4);
  await page.locator('textarea.ed').fill(words);
  await page.keyboard.press('End');
  const caret = await page.evaluate(async () => {
    const ta = document.querySelector('textarea.ed');
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const c = (await import('/popups.js')).caretRect(ta);
    const r = ta.getBoundingClientRect();
    return { c, r: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, zoom: ta.currentCSSZoom };
  });
  check(caret.zoom > 1.4, 'the text size is zoomed', caret.zoom);
  check(caret.c.bottom <= caret.r.bottom + 2 && caret.c.bottom >= caret.r.bottom - 60 && caret.c.left >= caret.r.left && caret.c.left <= caret.r.right, 'the caret is measured on the note’s own last line', JSON.stringify(caret));
  await page.locator('textarea.ed').fill(was); // (as it was: the phone below taps its icon)
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.leanApp.textSize?.(1));
  check(errors.length === 0, 'no script errors', errors.join('; '));
}
await browser.close();

console.log('Android: a video opens outside the app; no Ollama; shortcuts wait for the folder; Play');
{
  const phone = await chromium.launch();
  const ctx = await phone.newContext({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  let framed = 0;
  await p.route('https://www.youtube-nocookie.com/**', (r) => { framed++; r.fulfill({ status: 200, contentType: 'text/html', body: '<p>player</p>' }); });
  await p.route('**/build.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const BUILD = 50;' }));
  const RELEASES = JSON.stringify([{ tag_name: 'build-51', name: 'Build 51 · version 0.6.0', body: '- new', published_at: '2026-11-20T00:00:00Z' }, { tag_name: 'build-50', name: 'Build 50 · version 0.5.9', body: '- old', published_at: '2026-11-19T00:00:00Z' }]);
  await p.route('https://api.github.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().url().includes('/releases?') ? RELEASES : JSON.stringify({ tag_name: 'build-50', name: 'Build 50 · version 0.5.9', html_url: 'https://github.com/srikanth-iyer/thinky/releases/tag/build-50', assets: [] }) }));
  await p.addInitScript(() => {
    window.__opened = []; window.__taken = 0; window.__play = false;
    window.open = (u) => { window.__opened.push(u); return null; };
    // (as t13_update's stand-in: what the page asks of the phone, answered as MainActivity does)
    window.LeanAndroid = {
      hasAllFilesAccess: () => true, setBarColors() {}, setWidgetColors() {}, setWidgetTasks() {}, setWidgetConfig() {},
      setCaptureConfig() {}, refreshWidget() {}, leave() {}, openAllFilesSettings() {}, showKeyboard() {},
      takeShortcut: () => { window.__taken++; return null; }, fromPlay: () => window.__play,
    };
  });
  await p.goto(BASE + '/');
  await p.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify('calm')); }, VAULT);
  await p.goto(BASE + '/?t=' + Date.now() + '#/page/Review');
  await p.waitForSelector('.blk');
  const yt = p.locator('.yt').first();
  await yt.scrollIntoViewIfNeeded();
  await yt.click();
  await sleep(400);
  const opened = await p.evaluate(() => window.__opened);
  check(JSON.stringify(opened) === JSON.stringify(['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s']), 'a video tapped on Android opens outside the app, at its time', JSON.stringify(opened));
  check(await p.locator('.yt iframe').count() === 0 && framed === 0, 'no player frame in the app (it would get the LeanAndroid bridge)', framed);
  // a property shown as an icon: a tap says what it is (no hover on a phone, so no title)
  const icon = p.locator('.outline .blk', { hasText: 'from the AI' }).locator('.prop-icon');
  await icon.tap();
  await sleep(300);
  const toast = await p.evaluate(() => document.querySelector('#toast')?.textContent || '');
  check(toast.includes('by: claude') && await p.locator('textarea.ed').count() === 0, 'a tap on a property’s icon says what it is (and doesn’t start editing)', toast);
  // shortcuts: none taken while no folder is open
  const taken = await p.evaluate(async () => { const a = window.leanApp; const was = a.vaultOpen; const n0 = window.__taken; a.vaultOpen = false; await a.openShortcut(); const closed = window.__taken - n0; a.vaultOpen = was; await a.openShortcut(); return [closed, window.__taken - n0]; });
  check(taken[0] === 0 && taken[1] === 1, 'a shortcut is left with Android until a folder is open, then taken', JSON.stringify(taken));
  // Settings → AI: no program "on this computer" on the phone
  await go(p, '#/settings/ai');
  await p.waitForSelector('.ai-card');
  const opts = await p.locator('[data-f="provider"] option').allInnerTexts();
  check(!opts.some((o) => /Ollama|LM Studio/.test(o)) && opts.includes('Claude (Anthropic)') && opts.includes('Other (OpenAI-style)'), 'Ollama and LM Studio aren’t offered on the phone', opts.join(' | '));
  // one chosen before stays, so it can be turned off
  await p.evaluate(() => localStorage.setItem('ai', JSON.stringify({ provider: 'ollama', textModel: 'x' })));
  await go(p, '#/settings/writing');
  await go(p, '#/settings/ai');
  await p.waitForSelector('.ai-card');
  const opts2 = await p.locator('[data-f="provider"] option').allInnerTexts();
  check(opts2.includes('Ollama (on this computer)') && !opts2.includes('LM Studio (on this computer)'), 'unless it is the one already chosen', opts2.join(' | '));
  await p.evaluate(() => localStorage.removeItem('ai'));
  // What's new: the Play version never says "ready to install"
  const news = async (play) => {
    await p.evaluate((x) => { window.__play = x; }, play);
    await go(p, '#/settings/writing');
    await go(p, '#/settings/about');
    await p.waitForSelector('details.whatsnew');
    await p.evaluate(() => { document.querySelector('details.whatsnew').open = true; });
    await p.waitForSelector('.wn-rel', { timeout: 5000 }).catch(() => {});
    return p.locator('.wn-list').innerText();
  };
  const side = await news(false);
  check(/ready to install/.test(side) && /this version/.test(side), 'the downloaded app: a newer release is ready to install', side);
  const play = await news(true);
  check(!/ready to install/.test(play) && /this version/.test(play), 'the Google Play version: never “ready to install”', play);
  // a popup never under the phone's editing toolbar
  await go(p, '#/page/Review');
  await p.waitForSelector('.blk');
  await p.locator('.outline .blk').first().locator('> .bc').click();
  await p.waitForSelector('textarea.ed');
  const room = await p.evaluate(async () => { const tb = document.querySelector('#toolbar:not([hidden])'); return { room: (await import('/popups.js')).roomBelow(), top: tb ? tb.getBoundingClientRect().top : null, h: innerHeight }; });
  check(room.top !== null && Math.abs(room.room - room.top) < 1 && room.room < room.h, 'pop-ups stop at the toolbar’s top while it shows', JSON.stringify(room));
  const placed = await p.evaluate(async () => { const { place, roomBelow } = await import('/popups.js'); const el = document.createElement('div'); el.style.cssText = 'position:fixed;width:200px;height:120px'; document.body.append(el); const foot = roomBelow(); place(el, { left: 10, right: 12, top: foot - 20, bottom: foot - 4 }); const r = el.getBoundingClientRect(); el.remove(); return { bottom: r.bottom, foot }; });
  check(placed.bottom <= placed.foot - 8 + 0.5, 'a pop-up for a caret just above the toolbar goes above it, not under the toolbar', JSON.stringify(placed));
  await p.keyboard.press('Escape');
  // the search box's height on a phone turned while typing: the height seen for the way it's held now
  // (the other way's height would put the box under the keyboard)
  const fh = () => p.evaluate(async () => (await import('/search.js')).fullHeight());
  const size = async (w, ht) => { await p.setViewportSize({ width: w, height: ht }); await sleep(250); };
  await p.evaluate(() => document.activeElement?.blur?.());
  await size(851, 393); // turned once with nothing being typed in: its height is seen
  await size(393, 851);
  await p.locator('.outline .blk').first().locator('> .bc').click();
  await p.waitForSelector('textarea.ed');
  await size(393, 500); // the keyboard up
  const upright = await fh();
  await size(851, 200); // turned while typing, the keyboard still up
  const turned = await fh();
  check(upright === 851 && turned === 393, 'typing, upright: the height without the keyboard; turned: the turned one’s, not the upright one’s', JSON.stringify([upright, turned]));
  await p.keyboard.press('Escape');
  await size(393, 851);
  check(errs.length === 0, 'no script errors on the phone', errs.join('; '));
  await phone.close();
}

A.close(); B.close();
if (failures()) { console.log(`FAILED: ${failures()}`); process.exit(1); }

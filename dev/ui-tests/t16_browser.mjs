// The Edge extension (browser/) in a real Chromium: highlighting passages, finding them again after
// a reload, the toolbar box, sending them all to their article's page through native messaging
// (the dev server stands in for the app's receiver: the same core code), and a passage straight to
// the journal. Runs on its own (no dev server or sample vault needed): node t16_browser.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DIR = (process.env.UI_TEST_DIR || '/tmp/lean-ui-test') + '/browser';
const SHOTS = (process.env.UI_TEST_DIR || '/tmp/lean-ui-test') + '/shots';
let fails = 0;
const check = (c, m, x = '') => { if (c) console.log('  ok  ' + m); else { fails++; console.log('  FAIL ' + m + (x ? ' :: ' + String(x).slice(0, 600) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
// a throwaway notes folder with a typical config (journals in Diary, "October 29th, 2026" titles)
const VAULT = DIR + '/vault';
for (const d of ['pages', 'Diary', 'logseq']) fs.mkdirSync(VAULT + '/' + d, { recursive: true });
fs.writeFileSync(VAULT + '/logseq/config.edn', '{:journal/page-title-format "MMMM do, yyyy"\n :journal/file-name-format "MMMM do, yyyy"\n :journals-directory "Diary"\n :quick-capture-options {:insert-today? true}}\n');
// the extension, plus (for the test only) permission on every page: a test can't give it the
// "you clicked it" permission that a real click, key or menu gives
const EXT = DIR + '/ext';
fs.cpSync(ROOT + '/browser', EXT, { recursive: true });
const man = JSON.parse(fs.readFileSync(EXT + '/manifest.json', 'utf8'));
man.host_permissions = ['<all_urls>'];
fs.writeFileSync(EXT + '/manifest.json', JSON.stringify(man));
// the receiver: Chromium finds it in <profile>/NativeMessagingHosts
const PROFILE = DIR + '/profile';
fs.mkdirSync(PROFILE + '/NativeMessagingHosts', { recursive: true });
const host = DIR + '/host.sh';
fs.writeFileSync(host, `#!/bin/sh\nexport LEAN_CLIP_VAULT='${VAULT}'\nexec '${ROOT}/target/debug/devserver' "$@"\n`, { mode: 0o755 });
fs.writeFileSync(PROFILE + '/NativeMessagingHosts/com.srikanth.leanoutliner.json', JSON.stringify({ name: 'com.srikanth.leanoutliner', description: 'test', path: host, type: 'stdio', allowed_origins: ['chrome-extension://fjgdgmpheeihnlbpmbajkmoapjfieggg/'] }));

// an article: a canonical address with tracking, its site's name, a link, bold, maths, words that
// look like a tag, a link and a property
const ARTICLE = `<!doctype html><html><head><meta charset="utf-8"><title>How Bread Rises | Kitchen Weekly</title>
<meta property="og:site_name" content="Kitchen Weekly"><link rel="canonical" href="/how-bread-rises/">
</head><body><article>
<p id="p1">Dough needs <b>warm air</b> before it rises, as <a href="https://example.org/guide">a 2024 guide</a> showed.</p>
<p id="p2">The rate grows like <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2 + 1</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2+1</span></span> in the model.</p>
<p id="p3">Reviewers flagged #1 issue with [[brackets]] and key:: value pairs.</p>
<p id="p4">The last paragraph says something worth keeping for later.</p>
</article></body></html>`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(ARTICLE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${server.address().port}/how-bread-rises/?utm_source=twitter`;

const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
check(sw.url().startsWith('chrome-extension://fjgdgmpheeihnlbpmbajkmoapjfieggg/'), 'the extension has its fixed id (the one the app allows)', sw.url());

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL0);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
const select = (sel, from = 0, to = null) => page.evaluate(([s, a, b]) => {
  const el = document.querySelector(s);
  const r = document.createRange();
  if (b === null) r.selectNodeContents(el); else { r.setStart(el.firstChild, a); r.setEnd(el.firstChild, b); }
  getSelection().removeAllRanges(); getSelection().addRange(r);
}, [sel, from, to]);
const hl = () => sw.evaluate(async (id) => highlight(await chrome.tabs.get(id)), tabId);

// highlight out of reading order: p3, then p1, then maths (selection starting inside the formula)
await select('#p3');
check((await hl()).count === 1, 'a highlight is kept');
await select('#p1');
await hl();
await page.evaluate(() => {
  const r = document.createRange();
  r.setStart(document.querySelector('.katex-html').firstChild, 1);
  r.setEnd(document.querySelector('#p2').lastChild, 7);
  getSelection().removeAllRanges(); getSelection().addRange(r);
});
check((await hl()).count === 3, 'three highlights');
check(await page.evaluate(() => CSS.highlights.get('lean-outliner')?.size) === 3, 'all three marked on the page');
check(await page.evaluate(() => getSelection().isCollapsed), 'the selection goes once highlighted');
await page.screenshot({ path: SHOTS + '/t16_marked.png' });

// a reload: the box finds them again and marks them
await page.reload();
check(await page.evaluate(() => !CSS.highlights || !CSS.highlights.get('lean-outliner')), 'a reload clears the marks (the page is new)');
const box = await ctx.newPage();
await box.setViewportSize({ width: 340, height: 520 });
await box.goto(`chrome-extension://fjgdgmpheeihnlbpmbajkmoapjfieggg/popup.html?tab=${tabId}`);
await box.waitForSelector('#list li');
check(await box.locator('#list li').count() === 3, 'the box lists the three highlights');
check((await box.locator('#list li .q').first().textContent()).startsWith('Dough needs'), 'in reading order', await box.locator('#list li .q').first().textContent());
check(await box.inputValue('#title') === 'How Bread Rises', 'the page’s name in the notes (no site name), to edit', await box.inputValue('#title'));
check(await box.textContent('#send') === 'Send 3 highlights', 'Send names the count');
check(await page.evaluate(() => CSS.highlights.get('lean-outliner')?.size) === 3, 'marked again after the reload');
await box.screenshot({ path: SHOTS + '/t16_box.png' });

// drop one, then send
await box.locator('#list li').nth(1).locator('button').click();
await box.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
check(await page.evaluate(() => CSS.highlights.get('lean-outliner')?.size) === 2, 'a removed highlight is unmarked');
await box.click('#send');
await box.waitForFunction(() => /Added|Couldn|isn/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
const st = await box.textContent('#status');
check(st === 'Added 2 highlights to “How Bread Rises”.', 'the box says where they went', st);
await box.screenshot({ path: SHOTS + '/t16_sent.png' });
const file = VAULT + '/pages/How Bread Rises.md';
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const day = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const nth = (d) => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
const now = new Date();
const title = `${now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${nth(now.getUTCDate())}, ${now.getUTCFullYear()}`;
check(text.startsWith('tags:: [[quick capture]]\nsource:: [How Bread Rises · Kitchen Weekly](http://127.0.0.1:'), 'a page of its own, with its source', text);
check(text.includes(`\n- [[${title}]]\n\t- Dough needs **warm air** before it rises, as [a 2024 guide](https://example.org/guide) showed. [↗](http://127.0.0.1:`), 'Markdown kept, linked to its spot', text);
check(text.includes('#:~:text=Dough%20needs%20warm%20air,a%202024%20guide%20showed.)'), 'the spot: a text fragment of its first and last words', text);
check(text.includes('\t- Reviewers flagged #​1 issue with [​[brackets]​] and key:​: value pairs.'), 'tag, link and property look-alikes stay words', text);
check(!text.includes('x^2'), 'the removed one isn’t there');
check(await page.evaluate(() => CSS.highlights.get('lean-outliner')?.size || 0) === 0, 'sent: the marks go');
check(await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).length) === 0, 'and the list is cleared');

// maths: its TeX
await page.evaluate(() => {
  const r = document.createRange();
  r.setStart(document.querySelector('.katex-html').firstChild, 1);
  r.setEnd(document.querySelector('#p2').lastChild, 7);
  getSelection().removeAllRanges(); getSelection().addRange(r);
});
await hl();
const r2 = await sw.evaluate(async (id) => sendAll(await chrome.tabs.get(id)), tabId);
check(r2.ok && r2.added === 1 && !r2.new_page, 'a second batch the same day joins the page', JSON.stringify(r2));
const text2 = fs.readFileSync(file, 'utf8');
check(text2.includes('\t- $x^2 + 1$ in the [↗]('), 'a formula keeps its TeX (a selection starting inside it takes it whole)', text2);
check(text2.split(`[[${title}]]`).length === 2, 'one date bullet for the day', text2);

// one passage straight to today's journal
await select('#p4');
const j = await sw.evaluate(async (id) => toJournal(await chrome.tabs.get(id)), tabId);
check(j.ok, 'sent to the journal', JSON.stringify(j));
const jf = VAULT + `/Diary/${title}.md`;
const jt = fs.existsSync(jf) ? fs.readFileSync(jf, 'utf8') : '';
check(/The last paragraph says something worth keeping for later\. from \[How Bread Rises · Kitchen Weekly\]\(http:\/\/127\.0\.0\.1:\d+\/how-bread-rises\/#:~:text=The%20last%20paragraph%20says,worth%20keeping%20for%20later\.\)/.test(jt), 'a neat link to the passage', jt);

// a page with nothing highlighted
const empty = await sw.evaluate(async (id) => sendAll(await chrome.tabs.get(id)), tabId);
check(empty.error === 'No highlights on this page yet.', 'nothing to send says so', JSON.stringify(empty));
// the receiver missing: a plain way to set it up
fs.renameSync(PROFILE + '/NativeMessagingHosts/com.srikanth.leanoutliner.json', PROFILE + '/gone.json');
await select('#p4');
const nh = await sw.evaluate(async (id) => toJournal(await chrome.tabs.get(id)), tabId);
check(!nh.ok && /Settings → Capture/.test(nh.error), 'not set up: says where to set it up', JSON.stringify(nh));

check(errors.length === 0, 'no errors on the page', errors.join('; '));
await ctx.close();
server.close();
if (fails) { console.log(`FAILED: ${fails}`); process.exit(1); }

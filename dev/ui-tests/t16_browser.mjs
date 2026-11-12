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
// (1.1.1) an article whose spacing differs from the notes' copies: "hypothesis (opens a new tab)" on
// the page, two paragraphs touching with no space between them
const SPACING = `<!doctype html><html><head><meta charset="utf-8"><title>Spacing</title></head><body><article>
<p>The “modified fighting” hypothesis <a href="#x">(opens a new tab)</a>, which says righties win.</p><p>First half ends here.</p><p>Second half starts here.</p>
<p>A passage captured into the journal only, not yet filed.</p>
<p>Short bit.</p>
</article></body></html>`;
// (1.1.1) an article whose words arrive a second after the page has loaded (as many news sites do)
const LATE = `<!doctype html><html><head><meta charset="utf-8"><title>Late</title></head><body><article id="a"></article>
<script>setTimeout(() => { document.getElementById('a').innerHTML = '<p>These words arrive after the page has loaded.</p>'; }, 1000);</script></body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(req.url.startsWith('/spacing/') ? SPACING : req.url.startsWith('/late/') ? LATE : ARTICLE);
});
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
check(await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('a:')).length) === 0, 'and the list is cleared');
// (Build 46) now in the notes: marked softly as kept, and listed in the box
check(await page.evaluate(() => CSS.highlights.get('lean-outliner-kept')?.size || 0) === 2, 'the sent passages are marked as already in the notes');
await box.waitForSelector('#kept:not([hidden])', { timeout: 15000 }).catch(() => {});
check(await box.locator('#kept summary').textContent().catch(() => '') === '2 highlights already in “How Bread Rises”', 'the box lists the passages already in the notes', await box.locator('#kept summary').textContent().catch(() => ''));
check(!(await box.isChecked('#again')), '“Show my highlights again” starts off');

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

// (Build 46) coming back: with "Show my highlights again" off, a reload marks nothing until the box opens
await page.reload();
await sleep(1500);
check(await page.evaluate(() => !CSS.highlights.get('lean-outliner-kept')), 'off: coming back marks nothing by itself');
// on (the test's copy already has the "all websites" permission Edge would ask for)
await sw.evaluate(() => setOpts({ showAgain: true }));
await page.reload();
// (two of the three: the third is a formula, kept as its TeX, which the page draws as maths)
await page.waitForFunction(() => (CSS.highlights.get('lean-outliner-kept')?.size || 0) === 2, null, { timeout: 15000 }).catch(() => {});
const nk = await page.evaluate(() => CSS.highlights.get('lean-outliner-kept')?.size || 0);
check(nk === 2, 'on: coming back to the article marks its passages in the notes', nk);
await page.screenshot({ path: SHOTS + '/t16_kept.png', clip: { x: 0, y: 0, width: 560, height: 140 } });
await box.reload();
await box.waitForSelector('#kept:not([hidden])', { timeout: 15000 }).catch(() => {});
check(await box.isChecked('#again'), 'the box shows the switch on');
check(await box.locator('#kept-list li').count() === 3, 'and lists the three', await box.locator('#kept-list li').count());
check((await box.locator('#kept-list li').first().textContent()).startsWith('Dough needs warm air before it rises, as a 2024 guide showed.'), 'as plain words', await box.locator('#kept-list li').first().textContent());
await box.screenshot({ path: SHOTS + '/t16_box_kept.png' });
await box.evaluate(() => { document.getElementById('kept').open = true; });
await box.screenshot({ path: SHOTS + '/t16_box_kept_open.png' });
// a page that isn't one of his articles: nothing is put into it
const other = await ctx.newPage();
await other.goto(URL0.replace('how-bread-rises/', 'another-article/'));
await sleep(1500);
check(await other.evaluate(() => !document.getElementById('lean-outliner-style') && !CSS.highlights.get('lean-outliner-kept')), 'a page that isn’t one of his articles is left alone');
await other.close();

// (1.1.1) passages spaced differently from the page, a quick capture's time, and a quick capture
// still waiting in the journal: all marked
const SP = URL0.replace(/how-bread-rises\/.*$/, 'spacing/');
fs.writeFileSync(VAULT + '/pages/Spacing.md', `source:: [Spacing](${SP})\n\n- [[July 30th, 2026]]\n\t- **22:26** The “modified fighting” hypothesis(opens a new tab), which says righties win. [↗](${SP}#:~:text=The)\n\t- First half ends here. Second half starts here.\n\t- Short  bit.\n`);
fs.writeFileSync(VAULT + `/Diary/${title}.md`, `- **10:00** [[quick capture]]: #inbox A passage captured into the journal only, not yet filed. [Spacing](${SP}#:~:text=A%20passage)\n`);
await sw.evaluate(() => articles(true));
const sp = await ctx.newPage();
await sp.goto(SP);
await sp.waitForFunction(() => (CSS.highlights.get('lean-outliner-kept')?.size || 0) >= 4, null, { timeout: 15000 }).catch(() => {});
const marked = await sp.evaluate(() => [...(CSS.highlights.get('lean-outliner-kept') || [])].map((r) => r.toString()));
check(marked.some((t) => t.startsWith('The “modified fighting” hypothesis (opens a new tab), which says righties win.')), 'a capture’s time doesn’t stop a passage being found, nor a missing space', JSON.stringify(marked));
check(marked.some((t) => t === 'First half ends here.Second half starts here.'), 'a passage across two paragraphs that touch on the page', JSON.stringify(marked));
check(marked.some((t) => t === 'A passage captured into the journal only, not yet filed.'), 'a quick capture still in the journal is marked too', JSON.stringify(marked));
check(marked.some((t) => t === 'Short bit.'), 'a short passage is found with its spaces squeezed', JSON.stringify(marked));
check(marked.length === 4, 'four passages marked', JSON.stringify(marked));
await sp.screenshot({ path: SHOTS + '/t16_spacing.png', clip: { x: 0, y: 0, width: 640, height: 160 } });
await sp.close();
// a short passage isn't looked for without its spaces (too likely to turn up inside other words)
const loose = await sw.evaluate(async (id) => run(id, () => window.__leanOutliner.paintKept([{ plain: 'Doughn eeds' }, { plain: 'Dough needs warm airbefore it rises' }])), tabId);
check(loose === 1, 'only longer passages are matched without their spaces', loose);
// words that arrive after the page has loaded: looked for again a moment later
const LT = URL0.replace(/how-bread-rises\/.*$/, 'late/');
fs.writeFileSync(VAULT + '/pages/Late.md', `source:: [Late](${LT})\n\n- These words arrive after the page has loaded.\n`);
await sw.evaluate(() => articles(true));
const lt = await ctx.newPage();
await lt.goto(LT);
await lt.waitForFunction(() => (CSS.highlights.get('lean-outliner-kept')?.size || 0) === 1, null, { timeout: 10000 }).catch(() => {});
check(await lt.evaluate(() => CSS.highlights.get('lean-outliner-kept')?.size || 0) === 1, 'words that arrive late are marked once they’re there');
await lt.close();

// (1.1.1) "Send the selected text…" with nothing selected: nothing is sent, and the box greys it out
fs.rmSync(VAULT + `/Diary/${title}.md`, { force: true });
await page.evaluate(() => getSelection().removeAllRanges());
const none = await sw.evaluate(async (id) => toJournal(await chrome.tabs.get(id)), tabId);
check(!none.ok && /Select some text on the page first/.test(none.error), 'nothing selected: says to select text first', JSON.stringify(none));
check(!fs.existsSync(VAULT + `/Diary/${title}.md`), 'and nothing goes to the journal');
await box.reload();
await box.waitForSelector('#title');
await box.waitForFunction(() => document.getElementById('journal').disabled, null, { timeout: 5000 }).catch(() => {});
check(await box.isDisabled('#journal'), 'the box greys out “Send the selected text…” with nothing selected');
await select('#p4');
await box.reload();
await box.waitForSelector('#title');
await box.waitForFunction(() => !document.getElementById('journal').disabled, null, { timeout: 5000 }).catch(() => {});
check(!(await box.isDisabled('#journal')), 'and offers it once text is selected');
// (1.1.1) the setting sits behind the gear
check(await box.isHidden('#settings'), 'the settings start folded away');
await box.click('#gear');
check(await box.isVisible('#again'), 'the gear shows “Show my highlights again”');
check(await box.getAttribute('#gear', 'aria-expanded') === 'true', 'and says it is open');
await box.screenshot({ path: SHOTS + '/t16_box_settings.png' });
await box.click('#gear');
check(await box.isHidden('#settings'), 'a second click folds it away');

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

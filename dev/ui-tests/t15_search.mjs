// Search (Ctrl+K) and the command list (Ctrl+Shift+P): one box (search.js, commands.js).
// Search: words in any order, small typos in page names forgiven (core search.rs), pages before
// "New page: …", notes drawn as they look with the words marked, recent searches (per notes folder,
// Clear) and recent pages when it opens empty. Commands: every action by name with its key from the
// shortcut table, editing ones for the note being edited, page ones on a page; phones via the menu.
import { open, check, failures, sleep, go, editBlock, write, SHOTS } from './lib.mjs';

const allErrors = [];
let { browser, page, errors } = await open();
const rows = () => page.locator('#search .results li[data-k]');
const rowTexts = () => rows().allInnerTexts();
const kinds = () => page.evaluate(() => [...document.querySelectorAll('#search .results li[data-k]')].map((li) => li.className));
const heads = () => page.locator('#search .results .r-h').allInnerTexts();
const hashNow = () => page.evaluate(() => decodeURIComponent(location.hash));
async function search(q) {
  await page.locator('#search input').fill(q);
  await sleep(450);
}

console.log('search: any order, typos in page names, pages before “New page”, notes as they look');
await page.keyboard.press('Control+k');
await sleep(250);
check(await page.locator('#search').isVisible() && await page.evaluate(() => document.activeElement === document.querySelector('#search input')), 'Ctrl+K opens the box, ready to type');
check((await page.locator('#search .results').innerText()).includes('any order'), 'opened empty the first time: a hint (no recent searches or pages yet)');
await search('recipe dumplings');
let k = await kinds();
let t = await rowTexts();
check(k[0] === 'r-page' && t[0].trim() === 'Dumplings recipe', 'the words in any order find the page', t.join(' | '));
check(await page.locator('#search .results li.r-page').first().locator('mark.hit').count() === 2, 'both words marked in its name');
const newAt = k.indexOf('r-new'), lastPage = k.lastIndexOf('r-page');
check(newAt > lastPage, '“New page: …” comes after the pages that exist', k.join(' '));
const note = page.locator('#search .results li.r-hit', { hasText: 'Walked to the bakery' });
check(await note.count() === 1, 'notes with the words are found');
const nt = await note.locator('.r-text').innerText();
check(nt.includes('thought about Dumplings recipe fillings') && !nt.includes('[['), 'a note shows as it looks: the link as its name, no [[ ]]', nt);
check(await note.locator('.r-text a.pl').count() === 1 && await note.locator('.r-text mark.hit').count() >= 2, 'the link drawn as a link, the words marked in it');
check((await note.locator('.r-where').innerText()).trim().length > 5, 'and its page under it');
check(JSON.stringify(await heads()) === JSON.stringify(['PAGES', 'NOTES']) || JSON.stringify(await heads()) === JSON.stringify(['Pages', 'Notes']), 'grouped: Pages, then Notes', (await heads()).join(','));
await page.screenshot({ path: SHOTS + '/search-results.png' });

await search('dmplings recpie');
t = await rowTexts();
check((await kinds())[0] === 'r-page' && t[0].trim() === 'Dumplings recipe', 'a letter or two off in a page name: still found', t.join(' | '));
check(await page.locator('#search .results li.r-page').first().locator('mark.hit').count() === 2, 'the words it took for them marked');

await search('spice order');
const todo = page.locator('#search .results li.r-hit', { hasText: 'spice order' }).first();
check(await todo.locator('.mk').innerText() === 'TODO' && (await todo.locator('.r-text').innerText()).includes('email Rosa Penhallow about the spice order'), 'a to-do: its word as a label, then its text', await todo.innerText());
check((await page.locator('#search .results li.r-hit mark.hit').allInnerTexts()).join(' ').toLowerCase().includes('spice'), 'the words marked');

await search('Marta Pell');
k = await kinds();
check(k[0] === 'r-page' && !k.includes('r-new'), 'a page with exactly that name: no “New page”', k.join(' '));
// Enter opens the best one
await page.keyboard.press('Enter');
await sleep(500);
check(await hashNow() === '#/page/Marta Pell' && await page.locator('#search').isHidden(), 'Enter opens it, the box closes', await hashNow());
// Shift+Enter: to the side (as Shift+click on a link)
await page.keyboard.press('Control+k');
await search('rosa penhallow');
await page.keyboard.press('Shift+Enter');
await sleep(700);
const sides = await page.evaluate(() => window.leanApp.tabs.panes.map((p) => decodeURIComponent(p.tabs[p.cur].hist[p.tabs[p.cur].at])));
check(sides.length === 2 && sides[0] === '#/page/Marta Pell' && sides[1] === '#/page/Rosa Penhallow', 'Shift+Enter opens it to the side', sides.join(' | '));
await page.evaluate(() => window.leanApp.tabs.closePane(1));
await sleep(400);

// a long note: the part with the words shows, cut before them
write('pages/Long note.md', '- ' + 'Some words before the part that matters, with [[a link]] and more, '.repeat(12) + 'and then the quokka at last.\n');
await page.evaluate(() => fetch('/api/rescan', { method: 'POST', body: '{}' }));
await page.keyboard.press('Control+k');
await search('quokka');
const lt = await page.locator('#search li.r-hit .r-text').first().evaluate((el) => ({ text: el.textContent, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) }));
check(lt.text.startsWith('…') && lt.text.includes('quokka at last') && lt.text.length < 120 && lt.h <= lt.lh * 2 + 2, 'a long note shows the part with the words (cut before them, two lines at most)', JSON.stringify(lt));
await page.keyboard.press('Escape');

console.log('recent searches (per notes folder, Clear) and recent pages');
await go(page, '#/page/' + encodeURIComponent('Rosa Penhallow'));
await page.keyboard.press('Control+k');
await sleep(250);
let h = await heads();
check(h.map((x) => x.toLowerCase()).join(',').startsWith('recent searches') && h.some((x) => /recent pages/i.test(x)), 'opened empty: recent searches, then recent pages', h.join(','));
t = await rowTexts();
check(t[0].trim() === 'rosa penhallow' && t[1].trim() === 'Marta Pell', 'the searches that opened a page are remembered, newest first', t.join(' | '));
check(t.some((x) => x.trim() === 'Marta Pell') && !t.slice(1).some((x) => x.trim() === 'Rosa Penhallow'), 'recent pages: the one before, not the page open now', t.join(' | '));
await page.screenshot({ path: SHOTS + '/search-recent.png' });
await rows().first().click();
await sleep(450);
check(await page.locator('#search input').inputValue() === 'rosa penhallow' && (await kinds())[0] === 'r-page', 'picking a recent search searches it again');
await page.locator('#search input').fill('');
await sleep(150);
const { stored, vault } = await page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem('recentSearches')), vault: JSON.parse(localStorage.getItem('vault')) }));
check(Object.keys(stored).length === 1 && stored[vault]?.join() === 'rosa penhallow,Marta Pell', 'kept for this notes folder', JSON.stringify(stored));
// another folder's searches don't show here
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('recentSearches')); s['/some/other/folder'] = ['elsewhere']; localStorage.setItem('recentSearches', JSON.stringify(s)); });
await page.locator('#search input').fill('x');
await page.locator('#search input').fill('');
await sleep(150);
check(!(await rowTexts()).some((x) => x.includes('elsewhere')), 'another folder’s searches aren’t shown');
await page.locator('#search .r-clear').click();
await sleep(150);
h = await heads();
check(!h.some((x) => /recent searches/i.test(x)) && h.some((x) => /recent pages/i.test(x)), 'Clear forgets this folder’s searches (recent pages stay)', h.join(','));
check(JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('recentSearches')))) === '{"/some/other/folder":["elsewhere"]}', 'and only this folder’s');
check(await page.evaluate(() => document.activeElement === document.querySelector('#search input')), 'the box keeps the keyboard');
await page.keyboard.press('Escape');
await sleep(150);
check(await page.locator('#search').isHidden(), 'Esc closes it');

console.log('command list: Ctrl+Shift+P, each action with its key');
await page.keyboard.press('Control+Shift+P');
await sleep(250);
check(await page.locator('#search').isVisible() && await page.locator('#search input').getAttribute('placeholder') === 'Type a command', 'Ctrl+Shift+P opens the command list');
h = await heads();
check(['Go', 'Page', 'Window', 'Look'].every((g) => h.some((x) => x.toLowerCase() === g.toLowerCase())), 'in groups', h.join(','));
const allPagesRow = page.locator('#search li.r-cmd', { hasText: 'Go to All pages' });
check((await allPagesRow.locator('kbd').allInnerTexts()).join(' ') === 'g a', 'each with its key (from the shortcut table): Go to All pages  g a');
check((await page.locator('#search li.r-cmd', { hasText: 'Rename this page…' }).count()) === 1 && (await page.locator('#search li.r-cmd', { hasText: 'Page history…' }).count()) === 1, 'on a page: its actions (rename, history…)');
check((await page.locator('#search li.r-cmd', { hasText: 'Find on this page' }).locator('kbd').innerText()) === 'Ctrl+F', 'Find on this page  Ctrl+F');
await page.screenshot({ path: SHOTS + '/commands.png' });
await page.keyboard.type('all pag');
await sleep(150);
t = await rowTexts();
check(t[0].startsWith('Go to All pages'), 'typing finds it by name', t.slice(0, 3).join(' | '));
await page.keyboard.press('Enter');
await sleep(500);
check(await hashNow() === '#/pages' && await page.locator('#search').isHidden(), 'Enter runs it', await hashNow());
// words in any order, and the words it's also known by
await page.keyboard.press('Control+Shift+P');
await page.keyboard.type('paper look');
await sleep(150);
check((await rowTexts())[0].startsWith('Look: Paper'), 'words in any order: “paper look” → Look: Paper');
await page.keyboard.press('Enter');
await sleep(200);
check(await page.evaluate(() => document.documentElement.dataset.skin) === 'paper', 'and it changes the look');
await page.keyboard.press('Control+Shift+P');
await page.keyboard.type('bigger');
await page.keyboard.press('Enter');
await sleep(200);
check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim()) === '1.05', 'Bigger text (the same as Ctrl+=)');
await page.keyboard.press('Control+0');
await page.evaluate(() => window.leanApp.setSkin('calm'));
// the other mode: its key, and the button at the bottom
await page.keyboard.press('Control+Shift+P');
await sleep(150);
await page.keyboard.press('Control+k');
await sleep(150);
check(await page.locator('#search input').getAttribute('placeholder') === 'Search pages and notes', 'Ctrl+K in the command list: search');
await page.locator('#search .sb-mode').click();
await sleep(150);
check(await page.locator('#search input').getAttribute('placeholder') === 'Type a command' && await page.evaluate(() => document.activeElement === document.querySelector('#search input')), 'the button at the bottom switches too, the box keeps the keyboard');
await page.keyboard.press('Escape');

console.log('page actions from the command list');
await go(page, '#/page/' + encodeURIComponent('Marta Pell'));
await page.keyboard.press('Control+Shift+P');
await page.keyboard.type('find on');
await page.keyboard.press('Enter');
await sleep(300);
check(await page.locator('#findbar').isVisible(), 'Find on this page');
await page.keyboard.press('Escape');
await sleep(150);
await page.keyboard.press('Control+Shift+P');
await page.keyboard.type('favourites');
await sleep(150);
check((await rowTexts())[0].startsWith('Add to favourites'), 'Add to favourites', (await rowTexts()).join(' | '));
await page.keyboard.press('Enter');
await sleep(400);
check((await page.locator('#favs').innerText()).includes('Marta Pell'), 'it’s in the favourites');
await page.keyboard.press('Control+Shift+P');
await page.keyboard.type('history');
await page.keyboard.press('Enter');
await sleep(500);
check(await page.locator('.hist-back').count() === 1, 'Page history… opens the page’s history');
await page.keyboard.press('Escape');
await sleep(300);

console.log('editing actions for the note being edited');
await go(page, '#/page/' + encodeURIComponent('Marta Pell'));
await editBlock(page, 'Wrote Notes');
for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowLeft'); // "Wild Yeast" selected
await page.keyboard.press('Control+Shift+P');
await sleep(400); // (longer than the editor's wait before it stops on losing the keyboard)
const hl = page.locator('#search li.r-cmd', { hasText: /^Highlight/ });
check((await hl.locator('kbd').innerText()) === 'Ctrl+H', 'editing commands, keys from config.edn :shortcuts (Highlight  Ctrl+H)', await hl.innerText().catch(() => ''));
check((await page.locator('#search li.r-cmd', { hasText: 'Indent' }).first().locator('kbd').innerText()) === 'Tab', 'Indent  Tab');
await page.keyboard.type('bold');
await sleep(100);
check((await rowTexts())[0].startsWith('Bold'), 'Bold found', (await rowTexts()).slice(0, 2).join(' | '));
await page.keyboard.press('Enter');
await sleep(300);
let ta = await page.evaluate(() => { const t = document.querySelector('textarea.ed'); return t && { v: t.value, s: t.value.slice(t.selectionStart, t.selectionEnd), focus: document.activeElement === t }; });
check(ta?.v === 'Wrote Notes on **Wild Yeast**' && ta.s === 'Wild Yeast' && ta.focus, 'Bold wraps the words that were selected; still editing', JSON.stringify(ta));
// Esc from the box: back to the note, where it was
await page.keyboard.press('Control+k');
await sleep(400);
await page.keyboard.press('Escape');
await sleep(200);
ta = await page.evaluate(() => { const t = document.querySelector('textarea.ed'); return t && { s: t.value.slice(t.selectionStart, t.selectionEnd), focus: document.activeElement === t }; });
check(ta?.focus && ta.s === 'Wild Yeast', 'Esc closes the box and the note is being edited again, as it was', JSON.stringify(ta));
await page.keyboard.press('Control+Shift+P');
await page.keyboard.type('indent');
await sleep(100);
check((await rowTexts())[0].startsWith('Indent'), 'Indent found');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape'); // (stop editing)
await sleep(600);
check(!(await page.evaluate(() => !!document.querySelector('textarea.ed'))), 'editing stopped');
await page.keyboard.press('Control+Shift+P');
await sleep(200);
check(await page.locator('#search li.r-cmd', { hasText: /^Bold/ }).count() === 0, 'no editing commands when no note is being edited');
await page.keyboard.press('Escape');

console.log('looks');
for (const skin of ['calm', 'plain', 'plainnight', 'paper']) {
  await page.evaluate((s) => window.leanApp.setSkin(s), skin);
  await page.keyboard.press('Control+k');
  await search('dumplings recipe');
  await page.screenshot({ path: SHOTS + `/search-${skin}.png` });
  const c = await page.evaluate(() => { const m = document.querySelector('#search mark.hit'); const cs = getComputedStyle(m); return { bg: cs.backgroundColor, fg: cs.color }; });
  check(c.bg !== 'rgba(0, 0, 0, 0)', `${skin}: the words found are marked`, JSON.stringify(c));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+P');
  await sleep(200);
  await page.screenshot({ path: SHOTS + `/commands-${skin}.png` });
  await page.keyboard.press('Escape');
}
await page.evaluate(() => window.leanApp.setSkin('calm'));
allErrors.push(...errors);
await browser.close();

console.log('phone: the menu has Commands, rows easy to tap, no keys shown');
({ browser, page, errors } = await open({ viewport: { width: 390, height: 844 }, touch: true }));
await page.locator('#topbar [data-a="search"]').tap();
await sleep(300);
await page.locator('#search input').fill('recipe dumplings');
await sleep(500);
const hgt = await page.evaluate(() => [...document.querySelectorAll('#search .results li[data-k]')].map((li) => li.getBoundingClientRect().height));
check(hgt.length > 2 && hgt.every((x) => x >= 44), 'results at least 44px tall', hgt.join(','));
await page.screenshot({ path: SHOTS + '/search-phone.png' });
const box = await page.evaluate(() => { const r = document.querySelector('.search-box').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
check(box.l >= 0 && box.r <= box.w, 'the box fits the screen', JSON.stringify(box));
await page.evaluate(() => window.leanApp.onBack());
await sleep(200);
check(await page.locator('#search').isHidden(), 'Back closes it');
await page.locator('#topbar [data-a="menu"]').tap();
await sleep(400);
const cmdBtn = page.locator('#side [data-a="commands"]');
check(await cmdBtn.isVisible(), 'the menu has “Commands”');
await cmdBtn.tap();
await sleep(300);
check(await page.locator('#search input').getAttribute('placeholder') === 'Type a command', 'it opens the command list');
check(await page.locator('#search .r-keys').first().isHidden(), 'no keys on a phone');
check(await page.locator('#search li.r-cmd', { hasText: 'Open the menu' }).count() === 1 && await page.locator('#search li.r-cmd', { hasText: 'Hide or show the sidebar' }).count() === 0, 'phone wording: Open the menu (no sidebar)');
await page.screenshot({ path: SHOTS + '/commands-phone.png' });
await page.locator('#search input').fill('to-dos');
await sleep(150);
await rows().first().tap();
await sleep(500);
check(await hashNow() === '#/todos' && await page.locator('#search').isHidden(), 'a tap runs a command', await hashNow());
await page.evaluate(() => window.leanApp.setSkin('plainnight'));
await page.locator('#topbar [data-a="search"]').tap();
await sleep(300);
await page.screenshot({ path: SHOTS + '/search-phone-empty-plainnight.png' });
allErrors.push(...errors);
await browser.close();

console.log('a laptop window without the sidebar: the menu’s Commands stays a phone thing');
({ browser, page, errors } = await open());
check(await page.locator('#side [data-a="commands"]').isHidden(), 'no “Commands” in the laptop sidebar (Ctrl+Shift+P, and the box’s button)');
allErrors.push(...errors);
await browser.close();

check(allErrors.length === 0, 'no script errors', allErrors.join('\n'));
if (allErrors.length) console.log('script errors:', allErrors);
if (failures()) { console.log(`${failures()} FAILED`); process.exit(1); }

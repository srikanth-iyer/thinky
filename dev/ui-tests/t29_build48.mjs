// Build 48 (his #thinky #claude requests of Nov 13): one-press shortcuts with Ctrl or Alt work with no
// note being typed in and with notes selected (Ctrl+Alt+T for fold or unfold all, set in config.edn);
// ← / → fold and unfold the selected notes (a note with nothing to fold: nothing happens) and Ctrl+↑ /
// Ctrl+↓ fold and unfold a note, as in Logseq; Check this folder says "files" with each one's kind and
// is laid out in labelled parts with the ticks lined up; "Show attachments on this page"; Settings →
// Typing & keys: the fixed keys as a table and a Change button per shortcut, saved in config.edn; the
// Settings tabs rearranged.
import fs from 'node:fs';
import { open, check, failures, sleep, go, editBlock, read, write, VAULT, SHOTS } from './lib.mjs';

// his own key for fold all, as in his logseq/config.edn
write('logseq/config.edn', read('logseq/config.edn').replace(':editor/highlight "ctrl+h"}', ':editor/highlight "ctrl+h" :editor/toggle-open-blocks "alt+ctrl+t"}'));
write('pages/Fold test.md', '- Parent A\n\t- child A1\n\t\t- grand A1a\n\t- child A2\n- Parent B\n\t- child B1\n- Leaf C\n');
write('pages/Attach test.md', '- Plan\n\t- see ![p](../assets/dot.png)\n\t- the paper [paper.pdf](../assets/paper.pdf)\n- Folded\n  collapsed:: true\n\t- inside: [notes](../assets/gone%20notes.txt)\n- no files here, just `../assets/code.png`\n');
write('pages/Missing kinds.md', '- ![x](../assets/lost.png) and [doc](../assets/lost.pdf)\n- [z](../assets/lost.zip)\n');
const later = Math.floor(Date.now() / 1000) + 4 * 86400; // (pictures from the last 3 days aren't judged)

const { browser, page, errors } = await open();
const folded = () => page.locator('.outline .blk.collapsed').count();
const saved = async (re, ms = 4000) => { for (let t = 0; t < ms; t += 200) { if (re.test(read('pages/Fold test.md'))) return true; await sleep(200); } return false; };

console.log('Ctrl+Alt+T (fold or unfold all, from config.edn) with no note being typed in');
await go(page, '#/page/' + encodeURIComponent('Fold test'));
await page.waitForSelector('.outline .blk');
await page.mouse.click(5, 450); // (nothing focused, nothing typed in)
await page.keyboard.press('Control+Alt+t');
await sleep(300);
check(await folded() === 3, 'every note with sub-notes folds', await folded());
check(await saved(/Parent A\n\s+collapsed:: true[\s\S]*Parent B\n\s+collapsed:: true/), 'and it is saved in the file', read('pages/Fold test.md'));
await page.keyboard.press('Control+Alt+t');
await sleep(300);
check(await folded() === 0, 'again: everything opens', await folded());

// Build 49 (his pick, Nov 14): ← / → on selected notes start typing in them, as in Logseq
console.log('← / → with notes selected: typing in the first / last one');
const selText = () => page.evaluate(() => [...document.querySelectorAll('.outline .blk.sel:not([hidden]) > .bc')].map((b) => b.textContent.trim()).join('|'));
const caret = () => page.evaluate(() => { const t = document.querySelector('textarea.ed'); return t ? [t.value, t.selectionStart] : null; });
await sleep(1200); // (the unfolding saved)
const before = read('pages/Fold test.md');
await editBlock(page, 'Parent A');
await page.keyboard.press('Escape');
await sleep(150);
check((await selText()).startsWith('Parent A'), 'Parent A is selected', await selText());
await page.keyboard.press('ArrowRight');
await sleep(200);
let c = await caret();
check(c && c[0] === 'Parent A' && c[1] === c[0].length, '→: typing in it, the cursor at its end', JSON.stringify(c));
await page.keyboard.press('Escape');
await sleep(150);
await page.keyboard.press('ArrowLeft');
await sleep(200);
c = await caret();
check(c && c[0] === 'Parent A' && c[1] === 0, '←: typing in it, the cursor at its start', JSON.stringify(c));
await page.keyboard.press('Escape');
await sleep(150);
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await sleep(150);
await page.keyboard.press('ArrowRight');
await sleep(200);
c = await caret();
check(c && c[0] === 'grand A1a', 'several picked (Parent A, child A1, grand A1a): → types in the last one picked', JSON.stringify(c));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await sleep(300);
check(await folded() === 0 && read('pages/Fold test.md') === before, 'nothing folded, the file unchanged', JSON.stringify([before, read('pages/Fold test.md')]));

console.log('fold all with a sub-note selected: the selection moves to what shows (Build 49)');
await editBlock(page, 'child B1');
await page.keyboard.press('Escape');
await sleep(150);
await page.keyboard.press('Control+Alt+t');
await sleep(300);
check(await folded() === 3 && await selText() === 'Parent B', 'everything folds and Parent B is selected, not its hidden sub-note', await selText());
await page.keyboard.press('Control+Alt+t');
await sleep(300);
await page.keyboard.press('Escape');

console.log('Ctrl+↑ / Ctrl+↓ (Logseq’s fold and unfold)');
await editBlock(page, 'Parent B');
await page.keyboard.press('Control+ArrowUp');
await sleep(250);
check(await folded() === 1 && await page.locator('.outline .blk.collapsed textarea.ed').count() === 1, 'while typing: the note folds, still being typed in');
await page.keyboard.press('Control+ArrowDown');
await sleep(250);
check(await folded() === 0, 'Ctrl+↓ unfolds it');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.mouse.click(5, 450);
// Build 49 (his pick): one level a press, as Logseq's collapse! / expand!
const foldedNames = () => page.evaluate(() => [...document.querySelectorAll('.outline .blk.collapsed > .bc')].map((b) => b.textContent.trim()).join('|'));
await page.keyboard.press('Control+ArrowUp');
await sleep(250);
check(await foldedNames() === 'child A1', 'nothing selected: the deepest open level folds first (child A1)', await foldedNames());
await page.keyboard.press('Control+ArrowUp');
await sleep(250);
check(await folded() === 3, 'again: the next level up (Parent A, Parent B)', await foldedNames());
await page.keyboard.press('Control+ArrowDown');
await sleep(250);
check(await foldedNames() === 'child A1', 'Ctrl+↓: the top level opens first, child A1 stays folded', await foldedNames());
await page.keyboard.press('Control+ArrowDown');
await sleep(250);
check(await folded() === 0, 'and Ctrl+↓ again opens it');

console.log('another one-press key from Settings works anywhere: To-dos on Ctrl+Alt+O');
await go(page, '#/settings/typing');
await page.waitForSelector('.keys-card');
const groups = await page.locator('.keys-fixed tr.kg th').allTextContents();
check(groups.join('|') === 'Editing|Selecting|While typing', 'the fixed keys: a table in three groups', groups.join('|'));
check(!(await page.locator('.keys-card').textContent()).includes('Also:'), 'no long "Also:" sentence any more');
check((await page.locator('tr[data-a="sidebar/open-today-page"] .kk').textContent()).trim() === 'none', 'an action with no key of its own says "none", not "turned off"');
await page.locator('tr[data-a="go/todos"] .k-change').click();
await page.waitForSelector('tr.k-rec .k-wait');
await page.keyboard.press('Control+Alt+o');
await page.waitForSelector('tr[data-a="go/todos"] .mine', { timeout: 4000 });
check(/:go\/todos "mod\+alt\+o"/.test(read('logseq/config.edn')), 'Change → Ctrl+Alt+O: saved in config.edn :shortcuts', read('logseq/config.edn'));
check(read('logseq/config.edn').includes(':editor/toggle-open-blocks "alt+ctrl+t"'), 'the other shortcuts in it as they were');
await go(page, '#/journals');
await page.mouse.click(5, 450);
await page.keyboard.press('Control+Alt+o');
await sleep(500);
check(await page.evaluate(() => location.hash) === '#/todos', 'pressing it opens To-dos', await page.evaluate(() => location.hash));

console.log('Settings → Typing & keys: taken keys, fixed keys, a sequence, Turn off, Back to default');
await go(page, '#/settings/typing');
await page.waitForSelector('.keys-card');
await page.locator('tr[data-a="go/all-pages"] .k-change').click();
await page.keyboard.press('Control+k');
await page.waitForSelector('.modal-back', { timeout: 3000 });
check(/already used for\s+Search/.test(await page.locator('.modal-back').textContent()), 'keys another action uses: it says which, and asks', await page.locator('.modal-back').textContent());
await page.locator('.modal-back [data-v="1"]').click();
await page.waitForSelector('tr[data-a="go/all-pages"] .mine', { timeout: 4000 });
let cfg = read('logseq/config.edn');
check(/:go\/all-pages "mod\+k"/.test(cfg) && /:go\/search false/.test(cfg), 'yes: All pages takes Ctrl+K, Search gives it up (turned off)', cfg);
check((await page.locator('tr[data-a="go/search"] .kk').textContent()).includes('turned off'), 'and the table says so');
await page.locator('tr[data-a="go/search"] .k-change').click();
await page.locator('tr.k-rec [data-k="default"]').click();
await sleep(800);
await page.locator('tr[data-a="go/all-pages"] .k-change').click();
await page.locator('tr.k-rec [data-k="default"]').click();
await sleep(800);
cfg = read('logseq/config.edn');
check(!/go\/search|go\/all-pages/.test(cfg), 'Back to default takes their entries out of config.edn', cfg);
await page.locator('tr[data-a="go/date"] .k-change').click();
await page.keyboard.press('Control+b');
await sleep(200);
check(/always does its own job/.test(await page.locator('tr[data-a="go/date"]').textContent()), 'a fixed key (Ctrl+B, bold) is refused');
await page.keyboard.press('Escape');
await sleep(200);
check(!(await page.locator('tr.k-rec').count()) && !/go\/date/.test(read('logseq/config.edn')), 'Esc: nothing changed');
await page.locator('tr[data-a="go/next-journal"] .k-change').click();
await page.keyboard.press('q');
await sleep(100);
await page.keyboard.press('n');
await page.waitForSelector('tr[data-a="go/next-journal"] .mine', { timeout: 4000 });
check(/:go\/next-journal "q n"/.test(read('logseq/config.edn')), 'two keys one after the other ("q n") are saved as a sequence', read('logseq/config.edn'));
await page.locator('tr[data-a="ui/toggle-wide-mode"] .k-change').click();
await page.locator('tr.k-rec [data-k="off"]').click();
await sleep(800);
check(/:ui\/toggle-wide-mode false/.test(read('logseq/config.edn')), 'Turn off writes false (Logseq’s way)', read('logseq/config.edn'));
await page.screenshot({ path: SHOTS + '/t29_keys.png', fullPage: true });

// Build 49: the recorder stops listening the moment its row leaves the screen (three reviewers found
// keys typed later in a note were eaten and saved as a shortcut)
console.log('Change, then leave without pressing keys');
const cfgBefore = read('logseq/config.edn');
await page.locator('tr[data-a="go/date"] .k-change').click();
await page.waitForSelector('tr.k-rec .k-wait');
await go(page, '#/page/' + encodeURIComponent('Fold test'));
await editBlock(page, 'Leaf C');
await page.keyboard.press('End');
await page.keyboard.type(' xy');
await sleep(300);
check((await page.locator('textarea.ed').inputValue()) === 'Leaf C xy', 'keys typed in a note afterwards reach the note', await page.locator('textarea.ed').inputValue());
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await sleep(800);
check(read('logseq/config.edn') === cfgBefore, 'and nothing was saved as a shortcut', read('logseq/config.edn'));
write('pages/Fold test.md', read('pages/Fold test.md').replace('Leaf C xy', 'Leaf C'));
await go(page, '#/settings/typing');
await page.waitForSelector('.keys-card');
await page.locator('tr[data-a="go/date"] .k-change').click();
await page.waitForSelector('tr.k-rec .k-wait');
await page.locator('.set-tabs [data-tab="look"]').click();
await sleep(300);
await page.keyboard.press('Control+k');
await sleep(400);
check(await page.locator('#search').isVisible() && read('logseq/config.edn') === cfgBefore, 'another Settings tab: Ctrl+K opens search, nothing saved');
await page.keyboard.press('Escape');
await sleep(200);

console.log('Change by keyboard alone: Tab reaches the row’s buttons');
await page.locator('.set-tabs [data-tab="typing"]').click();
await page.waitForSelector('.keys-card');
await page.locator('tr[data-a="go/date"] .k-change').focus();
await page.keyboard.press('Enter');
await page.waitForSelector('tr.k-rec .k-wait');
await page.keyboard.press('Tab');
await sleep(100);
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
check(await focused() === 'Turn off', 'Tab: the first button that can be pressed (Turn off)', await focused());
await page.keyboard.press('Enter');
await page.waitForSelector('tr[data-a="go/date"] .mine', { timeout: 4000 });
check(/:go\/date false/.test(read('logseq/config.edn')), 'Enter on it: turned off', read('logseq/config.edn'));
check(await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.a) === 'go/date' && await focused() === 'Change', 'the keyboard is back on its Change button');
await page.keyboard.press('Enter');
await page.waitForSelector('tr.k-rec .k-wait');
await page.keyboard.press('Tab');
check(await focused() === 'Back to default', 'now Back to default can be reached', await focused());
await page.keyboard.press('Enter');
await sleep(800);
check(!/go\/date/.test(read('logseq/config.edn')), 'and it takes the entry out', read('logseq/config.edn'));

console.log('an F-key works as a shortcut (Build 49)');
await page.locator('tr[data-a="go/all-pages"] .k-change').click();
await page.waitForSelector('tr.k-rec .k-wait');
await page.keyboard.press('F6');
await page.waitForSelector('tr[data-a="go/all-pages"] .mine', { timeout: 4000 });
check(/:go\/all-pages "f6"/.test(read('logseq/config.edn')), 'F6 saved', read('logseq/config.edn'));
await go(page, '#/journals');
await page.mouse.click(5, 450);
await page.keyboard.press('F6');
await sleep(500);
check(await page.evaluate(() => location.hash) === '#/pages', 'pressing F6 opens All pages', await page.evaluate(() => location.hash));
await go(page, '#/settings/typing');
await page.waitForSelector('.keys-card');
await page.locator('tr[data-a="go/all-pages"] .k-change').click();
await page.locator('tr.k-rec [data-k="default"]').click();
await sleep(800);

console.log('keys that would not work are refused (Build 49, each checked by a reviewer)');
const tryKeys = async (action, press) => {
  await page.locator(`tr[data-a="${action}"] .k-change`).click();
  await page.waitForSelector('tr.k-rec .k-wait');
  for (const k of press) { await page.keyboard.press(k); await sleep(80); }
  await sleep(300);
  const said = await page.locator(`tr[data-a="${action}"] .kk`).textContent();
  await page.keyboard.press('Escape');
  await sleep(150);
  return said;
};
const cfg0 = read('logseq/config.edn');
check(/work for going places/.test(await tryKeys('go/search', ['q', 's'])), 'a two-key shortcut for Search (which only one-press keys reach): refused');
check(/always does its own job/.test(await tryKeys('go/next-journal', ['Enter', 'Enter'])), 'Enter then Enter: refused (a fixed key)');
check(/always does its own job/.test(await tryKeys('ui/toggle-left-sidebar', ['Shift+F10'])), 'Shift+F10 (the note menu): refused');
check(/scroll the page|always does its own job/.test(await tryKeys('go/date', ['g', 'ArrowDown'])), 'a two-key shortcut ending in an arrow: refused');
check(/scroll the page/.test(await tryKeys('go/date', ['g', 'End'])), 'one ending in End (which scrolls): refused, saying why');
check(/kept for Move a note up/.test(await tryKeys('ui/text-reset', ['Alt+Shift+ArrowUp'])), 'Alt+Shift+↑ (moves favourites): kept for Move a note up');
check(read('logseq/config.edn') === cfg0, 'nothing saved by any of these');
// Shift with a sign is written as Logseq writes it, and Logseq's way works in thinky
await page.locator('tr[data-a="go/all-pages"] .k-change').click();
await page.waitForSelector('tr.k-rec .k-wait');
await page.keyboard.press('Control+Shift+Slash');
await page.waitForSelector('tr[data-a="go/all-pages"] .mine', { timeout: 4000 });
check(/:go\/all-pages "mod\+shift\+\/"/.test(read('logseq/config.edn')), 'Ctrl+Shift+/ saved as Logseq writes it ("mod+shift+/", not "?")', read('logseq/config.edn'));
await go(page, '#/journals');
await page.mouse.click(5, 450);
await page.keyboard.press('Control+Shift+Slash');
await sleep(500);
check(await page.evaluate(() => location.hash) === '#/pages', 'and pressing it opens All pages', await page.evaluate(() => location.hash));
await go(page, '#/settings/typing');
await page.waitForSelector('.keys-card');
await page.locator('tr[data-a="go/all-pages"] .k-change').click();
await page.locator('tr.k-rec [data-k="default"]').click();
await sleep(800);

console.log('Settings tabs (his pick: About and Help apart, Property display under Look)');
const tabs = await page.locator('.set-tabs [data-tab]').allTextContents();
check(tabs.join('|') === 'About|Notes|Safety|Look|Typing & keys|Capture|Help', 'About, Notes, Safety, Look, Typing & keys, Capture, Help', tabs.join('|'));
await go(page, '#/settings/look');
await page.waitForSelector('.prop-display', { timeout: 4000 });
check(true, 'Look has Property display');
await go(page, '#/settings/writing');
await sleep(300);
check(await page.evaluate(() => !document.querySelector('[id^="sp-typing"]').hidden), 'the old #/settings/writing opens Typing & keys');
await go(page, '#/settings/help');
await page.waitForSelector('.fb .fb-msg');
check(await page.locator('.set-panel:not([hidden]) .card > h2').allTextContents().then((x) => x.join('|')) === 'Send feedback|Problems log', 'Help: Send feedback and the problems log');

console.log('Show attachments on this page');
await go(page, '#/page/' + encodeURIComponent('Attach test'));
await page.waitForSelector('.outline .blk');
const attBefore = read('pages/Attach test.md');
await page.locator('.title-row [data-a="more"]').click();
// Build 49 (his note of Nov 14): the page menu's rows have icons, like the phone's side menu
const noIcon = await page.evaluate(() => [...document.querySelectorAll('.pop.menu li > button')].filter((b) => !b.querySelector('.m-ic svg')).map((b) => b.textContent.trim()));
check(noIcon.length === 0, 'every row of the page ⋯ menu has an icon', noIcon.join('|'));
await page.locator('.pop.menu button', { hasText: 'Show attachments on this page' }).click();
await page.waitForSelector('#attbar:not([hidden])');
const bar = () => page.locator('#attbar').textContent();
check(/3 notes with 3 attachments/.test(await bar()) && /1 of 3/.test(await bar()), 'the bar: how many, and the first one', await bar());
await page.screenshot({ path: SHOTS + '/t29_attach.png' });
check(await page.locator('.blk.att-hit').count() === 3, 'three notes lit (a link in code isn’t one)', await page.locator('.blk.att-hit').count());
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await sleep(200);
const inFold = page.locator('.blk.att-cur', { hasText: 'inside' });
check(/3 of 3/.test(await bar()) && await inFold.count() === 1 && await inFold.isVisible(), '↓ ↓: the third, inside a folded note, shown for now', await bar());
await page.keyboard.press('ArrowDown');
await sleep(200);
check(/1 of 3/.test(await bar()) && !(await page.locator('.blk', { hasText: 'inside' }).isVisible()), '↓ again: back to the first, the folded note folded again');
// Build 49: a link typed while they're shown is counted a moment later
await editBlock(page, 'no files here');
await page.keyboard.press('End');
await page.keyboard.type(' [n](../assets/new.pdf)');
await page.keyboard.press('Escape');
await sleep(900);
check(/4 notes with 4 attachments/.test(await bar()) && await page.locator('.blk.att-hit').count() === 4, 'a link added meanwhile: counted and lit', await bar());
await page.keyboard.press('Escape'); // (the selected note let go)
await sleep(150);
await page.keyboard.press('Escape');
await sleep(200);
check(await page.locator('#attbar').isHidden() && await page.locator('.blk.att-hit').count() === 0, 'Esc clears it');
check(await page.locator('.outline .blk[title]').count() === 0, 'and the file names on the notes go too (Build 49)', await page.locator('.outline .blk[title]').count());
check(read('pages/Attach test.md').includes('../assets/new.pdf') && read('pages/Attach test.md').includes('collapsed:: true'), 'the file has only the typed link changed (still folded)');
write('pages/Attach test.md', attBefore);

console.log('Check this folder: files, their kinds, labelled parts, the ticks lined up');
await page.route('**/api/check', (route) => route.continue({ headers: { ...route.request().headers(), 'x-test-now': String(later) } }));
await go(page, '#/settings/notes');
await page.locator('[data-a="check"]').click();
await page.waitForSelector('.missing-box h4', { timeout: 8000 });
const miss = await page.locator('.missing-box').textContent();
check(/Missing files/.test(miss) && /link to \d+ files that aren’t/.test(miss) && !/pictures that aren’t/.test(miss), '"Missing files", "files that aren’t in assets"', miss);
const kinds = await page.evaluate(() => [...document.querySelectorAll('.missing-box a[data-page="Missing kinds"] .mf')].map((m) => m.querySelector('.kind').textContent + ':' + m.textContent.replace(m.querySelector('.kind').textContent, '')));
check(kinds.join(',') === 'PDF:lost.pdf,picture:lost.png,other:lost.zip', 'each missing file says its kind', kinds.join(','));
const heads = await page.locator('.chk-part > h3').allTextContents();
check(['Read', 'Saving', 'Longest pages', 'Most linked', 'Files in assets'].every((x) => heads.includes(x)), 'labelled parts', heads.join('|'));
const ranks = await page.locator('.chk-rank').first().locator('li').count();
check(ranks >= 2, 'Longest pages: one page a line', ranks);
// all well: the ticks of every part in one column
fs.rmSync(VAULT + '/pages/Missing kinds.md');
write('pages/Attach test.md', '- Plan\n\t- see ![p](../assets/dot.png)\n');
for (const f of fs.readdirSync(VAULT + '/assets')) if (!['dot.png', 'board.png', 'paper.pdf'].includes(f)) fs.rmSync(VAULT + '/assets/' + f);
await page.locator('[data-a="check"]').click();
await sleep(1500);
const ticks = await page.evaluate(() => [...document.querySelectorAll('.chk-ok .tick')].map((t) => Math.round(t.getBoundingClientRect().left)));
check(ticks.length >= 3 && new Set(ticks).size === 1, `${ticks.length} ✓ lines, their ticks lined up`, ticks.join(','));
check(/Every file a note links to is in/.test(await page.locator('.check-out').textContent()), '"Every file a note links to is in assets"');
await page.screenshot({ path: SHOTS + '/t29_check.png', fullPage: true });

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();

// Build 49 (three reviewers found it): on a phone the bar sits above the "+" and above the toolbar
console.log('phone: the attachments bar out of the way');
write('pages/Attach test.md', attBefore);
const ph = await open({ viewport: { width: 390, height: 800 }, touch: true });
await go(ph.page, '#/page/' + encodeURIComponent('Attach test'));
await ph.page.waitForSelector('.outline .blk');
await ph.page.locator('.title-row [data-a="more"]').tap();
await ph.page.locator('.pop.menu button', { hasText: 'Show attachments on this page' }).tap();
await ph.page.waitForSelector('#attbar:not([hidden])');
const box = (sel) => ph.page.locator(sel).boundingBox();
const add = await box('#addnote');
let ab = await box('#attbar');
check(!add || ab.y + ab.height <= add.y, 'above the "+"', JSON.stringify([ab, add]));
await ph.page.locator('.outline .blk .bc', { hasText: 'no files here' }).tap();
await ph.page.waitForSelector('#toolbar:not([hidden])');
await sleep(300);
ab = await box('#attbar');
const tb = await box('#toolbar');
check(ab.y + ab.height <= tb.y, 'above the editing toolbar while typing', JSON.stringify([ab, tb]));
await ph.page.screenshot({ path: SHOTS + '/t29_phone_attach.png' });
check(!ph.errors.length, 'phone: no script errors', ph.errors.join(' | '));
await ph.browser.close();
process.exit(failures() ? 1 : 0);

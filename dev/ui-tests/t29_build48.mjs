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
write('pages/Fold test.md', '- Parent A\n\t- child A1\n\t- child A2\n- Parent B\n\t- child B1\n- Leaf C\n');
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
check(await folded() === 2, 'both notes with sub-notes fold', await folded());
check(await saved(/Parent A\n\s+collapsed:: true[\s\S]*Parent B\n\s+collapsed:: true/), 'and it is saved in the file', read('pages/Fold test.md'));
await page.keyboard.press('Control+Alt+t');
await sleep(300);
check(await folded() === 0, 'again: everything opens', await folded());

console.log('← / → with a note selected');
await editBlock(page, 'Parent A');
await page.keyboard.press('Escape');
await sleep(150);
const selText = () => page.evaluate(() => [...document.querySelectorAll('.outline .blk.sel:not([hidden]) > .bc')].map((b) => b.textContent.trim()).join('|'));
check((await selText()).startsWith('Parent A'), 'Parent A is selected', await selText());
await page.keyboard.press('ArrowLeft');
await sleep(250);
check(await folded() === 1 && await page.locator('.outline .blk.collapsed > .bc', { hasText: 'Parent A' }).count() === 1, '← folds it', await folded());
check(await selText() === 'Parent A', 'and it stays selected (not its hidden sub-notes)', await selText());
await page.keyboard.press('ArrowRight');
await sleep(250);
check(await folded() === 0, '→ unfolds it');
await page.keyboard.press('ArrowLeft');
await sleep(200);
await page.keyboard.press('Control+Alt+t');
await sleep(250);
check(await folded() === 0, 'Ctrl+Alt+T with notes selected: fold all works there too (one was folded, so all open)', await folded());
await page.keyboard.press('Escape');
await editBlock(page, 'Leaf C');
await page.keyboard.press('Escape');
await sleep(150);
await page.keyboard.press('ArrowLeft');
await sleep(200);
check(await folded() === 0 && await selText() === 'Leaf C', '← on a note with nothing to fold: nothing happens (his pick)', await selText());
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
await page.keyboard.press('Control+ArrowUp');
await sleep(250);
check(await folded() === 2, 'nothing typed in or selected: every note on the page folds', await folded());
await page.keyboard.press('Control+ArrowDown');
await sleep(250);
check(await folded() === 0, 'and Ctrl+↓ opens them all');

console.log('another one-press key from Settings works anywhere: To-dos on Ctrl+Alt+O');
await go(page, '#/settings/typing');
await page.waitForSelector('.keys-card');
const groups = await page.locator('.keys-fixed tr.kg th').allTextContents();
check(groups.join('|') === 'Editing|Selecting|While typing', 'the fixed keys: a table in three groups', groups.join('|'));
check(!(await page.locator('.keys-card').textContent()).includes('Also:'), 'no long "Also:" sentence any more');
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
const before = read('pages/Attach test.md');
await page.locator('.title-row [data-a="more"]').click();
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
await page.keyboard.press('Escape');
await sleep(200);
check(await page.locator('#attbar').isHidden() && await page.locator('.blk.att-hit').count() === 0, 'Esc clears it');
check(read('pages/Attach test.md') === before, 'the file is unchanged (nothing unfolded in it)');

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
process.exit(failures() ? 1 : 0);

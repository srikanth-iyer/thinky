// Build 37 (the maintainer's notes of Nov 6): a page's "Pages in …" section sorts like Linked
// references (each level of the tree on its own); the Tags list counts a tag and its page's aliases
// as one tag.
import fs from 'node:fs';
import { open, check, failures, sleep, go, write, read, exists, VAULT } from './lib.mjs';

// a namespace with known times: "Garden/beans" newest, "Garden/apples" oldest, and a level down
// ("Garden/zinnias/seeds") whose parent has no file of its own
const at = (rel, iso) => { const t = new Date(iso); fs.utimesSync(VAULT + '/' + rel, t, t); };
write('pages/Garden.md', '- the garden\n');
write('pages/Garden___apples.md', '- apples\n');
write('pages/Garden___beans.md', '- beans\n');
write('pages/Garden___carrots.md', '- carrots\n');
write('pages/Garden___zinnias___seeds.md', '- seeds\n');
at('pages/Garden___apples.md', '2026-01-01T10:00:00Z');
at('pages/Garden___carrots.md', '2026-03-01T10:00:00Z');
at('pages/Garden___zinnias___seeds.md', '2026-06-01T10:00:00Z');
at('pages/Garden___beans.md', '2026-09-01T10:00:00Z');
// a tag and its page's alias
write('pages/Authors.md', 'alias:: author\n\n- people who wrote things\n');
write('pages/Tag notes.md', '- met an #author\n- and #Authors\n');

// many pages with to-dos, so the buttons need more than two rows
for (let k = 1; k <= 30; k++) write(`pages/Proj ${String(k).padStart(2, '0')}.md`, `- TODO task ${k} of a long project name here\n`);
write('pages/Shed.md', '- TODO fix the door [[Garden]]\n- TODO paint the shed\n');

// pages tagged with "Reading", one with a very long name
write('pages/Reading.md', '- things to read\n');
write('pages/Short one.md', 'tags:: Reading\n\n- a\n');
write('pages/Another book.md', 'tags:: Reading\n\n- b\n');
write('pages/A very long page name that would never fit on the narrow screen of a phone at all, really.md', 'tags:: Reading\n\n- c\n');

// Property display: notes Claude added (by:: claude), and a property config.edn hides
write('pages/Claude notes.md', '- my own note\n- a note from Claude\n  by:: claude\n- another one\n  by:: claude\n  source:: chat\n- a secret one\n  secret:: shh\n');
write('logseq/config.edn', read('logseq/config.edn').replace('{', '{:block-hidden-properties #{:secret}\n '));

const { browser, page, errors } = await open();

console.log('"Pages in …": sorted, each level on its own');
await go(page, '#/page/Garden');
await page.waitForSelector('.sec .tree li');
const rows = () => page.locator('.sec:has(.tree) .tree li').evaluateAll((lis) => lis.map((li) => li.style.getPropertyValue('--d') + ':' + li.textContent.trim()));
let r = await rows();
check(JSON.stringify(r) === JSON.stringify(['0:beans', '0:zinnias', '1:seeds', '0:carrots', '0:apples']), 'last changed, newest first by default; "zinnias" (no file) sorts by its newest subpage, "seeds" stays under it', JSON.stringify(r));
check(await page.locator('.sec:has(.tree) .tree li', { hasText: 'zinnias' }).locator('a').count() === 0, 'a parent with no file of its own is a name, not a link');
const sortBtn = page.locator('.sec:has(.tree) .ref-s');
check(/last changed, newest first/.test(await sortBtn.getAttribute('title')), 'the Sort button says how it sorts', await sortBtn.getAttribute('title'));
await sortBtn.click();
await page.locator('.sort-menu').getByText('A to Z').click();
await sleep(150);
r = await rows();
check(JSON.stringify(r) === JSON.stringify(['0:apples', '0:beans', '0:carrots', '0:zinnias', '1:seeds']), 'Name, A to Z', JSON.stringify(r));
await sortBtn.click();
await page.locator('.sort-menu').getByText('Z to A').click();
await sleep(150);
r = await rows();
check(r[0] === '0:zinnias' && r[1] === '1:seeds' && r.at(-1) === '0:apples', 'Name, Z to A (the subpage still under its parent)', JSON.stringify(r));
// remembered for this page
await go(page, '#/journals');
await go(page, '#/page/Garden');
await page.waitForSelector('.sec .tree li');
check((await rows())[0] === '0:zinnias', 'the sort is remembered for the page');
await page.locator('.sec:has(.tree) .tree li a', { hasText: 'beans' }).click();
await sleep(300);
check(/beans/i.test(await page.locator('h1').first().textContent()), 'a subpage still opens from the list');

console.log('Tags: a tag and its alias are one row');
await go(page, '#/tags');
await sleep(400);
const tagRows = await page.locator('main').innerText();
check(/Authors/.test(tagRows) && !/(^|\n)\s*author\b/.test(tagRows), 'only "Authors" is listed, not "author" as well', tagRows.slice(0, 400));

console.log('"Pages tagged with …": folds, filters, sorts, and fits a phone');
await go(page, '#/page/Reading');
await page.waitForSelector('.tagged-sec .tagged a');
const tagged = () => page.locator('.tagged-sec .tagged a').allTextContents();
check((await tagged()).length === 3, 'three pages tagged with Reading', JSON.stringify(await tagged()));
await page.locator('.tagged-sec .ref-s').click();
await page.locator('.sort-menu').getByText('A to Z').click();
await sleep(150);
check(JSON.stringify(await tagged()) === JSON.stringify(['A very long page name that would never fit on the narrow screen of a phone at all, really', 'Another book', 'Short one']), 'Sort: A to Z', JSON.stringify(await tagged()));
await page.locator('.tagged-sec .ref-f').click();
await page.locator('.tagged-sec .ref-filter').fill('book');
await sleep(150);
check(JSON.stringify(await tagged()) === JSON.stringify(['Another book']), 'Filter: “book”', JSON.stringify(await tagged()));
await page.locator('.tagged-sec .ref-f').click();
await sleep(150);
check((await tagged()).length === 3, 'closing the filter shows them all again');
await page.locator('.tagged-sec .disclose').click();
await sleep(150);
check(await page.locator('.tagged-sec .tagged').isHidden(), 'the heading folds it');
await go(page, '#/journals');
await go(page, '#/page/Reading');
await page.waitForSelector('.tagged-sec');
check(await page.locator('.tagged-sec .tagged').isHidden(), 'folded is remembered');
await page.locator('.tagged-sec .disclose').click();
await page.setViewportSize({ width: 390, height: 800 });
await sleep(400);
const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, long: Math.round(document.querySelector('.tagged-sec .tagged a').getBoundingClientRect().right) }));
check(wide.doc <= wide.win && wide.long <= wide.win, 'phone: the long name ends in “…” inside the screen', JSON.stringify(wide));
await page.setViewportSize({ width: 1280, height: 900 });

console.log('Property display: per property, saved in the notes folder');
await go(page, '#/page/Claude notes');
await page.waitForSelector('.outline .blk');
const note = (t) => page.locator('.outline .blk', { has: page.locator(':scope > .bc', { hasText: t }) }).first();
check(await note('a note from Claude').locator('.prop .pk', { hasText: 'by' }).count() === 1, 'by:: shows as usual at first');
check(await note('a secret one').locator('.prop').count() === 0, 'config.edn’s :block-hidden-properties hides secret::');
await go(page, '#/settings/look');
await page.waitForSelector('.prop-display');
await page.locator('.prop-new').fill('by::');
await page.locator('.prop-add button').click();
await sleep(400);
check(await page.locator('.prop-rules li[data-k="by"]').count() === 1, 'a rule for by:: added');
await page.locator('.prop-rules li[data-k="by"] .pr-show').selectOption('icon');
await sleep(400);
await page.locator('.prop-rules li[data-k="by"] .pr-icon').fill('✦');
await page.locator('.prop-rules li[data-k="by"] .pr-icon').dispatchEvent('change');
await sleep(400);
await page.locator('.prop-rules li[data-k="by"] .pr-mark').selectOption('purple');
await sleep(500);
check(exists('logseq/thinky.json'), 'saved in the notes folder');
const saved = exists('logseq/thinky.json') ? JSON.parse(read('logseq/thinky.json')) : {};
check(saved.propertyDisplay?.by?.show === 'icon' && saved.propertyDisplay.by.icon === '✦' && saved.propertyDisplay.by.mark === 'purple', 'as icon ✦ with a purple mark', JSON.stringify(saved));
await go(page, '#/page/Claude notes');
await page.waitForSelector('.outline .blk');
const n2 = note('a note from Claude');
check(await n2.locator('.prop-icon').count() === 1 && await n2.locator('.prop-icon').getAttribute('title') === 'by: claude', 'by:: shows as a small icon, its words on hover');
check(await n2.locator('.prop .pk', { hasText: 'by' }).count() === 0, 'and not as a row');
check(await n2.getAttribute('data-mark') === 'purple' && await note('my own note').getAttribute('data-mark') === null, 'the purple mark on its notes only');
const n3 = note('another one');
check(await n3.locator('.prop .pk', { hasText: 'source' }).count() === 1, 'other properties still show as usual');
// Quiet, then Hidden
await go(page, '#/settings/look');
await page.waitForSelector('.prop-display li[data-k="by"]');
await page.locator('.prop-rules li[data-k="by"] .pr-show').selectOption('quiet');
await sleep(400);
await go(page, '#/page/Claude notes');
await page.waitForSelector('.outline .blk');
check(await note('a note from Claude').locator('.prop.prop-quiet').count() === 1, 'Quiet: a smaller, lighter row');
await go(page, '#/settings/look');
await page.waitForSelector('.prop-display li[data-k="by"]');
await page.locator('.prop-rules li[data-k="by"] .pr-show').selectOption('hidden');
await sleep(400);
await go(page, '#/page/Claude notes');
await page.waitForSelector('.outline .blk');
check(await note('a note from Claude').locator('.prop, .prop-icon').count() === 0 && await note('a note from Claude').getAttribute('data-mark') === 'purple', 'Hidden: not shown, the mark stays');
await note('a note from Claude').locator(':scope > .bul').click({ button: 'right' });
await page.waitForSelector('.note-menu');
check(await page.locator('.note-menu .nm-item', { hasText: 'Show hidden properties' }).count() === 1, 'the note menu can still show it');
await page.keyboard.press('Escape');
check(read('pages/Claude notes.md').includes('  by:: claude'), 'the note itself is unchanged');
// remove the rule: back to usual
await go(page, '#/settings/look');
await page.waitForSelector('.prop-display li[data-k="by"]');
await page.locator('.prop-rules li[data-k="by"] .pr-del').click();
await sleep(400);
check(!JSON.parse(read('logseq/thinky.json')).propertyDisplay, 'Remove: the rule is gone from the file', read('logseq/thinky.json'));

console.log('Tabs: the "+" always shows; the dot menu opens a note in a new tab or to the side');
await go(page, '#/page/Garden');
await page.waitForSelector('.outline .blk');
const plus = page.locator('#histbar .tab-new[data-p="0"]');
check(await plus.isVisible() && !(await page.locator('#histbar .tabs[data-p="0"]').isVisible()), 'with one tab: the "+" shows, no tabs yet');
const plusBox = await plus.boundingBox(), sideBox = await page.locator('#side').boundingBox();
check(plusBox && sideBox && plusBox.x >= sideBox.x + sideBox.width - 2, 'the "+" sits right of the sidebar', JSON.stringify([plusBox, sideBox]));
await plus.click();
await sleep(300);
check(await page.locator('#histbar .tabs[data-p="0"] .tab').count() === 2, 'a click opens a second tab; the tabs show');
const plus2 = await plus.boundingBox(), lastTab = await page.locator('#histbar .tabs[data-p="0"] .tab').last().boundingBox();
check(plus2.x >= lastTab.x + lastTab.width - 2, 'the "+" moves to after the last tab', JSON.stringify([plus2, lastTab]));
// back to Garden in the first tab; then the dot menu on a note
await page.locator('#histbar .tabs[data-p="0"] .tab').first().click();
await sleep(300);
await page.locator('.outline .blk > .bul').first().click({ button: 'right' });
await page.waitForSelector('.note-menu');
await page.locator('.note-menu .nm-item', { hasText: 'Open in a new tab' }).click();
await sleep(400);
check(await page.locator('#histbar .tabs[data-p="0"] .tab').count() === 3 && /zoom/.test(await page.evaluate(() => location.hash)), '"Open in a new tab": a third tab, on that note', await page.evaluate(() => location.hash));
await page.locator('#histbar .tabs[data-p="0"] .tab').first().click();
await sleep(300);
await page.locator('.outline .blk > .bul').first().click({ button: 'right' });
await page.waitForSelector('.note-menu');
await page.locator('.note-menu .nm-item', { hasText: 'Open to the side' }).click();
await sleep(400);
check(await page.locator('#histbar .tabs[data-p="1"]').isVisible(), '"Open to the side": a second side opens');

console.log('To-dos: the order on the right; the page buttons behind the filter button');
await page.evaluate(() => window.leanApp.tabs.closePane(1)); // (one side again, after the tabs part)
await sleep(300);
await go(page, '#/todos');
await page.waitForSelector('.todo-item');
const kindsBox = await page.locator('.todo-kinds').boundingBox(), orderBox = await page.locator('.todo-order').boundingBox();
check(orderBox.x > kindsBox.x + 100 && Math.abs(orderBox.y - kindsBox.y) < 20, 'the order sits on the right of the Show row', JSON.stringify([kindsBox, orderBox]));
check(/⇅/.test(await page.locator('.todo-order').textContent()), 'with a ⇅ mark: it sorts');
check(await page.locator('.todo-panel').isHidden() && await page.locator('.todo-chips .ref-chip').count() === 0 || await page.locator('.todo-panel').isHidden(), 'the page buttons start hidden');
const fbtn = page.locator('.todo-f');
await fbtn.click();
await sleep(300);
check(await page.locator('.todo-panel').isVisible() && await fbtn.getAttribute('aria-expanded') === 'true', 'the filter button shows them');
const visibleChips = () => page.locator('.todo-chips .ref-chip:not([hidden])');
const tops = await visibleChips().evaluateAll((cs) => [...new Set(cs.map((c) => c.offsetTop))].length);
check(tops <= 2 && await page.locator('.todo-chips .ref-more').isVisible(), 'two rows at most, then “N more”', String(tops));
check(/^\d+ more$/.test(await page.locator('.todo-chips .ref-more').textContent()), '“N more” says how many', await page.locator('.todo-chips .ref-more').textContent());
// the find box narrows the buttons
await page.locator('.chip-find-in').fill('shed');
await sleep(250);
let names = await visibleChips().evaluateAll((cs) => cs.map((c) => c.firstChild.textContent.trim()));
check(names.length === 1 && names[0] === 'Shed', 'finding “shed”: just that button', JSON.stringify(names));
await page.locator('.todo-chips .ref-chip', { hasText: 'Shed' }).click();
await sleep(250);
let items = await page.locator('.todo-item .bc').allTextContents();
check(items.length === 2 && items.every((t) => /door|shed/.test(t)), 'a click: only the to-dos on Shed', JSON.stringify(items));
await page.locator('.chip-find-in').fill('');
await sleep(250);
names = await visibleChips().evaluateAll((cs) => cs.map((c) => c.firstChild.textContent.trim()));
check(names[0] === 'Shed' && await page.locator('.todo-chips .ref-chip.picked .chip-x').count() === 1, 'the chosen button comes first, with a ×', JSON.stringify(names.slice(0, 4)));
check(await fbtn.getAttribute('data-on') === 'true', 'the filter button shows a dot while a button is chosen');
await page.locator('.todo-chips .ref-chip.picked .chip-x').click();
await sleep(250);
check(await page.locator('.todo-item').count() > 30 && await page.locator('.todo-chips .ref-chip.picked').count() === 0, 'its × lets it go');
// right-click hides; closing the panel lets every pick go
await page.locator('.todo-chips .ref-chip', { hasText: 'Garden' }).first().click({ button: 'right' });
await sleep(250);
check(!(await page.locator('.todo-item .bc').allTextContents()).some((t) => /door/.test(t)), 'right-click: the to-dos mentioning Garden hidden');
await fbtn.click();
await sleep(250);
check(await page.locator('.todo-panel').isHidden() && (await page.locator('.todo-item .bc').allTextContents()).some((t) => /door/.test(t)), 'closing the panel lets the picks go (all to-dos again)');
await fbtn.click();
await sleep(250);
check(await page.locator('.todo-chips .ref-chip.picked').count() === 0, 'and they stay gone when it opens again');
await page.reload();
await page.waitForSelector('.todo-item');
check(await page.locator('.todo-panel').isVisible(), 'open or closed is remembered');
// typing in the to-do filter narrows the buttons too
await page.locator('.list-tools input.filter').fill('paint');
await sleep(250);
names = await visibleChips().evaluateAll((cs) => cs.map((c) => c.firstChild.textContent.trim()));
check(names.length === 1 && names[0] === 'Shed', 'typing “paint”: only the Shed button is left', JSON.stringify(names));
await page.locator('.list-tools input.filter').fill('');
// phone: the order on its own line, on the right
await page.setViewportSize({ width: 390, height: 800 });
await sleep(400);
const k2 = await page.locator('.todo-kinds').boundingBox(), o2 = await page.locator('.todo-acts').boundingBox();
check(o2.y > k2.y + 10 && o2.x + o2.width > 390 - 40, 'phone: the order on its own line, right-aligned', JSON.stringify([k2, o2]));
await page.setViewportSize({ width: 1280, height: 900 });

check(!errors.length, 'no script errors', errors.join('\n'));
await browser.close();
process.exit(failures() ? 1 : 0);

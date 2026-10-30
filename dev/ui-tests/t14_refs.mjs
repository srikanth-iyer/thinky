// Linked references with the notes around them, as in Logseq: the path of notes each one sits under,
// its sub-notes (levels from :ref/default-open-blocks-level on start folded, an arrow opens them), a
// click going to the note in its page, "… N more" over 50 sub-notes; on a page, under a journal day
// and on a phone. Unlinked references stay one line each. A page shows each references section only
// when it has some.
import { open, write, read, check, failures, sleep, go, SHOTS } from './lib.mjs';

const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
write('pages/Meeting notes.md', '- Kitchen\n\t- Monday\n\t  status:: busy\n\t\t- Talked to [[Tobias Wren Okafor]] about brine\n\t\t\t- first point\n\t\t\t\t- a detail\n\t\t\t\t\t- deeper still\n\t\t\t- second point\n\t\t- not under it\n'
  + '- Another [[Tobias Wren Okafor]] note\n- Folded here [[Tobias Wren Okafor]]\n  collapsed:: true\n\t- hidden at first\n');
let big = '- Planning with [[Tobias Wren Okafor]]\n';
for (let k = 0; k < 70; k++) big += `\t- step ${k}\n`;
write('pages/Big ref.md', big);
write('pages/Plans.md', `- Goals\n\t- finish the quilt by [[${title(new Date())}]]\n\t\t- square 2\n\t\t\t- stitches\n\t\t- square 3\n`);
write('pages/Plain mention.md', '- met tobias wren okafor at the kitchen\n\t- a child that stays out of it\n');
write('pages/Quiet page.md', '- a page nobody links to\n');
write('pages/Mentions.md', '- the quiet page comes up here, as words only\n');

const TOBIAS = '#/page/Tobias%20Wren%20Okafor';
const here = (page) => page.evaluate(() => decodeURIComponent(location.hash));
/** Each row of a reference: [words, shown?, folded?] */
const rows = (tree) => tree.locator('.refhit').evaluateAll((rs) => rs.map((r) => [r.textContent.trim(), !r.hidden, r.classList.contains('collapsed')]));
const shown = async (tree) => (await rows(tree)).filter((r) => r[1]).map((r) => r[0]);
const linkedOf = (page) => page.locator('section.sec:not(.unlinked)').filter({ hasText: /^Linked references/ });

let { browser, page, errors } = await open();
await go(page, TOBIAS);
await sleep(400);
const linked = linkedOf(page);
check((await linked.locator('.sec-h .n').textContent()) === '5 in 3 pages', 'the count: references in pages', await linked.locator('.sec-h .n').textContent());

console.log('a reference with its path and sub-notes');
const talk = linked.locator('.refnote', { hasText: 'Talked to' });
check((await talk.locator('.refpath').textContent()) === 'Kitchen › Monday', 'the notes it sits under show above it, first lines only', await talk.locator('.refpath').textContent());
check((await shown(talk)).join(' | ') === 'Talked to Tobias Wren Okafor about brine | first point | second point', 'its children show (level 2), in page order', (await shown(talk)).join(' | '));
check(!(await talk.textContent()).includes('not under it'), 'a note after it at its own level is not one of its sub-notes');
const r0 = await rows(talk);
check(r0.find((r) => r[0] === 'first point')[2] && !r0.some((r) => r[0] === 'a detail'), 'a child with sub-notes starts folded (level 3 not even drawn until it opens)', JSON.stringify(r0));
const lefts = await talk.locator('.refhit:not([hidden]) > .bc').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().left)));
check(lefts[1] > lefts[0] && lefts[2] === lefts[1], 'the sub-notes are indented under it', lefts.join());
await page.screenshot({ path: SHOTS + '/refs-page.png', fullPage: true });

console.log('the arrow opens and folds');
const arrowOf = (tree, words) => tree.locator('.refhit', { hasText: words }).first().locator(':scope > .fold');
check(await arrowOf(talk, 'first point').getAttribute('aria-expanded') === 'false', 'the folded one says so (aria-expanded)');
await arrowOf(talk, 'first point').click();
await sleep(150);
check((await shown(talk)).join(' | ') === 'Talked to Tobias Wren Okafor about brine | first point | a detail | second point', 'opening it shows the next level, still folded below', (await shown(talk)).join(' | '));
await arrowOf(talk, 'a detail').click();
await sleep(150);
check((await shown(talk)).includes('deeper still'), 'and that one opens too');
const levels = await talk.locator('.refhit').evaluateAll((rs) => rs.map((r) => r.dataset.d).join());
check(levels === '0,1,2,3,1', 'each at its level below the reference, as in its page', levels);
await arrowOf(talk, 'first point').click();
await sleep(150);
check((await shown(talk)).join(' | ') === 'Talked to Tobias Wren Okafor about brine | first point | second point', 'folding it again hides everything under it', (await shown(talk)).join(' | '));
await arrowOf(talk, 'Talked to').click();
await sleep(150);
check((await shown(talk)).join(' | ') === 'Talked to Tobias Wren Okafor about brine', 'the reference itself folds too');
await arrowOf(talk, 'Talked to').click();
const folded = linked.locator('.refnote', { hasText: 'Folded here' });
check((await shown(folded)).join(' | ') === 'Folded here Tobias Wren Okafor', 'a note folded in its page (collapsed:: true) starts folded', (await shown(folded)).join(' | '));
const other = linked.locator('.refnote', { hasText: 'Another' });
check(await other.locator('.refpath').count() === 0 && await other.locator('.refhit').count() === 1, 'a top-level note without sub-notes: no path, one row');

console.log('more than 50 sub-notes');
const bigTree = linked.locator('.refnote', { hasText: 'Planning with' });
check(await bigTree.locator('.refhit:not(.refmore)').count() === 51 && (await bigTree.locator('.refmore').textContent()) === '… 20 more', 'the first 50, then "… 20 more"', await bigTree.locator('.refhit').count());
await bigTree.locator('.refmore').click();
await sleep(700);
check(await here(page) === '#/zoom/Big ref/0', '"… 20 more" opens the note on its own, with all of them', await here(page));
check(await page.locator('.outline .blk:not([hidden])', { hasText: 'step 69' }).count() === 1, 'the last one is there');

console.log('a click edits the note right there (Build 33); the page\'s name opens it');
await go(page, TOBIAS);
await sleep(400);
const talked = linkedOf(page).locator('.refnote', { hasText: 'Talked to' });
await talked.locator('.refhit', { hasText: 'second point' }).locator('.bc').click({ position: { x: 4, y: 6 } });
await sleep(800);
check(await here(page) === decodeURIComponent(TOBIAS) && (await page.locator('.refnote.live textarea.ed').inputValue().catch(() => '')) === 'second point', 'a sub-note: edited in place, typing in it', await here(page));
await page.keyboard.press('Escape');
await talked.locator('xpath=ancestor::*[contains(@class,"refgrp")]').locator('h3 a').first().click();
await sleep(600);
check(await here(page) === '#/page/Meeting notes', 'the group\'s name opens its page', await here(page));
await go(page, TOBIAS);
await sleep(400);
await linkedOf(page).locator('.refpath a', { hasText: 'Monday' }).click();
await sleep(600);
check(await here(page) === '#/page/Meeting notes' && (await page.locator('.outline .blk.hit > .bc').textContent().catch(() => '')).startsWith('Monday'), 'a part of the path goes to that note', await here(page));
await go(page, TOBIAS);
await sleep(400);
await linkedOf(page).locator('.refhit', { hasText: 'Another' }).locator('.bc a[data-page]').click();
await sleep(600);
check(await here(page) === '#/page/Tobias Wren Okafor', 'a link in the words still opens the linked page', await here(page));

console.log('unlinked references stay one line each');
await go(page, TOBIAS);
await sleep(400);
await page.locator('.unlinked .disclose').click();
await sleep(700);
const un = page.locator('.unlinked');
check(await un.locator('.refhit', { hasText: 'met tobias' }).count() === 1, 'the plain mention is listed');
check(!(await un.textContent()).includes('stays out of it') && await un.locator('.refnote, .refpath, .fold').count() === 0, 'without its sub-notes, path or arrows');

console.log('a page shows each references section only when it has some');
const headings = (page) => page.locator('#main .view .sec-h').evaluateAll((hs) => hs.map((x) => x.textContent.trim().split(/\s{2,}| \d| mentions/)[0]));
await go(page, '#/page/Orphan%20page');
await sleep(900); // (the unlinked check runs after the page shows)
check((await headings(page)).length === 0, 'nothing links to it or mentions it: neither heading', (await headings(page)).join(' | '));
await go(page, '#/page/Quiet%20page');
await sleep(900);
check((await headings(page)).join(' | ') === 'Unlinked references', 'only mentioned as words: only "Unlinked references"', (await headings(page)).join(' | '));
check(await page.locator('.unlinked .disclose').getAttribute('aria-expanded') === 'false', '…folded');
await page.locator('.unlinked .disclose').click();
await sleep(600);
check(await page.locator('.unlinked .refhit', { hasText: 'the quiet page comes up' }).count() === 1, 'opening it lists the mention');
await go(page, TOBIAS);
await sleep(900);
check((await headings(page)).join(' | ') === 'Linked references | Unlinked references', 'both when it has both', (await headings(page)).join(' | '));

console.log('under a journal day');
await go(page, '#/journals');
await sleep(1500);
const day = page.locator('.sheet.day').first().locator('.day-refs .refnote');
check(await day.count() === 1 && (await day.locator('.refpath').textContent()) === 'Goals', 'today’s linked reference with its path', await day.count());
check((await shown(day)).join(' | ') === `finish the quilt by ${title(new Date())} | square 2 | square 3`, 'and its sub-notes, deeper ones folded', (await shown(day)).join(' | '));
await day.locator('.refhit', { hasText: 'square 3' }).locator('.bc').click({ position: { x: 4, y: 6 } });
await sleep(800);
check(await here(page) === '#/journals' && (await page.locator('.refnote.live textarea.ed').inputValue().catch(() => '')) === 'square 3', 'a click edits that note right there', await here(page));
await page.keyboard.press('Escape');
await day.locator('.refpath a').first().click();
await sleep(600);
check(await here(page) === '#/page/Plans' && (await page.locator('.outline .blk.hit > .bc').textContent().catch(() => '')) === 'Goals', 'its path goes to the note in its page', await here(page));
check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();

console.log('on a phone');
({ browser, page, errors } = await open({ viewport: { width: 390, height: 844 }, touch: true }));
await go(page, TOBIAS);
await sleep(600);
const pt = linkedOf(page).locator('.refnote', { hasText: 'Talked to' });
const fold = arrowOf(pt, 'first point');
const [fb, rb] = [await fold.boundingBox(), await pt.locator('.refhit', { hasText: 'first point' }).first().boundingBox()];
check(fb && rb && fb.x + fb.width / 2 > rb.x + rb.width - 30, 'the arrow sits at the right end of the line, as in the outline', JSON.stringify([fb, rb]));
await fold.tap();
await sleep(200);
check((await shown(pt)).includes('a detail'), 'a tap on it opens the note');
const steps = await pt.locator('.refhit').evaluateAll((rs) => rs.map((r) => Math.round(r.querySelector('.bc').getBoundingClientRect().left)));
check(steps[1] > steps[0] && steps[1] - steps[0] <= 24 && steps[2] - steps[1] > 0 && steps[2] - steps[1] <= 16, 'sub-notes step in, by small steps on a phone', steps.join());
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing sticks out sideways');
await page.screenshot({ path: SHOTS + '/refs-phone.png', fullPage: true });
check(!errors.length, 'no script errors on the phone', errors.join(' | '));
await browser.close();

console.log(':ref/default-open-blocks-level 3');
write('logseq/config.edn', read('logseq/config.edn').replace(/}\s*$/, ' :ref/default-open-blocks-level 3\n}\n'));
({ browser, page, errors } = await open());
await go(page, TOBIAS);
await sleep(600);
const t3 = linkedOf(page).locator('.refnote', { hasText: 'Talked to' });
check((await shown(t3)).join(' | ') === 'Talked to Tobias Wren Okafor about brine | first point | a detail | second point', 'three levels start open, the fourth folded', (await shown(t3)).join(' | '));
check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

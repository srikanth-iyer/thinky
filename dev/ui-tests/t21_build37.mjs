// Build 37 (the maintainer's notes of Nov 6): a page's "Pages in …" section sorts like Linked
// references (each level of the tree on its own); the Tags list counts a tag and its page's aliases
// as one tag.
import fs from 'node:fs';
import { open, check, failures, sleep, go, write, VAULT } from './lib.mjs';

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

check(!errors.length, 'no script errors', errors.join('\n'));
await browser.close();
process.exit(failures() ? 1 : 0);

// One way to find pages by what's typed (Build 32): the [[ and # list asks the core
// (`search_pages`, the Ctrl+K search's rules: accents, any word order, a letter off), and the ((
// list finds notes as the search box does (accents too).
import { open, check, failures, sleep, go, editBlock, write } from './lib.mjs';

write('pages/Bistro Crémerie.md', '- Visit to the Crémerie shop in Oslo\n');
const { browser, page, errors } = await open();
await page.evaluate(() => window.leanApp.rescan());
const acItems = () => page.evaluate(() => (document.querySelector('#ac').hidden ? [] : [...document.querySelectorAll('#ac li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim())));
const typeAndList = async (text) => {
  await page.keyboard.type(text, { delay: 20 });
  await sleep(350);
  const items = await acItems();
  await page.keyboard.press('Escape');
  await sleep(100);
  return items;
};

console.log('[[ and #: pages found as the search box finds them');
await go(page, '#/page/Marta%20Pell');
await editBlock(page, 'Wrote Notes');
let items = await typeAndList(' [[cremerie');
check(items[0] === 'Bistro Crémerie', '[[cremerie finds “Bistro Crémerie” (no accent typed)', JSON.stringify(items));
check(items.at(-1) === 'New page: cremerie', '“New page” still last (a different name)', JSON.stringify(items));
items = await typeAndList(' [[recipe dumplings');
check(items[0] === 'Dumplings recipe', '[[recipe dumplings: words in any order', JSON.stringify(items));
items = await typeAndList(' [[dmplings');
check(items[0] === 'Dumplings recipe', '[[dmplings: a letter off', JSON.stringify(items));
items = await typeAndList(' #dumplings');
check(items[0] === 'Dumplings recipe', '#dumplings: a tag, the same', JSON.stringify(items));
items = await typeAndList(' [[dumplings recipe');
check(items[0] === 'Dumplings recipe' && !items.some((t) => t.startsWith('New page')), 'the exact name: no “New page”', JSON.stringify(items));

console.log('((: notes found as the search box finds them');
await page.keyboard.press('Control+a'); // (the words: typing replaces them, so no "[[" is left open)
await page.keyboard.type('Refers to', { delay: 20 });
items = await typeAndList(' ((cremerie shop');
check(items.some((t) => t.includes('Visit to the Crémerie shop')), '((cremerie shop finds the note with “Crémerie”', JSON.stringify(items));
await page.keyboard.press('Escape');

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

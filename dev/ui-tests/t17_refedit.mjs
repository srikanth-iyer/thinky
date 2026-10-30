// Editing linked references in place (Build 33, he asked: "a special extension of the note itself", as
// Logseq): a click on a reference's words turns it into the real note, edited right there (an Outline of
// its own page zoomed in on it); what's typed is saved into that page's file, the other notes there byte
// for byte; Enter makes a new note inside the reference; the page's name and the path above still go to
// the page; a phone tap does the same.
import { open, write, read, check, failures, sleep, go, SHOTS } from './lib.mjs';

write('pages/Recipe draft.md', '- Starters\n- Mains: ask [[Rosa Penhallow]] for the big pan\n\t- check the oven\n- Desserts\n');
write('pages/Supper club.md', '- TODO lend [[Rosa Penhallow]] the Hartley book\n');
const before = read('pages/Recipe draft.md');
const { browser, page, errors } = await open();
const PAGE = '#/page/Rosa%20Penhallow';
const refOf = (words) => page.locator('.refnote', { hasText: words });

console.log('a click on a reference\'s words edits it there');
await go(page, PAGE);
await page.waitForSelector('.refnote');
await refOf('Mains:').locator('.refhit .bc').first().click({ position: { x: 6, y: 8 } });
await page.waitForSelector('.refnote.live textarea.ed');
const s = await page.evaluate(() => ({ hash: location.hash, live: document.querySelectorAll('.refnote.live').length, ed: document.querySelector('.refnote.live textarea.ed')?.value, kids: document.querySelectorAll('.refnote.live .outline .blk').length }));
check(s.hash === '#/page/Rosa%20Penhallow' || decodeURIComponent(s.hash) === '#/page/Rosa Penhallow', 'it stays on this page', s.hash);
check(s.live === 1 && /^Mains: ask \[\[Rosa Penhallow\]\]/.test(s.ed) && s.kids === 2, 'the note and its sub-note, the note open for typing', JSON.stringify(s));
await page.keyboard.press('End');
await page.keyboard.type(' (by Friday)');
await page.keyboard.press('Escape');
await sleep(1500);
const after = read('pages/Recipe draft.md');
check(after === before.replace('for the big pan', 'for the big pan (by Friday)'), 'saved into its own page; everything else there byte for byte', after);
check(!(await page.locator('.page-head textarea').count()) && read('pages/Rosa Penhallow.md').includes('Baker at Millbrook'), 'this page itself untouched');

console.log('Enter makes a new note inside the reference');
await refOf('Mains:').locator('.blk .bc', { hasText: 'check the oven' }).click({ position: { x: 4, y: 6 } });
await page.waitForSelector('.refnote.live textarea.ed');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('heat the pan');
await page.keyboard.press('Escape');
await sleep(1500);
check(read('pages/Recipe draft.md').includes('\t- check the oven\n\t- heat the pan\n- Desserts\n'), 'a new sub-note, in its place in the file', read('pages/Recipe draft.md'));
await page.screenshot({ path: SHOTS + '/refedit-laptop.png' });

console.log('the page itself: its name, or the path');
await refOf('lend').locator('xpath=ancestor::*[contains(@class,"refgrp")]').locator('h3 a').first().click();
await sleep(800);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Supper club', 'a click on the group\'s name opens that page', await page.evaluate(() => location.hash));
await browser.close();

console.log('phone: a tap edits in place too');
{
  const { browser: b2, page: p2 } = await open({ viewport: { width: 390, height: 844 }, touch: true });
  await go(p2, PAGE);
  await p2.waitForSelector('.refnote');
  await p2.locator('.refnote', { hasText: 'lend' }).locator('.refhit .bc').first().tap({ position: { x: 34, y: 8 } });
  await p2.waitForSelector('.refnote.live textarea.ed');
  check(await p2.locator('#toolbar').isVisible(), 'the editing toolbar comes up');
  await p2.screenshot({ path: SHOTS + '/refedit-phone.png' });
  await b2.close();
}
console.log(errors.length ? 'script errors:\n' + errors.join('\n') : 'no script errors');
process.exit(failures() ? 1 : 0);

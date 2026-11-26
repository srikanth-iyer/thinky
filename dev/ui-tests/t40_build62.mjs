// Build 62, two things he noted (Nov 26):
//  1. closing the linked or unlinked references (or a day, a page's group of references, a note) near the
//     end of a page took him away from where he was: the page got shorter and the browser pulled it up,
//     to the top of a short page. Now the heading he pressed stays where it was on the screen (dom.js
//     keepPlace), on a phone and on the laptop;
//  2. on a phone, the filter button put the cursor in the filter box, so the keyboard came up over the
//     page buttons below it. A tap now only opens the filter; a mouse click still puts the cursor there.
import { open, check, failures, sleep, go, write } from './lib.mjs';
import { execSync } from 'node:child_process';

// a page many pages link to (so its references run past the screen), and a few that only mention it
for (let k = 0; k < 14; k++) write(`pages/Ref ${k}.md`, `- line ${k} about [[Hub]] and [[Sourdough Bread]]\n- more ${k}\n- third\n`);
write('pages/Hub.md', '- Hub page\n- second\n');
for (let k = 0; k < 6; k++) write(`pages/Mention ${k}.md`, `- talk of sourdough bread here ${k}\n`);

/** Press a heading's button (tap on a phone, click on the laptop) after scrolling it to the middle;
 *  returns how far (screen pixels) the button moved. */
async function moved(page, sel, tap) {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await sleep(300);
  const y0 = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
  const r = await page.locator(sel).first().boundingBox();
  if (tap) await page.touchscreen.tap(r.x + 10, r.y + r.height / 2);
  else await page.mouse.click(r.x + 10, r.y + r.height / 2);
  await sleep(700);
  const y1 = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
  return Math.round(y1 - y0);
}

for (const [name, opts, tap] of [['phone', { viewport: { width: 390, height: 800 }, touch: true, look: 'thinky' }, true],
  ['laptop', { viewport: { width: 1280, height: 800 }, look: 'thinky' }, false]]) {
  console.log(`1. (${name}) closing references keeps the heading in its place`);
  const { browser, page, errors } = await open(opts);
  await go(page, '#/page/Sourdough Bread');
  await page.waitForSelector('.sec.unlinked .disclose');
  await sleep(800);
  const linked = '.sec:not(.unlinked) > .sec-h .disclose';
  let d = await moved(page, linked, tap);
  check(Math.abs(d) <= 2, 'closing the linked references: the heading stays put', `moved ${d}px`);
  check(await page.evaluate(() => document.querySelector('.sec:not(.unlinked)').classList.contains('shut')), 'and they are closed');
  d = await moved(page, linked, tap);
  check(Math.abs(d) <= 2, 'opening them again: the heading stays put', `moved ${d}px`);
  d = await moved(page, '.sec.unlinked .disclose', tap); // opens (looks through the notes)
  await page.waitForSelector('.sec.unlinked .body .refgrp, .sec.unlinked .body .note');
  await sleep(400);
  d = await moved(page, '.sec.unlinked .disclose', tap);
  check(Math.abs(d) <= 2, 'closing the unlinked references: the heading stays put', `moved ${d}px`);
  // the room kept goes as he scrolls back up, and nothing is left at the top of the page
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#main').scrollTop = 0; });
  await sleep(400);
  check(await page.evaluate(() => !document.querySelector('.keep-room')), 'scrolled to the top: the kept room is gone');
  await page.screenshot({ path: `/tmp/lean-ui-test/shots/t40-${name}-refs.png` });

  console.log(`2. (${name}) the filter button`);
  await page.evaluate(() => document.querySelector('.ref-f').scrollIntoView({ block: 'center' }));
  await sleep(200);
  const fb = await page.locator('.ref-f').boundingBox();
  if (tap) await page.touchscreen.tap(fb.x + 8, fb.y + 8); else await page.mouse.click(fb.x + 8, fb.y + 8);
  await sleep(400);
  const f = await page.evaluate(() => ({ open: !document.querySelector('.ref-tools').hidden, focused: document.activeElement?.classList.contains('ref-filter') }));
  check(f.open, 'the filter opens', JSON.stringify(f));
  if (tap) check(!f.focused, 'a tap leaves the box without a cursor (no keyboard over the page buttons)', JSON.stringify(f));
  else check(f.focused, 'a mouse click puts the cursor in the box, ready to type', JSON.stringify(f));
  if (tap) { // a tap on the box itself still types
    const ib = await page.locator('.ref-filter').boundingBox();
    await page.touchscreen.tap(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await sleep(300);
    check(await page.evaluate(() => document.activeElement?.classList.contains('ref-filter')), 'a tap on the box gives it the cursor');
  }
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}

{
  console.log('3. (laptop) Enter on the filter button still puts the cursor in the box');
  const { browser, page, errors } = await open({ look: 'thinky' });
  await go(page, '#/page/Sourdough Bread');
  await page.waitForSelector('.ref-f');
  await page.focus('.ref-f');
  await page.keyboard.press('Enter');
  await sleep(300);
  check(await page.evaluate(() => document.activeElement?.classList.contains('ref-filter')), 'the cursor is in the box');
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}
if (failures()) process.exit(1);

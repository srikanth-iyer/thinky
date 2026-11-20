// Build 54 (he saw the ✦ cut off in a linked reference in Paper: "check if this is the case everywhere"): in every
// look, the ✦ beside a page's note, an edited linked reference and a Journals day is whole and on top.
// (Its menu and editing the AI's words by hand: t31_build51.)
import { open, write, sleep, go, SHOTS, lookIds, check, failures } from './lib.mjs';
write('pages/Recipe draft.md', '- Mains: ask [[Rosa Penhallow]] for the big pan and a long line of words that wraps onto the next line of the note for sure\n\t- check the oven\n');
const { browser, page } = await open();
const looks = await lookIds(page);
const out = [];
for (const look of looks) {
  await page.evaluate((l) => { localStorage.setItem('lookMode', JSON.stringify(/night|teal/.test(l) ? 'dark' : 'light')); localStorage.setItem(/night|teal/.test(l) ? 'skinNight' : 'skinDay', JSON.stringify(l)); }, look);
  for (const [where, hash, pick] of [['page', '#/page/Rosa%20Penhallow', '.page-body .blk, .sheet.page .outline:not(.refnote *) .blk'], ['ref', '#/page/Rosa%20Penhallow', 'ref'], ['journal', '#/journals', '.sheet.day .blk']]) {
    await page.reload(); await page.waitForSelector('.blk');
    await go(page, hash); await sleep(500);
    await page.evaluate(() => document.documentElement.classList.add('ai-on'));
    let row;
    if (pick === 'ref') {
      await page.waitForSelector('.refnote');
      await page.locator('.refnote', { hasText: 'Mains:' }).locator('.refhit .bc').first().click({ position: { x: 6, y: 8 } });
      await page.waitForSelector('.refnote.live .blk'); await page.keyboard.press('Escape'); await sleep(200);
      row = page.locator('.refnote.live .blk').first();
    } else row = page.locator(pick).first();
    await row.hover(); await sleep(250);
    const r = await page.evaluate(() => {
      const s = document.querySelector('.pz-spark'); if (!s) return 'no spark';
      const b = s.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;
      let cut = '';
      for (let a = s.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a); if (cs.overflowX === 'visible' && cs.overflowY === 'visible' && cs.contain === 'none' && cs.contentVisibility !== 'auto') continue;
        const r = a.getBoundingClientRect(); if (b.left < r.left - .5 || b.right > r.right + .5) cut += ' clipped by ' + (a.className || a.tagName) + ` (${Math.round(b.right - r.right)}px)`;
      }
      const at = document.elementFromPoint(x, y);
      return (s.contains(at) ? '' : 'HIDDEN under ' + (at?.className || at?.tagName)) + cut || 'ok';
    });
    out.push(`${look} ${where}: ${r}`);
    if (r !== 'ok') await page.screenshot({ path: `${SHOTS}/spark-${look}-${where}.png` });
  }
}
for (const l of out) check(l.endsWith(': ok'), 'the ✦ is whole: ' + l.replace(/: ok$/, ''), l);
await browser.close();
if (failures()) process.exit(1);

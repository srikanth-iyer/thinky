// Long pages: time until a 3,000-block page is usable, and a page with 450 references.
import { open, write, check, failures, sleep } from './lib.mjs';
let big = '';
for (let i = 0; i < 3000; i++) big += `${i % 5 ? '\t' : ''}- block ${i} with [[link ${i % 40}]] and **bold** text, #tag${i % 9}\n`;
write('pages/Big page.md', big);
let refs = '';
// each with notes under it (shown under each reference since Build 28): 4 open, 8 deeper ones folded
for (let i = 0; i < 450; i++) refs += `- mention ${i} of [[card]] in a reference list\n` + [0, 1, 2, 3].map((k) => `\t- note ${k} under mention ${i}\n\t\t- deeper a\n\t\t- deeper b\n`).join('');
write('pages/Many refs.md', refs);
const { browser, page, errors } = await open();
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await sleep(500);
// each page opened three times, the fastest counting: other programs running on the machine only
// ever add time, and one slow moment shouldn't fail the test
for (const [name, hash, title] of [['3,000 blocks', '#/page/Big%20page', 'Big page'], ['450 references', '#/page/card', 'card']]) {
  const runs = [];
  for (let k = 0; k < 3; k++) {
    await page.evaluate(() => { location.hash = '#/pages'; });
    await sleep(500);
    runs.push(await page.evaluate(async ([h, title]) => {
      const t0 = performance.now();
      location.hash = h;
      await new Promise((r) => { const tick = () => (document.querySelector('.page-head .page-title')?.textContent === title && document.querySelector('.outline .blk') ? r() : requestAnimationFrame(tick)); tick(); });
      await new Promise((r) => requestAnimationFrame(() => r()));
      const first = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 1500));
      return { first, blocks: document.querySelectorAll('.outline .blk').length, refs: document.querySelectorAll('.refhit').length };
    }, [hash, title]));
  }
  const t = runs.reduce((a, b) => (b.first < a.first ? b : a));
  console.log(`  ${name}: first paint ${t.first.toFixed(0)} ms (of ${runs.map((x) => x.first.toFixed(0)).join(', ')}); ${t.blocks} blocks, ${t.refs} references drawn`);
  check(t.first < 400, `${name} shows within 400 ms`, t.first);
  if (name === '450 references') check(t.refs >= 450 * 5 && t.refs < 450 * 5 + 50, 'then all 450 references are drawn, each with its 4 open notes (the folded ones only when opened)', t.refs);
}
// typing on the long page stays quick
await page.evaluate(() => { location.hash = '#/page/Big%20page'; });
await sleep(1500);
await page.locator('.outline .blk > .bc', { hasText: 'block 2999 ' }).first().click();
const lag = await page.evaluate(async () => {
  const ta = document.querySelector('textarea.ed');
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) { ta.value += 'x'; ta.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'x' })); }
  return (performance.now() - t0) / 20;
});
console.log(`  typing on the long page: ${lag.toFixed(2)} ms per key`);
check(lag < 8, 'typing stays instant', lag);
// scrolling it: finding the parents to pin at the top is cheap in each frame
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await sleep(300);
const pinMs = await page.evaluate(async () => {
  const main = document.querySelector('#main');
  const o = window.leanApp.outlines[0];
  main.scrollTop = main.scrollHeight / 2;
  await new Promise((r) => requestAnimationFrame(() => r()));
  const top = main.getBoundingClientRect().top;
  const t0 = performance.now();
  let shown = 0;
  for (let k = 0; k < 30; k++) { o.pinned = null; o.pinParents(top, 0); shown += !o.pins.hidden; main.scrollTop += 37; }
  return { ms: (performance.now() - t0) / 30, shown };
});
console.log(`  pinning parents while scrolling: ${pinMs.ms.toFixed(2)} ms per frame`);
check(pinMs.ms < 6 && pinMs.shown > 0, 'pinning parents while scrolling stays quick', JSON.stringify(pinMs));
console.log(errors.length ? 'script errors:\n' + errors.join('\n') : 'no script errors');
await browser.close();
process.exit(failures() ? 1 : 0);

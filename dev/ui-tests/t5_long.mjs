// Long pages: time until a 3,000-block page is usable, and a page with 450 references.
import { open, write, check, failures, sleep } from './lib.mjs';
let big = '';
for (let i = 0; i < 3000; i++) big += `${i % 5 ? '\t' : ''}- block ${i} with [[link ${i % 40}]] and **bold** text, #tag${i % 9}\n`;
write('pages/Big page.md', big);
let refs = '';
for (let i = 0; i < 450; i++) refs += `- mention ${i} of [[card]] in a reference list\n`;
write('pages/Many refs.md', refs);
const { browser, page, errors } = await open();
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await sleep(500);
for (const [name, hash, title] of [['3,000 blocks', '#/page/Big%20page', 'Big page'], ['450 references', '#/page/card', 'card']]) {
  await page.evaluate(() => { location.hash = '#/pages'; });
  await sleep(500);
  const t = await page.evaluate(async ([h, title]) => {
    const t0 = performance.now();
    location.hash = h;
    await new Promise((r) => { const tick = () => (document.querySelector('.page-head .page-title')?.textContent === title && document.querySelector('.outline .blk') ? r() : requestAnimationFrame(tick)); tick(); });
    await new Promise((r) => requestAnimationFrame(() => r()));
    const first = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 1500));
    return { first, blocks: document.querySelectorAll('.outline .blk').length, refs: document.querySelectorAll('.refhit').length };
  }, [hash, title]);
  console.log(`  ${name}: first paint ${t.first.toFixed(0)} ms; ${t.blocks} blocks, ${t.refs} references drawn`);
  check(t.first < 400, `${name} shows within 400 ms`, t.first);
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
console.log(errors.length ? 'script errors:\n' + errors.join('\n') : 'no script errors');
await browser.close();
process.exit(failures() ? 1 : 0);

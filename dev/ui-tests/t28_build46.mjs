// Build 46 (his note of Nov 12, with a phone screenshot of Settings → Check this folder): a long picture
// name in "Pictures nothing uses" got 17px of width and stood one letter per line, squeezed by its size
// and the "Where was it used?" button; the missing pictures' file names were right-aligned and broke
// into ragged pieces.
import fs from 'node:fs';
import { open, check, failures, sleep, go, VAULT } from './lib.mjs';

// long names like his, a picture nothing uses and pictures a page links to that aren't there
const LONG = 'Screenshot_2024-04-01-01-44-56-70_238e009dbbcae0e62f0ae71e23c7890e.jpg';
fs.copyFileSync(VAULT + '/assets/unused.png', VAULT + '/assets/' + LONG);
fs.writeFileSync(VAULT + '/pages/neural networks.md', `- ![a](../assets/2024-03-26-00-45-55.jpeg)\n- ![b](../assets/${LONG.replace('44-56', '59-37')})\n`);
const later = Math.floor(Date.now() / 1000) + 4 * 86400; // (pictures from the last 3 days aren't judged)

for (const [device, opts] of [['phone', { viewport: { width: 390, height: 800 }, touch: true }], ['laptop', {}]]) {
  const { browser, page, errors } = await open(opts);
  await page.route('**/api/check', (route) => route.continue({ headers: { ...route.request().headers(), 'x-test-now': String(later) } }));
  console.log(`${device}: Check this folder's lists`);
  await go(page, '#/settings/notes');
  await page.locator('[data-a="check"]').click();
  await page.waitForSelector('.pics-box h3', { timeout: 8000 });
  await sleep(300);
  const m = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.pics li')].find((li) => li.querySelector('.nm').textContent.startsWith('Screenshot'));
    const box = (sel) => row.querySelector(sel).getBoundingClientRect();
    const nm = box('.nm'), meta = box('.meta'), btn = box('.pic-older'), list = row.closest('.pics').getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(row.querySelector('.nm')).lineHeight) || 20;
    const miss = document.querySelector('.missing-box .rows .meta');
    const mr = miss.getBoundingClientRect(), name = miss.closest('a').firstChild;
    const rg = document.createRange(); rg.selectNodeContents(name);
    return { nmW: nm.width, nmLines: Math.round(nm.height / lineH), listW: list.width, btnRight: btn.right, listRight: list.right,
      metaLeft: (() => { const r = document.createRange(); r.selectNodeContents(row.querySelector('.meta')); return r.getBoundingClientRect().left; })(), nmLeft: nm.left, // (where each one's words start)
      metaTop: meta.top, nmBottom: nm.bottom,
      missAlign: getComputedStyle(miss).textAlign, missTop: mr.top, nameBottom: rg.getBoundingClientRect().bottom, missLeft: mr.left, nameLeft: rg.getBoundingClientRect().left };
  });
  check(m.nmW >= m.listW * 0.5, `a long name has at least half the list's width (${Math.round(m.nmW)} of ${Math.round(m.listW)}px)`, JSON.stringify(m));
  check(m.nmLines <= 4, `and takes ${m.nmLines} lines, not one letter a line`, JSON.stringify(m));
  check(m.btnRight <= m.listRight + 0.5, '"Where was it used?" stays inside the list', JSON.stringify(m));
  if (device === 'phone') {
    check(m.metaTop >= m.nmBottom - 1, 'the size goes under the name', JSON.stringify(m));
    check(Math.abs(m.metaLeft - m.nmLeft) <= 1, 'lined up with the name', JSON.stringify(m));
  } else {
    check(m.metaTop < m.nmBottom, 'on a laptop the size stays beside the name', JSON.stringify(m));
  }
  check(m.missAlign === 'left' && m.missTop >= m.nameBottom - 1 && Math.abs(m.missLeft - m.nameLeft) <= 1, 'missing pictures: the file names under their page, from the left', JSON.stringify(m));
  check(!errors.length, 'no script errors', errors.join(' | '));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

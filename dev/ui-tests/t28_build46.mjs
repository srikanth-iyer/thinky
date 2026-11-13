// Build 46 (his note of Nov 12, with a phone screenshot of Settings → Check this folder): a long picture
// name in "Pictures nothing uses" got 17px of width and stood one letter per line, squeezed by its size
// and the "Where was it used?" button; the missing pictures' file names were right-aligned and broke
// into ragged pieces.
import fs from 'node:fs';
import { open, check, failures, sleep, go, VAULT, SHOTS } from './lib.mjs';

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
  await page.waitForSelector('.pics-box h4', { timeout: 8000 });
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
// ---- his #claude notes of Nov 11–12, the four he said yes to
import { read, write, editBlock } from './lib.mjs';
write('pages/States.md', '- TODO water the plants\n- DOING write the letter\n- Steps\n\t- first\n\t- second\n');
write('pages/Books.md', '- Dune\n  kind:: book\n- A podcast\n  kind:: ebook, audio\n- Hyperion\n  kind:: book\n');
{
  const { browser, page, errors } = await open({});
  console.log('laptop: a to-do\'s states from its tick box (To-dos)');
  await go(page, '#/todos');
  const row = page.locator('.todo-item', { hasText: 'water the plants' });
  await row.waitFor();
  await row.locator('input.todo').click({ button: 'right' });
  await page.waitForSelector('.pop.menu');
  const items = await page.locator('.pop.menu button').allTextContents();
  check(JSON.stringify(items) === JSON.stringify(['To do', 'Doing', 'Waiting', 'Done', 'Cancelled']), 'right-click on the box: every state', JSON.stringify(items));
  check(await page.locator('.pop.menu [aria-checked="true"]').textContent() === 'To do', 'the one it has marked');
  await page.locator('.pop.menu button', { hasText: 'Waiting' }).click();
  for (let k = 0; k < 30 && !read('pages/States.md').includes('WAITING water'); k++) await sleep(100);
  check(read('pages/States.md').startsWith('- WAITING water the plants\n- DOING'), 'picked: written in its file', read('pages/States.md'));
  check(!(await row.locator('input.todo').isChecked()), 'and not ticked');

  console.log('laptop: the note menu has the "/" list\'s choices');
  await go(page, '#/page/States');
  await page.waitForSelector('.outline .blk');
  const steps = page.locator('.outline .blk', { hasText: 'Steps' }).first();
  await steps.locator(':scope > .bul').click({ button: 'right' });
  await page.waitForSelector('.note-menu');
  const labels = await page.locator('.note-menu button').allTextContents();
  check(labels.some((l) => l.includes('Number its sub-notes')) && labels.some((l) => l.includes('More commands')), 'Number its sub-notes and More commands…', JSON.stringify(labels));
  await page.locator('.note-menu button', { hasText: 'Number its sub-notes' }).click();
  for (let k = 0; k < 30 && !read('pages/States.md').includes('order-list-type'); k++) await sleep(100);
  check(/- first\n\t {2}logseq\.order-list-type:: number\n\t- second\n\t {2}logseq\.order-list-type:: number/.test(read('pages/States.md')), 'its sub-notes numbered', read('pages/States.md'));
  await steps.locator(':scope > .bul').click({ button: 'right' });
  await page.waitForSelector('.note-menu');
  await page.locator('.note-menu button', { hasText: 'More commands' }).click();
  await page.waitForSelector('#ac:not([hidden])', { timeout: 3000 }).catch(() => {});
  check(await page.locator('#ac').isVisible() && (await page.locator('#ac li').count()) > 10, 'More commands… opens the "/" list for that note', await page.locator('#ac li').count());
  check(await page.evaluate(() => document.activeElement?.value) === 'Steps/', 'typing in that note, after a "/"', await page.evaluate(() => document.activeElement?.value));
  await page.keyboard.press('Escape');

  console.log('laptop: a property\'s values as buttons');
  await go(page, '#/props/kind');
  await page.waitForSelector('.prop-vals .chip');
  const vals = await page.locator('.prop-vals .chip').allTextContents();
  check(vals[0] === 'book 2' && vals.includes('ebook 1') && vals.includes('audio 1'), 'each value with how many use it, most used first', JSON.stringify(vals));
  await page.locator('.prop-vals .chip', { hasText: /^book/ }).click();
  await page.waitForFunction(() => /2 matches/.test(document.querySelector('.view .note')?.textContent || ''));
  check(/2 matches in 1 page/.test(await page.locator('.view p.note').first().textContent()), 'one picked: only that value (not ebook)', await page.locator('.view p.note').first().textContent());
  check(await page.locator('.prop-vals .chip[aria-pressed="true"]').count() === 1, 'shown as picked');
  await page.locator('.prop-vals .chip', { hasText: /^book/ }).click();
  await page.waitForFunction(() => /3 matches/.test(document.querySelector('.view .note')?.textContent || ''));
  check(true, 'again: all of them');
  await page.screenshot({ path: SHOTS + '/t28_prop_values.png' });

  console.log('laptop: text size');
  await go(page, '#/settings/look');
  const r = page.locator('.size-row input[type=range]');
  await r.waitFor();
  const scale = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim() || '1');
  await r.evaluate((el) => { el.value = '1.3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await scale() === '1' && await page.locator('.size-row .v').textContent() === '130%', 'while dragging: only the number and the sample change', await scale());
  check(Math.abs(Number(await page.locator('.size-sample').evaluate((el) => el.style.zoom)) - 1.3) < 0.01, 'the sample shows the new size');
  await r.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  check(await scale() === '1.3', 'let go: set everywhere', await scale());
  await page.locator('.sz-step[data-d="1"]').click();
  check(await scale() === '1.35' && await page.locator('.size-row .v').textContent() === '135%', '+ makes it one step larger', await scale());
  await page.locator('.sz-step[data-d="-1"]').click();
  await page.locator('.sz-step[data-d="-1"]').click();
  check(await scale() === '1.25', '− one step smaller', await scale());
  check(!errors.length, 'no script errors', errors.join(' | '));
  await browser.close();
}
{
  console.log('phone: hold the tick box for its states');
  write('pages/States.md', '- TODO water the plants\n');
  const { browser, page, errors } = await open({ viewport: { width: 390, height: 800 }, touch: true });
  await go(page, '#/todos');
  const box = page.locator('.todo-item', { hasText: 'water the plants' }).locator('input.todo');
  await box.waitFor();
  const b = await box.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await sleep(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  check(await page.locator('.pop.menu').count() === 1, 'a hold opens the menu (once)', await page.locator('.pop.menu').count());
  check(!(await box.isChecked()) && read('pages/States.md') === '- TODO water the plants\n', 'and doesn\'t tick it', read('pages/States.md'));
  await page.locator('.pop.menu button', { hasText: 'Done' }).click();
  for (let k = 0; k < 30 && !read('pages/States.md').includes('DONE'); k++) await sleep(100);
  check(read('pages/States.md').startsWith('- DONE water the plants'), 'Done from the menu', read('pages/States.md'));
  check(!errors.length, 'no script errors', errors.join(' | '));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

// Build 44 (a review of the app, Nov 10–11): tables in notes; faint words readable in every look; small
// things reach a finger on a phone; a change draws only the rows that changed; long lists and far-off
// journal days don't slow the page.
import { open, check, failures, sleep, go, write, read, lookIds, VAULT } from './lib.mjs';
import fs from 'node:fs';

// ---------- tables ----------
{
  write('pages/Table page.md', '- before\n- | Loaf | Water | Notes |\n  |:--|--:|:-:|\n  | Sourdough | 75% | [[Sourdough Bread]] |\n  | Rye | 80% | a \\| b and `c | d` |\n  | short |\n- | not | a table |\n- after\n');
  const { browser, page, errors } = await open();
  await go(page, '#/page/Table%20page');
  await page.waitForSelector('.outline .tbl');
  const t = await page.evaluate(() => {
    const tb = document.querySelector('.outline .tbl');
    return { n: document.querySelectorAll('.outline .tbl').length, head: [...tb.querySelectorAll('thead th')].map((c) => c.textContent), rows: [...tb.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => c.textContent)),
      align: [...tb.querySelectorAll('tbody tr:first-child td')].map((c) => getComputedStyle(c).textAlign), link: !!tb.querySelector('td a.pl'), code: tb.querySelector('td code')?.textContent,
      plain: [...document.querySelectorAll('.outline .blk > .bc')].map((b) => b.textContent)[2] };
  });
  check(t.n === 1 && JSON.stringify(t.head) === JSON.stringify(['Loaf', 'Water', 'Notes']), 'rows between "|"s with a dashes line under the first show as a table', JSON.stringify(t));
  check(JSON.stringify(t.rows[0]) === JSON.stringify(['Sourdough', '75%', 'Sourdough Bread']) && t.link, 'its cells are drawn like any words (a page link works in one)', JSON.stringify(t.rows));
  check(t.rows[1][2] === 'a | b and c | d' && t.code === 'c | d', 'a "|" after a backslash or inside code stays in its cell', JSON.stringify(t.rows[1]));
  check(t.rows[2].length === 3 && t.rows[2][1] === '', 'a short row is filled out with empty cells');
  check(JSON.stringify(t.align) === JSON.stringify(['left', 'right', 'center']), 'the dashes line’s colons line the columns up', t.align.join(','));
  check(t.plain === '| not | a table |', 'rows without a dashes line stay as typed', t.plain);
  // editing shows the words as typed, and nothing in the file changes by looking
  await page.locator('.outline .tbl td').first().click();
  await page.waitForSelector('textarea.ed');
  check((await page.locator('textarea.ed').inputValue()).startsWith('| Loaf | Water | Notes |'), 'a click on the table edits its note as typed');
  await page.keyboard.press('Escape');
  await sleep(1200);
  check(read('pages/Table page.md').includes('  | Rye | 80% | a \\| b and `c | d` |\n'), 'the file is as it was');
  // find on the page: a cell's words are found, the "|"s and the dashes never
  await page.keyboard.press('Control+f');
  await page.keyboard.type('Rye');
  await sleep(300);
  const n1 = await page.locator('#findbar .fb-n').textContent();
  await page.fill('#findbar .fb-q', '--');
  await sleep(300);
  const n2 = await page.locator('#findbar .fb-n').textContent();
  await page.fill('#findbar .fb-q', '|');
  await sleep(300);
  const n3 = await page.locator('#findbar .fb-n').textContent();
  check(/1/.test(n1) && !/[1-9]/.test(n2) && /of 5/.test(n3), 'find sees a cell’s words, not the table’s own "|"s or dashes (the five "|" it finds are the two written inside cells and the plain row’s three)', [n1, n2, n3].join(' / '));
  await page.keyboard.press('Escape');
  check(errors.length === 0, 'no script errors (tables)', errors.join('\n'));
  await browser.close();
}

// ---------- faint words: at least 4.5:1 as drawn, in every look ----------
{
  const { browser, page, errors } = await open({ look: 'thinky' });
  const looks = await lookIds(page);
  check(looks.length === 12 && !looks.includes('azulejo'), '12 looks, Azulejo taken out', looks.join(','));
  const low = async () => page.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const parse = (s) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = s; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] > 0.99) break; } let base = [255, 255, 255]; for (const c of stack.reverse()) base = over(c, base); return base; };
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement, r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      // (not judged: what's hidden, the logo's letters, a done to-do and a "quiet" property, faded on purpose)
      if (cs.visibility === 'hidden' || el.closest('#splash, .wm-in, [aria-hidden=true], :disabled, .marker-done, .prop-quiet')) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
      const fg = parse(cs.color); fg[3] *= op;
      const bg = bgOf(el), mix = over(fg, bg);
      const [a, b] = [lum(mix), lum(bg)].sort((x, y) => y - x), ratio = (a + 0.05) / (b + 0.05);
      const size = parseFloat(cs.fontSize), big = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (big ? 3 : 4.5)) out.push(`${el.className || el.tagName} ${ratio.toFixed(2)} “${n.textContent.trim().slice(0, 16)}”`);
    }
    return [...new Set(out)];
  });
  const bad = [];
  for (const id of looks) {
    await page.evaluate((l) => { document.documentElement.dataset.skin = l; }, id);
    for (const h of ['#/journals', '#/page/Sourdough%20Bread', '#/todos', '#/pages']) {
      await go(page, h);
      for (const x of await low()) bad.push(`${id} ${h}: ${x}`);
    }
  }
  check(bad.length === 0, 'every word on the Journals list, a page, To-dos and All pages reads at 4.5:1 or better (3:1 for large words) in all 12 looks', bad.slice(0, 12).join('\n'));
  check(errors.length === 0, 'no script errors (contrast)', errors.join('\n'));
  await browser.close();
}

// ---------- a phone: what answers a tap ----------
{
  const { browser, page, errors } = await open({ viewport: { width: 390, height: 800 }, touch: true, look: 'thinky' });
  // how far around a thing a tap still lands on it
  const reach = (sel, nth = 0) => page.evaluate(([sel, nth]) => {
    const el = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width)[nth];
    if (!el) return null;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); };
    if (!hit(cx, cy)) return { w: 0, h: 0 };
    let l = cx, rr = cx, t = cy, b = cy;
    while (hit(l - 1, cy)) l--; while (hit(rr + 1, cy)) rr++; while (hit(cx, t - 1)) t--; while (hit(cx, b + 1)) b++;
    return { w: Math.round(rr - l + 1), h: Math.round(b - t + 1), dw: Math.round(r.width), dh: Math.round(r.height) };
  }, [sel, nth]);
  const dot = await reach('.outline .blk > .bul', 1);
  check(dot && dot.w >= 24 && dot.h >= 26 && dot.dw === 15, 'a note’s dot answers a tap well around it (24px or more each way, was 16 by 24), drawn as before', JSON.stringify(dot));
  const box = await reach('.outline .bc input.todo');
  check(box && box.w >= 20 && box.h >= 28 && box.dw === 16, 'a to-do’s box too (was 16 by 16), drawn as before', JSON.stringify(box));
  // a tap just left of the dot opens the note on its own (the dot's job); a tap on its first word edits
  const d = await page.locator('.outline .blk > .bul').nth(1).boundingBox();
  const words = await page.locator('.outline .blk > .bc').nth(1).boundingBox();
  await page.touchscreen.tap(words.x + 14, words.y + words.height / 2);
  await sleep(300);
  check(await page.locator('textarea.ed').count() === 1 && !(await page.evaluate(() => location.hash)).includes('zoom'), 'a tap on a note’s first word still edits it (the dot reaches left only, not over the words)');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.touchscreen.tap(d.x - 10, d.y + d.height / 2);
  await sleep(400);
  check((await page.evaluate(() => location.hash)).includes('zoom'), 'a tap in the margin just left of a dot opens its note, as a tap on the dot does');
  await go(page, '#/journals');
  await go(page, '#/todos');
  const chip = await reach('.todo-kinds .chip', 1);
  const tbox = await reach('.todo-item input.todo');
  check(chip && chip.h >= 36 && chip.dh <= 29, 'a filter button reaches 36px or more up and down, drawn no bigger (28px)', JSON.stringify(chip));
  check(tbox && tbox.w >= 26 && tbox.h >= 30, 'the To-dos list’s boxes reach 26px across and 30px or more up and down', JSON.stringify(tbox));
  const seg = await page.evaluate(() => { const s = document.querySelector('.seg'), a = s.querySelector('[aria-pressed=true]'); return { r: getComputedStyle(s).borderRadius, first: getComputedStyle(s.firstElementChild).borderTopLeftRadius }; });
  check(parseFloat(seg.first) > 10, 'the joined order buttons keep their round ends', JSON.stringify(seg));
  await go(page, '#/page/Sourdough%20Bread');
  const fav = await reach('.page-head .icon-btn, .icon-btn.fav');
  check(fav && fav.w >= 38 && fav.h >= 38, 'the page’s small buttons reach 38px or more', JSON.stringify(fav));
  await page.locator('#topbar [data-a=menu]').tap();
  await sleep(500);
  const row = await reach('#side .nav a', 1);
  check(row && row.h >= 33, 'the menu’s rows are 33px or more tall (were 29)', JSON.stringify(row));
  check(errors.length === 0, 'no script errors (phone)', errors.join('\n'));
  await browser.close();
}

// ---------- a change draws only the rows that changed ----------
{
  let text = 'tags:: long\n\n';
  for (let k = 0; k < 400; k++) text += `- note ${k} [[Sourdough Bread]]\n\t- child ${k}\n${k % 40 === 5 ? '\t\t- TODO deep ' + k + '\n' : ''}`;
  text += '- numbered one\n  logseq.order-list-type:: number\n- numbered two\n  logseq.order-list-type:: number\n- last note\n';
  write('pages/Long keep.md', text);
  const { browser, page, errors } = await open();
  await go(page, '#/page/Long%20keep');
  await page.waitForSelector('.outline .blk');
  await sleep(900); // (a long page is drawn in parts)
  const mark = () => page.evaluate(() => { let k = 0; for (const d of document.querySelectorAll('.outline .blk')) d.dataset.seen = ++k; return k; });
  const kept = () => page.evaluate(() => [...document.querySelectorAll('.outline .blk')].filter((d) => d.dataset.seen).length);
  // the page as drawn now, and as a page drawn from scratch would be: they must be the same
  const sameAsFresh = async (label) => {
    await sleep(60);
    const r = await page.evaluate(async () => {
      const o = window.leanApp.pane.outlines[0];
      if (!o) return { err: 'no outline' };
      // each row as text: its number, whether it's hidden, its classes and styles in a set order, what's in it
      const rows = () => [...o.el.children].map((d) => [d.dataset.i, d.hidden, [...d.classList].sort().join(' '), [...d.style].sort().map((k) => k + ':' + d.style.getPropertyValue(k)).join(';'), d.dataset.mark || '', d.innerHTML].join(' ~ '));
      const a = rows();
      o.shownEnd = -1; // (nothing kept: every row made again)
      o.render();
      await new Promise((r) => setTimeout(r, 400));
      const b = rows();
      let at = 0; while (at < a.length && a[at] === b[at]) at++;
      return { same: a.length === b.length && at === a.length, rows: a.length, fresh: b.length, at, a: (a[at] || '').slice(0, 300), b: (b[at] || '').slice(0, 300) };
    });
    check(r.same, `${label}: the page is exactly as one drawn from scratch`, JSON.stringify(r));
    return r;
  };
  const total = await mark();
  check(total >= 800, 'a long page (800+ notes) is open', String(total));
  await page.locator('.outline .blk > .bc', { hasText: 'note 200 ' }).first().click({ position: { x: 300, y: 8 } });
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('a new note');
  let k = await kept();
  check(k >= total - 3, 'Enter in the middle keeps every other row as it was (only the rows around the new note are drawn)', `${k} of ${total}`);
  await page.keyboard.press('Tab');
  k = await kept();
  check(k >= total - 4, 'Tab too', `${k} of ${total}`);
  await page.keyboard.press('Escape');
  await sameAsFresh('after Enter, typing and Tab');
  await mark();
  // Undo all of it: the words on screen follow (a row kept must never show old words)
  for (let n = 0; n < 4; n++) await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await sleep(200);
  const txt = await page.evaluate(() => [...document.querySelectorAll('.outline .blk > .bc')].map((b) => b.textContent));
  check(!txt.includes('a new note') && txt.filter((t) => t.startsWith('note 200 ')).length === 1, 'Undo takes the new note away again on screen');
  await page.keyboard.press('Escape');
  await sameAsFresh('after Undo');
  // a note's words changed, the editing left, then put back by Undo: its row shows the old words again
  await page.locator('.outline .blk > .bc', { hasText: 'note 10 ' }).first().click({ position: { x: 300, y: 8 } });
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('End');
  await page.keyboard.type(' CHANGED');
  await page.keyboard.press('Escape');
  await sleep(100);
  await page.keyboard.press('Control+z');
  await sleep(200);
  await page.keyboard.press('Escape');
  const ten = await page.evaluate(() => [...document.querySelectorAll('.outline .blk > .bc')].find((b) => b.textContent.startsWith('note 10 '))?.textContent);
  check(ten === 'note 10 Sourdough Bread', 'words typed, then undone: the row shows the words the page has', ten);
  await sameAsFresh('after typing and Undo in one note');
  // folding hides and shows rows that were kept
  await mark();
  await page.locator('.outline .blk', { hasText: 'note 3 ' }).first().hover();
  await page.locator('.outline .blk.has-kids > .fold').nth(3).click({ force: true });
  await sleep(200);
  const fold = await page.evaluate(() => { const ds = [...document.querySelectorAll('.outline .blk')]; const i = ds.findIndex((d) => d.classList.contains('collapsed')); return { i, kidHidden: ds[i + 1]?.hidden, kept: ds.filter((d) => d.dataset.seen).length, n: ds.length }; });
  check(fold.i >= 0 && fold.kidHidden === true && fold.kept >= fold.n - 3, 'folding a note hides its sub-notes and keeps the other rows', JSON.stringify(fold));
  await sameAsFresh('after folding');
  // numbered notes: a new one in the list renumbers the ones after it
  await page.locator('.outline .blk > .bc', { hasText: 'numbered one' }).first().click({ position: { x: 200, y: 8 } });
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('between');
  await page.keyboard.press('Escape');
  await sleep(150);
  const nums = await page.evaluate(() => [...document.querySelectorAll('.outline .blk > .bul.num')].map((b) => b.dataset.n));
  check(JSON.stringify(nums) === JSON.stringify(['1.', '2.', '3.']), 'a note added to a numbered list renumbers the rest', nums.join(' '));
  await sameAsFresh('after adding to a numbered list');
  // selected rows
  await page.locator('.outline .blk > .bc', { hasText: 'note 20 ' }).first().click({ position: { x: 300, y: 8 } });
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Tab');
  await sleep(200);
  const sel = await page.evaluate(() => document.querySelectorAll('.outline .blk.sel').length);
  check(sel >= 1, 'selected notes moved in a level stay marked as selected', String(sel));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await sleep(1200);
  const file = read('pages/Long keep.md');
  check(file.includes('- note 200 [[Sourdough Bread]]\n\t- child 200\n') && file.includes('- between\n') && !file.includes('a new note') && !file.includes('CHANGED'), 'and the file holds what the page shows');
  check(errors.length === 0, 'no script errors (rows kept)', errors.join('\n'));
  await browser.close();
}

// ---------- long lists a part at a time; far-off journal days left undrawn ----------
{
  let text = '';
  for (let k = 0; k < 700; k++) text += `- TODO thing ${k}\n`;
  write('pages/Many to-dos.md', text);
  const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ' ' + n + suf + ', ' + d.getFullYear(); };
  for (let k = 3; k < 120; k++) { const d = new Date(); d.setDate(d.getDate() - k); const f = VAULT + '/Diary/' + title(d) + '.md'; if (!fs.existsSync(f)) fs.writeFileSync(f, `- day ${k}\n\t- more\n- and more\n`); }
  const { browser, page, errors } = await open();
  await go(page, '#/todos');
  await page.waitForSelector('.todo-item');
  const count = () => page.evaluate(() => ({ rows: document.querySelectorAll('.todo-item').length, says: document.querySelector('.sec-h .n')?.textContent }));
  let c = await count();
  check(c.rows >= 150 && c.rows < 400 && +c.says >= 700, 'To-dos opens with the first part of a long list drawn (its count says all of them)', JSON.stringify(c));
  for (let k = 0; k < 12 && (await count()).rows < 700; k++) { await page.evaluate(() => { const s = document.querySelector('.pane.act'); s.scrollTop = s.scrollHeight; scrollTo(0, document.body.scrollHeight); }); await sleep(250); }
  c = await count();
  check(c.rows >= 700 && await page.locator('.more-tail').count() === 0, 'scrolling to the end draws the rest', JSON.stringify(c));
  // ticking one far down keeps the place: the list comes back with as many rows
  await page.locator('.todo-item', { hasText: 'thing 650' }).first().locator('input.todo').click();
  await sleep(900);
  c = await count();
  const top = await page.evaluate(() => document.querySelector('.pane.act').scrollTop);
  check(c.rows >= 690 && top > 3000, 'a to-do ticked far down the list: the list is drawn again as far as it was, the place kept', JSON.stringify({ ...c, top }));
  check(read('pages/Many to-dos.md').includes('- DONE thing 650\n'), 'and it is ticked in its file');
  await page.fill('.view input[type=search], .view .filter', 'thing 69');
  await sleep(300);
  c = await count();
  check(c.rows === 11, 'the filter still finds rows that weren’t drawn yet', JSON.stringify(c));

  // Journals: scroll a long way back, then type in today's notes
  await go(page, '#/journals');
  await page.waitForSelector('.sheet.day .outline');
  for (let k = 0; k < 40; k++) { await page.mouse.move(800, 500); await page.mouse.wheel(0, 5000); await sleep(80); }
  const days = await page.evaluate(() => ({ n: document.querySelectorAll('.sheet.day').length, far: document.querySelectorAll('.sheet.day.far').length, today: document.querySelector('.sheet.day.today')?.classList.contains('far') }));
  check(days.n >= 60 && days.far >= days.n - 12 && days.today === true, 'after a long scroll back, the days far from the screen are left to the browser to skip', JSON.stringify(days));
  await page.evaluate(() => { document.querySelector('.pane.act').scrollTop = 0; });
  await sleep(400);
  const near = await page.evaluate(() => ({ today: document.querySelector('.sheet.day.today').classList.contains('far'), h: document.querySelector('.sheet.day.today').offsetHeight }));
  check(near.today === false && near.h > 200, 'back at the top, today is drawn as ever', JSON.stringify(near));
  await page.locator('.sheet.day.today .outline .blk > .bc').last().click({ position: { x: 400, y: 8 } });
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('typed after the long scroll');
  await page.keyboard.press('Escape');
  await sleep(1300);
  const todayFile = fs.readdirSync(VAULT + '/Diary').find((f) => f === title(new Date()) + '.md');
  check(!!todayFile && read('Diary/' + todayFile).includes('typed after the long scroll'), 'and a note typed there is saved');
  // find still reaches a far-off day
  await page.keyboard.press('Control+f');
  await page.keyboard.type('day 55');
  await sleep(500);
  const found = await page.locator('#findbar .fb-n').textContent();
  check(/1/.test(found), 'find on the page still finds words in a day far away', found);
  await page.keyboard.press('Enter');
  await sleep(600);
  const there = await page.evaluate(() => { const d = [...document.querySelectorAll('.sheet.day .blk > .bc')].find((b) => b.textContent === 'day 55'); const r = d?.getBoundingClientRect(); return r ? r.top > 0 && r.bottom < innerHeight : false; });
  check(there, 'and goes to it');
  // another text size: the days far away are measured again, so the page is as long as it will be
  await page.keyboard.press('Escape');
  for (let k = 0; k < 4; k++) await page.keyboard.press('Control+=');
  await sleep(700);
  const sized = await page.evaluate(() => {
    const far = [...document.querySelectorAll('.sheet.day.far')].filter((d, i) => i % 5 === 0);
    const held = far.map((d) => Math.round(d.getBoundingClientRect().height));
    const real = far.map((d) => { d.classList.remove('far'); const v = Math.round(d.getBoundingClientRect().height); d.classList.add('far'); return v; });
    return { n: far.length, wrong: held.filter((v, i) => Math.abs(v - real[i]) > 1).length, held: held.slice(0, 4), real: real.slice(0, 4) };
  });
  check(sized.n >= 8 && sized.wrong === 0, 'with bigger text the far days are held at their new heights', JSON.stringify(sized));
  await page.keyboard.press('Control+0');
  check(errors.length === 0, 'no script errors (long lists)', errors.join('\n'));
  await browser.close();
}

// ---------- Nov 11 (his comments on the review): the "/" list's icons, the sidebar's drawing in room of
// its own, the phone while typing, and one short scale of text sizes and corners ----------
{
  const { browser, page, errors } = await open({ look: 'thinky' });
  await go(page, '#/page/Table%20page');
  await page.locator('.outline .blk > .bc').first().click();
  await page.waitForSelector('textarea.ed');
  await page.keyboard.press('End');
  await page.keyboard.type(' /');
  await page.waitForSelector('#ac li[data-k]');
  const sl = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ac li[data-k]')];
    const ic = (li) => li.querySelector('.ac-ic');
    return { n: rows.length, none: rows.filter((li) => !ic(li) || !(ic(li).querySelector('svg') || ic(li).textContent.trim())).map((li) => li.textContent),
      first: rows.filter((li) => li.firstElementChild !== ic(li)).length, hidden: rows.filter((li) => ic(li)?.getAttribute('aria-hidden') !== 'true').length,
      heights: [...new Set(rows.map((li) => Math.round(li.getBoundingClientRect().height)))], lefts: [...new Set(rows.map((li) => Math.round(ic(li).getBoundingClientRect().left)))],
      kinds: new Set(rows.map((li) => ic(li).innerHTML)).size };
  });
  check(sl.n >= 30 && sl.none.length === 0 && sl.first === 0 && sl.hidden === 0, 'every row of the "/" list starts with an icon (for the eye only: the name says it)', JSON.stringify(sl));
  check(sl.heights.length === 1 && sl.lefts.length === 1, 'the rows are one height and the icons one column, drawings and letter badges alike', JSON.stringify(sl));
  check(sl.kinds >= sl.n - 2, 'the icons differ from row to row', `${sl.kinds} of ${sl.n}`);
  await page.keyboard.press('Enter');
  check((await page.locator('textarea.ed').inputValue()).startsWith('TODO before'), 'and picking a row works as before', await page.locator('textarea.ed').inputValue());
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await sleep(1200);

  // the sidebar: a long Recent list never runs over the look's drawing
  await page.evaluate(() => localStorage.setItem('recent', JSON.stringify(['Sourdough Bread', 'Tasks', 'Table page', 'to read', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen'])));
  await page.reload();
  await page.waitForSelector('.sheet .outline');
  await sleep(500);
  const side = () => page.evaluate(() => {
    const r = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    const all = [...document.querySelectorAll('#recent a')], shown = all.filter((a) => !a.hidden);
    const s = document.querySelector('#side');
    return { art: r('#side .side-art'), foot: r('#side .side-foot'), last: Math.round(shown.at(-1)?.getBoundingClientRect().bottom ?? 0), shown: shown.length, all: all.length,
      img: getComputedStyle(document.querySelector('#side .side-art')).backgroundImage, behind: getComputedStyle(s).backgroundImage, scroll: s.scrollHeight > s.clientHeight + 1 };
  });
  let sd = await side();
  // (Recent keeps 10 pages)
  check(sd.all === 10 && sd.shown >= 6 && /thinky-corner/.test(sd.img) && !/thinky-corner/.test(sd.behind), 'the look’s drawing is a part of the sidebar now, not a picture behind its lists', JSON.stringify(sd));
  check(sd.art.h >= 52 && sd.last <= sd.art.top && sd.art.bottom <= sd.foot.top && !sd.scroll, 'a long Recent list ends above the drawing (at least 52px of it), and the sidebar needs no scroll bar', JSON.stringify(sd));
  const tall = sd.shown;
  await page.setViewportSize({ width: 1280, height: 640 });
  await sleep(400);
  sd = await side();
  check(sd.art.h >= 52 && sd.last <= sd.art.top && sd.shown < tall && !sd.scroll, 'a shorter window: Recent shows fewer pages, the drawing stays clear of them', JSON.stringify(sd));
  await page.setViewportSize({ width: 1280, height: 900 });
  await sleep(400);
  sd = await side();
  check(sd.shown === tall, 'more room again brings the hidden pages back', JSON.stringify(sd));
  await page.evaluate(() => localStorage.setItem('recent', JSON.stringify(['Tasks'])));
  await page.reload();
  await page.waitForSelector('.sheet .outline');
  await sleep(500);
  sd = await side();
  check(sd.art.h >= 120 && sd.art.bottom <= sd.foot.top, 'with a short list the drawing has its full size, low in the sidebar', JSON.stringify(sd));
  await page.setViewportSize({ width: 1280, height: 500 });
  await sleep(400);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#side .side-art')).display) === 'none', 'a window too short for it (under 520px) leaves the drawing out');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.skin = 'calm'; });
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#side .side-art')).display) === 'none', 'a look without a drawing has no room set aside for one');

  // one short scale: no fixed text size or corner in app.css outside the named steps
  const css = await page.evaluate(async () => (await (await fetch('/app.css')).text()).replace(/\/\*[\s\S]*?\*\//g, ''));
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+px)/g)].map((m) => m[1]);
  const shorthand = [...css.matchAll(/font:\s*(?:\d{3}\s+)?[\d.]+px/g)].map((m) => m[0]);
  const corners = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1]).filter((v) => /\dpx/.test(v));
  check(sizes.join() === '34px' && shorthand.length === 0, 'app.css has no fixed text size of its own, only the scale’s steps (but the look samples’ title)', JSON.stringify({ sizes, shorthand }));
  check(corners.length === 0, 'and no corner rounding of its own', JSON.stringify(corners.slice(0, 8)));
  const steps = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return ['tiny', 'small', 'sub', 'ui', 'read', 'big', 'head', 'top'].map((k) => cs.getPropertyValue('--fs-' + k).trim()).concat(['line', 's', 'm', 'l', 'xl', 'pill'].map((k) => cs.getPropertyValue('--r-' + k).trim())); });
  check(steps.join() === '11px,12px,13px,14px,15px,16px,18px,22px,2px,4px,6px,8px,12px,999px', 'the steps: eight text sizes, five roundings and the pill', steps.join());
  check(errors.length === 0, 'no script errors (icons, sidebar, scale)', errors.join('\n'));
  await browser.close();
}
{
  // a small phone while typing
  const { browser, page, errors } = await open({ viewport: { width: 320, height: 520 }, touch: true, look: 'thinky' });
  const top = () => page.evaluate(() => Math.round(document.querySelector('.sheet.day .page-title').getBoundingClientRect().top));
  const tools = () => page.evaluate(() => {
    const row = document.querySelector('#toolbar .tb-scroll'), rr = row.getBoundingClientRect();
    const bs = [...row.children].map((b) => b.getBoundingClientRect()).filter((b) => b.width);
    return { w: +bs[0].width.toFixed(1), whole: bs.filter((b) => b.left >= rr.left - 0.6 && b.right <= rr.right + 0.6).length, cut: bs.filter((b) => (b.left < rr.right - 0.6 && b.right > rr.right + 0.6) || (b.left < rr.left - 0.6 && b.right > rr.left + 0.6)).length,
      moreR: row.classList.contains('more-r'), moreL: row.classList.contains('more-l'), mask: getComputedStyle(row).maskImage || getComputedStyle(row).webkitMaskImage, pin: !!document.querySelector('#toolbar .tb-pin')?.getBoundingClientRect().width };
  });
  const bar = await page.evaluate(() => Math.round(document.querySelector('#topbar').getBoundingClientRect().height));
  const t0 = await top();
  await page.locator('.sheet.day .outline .blk > .bc').first().tap({ position: { x: 14, y: 10 } });
  await page.waitForSelector('textarea.ed');
  await sleep(500);
  const t1 = await top();
  check(bar >= 40 && t1 === t0 - bar, 'while typing, the notes move up into the top bar’s strip (it isn’t left empty)', JSON.stringify({ t0, t1, bar }));
  let tb = await tools();
  check(tb.cut === 0 && tb.whole >= 6 && tb.w >= 36 && tb.pin, 'the toolbar shows a whole number of tools, none cut in half, “close keyboard” at its end', JSON.stringify(tb));
  check(tb.moreR && !tb.moreL && /gradient/.test(tb.mask), 'its edge fades where more tools are hidden', JSON.stringify(tb));
  await page.evaluate(() => document.querySelector('#toolbar .tb-scroll').scrollBy({ left: 130 }));
  await sleep(600);
  tb = await tools();
  check(tb.cut === 0 && tb.moreL && tb.moreR, 'scrolled, it stops on whole tools, both edges faded', JSON.stringify(tb));
  await page.evaluate(() => document.querySelector('#toolbar .tb-scroll').scrollBy({ left: 2000 }));
  await sleep(600);
  tb = await tools();
  check(tb.cut === 0 && tb.moreL && !tb.moreR, 'at its end, only the left edge fades', JSON.stringify(tb));
  await page.keyboard.press('Escape');
  await sleep(500);
  check(await top() === t0, 'typing done: the bar and the notes are back where they were', String(await top()));
  check(errors.length === 0, 'no script errors (typing on a phone)', errors.join('\n'));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

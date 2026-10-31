// Build 34 (the maintainer's list of Oct 30): the top strip's buttons evenly spaced over the sidebar,
// linked references that fold like unlinked ones, filter buttons for the pages references mention,
// the to-do list's orders and page buttons, Namespaces only for real namespaces (t15_pages sorts
// them), and the spelling switch.
import fs from 'node:fs';
import { open, check, failures, sleep, go, write, read, VAULT } from './lib.mjs';

// to-dos on two pages, one changed long ago: Newest first puts today's journal first, Oldest the other
const tasks = VAULT + '/pages/Tasks.md';
const old = Date.now() / 1000 - 10 * 86400;
fs.utimesSync(tasks, old, old);

const { browser, page, errors } = await open();

console.log('the top strip: the buttons over the sidebar are evenly spaced, the last at its edge');
const strip = await page.evaluate(() => {
  const app = [...document.querySelectorAll('#histbar .hb-app > *')];
  const nav = [...document.querySelectorAll('#histbar .hb-nav[data-p="0"] > button')];
  const r = [...app, ...nav].filter((e) => e.offsetWidth).map((e) => e.getBoundingClientRect());
  const gaps = r.slice(1).map((b, i) => Math.round(b.left - r[i].right));
  return { n: r.length, gaps, last: Math.round(r.at(-1)?.right), side: Math.round(document.querySelector('#side').getBoundingClientRect().right) };
});
check(strip.n === 7 && Math.max(...strip.gaps) - Math.min(...strip.gaps) <= 1, 'seven buttons, the same gap between each two', JSON.stringify(strip));
check(Math.abs(strip.side - strip.last) <= 12, 'the row ends at the sidebar’s edge', JSON.stringify(strip));

console.log('linked references fold, as unlinked ones do, and stay folded');
const person = 'Rosa Penhallow';
await go(page, '#/page/' + encodeURIComponent(person));
await page.waitForSelector('section.sec:not(.unlinked) .refgrp');
const linked = () => page.locator('section.sec:not(.unlinked)').filter({ hasText: /^Linked references/ });
const head = () => linked().locator('.sec-h .disclose');
check(await head().getAttribute('aria-expanded') === 'true', 'open at first');
await head().click();
await sleep(300);
check(await head().getAttribute('aria-expanded') === 'false' && !(await linked().locator('.refgrp').first().isVisible()), 'a click on the heading folds them');
await page.reload();
await page.waitForSelector('section.sec:not(.unlinked) .sec-h .disclose');
await sleep(400);
check(await head().getAttribute('aria-expanded') === 'false', 'still folded after a reload');
await head().click();
await sleep(400);
check(await head().getAttribute('aria-expanded') === 'true' && await linked().locator('.refgrp').first().isVisible(), 'and open again');

console.log('filter buttons: the pages these references mention');
await linked().locator('.ref-f').click();
await sleep(300);
const chips = async () => linked().locator('.ref-chip').evaluateAll((cs) => cs.map((c) => c.firstChild.textContent.trim().toLowerCase()));
const groups = async () => linked().locator('.refgrp').evaluateAll((gs) => gs.map((g) => g.dataset.page));
const all = await groups();
const names = await chips();
check(all.length >= 2 && names.length >= 2 && !names.includes(person.toLowerCase()), 'a button for each page they’re on or mention (not this page)', JSON.stringify({ all, names }));
const pick = all.find((g) => !/\d{4}$/.test(g)) || all[0];
const chip = linked().locator('.ref-chip', { hasText: pick });
await chip.click();
await sleep(400);
check(JSON.stringify(await groups()) === JSON.stringify([pick]) && await chip.getAttribute('data-pick') === 'in', 'one click: only those', JSON.stringify(await groups()));
await chip.click();
await sleep(400);
check(!(await groups()).includes(pick) && (await groups()).length === all.length - 1 && await chip.getAttribute('data-pick') === 'out', 'a second: those hidden', JSON.stringify(await groups()));
await chip.click();
await sleep(400);
check((await groups()).length === all.length && !(await chip.getAttribute('data-pick')), 'a third: all back', JSON.stringify(await groups()));

console.log('to-dos: newest first unless picked otherwise, the other way round, by date, and page buttons');
await go(page, '#/todos');
await page.waitForSelector('.todo-item');
const order = () => page.locator('.todo-order [aria-pressed="true"]').getAttribute('data-sort');
const items = () => page.locator('.todo-item .bc').allTextContents();
const heads = () => page.locator('.todos .sec-h').allTextContents();
check(await order() === 'recent' && /^Newest first/.test((await heads())[0] || ''), 'Newest first at the start', JSON.stringify(await heads()));
const onTasks = (t) => /overdue thing|today thing|next week thing|undated thing/.test(t);
const firstTask = (l) => l.findIndex(onTasks), lastOther = (l) => l.length - 1 - [...l].reverse().findIndex((t) => !onTasks(t));
let l = await items();
check(firstTask(l) > lastOther(l) && l.some((t) => /email/.test(t)), 'the journals (changed just now) before the Tasks page (changed 10 days ago)', JSON.stringify(l));
await page.locator('.todo-order [data-sort="oldest"]').click();
await sleep(200);
l = await items();
check(/^Oldest first/.test((await heads())[0] || '') && onTasks(l[0]) && !onTasks(l.at(-1)), 'Oldest first: the other way round', JSON.stringify(l));
await page.locator('.todo-order [data-sort="due"]').click();
await sleep(200);
check((await heads()).some((t) => /^Overdue/.test(t)) && (await heads()).some((t) => /^No date/.test(t)), 'By date: Overdue, Today… as before', JSON.stringify(await heads()));
await page.reload();
await page.waitForSelector('.todo-item');
check(await order() === 'due', 'the order is remembered');
await page.locator('.todo-order [data-sort="recent"]').click();
const tchips = await page.locator('.todo-chips .ref-chip').evaluateAll((cs) => cs.map((c) => c.firstChild.textContent.trim()));
check(tchips.includes('Tasks') && tchips.some((t) => t.toLowerCase() === person.toLowerCase()), 'buttons for the pages they’re on and the pages they mention', JSON.stringify(tchips));
await page.locator('.todo-chips .ref-chip', { hasText: 'Tasks' }).click();
await sleep(200);
l = await items();
check(l.length > 0 && l.every(onTasks), 'one click: only the to-dos on that page', JSON.stringify(l));
await page.locator('.todo-chips .ref-chip', { hasText: 'Tasks' }).click();
await sleep(200);
check((await items()).some((t) => /email/.test(t)) && !(await items()).some((t) => /overdue thing/.test(t)), 'a second: those hidden', JSON.stringify(await items()));
await page.locator('.todo-chips .ref-chip', { hasText: 'Tasks' }).click();
await page.locator('.list-tools input.filter').fill('overdue');
await sleep(200);
check((await items()).length === 1 && /overdue thing/.test((await items())[0]), 'typing still filters too', JSON.stringify(await items()));

console.log('Namespaces: only pages in one');
write('pages/Solo page.md', '- on its own\n');
await go(page, '#/pages');
await page.waitForSelector('.pg-rows li');
const tree = page.locator('.chips [data-o="tree"]');
if (await tree.getAttribute('aria-pressed') !== 'true') await tree.click();
await sleep(300);
const rows = await page.locator('.tree-rows li .pg-name').allTextContents();
check(rows.length > 0 && !rows.some((r) => /Solo page|Maths|Orphan page/.test(r)), 'a page that isn’t in a namespace isn’t listed', JSON.stringify(rows));
await tree.click();

console.log('spelling: checked as you type, unless turned off in Settings → Look');
await go(page, '#/page/Maths');
await page.locator('.outline .blk > .bc').first().click();
await page.waitForSelector('textarea.ed');
check(await page.locator('textarea.ed').evaluate((t) => t.spellcheck) === true, 'on by default');
await page.keyboard.press('Escape');
await go(page, '#/settings/look');
const sw = page.locator('.spell-row input');
check(await sw.isChecked(), 'Settings → Look shows it on');
await sw.uncheck();
await go(page, '#/page/Maths');
await page.locator('.outline .blk > .bc').first().click();
await page.waitForSelector('textarea.ed');
check(await page.locator('textarea.ed').evaluate((t) => t.spellcheck) === false, 'off once turned off');
await page.keyboard.press('Escape');
check(read('pages/Maths.md').includes('Fraction'), '(nothing changed in the note)');

console.log('faint words readable: at least 4.5:1 on the page and the cards');
const ratios = await page.evaluate(() => {
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const col = (el, v) => { const d = document.createElement('i'); d.style.color = `var(${v})`; el.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
  const out = {};
  for (const id of ['plain', 'plainnight', 'calm', 'calmplain', 'paper', 'night']) {
    const el = document.createElement('div'); el.dataset.skin = id; document.body.append(el);
    const f = col(el, '--ink-faint');
    out[id] = Math.min(...['--bg', '--surface'].map((v) => cr(f, col(el, v)))).toFixed(2);
    el.remove();
  }
  return out;
});
check(Object.values(ratios).every((r) => +r >= 4.5), 'every one of these looks', JSON.stringify(ratios));

check(errors.length === 0, 'no page errors', errors.join('\n'));
await browser.close();
process.exit(failures() ? 1 : 0);

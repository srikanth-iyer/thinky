// The Journals list: today's "Scheduled & deadline" box, and under each day its linked references and
// (folded) unlinked references, each shown only when the day has some.
import { open, read, write, check, failures, sleep, go, SHOTS } from './lib.mjs';

const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
const today = new Date();
const yday = new Date(today); yday.setDate(today.getDate() - 1);
write('pages/Refs.md', `- planning for [[${title(today)}]] with the group\n- I wrote on ${title(yday)} about the bakery walk\n- another link to [[${title(today)}]] here\n`);

const { browser, page, errors } = await open();
await sleep(1500);
const sheets = page.locator('.sheet');
const todaySheet = sheets.first();

console.log('today: "Scheduled & deadline"');
const box = todaySheet.locator('.sched');
check(await box.isVisible(), 'today’s journal has the box');
const grp = async () => box.locator('.sched-grp').evaluateAll((gs) => gs.map((g) => `${g.dataset.g}:${g.querySelectorAll('.todo-item').length}:${g.querySelector('.sched-list').hidden ? 'folded' : 'open'}`));
check((await grp()).join(' ') === 'overdue:1:folded today:1:open soon:1:open', 'overdue (folded), today and the next days', (await grp()).join(' '));
check(await box.locator('.sched-grp[data-g="soon"] h4').textContent().then((t) => t.startsWith('Next 7 days')), 'it looks 7 days ahead by default');
await box.locator('[data-f="overdue"]').click();
await sleep(100);
check(await box.locator('.sched-grp[data-g="overdue"] .todo-item', { hasText: 'overdue thing' }).isVisible(), 'opening "Overdue" shows the overdue to-do');
await box.locator('.todo-item', { hasText: 'today thing' }).locator('.todo').click();
await sleep(800);
check(read('pages/Tasks.md').includes('- DONE today thing'), 'ticking a to-do in the box marks it DONE in its page', read('pages/Tasks.md'));
check((await grp()).join(' ') === 'overdue:1:open today:0:open soon:1:open' || !(await grp()).some((g) => g.startsWith('today')), 'and it leaves the box', (await grp()).join(' '));
await page.screenshot({ path: SHOTS + '/journals-scheduled.png' });

console.log('a to-do written on another day: ticked in the box, that day below shows it ticked too');
const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { weekday: 'short' })}`;
const ydayFile = `Diary/${title(yday)}.md`;
const ydayText = read(ydayFile);
write(ydayFile, ydayText + `- TODO call the bank\n  SCHEDULED: <${stamp(today)}>\n`);
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Maths');
await go(page, '#/journals');
await sleep(1500);
await box.locator('.todo-item', { hasText: 'call the bank' }).locator('.todo').click();
await sleep(800);
check(read(ydayFile).includes('- DONE call the bank'), 'ticked in its own page', read(ydayFile));
const bankBlk = sheets.nth(1).locator('.outline .blk', { hasText: 'call the bank' }).first();
check(await bankBlk.locator(':scope > .bc .todo').isChecked(), 'yesterday’s outline below shows it ticked');
await bankBlk.locator(':scope > .bc').click({ position: { x: 200, y: 8 } });
await page.waitForSelector('textarea.ed');
await page.keyboard.press('End');
await page.keyboard.type(' today');
await page.keyboard.press('Escape');
await sleep(1500);
check(await page.locator('.banner:not([hidden])').count() === 0 && read(ydayFile).includes('call the bank today'), 'editing it there next is a normal save, not a clash', read(ydayFile));
write(ydayFile, ydayText);
await page.evaluate(() => window.leanApp.rescan());
await sleep(300);

console.log('references under each day, only when there are some');
const linked = todaySheet.locator('.day-refs .sec:not(.unlinked)');
check(await linked.count() === 1 && (await linked.locator('.n').textContent()).trim() === '2', 'today: "Linked references" with the 2 links to it');
check(await linked.locator('.refgrp h3').textContent() === 'Refs', 'grouped by the page they’re in');
await linked.locator('.refhit', { hasText: 'planning for' }).click();
await sleep(700);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === '#/page/Refs', 'clicking one opens it where it’s written');
await go(page, '#/journals');
await sleep(1500);
const ydaySheet = sheets.nth(1);
check(await ydaySheet.locator('.day-refs .sec:not(.unlinked)').count() === 0, 'a day nothing links to has no "Linked references" heading');
const un = ydaySheet.locator('.day-refs .unlinked');
check(await un.count() === 1, 'a day mentioned in plain text gets "Unlinked references"');
check(await un.locator('.disclose').getAttribute('aria-expanded') === 'false', '…folded until opened');
await un.locator('.disclose').click();
await sleep(600);
check(await un.locator('.refhit', { hasText: 'I wrote on' }).count() === 1 && await un.locator('.linkit').count() === 1, 'opening it lists the mention, with a Link button');
check(await todaySheet.locator('.day-refs .unlinked').count() === 0, 'a day only linked to (no plain mentions) has no "Unlinked references"');
const n3 = await sheets.count();
const bare = await page.evaluate(() => [...document.querySelectorAll('.sheet')].slice(2).map((s) => s.querySelectorAll('.day-refs > *').length));
check(n3 >= 3 && bare.every((x) => x === 0), 'days without references show neither', JSON.stringify(bare));
await un.locator('.linkit').click();
await sleep(700);
check(read('pages/Refs.md').includes(`I wrote on [[${title(yday)}]] about`), 'Link makes the mention a link');

console.log('the box remembers being folded; none when nothing is due');
await box.locator('[data-f="box"]').click();
await sleep(100);
await go(page, '#/page/Maths');
await go(page, '#/journals');
await sleep(1500);
check(await page.locator('.sheet').first().locator('.sched-body').isHidden(), 'folded stays folded');
await page.locator('.sheet').first().locator('.sched [data-f="box"]').click();
write('pages/Tasks.md', '- TODO nothing dated\n');
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Maths');
await go(page, '#/journals');
await sleep(1500);
check(await page.locator('.sheet').first().locator('.sched').count() === 0, 'no box when nothing is due');

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

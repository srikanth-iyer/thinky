// Build 60 in a real browser: the quiet days in the Journals list (he picked version 2e of the mock-ups,
// Nov 25; app.js quietRun):
//  - between two days with days in between that have no notes, a faint + on the line that ends the newer
//    day, lined up with the notes' dots; none between days next to each other;
//  - a tap opens their dates, newest first, the top one marked; a longer run says where it is;
//    a second tap closes them;
//  - a tap on a date puts that day in its place, its first note open; what's typed is saved to that day's
//    file; the run is split around it.
// (The test folder has today, yesterday, a year ago today and March 3rd, 2020.)
import { open, check, failures, go, sleep, VAULT } from './lib.mjs';
import fs from 'node:fs';

const { browser, page, errors } = await open();
await go(page, '#/journals');
await page.waitForSelector('#main .sheet.day');
await sleep(800);

const runs = () => page.evaluate(() => [...document.querySelectorAll('#main .quiet')].map((q) => ({
  label: q.querySelector('.q-mark').getAttribute('aria-label'),
  after: q.previousElementSibling?.querySelector('.page-title')?.textContent,
  before: q.nextElementSibling?.querySelector('.page-title')?.textContent,
})));
const r0 = await runs();
// days between yesterday and a year ago (counted in the page, in its own time zone)
const n = await page.evaluate(() => { const t = new Date(); const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1); const a = new Date(t.getFullYear() - 1, t.getMonth(), t.getDate()); return Math.round((y - a) / 864e5) - 1; });
check(r0.length === 2, 'two runs of quiet days: before a year ago, and before 2020', JSON.stringify(r0));
check(r0[0]?.label === `${n} days with no notes: show them`, 'the first run counts the days between yesterday and a year ago', r0[0]?.label);
check(!(await page.evaluate(() => { const s = document.querySelector('#main .sheet.day.today'); return s?.nextElementSibling?.classList.contains('quiet'); })), 'none between today and yesterday');
check(r0[1]?.label === '366 days with no notes: show them', 'a run longer than a year shows its newest year', r0[1]?.label);

// lined up with the notes' dots: the + under the newer day's notes
const line = await page.evaluate(() => { const q = document.querySelector('#main .quiet'); const m = q.querySelector('.q-mark i').getBoundingClientRect(); const s = q.previousElementSibling; const p = s.querySelector('.add-end svg').getBoundingClientRect();
  return { dx: Math.abs(m.left + m.width / 2 - (p.left + p.width / 2)), dy: Math.abs(m.top + m.height / 2 - s.getBoundingClientRect().bottom) }; });
check(line.dx <= 1.5 && line.dy <= 1.5, 'the + sits on the line that ends the day, under the notes\' dots', JSON.stringify(line));

// open: dates newest first, the top one marked, "1 of n"
const mark = page.locator('#main .quiet .q-mark').first();
await mark.scrollIntoViewIfNeeded();
const h0 = await page.evaluate(() => document.querySelector('#main .quiet').nextElementSibling.getBoundingClientRect().top - document.querySelector('#main .quiet').previousElementSibling.getBoundingClientRect().bottom);
await mark.click();
await sleep(300);
const open1 = await page.evaluate(() => { const q = document.querySelector('#main .quiet'); const rows = [...q.querySelectorAll('.q-day')];
  const t = new Date(); const want = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 2).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return { rows: rows.length, first: rows[0]?.textContent, want, mid: rows.findIndex((b) => b.classList.contains('mid')), count: q.querySelector('.q-count')?.textContent, h: q.querySelector('.q-wheel').getBoundingClientRect().height }; });
check(open1.rows === n && open1.first === open1.want, 'a tap shows the dates, the day before yesterday first', JSON.stringify(open1));
check(open1.mid === 0 && open1.count === `1 of ${n}`, 'the top date is marked, and the run says where it is', JSON.stringify(open1));
check(open1.h > 50 && open1.h < 80, 'three dates in view, close together', String(open1.h));
await mark.click();
await sleep(200);
const h1 = await page.evaluate(() => document.querySelector('#main .quiet').nextElementSibling.getBoundingClientRect().top - document.querySelector('#main .quiet').previousElementSibling.getBoundingClientRect().bottom);
check(Math.abs(h1 - h0) < 1, 'a second tap closes them, and the space between the days is as it was', `${h0} ${h1}`);

// put a day in: the second date (three days ago)
await mark.click();
await sleep(300);
const before = new Set(fs.readdirSync(VAULT + '/Diary'));
await page.locator('#main .quiet .q-day').nth(1).click();
await sleep(1200);
const put = await page.evaluate(() => ({ editing: !!document.activeElement?.closest('#main .sheet.day'), runs: [...document.querySelectorAll('#main .quiet')].map((q) => q.querySelector('.q-mark').getAttribute('aria-label')), titles: [...document.querySelectorAll('#main .sheet.day .page-title')].map((t) => t.textContent) }));
check(put.editing, 'the day put in has its first note open', JSON.stringify(put));
check(put.titles.length === 5, 'the day is in the list, in its place', JSON.stringify(put.titles));
check(put.runs[0] === 'A day with no notes: show it' && put.runs[1] === `${n - 2} days with no notes: show them`, 'the run is split around it', JSON.stringify(put.runs));
await page.keyboard.type('a quiet day, written on');
await page.keyboard.press('Escape');
let made = [];
for (let i = 0; i < 30 && !made.length; i++) { await sleep(200); made = fs.readdirSync(VAULT + '/Diary').filter((f) => !before.has(f)); }
check(made.length === 1 && fs.readFileSync(VAULT + '/Diary/' + made[0], 'utf8').includes('a quiet day, written on'), 'what is typed is saved to that day\'s file', JSON.stringify(made));

await browser.close();
if (errors.length) console.log('script errors: ' + errors.join(' | '));
process.exit(failures() ? 1 : 0);

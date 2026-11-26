// Build 61 in a real browser: the quiet days' dates slide open (he asked, Nov 25: "it should slide open
// and i should be able to see it slide open instead of a quick cut"; app.js quietRun, dom.js grow):
//  - a tap on the faint + between days: the room under it opens over 0.3 s (0.2 s before Nov 27) with a gentle curve, the
//    older days pushed down smoothly, while the dates grow out of the +;
//  - a second tap: the dates fold back into the + over 0.26 s as the room closes, then they're gone;
//  - a tap partway through turns the movement round from where it is (no jump);
//  - with animations off they open and close at once.
// Each check reads the movement in the same step as the tap (the page's own clock, not the test's), so a
// slow machine can't miss it. (The test folder has today, yesterday, a year ago today and March 3rd, 2020.)
import { open, check, failures, go, sleep } from './lib.mjs';

const { browser, page, errors } = await open();
await go(page, '#/journals');
await page.waitForSelector('#main .quiet .q-mark');
await sleep(800);
await page.locator('#main .quiet .q-mark').first().scrollIntoViewIfNeeded();

// the room the first run takes (closed) and the gap to the next day, before anything moves
const shut = await page.evaluate(() => document.querySelector('#main .quiet').getBoundingClientRect().height);

// opening: tap, then look at the movement 40 ms in (its curve is fast at first: about two thirds of the way)
const opening = await page.evaluate(() => {
  const q = document.querySelector('#main .quiet');
  q.querySelector('.q-mark').click();
  const room = q.getAnimations(), w = q.querySelector('.q-wheel'), dates = w.getAnimations();
  const t = room[0]?.effect.getComputedTiming();
  for (const a of [...room, ...dates]) { a.pause(); a.currentTime = 40; }
  const mid = q.getBoundingClientRect().height, clip = getComputedStyle(w).clipPath;
  for (const a of [...room, ...dates]) a.finish();
  return { rooms: room.length, dates: dates.length, dur: t?.duration, ease: t?.easing, mid, clip, full: q.getBoundingClientRect().height, hidden: w.hidden };
});
check(opening.rooms === 1 && opening.dur === 300, 'a tap: the room under the + opens over 0.3 s (gentler since Nov 27, his words: nothing sudden or jittery)', JSON.stringify(opening));
check(/^cubic-bezier\(0?\.45,0,0?\.2,1\)$/.test(String(opening.ease).replace(/\s/g, '')), 'with the gentle curve: eases in and out', String(opening.ease));
check(opening.mid > shut + 2 && opening.mid < opening.full - 2, 'partway, the room is between closed and open (the older days slide down, no jump)', JSON.stringify({ shut, ...opening }));
check(opening.dates === 1 && opening.clip.startsWith('inset('), 'the dates grow out of the +', JSON.stringify(opening));
check(!opening.hidden && opening.full > shut + 40, 'once open, the dates are there with room for them', JSON.stringify(opening));
await sleep(100);
check(await page.evaluate(() => { const q = document.querySelector('#main .quiet'); return !q.classList.contains('moving') && !q.querySelector('.q-wheel').style.clipPath; }), 'nothing is left clipped or held once it has opened');

// closing: the dates stay while they fold back, then go
const closing = await page.evaluate(() => {
  const q = document.querySelector('#main .quiet'), w = q.querySelector('.q-wheel');
  q.querySelector('.q-mark').click();
  const room = q.getAnimations(), dates = w.getAnimations();
  const t = room[0]?.effect.getComputedTiming();
  for (const a of [...room, ...dates]) { a.pause(); a.currentTime = 30; }
  const r = { rooms: room.length, dates: dates.length, dur: t?.duration, mid: q.getBoundingClientRect().height, shown: !w.hidden };
  for (const a of [...room, ...dates]) a.play();
  return r;
});
check(closing.rooms === 1 && closing.dur === 260 && closing.dates === 1, 'a second tap: the dates fold back into the + over 0.26 s', JSON.stringify(closing));
check(closing.shown && closing.mid > shut + 2 && closing.mid < opening.full - 2, 'partway, the dates are still there and the room is closing', JSON.stringify(closing));
await sleep(400);
const after = await page.evaluate(() => { const q = document.querySelector('#main .quiet'); return { h: q.getBoundingClientRect().height, hidden: q.querySelector('.q-wheel').hidden, open: q.classList.contains('open'), moving: q.classList.contains('moving') }; });
check(after.hidden && !after.open && !after.moving && Math.abs(after.h - shut) < 0.5, 'then they are gone and the room is as it was', JSON.stringify({ shut, ...after }));

// a tap partway through opening closes from where it is
const turn = await page.evaluate(() => {
  const q = document.querySelector('#main .quiet'), m = q.querySelector('.q-mark');
  m.click();
  for (const a of q.getAnimations()) { a.pause(); a.currentTime = 100; }
  const at = q.getBoundingClientRect().height;
  m.click();
  const back = q.getAnimations();
  for (const a of back) a.pause(); // (at its start)
  const from = q.getBoundingClientRect().height;
  for (const a of [...back, ...q.querySelector('.q-wheel').getAnimations()]) a.finish();
  return { at, from, n: back.length };
});
check(turn.n === 1 && Math.abs(turn.at - turn.from) < 1, 'a tap partway through opening closes from where it is, no jump', JSON.stringify(turn));
await sleep(300);
check(await page.evaluate(() => document.querySelector('#main .quiet .q-wheel').hidden), '… and the dates are gone');

// animations off: at once
const off = await page.evaluate(() => {
  document.documentElement.dataset.motion = 'off';
  const q = document.querySelector('#main .quiet'), m = q.querySelector('.q-mark');
  m.click();
  const opened = { n: q.getAnimations().length + q.querySelector('.q-wheel').getAnimations().length, h: q.getBoundingClientRect().height, shown: !q.querySelector('.q-wheel').hidden };
  m.click();
  const closed = { n: q.getAnimations().length, h: q.getBoundingClientRect().height, hidden: q.querySelector('.q-wheel').hidden };
  delete document.documentElement.dataset.motion;
  return { opened, closed };
});
check(off.opened.n === 0 && off.opened.shown && off.opened.h > shut + 40, 'animations off: the dates open at once', JSON.stringify(off));
check(off.closed.n === 0 && off.closed.hidden && Math.abs(off.closed.h - shut) < 0.5, 'animations off: and close at once', JSON.stringify(off));

check(errors.length === 0, 'no script errors', errors.join('\n'));
await browser.close();
process.exit(failures() ? 1 : 0);

// References that read clearly (he asked, Oct 27–28): each page's references in a box of its own, sunken
// into the page (Calm: a light well with an inner shadow, not a raised card), headed by the page's name
// (its icon, or a calendar for a journal day) with how many notes; a faint line between notes from the
// same page; three small buttons at the right of the heading: Filter (a box under it, the words lit), Sort
// (Last changed ↔ Name, remembered) and Fold all / Open all (kept for the session). Unlinked references and a day's references in the Journals list get
// the same boxes (the tools themselves: t16_reftools). Journals: a day with no notes shows its empty first note ("Click to write…", "Tap…" on
// a phone) with a roomy area under it that opens it too, well above its references; a little more room
// between days (Plain: the same space above and below the line). Every look; a phone.
import fs from 'node:fs';
import { open, write, read, check, failures, sleep, go, SHOTS, VAULT } from './lib.mjs';

const title = (d) => { const n = d.getDate(); const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'; return d.toLocaleString('en-GB', { month: 'long' }) + ` ${n}${suf}, ${d.getFullYear()}`; };
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const F = 'Tobias Wren Okafor';
/** a file written now, then dated hours ago (the "Last changed" order) */
const put = (rel, text, hours) => { write(rel, text); const t = Date.now() / 1000 - hours * 3600; fs.utimesSync(VAULT + '/' + rel, t, t); };
put(`pages/${F}.md`, `tags:: people\n\n- Cook at [[Apron club]]\n`, 300);
put(`Diary/${title(ago(0))}.md`, `- Call with [[${F}]] about the pickles\n\t- try a weaker brine next\n`, 0.5);
put(`Diary/${title(ago(1))}.md`, `- Baked with [[${F}]] on Sunday\n`, 20);
put(`Diary/${title(ago(3))}.md`, `- Kitchen meeting: [[${F}]] showed a new pickle\n\t- it keeps longer in brine\n`, 70);
put('pages/Recipe draft.md', `icon:: 📝\n\n- Pickles\n\t- Ask [[${F}]] for the jars\n\t\t- jar a: more brine\n- Labels written by [[${F}]]\n`, 1);
put('pages/Supper club.md', `icon:: 📚\n\n- [[${F}]] brings the soup\n- Next time [[${F}]] picks\n`, 50);
put('pages/Prep notes.md', `- Kitchen\n\t- Talked to [[${F}]] about café plans\n- Another [[${F}]] note\n`, 96);
put('pages/Trip.md', `icon:: ✈️\n\n- Fly to Oslo on [[${title(ago(2))}]]\n\t- pack the charger\n- Taxi for [[${title(ago(2))}]]\n`, 30);
put('pages/Errands.md', `- Parcel on [[${title(ago(2))}]]\n- Dentist on [[${title(ago(4))}]]\n`, 40);
put('pages/Plain mention.md', '- met tobias wren okafor at the kitchen\n', 200);
put('pages/Pickles in brine.md', read('pages/Pickles in brine.md'), 480);
put('pages/Plans.md', `- finish the draft by [[${title(ago(0))}]]\n`, 10);
const PAGE = '#/page/Tobias%20Wren%20Okafor';
const ORDER_CHANGED = [title(ago(0)), 'Recipe draft', title(ago(1)), 'Supper club', title(ago(3)), 'Prep notes', 'Pickles in brine'];
const ORDER_NAME = ['Pickles in brine', 'Prep notes', 'Recipe draft', 'Supper club', title(ago(0)), title(ago(1)), title(ago(3))];

const linked = (page) => page.locator('#main .view > .sec:not(.unlinked)');
const order = (page) => linked(page).locator('.refgrp').evaluateAll((gs) => gs.map((g) => g.dataset.page));
const waitRefs = (page) => page.waitForSelector('#main .view > .sec .refgrp .refnote');

let { browser, page, errors } = await open();
await go(page, PAGE);
await waitRefs(page);
await sleep(500);

console.log('a box per page, sunken (Calm)');
const box = await linked(page).locator('.refgrp').first().evaluate((g) => {
  const cs = getComputedStyle(g), h3 = g.querySelector('h3');
  return { bg: cs.backgroundColor, page: getComputedStyle(document.body).backgroundColor, shadow: cs.boxShadow, border: cs.borderTopWidth, radius: parseFloat(cs.borderTopLeftRadius),
    size: parseFloat(getComputedStyle(h3).fontSize), weight: +getComputedStyle(h3).fontWeight, note: parseFloat(getComputedStyle(g.querySelector('.refhit .bc')).fontSize) };
});
check(box.bg === 'rgb(255, 255, 255)' && box.page !== box.bg, 'the words sit on a light canvas, not on the tinted page', JSON.stringify(box));
check(box.shadow.includes('inset') && parseFloat(box.border) >= 1 && box.radius >= 8, 'pressed in: an inner shadow (a well, not a raised card)', box.shadow);
check(box.size >= box.note && box.weight >= 600, 'the page’s name heads it, a little bigger and bolder than the notes', JSON.stringify(box));
const heads = await linked(page).locator('.refgrp h3').evaluateAll((hs) => hs.map((h) => ({ page: h.closest('.refgrp').dataset.page, day: !!h.querySelector('.grp-day svg'), icon: h.querySelector('.pg-ic')?.textContent ?? '', n: h.querySelector('.grp-n')?.textContent })));
const hd = (p) => heads.find((x) => x.page === p) || {};
check(hd(title(ago(0))).day && !hd('Prep notes').day && !hd('Recipe draft').day, 'journal days carry a little calendar, pages don’t', JSON.stringify(heads));
check(hd('Recipe draft').icon === '📝' && hd('Prep notes').icon === '', 'a page’s icon:: shows before its name', JSON.stringify(heads));
check(hd('Recipe draft').n === '2 notes' && hd(title(ago(1))).n === '1 note', 'and how many of its notes are listed', JSON.stringify(heads));
const gaps = await linked(page).locator('.refgrp').evaluateAll((gs) => gs.slice(1).map((g, k) => Math.round(g.getBoundingClientRect().top - gs[k].getBoundingClientRect().bottom)));
check(gaps.every((x) => x >= 12), 'room between one page’s box and the next', gaps.join());
const sep = await linked(page).locator('.refgrp[data-page="Recipe draft"] .refnote').nth(1).evaluate((n) => ({ line: getComputedStyle(n).borderTopStyle, w: parseFloat(getComputedStyle(n).borderTopWidth), pad: parseFloat(getComputedStyle(n).paddingTop) }));
check(sep.line !== 'none' && sep.w >= 1 && sep.pad >= 6, 'a faint line and a little room between two notes of one page', JSON.stringify(sep));
await page.screenshot({ path: SHOTS + '/refs16-calm.png' });

console.log('sort: Last changed (newest first) or Name, remembered');
check(JSON.stringify(await order(page)) === JSON.stringify(ORDER_CHANGED), 'at first: the page changed last first', JSON.stringify(await order(page)));
const sortBtn = linked(page).locator('.ref-s');
check(await sortBtn.getAttribute('data-sort') === 'changed' && /last changed/.test(await sortBtn.getAttribute('aria-label')), 'Sort says “last changed”', await sortBtn.getAttribute('aria-label'));
await sortBtn.click();
await page.locator('.sort-menu [data-k="4"]').click();
await sleep(600);
check(JSON.stringify(await order(page)) === JSON.stringify(ORDER_NAME), 'Name: pages A to Z, then the days, newest first', JSON.stringify(await order(page)));
await go(page, '#/page/Maths');
await go(page, PAGE);
await waitRefs(page);
await sleep(300);
check(JSON.stringify(await order(page)) === JSON.stringify(ORDER_NAME) && await sortBtn.getAttribute('data-sort') === 'name', 'remembered on coming back', JSON.stringify(await order(page)));
// a note saved here moves its page up at once (the app's own file times)
await go(page, '#/page/Prep%20notes');
await page.locator('.outline .blk > .bc', { hasText: 'Another' }).click({ position: { x: 4, y: 6 } });
await page.waitForSelector('textarea.ed');
await page.keyboard.press('End');
await page.keyboard.type(' (today)');
await page.keyboard.press('Escape');
await sleep(1200);
await go(page, PAGE);
await waitRefs(page);
await sortBtn.click();
await page.locator('.sort-menu [data-k="1"]').click();
await sleep(600);
check((await order(page))[0] === 'Prep notes', 'Last changed: a page just edited comes first', JSON.stringify(await order(page)));

console.log('the filter');
const count = () => linked(page).locator('.sec-h .n').textContent();
const filter = page.locator('.ref-filter');
await linked(page).locator('.ref-f').click(); // (the box shows once Filter is clicked: t16_reftools)
await filter.fill('brine');
await sleep(700);
const kept = await linked(page).locator('.refnote').evaluateAll((ns) => ns.map((n) => n.closest('.refgrp').dataset.page + ': ' + n.querySelector('.refhit').textContent.trim()));
check(kept.length === 4 && kept.some((k) => k.startsWith('Recipe draft: Ask')) && kept.some((k) => k.includes('Call with')) && kept.some((k) => k.includes('Kitchen meeting')) && kept.some((k) => k.startsWith('Pickles in brine:')), 'only references mentioning the word (in the note, under it, above it, or its page’s name)', JSON.stringify(kept));
check(!(await order(page)).includes('Supper club'), 'pages with none of them leave the list');
check(await count() === '4 of 10 match', 'the heading says how many match', await count());
const lit = await page.evaluate(() => { const h = CSS.highlights.get('ref-filter'); return h ? [...h].map((r) => r.toString().toLowerCase()) : null; });
check(lit && lit.length >= 3 && lit.every((w) => w === 'brine'), 'the word is lit where it shows', JSON.stringify(lit));
await filter.fill('cafe');
await sleep(700);
check((await order(page)).join() === 'Prep notes', 'accents and capitals don’t matter (cafe finds café)', JSON.stringify(await order(page)));
await filter.fill('meeting brine');
await sleep(700);
check((await order(page)).join() === title(ago(3)), 'several words: notes with every one of them', JSON.stringify(await order(page)));
await filter.fill('zebra');
await sleep(700);
check(await linked(page).locator('.ref-none').isVisible() && await linked(page).locator('.refgrp').count() === 0, 'nothing matches: it says so', await linked(page).locator('.ref-none').textContent().catch(() => ''));
await filter.press('Escape');
await sleep(700);
check(await linked(page).locator('.refgrp').count() === ORDER_NAME.length && /in 7 pages/.test(await count()) && await filter.inputValue() === '', 'Esc empties it: everything back', await count());
await filter.type('g j'); // (letters typed into the box are words, not shortcuts)
await sleep(500);
check(decodeURIComponent(await page.evaluate(() => location.hash)) === `#/page/${F}`, 'typing in it never runs a shortcut (g j)', await page.evaluate(() => location.hash));
await filter.fill('');
await sleep(500);

console.log('Fold all / Open all, kept for the session');
const fa = linked(page).locator('.ref-fa'), faSays = () => fa.getAttribute('aria-label');
check(await faSays() === 'Fold all', 'the button says Fold all');
await fa.click();
await sleep(500);
const allShut = () => linked(page).locator('.refgrp').evaluateAll((gs) => gs.length && gs.every((g) => g.classList.contains('folded')));
check(await allShut() && await linked(page).locator('.refnote').count() === 0, 'every page folded to its name (nothing drawn inside)');
check(await faSays() === 'Open all', '…and the button now says Open all');
await page.screenshot({ path: SHOTS + '/refs16-folded.png' });
await go(page, '#/page/Maths');
await go(page, PAGE);
await sleep(800);
check(await allShut() && await faSays() === 'Open all', 'still folded on coming back');
await linked(page).locator('.refgrp[data-page="Recipe draft"] .grp-fold').click();
await sleep(400);
check(await linked(page).locator('.refgrp[data-page="Recipe draft"] .refnote').count() === 2 && await faSays() === 'Fold all', 'one opened by its arrow: drawn then, and the button says Fold all again');
await fa.click();
await sleep(300);
await fa.click();
await sleep(600);
check(await linked(page).locator('.refgrp.folded').count() === 0 && await linked(page).locator('.refnote').count() >= 10, 'Open all opens them all');

console.log('unlinked references: the same boxes');
await page.locator('.unlinked .disclose').click();
await sleep(800);
const ub = await page.locator('.unlinked .refgrp').first().evaluate((g) => ({ bg: getComputedStyle(g).backgroundColor, shadow: getComputedStyle(g).boxShadow, n: g.querySelector('.grp-n')?.textContent, link: !!g.querySelector('.linkit') }));
check(ub.bg === box.bg && ub.shadow === box.shadow && ub.n === '1 note' && ub.link, 'the same box, its count, the Link button', JSON.stringify(ub));

console.log('every look: a box of its own, readable');
for (const id of ['calm', 'calmplain', 'night', 'paper', 'sticker', 'stickernight', 'automaton', 'plain', 'plainnight', 'plainteal', 'azulejo']) {
  await page.evaluate((id) => { document.documentElement.dataset.skin = id; }, id);
  await sleep(60);
  const st = await linked(page).locator('.refgrp').first().evaluate((g) => { const cs = getComputedStyle(g); return { bg: cs.backgroundColor, border: cs.borderTopStyle, ink: getComputedStyle(g.querySelector('.refhit .bc')).color }; });
  check(st.bg !== 'rgba(0, 0, 0, 0)' && st.bg !== st.ink, `${id}: each page’s references on a surface of their own`, JSON.stringify(st));
}
await page.evaluate(() => { document.documentElement.dataset.skin = 'calm'; });
check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();

console.log('Journals: a day with no notes, roomy days');
({ browser, page, errors } = await open());
await sleep(1500);
const day2 = page.locator('.sheet.day', { has: page.locator('.page-title', { hasText: title(ago(2)) }) });
const blank = await day2.evaluate((s) => {
  const body = s.querySelector('.day-body'), bc = body.querySelector('.bc'), refs = s.querySelector('.day-refs .sec');
  return { blank: body.classList.contains('blank'), ph: bc?.dataset.ph, room: Math.round(refs.getBoundingClientRect().top - bc.getBoundingClientRect().bottom), boxes: s.querySelectorAll('.day-refs .refgrp').length };
});
check(blank.blank && blank.ph === 'Click to write…', 'its empty first note says “Click to write…”', JSON.stringify(blank));
check(blank.room >= 100, 'a roomy empty area under it, its references well below', JSON.stringify(blank));
check(blank.boxes === 2, 'its references in a box per page', JSON.stringify(blank));
check(await page.locator('.sheet.day', { has: page.locator('.page-title', { hasText: title(ago(1)) }) }).locator('.day-body.blank').count() === 0, 'a day with notes has no such area');
const bb = await day2.locator('.day-body').boundingBox();
await day2.locator('.day-body').click({ position: { x: 200, y: bb.height - 20 } }); // (well below the note)
await sleep(300);
check(await day2.locator('textarea.ed').count() === 1, 'a click in that empty area opens the note for writing');
await page.keyboard.type('Packed the bag');
await page.keyboard.press('Escape');
await sleep(1200);
check(fs.existsSync(VAULT + `/Diary/${title(ago(2))}.md`) && read(`Diary/${title(ago(2))}.md`).includes('Packed the bag'), 'and what’s typed is saved in that day’s file', '');
const sp = await page.evaluate(() => [...document.querySelectorAll('.sheet.day')].slice(0, 3).map((s) => ({ gap: Math.round(s.nextElementSibling.getBoundingClientRect().top - s.getBoundingClientRect().bottom), under: Math.round(s.querySelector('.day-body').getBoundingClientRect().top - s.querySelector('.page-title').getBoundingClientRect().bottom) })));
check(sp.every((x) => x.gap === 32 && x.under >= 26), 'Calm: days 32px apart (round 2: he found 64 too big), more room under each date', JSON.stringify(sp));
const today = await page.locator('.sheet.day.today').evaluate((s) => { const r = s.querySelector('.day-refs .sec'), last = [...s.querySelectorAll('.day-body .bc')].pop(); return Math.round(r.getBoundingClientRect().top - last.getBoundingClientRect().bottom); });
check(today >= 32, 'a day’s references sit clear of its notes', today);
await page.screenshot({ path: SHOTS + '/refs16-journals-calm.png' });
await page.evaluate(() => { document.documentElement.dataset.skin = 'plain'; });
await sleep(200);
const hair = await page.evaluate(() => {
  const textBox = (el, last) => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()].filter((x) => x.height > 0); return last ? rs[rs.length - 1] : rs[0]; };
  const s = [...document.querySelectorAll('.sheet.day')].find((x) => !x.classList.contains('today') && !x.querySelector('.day-body.blank') && x.querySelector('.day-refs').childElementCount === 0 && x.getBoundingClientRect().height < 400);
  const line = s.getBoundingClientRect().bottom, last = [...s.querySelectorAll('.day-body .bc')].pop();
  return { min: Math.round(s.getBoundingClientRect().height), below: Math.round(textBox(s.nextElementSibling.querySelector('.weekday'), false).top - line), above: Math.round(line - textBox(last, true).bottom) };
});
check(hair.below >= 44 && hair.below <= 60, 'Plain: roomy space under the line between days', JSON.stringify(hair));
check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();

console.log('on a phone');
({ browser, page, errors } = await open({ viewport: { width: 390, height: 844 }, touch: true }));
await go(page, PAGE);
await waitRefs(page);
await linked(page).locator('.ref-f').tap();
await page.evaluate(() => document.activeElement.blur());
await sleep(400);
const tools = await page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const f = document.querySelector('.ref-filter'), bs = [...document.querySelectorAll('.ref-acts .ref-tbtn')];
  // a finger 19px off the middle of each button, up, down, left or right, still lands on it (its ::after: 40px)
  const reach = bs.map((b) => { const x = r(b).left + r(b).width / 2, y = r(b).top + r(b).height / 2; return [[0, -19], [0, 19], [-19, 0], [19, 0]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === b); });
  const arrow = r(document.querySelector('.grp-fold'));
  return { filter: Math.round(r(f).height), fw: Math.round(r(f).width), reach, arrow: Math.round(arrow.width), wide: document.documentElement.scrollWidth <= innerWidth };
});
check(tools.filter >= 44 && tools.fw >= 300, 'the filter box runs across, finger-sized', JSON.stringify(tools));
check(tools.reach.length === 3 && tools.reach.every(Boolean), 'Filter, Sort and Fold all each take a finger (40px)', JSON.stringify(tools));
check(tools.arrow >= 40 && tools.wide, 'a page’s fold arrow is finger-sized; nothing sticks out sideways', JSON.stringify(tools));
await page.locator('.ref-filter').tap();
await page.keyboard.type('brine');
await sleep(700);
check(await linked(page).locator('.refnote').count() === 4, 'typing in the filter on a phone works too', await linked(page).locator('.refnote').count());
await page.screenshot({ path: SHOTS + '/refs16-phone.png' });
await go(page, '#/journals');
await sleep(1500);
const pd = page.locator('.sheet.day', { has: page.locator('.page-title', { hasText: title(ago(4)) }) }); // (two days ago has a note now)
check(await pd.locator('.day-body .bc').first().getAttribute('data-ph') === 'Tap to write…', 'an empty day says “Tap to write…” on a phone');
await pd.locator('.day-body').scrollIntoViewIfNeeded();
await sleep(300);
const pb = await pd.locator('.day-body').boundingBox();
await page.touchscreen.tap(pb.x + 150, pb.y + pb.height - 16);
await sleep(400);
check(await pd.locator('textarea.ed').count() === 1, 'a tap in its empty area opens the note');
await page.keyboard.press('Escape');
check(!errors.length, 'no script errors on the phone', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

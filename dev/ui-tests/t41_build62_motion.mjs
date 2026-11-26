// Build 62, four looks he asked for in his notes of Nov 26:
//  1. a note's fold arrow: the notes under it slide open and shut (editor.js slideFold), like the rest of
//     the app, instead of appearing and vanishing at once;
//  2. every other opening and closing slides too (dom.js slide): the linked references, a day, a page's
//     group of references, the filter bar, Scheduled & deadline;
//  3. on a phone the note menu fits without scrolling: Cut, Copy and Copy link on one line, the rows used
//     less in "More commands…" (and the filter still finds them); the laptop's menu is as before;
//  4. the quiet days: two thin lines that split open like a book's pages, and a small arrow above or
//     below the dates where there are more days to scroll to.
// Each check reads the movement in the same step as the click (the page's own clock), so a slow machine
// can't miss it.
import { open, check, failures, sleep, go, write } from './lib.mjs';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

write('pages/Folding.md', '- parent\n\t- child one\n\t- child two\n\t\t- grandchild\n\t- child three\n- after\n');
for (let k = 0; k < 4; k++) write(`pages/Ref ${k}.md`, `- line ${k} about [[Hub]] and [[Sourdough Bread]]\n`);
write('pages/Folding more.md', '- parent\n\t- child one\n\t- child two\n\t\t- grandchild\n\t- child three\n- parent two\n\t- kid a\n\t- kid b\n- after\n');
for (let k = 0; k < 4; k++) write(`pages/Mention ${k}.md`, `- line ${k} about [[Even]]\n\t- a sub-note ${k}\n- a mention of even here ${k}\n`);
write('pages/Even.md', '- the page every slide is tried on\n');
for (let k = 0; k < 6; k++) write(`pages/Chip ${k}.md`, `- about [[Chipful]], [[A longer page name ${k}]] and [[Another page called ${k}]]\n`);
write('pages/Chipful.md', '- a page whose references mention many pages\n');
for (const n of ['seeds', 'tools', 'beds']) write(`pages/Garden___${n}.md`, `- about ${n}\n`);
for (const n of ['a', 'b']) write(`pages/Zoo___${n}.md`, `- zoo ${n}\n`);
for (const n of ['Ochre', 'Umber', 'Sienna']) write(`pages/${n}.md`, 'tags:: [[Hue]]\n\n- a colour\n');
write('pages/Phone menu.md', '- a note with kids\n\t- kid one\n\t- kid two\n- next\n');

{
  console.log('1. a note folds and unfolds with a slide');
  const { browser, page, errors } = await open();
  await go(page, '#/page/Folding');
  await page.waitForSelector('.outline .blk');
  const fold = async () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.outline .blk')].find((b) => b.textContent.includes('parent'));
    row.querySelector(':scope > .fold').click();
    const kids = [...document.querySelectorAll('.outline .blk')].filter((b) => /child/.test(b.textContent));
    return { moving: kids.filter((b) => b.getAnimations().length).length, shown: kids.filter((b) => !b.hidden).length };
  });
  let m = await fold();
  check(m.moving >= 3 && m.shown >= 3, 'folding: the sub-notes stay on screen while they slide shut', JSON.stringify(m));
  await sleep(400);
  check(await page.evaluate(() => [...document.querySelectorAll('.outline .blk')].filter((b) => /child/.test(b.textContent)).every((b) => b.hidden && !b.style.overflow)), 'then they are hidden, nothing left clipped');
  m = await fold();
  check(m.moving >= 3, 'unfolding: they slide open', JSON.stringify(m));
  await sleep(400);
  check(await page.evaluate(() => [...document.querySelectorAll('.outline .blk')].filter((b) => /child/.test(b.textContent)).every((b) => !b.hidden && !b.getAnimations().length)), 'then they show, still');

  console.log('2. the references, the filter bar and a day slide open and shut');
  await go(page, '#/page/Sourdough Bread');
  await page.waitForSelector('.sec:not(.unlinked) > .sec-h .disclose');
  await sleep(600);
  const sl = await page.evaluate(() => {
    const sec = document.querySelector('.sec:not(.unlinked)');
    sec.querySelector('.sec-h .disclose').click();
    return { moving: sec.getAnimations().length > 0, kids: getComputedStyle(sec.querySelector('.refs-list, .refgrp') ?? sec).display };
  });
  check(sl.moving && sl.kids !== 'none', 'closing the linked references: they slide shut (still shown meanwhile)', JSON.stringify(sl));
  await sleep(400);
  check(await page.evaluate(() => document.querySelector('.sec:not(.unlinked)').classList.contains('shut')), 'then they are closed');
  await page.evaluate(() => document.querySelector('.sec:not(.unlinked) .sec-h .disclose').click());
  await sleep(400);
  const fb = await page.evaluate(() => {
    document.querySelector('.ref-f').click();
    const bar = document.querySelector('.ref-tools');
    return { shown: !bar.hidden, moving: bar.getAnimations().length > 0 };
  });
  check(fb.shown && fb.moving, 'the filter bar slides open', JSON.stringify(fb));
  await sleep(400);
  const fb2 = await page.evaluate(() => { document.querySelector('.ref-f').click(); const bar = document.querySelector('.ref-tools'); return { shown: !bar.hidden, moving: bar.getAnimations().length > 0 }; });
  check(fb2.shown && fb2.moving, 'and slides shut', JSON.stringify(fb2));
  await sleep(400);
  check(await page.evaluate(() => document.querySelector('.ref-tools').hidden), 'then it is gone');
  await go(page, '#/journals');
  await page.waitForSelector('.sheet.day .day-fold');
  await sleep(500);
  const day = await page.evaluate(() => { const s = document.querySelector('.sheet.day'); s.querySelector('.day-fold').click(); return s.getAnimations().length > 0; });
  check(day, 'a day folds with a slide');
  await sleep(400);
  check(await page.evaluate(() => document.querySelector('.sheet.day').classList.contains('folded')), 'then it is folded');
  await page.evaluate(() => document.querySelector('.sheet.day .day-fold').click());
  await sleep(300);

  console.log('4. the quiet days: lines that split open, arrows where there are more days');
  await page.waitForSelector('#main .quiet .q-mark');
  const qs = await page.evaluate(() => [...document.querySelectorAll('#main .quiet')].map((q, k) => [k, q.querySelectorAll('.q-edge').length]));
  check(qs.length && qs.every(([, n]) => n === 2), 'each run has its two lines', JSON.stringify(qs));
  // a long run (the one between a year ago and March 2020)
  const long = await page.evaluate(() => {
    const q = [...document.querySelectorAll('#main .quiet')].at(-1);
    q.scrollIntoView({ block: 'center' });
    q.querySelector('.q-mark').click();
    return true;
  });
  await sleep(500);
  const st = await page.evaluate(() => {
    const q = [...document.querySelectorAll('#main .quiet')].at(-1);
    const [a, b] = q.querySelectorAll('.q-edge');
    // the day above: its own line (the sheet's divider) is the top one
    const day = q.previousElementSibling, rd = day.getBoundingClientRect(), cd = getComputedStyle(day), cb = getComputedStyle(b);
    const rb = b.getBoundingClientRect(), w = q.querySelector('.q-wheel').getBoundingClientRect();
    const op = (s) => +getComputedStyle(q.querySelector(s)).opacity;
    return { apart: Math.round(rb.top - rd.bottom), below: rb.top >= w.bottom - 1, topDrawn: getComputedStyle(a).display !== 'none',
      width: [Math.round(rb.left), Math.round(rb.width), Math.round(rd.left), Math.round(rd.width)],
      look: [cb.borderTopWidth, cb.borderTopStyle, cb.borderTopColor, cb.opacity], dayLine: [cd.borderBottomWidth, cd.borderBottomStyle, cd.borderBottomColor, '1'],
      up: op('.q-arrow.up'), down: op('.q-arrow.down') };
  });
  // (he asked, Nov 27: no extra highlight on the lines, and the bottom one as wide and as faint as the original)
  check(long && st.apart > 60 && st.below && !st.topDrawn, 'open: the day\'s own line stays at the +, a second one below the last date; nothing drawn over the first', JSON.stringify(st));
  check(st.width[0] === st.width[2] && st.width[1] === st.width[3] && JSON.stringify(st.look) === JSON.stringify(st.dayLine), 'the second line looks just like the day\'s own line: the full width, the same colour', JSON.stringify(st));
  check(st.down > 0.5 && st.up < 0.1, 'at the top: an arrow below (more days), none above', JSON.stringify(st));
  await page.evaluate(() => { const w = [...document.querySelectorAll('#main .q-wheel')].at(-1); w.scrollTop = 60; });
  await sleep(300);
  const st2 = await page.evaluate(() => { const q = [...document.querySelectorAll('#main .quiet')].at(-1); return { up: +getComputedStyle(q.querySelector('.q-arrow.up')).opacity }; });
  check(st2.up > 0.5, 'scrolled down a little: an arrow above too', JSON.stringify(st2));
  // (he asked, Nov 27) the marked date is the one in the middle of the wheel, in full view, at the top,
  // part way through and at the end of the run
  for (const to of [0, 'some', 'end']) {
    await page.evaluate((to) => { const w = [...document.querySelectorAll('#main .q-wheel')].at(-1); const r = w.firstElementChild.offsetHeight; w.scrollTop = to === 0 ? 0 : to === 'end' ? w.scrollHeight : r * 4 + 3; }, to);
    await sleep(400); // (it settles on a date: snap)
    const c = await page.evaluate(() => {
      const w = [...document.querySelectorAll('#main .q-wheel')].at(-1), wr = w.getBoundingClientRect();
      const ms = [...w.querySelectorAll('.q-day.mid')], m = ms[0]?.getBoundingClientRect();
      return { marked: ms.length, off: m ? Math.round(Math.abs(m.top + m.height / 2 - (wr.top + wr.height / 2))) : 99, inside: m ? m.top >= wr.top - 0.5 && m.bottom <= wr.bottom + 0.5 : false, k: [...w.children].findIndex((b) => b.classList.contains('mid')), n: w.children.length };
    });
    check(c.marked === 1 && c.off <= 1 && c.inside && (to !== 0 || c.k === 0) && (to !== 'end' || c.k === c.n - 1), `scrolled to ${to}: the marked date sits in the middle of the wheel, whole`, JSON.stringify(c));
  }
  await page.screenshot({ path: '/tmp/lean-ui-test/shots/t41-quiet.png' });
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}

{
  console.log('3. the note menu on a phone fits without scrolling');
  const { browser, page, errors } = await open({ viewport: { width: 390, height: 800 }, touch: true, look: 'thinky' });
  await go(page, '#/page/Phone menu');
  await page.waitForSelector('.outline .blk');
  await sleep(500);
  const ctx = page.context();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const dot = await page.locator('.outline .blk > .bul').nth(0).boundingBox();
  await touch('touchStart', dot.x + 7, dot.y + dot.height / 2); await sleep(650); await touch('touchEnd'); await sleep(500);
  const m = await page.evaluate(() => {
    const b = document.querySelector('.note-menu');
    return { h: b.offsetHeight, sh: b.scrollHeight, rows: [...b.querySelectorAll('.nm-main .nm-item')].map((x) => x.textContent.trim()), strip: b.querySelectorAll('.nm-strip .nm-item').length };
  });
  check(m.sh <= m.h + 1, 'nothing to scroll', JSON.stringify(m));
  // (he asked, Nov 27) the colours and headings wait behind one small button beside the filter
  const tuck = await page.evaluate(() => { const b = document.querySelector('.note-menu'), p = b.querySelector('.nm-style'), btn = b.querySelector('.pop-head .nm-style-btn'), r = b.getBoundingClientRect();
    return { panel: !!p && p.hidden, btn: !!btn && btn.getAttribute('aria-expanded'), h: Math.round(r.height), onScreen: r.top >= 0 && r.bottom <= innerHeight };
  });
  check(tuck.panel && tuck.btn === 'false' && tuck.onScreen && tuck.h < 330, 'the colours and headings are tucked behind a small button by the filter; the menu is short and whole on screen', JSON.stringify(tuck));
  await sleep(400);
  await page.locator('.note-menu .nm-style-btn').tap();
  const sl = await page.evaluate(() => { const p = document.querySelector('.note-menu .nm-style'); return { anim: p.getAnimations().length, shown: !p.hidden }; });
  await sleep(450);
  const op = await page.evaluate(() => { const b = document.querySelector('.note-menu'), r = b.getBoundingClientRect(); return { sw: b.querySelectorAll('.nm-style .nm-sw').length, hd: b.querySelectorAll('.nm-style .nm-h').length, onScreen: r.top >= 0 && r.bottom <= innerHeight + 0.5, scroll: b.scrollHeight - b.offsetHeight, exp: b.querySelector('.nm-style-btn').getAttribute('aria-expanded') }; });
  check(sl.anim === 1 && sl.shown && op.sw >= 5 && op.hd === 8 && op.exp === 'true', 'a tap on it: the colours and headings slide open under the filter', JSON.stringify({ sl, op }));
  check(op.onScreen && op.scroll <= 1, 'still all on screen, nothing to scroll', JSON.stringify(op));
  await page.screenshot({ path: '/tmp/lean-ui-test/shots/t41-phone-style.png' });
  await page.locator('.note-menu .nm-style-btn').tap();
  await sleep(450);
  check(await page.evaluate(() => document.querySelector('.note-menu .nm-style').hidden && !!document.querySelector('.note-menu')), 'a second tap tucks them away again; the menu stays open');
  check(m.strip === 3 && ['Cut', 'Copy', 'Copy link', 'Move to page…', 'Delete'].every((x) => m.rows.includes(x)), 'Cut, Copy and Copy link side by side; Move to page and Delete still there', JSON.stringify(m.rows));
  check(!m.rows.includes('Copy as text') && !m.rows.includes('Numbered list'), 'the rows used less are not in the menu itself', JSON.stringify(m.rows));
  check(await page.evaluate(() => !document.querySelector('.note-menu .nm-main .nm-sw:not(.nm-style .nm-sw)')), 'no colour dots in the menu itself');
  check(m.rows.filter((x) => /all$/.test(x)).length === 1, 'one Expand all / Collapse all row', JSON.stringify(m.rows));
  await page.screenshot({ path: '/tmp/lean-ui-test/shots/t41-phone-menu.png' });
  await sleep(400);
  const mb = await page.locator('.note-menu .nm-has-sub').boundingBox();
  await page.touchscreen.tap(mb.x + 20, mb.y + mb.height / 2);
  await sleep(300);
  const more = await page.evaluate(() => [...document.querySelectorAll('.note-menu .nm-alt .nm-item')].slice(0, 6).map((x) => x.textContent.trim()));
  check(more.some((x) => x.startsWith('Copy as text')) && more.some((x) => x.startsWith('Numbered list')), 'they are first in More commands…', JSON.stringify(more));
  await page.screenshot({ path: '/tmp/lean-ui-test/shots/t41-phone-more.png' });
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}
{
  console.log('3b. the laptop menu is as before');
  const { browser, page, errors } = await open();
  await go(page, '#/page/Phone menu');
  await page.waitForSelector('.outline .blk');
  await page.locator('.outline .blk').first().locator(':scope > .bul').click({ button: 'right' });
  await page.waitForSelector('.note-menu');
  const rows = await page.evaluate(() => [...document.querySelectorAll('.note-menu .nm-main .nm-item')].map((x) => x.querySelector('.nm-l').textContent));
  check(['Cut', 'Copy', 'Copy as text', 'Copy link to this note', 'Numbered list', 'Expand all', 'Collapse all'].every((x) => rows.includes(x)), 'all its rows, one per line', JSON.stringify(rows));
  check(await page.evaluate(() => !document.querySelector('.note-menu .nm-strip')), 'no side-by-side line');
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}
{
  // (he asked, Nov 27: every opening and closing as smooth as a note's arrow; the filter bar jittered, and
  // Fold all / Expand all didn't slide at all.) Each movement is stopped at its start, a quarter, half,
  // three quarters and its end (the page's own clock, so a slow machine can't miss frames), and where the
  // things below it stand is read each time: they move one way only, evenly, with no jump at the start
  // (before the movement) or at the end (after it, when it settles).
  console.log('5. every slide moves evenly: no jump at its start or end');
  const { browser, page, errors } = await open();
  // (the page forbids running code from text, so the movements and the things watched are picked by name)
  const sweep = (what, trigger, witness) => page.evaluate(([trigger, witness]) => new Promise((done) => {
    const q = (sel) => document.querySelector(sel);
    const blk = (start) => [...document.querySelectorAll('.outline .blk')].find((b) => b.textContent.trim().startsWith(start));
    const WIT = { // (each: the spot watched, in pixels from the top of the window)
      unlinked: () => q('#main .sec.unlinked').getBoundingClientRect().top,
      firstGroup: () => q('#main .sec:not(.unlinked) .refgrp').getBoundingClientRect().top,
      after: () => [...document.querySelectorAll('.outline .blk')].find((b) => b.textContent.trim() === 'after').getBoundingClientRect().top,
      recentEnd: () => q('#side .side-sec[data-sec="recent"]').getBoundingClientRect().bottom, // (the end of Recent)
      todoList: () => q('#main .todos').getBoundingClientRect().top, // (the to-dos under the filter)
      nsEnd: () => q('#main .tree-rows').getBoundingClientRect().bottom, // (the end of the Namespaces list)
    };
    const DO = {
      filter: () => q('#main .sec:not(.unlinked) .ref-f').click(),
      foldAll: () => q('#main .ref-fa').click(),
      linked: () => q('#main .sec:not(.unlinked) .sec-h .disclose').click(),
      collapse: () => window.leanApp.mainOutline().foldAll(true),
      expand: () => window.leanApp.mainOutline().foldAll(false),
      arrow: () => blk('parent').querySelector(':scope > .fold').click(),
      branch: () => window.leanApp.mainOutline().toggleBranch(0), // (a click on the thread line under "parent")
      recent: () => q('#side .side-sec[data-sec="recent"] .side-fold').click(),
      todoFilter: () => q('#main .todo-f').click(),
      garden: () => q('#main .ns-fold[data-ns="garden"]').click(),
    };
    try {
      const top = () => Math.round(WIT[witness]() * 10) / 10;
      const y0 = top();
      DO[trigger]();
      // only this movement's own animations: in the page, played once, at least 200 ms long
      const anims = document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming();
        // (a fold arrow's turn, a CSS transition, takes .3s either way and isn't what moves the page)
        return a.playState === 'running' && t && t.iterations === 1 && !(a instanceof CSSTransition) && t.duration >= 200 && t.duration <= 2000
          && document.querySelector('#app')?.contains(a.effect.target); // (the page, its sidebar too)
      });
      const D = Math.max(0, ...anims.map((a) => a.effect.getComputedTiming().duration));
      anims.forEach((a) => a.pause());
      const ys = [0, 0.25, 0.5, 0.75, 1].map((f) => { anims.forEach((a) => { a.currentTime = f * D - (f === 1 ? 1 : 0); }); return top(); });
      anims.forEach((a) => a.play());
      setTimeout(() => { try { done({ y0, ys, end: top(), n: anims.length, D }); } catch (e) { done({ error: String(e) }); } }, D + 250);
    } catch (e) { done({ error: String(e) }); }
  }), [trigger, witness]);
  const even = (what, r) => {
    if (r.error) { check(false, `${what}: slides, one way, no jump at its start or end`, r.error); return; }
    const all = [r.y0, ...r.ys, r.end], d = all.slice(1).map((y, k) => y - all[k]), tot = r.end - r.y0;
    const oneWay = d.every((x) => Math.abs(x) < 1.5 || Math.sign(x) === Math.sign(tot));
    check(r.n > 0 && Math.abs(tot) > 10 && Math.abs(r.ys[0] - r.y0) < 1.5 && Math.abs(r.end - r.ys[4]) < 2 && oneWay,
      `${what}: slides, one way, no jump at its start or end`, JSON.stringify(r));
  };
  await go(page, '#/page/Even');
  await page.waitForSelector('#main .sec:not(.unlinked) .refgrp');
  await sleep(500);
  even('the filter bar opening', await sweep('', 'filter', 'firstGroup'));
  even('the filter bar shutting', await sweep('', 'filter', 'firstGroup'));
  even('Fold all (the references)', await sweep('', 'foldAll', 'unlinked'));
  check(await page.evaluate(() => [...document.querySelectorAll('#main .sec:not(.unlinked) .refgrp')].every((g) => g.classList.contains('folded'))), 'then every group is folded');
  even('Open all', await sweep('', 'foldAll', 'unlinked'));
  even('Linked references shutting', await sweep('', 'linked', 'unlinked'));
  even('Linked references opening', await sweep('', 'linked', 'unlinked'));
  // Unlinked references open while thinky looks through the notes: the movement goes on to their real
  // height (groups out of view used to count as 80px until seen, and the rest jumped at the end)
  const un = await page.evaluate(() => new Promise((done) => {
    const sec = document.querySelector('#main .sec.unlinked'), body = sec.querySelector('.body');
    sec.querySelector('.disclose').click();
    const t0 = performance.now();
    const wait = () => {
      const a = body.getAnimations()[0];
      if (body.querySelector('.refgrp') && a) {
        a.pause(); a.currentTime = a.effect.getComputedTiming().duration - 1;
        const atEnd = body.offsetHeight;
        a.play();
        a.finished.then(() => setTimeout(() => done({ atEnd, settled: body.offsetHeight }), 100));
      } else if (performance.now() - t0 < 4000) requestAnimationFrame(wait); else done(null);
    };
    wait();
  }));
  check(un && un.settled > 100 && Math.abs(un.settled - un.atEnd) < 2, 'Unlinked references slide open to their real height, no jump at the end', JSON.stringify(un));
  await go(page, '#/page/Folding more');
  await page.waitForSelector('.outline .blk');
  await sleep(400);
  even('Collapse all (the notes)', await sweep('', 'collapse', 'after'));
  // (one level a press, as Logseq does: the deepest open level folds first)
  check(await page.evaluate(() => { const r = [...document.querySelectorAll('.outline .blk')]; return r.find((b) => b.textContent.trim() === 'grandchild').hidden && r.every((b) => !b.style.overflow && !b.style.height); }),
    'then the deepest sub-note is hidden, and nothing is left clipped');
  even('Expand all', await sweep('', 'expand', 'after'));
  even('a note\'s arrow shutting', await sweep('', 'arrow', 'after'));
  even('and opening', await sweep('', 'arrow', 'after'));
  // (he asked, Nov 27: a click on a thread line folded or opened all the notes under it in an instant)
  even('a thread line folding the notes under it', await sweep('', 'branch', 'after'));
  even('and opening them again', await sweep('', 'branch', 'after'));
  // On a phone the filter bar's page buttons are drawn while it is hidden, so all of them showed (four rows)
  // and the bar was measured that tall; trimmed to two rows ("N more") partway through, the box and
  // buttons jumped down, then the bar snapped up at the end (he saw a stutter, Nov 27). Now they fit first.
  await page.setViewportSize({ width: 390, height: 800 });
  await go(page, '#/page/Chipful');
  await page.waitForSelector('#main .sec:not(.unlinked) .refgrp');
  await sleep(500);
  await page.evaluate(() => document.querySelector('#main .sec:not(.unlinked) .ref-f').scrollIntoView({ block: 'start' }));
  await sleep(300);
  even('the filter bar opening on a phone, with many page buttons', await sweep('', 'filter', 'firstGroup'));
  const rows = await page.evaluate(() => { const cs = [...document.querySelectorAll('#main .ref-chips .chip')].filter((c) => !c.hidden); return { rows: new Set(cs.map((c) => c.offsetTop)).size, more: !document.querySelector('#main .ref-chips .ref-more').hidden }; });
  check(rows.rows <= 2 && rows.more, 'its page buttons fit in two rows, with "N more"', JSON.stringify(rows));
  // He asked (Nov 27): check every action for anything that opens or shuts in an instant. These did:
  // Favourites and Recent folding in the sidebar, the To-dos page's filter, a namespace in All pages,
  // and the message at the bottom (it now fades in and out).
  console.log('6. the rest that used to open or shut at once: sidebar lists, To-dos filter, namespaces, the message');
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const n of ['Folding', 'Even', 'Chipful', 'Phone menu']) await go(page, '#/page/' + encodeURIComponent(n)); // (some pages in Recent)
  await sleep(500);
  even('Recent folding in the sidebar', await sweep('', 'recent', 'recentEnd'));
  even('and opening again', await sweep('', 'recent', 'recentEnd'));
  check(await page.evaluate(() => [...document.querySelectorAll('#recent a')].some((a) => !a.hidden)), 'Recent shows its pages again');
  await go(page, '#/todos');
  await page.waitForSelector('#main .todo-f');
  await sleep(500);
  even('the To-dos filter opening', await sweep('', 'todoFilter', 'todoList'));
  even('and shutting', await sweep('', 'todoFilter', 'todoList'));
  await go(page, '#/pages');
  await page.waitForSelector('.pg-rows li');
  const tree = page.locator('.chips [data-o="tree"]');
  if (await tree.getAttribute('aria-pressed') !== 'true') await tree.click();
  await page.waitForSelector('#main .ns-fold[data-ns="garden"]');
  await sleep(300);
  even('a namespace opening', await sweep('', 'garden', 'nsEnd'));
  check(await page.locator('.tree-rows li .pg-name', { hasText: 'seeds' }).count() === 1, 'its pages show');
  even('and shutting', await sweep('', 'garden', 'nsEnd'));
  check(await page.locator('.tree-rows li .pg-name', { hasText: 'seeds' }).count() === 0, 'its pages are gone again');
  await tree.click(); // (back to the plain list, as other tests expect)
  // the message at the bottom: fades in, stays, fades out, then hides
  const t = await page.evaluate(() => new Promise((done) => {
    window.leanApp.toast('a short message', 500);
    const el = document.querySelector('#toast');
    const fadeIn = el.getAnimations().length > 0 && !el.hidden;
    setTimeout(() => {
      const fadingOut = !el.hidden && el.getAnimations().length > 0;
      setTimeout(() => done({ fadeIn, fadingOut, hiddenAfter: el.hidden }), 400);
    }, 560);
  }));
  check(t.fadeIn && t.fadingOut && t.hiddenAfter, 'the message fades in, then fades out before it hides', JSON.stringify(t));
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}
{
  // The rest of the Nov 27 check of every action: the tagged-pages filter (a finger's tap opens it without
  // the keyboard, Escape slides it shut like its button), the fold arrows turning with the slide, and the
  // sidebar and the phone drawer moving on the same gentle curve, for the same time, as every slide.
  console.log('7. the tagged-pages filter, the arrows, the sidebar and the drawer');
  const { browser, page, errors } = await open();
  await go(page, '#/page/Hue');
  await page.waitForSelector('.tagged-sec .ref-f');
  await page.locator('.tagged-sec .ref-f').click();
  await page.waitForSelector('.tagged-sec .ref-tools:not([hidden])');
  await sleep(400);
  check(await page.evaluate(() => document.activeElement?.classList.contains('ref-filter')), 'a click on the tagged pages\' filter button puts the cursor in its box');
  const esc = await page.evaluate(() => new Promise((done) => {
    const input = document.querySelector('.tagged-sec .ref-filter'), bar = document.querySelector('.tagged-sec .ref-tools');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const during = { shown: !bar.hidden, moving: bar.getAnimations().length > 0 };
    setTimeout(() => done({ ...during, hiddenAfter: bar.hidden }), 450);
  }));
  check(esc.shown && esc.moving && esc.hiddenAfter, 'Escape in it: the bar slides shut (still shown meanwhile), then it is gone', JSON.stringify(esc));
  // the arrows: each turns in .3s on the slides' curve (they used to snap round in .12s)
  const arrows = await page.evaluate(() => {
    const want = (sel, pseudo) => { const e = document.querySelector(sel); if (!e) return sel + ' missing'; const cs = getComputedStyle(e, pseudo); return cs.transitionDuration + ' ' + cs.transitionTimingFunction; };
    return [want('#main .disclose', '::before'), want('#side .side-h.side-fold', '::after')];
  });
  check(arrows.every((a) => a === '0.3s cubic-bezier(0.45, 0, 0.2, 1)'), 'the fold arrows turn in .3s, on the same curve as the slides', JSON.stringify(arrows));
  // the sidebar (laptop) and the drawer (phone): their rules in the stylesheet, whatever the window's size
  const rules = await page.evaluate(() => {
    const all = [];
    const walk = (list) => { for (const r of list) { if (r.cssRules) walk(r.cssRules); if (r.selectorText) all.push([r.selectorText, r.style.transition]); } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* another site's sheet */ } }
    const of = (sel) => all.filter(([t]) => t === sel).map(([, v]) => v).filter(Boolean);
    return { side: of('html.sliding #side'), drawer: of('body.drawer #side') };
  });
  const gentle = (v) => /0\.3s/.test(v) && /cubic-bezier\(0\.45, 0, 0\.2, 1\)/.test(v);
  check(rules.side.length > 0 && rules.side.every(gentle), 'the laptop sidebar slides in .3s on the gentle curve', JSON.stringify(rules.side));
  check(rules.drawer.length > 0 && rules.drawer.every(gentle), 'the phone drawer slides in .3s on the gentle curve', JSON.stringify(rules.drawer));
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}
{
  console.log('7b. on a phone: a tap on the tagged pages\' filter button opens it without the keyboard');
  const { browser, page, errors } = await open({ touch: true, viewport: { width: 390, height: 800 } });
  await go(page, '#/page/Hue');
  await page.waitForSelector('.tagged-sec .ref-f');
  await page.locator('.tagged-sec .ref-f').tap();
  await page.waitForSelector('.tagged-sec .ref-tools:not([hidden])');
  await sleep(400);
  const f = await page.evaluate(() => ({ focused: document.activeElement?.classList.contains('ref-filter') }));
  check(!f.focused, 'the box opens without a cursor (no keyboard over the page)', JSON.stringify(f));
  check(errors.length === 0, 'no errors', errors.join(' | '));
  await browser.close();
}
if (failures()) process.exit(1);

// The Nov 23 audit's interface fixes, and the Nov 22 review's interface fixes made the same morning, in a
// real browser:
//  - audit 3: Undo / Redo with notes selected leaves no note selected (the selection was kept by place,
//    so Delete after Undo could delete a note that wasn't picked);
//  - audit 6: the Journals list moves on to the new day after midnight (coming back to the app, a file
//    notice, once a minute), not while a day is in use; the phone's "+" adds to the new day;
//  - audit 9: tags:: and alias:: values split only at commas outside [[ ]];
//  - audit 10: a page whose name ends in "." or ":" is written #[[…]] by the # list and by paste; the
//    filter buttons of Linked references and To-dos read #v1.2 as "v1.2";
//  - review R9: arrow keys under a folded note with thousands of notes under it are quick, and find /
//    "Show attachments" fold away again what they showed;
//  - review R11a/b/c: boxes keep the keyboard inside and give it back; a focused button keeps Tab, Enter
//    and Space with notes selected; the full-size picture closes with Esc and holds Tab;
//  - review L6 / R6: a file notice just after the app's own save waits ~1.5 s (one check for a burst),
//    coming back to the app checks after ~200 ms, never more than 5 s late; the phone's widget is
//    redrawn only by a save of today's journal.
// (The rules alone, without a browser: unit.mjs.)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { open, check, failures, go, sleep, write, read, readWhen, editBlock, BASE, VAULT } from './lib.mjs';
import fs from 'node:fs';

const { browser, page, errors } = await open();
/** One part of the test: its title, then its steps; a part that stops on an error is a failure, and the
 *  next part still runs. */
async function section(title, steps) {
  if (process.env.T36_ONLY && !new RegExp(process.env.T36_ONLY).test(title)) return; // (T36_ONLY: run only the parts it names)
  console.log(title);
  try { await steps(); } catch (e) { check(false, 'this part stopped', String(e?.message || e).split('\n')[0]); }
}
const rows = () => page.locator('#main .outline .blk > .bc').evaluateAll((bs) => bs.map((b) => b.textContent.trim()));
const picked = () => page.locator('#main .outline .blk.sel > .bc').evaluateAll((bs) => bs.map((b) => b.textContent.trim()));

// ---------------------------------------------------------------------------------------------------
// (a page of its own for each part, so one part going wrong doesn't spill into the next)
const fresh = async (name, text) => {
  write(`pages/${name}.md`, text);
  await go(page, '#/page/' + encodeURIComponent(name));
  await page.waitForSelector('#main .outline .blk');
};
const selectOnly = async (text) => { await editBlock(page, text); await page.keyboard.press('Escape'); await sleep(150); };
const noSel = () => page.evaluate(() => window.leanApp.pane.outlines[0].sel === null);

await section('audit 3: Undo with notes selected: no note is left selected', async () => {
  await fresh('Audit Sel', '- Alpha\n- Bravo\n- Charlie\n');
  await selectOnly('Charlie');
  check(JSON.stringify(await picked()) === '["Charlie"]', '(Charlie is selected)', JSON.stringify(await picked()));
  await page.keyboard.press('Control+Shift+ArrowUp'); // moved above Bravo, still selected
  await sleep(200);
  check(JSON.stringify(await rows()) === '["Alpha","Charlie","Bravo"]' && JSON.stringify(await picked()) === '["Charlie"]', '(moved up, still selected)', JSON.stringify([await rows(), await picked()]));
  await page.keyboard.press('Control+z');
  await sleep(200);
  check(JSON.stringify(await rows()) === '["Alpha","Bravo","Charlie"]', 'Ctrl+Z puts it back', JSON.stringify(await rows()));
  check(JSON.stringify(await picked()) === '[]', 'and no note is selected (not Bravo, now in its old place)', JSON.stringify(await picked()));
  check(await noSel(), 'the editor holds no selection either');
  await page.keyboard.press('Delete'); // nothing selected: nothing goes
  await page.keyboard.press('Tab');
  await sleep(1200);
  const f = read('pages/Audit Sel.md');
  check(/- Alpha\n- Bravo\n- Charlie/.test(f), 'Delete and Tab after Undo change nothing (before: Bravo was deleted)', f);
});

await section('audit 3: Redo with notes selected', async () => {
  await fresh('Audit Redo', '- Alpha\n- Bravo\n- Charlie\n');
  await selectOnly('Charlie');
  await page.keyboard.press('Control+Shift+ArrowUp');
  await sleep(200);
  await page.keyboard.press('Control+z'); // back to Alpha, Bravo, Charlie
  await sleep(200);
  await page.keyboard.press('Escape'); // (a selection left over, old code: let go)
  await selectOnly('Bravo'); // Bravo selected (the 2nd place)
  check(JSON.stringify(await picked()) === '["Bravo"]', '(Bravo is selected)', JSON.stringify(await picked()));
  await page.keyboard.press('Control+Shift+z'); // the move again: Alpha, Charlie, Bravo
  await sleep(200);
  check(JSON.stringify(await rows()) === '["Alpha","Charlie","Bravo"]', 'Ctrl+Shift+Z does the move again', JSON.stringify(await rows()));
  check(JSON.stringify(await picked()) === '[]' && await noSel(), 'and no note is selected (not Charlie, now in the 2nd place)', JSON.stringify(await picked()));
  await page.keyboard.press('Control+z');
  await sleep(200);
  await selectOnly('Alpha');
  await page.keyboard.press('Control+y'); // Ctrl+Y redoes too
  await sleep(200);
  check(JSON.stringify(await rows()) === '["Alpha","Charlie","Bravo"]' && await noSel(), 'Ctrl+Y the same', JSON.stringify(await rows()));
});

await section('audit 3: a new note selected, then Undo: the selection doesn’t point past the end', async () => {
  await fresh('Audit New', '- Alpha\n- Bravo\n- Charlie\n');
  await editBlock(page, 'Charlie');
  await page.keyboard.press('Enter'); // a new empty note after Charlie
  await page.keyboard.type('Delta');
  await page.keyboard.press('Escape'); // Delta selected (the 4th place)
  await sleep(150);
  check(JSON.stringify(await picked()) === '["Delta"]', '(Delta is selected)', JSON.stringify(await picked()));
  const before = errors.length;
  for (let k = 0; k < 4 && (await rows()).includes('Delta'); k++) { await page.keyboard.press('Control+z'); await sleep(150); }
  const left = await rows();
  check(!left.some((t) => /Delta/.test(t)), '(Undo took Delta away)', JSON.stringify(left));
  check(await page.evaluate(() => { const o = window.leanApp.pane.outlines[0]; return o.sel === null || (o.sel.a < o.blocks.length && o.sel.b < o.blocks.length); }), 'no selection past the last note');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');
  await sleep(300);
  check(errors.length === before, 'the next keys throw nothing', errors.slice(before).join(' | '));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // the audit's own steps: a note made with the faint "+" after the last note (not while typing), selected,
  // then Undo: the selection pointed at a 4th note that no longer exists, and the next key threw
  await fresh('Audit Plus', '- Alpha\n- Bravo\n- Charlie\n');
  await page.evaluate(() => window.leanApp.pane.outlines[0].addEnd.click()); // (it shows faintly on hover)
  await page.waitForSelector('#main textarea.ed');
  await page.keyboard.press('Escape'); // the new, empty note selected
  await sleep(150);
  check(await page.evaluate(() => window.leanApp.pane.outlines[0].sel?.b === 3), '(the new 4th note is selected)', await page.evaluate(() => JSON.stringify(window.leanApp.pane.outlines[0].sel)));
  await page.keyboard.press('Control+z');
  await sleep(200);
  check(JSON.stringify(await rows()) === '["Alpha","Bravo","Charlie"]', '(Undo took it away)', JSON.stringify(await rows()));
  check(await noSel(), 'no selection left pointing past the last note', await page.evaluate(() => JSON.stringify(window.leanApp.pane.outlines[0].sel)));
  const before2 = errors.length;
  for (const k of ['Tab', 'Shift+Tab', 'ArrowUp', 'Enter', 'Delete']) await page.keyboard.press(k);
  await sleep(300);
  check(errors.length === before2, 'Tab, Shift+Tab, ↑, Enter and Delete then throw nothing', errors.slice(before2).join(' | '));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await sleep(1200);
  check(/- Alpha\n- Bravo\n- Charlie/.test(read('pages/Audit Plus.md')) || !fs.existsSync(VAULT + '/pages/Audit Plus.md'), '(and the page is as it was)', read('pages/Audit Plus.md'));
});

await section('audit 3: the page read again under a selection', async () => {
  await fresh('Audit Reread', '- Alpha\n- Bravo\n- Charlie\n');
  await selectOnly('Charlie'); // the 3rd place
  // a note added above it elsewhere, then the page read again by force (as after the clash screen, or a
  // move of notes that met a clash): Charlie is now 4th, Bravo 3rd
  write('pages/Audit Reread.md', '- Zero\n- Alpha\n- Bravo\n- Charlie\n');
  await page.evaluate(() => window.leanApp.pane.outlines[0].reload(true));
  await sleep(300);
  check(JSON.stringify(await rows()) === '["Zero","Alpha","Bravo","Charlie"]', '(read again)', JSON.stringify(await rows()));
  check(JSON.stringify(await picked()) === '[]' && await noSel(), 'nothing selected (not Bravo, now in the 3rd place)', JSON.stringify(await picked()));
  await page.keyboard.press('Delete');
  await sleep(1200);
  check(read('pages/Audit Reread.md').includes('- Bravo'), 'Delete then takes nothing away', read('pages/Audit Reread.md'));
});

// ---------------------------------------------------------------------------------------------------
await section('audit 9: tags:: and alias:: with a comma inside [[ ]]', async () => {
  write('pages/Audit Tags.md', '- trip notes\n  tags:: [[New York, NY]], travel\n- other names\n  alias:: NYC, [[Big Apple, The]]\n');
  await go(page, '#/page/Audit%20Tags');
  await page.waitForSelector('#main .props a.pl');
  const links = await page.locator('#main .props a.pl').evaluateAll((as) => as.map((a) => a.dataset.page));
  check(JSON.stringify(links) === '["New York, NY","travel","NYC","Big Apple, The"]', 'each value is one link, the comma inside [[ ]] kept in its name', JSON.stringify(links));
  const shown = await page.locator('#main .props .pv').first().textContent();
  check(shown === 'New York, NY, travel', 'shown as two names, no brackets', shown);
  await page.locator('#main .props a.pl', { hasText: 'New York, NY' }).click();
  await sleep(500);
  const hash = decodeURIComponent(await page.evaluate(() => location.hash));
  check(hash === '#/page/New York, NY', 'a click opens “New York, NY” (not “[[New York”)', hash);
});

// ---------------------------------------------------------------------------------------------------
await section('audit 10: picking a page whose name ends in "." or ":" from the # list', async () => {
  write('pages/audit us.md', 'title:: U.S.\n\n- about the country\n');
  write('pages/audit time.md', 'title:: Due:\n\n- a page named with a colon at its end\n');
  write('pages/audit version.md', 'title:: v1.2\n\n- a release\n');
  write('pages/Audit Hash.md', '- start here\n');
  await page.evaluate(() => window.leanApp.rescan());
  await page.evaluate(() => window.leanApp.refreshNames());
  await go(page, '#/page/Audit%20Hash');
  const pick = async (typed, name) => {
    await editBlock(page, 'start here');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('x ' + typed);
    const item = page.locator('#ac .ac-item, #ac li', { hasText: name }).first();
    const shows = await item.waitFor({ timeout: 3000 }).then(() => true, () => false);
    if (!shows) return '(no list) ' + await page.locator('#ac').innerText().catch(() => '');
    // the list's own Enter picks the highlighted one: move to the right one first
    for (let k = 0; k < 10; k++) {
      const on = await page.locator('#ac .on, #ac [aria-selected="true"]').first().textContent().catch(() => '');
      if (on.trim().startsWith(name)) break;
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Enter');
    await sleep(100);
    const v = await page.locator('textarea.ed').inputValue();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('start here');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    return v;
  };
  const us = await pick('#U.S', 'U.S.');
  check(us === 'x #[[U.S.]]', '“U.S.” goes in as #[[U.S.]] (#U.S. would tag “U.S”)', us);
  const due = await pick('#Due', 'Due:');
  check(due === 'x #[[Due:]]', '“Due:” goes in as #[[Due:]]', due);
  const ver = await pick('#v1.', 'v1.2');
  check(ver === 'x #v1.2', '“v1.2” (a "." inside it) stays bare: #v1.2', ver);
  const sb = await pick('#Sourdough', 'Sourdough Bread');
  check(sb === 'x #[[Sourdough Bread]]', 'a name with a space: #[[…]] as before', sb);
  // what went in reads back as the page picked
  await editBlock(page, 'start here');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('see #[[U.S.]] and #v1.2 and #[[Due:]]');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await sleep(200);
  const tags = await page.locator('#main .outline a.tag').evaluateAll((as) => as.map((a) => a.dataset.page));
  check(JSON.stringify(tags) === '["U.S.","v1.2","Due:"]', 'and each links to the page picked', JSON.stringify(tags));
});

await section('audit 10: pasting a copied tag of a page whose name ends in "."', async () => {
  const out = await page.evaluate(async () => {
    const { htmlToNotes } = await import('/paste.js');
    const t = (name) => `<a class="tag" data-page="${name}" href="#"><span class="hash">#</span>${name}</a>`;
    const html = `<p>see ${t('U.S.')} and ${t('Due:')} and ${t('v1.2')} and ${t('New York')} and <a class="pl" data-page="U.S." href="#">U.S.</a></p>`;
    return JSON.stringify(htmlToNotes(html));
  });
  check(out.includes('#[[U.S.]]') && out.includes('#[[Due:]]') && out.includes('#v1.2 ') && out.includes('#[[New York]]') && out.includes('[[U.S.]]'), 'the tags come in as #[[U.S.]], #[[Due:]], #v1.2, #[[New York]]; a page link as [[U.S.]]', out);
  check(!/#U\.S\.[^\]]/.test(out), 'never as #U.S.', out);
  // through the editor's own paste, as from another window of the app
  await editBlock(page, 'see #');
  await page.keyboard.press('Control+a');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<meta charset="utf-8"><span>about <a class="tag" data-page="U.S." href="#"><span class="hash">#</span>U.S.</a> today</span>');
    dt.setData('text/plain', 'about #U.S. today');
    document.querySelector('textarea.ed').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(400);
  const v = await page.locator('textarea.ed').inputValue().catch(() => '');
  check(v.includes('#[[U.S.]]'), 'pasted into a note: #[[U.S.]]', v);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

await section('audit 10: the filter buttons read #v1.2 as “v1.2”', async () => {
  write('pages/Audit Release.md', '- the release page\n');
  // (two pages link to it: the filter buttons show from two groups of references)
  write('pages/Audit Log.md', '- [[Audit Release]] shipped #v1.2 today\n- TODO check #v1.2 notes\n');
  write('pages/Audit Plan.md', '- [[Audit Release]] planned #v1.3.\n- [[Audit Release]] see #U.S. rules\n');
  await page.evaluate(() => window.leanApp.rescan());
  await go(page, '#/page/Audit%20Release');
  await page.waitForSelector('section.sec:not(.unlinked) .refgrp');
  const linked = () => page.locator('section.sec:not(.unlinked)').filter({ hasText: /^Linked references/ });
  await linked().locator('.ref-f').click();
  await sleep(300);
  const chips = await linked().locator('.ref-chip').evaluateAll((cs) => cs.map((c) => c.firstChild.textContent.trim()));
  check(chips.includes('v1.2') && chips.includes('v1.3') && chips.includes('U.S'), 'buttons “v1.2”, “v1.3” (its "." the sentence’s) and “U.S”, as the tags are drawn', JSON.stringify(chips));
  check(!chips.includes('v1') && !chips.includes('U'), 'not “v1” or “U” (pages that don’t exist)', JSON.stringify(chips));
  await linked().locator('.ref-chip', { hasText: 'v1.2' }).click();
  await sleep(400);
  const shown = await linked().locator('.refgrp').evaluateAll((gs) => gs.map((g) => [g.dataset.page, g.textContent]));
  check(shown.length === 1 && shown[0][0] === 'Audit Log' && /shipped/.test(shown[0][1]), 'a click shows only the references tagged #v1.2', JSON.stringify(shown));

  await go(page, '#/todos');
  await page.waitForSelector('.todo-item');
  if (await page.locator('.todo-f').getAttribute('aria-expanded') !== 'true') await page.locator('.todo-f').click();
  await sleep(300);
  await page.locator('.chip-find-in').fill('v1');
  await sleep(300);
  const tchips = await page.locator('.todo-chips .ref-chip:not([hidden])').evaluateAll((cs) => cs.map((c) => c.firstChild.textContent.trim()));
  check(tchips.includes('v1.2') && !tchips.includes('v1'), 'To-dos: a “v1.2” button too', JSON.stringify(tchips));
  await page.locator('.todo-chips .ref-chip', { hasText: 'v1.2' }).click();
  await sleep(300);
  const items = await page.locator('.todo-item').evaluateAll((xs) => xs.map((x) => x.textContent));
  check(items.length === 1 && /check/.test(items[0]), 'a click shows only that to-do', JSON.stringify(items));
  await page.locator('.chip-find-in').fill('');
  await page.locator('.todo-chips .ref-chip.picked .chip-x').click().catch(() => {});
  if (await page.locator('.todo-f').getAttribute('aria-expanded') === 'true') await page.locator('.todo-f').click();
});

// ---------------------------------------------------------------------------------------------------
await section('review R9: arrow keys under a folded note with 3,000 notes under it', async () => {
  const kids = Array.from({ length: 3000 }, (_, k) => `\t- child ${k}${k === 1500 ? ' [doc](../assets/paper.pdf)' : ''}${k === 2500 ? ' needle2500' : ''}${k % 50 === 0 ? `\n\t\t- grandchild ${k}` : ''}`);
  write('pages/Audit Fold.md', `- Top\n- Folded\n  collapsed:: true\n${kids.join('\n')}\n- After\n`);
  await go(page, '#/page/Audit%20Fold');
  await page.waitForSelector('#main .outline .blk');
  await sleep(500);
  const vis = await page.locator('#main .outline .blk:not([hidden]) > .bc').evaluateAll((bs) => bs.filter((b) => b.offsetParent).map((b) => b.textContent.trim()));
  check(JSON.stringify(vis) === '["Top","Folded","After"]', '(three notes show; 3,000 are folded away)', JSON.stringify(vis).slice(0, 200));
  // in the page itself, so only the key's own work is timed: Down from Folded, Up from After, ten times
  const r = await page.evaluate(() => {
    const o = window.leanApp.pane.outlines[0];
    const at = (t) => o.blocks.findIndex((b) => b.text.split('\n')[0] === t);
    const key = (k) => {
      const ta = o.ta;
      ta.setSelectionRange(k === 'ArrowDown' ? ta.value.length : 0, k === 'ArrowDown' ? ta.value.length : 0);
      const t0 = performance.now();
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      return performance.now() - t0;
    };
    o.edit(at('Folded'), 'end');
    const times = [], went = [];
    for (let n = 0; n < 10; n++) {
      times.push(key('ArrowDown')); went.push(o.blocks[o.cur].text);
      times.push(key('ArrowUp')); went.push(o.blocks[o.cur].text.split('\n')[0]);
    }
    o.stopEdit();
    // the same with the note selected (no editing box): ↓ and ↑ move the selection
    o.select(at('Folded'));
    const stimes = [], swent = [];
    for (let n = 0; n < 10; n++) {
      for (const k of ['ArrowDown', 'ArrowUp']) {
        const t0 = performance.now();
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        stimes.push(performance.now() - t0);
        swent.push(o.blocks[o.sel.b].text.split('\n')[0]);
      }
    }
    o.clearSel();
    // and the two helpers alone
    const t1 = performance.now();
    for (let n = 0; n < 20; n++) o.nextVisible(at('Folded'));
    const helper = (performance.now() - t1) / 20;
    return { times, went, stimes, swent, helper };
  });
  const worst = Math.max(...r.times), sworst = Math.max(...r.stimes);
  const mid = (xs) => [...xs].sort((x, y) => x - y)[xs.length >> 1]; // the middle time (one slow press aside)
  check(r.went.every((t, k) => t === (k % 2 ? 'Folded' : 'After')), '↓ from Folded lands on After, ↑ from After on Folded (each time)', JSON.stringify(r.went.slice(0, 4)));
  check(worst < 50, `↓ / ↑ while typing: each under 50 ms (the slowest: ${worst.toFixed(1)} ms)`, r.times.map((t) => t.toFixed(1)).join(' '));
  check(r.swent.every((t, k) => t === (k % 2 ? 'Folded' : 'After')), 'with the note selected: ↓ / ↑ move the selection past the folded notes too', JSON.stringify(r.swent.slice(0, 4)));
  check(sworst < 50, `and each under 50 ms (the slowest: ${sworst.toFixed(1)} ms)`, r.stimes.map((t) => t.toFixed(1)).join(' '));
  check(mid(r.times) < 15 && mid(r.stimes) < 15, `most presses under 15 ms (typing ${mid(r.times).toFixed(1)} ms, selected ${mid(r.stimes).toFixed(1)} ms; before the fix ~20–40 ms)`);
  check(r.helper < 10, `the next shown note is worked out in under 10 ms (${r.helper.toFixed(2)} ms)`);
  // a real key press, end to end
  await editBlock(page, 'Folded');
  const t0 = Date.now();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('textarea.ed')?.value === 'After', null, { timeout: 3000 }).catch(() => {});
  const ms = Date.now() - t0;
  check(await page.locator('textarea.ed').inputValue() === 'After' && ms < 300, `a real ↓ press: on After in ${ms} ms`, ms);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  console.log('review R9: find and "Show attachments" fold away again what they showed');
  const shownRow = (word) => page.evaluate((w) => {
    const o = window.leanApp.pane.outlines[0];
    const i = o.blocks.findIndex((b) => b.text.includes(w));
    const div = o.blockDiv(i);
    return div ? !div.hidden : null; // null: not drawn at all (folded away too)
  }, word);
  await page.evaluate(() => window.leanApp.find.open());
  await page.keyboard.type('needle2500');
  await sleep(600);
  if (!(await shownRow('needle2500'))) { await page.keyboard.press('Enter'); await sleep(300); }
  check(await shownRow('needle2500') === true, 'find shows the note from inside the folded note');
  check(await shownRow('child 2499') !== true, '(only that one)');
  const tf = Date.now();
  await page.evaluate(() => window.leanApp.find.close());
  check(await shownRow('needle2500') !== true, 'closing find folds it away again', await shownRow('needle2500'));
  check(Date.now() - tf < 1000, '(quickly)', Date.now() - tf);
  // the same with a second match in the same page: both fold away again
  await page.evaluate(() => window.leanApp.find.open());
  await page.keyboard.press('Control+a');
  await page.keyboard.type('grandchild 2');
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.evaluate(() => window.leanApp.find.close());
  const any = await page.evaluate(() => {
    const o = window.leanApp.pane.outlines[0];
    const top = o.blocks.findIndex((b) => b.text.startsWith('Folded'));
    let n = 0;
    for (let j = top + 1; j < o.blocks.length - 1; j++) { const d = o.blockDiv(j); if (d && !d.hidden) n++; }
    return n;
  });
  check(any === 0, 'after stepping through several matches: none left showing', any);
  await page.evaluate(() => window.leanApp.showAttachments());
  await sleep(600);
  check(await shownRow('paper.pdf') === true, '"Show attachments" shows the note with a file from inside the folded note');
  await page.evaluate(() => window.leanApp.attach.close());
  await sleep(100);
  check(await shownRow('paper.pdf') !== true, 'clearing it folds that note away again');
  const f = read('pages/Audit Fold.md');
  check(f.includes('collapsed:: true') && f.split('\n').length >= 3060, '(the file is as it was: still folded)', f.length);
});

// ---------------------------------------------------------------------------------------------------
await section('review R11a: boxes (delete, rename, confirm) keep and give back the keyboard', async () => {
  await go(page, '#/page/Audit%20Sel');
  const more = page.locator('#main [data-a="more"]').first();
  await more.focus();
  const inBox = () => page.evaluate(() => !!document.activeElement?.closest('.modal'));
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a?.dataset?.v ?? a?.tagName ?? ''; });
  await page.evaluate(async () => { const { confirmBox } = await import('/popups.js'); window.__got = 'open'; confirmBox({ title: 'Delete this page?', body: 'It goes to the bin.', ok: 'Delete', danger: true }).then((v) => { window.__got = v; }); });
  await page.waitForSelector('.modal');
  const named = await page.evaluate(() => { const b = document.querySelector('.modal'); const id = b.getAttribute('aria-labelledby'); const h = id && document.getElementById(id); return { role: b.getAttribute('role'), modal: b.getAttribute('aria-modal'), id, inside: !!h && b.contains(h), text: h?.textContent }; });
  check(named.role === 'dialog' && named.modal === 'true', 'a dialog, modal', JSON.stringify(named));
  check(named.inside && named.text === 'Delete this page?', 'named by its heading (aria-labelledby)', JSON.stringify(named));
  check(await focused() === '0', 'a Delete box starts on Cancel', await focused());
  await page.keyboard.press('Tab');
  check(await focused() === '1' && await inBox(), 'Tab: Delete', await focused());
  await page.keyboard.press('Tab');
  check(await focused() === '0' && await inBox(), 'Tab again: round to Cancel, not the page behind', await focused());
  await page.keyboard.press('Shift+Tab');
  check(await focused() === '1' && await inBox(), 'Shift+Tab: round the other way, to Delete', await focused());
  await page.keyboard.press('Shift+Tab');
  check(await focused() === '0' && await inBox(), 'Shift+Tab again: Cancel', await focused());
  for (let k = 0; k < 5; k++) await page.keyboard.press('Tab');
  check(await inBox(), 'five more Tabs: still in the box');
  await page.keyboard.press('Shift+Tab'); // (on Cancel: 5 Tabs from Cancel end on Delete, back one)
  await page.keyboard.press('Enter'); // Enter on Cancel
  await sleep(100);
  check(await page.evaluate(() => window.__got) === false && !(await page.locator('.modal').count()), 'Enter on Cancel: no, the box closes', await page.evaluate(() => window.__got));
  check(await page.evaluate(() => document.activeElement?.dataset?.a === 'more'), 'the keyboard is back on the button it was on');

  // an ordinary box starts on OK; Esc says no and gives the keyboard back
  await more.focus();
  await page.evaluate(async () => { const { confirmBox } = await import('/popups.js'); window.__got = 'open'; confirmBox({ title: 'Go on?', ok: 'Yes' }).then((v) => { window.__got = v; }); });
  await page.waitForSelector('.modal');
  check(await focused() === '1', 'an ordinary box starts on OK', await focused());
  await page.keyboard.press('Escape');
  await sleep(100);
  check(await page.evaluate(() => window.__got) === false && !(await page.locator('.modal').count()), 'Esc: no, the box closes');
  check(await page.evaluate(() => document.activeElement?.dataset?.a === 'more'), 'the keyboard is back on the button');
  check(!(await page.locator('textarea.ed').count()) && JSON.stringify(await picked()) === '[]', '(and Esc did nothing to the page behind)', JSON.stringify([await rows(), await picked()]));

  // a box with a typing box: Tab goes round it and the buttons
  await more.focus();
  await page.evaluate(async () => { const { promptBox } = await import('/popups.js'); window.__got = 'open'; promptBox({ title: 'New name', value: 'abc' }).then((v) => { window.__got = v; }); });
  await page.waitForSelector('.modal input');
  check(await focused() === 'INPUT', 'a typing box starts in it', await focused());
  const order = [];
  for (let k = 0; k < 3; k++) { await page.keyboard.press('Tab'); order.push(await focused()); }
  check(order.join(',') === '0,1,INPUT', 'Tab: Cancel, OK, then back to the typing box', order.join(','));
  await page.keyboard.press('Shift+Tab');
  check(await focused() === '1', 'Shift+Tab from the typing box: OK', await focused());
  await page.locator('.modal [data-v="0"]').click();
  await sleep(100);
  check(await page.evaluate(() => window.__got) === null, 'Cancel: nothing');

  // a form with two typing boxes
  await page.evaluate(async () => { const { formBox } = await import('/popups.js'); formBox({ title: 'Two', fields: [{ label: 'A' }, { label: 'B' }] }).then((v) => { window.__got = v; }); });
  await page.waitForSelector('.modal input');
  const order2 = [];
  for (let k = 0; k < 4; k++) { await page.keyboard.press('Tab'); order2.push(await page.evaluate(() => document.activeElement?.dataset?.f ?? document.activeElement?.dataset?.v)); }
  check(order2.join(',') === '1,0,1,0' || order2.join(',') === '1,0,1,0', 'a form: A → B → Cancel → OK → A', order2.join(','));
  await page.keyboard.press('Escape');
  await sleep(100);

  // two boxes open at once: each heading has its own id
  const ids = await page.evaluate(async () => {
    const { confirmBox } = await import('/popups.js');
    confirmBox({ title: 'First' }); confirmBox({ title: 'Second' });
    const out = [...document.querySelectorAll('.modal')].map((b) => [b.getAttribute('aria-labelledby'), document.getElementById(b.getAttribute('aria-labelledby'))?.textContent]);
    document.querySelectorAll('.modal [data-v="0"]').forEach((b) => b.click());
    return out;
  });
  check(ids.length === 2 && ids[0][0] !== ids[1][0] && ids[0][1] === 'First' && ids[1][1] === 'Second', 'two boxes at once: each named by its own heading', JSON.stringify(ids));
  await sleep(100);

  // the real thing: the page menu's "Delete page…", from the keyboard
  await more.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pop.menu');
  await page.locator('.pop.menu li, .pop.menu [role="menuitem"]', { hasText: 'Delete page…' }).first().click();
  await page.waitForSelector('.modal');
  check(await focused() === '0' && /Delete this page/.test(await page.locator('.modal h2').textContent()), '“Delete page…”: its box starts on Cancel', await focused());
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  check(await inBox(), 'and keeps Tab inside');
  await page.keyboard.press('Escape');
  await sleep(200);
  check(fs.existsSync(VAULT + '/pages/Audit Sel.md') && !(await page.locator('.modal').count()), 'Esc: the page is still there');
  const back = await page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'body' : a?.dataset?.a || a?.className || a?.tagName; });
  check(back !== 'body', 'and the keyboard isn’t dropped on the page’s body', back);
});

// ---------------------------------------------------------------------------------------------------
await section('review R11b: a focused button or link keeps Tab, Enter and Space with notes selected', async () => {
  write('pages/Audit Keys.md', '- One\n- Two\n');
  await go(page, '#/page/Audit%20Keys');
  await page.waitForSelector('#main .outline .blk');
  const more = page.locator('#main [data-a="more"]').first();
  const depthOfTwo = () => page.evaluate(() => { const o = window.leanApp.pane.outlines[0]; return o.blocks.find((b) => b.text === 'Two').depth; });
  await editBlock(page, 'Two');
  await page.keyboard.press('Escape'); // Two selected
  await sleep(150);
  check(JSON.stringify(await picked()) === '["Two"]', '(Two is selected)');
  await more.focus();
  await page.keyboard.press('Tab');
  await sleep(200);
  check(await depthOfTwo() === 0, 'Tab on a focused button doesn’t indent the selected note', await depthOfTwo());
  check(await page.evaluate(() => document.activeElement?.dataset?.a !== 'more'), 'it moves the keyboard on, as Tab does');
  await more.focus();
  await page.keyboard.press('Shift+Tab');
  await sleep(200);
  check(await depthOfTwo() === 0, 'Shift+Tab on it: nothing outdented or moved', await depthOfTwo());
  await more.focus();
  await page.keyboard.press('Enter');
  await sleep(300);
  check(await page.locator('.pop.menu').count() === 1 && !(await page.locator('textarea.ed').count()), 'Enter presses the button (its menu opens), and no note opens for typing');
  await page.keyboard.press('Escape');
  await sleep(150);
  await more.focus();
  await page.keyboard.press(' ');
  await sleep(300);
  check(await page.locator('.pop.menu').count() === 1 && !(await page.locator('textarea.ed').count()), 'Space presses it too');
  await page.keyboard.press('Escape');
  await sleep(150);
  check(JSON.stringify(await picked()) === '["Two"]' || JSON.stringify(await picked()) === '[]', '(the selection was left alone, or let go by the menu)', JSON.stringify(await picked()));
  // with nothing focused, the keys act on the selected notes as before
  await editBlock(page, 'Two');
  await page.keyboard.press('Escape');
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur?.());
  await page.keyboard.press('Tab');
  await sleep(200);
  check(await depthOfTwo() === 1, 'no button focused: Tab indents the selected note as before', await depthOfTwo());
  await page.keyboard.press('Shift+Tab');
  await sleep(200);
  check(await depthOfTwo() === 0, 'and Shift+Tab outdents it');
  // a link that has the keyboard: Enter follows it, not the selected note
  check(JSON.stringify(await picked()) === '["Two"]', '(Two still selected)', JSON.stringify(await picked()));
  await page.locator('#side a[href="#/journals"]').first().focus();
  await page.keyboard.press('Enter');
  await sleep(500);
  check(/#\/journals/.test(await page.evaluate(() => location.hash)) && !(await page.locator('#main textarea.ed').count()), 'Enter on a focused link follows it (no note opened)', await page.evaluate(() => location.hash));
  await sleep(1000);
  check(/- One\n- Two/.test(read('pages/Audit Keys.md')), '(the page is as it was)', read('pages/Audit Keys.md'));
});

// ---------------------------------------------------------------------------------------------------
await section('review R11c: the full-size picture: a dialog, Esc closes it, Tab stays in it', async () => {
  await go(page, '#/page/Pictures');
  await page.waitForSelector('#main .outline img');
  await page.locator('#main .outline img').first().click();
  await page.waitForSelector('.lightbox');
  const box = await page.evaluate(() => { const b = document.querySelector('.lightbox'); return { role: b.getAttribute('role'), modal: b.getAttribute('aria-modal'), label: b.getAttribute('aria-label'), focus: document.activeElement === b }; });
  check(box.role === 'dialog' && box.modal === 'true' && /Esc/.test(box.label || ''), 'a modal dialog with a name that says how to close it', JSON.stringify(box));
  check(box.focus, 'it has the keyboard');
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement === document.querySelector('.lightbox')), 'Tab doesn’t leave it');
  await page.keyboard.press('Shift+Tab');
  check(await page.evaluate(() => document.activeElement === document.querySelector('.lightbox')), 'nor Shift+Tab');
  await page.keyboard.press('Escape');
  await sleep(100);
  check(!(await page.locator('.lightbox').count()), 'Esc closes it');
  check(!(await page.locator('textarea.ed').count()) && !(await page.locator('.blk.sel').count()), 'and that Esc did nothing else (no note selected or opened)');
  // the keyboard goes back where it was
  const more = page.locator('#main [data-a="more"]').first();
  await more.focus();
  const src = await page.locator('#main .outline img').first().getAttribute('src');
  await page.evaluate((s) => window.leanApp.showImage(s), src);
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.activeElement?.dataset?.a === 'more'), 'after Esc the keyboard is back on the button it was on');
  await more.focus();
  await page.evaluate((s) => window.leanApp.showImage(s), src);
  await page.locator('.lightbox').click();
  check(!(await page.locator('.lightbox').count()) && await page.evaluate(() => document.activeElement?.dataset?.a === 'more'), 'a click closes it too, the keyboard back on the button');
  // closed another way (Android's Back removes it): its key handler goes, Tab works again
  await more.focus();
  await page.evaluate((s) => window.leanApp.showImage(s), src);
  await page.evaluate(() => document.querySelector('.lightbox').remove());
  await more.focus();
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement?.dataset?.a !== 'more'), 'closed another way: Tab moves on again');
  await page.keyboard.press('Escape');
});

await browser.close();

// ---------------------------------------------------------------------------------------------------
// The desktop app stand-in (as t35_lost_typing): the page's calls go to the dev server; the app's events
// ("lean-files", the folder watcher's notice) are kept so the test can send them. No 30 s fallback check.
const b2 = await chromium.launch();
async function start({ clock = null, phone = false, at = '#/journals' } = {}) {
  const ctx = await b2.newContext({ viewport: phone ? { width: 400, height: 800 } : { width: 1280, height: 900 }, hasTouch: phone, isMobile: phone, timezoneId: 'UTC' });
  await ctx.addInitScript(() => {
    window.__ev = {};
    const win = { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onResized: () => {}, setSize: async () => {} };
    window.__TAURI__ = {
      core: { invoke: async (_c, { cmd, args }) => {
        if (cmd === 'quit') return true;
        const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
      } },
      event: { listen: async (name, fn) => { window.__ev[name] = fn; return () => {}; } },
      window: { getCurrentWindow: () => win }, app: { getVersion: async () => { throw new Error('test'); } },
    };
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  if (clock) await p.clock.install({ time: clock });
  await p.goto(BASE + '/');
  await p.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); localStorage.setItem('skin', JSON.stringify('calm')); }, VAULT);
  await p.goto(BASE + '/?t=1' + at);
  await p.waitForSelector('#main .outline');
  await p.waitForFunction(() => window.leanApp?.pane?.outlines?.length > 0);
  return p;
}
const topDay = (p) => p.evaluate(() => { const o = window.leanApp.pane.outlines[0]; const s = document.querySelector('#main .sheet.day'); return { date: o?.journal?.join('-'), today: !!s?.classList.contains('today'), name: s?.dataset.day }; });
const until = async (p, fn, ms = 4000) => { for (const t = Date.now() + ms; Date.now() < t;) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(100); } return false; };
// the phone's "+" pressed (as a tap's click; Playwright's own wait for it to be still doesn't settle while
// the page's clock is a stand-in)
const plus = async (p) => {
  check(await p.evaluate(() => { const a = document.querySelector('#addnote'); return !a.hidden && getComputedStyle(a).display !== 'none'; }), '(the "+" shows)');
  await p.evaluate(() => document.querySelector('#addnote').click());
};
const isDay = (d) => `(() => window.leanApp.pane.outlines[0]?.journal?.join('-') === '${d}' && document.querySelector('#main .sheet.day')?.classList.contains('today'))()`;

await section('audit 6: the Journals list moves on to the new day', async () => {
  const p = await start({ clock: new Date('2027-03-14T23:59:00Z') });
  let d = await topDay(p);
  check(d.date === '2027-3-14' && d.today, '(at 23:59 on March 14 the list starts on March 14, marked today)', JSON.stringify(d));
  await p.evaluate(() => { window.__draws = 0; const a = window.leanApp, f = a.draw.bind(a); a.draw = (...x) => { window.__draws++; return f(...x); }; });
  // the same day: coming back to the app draws nothing again
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(800);
  check(await p.evaluate(() => window.__draws) === 0, 'coming back on the same day: nothing drawn again');
  // past midnight (the clock moves on, no timer runs): coming back to the app
  await p.clock.setSystemTime(new Date('2027-03-15T00:01:00Z'));
  d = await topDay(p);
  check(d.date === '2027-3-14', '(just after midnight, before anything happens: still March 14)', JSON.stringify(d));
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  check(await until(p, isDay('2027-3-15')), 'coming back to the app after midnight: the list starts on March 15, marked today', JSON.stringify(await topDay(p)));
  const second = await p.evaluate(() => [...document.querySelectorAll('#main .sheet.day')].map((s) => [s.dataset.day, s.classList.contains('today')]).slice(0, 2));
  check(second.length === 2 && !second[1][1], 'and March 14 below it, no longer marked today', JSON.stringify(second));
  check(await p.evaluate(() => window.__draws) === 1, 'drawn again once', await p.evaluate(() => window.__draws));

  // a window left open in front overnight: no notice at all, the minute's check does it
  await p.clock.setSystemTime(new Date('2027-03-16T00:00:30Z'));
  await sleep(300);
  check((await topDay(p)).date === '2027-3-15', '(the next midnight, before the minute’s check: still March 15)');
  await p.clock.runFor(61_000);
  check(await until(p, isDay('2027-3-16')), 'no notice, only the once-a-minute check: March 16 on top', JSON.stringify(await topDay(p)));

  // a file notice (the folder watcher) after midnight
  await p.clock.setSystemTime(new Date('2027-03-17T00:00:10Z'));
  await p.evaluate(() => window.__ev['lean-files']({ payload: [] }));
  check(await until(p, isDay('2027-3-17')), 'a file notice after midnight: March 17 on top', JSON.stringify(await topDay(p)));

  // not while a day is in use: a note being edited stays open
  await p.locator('#main .sheet.day').first().locator('.blk > .bc').first().click();
  await p.waitForSelector('#main textarea.ed');
  await p.keyboard.type('late words');
  await p.clock.setSystemTime(new Date('2027-03-18T00:00:20Z'));
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(1000);
  d = await topDay(p);
  check(d.date === '2027-3-17' && await p.locator('#main textarea.ed').count() === 1 && /late words/.test(await p.locator('#main textarea.ed').inputValue()), 'typing at midnight: the list isn’t drawn again under it', JSON.stringify(d));
  await p.keyboard.press('Escape'); // stop typing: the note is selected
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(1000);
  check((await topDay(p)).date === '2027-3-17', 'nor while that note is selected');
  await p.keyboard.press('Escape'); // let it go
  await sleep(1500); // (its save)
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  check(await until(p, isDay('2027-3-18')), 'once he stops: March 18 on top', JSON.stringify(await topDay(p)));
  const saved = await readWhen('Diary/March 17th, 2027.md', (t) => t.includes('late words'));
  check(saved.includes('late words'), 'and the words typed went to March 17, the day they were typed in', saved);

  // a page other than Journals is left as it is
  await p.evaluate(() => { location.hash = '#/page/Audit%20Keys'; });
  await sleep(600);
  const draws = await p.evaluate(() => window.__draws);
  await p.clock.setSystemTime(new Date('2027-03-19T00:00:20Z'));
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(800);
  check(await p.evaluate(() => window.__draws) === draws && /Audit%20Keys/.test(await p.evaluate(() => location.hash)), 'another page shown: nothing drawn again');
  await p.context().close();
});

await section('audit 6: the phone’s "+" after midnight adds to the new day', async () => {
  const p = await start({ clock: new Date('2027-04-01T23:58:00Z'), phone: true });
  check((await topDay(p)).date === '2027-4-1', '(the list starts on April 1)');
  await p.clock.setSystemTime(new Date('2027-04-02T00:02:00Z'));
  await plus(p);
  await sleep(800);
  const toast = await p.locator('#toast').textContent().catch(() => '');
  check(!/still opening/.test(toast || ''), 'no “Today’s journal is still opening”', toast);
  const ed = await p.evaluate(() => { const o = window.leanApp.pane.outlines.find((x) => x.cur !== null); return o ? { day: o.journal?.join('-'), text: o.blocks[o.cur].text } : null; });
  check(ed?.day === '2027-4-2' && ed.text === '', 'a new note, typing in it, on April 2', JSON.stringify(ed));
  check((await topDay(p)).date === '2027-4-2', 'and April 2 is on top', JSON.stringify(await topDay(p)));
  await p.keyboard.type('MIDNIGHTNOTE');
  await p.keyboard.press('Escape');
  const t = await readWhen('Diary/April 2nd, 2027.md', (x) => x.includes('MIDNIGHTNOTE'));
  check(t.includes('MIDNIGHTNOTE'), 'saved in April 2’s page', t);
  // words just typed in yesterday, not saved yet, when "+" is pressed: they are saved first, then the new day
  // (while typing the "+" is hidden under the phone's toolbar: this is the moment after)
  await p.clock.setSystemTime(new Date('2027-04-02T23:59:00Z'));
  await p.locator('#main .sheet.day').first().locator('.blk > .bc', { hasText: 'MIDNIGHTNOTE' }).click();
  await p.waitForSelector('#main textarea.ed');
  await p.keyboard.press('End');
  await p.keyboard.type(' plus late');
  await p.evaluate(() => { const o = window.leanApp.pane.outlines.find((x) => x.cur !== null); o.stopEdit(); }); // (typing stops; the save waits)
  await p.clock.setSystemTime(new Date('2027-04-03T00:00:30Z'));
  check(await p.evaluate(() => window.leanApp.pane.outlines[0].busy()), '(April 2 still has typing to save)');
  await plus(p);
  await sleep(1000);
  const ed2 = await p.evaluate(() => { const o = window.leanApp.pane.outlines.find((x) => x.cur !== null); return o ? o.journal?.join('-') : null; });
  check(ed2 === '2027-4-3', '"+" while typing in yesterday: the new note is on April 3', ed2);
  const t2 = await readWhen('Diary/April 2nd, 2027.md', (x) => x.includes('plus late'));
  check(t2.includes('MIDNIGHTNOTE plus late'), 'and the words typed in April 2 were saved there', t2);
  await p.context().close();
});

// ---------------------------------------------------------------------------------------------------
await section('review L6: one check for a burst of file notices; coming back checks at once', async () => {
  const p = await start({ at: '#/page/Audit%20Keys' });
  await p.evaluate(() => { window.__scans = []; const a = window.leanApp, r = a.rescan.bind(a); a.rescan = (...x) => { window.__scans.push(performance.now()); return r(...x); }; });
  const scans = () => p.evaluate(() => window.__scans.length);
  const savedNow = async () => { // type, then wait for the save itself
    const was = await p.evaluate(() => window.leanApp.savedAt || 0);
    await p.keyboard.type('x');
    for (let k = 0; k < 50 && (await p.evaluate(() => window.leanApp.savedAt || 0)) === was; k++) await sleep(50);
    return p.evaluate(() => performance.now());
  };
  await p.locator('#main .outline .blk > .bc', { hasText: 'One' }).click();
  await p.waitForSelector('#main textarea.ed');
  await p.keyboard.press('End');
  // the folder watcher's notice right after the app's own save: held ~1.5 s
  await savedNow();
  const t0 = await p.evaluate(() => { window.__ev['lean-files']({ payload: [] }); return performance.now(); });
  await sleep(700);
  check(await scans() === 0, 'a file notice right after a save: no check yet after 0.7 s');
  await p.evaluate(() => { window.__ev['lean-files']({ payload: [] }); window.__ev['lean-files']({ payload: [] }); });
  await sleep(2200);
  const s1 = await p.evaluate(() => window.__scans.slice());
  check(s1.length === 1, 'three notices in a burst: one check', s1.length);
  check(s1[0] - t0 > 1400 && s1[0] - t0 < 3000, `about 1.5 s after the last notice (${Math.round(s1[0] - t0)} ms after the first)`);
  // coming back to the app right after a save: not held back (about 200 ms)
  await savedNow();
  const t1 = await p.evaluate(() => { window.dispatchEvent(new Event('focus')); return performance.now(); });
  await sleep(700);
  const s2 = await p.evaluate(() => window.__scans.slice(1));
  check(s2.length === 1 && s2[0] - t1 < 600, `coming back to the window right after a save: checked after ${s2.length ? Math.round(s2[0] - t1) : '–'} ms`);
  // "visible" and "focus" together: one check
  await sleep(1600);
  await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await sleep(700);
  check(await scans() === 3, '“visible” and “focus” together: one check', await scans());
  // notices that never stop (a save each second): checked within 5 s of the first anyway
  const t2 = await p.evaluate(() => performance.now());
  for (let k = 0; k < 8; k++) {
    await p.evaluate(() => { window.leanApp.savedAt = Date.now(); window.__ev['lean-files']({ payload: [] }); });
    await sleep(800);
  }
  const s3 = await p.evaluate(() => window.__scans.slice(3));
  check(s3.length >= 1 && s3[0] - t2 > 4500 && s3[0] - t2 < 5300, `notices that never stop: still a check ${s3.length ? Math.round(s3[0] - t2) : '–'} ms after the first (at most 5 s)`);
  await sleep(2000);
  const s4 = await p.evaluate(() => window.__scans.slice(3));
  check(s4.length === 2, 'and one more after the last of them, so none is missed', s4.length);
  // a change made elsewhere comes in through that check
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await sleep(1600);
  write('pages/Audit Keys.md', '- One from elsewhere\n- Two\n');
  await p.evaluate(() => window.__ev['lean-files']({ payload: ['pages/Audit Keys.md'] }));
  const came = await until(p, () => [...document.querySelectorAll('#main .outline .blk > .bc')].some((b) => /from elsewhere/.test(b.textContent)), 4000);
  check(came, 'a change made elsewhere shows after the notice');

  console.log('review R6: the phone’s widget is redrawn only by a save of today’s journal');
  await p.evaluate(() => { window.__rw = 0; window.LeanAndroid = { refreshWidget: () => { window.__rw++; } }; });
  await p.locator('#main .outline .blk > .bc', { hasText: 'Two' }).click();
  await p.waitForSelector('#main textarea.ed');
  await p.keyboard.press('End');
  await savedNow();
  check(await p.evaluate(() => window.__rw) === 0, 'a save of another page: not redrawn');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  write('Diary/January 1st, 2020.md', '- an old day\n');
  await p.evaluate(() => window.leanApp.rescan());
  await p.evaluate(() => { location.hash = '#/page/' + encodeURIComponent('January 1st, 2020'); });
  await p.waitForFunction(() => window.leanApp.pane.outlines[0]?.journal?.join() === '2020,1,1');
  await p.locator('#main .outline .blk > .bc', { hasText: 'an old day' }).click();
  await p.waitForSelector('#main textarea.ed');
  await p.keyboard.press('End');
  await savedNow();
  check(await p.evaluate(() => window.__rw) === 0, 'a save of an older journal day: not redrawn');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { location.hash = '#/journals'; });
  await sleep(800);
  const isTodayFirst = await p.evaluate(() => { const d = new Date(); return window.leanApp.pane.outlines[0]?.journal?.join() === [d.getFullYear(), d.getMonth() + 1, d.getDate()].join(); });
  check(isTodayFirst, '(the Journals list starts on today)');
  await p.evaluate(() => { const o = window.leanApp.pane.outlines[0]; o.edit(o.start, 'end'); }); // (today may be empty: no words to click)
  await p.waitForSelector('#main textarea.ed');
  await savedNow();
  check(await p.evaluate(() => window.__rw) === 1, 'a save of today’s journal: redrawn once', await p.evaluate(() => window.__rw));
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.context().close();
});

await b2.close();
if (errors.length) console.log('script errors: ' + errors.join(' | '));
process.exit(failures() ? 1 : 0);

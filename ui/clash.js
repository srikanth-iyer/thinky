// The clash screen. A page was changed here and somewhere else (the phone, Claude, Logseq) since it
// was opened, in the same notes, so the two versions can't simply be combined (changes in different
// notes are, without asking: merge.rs). Only the notes that differ are shown, side by side: this
// device's version and the other copy's, with how they were before both changes, one of the two
// pre-picked as the suggestion. Where nothing (or only empty bullets) was there before, both added
// notes: "Keep both" (this device's, then the other copy's) is offered and pre-picked, as it loses
// nothing (unless one side already has all the other's notes: that side; or keeping both would put
// a note's words on the page more times than either version has them: the usual suggestion).
// Keeping a choice first saves a backup copy of each version that loses something
// (logseq/bak), then saves the page as usual (merging anything newer).
import { call } from './api.js';
import { renderBlock, esc } from './render.js';
import { h, ICON } from './dom.js';
import { docKey } from './editor.js';

const words = (bs) => bs.map((b) => b.text).join('\n');
/** the words without pictures' sizes ({:height …, :width …} right after a link) */
const unsized = (bs) => words(bs).replace(/\)\{\s*:[^}\r\n]*\}/g, ')');
/** Which side to suggest: the one that keeps more (all of the other's words and more, or the one
 *  still there when the other removed the notes); otherwise this device's, where he was writing. */
function suggest(c) {
  if (!c.mine.length) return 'theirs';
  if (!c.theirs.length) return 'mine';
  if (c.base?.length && unsized(c.mine) === unsized(c.base)) return 'theirs'; // here only a picture's size changed
  const m = words(c.mine), t = words(c.theirs);
  return t.includes(m) && !m.includes(t) ? 'theirs' : 'mine';
}
/** Notes as they'd show on the page (one level of indent per depth, from `min`: the same for both
 *  sides of a choice, so a note indented differently shows it). Each row says which note it is
 *  (`data-i`), for the highlighting of what differs (`markDiffs`). */
function notesHtml(blocks, min = Math.min(...blocks.map((b) => b.depth))) {
  if (!blocks.length) return '<p class="cl-none">(removed)</p>';
  return blocks.map((b, i) => {
    const r = renderBlock(b.text);
    return `<div class="cl-b" data-i="${i}" style="--d:${Math.min(Math.max(b.depth - min, 0), 6)}">${r.marker ? `<span class="mk">${esc(r.marker)}</span> ` : ''}${r.html || '&nbsp;'}</div>`;
  }).join('');
}
/** The smallest depth among a choice's notes (both sides and before), so all are drawn from one edge. */
const minDepth = (it) => Math.min(...[...it.mine, ...it.theirs, ...(it.base || [])].map((b) => b.depth), 99);

// ----- what differs, highlighted (Build 43, he asked: long notes that differ by one word looked the same)
const tokens = (t) => [...t.matchAll(/\S+/g)].map((m) => ({ w: m[0], at: m.index, end: m.index + m[0].length }));
const wordSet = (t) => new Set(t.toLowerCase().split(/\s+/).filter(Boolean));
/** How alike two notes' words are, 0 to 1 (shared words over all words). */
function alike(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size && !B.size) return 1;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
/** Which note on one side goes with which on the other, in order: each of this side's notes takes the
 *  most alike of the next few on the other side, if at least 40% alike. [[i, k]…] */
function pairNotes(mine, theirs) {
  const pairs = [];
  let j = 0;
  for (let i = 0; i < mine.length && j < theirs.length; i++) {
    let best = -1, score = 0.4;
    for (let k = j; k < Math.min(theirs.length, j + 6); k++) {
      const s = mine[i].text === theirs[k].text ? 2 : alike(mine[i].text, theirs[k].text);
      if (s >= score) { best = k; score = s; }
    }
    if (best >= 0) { pairs.push([i, best]); j = best + 1; }
  }
  return pairs;
}
/** The words of a and b that the other doesn't have, in order (a longest common run of words). */
function wordDiff(a, b) {
  const A = tokens(a), B = tokens(b);
  if (A.length * B.length > 250000) return [A, B]; // too long to compare: all of both
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let k = B.length - 1; k >= 0; k--) L[i][k] = A[i].w === B[k].w ? L[i + 1][k + 1] + 1 : Math.max(L[i + 1][k], L[i][k + 1]);
  const goneA = [], goneB = [];
  let i = 0, k = 0;
  while (i < A.length && k < B.length) {
    if (A[i].w === B[k].w) { i++; k++; } else if (L[i + 1][k] >= L[i][k + 1]) goneA.push(A[i++]); else goneB.push(B[k++]);
  }
  return [goneA.concat(A.slice(i)), goneB.concat(B.slice(k))];
}
/** A Range over characters [start, end) of el's text. */
function rangeIn(el, start, end) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, set = false;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.data.length;
    if (!set && start < pos + len) { r.setStart(n, start - pos); set = true; }
    if (set && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  return null;
}
/** Marks what differs in each choice: paired notes' differing words (`::highlight(cl-mine)` on this
 *  side's, `cl-theirs` on the other's), a note only one side has (`.cl-solo`), and a note whose words
 *  are the same but whose indent isn't (`.cl-indent`, with a word saying so). */
function markDiffs(box, items) {
  const gone = [], added = [];
  items.forEach((it, k) => {
    if (it.props) return;
    const sec = box.querySelector(`.cl-item[data-k="${k}"]`);
    if (!sec) return;
    const row = (side, i) => sec.querySelector(`.cl-col.${side} .cl-b[data-i="${i}"]`);
    const pairs = pairNotes(it.mine, it.theirs);
    const pm = new Set(pairs.map((p) => p[0])), pt = new Set(pairs.map((p) => p[1]));
    it.mine.forEach((_, i) => { if (!pm.has(i)) row('mine', i)?.classList.add('cl-solo'); });
    it.theirs.forEach((_, i) => { if (!pt.has(i)) row('theirs', i)?.classList.add('cl-solo'); });
    for (const [i, j] of pairs) {
      const a = row('mine', i), b = row('theirs', j);
      if (!a || !b) continue;
      if (a.textContent === b.textContent) {
        if (it.mine[i].depth !== it.theirs[j].depth) {
          for (const [el, d] of [[a, it.mine[i].depth], [b, it.theirs[j].depth]]) {
            el.classList.add('cl-indent');
            el.insertAdjacentHTML('beforeend', `<span class="cl-why">${d === 0 ? 'not indented' : `indented ${d === 1 ? 'one level' : `${d} levels`}`}</span>`);
          }
        }
        continue;
      }
      const [ga, gb] = wordDiff(a.textContent, b.textContent);
      for (const w of ga) { const r = rangeIn(a, w.at, w.end); if (r) gone.push(r); }
      for (const w of gb) { const r = rangeIn(b, w.at, w.end); if (r) added.push(r); }
    }
  });
  if (window.CSS?.highlights && window.Highlight) {
    CSS.highlights.set('cl-mine', new Highlight(...gone));
    CSS.highlights.set('cl-theirs', new Highlight(...added));
  }
}
const unmark = () => { if (window.CSS?.highlights) { CSS.highlights.delete('cl-mine'); CSS.highlights.delete('cl-theirs'); } };
const propsHtml = (t) => (t.trim() ? `<pre class="cl-props">${esc(t.trim())}</pre>` : '<p class="cl-none">(none)</p>');
/** Both devices added notes where nothing (or only empty bullets) was before: keeping both loses nothing. */
const bothAdded = (p) => p.mine.length > 0 && p.theirs.length > 0 && p.base.every((b) => !b.text.trim());
/** Whether notes `a` have every note of `b` (the same words, as many times). */
function hasAll(a, b) {
  const left = new Map();
  for (const x of a) left.set(x.text, (left.get(x.text) || 0) + 1);
  for (const x of b) {
    const k = left.get(x.text) || 0;
    if (!k) return false;
    left.set(x.text, k - 1);
  }
  return true;
}
/** The choice pre-picked for a clash. Where both added notes: "Keep both", unless one side already
 *  has every note of the other (the same note moved or added there on both devices): then that side,
 *  which loses nothing either and doesn't show that note twice. See also `noTwice`. */
function prePick(p) {
  if (!bothAdded(p)) return suggest(p);
  if (hasAll(p.mine, p.theirs)) return 'mine';
  if (hasAll(p.theirs, p.mine)) return 'theirs';
  return 'both';
}
/** The pre-pick comparing a page with its conflict copy: where every note on each side has a close
 *  partner on the other (a word or an indent changed), this page's, since keeping both would put the
 *  note there twice; else the side that has notes, or both where each has its own. */
function copyPick(p) {
  if (!p.mine.length) return 'theirs';
  if (!p.theirs.length) return 'mine';
  const pairs = pairNotes(p.mine, p.theirs);
  return pairs.length === p.mine.length && pairs.length === p.theirs.length ? 'mine' : 'both';
}
/** How many times each note's words are on a page (empty notes don't count). */
function counts(texts) {
  const n = new Map();
  for (const t of texts) if (t.trim()) n.set(t, (n.get(t) || 0) + 1);
  return n;
}
/** "Keep both" stays pre-picked only if the page the pre-picks make has no note's words more times
 *  than this device's page or the other copy has them; otherwise those items get the usual
 *  suggestion. (A note moved to the end on one device and another moved there on the other would
 *  show twice: each device still has it in its old place.) `mine`: this device's notes' words. */
function noTwice(c, items, mine) {
  if (!items.some((it) => it.pick === 'both')) return;
  const page = counts(pageBlocks(c, items.map((it) => it.pick)).map((b) => b.text));
  const m = counts(mine), t = counts(c.theirs.blocks.map((b) => b.text));
  for (const [w, n] of page) {
    if (n > Math.max(m.get(w) || 0, t.get(w) || 0)) {
      for (const it of items) if (it.pick === 'both') it.pick = suggest(it);
      return;
    }
  }
}
/** The page's notes with these choices (one per item; the page properties' first, if both changed
 *  them): the parts nobody has to choose, and each clash as picked. */
function pageBlocks(c, picks) {
  const blocks = [];
  let k = c.preamble ? 1 : 0;
  for (const p of c.parts) {
    if (p.kind === 'same') blocks.push(...p.blocks);
    else {
      const pick = picks[k++];
      blocks.push(...(pick === 'both' ? [...p.mine, ...p.theirs] : pick === 'mine' ? p.mine : p.theirs));
    }
  }
  return blocks;
}

/** Show the clash screen for outline o (its page clashed while saving). Resolves when he chose
 *  (true) or put it off (false). With `copy` (Build 43: a sync app's conflict copy compared with this
 *  page, core `compare_copy`, see `openCopyMerge`): the page as its file is on the left, the copy on
 *  the right, every stretch where they differ a choice; no "before" (neither is older). */
export async function openClash(o, copy = null) {
  if (document.querySelector('.clash-back')) return false;
  o.stopEdit();
  let c;
  const asked = docKey(o.doc); // the version compared (see keep)
  const mineWords = o.doc.blocks.map((b) => b.text);
  if (copy) c = copy;
  else {
    try { c = await call('clash', { name: o.name, doc: o.doc, base: o.base, path: o.path }); }
    catch (err) { wholeChoice(o, err); return false; }
  }
  // what to choose from: the page properties (if both changed them), then each clash in page order
  const items = [];
  if (c.preamble) items.push({ props: true, base: c.preamble[0], mine: c.preamble[1], theirs: c.preamble[2], pick: 'mine' });
  for (const p of c.parts || []) if (p.kind === 'clash') items.push({ ...p, both: bothAdded(p), pick: copy ? copyPick(p) : prePick(p) });
  const whole = !c.parts; // too long to compare note by note: keep one version or the other
  if (!whole && !items.length) return keep(o, c, asked, null, [], [], []); // the file changed again: nothing clashes now
  if (!whole) noTwice(c, items, mineWords);
  o.stopEdit(); // a note clicked while comparing: typing must not go on under the screen

  const back = h('div', 'modal-back panel-back clash-back');
  const box = h('div', 'panel clash');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'cl-title');
  const n = items.length;
  const MINE = copy ? 'This page' : 'This device';
  const THEIRS = copy ? 'The copy' : 'Other copy';
  if (copy) box.classList.add('cl-copy');
  box.innerHTML = `<header class="panel-head cl-head">
      <h2 id="cl-title">${copy ? 'Compare with the conflict copy' : 'Changed in two places'}</h2>
      <p class="note">${copy
        ? `“${esc(o.name)}” and its copy <code>${esc(copy.copy)}</code> ${whole ? 'differ, and the page is too long to compare note by note: choose which version to keep.' : `differ in ${n === 1 ? 'one place' : `${n} places`}. Choose what to keep for ${n === 1 ? 'it' : 'each'}: this page’s notes, the copy’s, or both. What both have stays as it is.`}`
        : `“${esc(o.name)}” was changed here and ${o.elsewhere()} in the same ${whole ? 'page' : n === 1 ? 'note' : 'notes'}. ${whole ? 'It’s too long to compare note by note: choose which version to keep.' : `Choose which version to keep for ${n === 1 ? 'it' : 'each'}.`}`}</p>
      <div class="cl-bar">
        <span class="cl-key"><i class="mine"></i>${MINE} <i class="theirs"></i>${THEIRS}${copy ? '' : ' <i class="base"></i>Before both changes'}</span>
        ${n > 1 ? `<span class="cl-nav"><span class="cl-n" aria-live="polite">1 of ${n}</span><button type="button" class="icon-btn" data-c="prev" aria-label="Previous difference">${ICON.up}</button><button type="button" class="icon-btn" data-c="next" aria-label="Next difference">${ICON.down}</button></span>` : ''}
      </div>
    </header>
    <div class="panel-body cl-list">${whole ? '' : items.map((it, k) => `<section class="cl-item" data-k="${k}">
      ${it.props ? '<h3 class="cl-what">Page properties</h3>' : ''}
      <div class="cl-cols" role="radiogroup" aria-label="Version to keep">
        ${['mine', 'theirs'].map((side) => `<label class="cl-col ${side}">
          <input type="radio" name="cl${k}" value="${side}"${it.pick === side ? ' checked' : ''}>
          <span class="cl-h"><i class="${side}"></i>${side === 'mine' ? MINE : THEIRS}${it.pick === side ? ' <em>suggested</em>' : ''}</span>
          <div class="cl-notes">${it.props ? propsHtml(it[side]) : copy && !it[side].length ? `<p class="cl-none">(${side === 'mine' ? 'not on this page' : 'not in the copy'})</p>` : notesHtml(it[side], minDepth(it))}</div>
        </label>`).join('')}
        ${it.both ? `<label class="cl-col both">
          <input type="radio" name="cl${k}" value="both"${it.pick === 'both' ? ' checked' : ''}>
          <span class="cl-h"><i class="mine"></i><i class="theirs"></i>${copy ? 'Keep both: this page’s, then the copy’s' : 'Keep both: this device’s, then the other copy’s'}${it.pick === 'both' ? ' <em>suggested</em>' : ''}</span>
        </label>` : ''}
      </div>
      ${copy ? '' : `<div class="cl-base"><span class="cl-h"><i class="base"></i>Before both changes</span><div class="cl-notes">${it.props ? propsHtml(it.base) : it.base.length ? notesHtml(it.base, minDepth(it)) : '<p class="cl-none">(not there yet)</p>'}</div></div>`}
    </section>`).join('')}</div>
    <footer class="panel-foot cl-foot">
      <p class="note">${copy ? 'The page as it is now is saved as a backup copy in <code>logseq/bak</code> first, and the copy goes to the bin afterwards, so nothing is lost.' : 'The version you don’t keep is saved as a backup copy in <code>logseq/bak</code>, so nothing is lost.'}</p>
      <div class="btn-row">
        <button type="button" class="btn ghost" data-c="later">${copy ? 'Cancel' : 'Decide later'}</button>
        ${whole ? `<button type="button" class="btn ghost" data-c="theirs">${copy ? 'Use the copy' : 'Use the other copy'}</button><button type="button" class="btn" data-c="mine">${copy ? 'Keep this page' : 'Keep this device’s'}</button>`
          : `<span class="cl-all">${n > 1 ? `All: <button type="button" class="link" data-c="all-mine">${copy ? 'this page' : 'this device'}</button> · <button type="button" class="link" data-c="all-theirs">${copy ? 'the copy' : 'other copy'}</button>` : ''}</span><button type="button" class="btn" data-c="apply"></button>`}
      </div>
    </footer>`;
  back.append(box);
  document.body.append(back);
  if (!whole) markDiffs(box, items);

  const radios = (k) => box.querySelectorAll(`input[name="cl${k}"]`);
  const picked = () => items.map((it, k) => [...radios(k)].find((r) => r.checked)?.value || it.pick);
  const label = () => {
    box.querySelectorAll('.cl-col').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    const b = box.querySelector('[data-c="apply"]');
    if (b) b.textContent = picked().every((p, k) => p === items[k].pick) ? (n === 1 ? 'Keep the suggested one' : 'Keep the suggested ones') : 'Keep my choices';
  };
  label();
  box.addEventListener('change', label);
  let cur = 0;
  const go = (k) => {
    cur = (k + n) % n;
    const it = box.querySelector(`.cl-item[data-k="${cur}"]`);
    it?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    box.querySelectorAll('.cl-item.cur').forEach((x) => x.classList.remove('cur'));
    it?.classList.add('cur');
    const t = box.querySelector('.cl-n');
    if (t) t.textContent = `${cur + 1} of ${n}`;
  };
  if (n > 1) go(0);

  return new Promise((resolve) => {
    let busy = false; // keeping a choice: the backups are being made
    const close = (done) => {
      unmark();
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(done);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy) close(false); // decide later: the page's banner offers the screen again
    };
    document.addEventListener('keydown', onKey, true);
    box.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-c]')?.dataset.c;
      if (!a || busy) return;
      if (a === 'later') { close(false); return; }
      if (a === 'prev' || a === 'next') { go(cur + (a === 'prev' ? -1 : 1)); return; }
      if (a === 'all-mine' || a === 'all-theirs') {
        items.forEach((_, k) => radios(k).forEach((r) => { r.checked = r.value === a.slice(4); }));
        label();
        return;
      }
      // keep: a = 'apply' (the choices), 'mine' or 'theirs' (the whole page). The screen stays up
      // while the backups are made, then closes: if the page changed yet again meanwhile, saving
      // may ask again with a new one.
      const picks = whole ? [] : picked();
      busy = true;
      box.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
      await keep(o, c, asked, whole ? a : null, items, picks, whole ? [a] : picks, close, copy);
    });
  });
}

/** Build the page from the choices, back up what loses something, then save. `asked`: the version
 *  that was compared; `close(done)` takes the screen away (once the backups are made, so nothing
 *  can be typed meanwhile). False if nothing was changed (a backup couldn't be made: the page's
 *  banner still offers the choice). */
async function keep(o, c, asked, wholeSide, items, picks, sides, close = () => {}, copy = null) {
  let doc;
  if (wholeSide) doc = wholeSide === 'mine' ? o.doc : c.theirs;
  else {
    const blocks = pageBlocks(c, picks);
    const preamble = c.preamble ? (picks[0] === 'mine' ? o.doc.preamble : c.theirs.preamble)
      : copy || o.doc.preamble !== o.base.preamble ? o.doc.preamble : c.theirs.preamble;
    doc = { preamble, blocks, indent: c.theirs.indent, crlf: c.theirs.crlf };
  }
  // a backup copy of each version that loses something (this device's: unless that exact version
  // is in logseq/bak already, from when the clash showed); and this device's anyway if it changed
  // since it was compared (a note typed in while comparing isn't in the choices)
  try {
    if (copy) await o.backupMine(); // (the page as it was, before the copy's notes come in)
    else if (sides.includes('theirs') || docKey(o.doc) !== asked) await o.backupMine();
    if (sides.includes('mine') && !copy) await call('backup', { name: o.name, doc: c.theirs });
  } catch (err) {
    close(false);
    o.app.toast('Couldn’t keep a backup copy, so nothing was changed: ' + err, 6000);
    return false;
  }
  close(true);
  o.doc = JSON.parse(JSON.stringify(doc));
  // no Undo back to before the choice: it would quietly bring back what was just chosen against
  // (only its backup copy would hold the other version)
  o.forgetUndo();
  o.base = copy ? c.mine : c.theirs; // (the file as it was read: the copy's text is in no file of this page)
  o.hash = c.hash;
  o.conflict = false;
  o.dirty = true;
  o.banner.hidden = true;
  o.app.conflicts?.delete(o);
  o.render();
  await o.save(); // the file may have changed again meanwhile: merged then, or asked again
  if (copy) {
    if (o.conflict || o.dirty) { o.app.toast('The page couldn’t be saved yet, so the copy was left where it is.', 6000); return true; }
    try { await call('bin_copy', { copy: copy.copy }); } catch (err) { o.app.toast(String(err?.message ?? err), 6000); return true; }
    o.app.toast('Merged. The copy is in the bin, and the page as it was is in logseq/bak.', 4500);
    o.app.copyMerged?.(copy.copy);
    return true;
  }
  const lost = sides.includes('mine') || sides.includes('theirs'); // ("both" loses nothing)
  if (!o.conflict) o.app.toast(lost ? 'Kept your choice; the other version is in logseq/bak.' : items.length ? 'Kept both.' : 'Saved.', 3500);
  return true;
}

/** The two versions couldn't be compared (say the file couldn't be read): the choice as it was
 *  before the clash screen, a whole version each, on the page's banner. */
function wholeChoice(o, err) {
  if (err) o.app.toast('Couldn’t compare the two versions: ' + err, 6000);
  o.showBanner(`<span>This page was also changed ${o.elsewhere()}, and the two versions couldn’t be compared note by note. Nothing on this page is saved until you choose. The version you don’t keep is saved as a backup copy in <code>logseq/bak</code>.</span>
    <span class="btn-row"><button class="btn" data-a="choose">Try again</button><button class="btn ghost" data-a="theirs">Use the other version</button><button class="btn" data-a="mine">Keep mine</button></span>`);
  o.banner.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'choose') { o.showConflict(); return; }
    if (a === 'mine') { // the file's version goes to logseq/bak first (app.rs save, with force)
      while (o.saving) await o.saving; // a save already on its way finishes first, then this one, forced
      o.dirty = true;
      o.conflict = false;
      await o.save(true);
      if (o.saveError) { // couldn't save (its message says why): still only here, still waiting
        o.conflict = true;
        wholeChoice(o, null);
        return;
      }
    } else if (a === 'theirs') {
      try { await o.backupMine(); } catch (err2) { o.app.toast('Couldn’t keep a backup copy, so nothing was changed: ' + err2, 6000); return; }
      o.dirty = false;
      o.conflict = false;
      await o.reload(true);
    } else return;
    if (!o.conflict) o.app.conflicts?.delete(o);
  };
}

/** Check this folder → "Compare and merge…" beside a sync app's conflict copy (Build 43, he asked
 *  Nov 10). The copy's page opens, then the clash screen in its conflict-copy mode compares the two
 *  (core `compare_copy`). A copy that says just what the page says only offers to go to the bin. */
export async function openCopyMerge(app, rel) {
  let c;
  try { c = await call('compare_copy', { copy: rel }); } catch (err) { app.toast(String(err?.message ?? err), 6000); return; }
  if (!c.differ) {
    const { confirmBox } = await import('./popups.js');
    if (!(await confirmBox({ title: 'The copy is the same as the page', body: `<code>${esc(rel)}</code> says exactly what “${esc(c.name)}” says. Move the copy to the bin?`, ok: 'Move to the bin' }))) return;
    try { await call('bin_copy', { copy: rel }); app.toast('The copy is in the bin.'); app.copyMerged?.(rel); } catch (err) { app.toast(String(err?.message ?? err), 6000); }
    return;
  }
  app.go('page', c.name);
  // the page's outline, once drawn (its file is the one compared)
  let o = null;
  for (let k = 0; k < 50 && !o; k++) {
    await new Promise((r) => setTimeout(r, 100));
    o = app.pane.outlines.find((x) => x.path === c.path && !x.opts?.preview) || null;
  }
  if (!o) { app.toast('The page couldn’t be opened to compare it.', 6000); return; }
  await o.flush(); // typing not saved yet goes in first; then compare what the file says now
  if (o.conflict) { app.toast('This page has a clash waiting: settle that first.', 6000); return; }
  if (docKey(o.doc) !== docKey(c.mine)) {
    try { c = await call('compare_copy', { copy: rel }); } catch (err) { app.toast(String(err?.message ?? err), 6000); return; }
    if (docKey(o.doc) !== docKey(c.mine)) { app.toast('The page changed while it opened. Try again in a moment.', 6000); return; }
  }
  await openClash(o, c);
}

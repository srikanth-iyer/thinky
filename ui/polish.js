// Polish note (Build 51; he asked, Nov 18, and picked how it looks from a clickable preview): the AI
// tidies one note (spelling, shorthand, a to-do with its date, links to pages that exist, tags already
// in use) and shows the result IN the note, without saving it: the new words fade in one after the
// other, the changed ones lightly tinted; under it one line of buttons, Keep (the only filled one, the
// look's accent), Changes, Retry and Undo. Only Keep changes the note (one Undo step, saved as any
// change). While it waits, the note's words go faint and a thin line sweeps along its foot.
// Where it starts: the ✦ at the right end of the note under the mouse (laptop), the phone toolbar's
// ✦, the note menu, "/polish" and the command list; none of them shows until an AI is set up (ai.js
// puts `ai-on` on <html>). The answer is checked by the app's Rust code first (core ai.rs).
import { polishText, pictureText, aiOn } from './ai.js';
import { ICON, motionOn } from './dom.js';
import { esc } from './render.js';
import { splitHidden, joinHidden } from './editor.js';
import { menu } from './popups.js';

const root = document.documentElement;
const words = (t) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []));

// ---------- the ✦ at the end of the note under the mouse (laptop) ----------
let spark = null;
/** Moves the one ✦ button into the row under the mouse (editor.js bindEvents: pointerover). */
export function hoverSpark(o, e) {
  if (!root.classList.contains('ai-on') || o.readonly || o.preview || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const row = e.target.closest?.('.blk');
  if (!row || !o.el.contains(row) || row.classList.contains('pz-on')) return;
  if (!spark) {
    spark = document.createElement('button');
    spark.className = 'pz-spark';
    spark.type = 'button';
    spark.tabIndex = -1;
    spark.title = 'AI…';
    spark.setAttribute('aria-label', 'AI: polish this note…');
    spark.innerHTML = ICON.polish;
    spark.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); }); // (no drag, no editing)
    spark.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const r = spark.parentElement;
      if (r && spark.o) aiMenu(spark.o, +r.dataset.i, spark);
    });
  }
  spark.o = o;
  if (spark.parentElement !== row) row.append(spark);
}

// ---------- polishing one note ----------
/** What the ✦ does (Build 54, he asked: a click out of curiosity mustn't start anything): a small menu
 *  that says what each choice does; only a choice in it asks the AI. From the ✦ beside a note (laptop)
 *  and the phone toolbar's ✦ (`tb`: the keyboard stays up). */
export function aiMenu(o, i, anchor, tb = false) {
  if (!(i >= 0) || !o.blocks[i]) return;
  const items = [{ label: 'Polish note', hint: 'Tidies its words', icon: ICON.polish, run: () => startPolish(o, i) }];
  if (PICTURE_IN.test(o.textOf(i))) items.push({ label: 'Picture to text', hint: 'Its words as notes', icon: ICON.polish, run: () => startPicture(o, i) });
  menu(anchor, items, { title: 'AI', ...(tb ? { keep: true, cls: 'tb-menu ai-menu' } : { cls: 'ai-menu' }) });
}

/** Ask the AI to polish note i of outline o, and show its answer for the person to keep or not. */
export async function startPolish(o, i) {
  const app = o.app;
  if (!aiOn()) {
    app.toast('Choose an AI first: Settings → AI.', 5000, { label: 'Open', run: () => { location.hash = '#/settings/ai'; } });
    return;
  }
  if (o.readonly || o.conflict) { app.toast('This page can’t be changed just now.', 3500); return; }
  if (!(i >= o.start && i < o.end) || !o.blocks[i]) return;
  if (o.pz) close(o.pz); // (one at a time on a page)
  if (o.cur === i) o.stopEdit();
  const text = o.textOf(i);
  if (!text.replace(/\n[ \t]*[\w.-]+::.*/g, '').trim()) { app.toast('There’s nothing in this note to polish.', 3000); return; }
  const row = o.blockDiv(i);
  if (!row) return;
  const st = { o, i, text, row, len: o.blocks.length, depth: o.blocks[i].depth };
  o.pz = st;
  row.classList.add('pz-on', 'pz-working');
  st.sweep = document.createElement('span');
  st.sweep.className = 'pz-sweep';
  st.sweep.setAttribute('aria-hidden', 'true');
  row.querySelector(':scope > .bc')?.append(st.sweep);
  row.querySelector(':scope > .bc')?.setAttribute('aria-busy', 'true');
  let res;
  try {
    res = await polishText(text);
  } catch (e) {
    close(st);
    app.toast(String(e?.message ?? e), 7000);
    return;
  }
  if (o.pz !== st) return; // (closed, or another started)
  if (stale(st)) { close(st); app.toast('The note changed while the AI was working, so nothing was changed.', 5000); return; }
  if (res.same) { close(st); app.toast('This note already reads well: nothing to change.', 3500); return; }
  show(st, res);
}

function stale(st) {
  const { o, i } = st;
  return !st.row.isConnected || o.blocks.length !== st.len || !o.blocks[i] || o.textOf(i) !== st.text || o.readonly || o.conflict;
}

function close(st) {
  const { o, row } = st;
  if (o.pz === st) o.pz = null;
  row.classList.remove('pz-on', 'pz-working');
  st.sweep?.remove();
  st.box?.remove();
  const bc = row.querySelector(':scope > .bc');
  if (bc) { bc.hidden = false; bc.removeAttribute('aria-busy'); }
  document.removeEventListener('keydown', st.esc, true);
}
const app = (st) => st.o.app;

/** The answer drawn in the note (not saved), the new words tinted, and the line of buttons. */
function show(st, res) {
  const { o, i, row } = st;
  row.classList.remove('pz-working');
  st.sweep?.remove();
  const bc = row.querySelector(':scope > .bc');
  if (bc) bc.hidden = true;
  const box = document.createElement('div');
  box.className = 'pz';
  st.box = box;
  st.old = words(st.text);
  st.notesEl = document.createElement('div');
  st.notesEl.className = 'pz-notes';
  box.append(st.notesEl);
  drawNotes(st, res, motionOn());
  const btn = (a, icon, label, cls = '') => `<button type="button" class="btn small pz-b${cls}" data-pz="${a}" aria-label="${label}" title="${label}">${icon}<span>${label}</span></button>`;
  box.insertAdjacentHTML('beforeend', `<div class="pz-bar" role="group" aria-label="The AI’s version">${btn('keep', ICON.tick, 'Keep', ' pz-keep')}${btn('diff', ICON.eye, 'Changes', ' ghost')}${btn('retry', ICON.retry, 'Retry', ' ghost')}${btn('undo', ICON.undoArrow, 'Undo', ' ghost')}</div>
    <div class="pz-diff"><div><div class="pz-old">${esc(st.text.split('\n').filter((l) => !/^[\w.-]+::/.test(l.trim())).join('\n'))}</div><div class="pz-newtext">${res.notes.map((t) => esc(t.split('\n').filter((l) => !/^[\w.-]+::/.test(l.trim()) || /^by::/.test(l.trim())).join('\n'))).join('\n')}</div></div></div>`);
  if (res.unlinked?.length) box.insertAdjacentHTML('beforeend', `<p class="note small pz-why">Left as plain words (no such page or tag): ${res.unlinked.map(esc).join(', ')}</p>`);
  (bc || row.lastChild).after(box);
  box.addEventListener('pointerdown', (e) => e.stopPropagation()); // (not a press on the note: no editing, no drag)
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-pz]');
    const a = b?.dataset.pz;
    if (a === 'diff') { const d = box.querySelector('.pz-diff'); d.classList.toggle('open'); b.setAttribute('aria-pressed', String(d.classList.contains('open'))); return; }
    if (a === 'undo') { close(st); return; }
    if (a === 'retry') { close(st); startPolish(o, i); return; }
    if (a === 'keep') { keep(st, res); return; }
    // a click on the AI's words: edit them in place before keeping (he asked, Nov 20)
    const v = e.target.closest('.pz-note');
    if (v && !st.editing) { e.preventDefault(); editNotes(st, res, [...st.notesEl.children].indexOf(v)); }
  });
  box.addEventListener('keydown', (e) => { // (typing here is its own: not the page's keys)
    if (!e.target.closest('.pz-ed')) return;
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); keep(st, res); }
    else if (e.key === 'Escape') { e.preventDefault(); drawNotes(st, res, false); box.querySelector('.pz-keep')?.focus(); }
  });
  st.esc = (e) => { if (e.key === 'Escape' && o.pz === st && !st.editing && !document.querySelector('.pop:not([hidden]), .modal-back')) { e.preventDefault(); close(st); } };
  document.addEventListener('keydown', st.esc, true);
}

/** The AI's notes as drawn notes (not saved), the words that weren't in the note tinted; with `fade`,
 *  each word fades in after the one before. Also after editing them by hand. */
function drawNotes(st, res, fade) {
  const { o, i } = st;
  st.editing = false;
  st.box.classList.remove('pz-editing');
  st.notesEl.replaceChildren();
  res.notes.forEach((t, n) => {
    const v = o.viewEl(i, { text: t, depth: st.depth });
    v.classList.add('pz-note');
    v.title = 'Click to change these words before keeping them';
    if (n > 0) v.classList.add('pz-more'); // (another note it became, after this one)
    st.notesEl.append(v);
  });
  let k = 0;
  for (const v of st.notesEl.querySelectorAll('.pz-note')) {
    const walk = document.createTreeWalker(v, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walk.nextNode()) texts.push(walk.currentNode);
    for (const tn of texts) {
      const parts = tn.nodeValue.split(/(\s+)/);
      if (parts.length === 1 && !parts[0]) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (!p || /^\s+$/.test(p)) { frag.append(p); continue; }
        const s = document.createElement('span');
        const w = (p.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
        s.className = 'pz-w' + (w.length && w.some((x) => !st.old.has(x)) ? ' pz-new' : '') + (fade ? '' : ' pz-still');
        if (fade) s.style.setProperty('--k', String(Math.min(k++, 24)));
        s.textContent = p;
        frag.append(s);
      }
      tn.replaceWith(frag);
    }
  }
  newText(st, res);
}
const propLine = (l) => /^[\w.-]+::/.test(l.trim());
function newText(st, res) {
  const el = st.box.querySelector('.pz-newtext');
  if (el) el.textContent = res.notes.map((t) => t.split('\n').filter((l) => !propLine(l) || /^by::/.test(l.trim())).join('\n')).join('\n');
}

/** Edit the AI's notes by hand: each becomes a text box with its words (its hidden properties, such as
 *  the note's id::, kept aside and put back); Keep (or Ctrl+Enter) keeps them as typed, Esc shows them
 *  drawn again. The note itself still isn't touched until Keep. */
function editNotes(st, res, at) {
  st.editing = true;
  st.box.classList.add('pz-editing');
  st.notesEl.replaceChildren();
  const tas = res.notes.map((t, n) => {
    const { shown, hidden } = splitHidden(t);
    const ta = document.createElement('textarea');
    ta.className = 'pz-ed' + (n > 0 ? ' pz-more' : '');
    ta.value = shown;
    ta.rows = 1;
    ta.spellcheck = localStorage.getItem('spellcheck') !== 'false';
    ta.setAttribute('aria-label', n ? `The AI’s note ${n + 1}, to change` : 'The AI’s version, to change');
    ta.addEventListener('input', () => { res.notes[n] = joinHidden(ta.value, hidden); newText(st, res); });
    st.notesEl.append(ta);
    return ta;
  });
  const ta = tas[Math.max(0, at)] || tas[0];
  ta?.focus();
  ta?.setSelectionRange(ta.value.length, ta.value.length);
}

/** Keep: the note takes the AI's words (and the notes it became go in after it and its sub-notes),
 *  as one Undo step, saved as any change. */
function keep(st, res) {
  const { o, i } = st;
  if (stale(st)) { close(st); app(st).toast('The note changed meanwhile, so nothing was changed.', 4000); return; }
  const notes = res.notes.filter((t) => splitHidden(t).shown.trim()); // (a note emptied by hand isn't kept)
  if (!notes.length) { app(st).toast('There’s nothing left to keep: Undo to leave the note as it was.', 4000); return; }
  const [first, ...more] = notes;
  const at = o.subtreeEnd(i);
  close(st);
  o.snap();
  o.blocks[i].text = first;
  if (more.length) o.blocks.splice(at, 0, ...more.map((text) => ({ depth: st.depth, text, raw: null })));
  o.cur = null;
  o.ta = null;
  o.render();
  o.markDirty();
  const n = notes.length;
  o.undoToast(n === 1 ? 'Polished the note.' : `Polished the note into ${n} notes.`);
  const div = o.blockDiv(i);
  if (div && motionOn()) { div.classList.add('pz-kept'); setTimeout(() => div.classList.remove('pz-kept'), 1400); }
}

// ---------- Picture to text (Build 52; he picked it from a clickable preview, Nov 20) ----------
/** A note with a picture saved in the notes folder, of a kind the AI services read (core ai.rs
 *  picture_type: PNG, JPEG, GIF, WebP). */
export const PICTURE_IN = /\.\.\/assets\/[^)\n]*\.(png|jpe?g|gif|webp)\b/i;

/** The words in note i's picture, read by the AI, shown as sub-notes under it (not saved); Keep adds
 *  them after its own sub-notes, one Undo step. The picture stays. */
export async function startPicture(o, i) {
  const app = o.app;
  if (!aiOn()) {
    app.toast('Choose an AI first: Settings → AI.', 5000, { label: 'Open', run: () => { location.hash = '#/settings/ai'; } });
    return;
  }
  if (o.readonly || o.conflict) { app.toast('This page can’t be changed just now.', 3500); return; }
  if (!(i >= o.start && i < o.end) || !o.blocks[i]) return;
  if (o.pz) close(o.pz);
  if (o.cur === i) o.stopEdit();
  const text = o.textOf(i);
  if (!PICTURE_IN.test(text)) { app.toast('This note has no picture saved in your notes folder.', 3500); return; }
  const row = o.blockDiv(i);
  if (!row) return;
  const st = { o, i, text, row, len: o.blocks.length, depth: o.blocks[i].depth, kind: 'picture' };
  o.pz = st;
  row.classList.add('pz-on');
  const box = document.createElement('div');
  box.className = 'pz pz-pic';
  box.innerHTML = '<p class="pz-reading" aria-busy="true">Reading the picture…<span class="pz-sweep" aria-hidden="true"></span></p>';
  st.box = box;
  (row.querySelector(':scope > .bc') || row.lastChild).after(box);
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  let res;
  try {
    res = await pictureText(text);
  } catch (e) {
    close(st);
    app.toast(String(e?.message ?? e), 7000);
    return;
  }
  if (o.pz !== st) return;
  if (stale(st)) { close(st); app.toast('The note changed while the AI was working, so nothing was changed.', 5000); return; }
  box.replaceChildren();
  const motion = motionOn();
  let k = 0;
  for (const n of res.notes) {
    const v = o.viewEl(i, { text: n.text, depth: st.depth + 1 + n.depth });
    v.classList.add('pz-note', 'pz-more', 'pz-added', 'pz-new-note');
    v.style.setProperty('--pd', String(n.depth));
    if (motion) v.style.setProperty('--k', String(Math.min(k++, 24)));
    box.append(v);
  }
  const btn = (a, icon, label, cls = '') => `<button type="button" class="btn small pz-b${cls}" data-pz="${a}" aria-label="${label}" title="${label}">${icon}<span>${label}</span></button>`;
  box.insertAdjacentHTML('beforeend', `<div class="pz-bar" role="group" aria-label="The AI’s reading of the picture">${btn('keep', ICON.tick, 'Keep', ' pz-keep')}${btn('retry', ICON.retry, 'Retry', ' ghost')}${btn('undo', ICON.undoArrow, 'Undo', ' ghost')}</div>`);
  if (res.unlinked?.length) box.insertAdjacentHTML('beforeend', `<p class="note small pz-why">Left as plain words (no such page): ${res.unlinked.map(esc).join(', ')}</p>`);
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-pz]');
    if (!b) return;
    if (b.dataset.pz === 'undo') close(st);
    else if (b.dataset.pz === 'retry') { close(st); startPicture(o, i); } else if (b.dataset.pz === 'keep') {
      if (stale(st)) { close(st); app.toast('The note changed meanwhile, so nothing was changed.', 4000); return; }
      const at = o.subtreeEnd(i);
      close(st);
      o.snap();
      o.blocks.splice(at, 0, ...res.notes.map((n) => ({ depth: st.depth + 1 + n.depth, text: n.text, raw: null })));
      o.blocks[i].text = o.blocks[i].text.replace(/\ncollapsed:: true(?=\n|$)/, ''); // (open, so they show)
      o.cur = null;
      o.ta = null;
      o.render();
      o.markDirty();
      o.undoToast(`Added ${res.notes.length} note${res.notes.length === 1 ? '' : 's'} under the picture.`);
    }
  });
  st.esc = (e) => { if (e.key === 'Escape' && o.pz === st && !document.querySelector('.pop:not([hidden]), .modal-back')) { e.preventDefault(); close(st); } };
  document.addEventListener('keydown', st.esc, true);
}

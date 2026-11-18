// Polish note (Build 51; he asked, Nov 18, and picked how it looks from a clickable preview): the AI
// tidies one note (spelling, shorthand, a to-do with its date, links to pages that exist, tags already
// in use) and shows the result IN the note, without saving it: the new words fade in one after the
// other, the changed ones lightly tinted; under it one line of buttons, Keep (the only filled one, the
// look's accent), Changes, Retry and Undo. Only Keep changes the note (one Undo step, saved as any
// change). While it waits, the note's words go faint and a thin line sweeps along its foot.
// Where it starts: the ✦ at the right end of the note under the mouse (laptop), the phone toolbar's
// ✦, the note menu, "/polish" and the command list; none of them shows until an AI is set up (ai.js
// puts `ai-on` on <html>). The answer is checked by the app's Rust code first (core ai.rs).
import { polishText, aiOn } from './ai.js';
import { ICON, motionOn } from './dom.js';
import { esc } from './render.js';

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
    spark.title = 'Polish note (AI)';
    spark.setAttribute('aria-label', 'Polish note (AI)');
    spark.innerHTML = ICON.polish;
    spark.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); }); // (no drag, no editing)
    spark.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const r = spark.parentElement;
      if (r && spark.o) startPolish(spark.o, +r.dataset.i);
    });
  }
  spark.o = o;
  if (spark.parentElement !== row) row.append(spark);
}

// ---------- polishing one note ----------
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
  const old = words(st.text);
  res.notes.forEach((t, n) => {
    const v = o.viewEl(i, { text: t, depth: st.depth });
    v.classList.add('pz-note');
    if (n > 0) v.classList.add('pz-more'); // (another note it became, after this one)
    box.append(v);
  });
  // each word fades in after the one before; the ones that weren't in the note are tinted
  let k = 0;
  const motion = motionOn();
  for (const v of box.querySelectorAll('.pz-note')) {
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
        s.className = 'pz-w' + (w.length && w.some((x) => !old.has(x)) ? ' pz-new' : '');
        if (motion) s.style.setProperty('--k', String(Math.min(k++, 24)));
        s.textContent = p;
        frag.append(s);
      }
      tn.replaceWith(frag);
    }
  }
  const btn = (a, icon, label, cls = '') => `<button type="button" class="btn small pz-b${cls}" data-pz="${a}" aria-label="${label}" title="${label}">${icon}<span>${label}</span></button>`;
  box.insertAdjacentHTML('beforeend', `<div class="pz-bar" role="group" aria-label="The AI’s version">${btn('keep', ICON.tick, 'Keep', ' pz-keep')}${btn('diff', ICON.eye, 'Changes', ' ghost')}${btn('retry', ICON.retry, 'Retry', ' ghost')}${btn('undo', ICON.undoArrow, 'Undo', ' ghost')}</div>
    <div class="pz-diff"><div><div class="pz-old">${esc(st.text.split('\n').filter((l) => !/^[\w.-]+::/.test(l.trim())).join('\n'))}</div><div class="pz-newtext">${res.notes.map((t) => esc(t.split('\n').filter((l) => !/^[\w.-]+::/.test(l.trim()) || /^by::/.test(l.trim())).join('\n'))).join('\n')}</div></div></div>`);
  if (res.unlinked?.length) box.insertAdjacentHTML('beforeend', `<p class="note small pz-why">Left as plain words (no such page or tag): ${res.unlinked.map(esc).join(', ')}</p>`);
  (bc || row.lastChild).after(box);
  box.addEventListener('pointerdown', (e) => e.stopPropagation()); // (not a press on the note: no editing, no drag)
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-pz]');
    if (!b) return;
    const a = b.dataset.pz;
    if (a === 'diff') { const d = box.querySelector('.pz-diff'); d.classList.toggle('open'); b.setAttribute('aria-pressed', String(d.classList.contains('open'))); return; }
    if (a === 'undo') { close(st); return; }
    if (a === 'retry') { close(st); startPolish(o, i); return; }
    if (a === 'keep') keep(st, res);
  });
  st.esc = (e) => { if (e.key === 'Escape' && o.pz === st && !document.querySelector('.pop:not([hidden]), .modal-back')) { e.preventDefault(); close(st); } };
  document.addEventListener('keydown', st.esc, true);
}

/** Keep: the note takes the AI's words (and the notes it became go in after it and its sub-notes),
 *  as one Undo step, saved as any change. */
function keep(st, res) {
  const { o, i } = st;
  if (stale(st)) { close(st); app(st).toast('The note changed meanwhile, so nothing was changed.', 4000); return; }
  const [first, ...more] = res.notes;
  const at = o.subtreeEnd(i);
  close(st);
  o.snap();
  o.blocks[i].text = first;
  if (more.length) o.blocks.splice(at, 0, ...more.map((text) => ({ depth: st.depth, text, raw: null })));
  o.cur = null;
  o.ta = null;
  o.render();
  o.markDirty();
  const n = res.notes.length;
  o.undoToast(n === 1 ? 'Polished the note.' : `Polished the note into ${n} notes.`);
  const div = o.blockDiv(i);
  if (div && motionOn()) { div.classList.add('pz-kept'); setTimeout(() => div.classList.remove('pz-kept'), 1400); }
}

// Filter buttons (Build 37, he asked Nov 5–6): the pages a list's notes mention, as buttons, for
// Linked references and To-dos alike.
//  - A click shows only the notes mentioning that page; a second click lets it go.
//  - Right-click (or press and hold on a phone) hides the notes mentioning it instead.
//  - Chosen buttons come first, each with a small × to let it go (like a shop's filters).
//  - At most two rows of buttons, then "N more"; a find box narrows the buttons by name.
// The counts are worked out by the list (counts(): small letters → how many), so a filter typed for
// the notes narrows the buttons too. Nothing is written into the notes.
import { h } from './dom.js';
import { esc } from './render.js';

const HOLD_MS = 500; // a press this long on a phone = right-click
const ROWS = 2;

/** opts: el (the box for the buttons), counts() → Map, written() → Map (small letters → the name as
 *  written), onChange() (the picks changed: draw the list again), label (what the buttons are for). */
export function makeChips({ el, counts, written, onChange, label = 'pages' }) {
  const picks = new Map(); // small letters → 'in' | 'out'
  let more = false, find = '';
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const chip = (n, c, w) => {
    const p = picks.get(n);
    const say = p === 'in' ? `Only notes mentioning ${w}. Click to let it go` : p === 'out' ? `Notes mentioning ${w} are hidden. Click to let it go`
      : `Click: only notes mentioning ${w}. Right-click or hold: hide them`;
    return `<span class="chip ref-chip${p ? ' picked' : ''}" data-n="${esc(n)}"${p ? ` data-pick="${p}"` : ''} role="button" tabindex="0" aria-pressed="${p ? 'true' : 'false'}" title="${esc(say)}">`
      + `${p === 'out' ? '<s>' : ''}${esc(w)}${p === 'out' ? '</s>' : ''} <span class="n">${c ?? ''}</span>`
      + (p ? `<button type="button" class="chip-x" tabindex="-1" aria-label="Let ${esc(w)} go" title="Let it go">×</button>` : '') + '</span>';
  };
  const draw = () => {
    const cs = counts(), ws = written();
    for (const n of [...picks.keys()]) if (!cs.has(n) && !ws.has(n)) picks.delete(n); // (gone from the list)
    const f = fold(find);
    const chosen = [...picks.keys()];
    const rest = [...cs.keys()].filter((n) => !picks.has(n) && (!f || fold(ws.get(n) || n).includes(f)))
      .sort((a, b) => cs.get(b) - cs.get(a) || a.localeCompare(b));
    el.innerHTML = chosen.map((n) => chip(n, cs.get(n), ws.get(n) || n)).join('')
      + rest.map((n) => chip(n, cs.get(n), ws.get(n) || n)).join('')
      + '<button type="button" class="chip ref-more" hidden></button>';
    el.hidden = !chosen.length && cs.size < 2 && !f; // (one page only: nothing to choose between)
    if (!f && !rest.length && !chosen.length) el.hidden = true;
    if (f && !rest.length && !chosen.length) el.insertAdjacentHTML('afterbegin', `<span class="note chip-none">No ${esc(label)} match “${esc(find)}”.</span>`);
    fit();
  };
  // at most two rows (unless "more" was asked for): the rest hide behind "N more"
  const fit = () => {
    const btn = el.querySelector('.ref-more');
    if (!btn || el.hidden) return;
    const all = [...el.querySelectorAll('.ref-chip')];
    all.forEach((c) => { c.hidden = false; });
    btn.hidden = true;
    if (more || !el.offsetParent) return; // (not on the screen yet: nothing to measure)
    const tops = [...new Set(all.map((c) => c.offsetTop))].sort((a, b) => a - b);
    if (tops.length <= ROWS) return;
    const last = tops[ROWS - 1];
    let hidden = all.filter((c) => c.offsetTop > last && !c.classList.contains('picked'));
    hidden.forEach((c) => { c.hidden = true; });
    btn.hidden = false;
    // "N more" itself must fit on the second row: hide more buttons until it does
    const shown = all.filter((c) => !c.hidden && !c.classList.contains('picked'));
    while (btn.offsetTop > last && shown.length) { const c = shown.pop(); c.hidden = true; hidden = [...hidden, c]; }
    btn.textContent = `${hidden.length} more`;
  };
  const toggle = (n, how) => {
    if (picks.get(n) === how || (how === 'in' && picks.has(n))) picks.delete(n); else picks.set(n, how);
    draw(); onChange();
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('.ref-more')) { more = true; fit(); return; }
    const c = e.target.closest('.ref-chip');
    if (!c) return;
    if (c.dataset.held) { delete c.dataset.held; return; } // (a hold already hid it)
    if (e.target.closest('.chip-x')) { picks.delete(c.dataset.n); draw(); onChange(); return; }
    toggle(c.dataset.n, 'in');
  });
  el.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.ref-chip');
    if (!c) return;
    e.preventDefault();
    toggle(c.dataset.n, 'out');
  });
  el.addEventListener('keydown', (e) => { // Enter / Space: as a click; Shift+F10 or the menu key: hide
    const c = e.target.closest('.ref-chip');
    if (!c) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.dataset.n, 'in'); }
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); toggle(c.dataset.n, 'out'); }
  });
  let timer = null;
  el.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.ref-chip');
    if (!c || e.pointerType === 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(() => { c.dataset.held = '1'; toggle(c.dataset.n, 'out'); }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => clearTimeout(timer));
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (!more) fit(); }).observe(el);
  return {
    picks,
    draw,
    /** narrow the buttons to names containing these words */
    find(words) { find = words; draw(); },
    clear() { picks.clear(); find = ''; more = false; draw(); },
    /** does a note with these page names (a Set of small letters) pass the picks? */
    passes(names) {
      for (const [n, p] of picks) if ((p === 'in') !== names.has(n)) return false;
      return true;
    },
  };
}

/** A find box for the buttons (a small search field above them). */
export const chipFind = (label) => {
  const box = h('label', 'chip-find');
  box.innerHTML = `<input type="search" placeholder="Find a page" aria-label="Find a ${esc(label)} button" autocomplete="off" spellcheck="false">`;
  return box;
};

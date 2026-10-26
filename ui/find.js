// Find and replace on the page that's open (Ctrl+F, Ctrl+H; on phones: the page's "…" menu).
// Looks through the notes' own text (what the file holds, so replacing changes exactly that),
// highlights what it finds on screen without touching the page (CSS highlights) and replaces
// through the editor, so Undo works and saving merges with changes made elsewhere as usual.
// In the Journals list it looks through every day shown.
import { ICON } from './dom.js';
import { confirmBox } from './popups.js';
import { esc } from './render.js';
import { HIDDEN_PROPS, PROP, MARKERS, hasEnd } from './render.js';
import { findMath } from './math.js';

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hiddenKey = (k) => HIDDEN_PROPS.has(k) || k.startsWith('card-') || k.startsWith('hl-');
/** The parts of a note's text that aren't shown as typed (so find never matches, and Replace never
 *  changes, what can't be seen): hidden properties (id::, collapsed::, heading::…, on any line),
 *  SCHEDULED/DEADLINE lines (shown as date chips), :LOGBOOK: drawers, #+BEGIN_/#+END_ lines, the ">"
 *  and [!KIND] of quotes, link addresses, block references and {{macros}}. [from, to) pairs. */
function hiddenSpans(text) {
  const out = [];
  let pos = 0, drawer = false, fence = false, math = false, first = true, box = null;
  const lines = text.split('\n');
  lines.forEach((l, li) => {
    const t = l.trim();
    const end = pos + l.length;
    if (first && !fence) { // the first line's to-do word, priority and heading marks show as a box/chips/size
      first = false;
      const mm = l.match(MARKERS);
      let at = mm ? mm[0].length : 0;
      if (mm) { if (l[at] === ' ') at++; out.push([pos, pos + at]); }
      const pr = l.slice(at).match(/^\[#[A-Ca-c]\]\s?/) || l.slice(at).match(/\s\[#[A-Ca-c]\](?=\s|$)/);
      if (pr) out.push([pos + at + pr.index, pos + at + pr.index + pr[0].length]);
      const h = l.slice(at).match(/^#{1,6}\s+/);
      if (h) out.push([pos + at, pos + at + h[0].length]);
    }
    const begin = !fence && box === null && t.match(/^#\+BEGIN_(\w+)/i);
    if (t.startsWith('```')) { fence = !fence; out.push([pos, end]); }
    else if (fence) { /* code: shown as typed */ }
    else if (box === null && (math || t === '$$')) { out.push([pos, end]); if (t === '$$') math = !math; } // a formula shows as one, not as typed
    else if (begin && hasEnd(lines, li, begin[1])) { box = begin[1].toUpperCase(); out.push([pos, end]); } // as render.js
    else if (box !== null && t.toUpperCase() === '#+END_' + box) { box = null; out.push([pos, end]); }
    else if (drawer || /^:[A-Za-z-]+:$/.test(t)) { out.push([pos, end]); drawer = drawer ? !/^:END:$/i.test(t) : true; }
    else if (/^(SCHEDULED|DEADLINE):/.test(t) || (PROP.test(l) && hiddenKey(l.match(PROP)[1].toLowerCase()))) out.push([pos, end]);
    else {
      const q = l.match(/^\s*>\s?(\[![\w-]+\][+-]?\s*)?/);
      if (q) out.push([pos, pos + q[0].length]);
      for (const m of l.matchAll(/!\[[^\]\n]*\]\([^)\n]*\)|\]\([^)\n]*\)|\(\([0-9a-f-]{36}\)\)|\{\{[^}]*\}\}/g)) out.push([pos + m.index, pos + m.index + m[0].length]);
      for (const f of findMath(l)) out.push([pos + f.start, pos + f.end]); // $…$ formulas (render.js inline)
    }
    pos = end + 1;
  });
  return out;
}
/** Order of two places in the page: which day (n), which note (i), where in it (at). */
const cmp = (a, b) => a.n - b.n || a.i - b.i || a.at - b.at;

export class Find {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('findbar');
    this.matches = []; // {o, n, i, at, len}: outline, its place among the page's outlines, note, where
    this.k = -1; // the current one
    this.caseOn = false;
    this.shown = []; // notes inside a folded note, shown for a moment to show what was found
  }
  get isOpen() { return !!this.el && !this.el.hidden; }

  build() {
    this.el.setAttribute('role', 'search');
    this.el.innerHTML = `<div class="fb-row">
        <input class="fb-q" type="text" placeholder="Find on this page" aria-label="Find on this page" autocomplete="off" spellcheck="false" enterkeyhint="search">
        <span class="fb-n" aria-live="polite"></span>
        <button type="button" data-f="prev" aria-label="Previous" title="Previous (Shift+Enter)">${ICON.up}</button>
        <button type="button" data-f="next" aria-label="Next" title="Next (Enter)">${ICON.down}</button>
        <button type="button" data-f="case" aria-pressed="false" aria-label="Match capital letters" title="Match capital letters">Aa</button>
        <button type="button" data-f="rep" aria-expanded="false" aria-label="Replace" title="Replace (Ctrl+H)">${ICON.replace}</button>
        <button type="button" data-f="close" aria-label="Close" title="Close (Esc)">${ICON.winClose}</button>
      </div>
      <div class="fb-row fb-rep" hidden>
        <input class="fb-r" type="text" placeholder="Replace with" aria-label="Replace with" autocomplete="off" spellcheck="false" enterkeyhint="done">
        <button type="button" class="fb-txt" data-f="one">Replace</button>
        <button type="button" class="fb-txt" data-f="all">Replace all</button>
      </div>`;
    this.q = this.el.querySelector('.fb-q');
    this.r = this.el.querySelector('.fb-r');
    this.n = this.el.querySelector('.fb-n');
    let t = 0;
    this.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.fresh(), 120); });
    // typing in the boxes after a replace: Ctrl+Z is theirs again (it undid the replace until then)
    this.el.addEventListener('input', () => { this.undo = null; });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && this.canUndo) { e.preventDefault(); e.stopPropagation(); this.undoReplace(); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (e.target === this.r) this.replaceOne();
      else if (e.target === this.q) { clearTimeout(t); this.step(e.shiftKey ? -1 : 1); }
    });
    // the buttons don't take the focus from the boxes (keeps a phone's keyboard open)
    this.el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    this.el.addEventListener('click', (e) => {
      const f = e.target.closest('button')?.dataset.f;
      if (!f) return;
      if (f === 'prev' || f === 'next') { clearTimeout(t); this.step(f === 'prev' ? -1 : 1); }
      if (f === 'case') { this.caseOn = !this.caseOn; e.target.closest('button').setAttribute('aria-pressed', String(this.caseOn)); this.fresh(); }
      if (f === 'rep') this.showReplace(this.el.querySelector('.fb-rep').hidden);
      if (f === 'close') this.close();
      if (f === 'one') this.replaceOne();
      if (f === 'all') this.replaceAll();
    });
  }

  /** Open the bar (or go back to it), starting with the words selected on the page, if any. */
  open(replace = false) {
    if (!this.q) this.build();
    const o = this.app.outlines.find((x) => x.ta && x.cur !== null);
    let sel = o && o.ta.selectionStart !== o.ta.selectionEnd ? o.ta.value.slice(o.ta.selectionStart, o.ta.selectionEnd) : String(window.getSelection() || '');
    if (sel.includes('\n') || sel.length > 120) sel = '';
    o?.stopEdit(); // what was being edited shows as text again, so it can be highlighted
    this.el.hidden = false;
    document.documentElement.classList.add('finding');
    if (replace) this.showReplace(true);
    if (sel) this.q.value = sel;
    this.q.focus();
    this.q.select();
    if (this.q.value) this.fresh(); else this.count();
    this.app.pinSoon(); // on a phone the notes now start below the bar
  }
  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    document.documentElement.classList.remove('finding');
    this.matches = [];
    this.k = -1;
    this.unreveal();
    this.paint();
    if (this.el.contains(document.activeElement)) document.activeElement.blur();
    this.app.pinSoon();
  }
  showReplace(on) {
    this.el.querySelector('.fb-rep').hidden = !on;
    this.el.querySelector('[data-f="rep"]').setAttribute('aria-expanded', String(on));
    if (on) (this.q.value ? this.r : this.q).focus();
  }

  re() { return new RegExp(reEsc(this.q.value), this.caseOn ? 'gu' : 'giu'); }

  /** Every place the words appear in the notes on screen, in page order. */
  search() {
    const out = [];
    if (this.q?.value) {
      const re = this.re();
      this.app.outlines.forEach((o, n) => {
        for (let i = o.start; i < o.end; i++) {
          const text = o.textOf(i);
          re.lastIndex = 0;
          let m = re.exec(text);
          if (!m) continue;
          const skip = hiddenSpans(text);
          for (; m; m = re.exec(text)) {
            if (!m[0].length) { re.lastIndex++; continue; }
            if (!skip.some(([a, b]) => m.index < b && m.index + m[0].length > a)) out.push({ o, n, i, at: m.index, len: m[0].length });
          }
        }
      });
    }
    this.matches = out;
  }

  /** The words changed: look again, starting from the first place at or below the top of the screen. */
  fresh() {
    this.search();
    const top = this.viewTop();
    const k = this.matches.findIndex((m) => {
      const d = m.o.drawn > m.i ? m.o.blockDiv(m.i) : null;
      return d && !d.hidden && d.getBoundingClientRect().bottom > top;
    });
    this.show(this.matches.length ? Math.max(0, k) : -1);
  }

  /** Where the notes show from on screen: below the top bar, this bar and any pinned parents. */
  viewTop() {
    let top = Math.max(this.app.scroller().top, this.el.hidden ? 0 : this.el.getBoundingClientRect().bottom);
    for (const o of this.app.outlines) if (o.pins && !o.pins.hidden) top = Math.max(top, o.pins.firstChild.getBoundingClientRect().bottom); // the rows (.pins itself is 0 px tall)
    return top;
  }

  /** Next (dir 1) or previous (-1) place, going round at the ends. */
  step(dir) {
    const cur = this.matches[this.k];
    this.search(); // fresh: the notes may have changed, or more days come into the list
    if (!this.matches.length) { this.show(-1); return; }
    let k;
    if (!cur) k = dir > 0 ? 0 : this.matches.length - 1;
    else if (dir > 0) { k = this.matches.findIndex((m) => cmp(m, cur) > 0); if (k < 0) k = 0; }
    else { k = this.matches.findLastIndex((m) => cmp(m, cur) < 0); if (k < 0) k = this.matches.length - 1; }
    this.show(k);
  }

  /** Make place k the current one: scroll it into view (unless it's on screen) and highlight. */
  show(k) {
    this.k = k;
    this.unreveal();
    const m = this.matches[k];
    if (m) {
      m.o.ensureDrawn(m.i);
      const div = m.o.blockDiv(m.i);
      if (div?.hidden) { div.hidden = false; this.shown.push([m.o, m.i]); } // inside a folded note
      if (div) {
        const r = div.getBoundingClientRect();
        const top = this.viewTop();
        if (r.top < top || r.bottom > window.innerHeight - 40) div.scrollIntoView({ block: 'center' });
      }
    }
    this.paint();
    this.count();
  }
  /** Fold away again what was shown from inside folded notes. */
  unreveal() {
    for (const [o, i] of this.shown) {
      const div = o.blockDiv(i);
      if (div && o.cur !== i && o.hiddenSet().has(i)) div.hidden = true;
    }
    this.shown = [];
  }
  count() {
    const n = this.matches.length;
    this.n.textContent = !this.q.value ? '' : n ? `${this.k + 1} of ${n}` : 'Not found';
    this.n.classList.toggle('none', !!this.q.value && !n);
  }

  /** Highlight the words on screen: all of them, and the current one more strongly. A note whose
   *  shown text differs from its file text (e.g. the words are in a hidden link address) gets
   *  .find-cur instead when it holds the current one. */
  paint() {
    document.querySelectorAll('.blk.find-cur').forEach((d) => d.classList.remove('find-cur'));
    const hl = window.CSS?.highlights;
    hl?.delete('find');
    hl?.delete('find-cur');
    if (!this.matches.length) return;
    const cur = this.matches[this.k];
    const all = [];
    const now = [];
    let curDone = !cur;
    const re = this.re();
    const seen = new Set();
    for (const m of this.matches) {
      const key = m.n + ':' + m.i;
      if (seen.has(key)) continue;
      seen.add(key);
      const div = m.o.drawn > m.i ? m.o.blockDiv(m.i) : null;
      const bc = div?.querySelector(':scope > .bc');
      if (!bc || div.hidden) continue;
      const ranges = hl ? rangesIn(bc, re) : [];
      all.push(...ranges);
      if (cur && cur.o === m.o && cur.i === m.i) {
        const mine = this.matches.filter((x) => x.o === m.o && x.i === m.i);
        const idx = mine.indexOf(cur);
        if (ranges.length === mine.length && ranges[idx]) now.push(ranges[idx]); else div.classList.add('find-cur');
        curDone = true;
      }
      if (all.length > 3000 && curDone) break; // enough for any screen
    }
    if (hl && all.length) { hl.set('find', new Highlight(...all)); if (now.length) hl.set('find-cur', new Highlight(...now)); }
  }

  /** Replace the current place, then go to the next one. */
  replaceOne() {
    if (!this.q.value) return;
    let m = this.matches[this.k];
    if (!m) { this.step(1); m = this.matches[this.k]; if (!m) return; }
    const { o, n, i, at } = m;
    if (o.readonly) { this.app.toast('This page can only be read here, so nothing in it can be replaced.'); return; }
    const re = this.re();
    re.lastIndex = at;
    const hit = re.exec(o.textOf(i));
    if (!hit || hit.index !== at) { this.fresh(); return; } // the note changed meanwhile: look again
    const rep = this.r.value;
    o.snap();
    o.setText(i, (t) => t.slice(0, at) + rep + t.slice(at + hit[0].length));
    this.remember([o]);
    this.search();
    const k = this.matches.findIndex((x) => cmp(x, { n, i, at: at + rep.length }) >= 0);
    this.show(this.matches.length ? (k < 0 ? 0 : k) : -1);
  }

  /** Replace every place on the page at once (one Undo step per page; asks first when the
   *  places are in several pages, e.g. days in the Journals list). */
  async replaceAll() {
    this.search();
    if (!this.matches.length) { this.count(); return; }
    const rep = this.r.value;
    const byOutline = new Map();
    for (const m of this.matches) {
      if (!byOutline.has(m.o)) byOutline.set(m.o, new Map());
      const blocks = byOutline.get(m.o);
      if (!blocks.has(m.i)) blocks.set(m.i, []);
      blocks.get(m.i).push(m);
    }
    const writable = [...byOutline.keys()].filter((o) => !o.readonly);
    if (writable.length > 1) {
      const n = this.matches.filter((m) => !m.o.readonly).length;
      const ok = await confirmBox({ title: `Replace ${n} places in ${writable.length} pages?`, body: `They are in ${writable.map((o) => `“${esc(o.name)}”`).join(', ')}.`, ok: 'Replace all' });
      if (this.isOpen) this.r.focus(); // back in the bar (Ctrl+Z there undoes the replace)
      if (!ok || !this.isOpen) return;
      this.search(); // (the notes may have changed while the question was open)
      if (!this.matches.length) { this.count(); return; }
      byOutline.clear();
      for (const m of this.matches) {
        if (!byOutline.has(m.o)) byOutline.set(m.o, new Map());
        const blocks = byOutline.get(m.o);
        if (!blocks.has(m.i)) blocks.set(m.i, []);
        blocks.get(m.i).push(m);
      }
    }
    let done = 0, kept = 0;
    const changed = [];
    for (const [o, blocks] of byOutline) {
      if (o.readonly) { for (const l of blocks.values()) kept += l.length; continue; }
      o.snap();
      changed.push(o);
      for (const [i, list] of blocks) {
        o.setText(i, (t) => list.reduceRight((s, m) => s.slice(0, m.at) + rep + s.slice(m.at + m.len), t));
        done += list.length;
      }
    }
    this.remember(changed);
    let msg = done ? `Replaced ${done}${changed.length > 1 ? ` in ${changed.length} pages` : ''}.` : '';
    if (kept) msg += ` ${kept} in a page that can only be read here stayed as they were.`;
    this.app.toast(msg.trim(), 6000, done ? { label: 'Undo', run: () => this.undoReplace() } : null);
    this.fresh();
  }

  /** What a replace changed, so it can be undone from the bar (Ctrl+Z) or the message's Undo: each
   *  page and the Undo step the replace made there (still the newest = nothing done there since). */
  remember(outlines) { this.undo = outlines.map((o) => [o, o.undoStack.at(-1)]); }
  get canUndo() { return !!this.undo?.some(([o, step]) => this.app.outlines.includes(o) && o.undoStack.at(-1) === step); }
  /** Undo the last replace in each page it changed, if nothing else was done there since. */
  undoReplace() {
    const list = this.undo || [];
    this.undo = null;
    let n = 0;
    for (const [o, step] of list) {
      if (!this.app.outlines.includes(o) || o.undoStack.at(-1) !== step) continue; // gone, or edited since
      o.undo();
      n++;
    }
    if (!n && list.length) this.app.toast('That page was changed since, so use Undo in the page itself.', 3500);
    if (this.isOpen) this.fresh();
  }
}

/** Ranges of every place re matches in the text shown in el (the words may span bold, links…).
 *  Words the app adds itself (date chips, to-do words, priorities, a box's default title) aren't
 *  the note's text, so they're left out. */
const MADE = '.dates, .mk, .prio, [data-auto]';
function rangesIn(el, re) {
  const nodes = [];
  let flat = '';
  const made = [...el.querySelectorAll(MADE)]; // (most notes have none: then no filter at all)
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, made.length ? { acceptNode: (t) => (made.some((m) => m.contains(t)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) } : null);
  for (let t = w.nextNode(); t; t = w.nextNode()) { nodes.push([t, flat.length]); flat += t.data; }
  const out = [];
  if (!nodes.length) return out;
  const at = (pos) => { // the text node and offset of a position in flat
    let lo = 0, hi = nodes.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid][1] <= pos) lo = mid; else hi = mid - 1; }
    return [nodes[lo][0], pos - nodes[lo][1]];
  };
  re.lastIndex = 0;
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    if (!m[0].length) { re.lastIndex++; continue; }
    const r = new Range();
    const [sn, so] = at(m.index);
    const [en, eo] = at(m.index + m[0].length - 1);
    r.setStart(sn, so);
    r.setEnd(en, eo + 1);
    out.push(r);
  }
  return out;
}

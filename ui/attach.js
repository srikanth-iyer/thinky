// "Show attachments on this page" (Build 48, his request of Nov 13): from the page's ⋯ menu. Every note
// on the page that links to a file in assets/ (pictures, PDFs, any file) is highlighted, a small bar
// says how many, ↑ / ↓ (or the bar's arrows) step between them as find does, and Esc, the bar's ×
// or the menu item again clear it. Which files a note links to is the core's rule
// (core/src/app/pictures.rs `asset_links`, the same as Check this folder's missing files), asked
// once when it opens; the bar floats at the bottom of the window (over the notes, on a phone too); notes inside a folded note are shown for a moment when stepped to, as find
// shows them, and folded away again (nothing in the file changes). Loaded on first use.
import { call } from './api.js';
import { ICON, plural } from './dom.js';

export class Attachments {
  constructor(app) {
    this.app = app;
    this.hits = []; // {o, b}: the outline and the note (its block object: found again after a redraw)
    this.k = -1; // the current one
    this.shown = []; // [o, i]: rows inside a folded note shown for a moment
    this.el = null;
  }
  get on() { return !!this.el && !this.el.hidden; }

  build() {
    this.el = document.createElement('div');
    this.el.id = 'attbar';
    this.el.hidden = true;
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Attachments on this page');
    this.el.innerHTML = `<div class="fb-row">
        <span class="ab-what"></span>
        <span class="fb-n" aria-live="polite"></span>
        <button type="button" data-f="prev" aria-label="Previous" title="Previous (↑)">${ICON.up}</button>
        <button type="button" data-f="next" aria-label="Next" title="Next (↓)">${ICON.down}</button>
        <button type="button" data-f="close" aria-label="Clear" title="Clear (Esc)">${ICON.winClose}</button>
      </div>`;
    document.body.append(this.el);
    this.el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    this.el.addEventListener('click', (e) => {
      const f = e.target.closest('button')?.dataset.f;
      if (f === 'prev' || f === 'next') this.step(f === 'prev' ? -1 : 1);
      if (f === 'close') this.close();
    });
  }

  /** Open it for the outlines on the active side (or close it, when it's on already). */
  async toggle() {
    if (this.on) { this.close(); return; }
    if (!this.el) this.build();
    const outlines = this.app.pane.outlines.filter((o) => this.app.shows(o) && !o.preview);
    for (const o of outlines) { o.stopEdit(); o.clearSel(); }
    const notes = outlines.flatMap((o) => o.blocks.slice(o.start, o.end).map((b) => ({ o, b })));
    let files;
    try { files = await call('asset_links', { texts: notes.map((x) => x.b.text) }); }
    catch (e) { this.app.toast(String(e?.message ?? e), 5000); return; }
    this.hits = notes.filter((_, n) => files[n]?.length);
    this.files = new Map(this.hits.map((x) => [x.b, files[notes.indexOf(x)]]));
    this.outs = outlines;
    // (what each outline's notes were when asked: a redraw with the same words asks nothing again)
    this.seen = new Map(outlines.map((o) => [o, o.blocks.slice(o.start, o.end).map((b) => b.text).join('\u0000')]));
    this.el.hidden = false;
    this.k = -1;
    this.what();
    for (const o of outlines) this.paint(o);
    // the first one at or below the top of the screen
    const top = this.app.find.viewTop();
    const k = this.hits.findIndex((x) => { const d = this.div(x); return d && !d.hidden && d.getBoundingClientRect().bottom > top; });
    if (this.hits.length) this.show(Math.max(0, k)); else this.count();
    this.app.pinSoon?.();
  }

  close() {
    if (!this.el || this.el.hidden) return;
    this.unreveal();
    this.el.hidden = true;
    clearTimeout(this.againT);
    const outs = new Set([...this.hits.map((x) => x.o), ...(this.outs || [])]);
    this.hits = [];
    this.k = -1;
    for (const o of outs) this.paint(o);
    this.app.pinSoon?.();
  }

  /** The note's index in its outline now (notes move as the page changes), or -1 if it's gone. */
  at(x) { return x.o.el.isConnected ? x.o.blocks.indexOf(x.b) : -1; }
  div(x) { const i = this.at(x); return i >= x.o.start && i < x.o.end && x.o.drawn > i ? x.o.blockDiv(i) : null; }

  /** Mark outline o's drawn rows (after it draws them: Outline.render, drawMore). The file names show
   *  when the mouse rests on a lit note; they go with the light (Build 49: they stayed). */
  paint(o) {
    if (!o.divs) return;
    for (const d of o.el.querySelectorAll('.blk.att-hit')) {
      d.classList.remove('att-hit', 'att-cur');
      if (d.dataset.attTip) { d.removeAttribute('title'); delete d.dataset.attTip; }
    }
    if (!this.on) return;
    this.hits.forEach((x, n) => {
      if (x.o !== o) return;
      const d = this.div(x);
      if (!d) return;
      d.classList.add('att-hit');
      d.classList.toggle('att-cur', n === this.k);
      d.title = this.files.get(x.b).join('\n');
      d.dataset.attTip = '1';
    });
    if (!this.asking) this.again(o);
  }

  /** The page changed while it's on (a link typed or taken out, a note added): its notes are asked
   *  about again a moment later and the count follows (Build 49: only the notes found at the start
   *  were counted). The current note stays the current one when it's still a hit. */
  again(o) {
    clearTimeout(this.againT);
    const key = o.blocks.slice(o.start, o.end).map((b) => b.text).join('\u0000');
    if (this.seen?.get(o) === key) return;
    this.againT = setTimeout(async () => {
      if (!this.on || !o.el.isConnected) return;
      const notes = o.blocks.slice(o.start, o.end);
      let files;
      try { files = await call('asset_links', { texts: notes.map((b) => b.text) }); } catch { return; }
      if (!this.on) return;
      this.seen.set(o, key);
      const cur = this.hits[this.k]?.b;
      const mine = notes.map((b, n) => ({ o, b, f: files[n] })).filter((x) => x.f?.length);
      for (const x of mine) this.files.set(x.b, x.f);
      // this outline's hits replaced, in page order among the others
      const all = [...this.hits.filter((x) => x.o !== o), ...mine.map(({ o: oo, b }) => ({ o: oo, b }))];
      const order = (x) => [this.outs.indexOf(x.o), x.o.blocks.indexOf(x.b)];
      all.sort((p, q) => { const [a1, a2] = order(p), [b1, b2] = order(q); return a1 - b1 || a2 - b2; });
      this.hits = all;
      this.k = cur ? this.hits.findIndex((x) => x.b === cur) : -1;
      this.what();
      this.asking = true;
      for (const oo of new Set(this.outs)) this.paint(oo);
      this.asking = false;
      this.count();
    }, 400);
  }

  /** The bar's words: how many notes, how many files. */
  what() {
    const many = new Set(this.hits.flatMap((x) => this.files.get(x.b) || [])).size;
    this.el.querySelector('.ab-what').textContent = this.hits.length
      ? `${plural(this.hits.length, 'note')} with ${plural(many, 'attachment')}`
      : 'No note on this page links to a file in assets';
    this.el.querySelectorAll('[data-f="prev"], [data-f="next"]').forEach((b) => { b.disabled = !this.hits.length; });
  }

  step(dir) {
    const live = this.hits.filter((x) => this.at(x) >= 0);
    if (!live.length) return;
    const n = this.hits.length;
    let k = this.k;
    for (let t = 0; t < n; t++) { k = (k + dir + n) % n; if (this.at(this.hits[k]) >= 0) break; }
    this.show(k);
  }

  /** Make hit k the current one: shown (from inside a folded note too), scrolled to, marked. */
  show(k) {
    this.unreveal();
    this.k = k;
    const x = this.hits[k];
    const i = x ? this.at(x) : -1;
    if (i >= 0) {
      this.app.unfoldFor?.(x.o);
      x.o.ensureDrawn(i);
      const div = x.o.blockDiv(i);
      if (div?.hidden) { div.hidden = false; this.shown.push([x.o, i]); }
      if (div) {
        const r = div.getBoundingClientRect();
        if (r.top < this.app.find.viewTop() || r.bottom > window.innerHeight - 40) div.scrollIntoView({ block: 'center' });
      }
    }
    for (const o of new Set(this.hits.map((h) => h.o))) this.paint(o);
    this.count();
  }
  unreveal() {
    for (const [o, i] of this.shown) {
      const div = o.blockDiv(i);
      if (div && o.cur !== i && o.hiddenSet().has(i)) div.hidden = true;
    }
    this.shown = [];
  }
  count() {
    const n = this.el.querySelector('.fb-n');
    n.textContent = this.hits.length && this.k >= 0 ? `${this.k + 1} of ${this.hits.length}` : '';
  }

  /** Keys while it's on and nothing is typed in or selected: ↑ / ↓ step, Esc clears. true: handled. */
  key(e) {
    if (!this.on || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    if (e.key === 'Escape') { this.close(); return true; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.hits.length) { this.step(e.key === 'ArrowUp' ? -1 : 1); return true; }
    return false;
  }
}

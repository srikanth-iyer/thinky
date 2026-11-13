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
    this.el.hidden = false;
    document.documentElement.classList.add('attaching');
    this.k = -1;
    const many = new Set(this.hits.flatMap((x) => this.files.get(x.b))).size;
    this.el.querySelector('.ab-what').textContent = this.hits.length
      ? `${plural(this.hits.length, 'note')} with ${plural(many, 'attachment')}`
      : 'No note on this page links to a file in assets';
    this.el.querySelectorAll('[data-f="prev"], [data-f="next"]').forEach((b) => { b.disabled = !this.hits.length; });
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
    document.documentElement.classList.remove('attaching');
    const outs = new Set(this.hits.map((x) => x.o));
    this.hits = [];
    this.k = -1;
    for (const o of outs) this.paint(o);
    this.app.pinSoon?.();
  }

  /** The note's index in its outline now (notes move as the page changes), or -1 if it's gone. */
  at(x) { return x.o.el.isConnected ? x.o.blocks.indexOf(x.b) : -1; }
  div(x) { const i = this.at(x); return i >= x.o.start && i < x.o.end && x.o.drawn > i ? x.o.blockDiv(i) : null; }

  /** Mark outline o's drawn rows (after it draws them: Outline.render, drawMore). */
  paint(o) {
    if (!o.divs) return;
    for (const d of o.el.querySelectorAll('.blk.att-hit')) d.classList.remove('att-hit', 'att-cur');
    if (!this.on) return;
    this.hits.forEach((x, n) => {
      if (x.o !== o) return;
      const d = this.div(x);
      if (!d) return;
      d.classList.add('att-hit');
      d.classList.toggle('att-cur', n === this.k);
      d.title = this.files.get(x.b).join('\n');
    });
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

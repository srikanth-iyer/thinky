// Outline editor for one page. Model = the backend's Doc ({preamble, blocks, indent, crlf}).
// Typing updates the model in place; structural edits (split, merge, indent, move) re-render.
// Saving is debounced; the backend merges changes made elsewhere meanwhile, or refuses and
// the user chooses (the other version is kept as a backup copy).

import { call, today, nowTime } from './api.js';
import { renderBlock, propsHtml, datesHtml, esc, PROP, MARKERS, parseStamp, stampText, withPictureSize } from './render.js';
import { pickDate, caretRect } from './popups.js';
import { openClash } from './clash.js';

const HIDE = /^\s*(id|collapsed)::/i; // Logseq bookkeeping: never shown in the editing box
const COLLAPSED_RE = /\ncollapsed:: true(?=\n|$)/;
const OPEN = new Set(['TODO', 'DOING', 'LATER', 'NOW', 'WAITING', 'WAIT', 'IN-PROGRESS', 'STARTED']);
const CHUNK = 300; // blocks drawn at once; the rest follow right after (long pages)
export const PIN_H = 30; // height of a pinned parent's row (px; app.css .pin)
export const EDGE = 48; // phones: a swipe starting this close to the left edge opens the menu instead (app.js)
const SWIPE = 56; // how far a swipe goes to move a note in or out a level (px)
const nl = (s) => (s.match(/\n/g) || []).length;
const isProp = (l) => PROP.test(l);
const clone = (x) => JSON.parse(JSON.stringify(x));
/** What a page says (properties, and each note's level and words): equal keys, same version. */
const docKey = (d) => JSON.stringify([d.preamble, d.blocks.map((b) => [b.depth, b.text])]);
/** How much the text size setting zooms the page at el: its size on screen over its own size. */
const zoomOf = (el, rect = el.getBoundingClientRect()) => (el.offsetWidth ? rect.width / el.offsetWidth : 1) || 1;

/** Text without id::/collapsed:: lines (for the editing box), and where they were. */
export function splitHidden(text) {
  const shown = [];
  const hidden = [];
  text.split('\n').forEach((l, k) => (k > 0 && HIDE.test(l) ? hidden.push({ pos: k, line: l }) : shown.push(l)));
  return { shown: shown.join('\n'), hidden };
}
export function joinHidden(shown, hidden) {
  if (!hidden.length) return shown;
  const lines = shown.split('\n');
  for (const h of hidden) lines.splice(Math.min(h.pos, lines.length), 0, h.line);
  return lines.join('\n');
}
/** End of the last line that isn't a property: where "the end of the block" is for typing. */
export function contentEnd(s) {
  let pos = 0;
  let end = 0;
  s.split('\n').forEach((l, k) => { if (k === 0 || !isProp(l)) end = pos + l.length; pos += l.length + 1; });
  return end;
}
const propKey = (l) => l.match(PROP)?.[1].toLowerCase();

export class Outline {
  /** host: element to render into. view: PageView from the backend. app: shared app services.
   *  opts.zoomLine: show only the block starting at this file line (and its children). */
  constructor(host, view, app, opts = {}) {
    this.app = app;
    this.host = host;
    this.zoomLine = opts.zoomLine ?? null;
    this.banner = document.createElement('div');
    this.banner.hidden = true;
    this.crumbs = document.createElement('nav');
    this.crumbs.className = 'crumbs';
    this.crumbs.hidden = true;
    this.el = document.createElement('div');
    this.el.className = 'outline';
    // parents of the note at the top of the screen, pinned there while scrolling (pinParents)
    this.pins = document.createElement('div');
    this.pins.className = 'pins';
    this.pins.hidden = true;
    this.pins.innerHTML = '<div class="pins-in"></div>';
    this.pinned = '';
    host.append(this.banner, this.crumbs, this.pins, this.el);
    this.cur = null; // index of the block being edited
    this.ta = null;
    this.sel = null; // selected blocks {a, b} (anchor, head)
    this.undoStack = [];
    this.redoStack = [];
    this.load(view);
    this.bindEvents();
    this.render();
  }

  load(view) {
    this.name = view.info.name;
    this.path = view.info.path;
    this.exists = view.info.exists;
    this.journal = view.info.journal;
    this.doc = view.doc;
    this.hash = view.hash;
    this.readonly = !!view.readonly;
    this.error = view.error || null;
    this.dirty = false;
    this.conflict = false;
    // what the file holds now, for merging with changes made elsewhere
    this.base = view.from_template ? { ...clone(view.doc), blocks: [] } : clone(view.doc);
    if (!this.doc.blocks.length) this.doc.blocks.push({ depth: 0, text: '', raw: null });
    this.root = this.zoomLine === null ? null : this.indexForLine(this.zoomLine);
    if (this.error) this.showBanner(`<span>${esc(this.error)}</span>`);
  }

  get blocks() { return this.doc.blocks; }
  /** Blocks shown: the whole page, or the zoomed-in block and its children. */
  get start() { return this.root ?? 0; }
  get end() { return this.root === null ? this.blocks.length : this.subtreeEnd(this.root); }
  get baseDepth() { return this.root === null ? 0 : this.blocks[this.root].depth; }

  // ---------- structure helpers ----------
  subtreeEnd(i) {
    const d = this.blocks[i].depth;
    let j = i + 1;
    while (j < this.blocks.length && this.blocks[j].depth > d) j++;
    return j;
  }
  hasKids(i) { return i + 1 < this.blocks.length && this.blocks[i + 1].depth > this.blocks[i].depth; }
  isCollapsed(i) { return i !== this.root && COLLAPSED_RE.test('\n' + this.blocks[i].text.split('\n').slice(1).join('\n')) && this.hasKids(i); }
  hiddenSet() {
    const hidden = new Set();
    for (let i = this.start; i < this.end; i++) {
      if (hidden.has(i)) continue;
      if (this.isCollapsed(i)) for (let j = i + 1; j < this.subtreeEnd(i); j++) hidden.add(j);
    }
    return hidden;
  }
  prevVisible(i) { const h = this.hiddenSet(); for (let j = i - 1; j >= this.start; j--) if (!h.has(j)) return j; return -1; }
  nextVisible(i) { const h = this.hiddenSet(); for (let j = i + 1; j < this.end; j++) if (!h.has(j)) return j; return -1; }
  parentOf(i) { for (let j = i - 1; j >= 0; j--) if (this.blocks[j].depth < this.blocks[i].depth) return j; return -1; }

  /** Block index whose first line is file line `line` (0-based), for jumping from references. */
  indexForLine(line) {
    let at = nl(this.doc.preamble);
    for (let i = 0; i < this.blocks.length; i++) {
      if (at >= line) return i;
      at += nl(this.blocks[i].raw ?? this.blocks[i].text + '\n');
    }
    return this.blocks.length - 1;
  }
  lineOf(i) {
    let at = nl(this.doc.preamble);
    for (let k = 0; k < i; k++) at += nl(this.blocks[k].raw ?? this.blocks[k].text + '\n');
    return at;
  }

  // ---------- rendering ----------
  render() {
    clearTimeout(this.chunkT);
    this.drawn = this.start;
    this.hidden = this.hiddenSet();
    this.divs = [];
    this.el.replaceChildren();
    this.drawMore(CHUNK);
    this.renderCrumbs();
    this.pinned = null; // notes moved: the pinned ones are worked out again
    this.app.pinSoon?.();
  }
  drawMore(n) {
    const frag = document.createDocumentFragment();
    const stop = Math.min(this.end, this.drawn + n);
    for (let i = this.drawn; i < stop; i++) frag.append(this.blockEl(i));
    this.el.append(frag);
    this.drawn = stop;
    if (this.drawn < this.end) this.chunkT = setTimeout(() => this.drawMore(1500), 0);
  }
  /** Make sure block i exists in the page (long pages are drawn in parts). */
  ensureDrawn(i) {
    if (i >= this.drawn) { clearTimeout(this.chunkT); this.drawMore(this.end - this.drawn); }
  }
  blockEl(i) {
    const b = this.blocks[i];
    const div = document.createElement('div');
    div.className = 'blk';
    div.dataset.i = i;
    this.divs[i] = div;
    div.style.setProperty('--d', b.depth - this.baseDepth);
    if (this.hidden.has(i)) div.hidden = true;
    if (this.hasKids(i)) {
      div.classList.add('has-kids');
      const f = document.createElement('button');
      f.className = 'fold';
      f.tabIndex = -1;
      f.setAttribute('aria-label', this.isCollapsed(i) ? 'Unfold' : 'Fold');
      div.append(f);
    }
    if (this.isCollapsed(i)) div.classList.add('collapsed');
    if (this.inSel(i)) div.classList.add('sel');
    const bul = document.createElement('button');
    bul.className = 'bul';
    bul.tabIndex = -1;
    bul.setAttribute('aria-label', 'Open this block on its own');
    div.append(bul, this.viewEl(i));
    return div;
  }
  blockDiv(i) { return this.divs[i] ?? null; } // the rows drawn so far, by note (render, blockEl)
  /** The shown row at height y on screen: a binary search over the drawn rows (no hit testing). */
  rowAt(y) {
    let lo = this.start, hi = this.drawn - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      let k = mid;
      while (k <= hi && this.divs[k].hidden) k++; // inside a folded note: the next shown row
      if (k > hi) { hi = mid - 1; continue; }
      const r = this.divs[k].getBoundingClientRect();
      if (r.bottom <= y) lo = k + 1;
      else if (r.top > y) hi = mid - 1;
      else return this.divs[k];
    }
    return null;
  }

  viewEl(i) {
    const b = this.blocks[i];
    const bc = document.createElement('div');
    bc.className = 'bc';
    const r = renderBlock(b.text);
    let pre = '';
    if (r.marker) {
      const done = r.marker === 'DONE';
      const cancelled = r.marker.startsWith('CANCEL');
      if (!cancelled) pre += `<input type="checkbox" class="todo" ${done ? 'checked' : ''} aria-label="Done">`;
      if (!['TODO', 'DONE'].includes(r.marker)) pre += `<span class="mk">${esc(r.marker)}</span>`;
    }
    if (r.priority) pre += `<span class="prio p${r.priority}" title="Priority ${r.priority}">${r.priority}</span>`;
    const html = pre + r.html + datesHtml(r.dates, !r.marker || OPEN.has(r.marker)) + propsHtml(r.props);
    bc.innerHTML = html;
    // pictures get a corner handle to resize them (dragPicture), unless the note can't be edited
    if (!this.readonly && html.includes('class="pic"')) {
      for (const p of bc.querySelectorAll('.pic')) p.insertAdjacentHTML('beforeend', '<span class="pic-h" title="Drag to change the size (double-click: the usual size)"></span>');
    }
    if (!b.text.trim()) bc.dataset.ph = i === this.start && this.end - this.start === 1 ? 'Click to write…' : '';
    const doneCls = r.marker === 'DONE' || (r.marker || '').startsWith('CANCEL');
    // a heading makes the first line taller: the dot and the fold arrow centre on it (--hf, app.css)
    const hf = [0, 0.5, 0.3, 0.15, 0.05, 0.05, 0.05][r.heading] || 0;
    // a note that starts with a box or a quote: the dot moves down to its first line of words (--lead)
    const lead = r.html.startsWith('<div class="callout') ? 'calc(var(--callout-gap) + var(--callout-pad))'
      : r.html.startsWith('<blockquote') ? 'var(--quote-gap)' : '';
    queueMicrotask(() => {
      const div = bc.parentElement;
      if (!div) return;
      div.classList.toggle('marker-done', doneCls);
      if (hf) div.style.setProperty('--hf', hf); else div.style.removeProperty('--hf');
      if (lead) div.style.setProperty('--lead', lead); else div.style.removeProperty('--lead');
    });
    return bc;
  }

  refreshBlock(i) {
    const div = this.blockDiv(i);
    if (!div) return;
    const old = div.querySelector('.bc, .ed');
    if (old && old !== this.ta) old.replaceWith(this.viewEl(i));
    if (this.pinned?.split(',').includes(String(i))) { this.pinned = null; this.app.pinSoon?.(); }
  }

  /** Dragging a picture's corner handle resizes it on screen, keeping its shape (mouse or finger);
   *  on release its size goes into the note (sizePicture). A click without a drag does nothing. */
  dragPicture(e) {
    const hd = e.target;
    const img = hd.parentElement.querySelector('img');
    if (this.readonly || e.button > 0 || !img?.naturalWidth) return;
    e.preventDefault();
    const z = zoomOf(img);
    const w0 = img.offsetWidth, h0 = img.offsetHeight, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    hd.setPointerCapture(e.pointerId);
    hd.parentElement.classList.add('resizing');
    const move = (ev) => {
      const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      // how far the corner went along the picture's diagonal; never wider than the note (max-width)
      const w = w0 * (1 + (dx * w0 + dy * h0) / (w0 * w0 + h0 * h0));
      Object.assign(img.style, { width: Math.max(40, Math.round(w)) + 'px', height: 'auto', maxHeight: 'none' });
    };
    const end = (ev) => {
      hd.removeEventListener('pointermove', move);
      hd.removeEventListener('pointerup', end);
      hd.removeEventListener('pointercancel', end);
      hd.parentElement.classList.remove('resizing');
      if (!moved) return;
      this.swipedAt = Date.now(); // the click that ends a drag neither opens the picture nor edits
      if (ev.type === 'pointerup') this.sizePicture(hd, img.offsetWidth, img.offsetHeight);
      else { const blk = hd.closest('.blk'); if (blk) this.refreshBlock(+blk.dataset.i); }
    };
    hd.addEventListener('pointermove', move);
    hd.addEventListener('pointerup', end);
    hd.addEventListener('pointercancel', end);
  }

  /** Write the size of handle hd's picture into its note as Logseq does, {:height h, :width w} right
   *  after its link (w 0: take the size out). One Undo step; nothing else in the note changes. */
  sizePicture(hd, w, h) {
    const blk = hd.closest('.blk');
    const img = hd.parentElement?.querySelector('img');
    if (this.readonly || !blk?.isConnected || !img) return; // (the page was drawn again meanwhile)
    const i = +blk.dataset.i;
    const md = img.dataset.md;
    const same = [...hd.closest('.bc').querySelectorAll('img.img')].filter((x) => x.dataset.md === md);
    const text = this.textOf(i);
    // the same link also written where it isn't a picture (in code): unclear which one this is
    // (or also as a property value, which shows in a different place than it's written)
    const inCode = text.split(md).length - 1 !== same.length;
    if (inCode || (same.length > 1 && same.some((x) => x.closest('.props')))) {
      this.refreshBlock(i);
      this.app.toast(`This picture’s size can’t be changed here: the same picture is also ${inCode ? 'written as code' : 'in a property'} in this note, so it’s unclear which one to change.`, 5000);
      return;
    }
    const after = withPictureSize(text, md, same.indexOf(img), w, h);
    if (after === text) { this.refreshBlock(i); return; }
    this.snap();
    this.setText(i, () => after);
    if (this.app.active?.cur == null) this.app.active = this; // Ctrl+Z (app.js) undoes it, on any journal day too
  }

  renderCrumbs() {
    if (this.root === null) { this.crumbs.hidden = true; return; }
    const chain = [];
    for (let j = this.parentOf(this.root); j >= 0; j = this.parentOf(j)) chain.unshift(j);
    const label = (k) => esc(renderBlock(this.blocks[k].text.split('\n')[0]).html.replace(/<[^>]+>/g, '').slice(0, 40) || '…');
    this.crumbs.innerHTML = `<a href="#" data-z="page">${esc(this.name)}</a>` + chain.map((k) => ` › <a href="#" data-z="${k}">${label(k)}</a>`).join('');
    this.crumbs.hidden = false;
  }

  // ---------- events ----------
  bindEvents() {
    this.pins.addEventListener('click', (e) => {
      const row = e.target.closest('.pin');
      if (!row) return;
      e.preventDefault();
      this.goToPinned(+row.dataset.i);
    });
    this.crumbs.addEventListener('click', (e) => {
      const a = e.target.closest('[data-z]');
      if (!a) return;
      e.preventDefault();
      this.flush();
      if (a.dataset.z === 'page') this.app.go('page', this.name);
      else this.app.go('zoom', this.name, { line: this.lineOf(+a.dataset.z) });
    });
    this.el.addEventListener('click', (e) => {
      if (Date.now() - (this.swipedAt || 0) < 400) return; // the end of a swipe (phones)
      const t = e.target;
      const blk = t.closest('.blk');
      if (!blk) return;
      const i = +blk.dataset.i;
      const thread = this.threadAt(e, blk);
      if (thread !== null) { e.preventDefault(); this.toggleBranch(thread); return; }
      const a = t.closest('a');
      if (a) {
        e.preventDefault();
        if (a.dataset.page) { this.flush(); this.app.go('page', a.dataset.page); }
        else if (a.getAttribute('href') && a.getAttribute('href') !== '#') this.app.openUrl(a.getAttribute('href'));
        return;
      }
      if (t.classList.contains('todo')) { e.preventDefault(); this.toggleTodo(i); return; }
      if (t.classList.contains('pk')) { this.app.go('props', t.dataset.prop); return; }
      if (t.classList.contains('fold')) { this.toggleCollapse(i); return; }
      if (t.closest('.date-chip')) { this.editDate(i, t.closest('.date-chip').textContent.includes('Deadline') ? 'deadline' : 'scheduled'); return; }
      if (t.tagName === 'IMG') { this.app.showImage(t.src); return; }
      if (t.closest('.pic')) return; // a picture's resize handle (or around a picture that didn't load)
      if (e.shiftKey && (this.sel || this.cur !== null)) { e.preventDefault(); this.extendTo(i); return; }
      if (t.classList.contains('bul')) {
        if (this.longPressed) { this.longPressed = false; return; }
        if (i === this.root) return;
        this.flush();
        this.app.go('zoom', this.name, { line: this.lineOf(i) });
        return;
      }
      if (t.closest('.bc')) {
        if (window.getSelection()?.toString()) return; // let people select text to copy
        if (this.sel) this.clearSel();
        this.edit(i, this.caretFromClick(e, t.closest('.bc'), i));
      }
    });
    // Logseq-style thread lines: the line linking a block's children lights up under the
    // pointer, and clicking it folds everything under that block (or unfolds it all)
    this.el.addEventListener('mousemove', (e) => {
      const blk = e.target.closest('.blk');
      this.showThread(blk ? this.threadAt(e, blk) : null);
    });
    this.el.addEventListener('mouseleave', () => this.showThread(null));
    // a picture's corner handle: drag it to resize the picture, double-click it for the usual size
    this.el.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('pic-h')) this.dragPicture(e); });
    this.el.addEventListener('dblclick', (e) => { if (e.target.classList.contains('pic-h')) this.sizePicture(e.target, 0, 0); });
    // phone: hold a bullet to select blocks (then tap other bullets to add)
    this.el.addEventListener('pointerdown', (e) => {
      const bul = e.target.closest('.bul');
      if (!bul || e.pointerType === 'mouse') return;
      clearTimeout(this.pressT);
      this.pressT = setTimeout(() => {
        this.longPressed = true;
        const i = +bul.closest('.blk').dataset.i;
        if (this.sel) this.extendTo(i); else this.select(i);
        navigator.vibrate?.(15);
      }, 450);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointermove']) this.el.addEventListener(ev, (e) => { if (ev !== 'pointermove' || Math.abs(e.movementY) > 4) clearTimeout(this.pressT); });
    // phones: swipe a note to the right to move it in a level, to the left to move it out (with its
    // children; the row follows the finger a little). Not from the screen's left edge: a swipe
    // from there opens the menu (app.js), and Android's Back gesture owns the very edge.
    let sw = null;
    this.el.addEventListener('touchstart', (e) => {
      sw = null;
      const t = e.touches[0];
      const blk = e.target.closest('.blk');
      // only on a note's words (not its dot or the margin), never from the edge
      if (e.touches.length !== 1 || this.readonly || !blk || !e.target.closest('.bc') || t.clientX < EDGE || e.target.closest('.ed, .fold, .todo, img, .pic-h, pre, .math')) return;
      sw = { blk, i: +blk.dataset.i, x: t.clientX, y: t.clientY, dx: 0, dy: 0, on: false, sy: scrollY + document.querySelector('#main').scrollTop };
    }, { passive: true });
    this.el.addEventListener('touchmove', (e) => {
      if (!sw) return;
      const t = e.touches[0];
      const dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // scrolling
        if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        sw.on = true;
        clearTimeout(this.pressT); // not a long press on the dot
      }
      sw.dx = dx; sw.dy = dy;
      if (Math.abs(dy) > 24) { swipeEnd(true); return; } // the finger went on up or down: scrolling after all
      sw.blk.style.translate = `${Math.max(-40, Math.min(40, dx / 2))}px 0`;
      sw.blk.classList.toggle('swipe-in', dx >= SWIPE);
      sw.blk.classList.toggle('swipe-out', dx <= -SWIPE);
    }, { passive: true });
    const swipeEnd = (cancel = false) => {
      if (!sw) return;
      const { blk, i, dx, dy, on, sy } = sw;
      sw = null;
      blk.classList.remove('swipe-in', 'swipe-out');
      blk.style.transition = 'translate .15s ease';
      blk.style.translate = '';
      setTimeout(() => { blk.style.transition = ''; }, 200);
      if (!on) return;
      this.swipedAt = Date.now(); // the touch that ends a swipe doesn't start editing
      const scrolled = Math.abs(scrollY + document.querySelector('#main').scrollTop - sy) > 4;
      if (!cancel && !scrolled && Math.abs(dx) >= SWIPE && Math.abs(dx) > 2 * Math.abs(dy) && this.shiftLevel(i, dx > 0 ? 1 : -1)) {
        navigator.vibrate?.(10);
        // (on a phone there's no Undo button unless a note is being edited); only this move is undone
        const step = this.undoStack.at(-1);
        this.app.toast(dx > 0 ? 'Moved in a level.' : 'Moved out a level.', 4000, { label: 'Undo', run: () => {
          if (this.undoStack.at(-1) === step) this.undo();
          else this.app.toast('Something else was changed since, so this can’t be undone from here.', 3000);
        } });
      }
    };
    this.el.addEventListener('touchend', () => swipeEnd());
    this.el.addEventListener('touchcancel', () => swipeEnd(true));
  }

  /** A swipe moved note i (and its children, or the selected notes) in (dir 1) or out (-1) a level.
   *  Unlike Tab, nothing starts being edited (no keyboard). False if it can't move that way. */
  shiftLevel(i, dir) {
    if (this.readonly || i === this.root) return false;
    if (this.sel && !this.inSel(i)) this.clearSel();
    const r = this.opRange(i);
    if (!r) return false;
    const [a, z] = r;
    const d = this.blocks[a].depth;
    if (dir > 0 && (a <= this.start || a === this.root || this.blocks[a - 1].depth < d)) return false;
    if (dir < 0 && (d === 0 || a === this.root || (this.root !== null && d <= this.blocks[this.root].depth + 1))) return false;
    this.stopEdit();
    this.snap();
    for (let j = a; j < z; j++) this.blocks[j].depth += dir;
    this.render();
    this.markDirty();
    return true;
  }

  /** Put the caret where the block was clicked (roughly: by visible text length). */
  caretFromClick(e, bc, i) {
    const shown = splitHidden(this.blocks[i].text).shown;
    try {
      const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY) ?? null;
      const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
      const node = pos ? pos.offsetNode : range?.startContainer;
      const off = pos ? pos.offset : range?.startOffset;
      if (!node || !bc.contains(node) || node.nodeType !== 3) return 'end';
      // visible text before the click, then find it in the source text
      const r = document.createRange();
      r.setStart(bc, 0);
      r.setEnd(node, off);
      const before = r.toString().replace(/​/g, '');
      if (!before) return 0;
      const tail = before.slice(-12);
      let at = shown.indexOf(tail);
      while (at >= 0) {
        const next = shown.indexOf(tail, at + 1);
        if (next < 0 || next > before.length + 40) break;
        at = next;
      }
      return at >= 0 ? Math.min(at + tail.length, contentEnd(shown)) : 'end';
    } catch { return 'end'; }
  }

  // ---------- editing ----------
  edit(i, caret = 'end') {
    if (i < this.start || i >= this.end) return;
    if (this.readonly) {
      this.app.toast(this.error || 'This file isn’t plain UTF-8 text, so it can be read here but not edited.');
      return;
    }
    this.ensureDrawn(i);
    if (this.cur === i && this.ta) { this.ta.focus(); return; }
    this.stopEdit();
    const div = this.blockDiv(i);
    if (!div) return;
    div.hidden = false;
    const { shown, hidden } = splitHidden(this.blocks[i].text);
    this.hiddenLines = hidden;
    const ta = document.createElement('textarea');
    ta.className = 'ed';
    ta.rows = 1;
    ta.value = shown;
    ta.setAttribute('autocapitalize', 'sentences');
    ta.setAttribute('aria-label', 'Block text');
    div.querySelector('.bc').replaceWith(ta);
    div.classList.remove('marker-done');
    div.style.removeProperty('--hf'); // the editing box shows "## …" at the normal size
    div.style.removeProperty('--lead');
    this.ta = ta;
    this.cur = i;
    this.autosize();
    ta.focus({ preventScroll: true });
    const pos = caret === 'end' ? contentEnd(shown) : Math.min(caret, shown.length);
    ta.setSelectionRange(pos, pos);
    // a wide window: once this note is at the top, its parents get pinned there; scroll it in below them
    const main = document.querySelector('#main');
    if (main && getComputedStyle(main).overflowY !== 'visible') {
      let n = 0;
      for (let a = this.parentOf(i); a >= this.start; a = this.parentOf(a)) n++;
      main.style.scrollPaddingTop = n ? `${8 + n * PIN_H}px` : '';
    }
    ta.scrollIntoView({ block: 'nearest' });
    ta.addEventListener('beforeinput', (e) => {
      // "[" with words selected wraps them: [words]; a second "[" makes a page link [[words]] (like Logseq)
      if (e.inputType === 'insertText' && e.data === '[' && ta.selectionStart !== ta.selectionEnd) { e.preventDefault(); this.wrap('[', ']'); return; }
      this.beforeTyping();
    });
    ta.addEventListener('input', (e) => this.onInput(e));
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('paste', (e) => this.onPaste(e));
    ta.addEventListener('blur', () => setTimeout(() => {
      if (this.ta === ta && document.activeElement !== ta && document.hasFocus() && !document.querySelector('.pop, .modal-back')) this.stopEdit();
    }, 150));
    this.app.editing(this, true);
  }

  stopEdit() {
    if (this.cur === null) return;
    const i = this.cur;
    const ta = this.ta;
    this.cur = null;
    this.ta = null;
    this.app.ac.close();
    if (ta?.isConnected) ta.replaceWith(this.viewEl(i));
    this.app.editing(this, false);
    this.flushSoon(300);
  }

  autosize() {
    const ta = this.ta;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  /** The editing box changed (typing or a command): update the model and save soon. */
  typed() {
    if (!this.ta || this.cur === null) return;
    this.blocks[this.cur].text = joinHidden(this.ta.value, this.hiddenLines);
    this.autosize();
    this.markDirty();
  }

  beforeTyping() {
    // one undo step per burst of typing in one block
    const now = Date.now();
    if (this.lastSnap?.kind !== 'type' || now - this.lastSnap.at > 1200 || this.lastSnap.cur !== this.cur) this.snap('type');
    else this.lastSnap.at = now;
  }

  onInput(e) {
    const ta = this.ta;
    const c = ta.selectionStart;
    if (e.inputType === 'insertText' && e.data === '[') {
      // auto-close [[ with ]]
      if (ta.value.slice(c - 2, c) === '[[' && ta.value.slice(c, c + 2) !== ']]') ta.setRangeText(']]', c, c, 'start');
    }
    if (e.inputType === 'insertText' && e.data === '`') {
      // ``` at the start of a line opens a code block: close it too, unless this closes one
      const line = ta.value.slice(ta.value.lastIndexOf('\n', c - 1) + 1, c);
      const fencesBefore = (ta.value.slice(0, c - 3).match(/^\s*```/gm) || []).length;
      if (/^\s*```$/.test(line) && fencesBefore % 2 === 0 && !/^\s*```/m.test(ta.value.slice(c))) ta.setRangeText('\n```', c, c, 'start');
    }
    this.typed();
    this.app.ac.check(this);
  }

  onKey(e) {
    const ta = this.ta;
    const i = this.cur;
    if (this.app.ac.handleKey(e)) return;
    if (e.isComposing) return;
    const c = ta.selectionStart, cEnd = ta.selectionEnd, v = ta.value;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && !e.altKey && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (this.app.keyIs(e, 'editor/move-block-up')) { e.preventDefault(); this.move(i, -1); return; }
    if (this.app.keyIs(e, 'editor/move-block-down')) { e.preventDefault(); this.move(i, 1); return; }
    if (this.app.keyIs(e, 'editor/highlight')) { e.preventDefault(); this.wrap('^^', '^^'); return; }
    if (this.app.keyIs(e, 'editor/toggle-open-blocks')) { e.preventDefault(); this.toggleAll(); return; }
    if (mod && !e.altKey && !e.shiftKey && k === 'b') { e.preventDefault(); this.wrap('**', '**'); return; }
    if (mod && !e.altKey && !e.shiftKey && k === 'i') { e.preventDefault(); this.wrap('*', '*'); return; }
    if (e.key === 'Enter' && mod) { e.preventDefault(); this.cycleTodo(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); this.split(i, c, cEnd); return; }
    if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? this.outdent(i) : this.indent(i); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.stopEdit(); this.select(i); return; }
    if (e.key === 'Backspace' && c === 0 && cEnd === 0) { e.preventDefault(); this.mergeUp(i); return; }
    if (e.key === 'Delete' && c === v.length && cEnd === c) { e.preventDefault(); this.mergeDown(i); return; }
    const firstLine = v.lastIndexOf('\n', c - 1) === -1;
    const lastLine = v.indexOf('\n', cEnd) === -1;
    if (e.key === 'ArrowUp' && e.shiftKey && !mod && !e.altKey && firstLine && c === cEnd) { e.preventDefault(); this.stopEdit(); this.select(i); this.extendBy(-1); return; }
    if (e.key === 'ArrowDown' && e.shiftKey && !mod && !e.altKey && lastLine && c === cEnd) { e.preventDefault(); this.stopEdit(); this.select(i); this.extendBy(1); return; }
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !mod && firstLine) {
      const p = this.prevVisible(i);
      if (p >= 0) { e.preventDefault(); this.edit(p, 'end'); }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !mod && lastLine) {
      const n = this.nextVisible(i);
      if (n >= 0) { e.preventDefault(); this.edit(n, 0); }
    }
  }

  async onPaste(e) {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); for (const f of files) await this.addImage(f); return; }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    // a web address pasted over selected words makes them a link to it: [words](address)
    const ta = this.ta;
    const url = text.trim();
    if (ta && ta.selectionStart !== ta.selectionEnd && /^https?:\/\/\S+$/i.test(url)) {
      const words = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      // not over an address (that's swapping one address for another), nor inside a link's "(…)"
      const before = ta.value.slice(0, ta.selectionStart);
      const inAddress = /\]\([^)\s]*$/.test(before) || /^[a-z][\w+.-]*:\/\/|^www\./i.test(words.trim());
      if (!words.includes('\n') && words.trim() && !inAddress) {
        e.preventDefault();
        this.snap();
        ta.setRangeText(`[${words}](${url})`, ta.selectionStart, ta.selectionEnd, 'end');
        this.typed();
        return;
      }
    }
    const lines = text.replace(/\r/g, '').split('\n');
    const isBullet = (l) => /^\s*[-*+] |^\s*-$/.test(l);
    if (lines.filter(isBullet).length < 2) return; // plain paste stays inside this block
    e.preventDefault();
    const parsed = [];
    let lead = null; // indent of the bullet the continuation lines belong to
    for (const l of lines) {
      const m = l.match(/^([\t ]*)[-*+](?: (.*)|)$/);
      if (m) {
        lead = m[1];
        parsed.push({ depth: (lead.match(/\t/g) || []).length + Math.floor((lead.match(/ /g) || []).length / 2), text: m[2] ?? '' });
      } else if (!parsed.length) {
        if (l.trim()) {
          if (!parsed.lead) parsed.lead = [];
          parsed.lead.push(l);
        }
      } else if (l.trim()) {
        const cont = l.startsWith(lead + '  ') ? l.slice(lead.length + 2) : l.startsWith(lead + '\t') ? l.slice(lead.length + 1) : l.trimStart();
        parsed[parsed.length - 1].text += '\n' + cont;
      }
    }
    // text before the first bullet becomes a block of its own, at the top level of the paste
    const min = Math.min(...parsed.map((p) => p.depth));
    if (parsed.lead) parsed.unshift({ depth: min, text: parsed.lead.join('\n') });
    const i = this.cur;
    this.snap();
    const base = this.blocks[i].depth;
    const add = parsed.map((p) => ({ depth: base + p.depth - min, text: p.text, raw: null }));
    let at;
    if (!this.blocks[i].text.trim()) { this.blocks.splice(i, 1); at = i; }
    else at = this.subtreeEnd(i); // after this block and its children
    this.blocks.splice(at, 0, ...add);
    this.reflow(at + add.length - 1, 'end');
  }

  // ---------- undo / redo ----------
  snapshot() {
    return { blocks: this.blocks.map((b) => ({ ...b })), preamble: this.doc.preamble, cur: this.cur, caret: this.ta?.selectionStart ?? null };
  }
  snap(kind = 'op') {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnap = { kind, at: Date.now(), cur: this.cur };
  }
  restore(st) {
    this.doc.blocks = st.blocks.map((b) => ({ ...b }));
    this.doc.preamble = st.preamble;
    this.cur = null;
    this.ta = null;
    this.lastSnap = null;
    if (this.root !== null && this.root >= this.blocks.length) this.root = null;
    this.render();
    this.markDirty();
    if (st.cur !== null && st.cur < this.blocks.length) this.edit(st.cur, st.caret ?? 'end');
  }
  /** The page was replaced from outside the editor (merged, chosen on the clash screen, read again). */
  forgetUndo() {
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnap = null;
  }
  undo() {
    if (!this.undoStack.length) { this.app.toast('Nothing to undo', 1200); return; }
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) { this.app.toast('Nothing to redo', 1200); return; }
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
  }

  // ---------- selecting several blocks ----------
  inSel(i) { const r = this.selRange(); return !!r && i >= r[0] && i < r[1]; }
  /** Selected blocks as [from, to) including the children of the last one. */
  selRange() {
    if (!this.sel) return null;
    const lo = Math.min(this.sel.a, this.sel.b);
    const hi = Math.max(this.sel.a, this.sel.b);
    let end = hi + 1;
    for (let j = lo; j <= hi; j++) end = Math.max(end, this.subtreeEnd(j));
    return [lo, end];
  }
  select(i) {
    if (i < this.start || i >= this.end) return;
    this.stopEdit();
    this.sel = { a: i, b: i };
    this.paintSel();
    this.app.selecting(this, true);
  }
  extendTo(i) {
    if (!this.sel) { const from = this.cur ?? i; this.stopEdit(); this.sel = { a: from, b: i }; }
    else this.sel.b = i;
    this.paintSel();
    this.app.selecting(this, true);
  }
  extendBy(dir) {
    if (!this.sel) return;
    const n = dir < 0 ? this.prevVisible(this.sel.b) : this.nextVisible(this.sel.b);
    if (n >= 0) { this.sel.b = n; this.paintSel(); }
  }
  clearSel() {
    if (!this.sel) return;
    this.sel = null;
    this.paintSel();
    this.app.selecting(this, false);
  }
  paintSel() {
    this.el.querySelectorAll('.blk').forEach((d) => d.classList.toggle('sel', this.inSel(+d.dataset.i)));
    const head = this.sel && this.blockDiv(this.sel.b);
    head?.scrollIntoView({ block: 'nearest' });
  }
  /** Keys while blocks are selected (no editing box). Returns true if handled. */
  onSelKey(e) {
    if (!this.sel) return false;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const [lo] = this.selRange();
    if (e.key === 'Escape') { this.clearSel(); return true; }
    if (mod && k === 'z') { e.shiftKey ? this.redo() : this.undo(); return true; }
    if (mod && k === 'y') { this.redo(); return true; }
    if (this.app.keyIs(e, 'editor/move-block-up')) { this.move(lo, -1); return true; }
    if (this.app.keyIs(e, 'editor/move-block-down')) { this.move(lo, 1); return true; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod && !e.altKey) {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey) this.extendBy(dir);
      else { const n = dir < 0 ? this.prevVisible(this.sel.b) : this.nextVisible(this.sel.b); if (n >= 0) { this.sel = { a: n, b: n }; this.paintSel(); } }
      return true;
    }
    if (e.key === 'Enter' && mod) { this.cycleTodoSel(); return true; }
    if (e.key === 'Enter') { const i = this.sel.b; this.clearSel(); this.edit(i); return true; }
    if (e.key === 'Tab') { e.shiftKey ? this.outdent(lo) : this.indent(lo); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.deleteSel(); return true; }
    if (mod && (k === 'c' || k === 'x')) { this.copySel(); if (k === 'x') this.deleteSel(); return true; }
    return false;
  }
  selText() {
    const [lo, hi] = this.selRange();
    const min = Math.min(...this.blocks.slice(lo, hi).map((b) => b.depth));
    return this.blocks.slice(lo, hi).map((b) => {
      const ind = '\t'.repeat(b.depth - min);
      return b.text.split('\n').map((l, k) => (k === 0 ? `${ind}- ${l}` : `${ind}  ${l}`)).join('\n');
    }).join('\n');
  }
  async copySel() {
    const text = this.selText();
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.append(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    this.app.toast('Copied', 1000);
  }
  deleteSel() {
    const [lo, hi] = this.selRange();
    if (this.root !== null && lo <= this.root) return;
    this.snap();
    this.blocks.splice(lo, hi - lo);
    if (!this.blocks.length) this.blocks.push({ depth: 0, text: '', raw: null });
    this.sel = null;
    this.app.selecting(this, false);
    this.render();
    this.markDirty();
    const n = Math.min(lo, this.end - 1);
    if (n >= this.start) this.select(Math.max(this.start, lo - 1 >= this.start ? lo - 1 : lo));
  }
  cycleTodoSel() {
    const [lo, hi] = this.selRange();
    this.snap();
    const first = this.blocks[lo].text.match(MARKERS)?.[1] ?? null;
    const next = this.nextMarker(first);
    for (let j = lo; j < hi; j++) if (this.blocks[j].depth === this.blocks[lo].depth || j === lo) this.blocks[j].text = this.withMarker(this.blocks[j].text, next);
    this.render();
    this.markDirty();
  }

  // ---------- operations (also used by the phone toolbar) ----------
  /** Range moved/indented by an operation on block i: the selection, or i and its children. */
  opRange(i) {
    const r = this.selRange();
    if (r) {
      const d = this.blocks[r[0]].depth;
      if (this.blocks.slice(r[0], r[1]).some((b) => b.depth < d)) { this.app.toast('Select blocks at the same level to move them together.'); return null; }
      return r;
    }
    return [i, this.subtreeEnd(i)];
  }

  split(i, c, cEnd = c) {
    const b = this.blocks[i];
    const shown = this.ta ? this.ta.value : splitHidden(b.text).shown;
    const hidden = this.ta ? this.hiddenLines : splitHidden(b.text).hidden;
    // Enter on an empty child: step out (but not out of a zoomed-in block)
    if (!shown.trim() && b.depth > this.baseDepth + (this.root === null ? 0 : 1) && i !== this.root) { this.outdent(i); return; }
    this.snap();
    const before = shown.slice(0, c), after = shown.slice(cEnd);
    if (c === 0 && after.trim() && i !== this.root) { // at the start: open a line above
      this.blocks.splice(i, 0, { depth: b.depth, text: '', raw: null });
      this.reflow(i + 1, 0);
      return;
    }
    // properties after the caret stay with this block; text moves to the new one
    const rest = after.split('\n');
    const keep = rest.filter((l, k) => k > 0 && isProp(l));
    const moving = rest.filter((l, k) => k === 0 || !isProp(l)).join('\n');
    b.text = joinHidden(before + (keep.length ? '\n' + keep.join('\n') : ''), hidden);
    let at, depth;
    if (i === this.root || (this.hasKids(i) && !this.isCollapsed(i))) { at = i + 1; depth = b.depth + 1; }
    else { at = this.subtreeEnd(i); depth = b.depth; }
    this.blocks.splice(at, 0, { depth, text: moving, raw: null });
    this.reflow(at, 0);
  }

  indent(i) {
    const r = this.opRange(i);
    if (!r) return;
    const [a, z] = r;
    if (a <= this.start || a === this.root) return;
    if (this.blocks[a - 1].depth < this.blocks[a].depth) return;
    const caret = this.ta?.selectionStart ?? 'end';
    this.snap();
    for (let j = a; j < z; j++) this.blocks[j].depth++;
    this.afterMove(a, caret);
  }

  outdent(i) {
    const r = this.opRange(i);
    if (!r) return;
    const [a, z] = r;
    const d = this.blocks[a].depth;
    if (d === 0 || a === this.root) return;
    if (this.root !== null && d <= this.blocks[this.root].depth + 1) return; // would leave the zoomed block
    const caret = this.ta?.selectionStart ?? 'end';
    this.snap();
    for (let j = a; j < z; j++) this.blocks[j].depth--;
    this.afterMove(a, caret);
  }

  move(i, dir) {
    const r = this.opRange(i);
    if (!r) return;
    const [a, z] = r;
    if (a === this.root) return;
    const d = this.blocks[a].depth;
    const caret = this.ta?.selectionStart ?? 'end';
    const editing = this.cur;
    if (dir < 0) {
      let j = a - 1;
      while (j >= this.start && this.blocks[j].depth > d) j--;
      if (j < this.start || this.blocks[j].depth !== d || j === this.root) return;
      this.snap();
      const chunk = this.blocks.splice(a, z - a);
      this.blocks.splice(j, 0, ...chunk);
      this.afterMove(j, caret, editing === null ? null : j + (editing - a), z - a);
    } else {
      if (z >= this.end || this.blocks[z].depth !== d) return;
      this.snap();
      const nextEnd = this.subtreeEnd(z);
      const chunk = this.blocks.splice(a, z - a);
      const at = nextEnd - chunk.length;
      this.blocks.splice(at, 0, ...chunk);
      this.afterMove(at, caret, editing === null ? null : at + (editing - a), z - a);
    }
  }

  /** Redraw after a structural change; keep editing, or keep the moved blocks selected. */
  afterMove(a, caret, editIndex = undefined, len = undefined) {
    if (this.sel) {
      const n = (len ?? (this.selRange()[1] - this.selRange()[0])) - 1;
      const span = Math.abs(this.sel.b - this.sel.a);
      this.sel = { a, b: a + Math.min(span, n) };
      this.cur = null; this.ta = null;
      this.render();
      this.markDirty();
      return;
    }
    this.reflow(editIndex ?? a, caret);
  }

  mergeUp(i) {
    const b = this.blocks[i];
    const p = this.prevVisible(i);
    if (p < 0 || i === this.root) {
      if (!b.text && this.end - this.start > 1 && i !== this.root) { this.snap(); this.blocks.splice(i, 1); this.reflow(Math.max(this.start, i - 1), 'end'); }
      return;
    }
    if (this.hasKids(i) && b.text.trim()) return; // don't swallow a parent into the line above
    this.snap();
    const caret = this.joinInto(p, i);
    this.blocks.splice(i, 1);
    this.reflow(p, caret);
  }

  mergeDown(i) {
    const n = this.nextVisible(i);
    if (n < 0 || this.hasKids(n)) return;
    this.snap();
    const caret = this.joinInto(i, n);
    this.blocks.splice(n, 1);
    this.reflow(i, caret);
  }

  /** Append block `j`'s text to block `i` (before i's properties). Returns the join point. */
  joinInto(i, j) {
    const A = this.cur === i && this.ta ? { shown: this.ta.value, hidden: this.hiddenLines } : splitHidden(this.blocks[i].text);
    const B = this.cur === j && this.ta ? { shown: this.ta.value, hidden: this.hiddenLines } : splitHidden(this.blocks[j].text);
    const ce = contentEnd(A.shown);
    const bLines = B.shown.split('\n');
    const bContent = bLines.filter((l, k) => k === 0 || !isProp(l)).join('\n');
    const aKeys = new Set(A.shown.split('\n').filter((l, k) => k > 0 && isProp(l)).map(propKey));
    const bProps = bLines.filter((l, k) => k > 0 && isProp(l) && !aKeys.has(propKey(l)));
    const shown = A.shown.slice(0, ce) + bContent + A.shown.slice(ce) + (bProps.length ? '\n' + bProps.join('\n') : '');
    const aHidden = new Set(A.hidden.map((h) => propKey(h.line)));
    const hidden = A.hidden.concat(B.hidden.filter((h) => !aHidden.has(propKey(h.line))).map((h) => ({ pos: 1, line: h.line })));
    this.blocks[i].text = joinHidden(shown, hidden);
    return ce;
  }

  nextMarker(m) {
    const wf = this.app.workflow();
    const start = wf === 'now' ? 'LATER' : 'TODO';
    if (!m) return start;
    const next = { TODO: 'DOING', DOING: 'DONE', LATER: 'NOW', NOW: 'DONE', DONE: null };
    return m in next ? next[m] : start;
  }
  withMarker(text, marker) {
    const m = text.match(MARKERS);
    const rest = m ? text.slice(m[0].length).replace(/^ /, '') : text;
    return marker ? `${marker} ${rest}` : rest;
  }

  /** Ctrl+Enter: TODO → DOING → DONE → (none), or LATER → NOW → DONE with :preferred-workflow :now. */
  cycleTodo(i = this.cur) {
    if (i === null) return;
    const text = this.textOf(i);
    const next = this.nextMarker(text.match(MARKERS)?.[1] ?? null);
    if (next === 'DONE') return this.complete(i);
    this.setMarker(i, next);
  }
  textOf(i) { return this.cur === i && this.ta ? joinHidden(this.ta.value, this.hiddenLines) : this.blocks[i].text; }

  setMarker(i, marker) {
    if (this.readonly) return;
    this.snap();
    this.setText(i, (t) => this.withMarker(t, marker));
  }

  /** Change a block's text with fn(text) → text, keeping the caret where it was if editing. */
  setText(i, fn) {
    const before = this.textOf(i);
    const after = fn(before);
    this.blocks[i].text = after;
    if (this.cur === i && this.ta) {
      const c = this.ta.selectionStart;
      const { shown, hidden } = splitHidden(after);
      const delta = shown.length - this.ta.value.length;
      this.hiddenLines = hidden;
      this.ta.value = shown;
      const pos = Math.max(0, Math.min(shown.length, c + (c > 0 ? delta : 0)));
      this.ta.setSelectionRange(pos, pos);
      this.autosize();
    } else this.refreshBlock(i);
    this.markDirty();
  }

  toggleTodo(i) {
    if (this.readonly) return;
    const m = this.blocks[i].text.match(MARKERS)?.[1];
    if (!m) return;
    if (m === 'DONE' || m.startsWith('CANCEL')) this.setMarker(i, this.app.workflow() === 'now' ? 'LATER' : 'TODO');
    else this.complete(i);
  }

  /** Mark done; a repeating to-do moves its date on instead (like Logseq). */
  async complete(i) {
    const before = this.textOf(i);
    const src = before.match(MARKERS) ? before : this.withMarker(before, this.nextMarker(null));
    let after;
    try { after = await call('task_done', { text: src, today: today() }); }
    catch { after = this.withMarker(before, 'DONE'); }
    if (this.textOf(i) !== before) return; // changed meanwhile
    this.snap();
    this.setText(i, () => after);
    if (/^(TODO|LATER) /.test(after) && /SCHEDULED|DEADLINE/.test(after)) this.app.toast('Repeating to-do: moved to its next date', 2200);
  }

  /** SCHEDULED / DEADLINE: pick a day (replaces an existing one). */
  async editDate(i, kind) {
    if (this.readonly) return;
    const word = kind === 'deadline' ? 'DEADLINE' : 'SCHEDULED';
    const text = this.textOf(i);
    const old = text.split('\n').find((l) => l.trim().startsWith(word + ':'));
    const st = old ? parseStamp(old) : null;
    const div = this.blockDiv(i);
    const anchor = this.ta ? caretRect(this.ta) : div.getBoundingClientRect();
    const pick = await pickDate(anchor, { title: kind === 'deadline' ? 'Deadline' : 'Scheduled for', date: st?.date, repeat: true });
    if (!pick) { this.ta?.focus(); return; }
    this.snap();
    this.setText(i, (t) => {
      const lines = t.split('\n').filter((l) => !l.trim().startsWith(word + ':'));
      lines.splice(1, 0, `${word}: ${stampText(pick.date, st?.time, pick.repeat ?? st?.repeat)}`);
      return lines.join('\n');
    });
    this.ta?.focus();
  }

  setHeading(n) {
    if (this.cur === null) return;
    this.snap();
    this.setText(this.cur, (t) => {
      const m = t.match(MARKERS);
      const head = m ? m[0] + ' ' : '';
      let rest = t.slice(head.length).replace(/^#{1,6}\s+/, '');
      return head + (n ? '#'.repeat(n) + ' ' : '') + rest;
    });
  }

  setPriority(p) {
    if (this.cur === null) return;
    this.snap();
    this.setText(this.cur, (t) => {
      const lines = t.split('\n');
      let first = lines[0].replace(/\s?\[#[A-Ca-c]\]/, '');
      const m = first.match(MARKERS);
      first = m ? `${m[1]} [#${p}] ${first.slice(m[0].length).trimStart()}` : `[#${p}] ${first}`;
      lines[0] = first;
      return lines.join('\n');
    });
  }

  /** Wrap the selected text (or insert a pair around the caret). */
  wrap(left, right) {
    const ta = this.ta;
    if (!ta) return;
    this.snap();
    const { selectionStart: s, selectionEnd: e } = ta;
    const inner = ta.value.slice(s, e);
    ta.setRangeText(left + inner + right, s, e, 'select');
    ta.setSelectionRange(s + left.length, s + left.length + inner.length);
    this.typed();
  }

  insertAtCaret(text, back = 0) {
    if (!this.ta) return;
    const ta = this.ta;
    this.snap();
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    if (back) ta.setSelectionRange(ta.selectionStart - back, ta.selectionStart - back);
    this.typed();
    this.app.ac.check(this);
  }

  /** A command from the / menu. */
  async command(id) {
    const i = this.cur;
    if (i === null) return;
    const link = async (d) => `[[${await call('journal_name', { date: d })}]]`;
    const shift = (n) => { const dt = new Date(); dt.setDate(dt.getDate() + n); return [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()]; };
    if (['TODO', 'DOING', 'LATER', 'NOW', 'WAITING', 'DONE'].includes(id)) return this.setMarker(i, id);
    switch (id) {
      case 'sched': return this.editDate(i, 'scheduled');
      case 'deadline': return this.editDate(i, 'deadline');
      case 'date': {
        const pick = await pickDate(caretRect(this.ta), { title: 'Link to a day' });
        if (pick) this.insertAtCaret(await link(pick.date));
        this.ta?.focus();
        return;
      }
      case 'today': return this.insertAtCaret(await link(today()));
      case 'tomorrow': return this.insertAtCaret(await link(shift(1)));
      case 'yesterday': return this.insertAtCaret(await link(shift(-1)));
      case 'time': return this.insertAtCaret(nowTime());
      case 'link': return this.insertAtCaret('[[]]', 2);
      case 'tag': return this.insertAtCaret('#');
      case 'bold': return this.wrap('**', '**');
      case 'italic': return this.wrap('*', '*');
      case 'mark': return this.wrap('^^', '^^');
      case 'strike': return this.wrap('~~', '~~');
      case 'code': return this.wrap('`', '`');
      case 'codeblock': return this.wrap('```\n', '\n```');
      case 'math': return this.wrap('$', '$');
      case 'h1': return this.setHeading(1);
      case 'h2': return this.setHeading(2);
      case 'h3': return this.setHeading(3);
      case 'pa': return this.setPriority('A');
      case 'pb': return this.setPriority('B');
      case 'pc': return this.setPriority('C');
      case 'image': return this.pickImage();
      case 'template': {
        let list = [];
        try { list = await call('templates'); } catch { /* none */ }
        if (!list.length) { this.app.toast('No templates yet. Add template:: name to a block to make one.', 4000); return; }
        this.app.ac.show(this, 'template', this.ta.selectionStart, '', list.map((t) => ({ label: t.name, html: `${esc(t.name)}<span class="hint">${esc(t.page)}</span>`, value: t.name })));
        return;
      }
      default:
    }
  }

  /** Insert a template's blocks after this block (or in place of it, when it's empty). */
  async insertTemplate(name) {
    const i = this.cur ?? this.end - 1;
    let tpl;
    try { tpl = await call('template', { name, page: this.name, today: today(), time: nowTime() }); }
    catch (e) { this.app.toast(String(e)); return; }
    if (!tpl.length) return;
    this.snap();
    const base = this.blocks[i].depth;
    const add = tpl.map((b) => ({ depth: base + b.depth, text: b.text, raw: null }));
    let at;
    if (!this.textOf(i).trim()) { this.blocks.splice(i, 1); at = i; } else at = this.subtreeEnd(i);
    this.blocks.splice(at, 0, ...add);
    this.reflow(at + add.length - 1, 'end');
  }

  pickImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => { for (const f of input.files) await this.addImage(f); };
    input.click();
  }

  /** Copy an image into the notes folder's assets and link it here. */
  async addImage(file) {
    if (file.size > 25e6) { this.app.toast('That file is over 25 MB; pick a smaller one.'); return; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    let path;
    try { path = await call('save_asset', { name: file.name || 'image.png', data }); }
    catch (e) { this.app.toast('Couldn’t add the image: ' + e); return; }
    const alt = (file.name || 'image').replace(/\.[^.]+$/, '');
    const md = `![${alt}](${path})`;
    if (this.ta) this.insertAtCaret(md);
    else {
      this.snap();
      const at = this.end;
      this.blocks.splice(at, 0, { depth: this.baseDepth + (this.root === null ? 0 : 1), text: md, raw: null });
      this.reflow(at, 'end');
    }
  }

  toggleCollapse(i) {
    if (this.readonly) return;
    this.snap();
    const b = this.blocks[i];
    if (this.isCollapsed(i)) b.text = b.text.replace(COLLAPSED_RE, '');
    else b.text = b.text.replace(/\ncollapsed:: false(?=\n|$)/, '') + '\ncollapsed:: true';
    const editing = this.cur;
    this.stopEdit();
    this.render();
    this.markDirty();
    if (editing !== null && !this.hiddenSet().has(editing)) this.edit(editing);
  }

  /** The block whose thread line (the vertical line linking its children) is under the
   *  pointer, or null. Only the empty strip left of a bullet counts. */
  threadAt(e, blk) {
    if (this.readonly || e.target !== blk) return null;
    const i = +blk.dataset.i;
    const d = this.blocks[i].depth - this.baseDepth;
    if (d <= 0) return null;
    const unit = parseFloat(getComputedStyle(blk, '::before').width) / d; // 24 px (20 on phones)
    if (!unit) return null;
    // text size other than 100% zooms the page: the mouse is in screen pixels, the guide widths aren't
    const r = blk.getBoundingClientRect();
    const x = (e.clientX - r.left) / zoomOf(blk, r);
    const k = Math.floor(x / unit);
    if (k < 0 || k >= d || Math.abs(x - (k * unit + 9.5)) > 6) return null;
    let a = i;
    while (a >= 0 && this.blocks[a].depth > this.baseDepth + k) a = this.parentOf(a);
    return a >= this.start ? a : null;
  }

  /** Light up the thread line of block a (null: none). */
  showThread(a) {
    if (a === this.threadA && (a === null || this.threadEl?.isConnected)) return;
    this.threadA = a;
    this.threadEl?.remove();
    this.threadEl = null;
    this.el.classList.toggle('on-thread', a !== null);
    if (a === null) return;
    const top = this.blockDiv(a)?.querySelector(':scope > .bul');
    const last = this.lastShownUnder(a);
    const bottom = last < 0 ? null : this.blockDiv(last)?.getBoundingClientRect().bottom ?? null;
    if (!top || bottom === null) return;
    const host = this.el.getBoundingClientRect();
    const z = zoomOf(this.el, host); // rects are on screen; the line's own sizes get zoomed again
    const b = top.getBoundingClientRect();
    // starts where the pale line does: just below the dot (see .blk::after in app.css)
    const dot = parseFloat(getComputedStyle(top, '::after').height) || 6;
    const y0 = (b.top + b.height / 2 - host.top) / z + dot / 2 + 4;
    const line = document.createElement('div');
    line.className = 'thread-hl';
    line.style.left = `${(b.left + b.width / 2 - host.left) / z - 1}px`;
    line.style.top = `${y0}px`;
    line.style.height = `${Math.max(0, (bottom - host.top) / z - y0)}px`;
    this.el.append(line);
    this.threadEl = line;
  }

  /** The last block under a that is on screen (not inside a folded block, already drawn); -1 if none.
   *  Worked out from the notes rather than the page, so it stays quick on very long pages. */
  lastShownUnder(a) {
    const end = Math.min(this.subtreeEnd(a), this.drawn);
    let last = -1;
    for (let j = a + 1; j < end; j = this.isCollapsed(j) ? this.subtreeEnd(j) : j + 1) last = j;
    return last;
  }

  /** Like Logseq's thread lines: fold everything under block a, or unfold it all if anything
   *  under it is folded. Block a itself stays open. */
  toggleBranch(a) {
    if (this.readonly) return;
    const parents = [];
    for (let j = a + 1; j < this.subtreeEnd(a); j++) if (this.hasKids(j)) parents.push(j);
    if (!parents.length) return;
    const anyFolded = parents.some((j) => this.isCollapsed(j));
    this.snap();
    for (const j of parents) {
      const b = this.blocks[j];
      if (anyFolded) b.text = b.text.replace(COLLAPSED_RE, '');
      else if (!this.isCollapsed(j)) b.text = b.text.replace(/\ncollapsed:: false(?=\n|$)/, '') + '\ncollapsed:: true';
    }
    const editing = this.cur;
    this.stopEdit();
    this.showThread(null);
    this.render();
    this.markDirty();
    if (editing !== null && !this.hiddenSet().has(editing)) this.edit(editing);
  }

  /** Fold everything that has children, or unfold all if anything is folded. */
  toggleAll() {
    if (this.readonly) return;
    const parents = [];
    for (let i = this.start; i < this.end; i++) if (this.hasKids(i) && i !== this.root) parents.push(i);
    if (!parents.length) return;
    const anyFolded = parents.some((i) => this.isCollapsed(i));
    this.snap();
    for (const i of parents) {
      const b = this.blocks[i];
      if (anyFolded) b.text = b.text.replace(COLLAPSED_RE, '');
      else if (!this.isCollapsed(i)) b.text = b.text.replace(/\ncollapsed:: false(?=\n|$)/, '') + '\ncollapsed:: true';
    }
    this.stopEdit();
    this.render();
    this.markDirty();
  }

  /** Re-render after a structural change and keep editing block `i` at `caret`. */
  reflow(i, caret) {
    this.cur = null;
    this.ta = null;
    this.render();
    this.markDirty();
    this.edit(Math.max(this.start, Math.min(i, this.end - 1)), caret);
  }

  // ---------- parents pinned at the top ----------
  /** Long pages: the notes above the one at the top of the screen (its parent, grandparent…) stay
   *  pinned there, one line each, so you can see where you are; a tap on one goes to it. Called
   *  by the app while scrolling. top: where the notes start on screen; stick: the pinned rows'
   *  place for position: sticky (that, or 0 when #main scrolls); hide: show none (editing on a phone). */
  pinParents(top, stick, hide = false) {
    const r = this.el.getBoundingClientRect();
    const rowH = PIN_H * zoomOf(this.el, r);
    let pins = [];
    if (!hide && r.top < top && r.bottom > top + 2 * rowH) {
      const x = r.left + r.width / 2;
      for (let n = 0; n < 8; n++) { // the rows found cover notes, which may have parents too: again
        const y = top + pins.length * rowH + 1;
        const blk = this.rowAt(y);
        if (!blk) break;
        const i = +blk.dataset.i;
        const chain = [];
        for (let a = this.parentOf(i); a >= this.start; a = this.parentOf(a)) chain.unshift(a);
        // the note there too, if its first line is out of sight and its children are showing
        if (this.hasKids(i) && !this.isCollapsed(i) && blk.getBoundingClientRect().top < y - rowH / 2) chain.push(i);
        const next = [];
        for (let k = 0; k < chain.length; k++) {
          const d = this.blockDiv(chain[k]);
          if (!d || d.getBoundingClientRect().top >= top + k * rowH - 1) break; // still in sight
          next.push(chain[k]);
        }
        const same = next.length === pins.length;
        pins = next;
        if (same) break;
      }
    }
    if (this.pinStick !== stick) { this.pinStick = stick; this.pins.style.top = stick + 'px'; }
    const key = pins.join(',');
    if (key === this.pinned) return;
    this.pinned = key;
    this.pins.hidden = !pins.length;
    this.pins.firstChild.innerHTML = pins.map((i) => `<div class="pin" data-i="${i}" style="--d:${this.blocks[i].depth - this.baseDepth}">${this.pinText(i)}</div>`).join('');
  }
  /** A note's first line of words, for a pinned row. */
  pinText(i) {
    const lines = this.blocks[i].text.split('\n').filter((l) => !isProp(l) && !/^\s*(#\+(BEGIN|END)_|:[A-Za-z-]+:\s*$|(SCHEDULED|DEADLINE):|```)/i.test(l));
    const r = renderBlock((lines[0] || '').replace(/^\s*>\s?(\[![\w-]+\][+-]?\s*)?/, ''));
    return (r.marker ? (r.marker === 'DONE' ? '☑ ' : '☐ ') : '') + r.html;
  }
  /** Scroll so note i is at the top, just under its own pinned parents. */
  goToPinned(i) {
    const d = this.blockDiv(i);
    if (!d) return;
    let above = 0;
    for (let a = this.parentOf(i); a >= this.start; a = this.parentOf(a)) above++;
    const s = this.app.scroller();
    s.by(d.getBoundingClientRect().top - s.top - above * PIN_H * zoomOf(this.el) - 4);
  }

  flash(i) {
    this.ensureDrawn(i);
    const div = this.blockDiv(i);
    if (!div) return;
    div.hidden = false; // show it even if a folded parent hides it
    div.scrollIntoView({ block: 'center' });
    div.classList.add('hit');
    setTimeout(() => div.classList.remove('hit'), 1600);
  }

  // ---------- saving ----------
  markDirty() { this.dirty = true; this.flushSoon(800); }
  flushSoon(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), ms); }

  /** Resolves once everything typed so far is saved (or a conflict is waiting for the user). */
  async flush() {
    clearTimeout(this.timer);
    for (let k = 0; k < 8; k++) {
      if (this.saving) { await this.saving; continue; }
      if (!this.dirty || this.conflict || this.readonly) return;
      await this.save();
    }
  }

  save(force = false) {
    // one save at a time: another asked for meanwhile follows it (still forced if it was)
    if (this.saving) { this.again = true; this.againForce ||= force; return this.saving; }
    if ((!this.dirty && !force) || this.readonly) return Promise.resolve();
    if (this.conflict && !force) return Promise.resolve(); // waiting for his choice (clash.js): trying again would only clash again
    this.saving = (async () => {
      this.dirty = false;
      const sent = clone(this.doc);
      try {
        const res = await call('save', { name: this.name, doc: sent, base_hash: this.hash, force, path: this.path, base: this.base });
        this.saveError = null;
        if (res.conflict) {
          this.dirty = true;
          this.conflict = true;
          this.backupPending(); // until he chooses, this page is only in memory
          this.showConflict();
          return;
        }
        this.conflict = false;
        this.banner.hidden = true;
        if (res.hash) this.exists = true;
        if (res.merged && this.dirty) {
          // more typing arrived while saving: merge again on the next save, from what we sent (an
          // Undo meanwhile is merged the same way, so the undo steps can stay)
          this.base = sent;
          this.app.toast('Changes made elsewhere were added to this page', 2500);
        } else if (res.merged) {
          this.hash = res.hash;
          this.applyMerged(res.merged);
          this.app.toast('Changes made elsewhere were added to this page', 2500);
        } else {
          this.hash = res.hash;
          this.base = sent;
        }
        this.app.saved(this);
      } catch (err) {
        this.dirty = true;
        this.saveError = String(err); // (the clash screen's "Keep mine" checks it)
        this.app.toast('Could not save “' + this.name + '”: ' + err, 6000);
      }
    })();
    return this.saving.finally(() => {
      this.saving = null;
      if (this.again) {
        const f = this.againForce;
        this.again = this.againForce = false;
        return this.save(f);
      }
    });
  }

  /** The page as saved after combining with changes made elsewhere: show it, keep the caret. The
   *  undo steps are dropped: they hold the page from before the other changes came in, so going back
   *  to one would quietly remove them again. */
  applyMerged(doc) {
    const editing = this.cur;
    const caret = this.ta?.selectionStart ?? null;
    const key = editing !== null ? this.blocks[editing] : null;
    this.doc = doc;
    this.base = clone(doc);
    this.forgetUndo();
    if (this.zoomLine !== null && this.root !== null) this.root = Math.min(this.root, this.blocks.length - 1);
    let at = null;
    if (key) {
      let best = Infinity;
      this.blocks.forEach((b, k) => { if (b.text === key.text && b.depth === key.depth && Math.abs(k - editing) < best) { best = Math.abs(k - editing); at = k; } });
    }
    this.cur = null;
    this.ta = null;
    this.render();
    if (at !== null) this.edit(at, caret ?? 'end');
  }

  showBanner(html) {
    this.banner.className = 'banner';
    this.banner.hidden = false;
    this.banner.innerHTML = html;
  }

  /** The page was changed here and somewhere else in the same notes: the clash screen (clash.js)
   *  shows both versions to choose from; until he chooses, this banner offers it again. Nothing on
   *  the page is saved meanwhile (backupPending keeps copies of it in logseq/bak instead). */
  showConflict() {
    this.showBanner(`<span>This page was also changed somewhere else (your phone, Claude or another app), in the same notes as here. Nothing on this page is saved until you choose.</span>
      <span class="btn-row"><button class="btn" data-a="choose">Choose what to keep…</button></span>`);
    this.app.conflicts?.add(this);
    this.banner.onclick = (e) => { if (e.target.closest('[data-a="choose"]')) openClash(this); };
    openClash(this);
  }

  /** Keep this device's version of the page in logseq/bak, unless this exact version is kept there
   *  already (or on its way: two calls at once make one copy). Throws if it can't be kept. */
  async backupMine(keepalive = false) {
    const key = docKey(this.doc);
    if (key === this.bakKey) return;
    if (this.bakRun?.key !== key) {
      const p = call('backup', { name: this.name, doc: clone(this.doc) }, { keepalive });
      const run = { key, p, n: (this.bakN = (this.bakN || 0) + 1) };
      this.bakRun = run;
      // the newest version backed up is the one that counts (an older call may finish later)
      p.then(() => { if (run.n > (this.bakDone || 0)) { this.bakDone = run.n; this.bakKey = key; } }, () => {})
        .finally(() => { if (this.bakRun === run) this.bakRun = null; });
    }
    await this.bakRun.p;
  }

  /** While a clash waits for his choice, this page exists only here: a copy goes to logseq/bak when
   *  the clash first shows, and again when the app is put away or closed if he typed more since.
   *  Never throws (a problem goes to the problems log). */
  async backupPending(keepalive = false) {
    if (!this.conflict || this.readonly) return;
    try { await this.backupMine(keepalive); }
    catch (err) { call('log', { msg: `backup while a clash waits (“${this.name}”): ${err}` }).catch(() => {}); }
  }

  /** Re-read the page from disk (after sync/Claude changed it). Skips if the user is busy here. */
  async reload(forceIt = false) {
    const busy = () => this.cur !== null || this.dirty || this.saving || this.sel || this.conflict;
    if (!forceIt && busy()) return false;
    const view = await call('page', { name: this.name, today: today(), time: nowTime() });
    if (!forceIt && busy()) return false; // typing started while it loaded
    this.stopEdit();
    this.load(view);
    if (!this.error) this.banner.hidden = true;
    this.forgetUndo();
    this.render();
    return true;
  }
}

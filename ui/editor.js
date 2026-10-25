// Outline editor for one page. Model = the backend's Doc ({preamble, blocks, indent, crlf}).
// Typing updates the model in place; structural edits (split, merge, indent, move) re-render.
// Saving is debounced; the backend refuses to overwrite a file that changed on disk meanwhile.

import { call } from './api.js';
import { renderBlock, propsHtml, esc } from './render.js';

const OPEN_MARKERS = ['TODO', 'DOING', 'LATER', 'NOW', 'WAITING'];
const COLLAPSED_RE = /\ncollapsed:: true(?=\n|$)/;
const nl = (s) => (s.match(/\n/g) || []).length;

export class Outline {
  /** host: element to render into. view: PageView from the backend. app: shared app services. */
  constructor(host, view, app) {
    this.app = app;
    this.host = host;
    this.load(view);
    this.el = document.createElement('div');
    this.el.className = 'outline';
    this.banner = document.createElement('div');
    this.banner.hidden = true;
    host.append(this.banner, this.el);
    this.cur = null; // index of block being edited
    this.ta = null;
    this.bindEvents();
    this.render();
  }

  load(view) {
    this.name = view.info.name;
    this.path = view.info.path;
    this.exists = view.info.exists;
    this.doc = view.doc;
    this.hash = view.hash;
    this.readonly = !!view.readonly;
    this.dirty = false;
    if (!this.doc.blocks.length) this.doc.blocks.push({ depth: 0, text: '', raw: null });
  }

  get blocks() { return this.doc.blocks; }

  // ---------- structure helpers ----------
  subtreeEnd(i) {
    const d = this.blocks[i].depth;
    let j = i + 1;
    while (j < this.blocks.length && this.blocks[j].depth > d) j++;
    return j;
  }
  hasKids(i) { return i + 1 < this.blocks.length && this.blocks[i + 1].depth > this.blocks[i].depth; }
  isCollapsed(i) { return COLLAPSED_RE.test('\n' + this.blocks[i].text.split('\n').slice(1).join('\n')) && this.hasKids(i); }
  hiddenSet() {
    const hidden = new Set();
    for (let i = 0; i < this.blocks.length; i++) {
      if (hidden.has(i)) continue;
      if (this.isCollapsed(i)) for (let j = i + 1; j < this.subtreeEnd(i); j++) hidden.add(j);
    }
    return hidden;
  }
  prevVisible(i) { const h = this.hiddenSet(); for (let j = i - 1; j >= 0; j--) if (!h.has(j)) return j; return -1; }
  nextVisible(i) { const h = this.hiddenSet(); for (let j = i + 1; j < this.blocks.length; j++) if (!h.has(j)) return j; return -1; }

  /** Block index whose first line is file line `line` (0-based), for jumping from references. */
  indexForLine(line) {
    let at = nl(this.doc.preamble);
    for (let i = 0; i < this.blocks.length; i++) {
      if (at >= line) return i;
      at += nl(this.blocks[i].raw ?? this.blocks[i].text + '\n');
    }
    return this.blocks.length - 1;
  }

  // ---------- rendering ----------
  render() {
    const hidden = this.hiddenSet();
    this.el.innerHTML = '';
    this.blocks.forEach((b, i) => {
      const div = document.createElement('div');
      div.className = 'blk';
      div.dataset.i = i;
      div.style.setProperty('--d', b.depth);
      if (hidden.has(i)) div.hidden = true;
      if (this.hasKids(i)) div.classList.add('has-kids');
      if (this.isCollapsed(i)) div.classList.add('collapsed');
      const bul = document.createElement('button');
      bul.className = 'bul';
      bul.tabIndex = -1;
      bul.setAttribute('aria-label', this.hasKids(i) ? 'Fold or unfold' : 'Bullet');
      div.append(bul, this.viewEl(i));
      this.el.append(div);
    });
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
    bc.innerHTML = pre + r.html + propsHtml(r.props);
    if (!b.text.trim()) bc.dataset.ph = i === 0 && this.blocks.length === 1 ? 'Click to write…' : '';
    // the caller attaches bc synchronously; mark finished to-dos on the block once attached
    const doneCls = r.marker === 'DONE' || (r.marker || '').startsWith('CANCEL');
    queueMicrotask(() => bc.parentElement?.classList.toggle('marker-done', doneCls));
    return bc;
  }

  refreshBlock(i) {
    const div = this.el.querySelector(`.blk[data-i="${i}"]`);
    if (!div) return;
    const old = div.querySelector('.bc, .ed');
    if (old && old !== this.ta) old.replaceWith(this.viewEl(i));
  }

  // ---------- events ----------
  bindEvents() {
    this.el.addEventListener('click', (e) => {
      const t = e.target;
      const blk = t.closest('.blk');
      if (!blk) return;
      const i = +blk.dataset.i;
      const a = t.closest('a');
      if (a) {
        e.preventDefault();
        if (a.dataset.page) { this.flush(); this.app.go('page', a.dataset.page); }
        else if (a.href) this.app.openUrl(a.getAttribute('href'));
        return;
      }
      if (t.classList.contains('todo')) { e.preventDefault(); this.toggleTodo(i); return; }
      if (t.classList.contains('pk')) { this.app.go('props', t.dataset.prop); return; }
      if (t.classList.contains('bul')) {
        if (this.hasKids(i)) this.toggleCollapse(i);
        else this.edit(i);
        return;
      }
      if (t.closest('.bc')) {
        if (window.getSelection()?.toString()) return; // let people select text to copy
        this.edit(i);
      }
    });
  }

  // ---------- editing ----------
  edit(i, caret = 'end') {
    if (i < 0 || i >= this.blocks.length) return;
    if (this.readonly) { this.app.toast('This file isn’t plain UTF-8 text, so it can be read here but not edited.'); return; }
    if (this.cur === i && this.ta) { this.ta.focus(); return; }
    this.stopEdit();
    const div = this.el.querySelector(`.blk[data-i="${i}"]`);
    if (!div) return;
    div.hidden = false;
    const ta = document.createElement('textarea');
    ta.className = 'ed';
    ta.rows = 1;
    ta.value = this.blocks[i].text;
    ta.setAttribute('autocapitalize', 'sentences');
    div.querySelector('.bc').replaceWith(ta);
    div.classList.remove('marker-done');
    this.ta = ta;
    this.cur = i;
    this.autosize();
    ta.focus({ preventScroll: true });
    const pos = caret === 'end' ? ta.value.length : Math.min(caret, ta.value.length);
    ta.setSelectionRange(pos, pos);
    ta.scrollIntoView({ block: 'nearest' });
    ta.addEventListener('input', (e) => this.onInput(e));
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('paste', (e) => this.onPaste(e));
    ta.addEventListener('blur', () => setTimeout(() => {
      if (this.ta === ta && document.activeElement !== ta && document.hasFocus()) this.stopEdit();
    }, 120));
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

  onInput(e) {
    const ta = this.ta;
    // auto-close [[ with ]]
    if (e.inputType === 'insertText' && e.data === '[') {
      const c = ta.selectionStart;
      if (ta.value.slice(c - 2, c) === '[[' && ta.value.slice(c, c + 2) !== ']]') {
        ta.setRangeText(']]', c, c, 'start');
      }
    }
    this.blocks[this.cur].text = ta.value;
    this.autosize();
    this.markDirty();
    this.app.ac.check(this);
  }

  onKey(e) {
    const ta = this.ta;
    const i = this.cur;
    if (this.app.ac.handleKey(e)) return;
    if (e.isComposing) return;
    const c = ta.selectionStart, cEnd = ta.selectionEnd, v = ta.value;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && mod) { e.preventDefault(); this.cycleTodo(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); this.split(i, c, cEnd); return; }
    if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? this.outdent(i) : this.indent(i); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.stopEdit(); return; }
    if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); this.move(i, e.key === 'ArrowUp' ? -1 : 1); return;
    }
    if (e.key === 'Backspace' && c === 0 && cEnd === 0) { e.preventDefault(); this.mergeUp(i); return; }
    if (e.key === 'Delete' && c === v.length && cEnd === c) { e.preventDefault(); this.mergeDown(i); return; }
    if (e.key === 'ArrowUp' && !e.shiftKey && v.lastIndexOf('\n', c - 1) === -1) {
      const p = this.prevVisible(i);
      if (p >= 0) { e.preventDefault(); this.edit(p, 'end'); }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && v.indexOf('\n', c) === -1) {
      const n = this.nextVisible(i);
      if (n >= 0) { e.preventDefault(); this.edit(n, 0); }
    }
  }

  onPaste(e) {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const lines = text.replace(/\r/g, '').split('\n');
    const bullets = lines.filter((l) => /^\s*- |^\s*-$/.test(l)).length;
    if (bullets < 2) return; // plain paste stays inside this block
    e.preventDefault();
    const parsed = [];
    for (const l of lines) {
      const m = l.match(/^([\t ]*)- ?(.*)$/);
      if (m) {
        const lead = m[1];
        parsed.push({ depth: (lead.match(/\t/g) || []).length + Math.floor((lead.match(/ /g) || []).length / 2), text: m[2] });
      } else if (parsed.length && l.trim()) {
        parsed[parsed.length - 1].text += '\n' + l.trim();
      }
    }
    const min = Math.min(...parsed.map((p) => p.depth));
    const i = this.cur;
    const base = this.blocks[i].depth;
    const add = parsed.map((p) => ({ depth: base + p.depth - min, text: p.text, raw: null }));
    let at = i + 1;
    if (!this.blocks[i].text.trim()) { this.blocks.splice(i, 1); at = i; }
    this.blocks.splice(at, 0, ...add);
    this.cur = null; this.ta = null;
    this.render();
    this.markDirty();
    this.edit(at + add.length - 1, 'end');
  }

  // ---------- operations (also used by the mobile toolbar) ----------
  split(i, c, cEnd = c) {
    const b = this.blocks[i];
    const v = this.ta ? this.ta.value : b.text;
    const before = v.slice(0, c), after = v.slice(cEnd);
    if (!v.trim() && b.depth > 0) { this.outdent(i); return; } // Enter on an empty child: step out
    let at, depth;
    if (c === 0 && after) { // at the start: open a line above
      this.blocks.splice(i, 0, { depth: b.depth, text: '', raw: null });
      this.reflow(i + 1, 0);
      return;
    }
    b.text = before;
    if (this.hasKids(i) && !this.isCollapsed(i)) { at = i + 1; depth = b.depth + 1; }
    else { at = this.subtreeEnd(i); depth = b.depth; }
    this.blocks.splice(at, 0, { depth, text: after, raw: null });
    this.reflow(at, 0);
  }

  indent(i) {
    if (i <= 0) return;
    const b = this.blocks[i];
    if (this.blocks[i - 1].depth < b.depth) return;
    const caret = this.ta?.selectionStart ?? 'end';
    for (let j = i; j < this.subtreeEnd(i); j++) this.blocks[j].depth++;
    this.reflow(i, caret);
  }

  outdent(i) {
    const b = this.blocks[i];
    if (b.depth === 0) return;
    const caret = this.ta?.selectionStart ?? 'end';
    for (let j = i; j < this.subtreeEnd(i); j++) this.blocks[j].depth--;
    this.reflow(i, caret);
  }

  move(i, dir) {
    const d = this.blocks[i].depth;
    const end = this.subtreeEnd(i);
    const caret = this.ta?.selectionStart ?? 'end';
    if (dir < 0) {
      let j = i - 1;
      while (j >= 0 && this.blocks[j].depth > d) j--;
      if (j < 0 || this.blocks[j].depth !== d) return;
      const chunk = this.blocks.splice(i, end - i);
      this.blocks.splice(j, 0, ...chunk);
      this.reflow(j, caret);
    } else {
      if (end >= this.blocks.length || this.blocks[end].depth !== d) return;
      const nextEnd = this.subtreeEnd(end);
      const chunk = this.blocks.splice(i, end - i);
      const at = nextEnd - chunk.length;
      this.blocks.splice(at, 0, ...chunk);
      this.reflow(at, caret);
    }
  }

  mergeUp(i) {
    const b = this.blocks[i];
    const p = this.prevVisible(i);
    if (p < 0) {
      if (!b.text && this.blocks.length > 1) { this.blocks.splice(i, 1); this.reflow(0, 0); }
      return;
    }
    if (this.hasKids(i) && b.text) return; // don't swallow a parent into the line above
    const prev = this.blocks[p];
    const join = prev.text.length;
    prev.text += b.text;
    this.blocks.splice(i, 1);
    this.reflow(p, join);
  }

  mergeDown(i) {
    const n = this.nextVisible(i);
    if (n < 0 || this.hasKids(n)) return;
    const b = this.blocks[i];
    const join = b.text.length;
    b.text += this.blocks[n].text;
    this.blocks.splice(n, 1);
    this.reflow(i, join);
  }

  cycleTodo() {
    const ta = this.ta;
    const b = this.blocks[this.cur];
    const v = b.text;
    let nv;
    const m = v.match(/^(TODO|DOING|LATER|NOW|WAITING|DONE|CANCELED|CANCELLED) /);
    if (!m) nv = 'TODO ' + v;
    else if (m[1] === 'DONE') nv = v.slice(5);
    else nv = 'DONE ' + v.slice(m[0].length);
    const delta = nv.length - v.length;
    const c = ta.selectionStart;
    b.text = ta.value = nv;
    ta.setSelectionRange(Math.max(0, c + delta), Math.max(0, c + delta));
    this.markDirty();
  }

  toggleTodo(i) {
    if (this.readonly) return;
    const b = this.blocks[i];
    const m = b.text.match(/^(TODO|DOING|LATER|NOW|WAITING|DONE) /);
    if (!m) return;
    b.text = (m[1] === 'DONE' ? 'TODO ' : 'DONE ') + b.text.slice(m[0].length);
    this.refreshBlock(i);
    this.markDirty();
  }

  toggleCollapse(i) {
    if (this.readonly) return;
    const b = this.blocks[i];
    if (this.isCollapsed(i)) b.text = b.text.replace(COLLAPSED_RE, '');
    else b.text = b.text.replace(/\ncollapsed:: false(?=\n|$)/, '') + '\ncollapsed:: true';
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
    this.edit(Math.max(0, Math.min(i, this.blocks.length - 1)), caret);
  }

  insertAtCaret(text) {
    if (!this.ta) return;
    const ta = this.ta;
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text.slice(-1) }));
  }

  flash(i) {
    const div = this.el.querySelector(`.blk[data-i="${i}"]`);
    if (!div) return;
    div.hidden = false; // show it even if a folded parent hides it
    div.scrollIntoView({ block: 'center' });
    div.classList.add('hit');
    setTimeout(() => div.classList.remove('hit'), 1600);
  }

  // ---------- saving ----------
  markDirty() { this.dirty = true; this.flushSoon(900); }
  flushSoon(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), ms); }
  flush() { clearTimeout(this.timer); return this.save(); }

  async save(force = false) {
    if (this.saving) { this.again = true; return; }
    if (!this.dirty && !force) return;
    this.saving = true;
    this.dirty = false;
    try {
      const res = await call('save', { name: this.name, doc: this.doc, base_hash: this.hash, force });
      if (res.conflict) { this.dirty = true; this.showConflict(); }
      else {
        this.hash = res.hash;
        if (res.hash) this.exists = true;
        this.banner.hidden = true;
        this.app.saved(this);
      }
    } catch (err) {
      this.dirty = true;
      this.app.toast('Could not save “' + this.name + '”: ' + err);
    } finally {
      this.saving = false;
      if (this.again) { this.again = false; this.save(); }
    }
  }

  showConflict() {
    this.banner.className = 'banner';
    this.banner.hidden = false;
    this.banner.innerHTML = `<span>This page was changed somewhere else (another device or Claude) since you opened it.</span>
      <span class="btn-row"><button class="btn ghost" data-a="load">Load the new version</button>
      <button class="btn" data-a="keep">Keep mine</button></span>`;
    this.banner.onclick = async (e) => {
      const a = e.target.dataset.a;
      if (a === 'keep') { this.dirty = true; await this.save(true); }
      if (a === 'load') { this.dirty = false; await this.reload(true); }
    };
  }

  /** Re-read the page from disk (after sync/Claude changed it). Skips if the user is mid-edit. */
  async reload(forceIt = false) {
    if (!forceIt && (this.cur !== null || this.dirty || this.saving)) return false;
    const view = await call('page', { name: this.name });
    this.stopEdit();
    this.load(view);
    this.banner.hidden = true;
    this.render();
    return true;
  }
}

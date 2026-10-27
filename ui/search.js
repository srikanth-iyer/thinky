// The search box (Ctrl+K) and the command list (Ctrl+Shift+P): one box, two modes, as in Logseq.
// Search: pages whose name (or alias) has the words, in any order, small typos forgiven (the core's
// search.rs), then "New page: …", then notes, each drawn as it looks (links as their names), the
// words marked. Opened empty: recent searches (kept per notes folder; Clear) and recent pages.
// Commands: commands.js's list, filtered by what's typed, each with its key; Enter runs it.

import { call, store } from './api.js';
import { renderBlock, esc } from './render.js';
import { h, ICON } from './dom.js';
import { commandList, keyHtml, keyOf, editingNow, editAgain } from './commands.js';

const $ = (sel, root = document) => root.querySelector(sel);
const SEARCHES_KEPT = 8; // recent searches remembered per notes folder (5 shown)

// ---------------------------------------------------------------------------
// Words compared as the core compares them (search.rs `fold`): small letters, accents dropped.
const LATIN1 = 'aaaaaa-ceeeeiiii-nooooo-ouuuuy-y'; // U+00E0..U+00FF
const LATIN_A = 'aaaaaaccccccccddddeeeeeeeeeegggggggghhhhiiiiiiiiii--jjkkkllllllllllnnnnnnnnnoooooo--rrrrrrssssssssttttttuuuuuuuuuuuuwwyyyzzzzzzs'; // U+0100..U+017F
/** s folded, with where each of its (UTF-16) units came from in s: [a[k], z[k]) */
function foldMap(s) {
  let text = '';
  const a = [], z = [];
  let at = 0;
  for (const c of s) {
    const end = at + c.length;
    for (const l of c.toLowerCase()) {
      const n = l.codePointAt(0);
      if (n >= 0x300 && n <= 0x36f) continue; // a combining accent
      const tb = n >= 0xe0 && n <= 0xff ? LATIN1[n - 0xe0] : n >= 0x100 && n <= 0x17f ? LATIN_A[n - 0x100] : null;
      const f = tb && tb !== '-' ? tb : l;
      text += f;
      for (let k = 0; k < f.length; k++) { a.push(at); z.push(end); }
    }
    at = end;
  }
  return { text, a, z };
}
export const fold = (s) => foldMap(s).text;
/** The words of a search (as the core splits them). */
export const queryWords = (q) => [...new Set(fold(q).split(/\s+/).filter(Boolean))];

/** Mark the words in the text under root (<mark class="hit">); returns the first mark. */
function markWords(root, words) {
  if (words.some((w) => w.length > 1)) words = words.filter((w) => w.length > 1); // (not every "a" of "a model")
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const n of nodes) {
    if (n.parentElement?.closest('.mk')) continue; // (the to-do word label)
    const { text, a, z } = foldMap(n.data);
    let spans = [];
    for (const w of words) for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) spans.push([a[i], z[i + w.length - 1]]);
    if (!spans.length) continue;
    spans.sort((x, y) => x[0] - y[0]);
    spans = spans.reduce((m, s) => { const l = m[m.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else m.push(s); return m; }, []);
    for (const [s, e] of spans.reverse()) {
      n.splitText(e);
      const mid = n.splitText(s);
      const m = h('mark', 'hit');
      mid.replaceWith(m);
      m.append(mid);
    }
  }
  return root.querySelector('mark.hit');
}

/** Cut what comes before `mark` down to about `keep` letters (at a space), with "…" before it, so the
 *  words found show in the two lines a note gets. Formatting around the cut stays (a Range). */
function trimBefore(root, mark, keep = 28) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEndBefore(mark);
  const before = r.toString();
  if (before.length <= keep + 12) return;
  let cut = before.length - keep;
  const sp = before.indexOf(' ', cut);
  if (sp >= 0 && sp < cut + 12) cut = sp + 1;
  // the place `cut` letters in, in the text nodes
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = cut;
  while (walk.nextNode()) {
    const n = walk.currentNode;
    if (left <= n.data.length) {
      let off = left;
      if (off > 0 && off < n.data.length && /[\uD800-\uDBFF]/.test(n.data[off - 1])) off++; // (not inside an emoji)
      r.setStart(root, 0);
      r.setEnd(n, off);
      r.deleteContents();
      root.prepend('…');
      return;
    }
    left -= n.data.length;
  }
}

/** A note as it looks (rendered: links as their names, a to-do word as a label), the words marked;
 *  pictures and big formulas left out. */
function noteEl(text, words) {
  const r = renderBlock(text);
  const t = document.createElement('template'); // (inert: its pictures don't load)
  t.innerHTML = r.html;
  t.content.querySelectorAll('img, .pic, video, audio, iframe, .math.display').forEach((e) => e.remove());
  t.content.querySelectorAll('br').forEach((b) => b.replaceWith(' '));
  const box = h('div', 'r-text');
  box.append(t.content);
  const first = markWords(box, words);
  if (first) trimBefore(box, first);
  if (r.marker) box.prepend(h('span', 'mk', esc(r.marker)), ' ');
  if (!box.textContent.trim()) box.textContent = '…';
  return box;
}

/** A page's name with the places the core found marked (marks: [start, end) in chars). */
function markedName(name, marks = []) {
  const ch = [...name];
  let out = '', at = 0;
  for (const [s, e] of marks) {
    if (s < at || e > ch.length) continue;
    out += esc(ch.slice(at, s).join('')) + `<mark class="hit">${esc(ch.slice(s, e).join(''))}</mark>`;
    at = e;
  }
  return out + esc(ch.slice(at).join(''));
}

// ---------------------------------------------------------------------------
export class SearchBox {
  constructor(app) {
    this.app = app;
    this.el = $('#search');
    this.box = $('.search-box', this.el);
    this.input = $('input', this.el);
    this.ul = $('.results', this.el);
    this.foot = $('.sb-foot', this.el);
    this.mode = 'search';
    this.rows = []; // what can be picked, in order: {kind, …}
    this.sel = 0;
    this.seq = 0;
    this.ul.id = 'search-results';
    this.input.setAttribute('aria-controls', this.ul.id);
    this.input.addEventListener('input', () => this.typed());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.ul.addEventListener('mousedown', (e) => e.preventDefault()); // (the box keeps the keyboard)
    this.ul.addEventListener('click', (e) => {
      if (e.target.closest('.r-clear')) { this.clearSearches(); return; }
      const li = e.target.closest('li[data-k]');
      if (li) { e.preventDefault(); this.pick(+li.dataset.k, e); }
    });
    this.ul.addEventListener('mousemove', (e) => { // the row under the mouse is the one Enter picks
      const li = e.target.closest('li[data-k]');
      if (li && +li.dataset.k !== this.sel) { this.sel = +li.dataset.k; this.paint(false); }
    });
    this.foot?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) this.setMode(b.dataset.mode);
    });
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(true); });
  }
  get isOpen() { return !this.el.hidden; }

  /** Open in a mode ('search' or 'commands'), empty. */
  open(mode = 'search') {
    if (!this.isOpen) {
      this.ed = editingNow(this.app); // (the note being edited stops when the box takes the keyboard)
      this.el.hidden = false;
      document.body.classList.remove('drawer'); // (opened from the phone's menu: the menu's done)
    }
    this.setMode(mode);
  }
  /** cancel: closed without picking (Esc, a click outside): the note that was being edited is again. */
  close(cancel = false) {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.input.blur(); // so the next keys (e.g. "t l") reach the app straight away
    clearTimeout(this.t);
    this.seq++;
    const ed = this.ed;
    this.ed = null;
    if (cancel && ed) editAgain(this.app, ed);
  }
  setMode(mode) {
    this.mode = mode;
    const cmd = mode === 'commands';
    this.box.classList.toggle('cmd-mode', cmd);
    this.box.setAttribute('aria-label', cmd ? 'Commands' : 'Search');
    this.input.placeholder = cmd ? 'Type a command' : 'Search pages and notes';
    this.input.setAttribute('aria-label', this.input.placeholder);
    // the other mode, with its key (so it's learned)
    if (this.foot) {
      const other = cmd ? ['search', 'Search', 'go/search', ICON.search] : ['commands', 'Commands', 'command-palette/toggle', ICON.cmd];
      this.foot.innerHTML = `<button type="button" class="sb-mode" data-mode="${other[0]}">${other[3]}<span>${other[1]}</span>${keyHtml(keyOf(this.app, other[2]))}</button>`;
    }
    this.cmds = cmd ? commandList(this.app, this.ed) : null;
    this.input.value = '';
    this.input.focus();
    this.show();
  }

  typed() {
    clearTimeout(this.t);
    if (this.mode === 'commands' || !this.input.value.trim()) this.show();
    else this.t = setTimeout(() => this.show(), 70);
  }
  async show() {
    const seq = ++this.seq;
    const q = this.input.value.trim();
    if (this.mode === 'commands') return this.draw(this.commandRows(q));
    if (!q) return this.draw(this.emptyRows());
    let hits = [];
    try { hits = await call('search', { q }); } catch { /* no notes folder open */ }
    if (seq !== this.seq || !this.isOpen || this.mode !== 'search') return; // (typing went on)
    this.draw(this.resultRows(q, hits));
  }

  // ----- what the list holds: rows ({kind, …}; kind 'h': a heading, 'note': a line of text) -----
  emptyRows() {
    const rows = [];
    const searches = this.searches().slice(0, 5);
    if (searches.length) {
      rows.push({ kind: 'h', html: 'Recent searches <button type="button" class="r-clear" title="Forget these searches">Clear</button>' });
      for (const q of searches) rows.push({ kind: 'again', q });
    }
    const here = this.app.pane.outlines.length === 1 && /^#\/(page|zoom)\//.test(location.hash) ? this.app.pane.outlines[0].name.toLowerCase() : null;
    const pages = this.app.recent().filter((n) => n.toLowerCase() !== here).slice(0, 6);
    if (pages.length) {
      rows.push({ kind: 'h', html: 'Recent pages' });
      for (const name of pages) rows.push({ kind: 'recent', page: name });
    }
    if (!rows.length) rows.push({ kind: 'note', html: 'Type to find pages and notes: the words can come in any order.' });
    return rows;
  }
  resultRows(q, hits) {
    const words = queryWords(q);
    const pages = hits.filter((x) => x.line === null), notes = hits.filter((x) => x.line !== null);
    const ql = q.toLowerCase();
    const exact = pages.some((x) => x.page.toLowerCase() === ql || x.alias?.toLowerCase() === ql);
    const rows = [];
    if (pages.length) rows.push({ kind: 'h', html: 'Pages' });
    for (const x of pages) rows.push({ kind: 'page', page: x.page, alias: x.alias, marks: x.marks });
    // existing pages first, then making a new one (he asked)
    if (!exact && this.app.vaultOpen) rows.push({ kind: 'new', page: q });
    if (notes.length) rows.push({ kind: 'h', html: 'Notes' });
    for (const x of notes) rows.push({ kind: 'hit', page: x.page, line: x.line, text: x.text, words });
    if (!rows.length) rows.push({ kind: 'note', html: 'Nothing found.' });
    return rows;
  }
  commandRows(q) {
    const words = queryWords(q);
    const all = this.cmds || [];
    const rows = [];
    if (!words.length) { // all of them, in groups
      let g = null;
      for (const c of all) {
        if (c.more) continue;
        if (c.group !== g) { g = c.group; rows.push({ kind: 'h', html: esc(g) }); }
        rows.push({ kind: 'cmd', c });
      }
      return rows;
    }
    // every word somewhere in its name (or the words it's also found by); the best first: the name
    // starting with what's typed, then words at the start of the name's words, then in the name
    const scored = [];
    all.forEach((c, k) => {
      const label = fold(c.label), more = fold(`${c.hint || ''} ${c.group} ${c.also || ''}`);
      let score = label.startsWith(words.join(' ')) ? 100 : 0;
      for (const w of words) {
        const i = label.indexOf(w);
        if (i >= 0) score += i === 0 || /[^\p{L}\p{N}]/u.test(label[i - 1]) ? 10 : 5;
        else if (!more.includes(w)) return;
      }
      scored.push({ c, score, k });
    });
    scored.sort((a, b) => !!a.c.more - !!b.c.more || b.score - a.score || a.k - b.k); // (the looks one by one after the rest)
    for (const { c } of scored) rows.push({ kind: 'cmd', c, words });
    if (!rows.length) rows.push({ kind: 'note', html: 'No command has those words.' });
    return rows;
  }

  // ----- drawing -----
  draw(rows) {
    this.rows = [];
    const lis = rows.map((r) => {
      if (r.kind === 'h') return h('li', 'r-h', r.html);
      if (r.kind === 'note') return h('li', 'r-none', r.html);
      const li = h('li', 'r-' + r.kind);
      li.setAttribute('role', 'option');
      li.dataset.k = this.rows.length;
      li.id = 'sr-' + this.rows.length;
      this.rows.push(r);
      this.fill(li, r);
      return li;
    });
    for (const li of lis) if (!li.dataset.k) li.setAttribute('role', 'presentation');
    this.ul.replaceChildren(...lis);
    this.sel = 0;
    this.paint();
  }
  fill(li, r) {
    const app = this.app;
    if (r.kind === 'page') li.innerHTML = `${app.icon(r.page)}<span class="r-name">${markedName(r.alias || r.page, r.marks)}</span>${r.alias ? `<span class="r-hint">→ ${esc(r.page)}</span>` : ''}`;
    else if (r.kind === 'new') li.innerHTML = `${ICON.plus}<span>New page: <b>${esc(r.page)}</b></span>`;
    else if (r.kind === 'recent') li.innerHTML = `${app.icon(r.page)}<span class="r-name">${esc(r.page)}</span>`;
    else if (r.kind === 'again') li.innerHTML = `${ICON.search}<span class="r-name">${esc(r.q)}</span>`;
    else if (r.kind === 'hit') {
      li.append(noteEl(r.text, r.words), h('div', 'r-where', `${app.icon(r.page)}${esc(r.page)}`));
    } else if (r.kind === 'cmd') {
      const key = r.c.key ? keyOf(app, r.c.key) : r.c.keys?.[0];
      const label = h('span', 'r-name', esc(r.c.label));
      if (r.words) markWords(label, r.words);
      li.append(label);
      if (r.c.hint) li.append(h('span', 'r-hint', esc(r.c.hint)));
      if (key) li.append(h('span', 'r-keys', keyHtml(key)));
    }
  }
  paint(scroll = true) {
    const lis = this.ul.querySelectorAll('li[data-k]');
    lis.forEach((li, k) => li.setAttribute('aria-selected', String(k === this.sel)));
    const cur = lis[this.sel];
    if (cur) this.input.setAttribute('aria-activedescendant', cur.id); else this.input.removeAttribute('aria-activedescendant');
    if (scroll && cur) {
      // (a heading right above the first row comes into view with it)
      const prev = cur.previousElementSibling;
      (this.sel === 0 && prev?.classList.contains('r-h') ? prev : cur).scrollIntoView({ block: 'nearest' });
    }
  }

  onKey(e) {
    const app = this.app;
    if (e.isComposing) return;
    const n = this.rows.length;
    const step = (d) => { e.preventDefault(); if (n) { this.sel = (this.sel + d + n) % n; this.paint(); } };
    if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'PageDown') step(Math.min(5, n - 1 - this.sel) || 0);
    else if (e.key === 'PageUp') step(-Math.min(5, this.sel) || 0);
    else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.sel, e); }
    else if (e.key === 'Escape') { e.preventDefault(); this.close(true); }
    else if (app.keyIs(e, 'command-palette/toggle')) { e.preventDefault(); this.setMode(this.mode === 'commands' ? 'search' : 'commands'); }
    else if (app.keyIs(e, 'go/search')) { e.preventDefault(); this.setMode('search'); }
    else return;
    e.stopPropagation();
  }

  /** Pick row k. ev: the key or click (Shift: to the side, Ctrl: a new tab, as for links). */
  pick(k, ev = {}) {
    const r = this.rows[k];
    if (!r) return;
    const app = this.app;
    const q = this.input.value.trim();
    if (r.kind === 'again') { // a recent search: again
      this.input.value = r.q;
      this.show();
      return;
    }
    if (r.kind === 'cmd') return this.runCommand(r.c);
    if (this.mode === 'search' && q) this.keepSearch(q);
    this.close();
    if (app.tabs.on && (ev.shiftKey || ev.ctrlKey || ev.metaKey)) app.tabs.how = ev.shiftKey ? 'side' : 'tab';
    app.go('page', r.page, { line: r.kind === 'hit' ? r.line : null });
  }
  async runCommand(c) {
    if (!c.run) { this.setMode('search'); return; } // "Search"
    const ed = this.ed;
    this.close();
    if (c.edit && !(ed && editAgain(this.app, ed))) { this.app.toast('That note is no longer being edited.', 3000); return; }
    try { await c.run(); } catch (err) { this.app.toast(String(err), 5000); }
  }

  // ----- recent searches, kept for each notes folder -----
  searches() {
    const all = store.get('recentSearches', {});
    return Array.isArray(all[store.get('vault', '')]) ? all[store.get('vault', '')] : [];
  }
  keepSearch(q) {
    const all = store.get('recentSearches', {});
    const v = store.get('vault', '');
    all[v] = [q, ...this.searches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, SEARCHES_KEPT);
    store.set('recentSearches', all);
  }
  clearSearches() {
    const all = store.get('recentSearches', {});
    delete all[store.get('vault', '')];
    store.set('recentSearches', all);
    this.show();
    this.input.focus();
  }
}

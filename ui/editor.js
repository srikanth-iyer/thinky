// Outline editor for one page. Model = the backend's Doc ({preamble, blocks, indent, crlf}).
// Typing updates the model in place; structural edits (split, merge, indent, move) re-render.
// Saving is debounced; the backend merges changes made elsewhere meanwhile, or refuses and
// the user chooses (the other version is kept as a backup copy).

import { call, today, nowTime, noteLinkUrl } from './api.js';
import { renderBlock, propsHtml, datesHtml, esc, PROP, MARKERS, HIDDEN_PROPS, parseStamp, stampText, withPictureSize } from './render.js';
import { pickDate, caretRect, noteMenu, menu, formBox } from './popups.js';
import { openClash } from './clash.js';

// Logseq bookkeeping, never shown in the editing box (Logseq hides these too): ids, folding, a note's
// background colour, auto heading and number list
const HIDE = /^\s*(id|collapsed|heading|background[-_]color|logseq\.order-list-type)::/i;
const COLLAPSED_RE = /\ncollapsed:: true(?=\n|$)/;
/** The note says it's folded in its page (collapsed:: true; it shows so only with sub-notes). */
export const foldedIn = (text) => COLLAPSED_RE.test('\n' + text.split('\n').slice(1).join('\n'));
/** How a note's first line sits (r: renderBlock's result): a heading makes it taller (--hf: how much
 *  bigger), a box or quote first moves it down to the first words (--lead); app.css centres the dot
 *  and the fold arrow on it. Page notes (viewEl) and linked references' notes (app.js refTree). */
export function lineLook(r) {
  const hf = [0, 0.5, 0.3, 0.15, 0.05, 0.05, 0.05][r.heading] || 0;
  const lead = r.html.startsWith('<div class="callout') ? 'calc(var(--callout-gap) + var(--callout-pad))'
    : r.html.startsWith('<blockquote') ? 'var(--quote-gap)' : '';
  return { hf, lead };
}
const folded = (t) => t.replace(/\ncollapsed:: false(?=\n|$)/, '') + '\ncollapsed:: true';
const unfolded = (t) => t.replace(COLLAPSED_RE, '');
// Logseq's note colours, named as it writes them (background-color:: yellow; "gray", not "grey")
export const COLORS = ['yellow', 'red', 'pink', 'green', 'blue', 'purple', 'gray'];
const LIST = 'logseq.order-list-type'; // Logseq's number list: logseq.order-list-type:: number
const NUMBERED = /\n[ \t]*logseq\.order-list-type::[ \t]*number[ \t]*(?=\n|$)/i;
const listed = (t) => /\n[ \t]*logseq\.order-list-type::/i.test(t); // any list type (Logseq: only "number")
const HOLD = 450; // phones: holding a note's dot this long lifts it (ms)
const TOUCH = matchMedia('(any-pointer: coarse)').matches; // (a touch screen: dots can be held and dragged)
const OPEN = new Set(['TODO', 'DOING', 'LATER', 'NOW', 'WAITING', 'WAIT', 'IN-PROGRESS', 'STARTED']);
const CHUNK = 300; // blocks drawn at once; the rest follow right after (long pages)
export const PIN_H = 30; // height of a pinned parent's row (px; app.css .pin)
export const EDGE = 48; // phones: a swipe starting this close to the left edge opens the menu instead (app.js)
const SWIPE = 56; // how far a swipe goes to move a note in or out a level (px)
// typing pairs, as Logseq's editor does (editor.cljs autopair): an opening one typed with nothing
// selected comes with its closing one ("(" only after a space, the start, "]" or "("); with words
// selected, these and the marks below go round them, the words staying selected (twice "*": bold)
const PAIRS = { '[': ']', '(': ')', '{': '}', '`': '`' };
const MARKS = new Set(['*', '_', '~', '^', '=']);
const UNPAIR = { ...PAIRS, '*': '*', '_': '_', '~': '~', '^': '^', '=': '=' }; // Backspace between them takes both
const nl = (s) => (s.match(/\n/g) || []).length;
// a copy from a web page, Word or Google Docs that has more than plain words (onPaste)
const RICH = /<(a\s[^>]*href|b[\s>]|strong|i[\s>]|em[\s>]|s[\s>]|del|strike|mark|code|pre|h[1-6]|li[\s>]|blockquote)|font-weight:\s*(bold|[6-9]00)|font-style:\s*italic|line-through|mso-list/i;
/** A copy from a code editor (VS Code and the like): its first box keeps spaces (white-space: pre)
 *  in a fixed-width font. Its colours and italic comments aren't formatting: plain words, as before. */
const codeCopy = (html) => {
  const m = html.match(/^\s*(?:<meta[^>]*>\s*)*(?:<html[^>]*>\s*)?(?:<head>[\s\S]*?<\/head>\s*)?(?:<body[^>]*>\s*)?(?:<!--StartFragment-->\s*)?<(?:div|pre|code)\b[^>]*>/i);
  return !!m && /white-space:\s*pre/i.test(m[0]) && /monospace|consolas|menlo|monaco|courier|fira code|jetbrains/i.test(m[0]);
};
const isProp = (l) => PROP.test(l);
export const clone = (x) => JSON.parse(JSON.stringify(x));
/** What a page says (properties, and each note's level and words): equal keys, same version. */
export const docKey = (d) => JSON.stringify([d.preamble, d.blocks.map((b) => [b.depth, b.text])]);
/** How much the text size setting zooms the page at el: its size on screen over its own size. */
const zoomOf = (el, rect = el.getBoundingClientRect()) => (el.offsetWidth ? rect.width / el.offsetWidth : 1) || 1;
/** How many lines note b takes in its file (as saved): its lines as read (with blank lines after it)
 *  while its words have as many lines, else its words' lines (raw isn't updated while typing, so a
 *  line added with Shift+Enter shows only in its words; doc.rs join_doc writes changed notes so). */
function fileLines(b) {
  const t = b.text.split('\n').length;
  if (b.raw == null) return t;
  const r = b.raw.split('\n');
  if (r[r.length - 1] === '') r.pop(); // (a line break ends the last line)
  let k = r.length;
  while (k > 1 && !r[k - 1].trim()) k--; // without the blank lines after it
  return k === t ? r.length : t;
}

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
/** Where note i of an earlier version of a page (before: [level, words] of each note) is now: the
 *  same place in the unchanged start or end; between them, in the part that changed, the note with
 *  the same words (the nearest), else the one most like it (same start or end, or holding its words);
 *  the only note there when it was the only one. null: it's gone. */
export function findAgain(before, i, now) {
  const n = before.length, m = now.length;
  const same = (a, b) => a[0] === b.depth && a[1] === b.text;
  let p = 0;
  while (p < n && p < m && same(before[p], now[p])) p++;
  if (i < p) return i;
  let s = 0;
  while (s < n - p && s < m - p && same(before[n - 1 - s], now[m - 1 - s])) s++;
  if (i >= n - s) return i - n + m;
  if (n - s - p === 1 && m - s - p === 1) return p; // one note changed in place
  const words = before[i][1];
  let best = null, score = 0;
  for (let k = p; k < m - s; k++) {
    const t = now[k].text;
    let sc;
    if (t === words) sc = 1e9 - Math.abs(k - i);
    else {
      let a = 0, b = 0;
      while (a < t.length && a < words.length && t[a] === words[a]) a++;
      while (b < t.length && b < words.length && t[t.length - 1 - b] === words[words.length - 1 - b]) b++;
      const like = Math.max(a, b, t && words && (t.includes(words) || words.includes(t)) ? Math.min(t.length, words.length) : 0);
      sc = like && like >= Math.min(3, t.length, words.length) ? like * 1000 - Math.abs(k - i) : 0;
    }
    if (sc > score) { score = sc; best = k; }
  }
  return best;
}
/** The caret at caret in a note's earlier words, in its words now: the same place when the words
 *  before it (or after it) didn't change, else the end. */
export function caretAgain(was, now, caret) {
  if (caret === 'end' || was === now) return caret;
  const a = splitHidden(was).shown, b = splitHidden(now).shown;
  let c = 0;
  while (c < a.length && c < b.length && a[c] === b[c]) c++;
  if (caret <= c) return caret;
  return b.endsWith(a.slice(caret)) ? caret + b.length - a.length : 'end';
}
/** End of the last line that isn't a property: where "the end of the block" is for typing. */
export function contentEnd(s) {
  let pos = 0;
  let end = 0;
  s.split('\n').forEach((l, k) => { if (k === 0 || !isProp(l)) end = pos + l.length; pos += l.length + 1; });
  return end;
}
const propKey = (l) => l.match(PROP)?.[1].toLowerCase();
/** A note's own id: the value of its id:: line ('' when the line is empty), null without one. */
export const idIn = (text) => text.split('\n').slice(1).map((l) => l.match(/^\s*id::[ \t]*(.*?)[ \t]*$/i)?.[1]).find((v) => v !== undefined) ?? null;
/** An id a block reference can use: a UUID (Logseq reads an id:: line only when it is one,
 *  graph-parser block.cljs get-custom-id-or-new-id). */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A new note id, a random UUID as Logseq writes them (lower case, 8-4-4-4-12). */
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
/** The link for a picture or file (a File, or {name, type}) copied into assets/ as path, as the
 *  capture box writes it (app::asset_markdown): a picture as ![name](…), another file as [name.ext](…). */
export function fileLink(file, path, pic = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(file.name || '') || (!file.name && !!file.type?.startsWith('image/'))) {
  const name = (file.name || (pic ? 'image' : 'file')).replace(/[[\]\r\n]/g, '');
  return pic ? `![${name.replace(/\.[^.]+$/, '')}](${path})` : `[${name}](${path})`;
}
/** Which note of doc ({preamble, blocks}) hit is ({line, text}: as the file had it when it was
 *  found): the note starting at that line with those words, else the only note with those words. */
function noteIn(doc, hit) {
  let at = nl(doc.preamble || '');
  for (let j = 0; j < doc.blocks.length; j++) {
    if (at === hit.line && doc.blocks[j].text === hit.text) return j;
    at += fileLines(doc.blocks[j]);
  }
  const same = doc.blocks.flatMap((b, j) => (b.text === hit.text ? [j] : []));
  return same.length === 1 ? same[0] : null;
}
/** Why note b (a doc block) can't be referred to, or '': it isn't written as Logseq writes notes (a
 *  plain paragraph, a "* " bullet: adding its id:: would rewrite it, and the paragraphs after it, as
 *  "- " bullets), or its own id:: isn't one Logseq can use (it is never replaced). */
/** Why note b can't get a reference (an id:: it can use already: never), or ''. */
export const referWhy = (b) => (UUID.test(idIn(b.text) ?? '') ? '' : cantRefer(b));
function cantRefer(b) {
  if (b.plain || (b.raw != null && !/^[ \t]*-( |\r?\n|$)/.test(b.raw))) return 'that note isn’t written as a Logseq bullet (“- ”), and adding its id would rewrite it.';
  const own = idIn(b.text);
  if (own !== null && !UUID.test(own)) return `that note already has ${own ? `an id of its own (“${own}”)` : 'an empty id:: line'}, which Logseq can’t use for a reference, so nothing was changed.`;
  return '';
}
/** Give the note hit ({page, line, text}, from search_blocks) an id:: the Logseq way (withProp:
 *  under its first line, after its other properties), unless it has one (that one is used, never
 *  replaced). Returns the id; null when it can't (a message says why, nothing is written). Its page
 *  open on screen: changed there (one Undo step, its own save); else read and saved like any change
 *  (base_hash: a change made elsewhere meanwhile is merged, a clash changes nothing). */
export async function noteId(app, hit) {
  const sorry = (why) => { app.toast(`The reference wasn’t added: ${why}`, 6000); return null; };
  const known = idIn(hit.text);
  if (known !== null) return UUID.test(known) ? known : sorry(cantRefer({ text: hit.text }));
  const id = newId();
  const here = app.pane?.outlines ?? [];
  const o = [...here, ...app.outlines].find((x) => x.name.toLowerCase() === hit.page.toLowerCase());
  if (o) {
    if (o.readonly || o.conflict) return sorry(`“${o.name}” can’t be changed just now.`);
    await o.flush(); // (its notes as the file has them: hit's line counts in the file)
    const j = o.conflict ? null : noteIn(o.doc, hit);
    if (j === null) return sorry('that note changed meanwhile. Pick it again.');
    const b = { ...o.blocks[j], text: o.textOf(j) };
    const why = cantRefer(b);
    if (why) return sorry(why);
    const now = idIn(b.text);
    if (now !== null) return now;
    o.snap();
    o.setText(j, (t) => withProp(t, 'id', id));
    return id;
  }
  let pv;
  try { pv = await call('page', { name: hit.page }); } catch (e) { return sorry(String(e)); }
  if (pv.readonly) return sorry(`“${hit.page}” can’t be changed here.`);
  const j = noteIn(pv.doc, hit);
  if (j === null) return sorry('that note changed meanwhile. Pick it again.');
  const why = cantRefer(pv.doc.blocks[j]);
  if (why) return sorry(why);
  const now = idIn(pv.doc.blocks[j].text);
  if (now !== null) return now;
  const doc = clone(pv.doc);
  doc.blocks[j].text = withProp(doc.blocks[j].text, 'id', id);
  try {
    const res = await call('save', { name: pv.info.name, doc, base_hash: pv.hash, force: false, path: pv.info.path, base: pv.doc });
    if (res.conflict) return sorry(`“${hit.page}” was changed elsewhere just now. Pick the note again.`);
  } catch (e) { return sorry(String(e)); }
  return id;
}
/** text with property `key` set to `value` (null: taken out), written as Logseq writes it
 *  (insert-property / remove-property): a line already there is changed in place (or taken out); a
 *  new one goes at the end of the properties right under the note's first line, or right under that
 *  line when it has none. Nothing else in the note changes. */
export function withProp(text, key, value) {
  const lines = text.split('\n');
  const k = lines.findIndex((l, n) => n > 0 && propKey(l) === key);
  if (value == null) {
    if (k > 0) lines.splice(k, 1);
  } else if (k > 0) lines[k] = lines[k].match(/^\s*/)[0] + `${key}:: ${value}`;
  else {
    let at = 1;
    while (at < lines.length && isProp(lines[at])) at++;
    lines.splice(at, 0, `${key}:: ${value}`);
  }
  return lines.join('\n');
}
/** A note's heading as Logseq's menu sets it (set-heading!): n 1–6 → that many "#"s at its start
 *  (after a to-do word, as the / menu writes them) and no heading::; 'auto' → heading:: true and no
 *  "#"s; 0 → neither. */
export function withHeading(text, n) {
  // only the first line's own spaces are touched: a note that's just "TODO" (or "##") with property
  // or SCHEDULED lines under it keeps them on their lines
  const word = text.match(MARKERS)?.[0] ?? '';
  let rest = text.slice(word.length);
  const gap = rest.match(/^[ \t]*/)[0];
  if (word) rest = rest.slice(gap.length);
  rest = rest.replace(/^#{1,6}(?:[ \t]+|(?=\n|$))/, '');
  const words = rest !== '' && !rest.startsWith('\n'); // (any words on the first line)
  const hashes = n > 0 ? '#'.repeat(n) + (words ? ' ' : '') : '';
  const sep = word && (hashes || words) ? gap || ' ' : '';
  return withProp(word + sep + hashes + rest, 'heading', n === 'auto' ? 'true' : null);
}
/** Logseq's mark for item `n` of a number list `deep` number lists down: 1. a. I. (then again). */
function listMark(n, deep) {
  if (deep % 3 === 0) return n + '.';
  if (deep % 3 === 1) {
    let s = '';
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return s + '.';
  }
  const R = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of R) while (n >= v) { s += r; n -= v; }
  return s + '.';
}

export class Outline {
  /** host: element to render into. view: PageView from the backend. app: shared app services.
   *  opts.zoomLine: show only the block starting at this file line (and its children).
   *  opts.preview: an earlier version shown read-only (History, history.js): nothing in it opens,
   *  follows a link, folds or gets selected (a picture still opens big); it's never saved. */
  constructor(host, view, app, opts = {}) {
    this.app = app;
    this.host = host;
    this.preview = !!opts.preview;
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
    this.behind = false; // (as the file is now: see App.catchUp)
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
  isCollapsed(i) { return i !== this.root && foldedIn(this.blocks[i].text) && this.hasKids(i); }
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
      at += fileLines(this.blocks[i]);
    }
    return this.blocks.length - 1;
  }
  lineOf(i) {
    let at = nl(this.doc.preamble);
    for (let k = 0; k < i; k++) at += fileLines(this.blocks[k]);
    return at;
  }

  // ---------- rendering ----------
  render() {
    clearTimeout(this.chunkT);
    this.press?.end(false); // (a dot being pressed or a note dragged: its rows are about to go)
    this.drawn = this.start;
    this.hidden = this.hiddenSet();
    this.nums = this.listMarks();
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
  /** Numbered notes (logseq.order-list-type:: number) → {n, mark}, worked out as Logseq does: n counts
   *  the numbered notes just before it at its level (a plain note between starts again at 1); a
   *  number list inside number lists counts a. b. c., one more down I. II. III., then 1. 2. 3. again. */
  listMarks() {
    const out = new Map();
    const run = [], deep = []; // per level: numbered notes in a row so far; number lists down to here
    for (let i = 0; i < this.blocks.length; i++) {
      const d = this.blocks[i].depth;
      run.length = deep.length = d + 1; // (a note at a shallower level ends the runs below it)
      if (!NUMBERED.test(this.blocks[i].text)) { run[d] = 0; deep[d] = 0; continue; }
      run[d] = (run[d] || 0) + 1;
      deep[d] = (deep[d - 1] || 0) + 1;
      out.set(i, { n: run[d], mark: listMark(run[d], deep[d] - 1) });
    }
    return out;
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
    if (TOUCH) bul.addEventListener('touchmove', this.dotTouchMove, { passive: false }); // (bindEvents)
    const num = this.nums?.get(i);
    if (num) { bul.classList.add('num'); bul.dataset.n = num.mark; } // a number list: 1. 2. 3. instead of the dot
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
    const r = renderBlock(b.text, b.depth);
    // Logseq's background colour: a pale tint of it (app.css, tokens in skins.css); an older note's own
    // colour (Logseq once wrote "#978626"…) as it is, with white words, as Logseq shows it
    const bg = r.bg.toLowerCase();
    if (COLORS.includes(bg)) bc.dataset.bg = bg;
    else if (/^#[0-9a-f]{3,8}$/.test(bg)) { bc.dataset.bg = 'own'; bc.style.setProperty('--hl-own', bg); }
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
    if (html.includes(' data-ref="')) this.app.blockRefs?.(bc); // ((block references)): the words of the note they name
    // pictures get a corner handle to resize them (dragPicture), unless the note can't be edited
    if (!this.readonly && html.includes('class="pic"')) {
      for (const p of bc.querySelectorAll('.pic')) p.insertAdjacentHTML('beforeend', '<span class="pic-h" title="Drag to change the size (double-click: the usual size)"></span>');
    }
    if (!b.text.trim()) bc.dataset.ph = i === this.start && this.end - this.start === 1 && !this.readonly ? 'Click to write…' : '';
    const doneCls = r.marker === 'DONE' || (r.marker || '').startsWith('CANCEL');
    const { hf, lead } = lineLook(r); // a heading's taller line, a box or quote first (app.css)
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
    if (this.readonly || e.button > 0) return;
    e.preventDefault();
    // a picture that didn't load has no size to change; held by its handle all the same, so the
    // click that ends a drag lands there (nothing) even if it ends over the note's words (editing)
    if (!img?.naturalWidth) { hd.setPointerCapture(e.pointerId); return; }
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
      if (this.preview) { e.preventDefault(); if (e.target.tagName === 'IMG') this.app.showImage(e.target.src); return; }
      if (Date.now() - (this.swipedAt || 0) < 400) return; // the end of a swipe (phones)
      const t = e.target;
      const blk = t.closest('.blk');
      if (!blk) return;
      const i = +blk.dataset.i;
      const thread = this.threadAt(e, blk);
      if (thread !== null) { e.preventDefault(); this.toggleBranch(thread); return; }
      const ref = t.closest('.bref[data-page]'); // a block reference: to the note it names
      if (ref) { e.preventDefault(); this.flush(); this.app.go('zoom', ref.dataset.page, { line: +ref.dataset.line }); return; }
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
      if (t.classList.contains('bul')) { // (a drag or a hold that ends on it set swipedAt: no click then)
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
      const blk = !this.drag && e.target.closest('.blk');
      this.showThread(blk ? this.threadAt(e, blk) : null);
    });
    this.el.addEventListener('mouseleave', () => this.showThread(null));
    // a picture's corner handle: drag it to resize the picture, double-click it for the usual size
    this.el.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('pic-h')) this.dragPicture(e); });
    this.el.addEventListener('dblclick', (e) => { if (e.target.classList.contains('pic-h')) this.sizePicture(e.target, 0, 0); });
    // a note's dot: drag it to move the note (phones: hold it first; holding without moving opens the
    // note menu), right-click it for the menu (pressDot, openMenu)
    this.el.addEventListener('pointerdown', (e) => { const bul = e.target.closest('.bul'); if (bul && !this.preview) this.pressDot(e, bul); });
    this.el.addEventListener('contextmenu', (e) => {
      const blk = e.target.closest('.blk');
      if (!blk || this.preview) return; // (an earlier version, shown read-only in History)
      const touch = this.press?.touch || e.pointerType === 'touch'; // (a hold on a phone: pressDot takes it)
      if (e.target.closest('.bul')) {
        e.preventDefault();
        document.activeElement?.closest?.('.bul')?.blur(); // (a right press focused the dot: Space would then open it)
        if (!touch) this.openMenu(+blk.dataset.i, { at: { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY } });
      } else if (!touch && blk.classList.contains('sel') && !e.target.closest('.ed')) { // in the selected notes: their menu
        e.preventDefault();
        this.openMenu(+blk.dataset.i, { at: { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY } });
      }
    });
    // while a note is lifted on a phone, the page doesn't scroll under the finger, and the swipe that
    // opens the menu (app.js) doesn't see it. Each dot has this (blockEl), not the whole outline: a
    // listener that can stop scrolling makes the phone wait for it before scrolling where it is.
    this.dotTouchMove = (e) => {
      if (!this.press?.touch || !this.press.lifted) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };
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
      sw = { blk, i: +blk.dataset.i, x: t.clientX, y: t.clientY, dx: 0, dy: 0, on: false, sy: scrollY + (this.el.closest('.pane')?.scrollTop ?? 0) }; // (its side's notes)
    }, { passive: true });
    this.el.addEventListener('touchmove', (e) => {
      if (!sw) return;
      const t = e.touches[0];
      const dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // scrolling
        if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        sw.on = true;
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
      const scrolled = Math.abs(scrollY + (this.el.closest('.pane')?.scrollTop ?? 0) - sy) > 4;
      if (!cancel && !scrolled && Math.abs(dx) >= SWIPE && Math.abs(dx) > 2 * Math.abs(dy) && this.shiftLevel(i, dx > 0 ? 1 : -1)) {
        navigator.vibrate?.(10);
        this.undoToast(dx > 0 ? 'Moved in a level.' : 'Moved out a level.');
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
    this.joinList(a, z);
    this.render();
    this.markDirty();
    return true;
  }

  /** A message with Undo for a change made without the keyboard (on a phone there's no Undo button
   *  unless a note is being edited); only that change is undone. */
  undoToast(msg) {
    const step = this.undoStack.at(-1);
    this.app.toast(msg, 4000, { label: 'Undo', run: () => {
      if (this.undoStack.at(-1) === step) { this.undo(); this.app.unstep?.(this); } // (and out of the app's list of steps)
      else this.app.toast('Something else was changed since, so this can’t be undone from here.', 3000);
    } });
  }

  // ---------- moving notes by their dot ----------
  /** A press on a note's dot (pointerdown). Mouse: dragging moves the note with its children (or the
   *  selected notes, when it's one of them); a click still opens it on its own (the click handler).
   *  Touch: holding it HOLD ms lifts it (a short vibration); moving the finger then drags it, and
   *  lifting the finger without moving opens the note menu (while other notes are selected, it joins
   *  them instead, as before). A quick tap still opens it on its own; a quick swipe still scrolls. */
  pressDot(e, bul) {
    const blk = bul.closest('.blk');
    const touch = e.pointerType !== 'mouse';
    // (Alt is for dropping a block reference instead: dragEnd)
    if (!blk || this.press || this.locked || (touch ? !e.isPrimary : e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey)) return;
    if (!touch) e.preventDefault(); // (no text selected while dragging; the editing box keeps the keyboard)
    const p = { i: +blk.dataset.i, blk, id: e.pointerId, touch, x0: e.clientX, y0: e.clientY, lifted: !touch };
    this.press = p;
    if (touch) p.t = setTimeout(() => { p.lifted = true; blk.classList.add('lifted'); navigator.vibrate?.(15); }, HOLD);
    const move = (ev) => {
      if (ev.pointerId !== p.id || p.refused) return;
      const dist = Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0);
      if (!p.lifted) { if (dist > 10) end(false); return; } // (scrolling: the browser has it)
      if (!this.drag) { if (dist > (touch ? 8 : 5)) this.dragStart(p, ev); return; }
      this.drag.alt = !touch && ev.altKey;
      this.dragMove(ev.clientX, ev.clientY);
    };
    const up = (ev) => {
      if (ev.pointerId !== p.id) return;
      if (this.drag && !touch) this.drag.alt = ev.altKey; // (Alt held as it's let go: a block reference)
      end(true);
    };
    const cancel = (ev) => { if (ev.pointerId === p.id) end(false); };
    const end = (ok) => {
      clearTimeout(p.t);
      for (const [n, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['lostpointercapture', cancel]]) bul.removeEventListener(n, f);
      blk.classList.remove('lifted');
      if (this.press === p) this.press = null;
      if (p.lifted && (touch || this.drag)) this.swipedAt = Date.now(); // (no click after a hold or a drag)
      if (this.drag) { this.dragEnd(ok); return; }
      if (!ok || !touch || !p.lifted || p.refused) return; // a click (opens it on its own) or a scroll
      if (this.sel && !this.inSel(p.i)) { this.extendTo(p.i); navigator.vibrate?.(10); return; }
      this.openMenu(p.i, { touch: true });
    };
    p.end = end;
    if (!touch) bul.setPointerCapture?.(e.pointerId); // (a finger's is implicit)
    for (const [n, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['lostpointercapture', cancel]]) bul.addEventListener(n, f);
  }

  /** The press p turned into a drag: the note (with its children, or the selected notes) lifts out:
   *  a copy follows the pointer, its rows fade, and a line shows where it would go (dropAt): in these
   *  notes, another outline on screen (another day in the Journals list, the other side) or a page in
   *  the sidebar (dropTarget). Alt held: a block reference goes there instead (Logseq's way). */
  dragStart(p, ev) {
    const i = p.i;
    let r = null;
    if (!this.readonly && i !== this.root && i >= this.start && i < this.end) {
      if (this.sel && this.inSel(i)) r = this.opRange(i); // (null, with the reason, for notes at different levels)
      else { this.clearSel(); r = [i, this.subtreeEnd(i)]; }
    }
    if (!r) { p.refused = true; return; }
    this.stopEdit();
    this.ensureDrawn(this.end - 1);
    this.showThread(null);
    const [a, z] = r;
    const vis = []; // the rows on screen, but for the moved ones
    for (let j = this.start; j < this.end; j++) if (!this.hidden.has(j) && (j < a || j >= z)) vis.push(j);
    let own = vis.findIndex((j) => j >= z); // their own place: the gap between the rows around them
    if (own < 0) own = vis.length;
    for (let j = a; j < z; j++) this.divs[j]?.classList.add('dragging');
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.innerHTML = `<span class="dg-dot"></span><span class="dg-t">${this.pinText(a) || '…'}</span>${z - a > 1 ? `<span class="dg-n">+${z - a - 1}</span>` : ''}<span class="dg-to"></span>`;
    document.body.append(ghost);
    const line = document.createElement('div');
    line.className = 'drop-line';
    line.hidden = true;
    this.el.append(line);
    this.el.classList.add('drag-on');
    // Esc puts it back; Alt pressed or let go while the pointer rests: a reference or a move again
    const esc = (k) => {
      if (k.key === 'Escape' && k.type === 'keydown') { k.preventDefault(); k.stopPropagation(); this.press?.end(false); return; }
      if (k.key !== 'Alt' || !this.drag || p.touch) return;
      k.preventDefault();
      this.drag.alt = k.type === 'keydown';
      this.dragMove(this.drag.px, this.drag.py);
    };
    document.addEventListener('keydown', esc, true);
    document.addEventListener('keyup', esc, true);
    this.drag = {
      from: this, a, z, depth: this.blocks[a].depth, vis, own, ghost, line, esc, touch: p.touch, blocks: this.blocks, changes: this.changes,
      ind: parseFloat(getComputedStyle(this.el).getPropertyValue('--ind')) || 24, x0: p.x0,
      gy: p.touch ? -ghost.offsetHeight - 26 : -ghost.offsetHeight / 2, // (a phone: the copy above the finger, in sight)
      px: ev.clientX, py: ev.clientY, hit: null, alt: !p.touch && ev.altKey, vis2: new Map(),
    };
    // near the top or bottom edge the notes scroll by themselves (and the line follows the notes): the
    // side the pointer is over (two sides: the other one too)
    const tick = () => {
      const D = this.drag;
      if (!D) return;
      const s = this.dragScroller(this.app.tabs?.panes.map((q) => q.el).find((el) => { const b = el.getBoundingClientRect(); return b.width && D.px >= b.left && D.px <= b.right; }));
      const edge = 56;
      const v = D.py < s.top + edge ? -(s.top + edge - D.py) / 3 : D.py > s.bottom - edge ? (D.py - s.bottom + edge) / 3 : 0;
      if (v) s.by(Math.max(-20, Math.min(20, v)));
      this.dragMove(D.px, D.py);
      D.raf = requestAnimationFrame(tick);
    };
    this.drag.raf = requestAnimationFrame(tick);
    this.dragMove(ev.clientX, ev.clientY);
  }

  /** What scrolls these notes (or the side pane, another one), and its edges on screen: the side in a
   *  wide window, else the page (between the top bar and the editing toolbar, when it shows). */
  dragScroller(pane = this.el.closest('.pane')) {
    if (pane && getComputedStyle(pane).overflowY !== 'visible') {
      const r = pane.getBoundingClientRect();
      const z = zoomOf(pane, r);
      return { top: r.top, bottom: r.bottom, by: (dy) => { pane.scrollTop += dy / z; } };
    }
    const bar = document.querySelector('#topbar'), tb = document.querySelector('#toolbar:not([hidden])');
    return { top: bar?.offsetParent ? bar.getBoundingClientRect().bottom : 0, bottom: tb ? tb.getBoundingClientRect().top : innerHeight, by: (dy) => window.scrollBy(0, dy) };
  }

  /** The pointer is at x, y while dragging: the copy follows it (saying where to, when that's another
   *  page, and when it'll be a reference), and the line moves to where the notes would go, in whichever
   *  outline that is; a page in the sidebar lights up instead. None: they'd go nowhere. */
  dragMove(x, y) {
    const D = this.drag;
    if (!D) return;
    D.px = x; D.py = y;
    // (right of the pointer, so the line's start, where its level shows, stays in sight)
    D.ghost.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + D.gy)}px)`;
    const hit = D.hit = this.dropTarget(x, y);
    const link = hit?.link ?? null;
    if (D.lit !== link) { D.lit?.classList.remove('drop-to'); link?.classList.add('drop-to'); D.lit = link; }
    const to = !hit ? '' : hit.link ? hit.page : hit.o !== this ? hit.o.name : '';
    const say = (D.alt ? '↗ reference' : '') + (to ? `${D.alt ? ' in' : '→'} ${to}` : '');
    if (say !== D.say) { D.say = say; D.ghost.querySelector('.dg-to').textContent = say; }
    if (D.alt !== D.altShown) { D.altShown = D.alt; D.ghost.classList.toggle('ref', D.alt); this.el.classList.toggle('drag-ref', D.alt); }
    const t = hit?.t, o = hit?.o;
    if (!t || (t.own && (t.d === D.depth || D.alt))) { D.line.hidden = true; return; } // (nowhere, or where it was)
    if (D.line.parentElement !== o.el) o.el.append(D.line);
    const host = o.el.getBoundingClientRect();
    const z = zoomOf(o.el, host);
    const row = (j) => o.divs[j].getBoundingClientRect();
    const y0 = t.own ? row(D.a).top : t.B !== null ? row(t.B).top : row(t.A).bottom;
    D.line.hidden = false;
    D.line.style.top = `${(y0 - host.top) / z}px`;
    D.line.style.left = `${(t.d - o.baseDepth) * t.ind + 9.5}px`; // (from the dot's column at that level)
  }

  /** Where the dragged notes would go with the pointer at x, y: {o, t} (an outline, and dropAt's place
   *  in it): these notes first; else the outline whose sheet is under the pointer (another day in the
   *  Journals list, the page on the other side); or {page, link}: a page in the sidebar's Favourites or
   *  Recent (the notes go to its end). null: nowhere. */
  dropTarget(x, y) {
    const D = this.drag;
    const t = this.dropAt(x, y, D);
    if (t) return { o: this, t };
    const el = document.elementFromPoint(x, y);
    const link = el?.closest?.('#favs .side-list a[data-page], #recent a[data-page]');
    if (link) return { page: link.dataset.page, link };
    const sheet = el?.closest?.('.sheet');
    const o = sheet && this.app.outlines.find((x) => x !== this && sheet.contains(x.el));
    if (!o || o.readonly || o.conflict || o.preview || o.locked || !o.el.offsetParent) return null;
    const u = o.dropAt(x, y, D);
    return u ? { o, t: u } : null;
  }

  /** The rows of this outline that notes dragged from another one (D.from) could go between: every
   *  row shown; when it shows the same page as they come from (the other side), that page without
   *  them, as they'd be. Worked out once per drag (again if it's drawn again meanwhile). no: not here
   *  (zoomed in on one of them). */
  dropRows(D) {
    let v = D.vis2.get(this);
    if (v && v.divs === this.divs && v.blocks === this.blocks) return v;
    const S = D.from;
    const page = this.path === S.path && this.name.toLowerCase() === S.name.toLowerCase();
    const same = page && docKey(this.doc) === (D.key ??= docKey(S.doc));
    // no: zoomed in on one of them; or the same page with other words (one side's typing not saved
    // yet): its rows wouldn't be the dragged notes' page's rows
    v = { rows: [], own: -1, same, no: page && (!same || (this.root !== null && this.root >= D.a && this.root < D.z)), blocks: this.blocks,
      ind: parseFloat(getComputedStyle(this.el).getPropertyValue('--ind')) || D.ind };
    if (!v.no) {
      this.ensureDrawn(this.end - 1);
      for (let j = this.start; j < this.end; j++) if (!this.hidden.has(j) && (!same || j < D.a || j >= D.z)) v.rows.push(j);
      if (same && D.a >= this.start && D.z <= this.end) { v.own = v.rows.findIndex((j) => j >= D.z); if (v.own < 0) v.own = v.rows.length; }
    }
    v.divs = this.divs;
    D.vis2.set(this, v);
    return v;
  }

  /** Where dragged notes (D) would go with the pointer at x, y in this outline: {k, A, B, d, own, end, ind, blocks}
   *  = the gap before visible row k (between rows A and B, either null at an end) and the level d; end:
   *  where "after the last" is (the page's end, or the zoomed-in note's). As in Logseq, how far right
   *  decides: as a child of the note above (at most one level deeper than it, and not into a folded
   *  note), else at the level of the notes around it. In their own place, any level out to the left
   *  (outdenting the Logseq way: Shift+Tab). Another outline (D.from isn't this one): anywhere on its
   *  sheet (a day, the page), the level from its own left edge. null: outside these notes. */
  dropAt(x, y, D = this.drag) {
    const self = D.from === this;
    const v = self ? null : this.dropRows(D);
    if (v?.no) return null;
    const vis = self ? D.vis : v.rows, n = vis.length;
    const host = this.el.getBoundingClientRect();
    const zz = zoomOf(this.el, host);
    const side = (this.el.closest('.pane') ?? this.el).getBoundingClientRect(); // (two sides: only over its own)
    if (x < side.left || x > side.right) return null;
    if (y < host.top - 24 * zz || y > host.bottom + 32 * zz) {
      const sheet = !self && this.el.closest('.sheet')?.getBoundingClientRect();
      if (!sheet || y < sheet.top || y > sheet.bottom) return null;
    }
    let lo = 0, hi = n; // the first visible row whose middle is below y
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      const r = this.divs[vis[m]]?.getBoundingClientRect();
      if (!r) return null; // (drawn again meanwhile: the next move sees it)
      if (r.top + r.height / 2 < y) lo = m + 1; else hi = m;
    }
    const k = this.root !== null && lo === 0 ? 1 : lo; // (never above a zoomed-in note)
    const A = k > 0 ? vis[k - 1] : null, B = k < n ? vis[k] : null;
    const own = k === (self ? D.own : v.own);
    const floor = this.root === null ? 0 : this.blocks[this.root].depth + 1;
    const max = A === null ? floor : this.blocks[A].depth + (this.isCollapsed(A) ? 0 : 1);
    const min = own || B === null ? floor : this.blocks[B].depth;
    // the level its dot is over: one step per indent, a little past halfway (from where the drag
    // started; in another outline, from that outline's left edge)
    const ind = self ? D.ind : v.ind;
    let d;
    if (self) { const dx = (x - D.x0) / (ind * zz); d = D.depth + Math.sign(dx) * Math.floor(Math.abs(dx) + 0.35); }
    else d = this.baseDepth + Math.floor(((x - host.left) / zz - 9.5) / ind + 0.35);
    const end = this.root === null ? this.blocks.length : this.subtreeEnd(this.root);
    return { k, A, B, own, d: Math.max(min, Math.min(Math.max(min, max), d)), end, ind, blocks: this.blocks };
  }

  /** End of a drag: drop the notes where the line is (ok), or put everything back. In these notes:
   *  moved here (dropNotes) or, Alt held, a reference to them (dropRefs); anywhere else move.js does it
   *  (another page: added there first and saved, then taken out here). */
  dragEnd(ok) {
    const D = this.drag;
    if (!D) return;
    this.drag = null;
    cancelAnimationFrame(D.raf);
    document.removeEventListener('keydown', D.esc, true);
    document.removeEventListener('keyup', D.esc, true);
    D.ghost.remove();
    D.line.remove();
    D.lit?.classList.remove('drop-to');
    this.el.classList.remove('drag-on', 'drag-ref');
    for (let j = D.a; j < D.z; j++) this.divs[j]?.classList.remove('dragging');
    const hit = ok ? D.hit : null;
    if (!hit || D.blocks !== this.blocks || (hit.t && hit.t.blocks !== hit.o.blocks)) return; // (not if a page was read again meanwhile)
    if (hit.o === this) { if (D.alt) this.dropRefs(D, hit.t); else this.dropNotes(D, hit.t); return; }
    import('./move.js').then((m) => m.dropElsewhere(this, D, hit)).catch((e) => this.app.toast(`Nothing was moved: ${e?.message ?? e}`, 6000));
  }

  /** Put dragged notes where they were dropped (t: dropAt's place, in these notes or in the same page
   *  on the other side): one Undo step. In their own place a level change is Tab or Shift+Tab (as many
   *  times; outdenting the Logseq way, so the notes after it at its old level become its children);
   *  elsewhere they go between the notes around the line. */
  dropNotes(D, t) {
    const { a, z, depth: d0 } = D;
    const len = z - a;
    if (t.own && t.d === d0) return; // dropped where it was
    const span = this.sel ? Math.abs(this.sel.b - this.sel.a) : 0;
    this.snap();
    let at = a;
    if (t.own && t.d > d0) for (let j = a; j < z; j++) this.blocks[j].depth += t.d - d0;
    else if (t.own) {
      let last = a; // (the last of the moved notes at their level)
      for (let j = a; j < z; j++) if (this.blocks[j].depth === d0) last = j;
      for (let s = d0; s > t.d; s--) { const e = this.subtreeEnd(last); for (let j = a; j < e; j++) this.blocks[j].depth--; }
    } else {
      const chunk = this.blocks.splice(a, len);
      for (const b of chunk) b.depth += t.d - d0;
      at = t.B ?? t.end; // (as the page was with them)
      if (at > a) at -= len;
      this.blocks.splice(at, 0, ...chunk);
    }
    this.joinList(at, at + len);
    if (this.sel) this.sel = { a: at, b: at + span };
    this.render();
    this.markDirty();
    if (this.app.active?.cur == null) this.app.active = this; // Ctrl+Z (app.js) undoes it, on any journal day too
    if (D.touch) this.undoToast('Moved.');
  }

  /** Alt held as the dragged notes were dropped in this page (t: dropAt's place): a reference to each
   *  of them, ((id)), goes there, as in Logseq; a note without an id:: gets one (withProp). The notes
   *  themselves stay. One Undo step. */
  dropRefs(D, t) {
    if (t.own) return;
    // (the same rules as (( : an id Logseq can read, given only to a note written as a Logseq bullet)
    for (let j = D.a; j < D.z; j++) {
      const why = this.blocks[j].depth === D.depth && referWhy(this.blocks[j]);
      if (why) { this.app.toast(`The reference wasn’t added: ${why}`, 6000); return; }
    }
    const ids = [];
    this.snap();
    for (let j = D.a; j < D.z; j++) {
      if (this.blocks[j].depth !== D.depth) continue;
      let id = idIn(this.blocks[j].text);
      if (!id) { id = newId(); this.blocks[j].text = withProp(this.blocks[j].text, 'id', id); }
      ids.push(id);
    }
    const at = t.B ?? t.end;
    this.blocks.splice(at, 0, ...ids.map((id) => ({ depth: t.d, text: `((${id}))`, raw: null })));
    this.joinList(at, at + ids.length);
    this.clearSel();
    this.render();
    this.markDirty();
    if (this.app.active?.cur == null) this.app.active = this;
    if (D.touch) this.undoToast(ids.length > 1 ? 'References added.' : 'Reference added.');
  }

  /** Notes moved or added at [a, z) (the first at their level) join a number list they land in, as in
   *  Logseq: when the note just above them at that level is numbered (or, with none above, the one
   *  just below). Notes with a list type of their own keep it. */
  joinList(a, z) {
    if (a >= z || a >= this.blocks.length) return;
    const d = this.blocks[a].depth;
    let t = -1;
    for (let j = a - 1; j >= 0 && this.blocks[j].depth >= d; j--) if (this.blocks[j].depth === d) { t = j; break; }
    if (t < 0 && z < this.blocks.length && this.blocks[z].depth === d) t = z;
    if (t < 0 || !NUMBERED.test(this.blocks[t].text)) return;
    for (let j = a; j < z; j++) {
      const b = this.blocks[j];
      if (b.depth === d && !listed(b.text)) b.text = withProp(b.text, LIST, 'number');
    }
  }

  // ---------- the note menu (Logseq's block menu) ----------
  /** The menu for note i with its children, or for the selected notes when i is one of them: colour,
   *  heading, Select, Cut, Delete, Copy, Copy as text, Numbered list, Next to-do state, Expand all,
   *  Collapse all. opts.at: where (default: by the note's dot); opts.kb: from the keyboard or the
   *  phone toolbar while editing (the editing box stays open and gets the keyboard back);
   *  opts.touch: from a finger (the menu doesn't take the keyboard focus). */
  openMenu(i, opts = {}) {
    if (i < this.start || i >= this.end || this.menuOpen) return;
    const inSel = !!this.sel && this.inSel(i);
    if (this.sel && !inSel) this.clearSel();
    if (!opts.kb) this.stopEdit();
    this.ensureDrawn(i);
    const [lo, hi] = inSel ? this.selRange() : [i, this.subtreeEnd(i)];
    const top = Math.min(...this.blocks.slice(lo, hi).map((b) => b.depth));
    const tops = []; // the notes it acts on (colour, heading, list, to-do): not their children
    for (let j = lo; j < hi; j++) if (this.blocks[j].depth === top) tops.push(j);
    const marked = [];
    if (!inSel) for (let j = lo; j < hi; j++) { const div = this.blockDiv(j); if (div && !div.hidden) { div.classList.add('menu-on'); marked.push(div); } }
    const t0 = this.textOf(tops[0]);
    const rw = !this.readonly;
    const now = t0.match(MARKERS)?.[1] ?? null;
    const items = [];
    if (rw && !inSel) items.push({ id: 'select', label: 'Select', hint: opts.touch ? 'then hold more dots to add them' : '' });
    if (rw && !(this.root !== null && lo <= this.root)) items.push({ id: 'cut', label: 'Cut' }, { id: 'delete', label: 'Delete', danger: true });
    items.push({ id: 'copy', label: 'Copy' }, { id: 'copytext', label: 'Copy as text', hint: 'plain Markdown' });
    // a leanoutliner://note/<id> link that opens the app right at this note (it gets an id:: if needed)
    if (!inSel && (rw || idIn(t0))) items.push({ id: 'link', label: 'Copy link to this note' });
    if (rw) {
      items.push('-', { id: 'number', label: 'Numbered list', checked: tops.some((j) => NUMBERED.test(this.textOf(j))) });
      items.push({ id: 'todo', label: 'Next to-do state', hint: `${now || 'none'} → ${this.nextMarker(now) || 'none'}` });
      let kids = false;
      for (let j = lo; j < hi && !kids; j++) kids = this.hasKids(j);
      if (kids) items.push('-', { id: 'expand', label: 'Expand all' }, { id: 'collapse', label: 'Collapse all' });
    }
    const head = t0.split('\n')[0].replace(MARKERS, '').trimStart().match(/^(#{1,6})\s/);
    const blocks = this.blocks, changes = this.changes; // (if the page changes while it's open, nothing is done)
    const at = opts.at ?? this.blockDiv(i)?.querySelector(':scope > .bul')?.getBoundingClientRect() ?? this.el.getBoundingClientRect();
    this.menuOpen = true;
    noteMenu(at, {
      colors: rw ? COLORS : null,
      color: (t0.split('\n').slice(1).find((l) => /^(background[-_]color)$/.test(propKey(l) || ''))?.match(PROP)?.[2] ?? '').trim().toLowerCase(),
      heading: !rw ? null : head ? head[1].length : /\n[ \t]*heading::[ \t]*true[ \t]*(?=\n|$)/i.test(t0) ? 'auto' : 0,
      items,
      focus: !opts.touch,
      touch: !!opts.touch,
      closed: (picked) => {
        this.menuOpen = false;
        for (const div of marked) div.classList.remove('menu-on');
        if (opts.kb && !picked && this.ta) this.ta.focus({ preventScroll: true });
      },
      pick: (kind, v) => {
        if (!this.el.isConnected || this.doc.blocks !== blocks || this.changes !== changes) { this.app.toast('This page changed meanwhile, so nothing was done. Please try again.', 4000); return; }
        this.menuPick(kind, v, { i, lo, hi, tops, inSel });
        if (opts.kb && this.cur !== null && this.ta && document.activeElement !== this.ta) this.ta.focus({ preventScroll: true });
      },
    });
  }

  /** What a choice in the note menu does (openMenu). */
  menuPick(kind, v, { i, lo, hi, tops, inSel }) {
    if (kind === 'color') { this.changeTexts(tops, (t) => withProp(t, 'background-color', v || null)); return; }
    if (kind === 'heading') { this.changeTexts(tops, (t) => withHeading(t, v)); return; }
    const n = hi - lo;
    const what = n === 1 ? 'the note' : `${n} notes`;
    switch (v) {
      case 'select': this.select(i); return;
      case 'copy': this.copyText(this.blocksText(lo, hi)); return;
      case 'copytext': this.copyText(this.blocksText(lo, hi, true), 'Copied as text'); return;
      case 'link': this.copyNoteLink(i); return;
      case 'cut': this.cutNotes(lo, hi).then((cut) => { if (cut) this.undoToast(`Cut ${what}.`); }); return;
      case 'delete': if (this.removeNotes(lo, hi)) this.undoToast(`Deleted ${what}.`); return;
      case 'number': {
        const on = tops.some((j) => NUMBERED.test(this.textOf(j))); // (one numbered: all go back to dots, as in Logseq)
        this.changeTexts(tops, (t) => withProp(t, LIST, on ? null : 'number'), true);
        return;
      }
      case 'todo': if (inSel) this.cycleTodoSel(); else this.cycleTodo(i); return;
      case 'expand': case 'collapse': {
        const fold = v === 'collapse';
        const js = [];
        for (let j = lo; j < hi; j++) if (j !== this.root && (!fold || this.hasKids(j))) js.push(j);
        this.stopEdit();
        this.changeTexts(js, fold ? (t) => (foldedIn(t) ? t : folded(t)) : unfolded, true);
        return;
      }
      default:
    }
  }

  /** "Copy link to this note": leanoutliner://note/<its id::>; a note without one gets one the Logseq
   *  way first (withProp, as a block reference does; one Undo step, saved as any change). */
  copyNoteLink(i) {
    let id = idIn(this.textOf(i));
    // (as for a block reference: an id Logseq can read, added only to a note written as a Logseq bullet;
    // a link names a note only by such an id, link.rs)
    const why = referWhy({ ...this.blocks[i], text: this.textOf(i) });
    if (why) { this.app.toast(`No link was copied: ${why}`, 6000); return; }
    if (!id) {
      if (this.readonly || this.conflict) { this.app.toast('This note can’t get a link just now: its page can’t be changed.', 4000); return; }
      id = newId();
      this.changeTexts([i], (t) => withProp(t, 'id', id));
    }
    this.copyText(noteLinkUrl(id), 'Link to this note copied');
  }

  /** Change the words of notes js (fn(text) → text) as one Undo step; false (and no step) when none
   *  changes. redraw: the page is drawn again (numbers, folding), the note being edited staying open. */
  changeTexts(js, fn, redraw = false) {
    if (this.readonly) return false;
    const ch = js.map((j) => { const t = this.textOf(j); return [j, t, fn(t)]; }).filter(([, t, u]) => u !== t);
    if (!ch.length) return false;
    this.snap();
    for (const [j, , u] of ch) this.setText(j, () => u);
    if (redraw) { if (this.cur !== null && this.ta) this.reflow(this.cur, this.ta.selectionStart); else this.render(); }
    if (this.app.active?.cur == null) this.app.active = this;
    return true;
  }

  /** Take notes lo…hi-1 out of the page (one Undo step); false if they can't be (read-only, or the
   *  zoomed-in note itself). */
  removeNotes(lo, hi) {
    if (this.readonly || (this.root !== null && lo <= this.root)) return false;
    this.stopEdit();
    this.snap();
    this.blocks.splice(lo, hi - lo);
    if (!this.blocks.length) this.blocks.push({ depth: 0, text: '', raw: null });
    if (this.sel) { this.sel = null; this.app.selecting(this, false); }
    this.render();
    this.markDirty();
    if (this.app.active?.cur == null) this.app.active = this;
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
  /** Open note i for typing, the caret at caret (or its end). now: as it is (App.editAfterSave
   *  already waited for the other side). */
  edit(i, caret = 'end', now = false) {
    if (i < this.start || i >= this.end || this.locked) return; // (locked: notes being moved to or from here, move.js)
    if (this.readonly) {
      this.app.toast(this.error || 'This file isn’t plain UTF-8 text, so it can be read here but not edited.');
      return;
    }
    this.ensureDrawn(i);
    if (this.cur === i && this.ta) { this.ta.focus(); return; }
    this.stopEdit();
    // the same page on the other side has typing not saved yet: it comes over first, or it's saved
    // first and this note opens after this side read the page again (App.takeOver)
    const how = now ? null : this.app.takeOver?.(this, i, caret);
    if (how === 'wait') return;
    if (how) this.ensureDrawn(i);
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
    const main = this.el.closest('.pane'); // (its side's notes)
    if (main && getComputedStyle(main).overflowY !== 'visible') {
      let n = 0;
      for (let a = this.parentOf(i); a >= this.start; a = this.parentOf(a)) n++;
      main.style.scrollPaddingTop = n ? `${8 + n * PIN_H}px` : '';
    }
    ta.scrollIntoView({ block: 'nearest' });
    ta.addEventListener('beforeinput', (e) => this.beforeInput(e));
    // (a word being made with an input method is left alone by beforeInput)
    ta.addEventListener('compositionstart', () => { this.composing = true; });
    ta.addEventListener('compositionend', () => { this.composing = false; });
    ta.addEventListener('input', (e) => this.onInput(e));
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('paste', (e) => this.onPaste(e));
    ta.addEventListener('blur', () => setTimeout(() => {
      // (the link preview's box is always in the page, hidden: only a pop-up that's open keeps editing on)
      if (this.ta === ta && document.activeElement !== ta && document.hasFocus() && !document.querySelector('.pop:not([hidden]), .modal-back')) this.stopEdit();
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

  /** Typing, before it lands. As in Logseq (editor.cljs autopair; letters from an input method or
   *  AltGr come as typed text too, and a word still being composed is left alone):
   *  - words selected: "[" goes round them as [ ] (twice: a page link [[words]]), "(" "{" "`" as their
   *    pair, "*" "_" "~" "^" "=" as that mark, the words staying selected (so "*" twice: **bold**);
   *  - nothing selected: "[" "{" "`" (not where a line starts with backticks: ``` makes a code block)
   *    and "(" (after a space, the start, "]" or "(") come with their closing one, the caret between;
   *  - ")" "]" "}" "`" typed right before the same one steps over it ("``" mid-line stays two);
   *  - Backspace between an opening one and its closing one takes both. */
  beforeInput(e) {
    const ta = this.ta;
    const s = ta?.selectionStart, z = ta?.selectionEnd, v = ta?.value ?? '';
    const ch = e.inputType === 'insertText' && !e.isComposing && !this.composing ? e.data : null;
    if (ta && ch?.length === 1) {
      if (s !== z) {
        const close = PAIRS[ch] ?? (MARKS.has(ch) ? ch : null);
        if (close) { e.preventDefault(); this.wrap(ch, close); return; }
      } else {
        const prev = v[s - 1], next = v[s];
        if ((ch === ')' || ch === ']' || ch === '}' || ch === '`') && next === ch) {
          e.preventDefault();
          ta.setSelectionRange(s + 1, s + 1);
          this.app.ac.check(this);
          return;
        }
        const line = v.slice(v.lastIndexOf('\n', s - 1) + 1, s);
        // ("`" right after a "`" goes on a run of them: ``` stays three)
        const pair = ch === '(' ? s === 0 || /[\s\](]/.test(prev) : ch === '`' ? prev !== '`' && !/^\s*`*$/.test(line) : ch in PAIRS;
        if (pair) { this.typeAround(ch, PAIRS[ch]); e.preventDefault(); return; }
      }
    }
    if (ta && e.inputType === 'deleteContentBackward' && s === z && s > 0 && UNPAIR[v[s - 1]] !== undefined && UNPAIR[v[s - 1]] === v[s]) {
      e.preventDefault();
      this.beforeTyping();
      ta.setRangeText('', s - 1, s + 1, 'start');
      this.typed();
      this.app.ac.check(this);
      return;
    }
    this.beforeTyping();
  }

  /** Type open + close with the caret between them (part of the burst of typing for Undo). */
  typeAround(open, close) {
    const ta = this.ta;
    const s = ta.selectionStart;
    this.beforeTyping();
    ta.setRangeText(open + close, s, ta.selectionEnd, 'start');
    ta.setSelectionRange(s + open.length, s + open.length);
    this.typed();
    this.app.ac.check(this);
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

  /** The context-menu key or Shift+F10: the note menu from the keyboard (for the note being edited,
   *  or the selected notes); the browser's own menu that would follow is kept away. */
  menuKey(e, i) {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey))) return false;
    e.preventDefault();
    const own = (ev) => ev.preventDefault();
    document.addEventListener('contextmenu', own, true);
    setTimeout(() => document.removeEventListener('contextmenu', own, true), 800);
    this.openMenu(i, { kb: true });
    return true;
  }

  onKey(e) {
    const ta = this.ta;
    const i = this.cur;
    if (this.app.ac.handleKey(e)) return;
    if (e.isComposing) return;
    if (this.menuKey(e, i)) return;
    const c = ta.selectionStart, cEnd = ta.selectionEnd, v = ta.value;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && k === 'z') { e.preventDefault(); e.shiftKey ? this.app.redo(this) : this.app.undo(this); return; }
    if (mod && !e.altKey && k === 'y') { e.preventDefault(); this.app.redo(this); return; }
    // Ctrl+A: the note's words (the browser's own), then the note itself, then its parent… (onSelKey);
    // Ctrl+Shift+A: every note on the page (Logseq's select-parent and select-all-blocks)
    if (this.app.keyIs(e, 'editor/select-all-blocks')) { e.preventDefault(); this.selectAll(); return; }
    if (this.app.keyIs(e, 'editor/select-parent') && c === 0 && cEnd === v.length) { e.preventDefault(); this.select(i); return; }
    // Ctrl+Shift+V: the paste that follows goes in as plain words (onPaste)
    if (mod && e.shiftKey && !e.altKey && k === 'v') this.plainAt = Date.now();
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

  /** Pasting: pictures go into assets/ and are linked; a web address over selected words makes them
   *  a link to it; Ctrl+Shift+V puts the words in as they are; from a web page, Word or Google Docs
   *  (text/html with links, bold, lists…) Logseq Markdown, notes for its paragraphs and list items
   *  (paste.js, loaded the first time); plain words with two or more "- " lines become notes too. */
  async onPaste(e) {
    const plain = Date.now() - (this.plainAt || 0) < 1500; // (Ctrl+Shift+V)
    this.plainAt = 0;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length && !plain) { e.preventDefault(); for (const f of files) await this.addFile(f); return; }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const html = plain ? '' : e.clipboardData?.getData('text/html') ?? '';
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
    if (plain) {
      if (text && ta) { e.preventDefault(); this.insertAtCaret(text.replace(/\r\n?/g, '\n')); }
      return;
    }
    // formatted words: only when the copy carries something plain words would lose (links, bold,
    // lists, headings, code…); else as before (a copy from a code editor stays one note)
    if (ta && html && RICH.test(html) && !codeCopy(html)) {
      e.preventDefault();
      const { htmlToNotes } = await import('./paste.js');
      if (this.ta !== ta) { this.app.toast('The paste didn’t go in: the note was closed meanwhile. Paste again.', 4000); return; }
      const notes = htmlToNotes(html);
      if (!notes.length) { if (text) this.insertAtCaret(text.replace(/\r\n?/g, '\n')); return; }
      // one paragraph's words: into this note at the caret; else notes of their own (a numbered list's
      // as Logseq numbers them)
      if (notes.length === 1 && !notes[0].num && !/^(#{1,6} |> |```)/.test(notes[0].text)) this.insertAtCaret(notes[0].text);
      else this.pasteNotes(notes.map((n) => ({ depth: n.depth, text: n.num ? withProp(n.text, LIST, 'number') : n.text })));
      return;
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
    this.pasteNotes(parsed);
  }

  /** Notes pasted (parsed: [{depth, text}]) go in after this note and its children, the shallowest at
   *  its level (in place of it when it's empty), each at most one level under the one before; the
   *  caret at the end of the last. Into the zoomed-in note itself: as its last sub-notes (it stays,
   *  and they stay in view). One Undo step. */
  pasteNotes(parsed) {
    const i = this.cur;
    const min = Math.min(...parsed.map((p) => p.depth));
    this.snap();
    const inRoot = i === this.root;
    const base = this.blocks[i].depth + (inRoot ? 1 : 0);
    let prev = -1;
    const add = parsed.map((p) => {
      const d = Math.min(p.depth - min, prev + 1);
      prev = d;
      return { depth: base + d, text: p.text, raw: null };
    });
    let at;
    if (!inRoot && !this.textOf(i).trim()) { this.blocks.splice(i, 1); at = i; }
    else at = this.subtreeEnd(i); // after this block and its children
    this.blocks.splice(at, 0, ...add);
    this.reflow(at + add.length - 1, 'end');
  }

  // ---------- undo / redo ----------
  snapshot() {
    // (with the file's indent and line endings: putting an earlier version back may change them)
    return { blocks: this.blocks.map((b) => ({ ...b })), preamble: this.doc.preamble, indent: this.doc.indent, crlf: this.doc.crlf, cur: this.cur, caret: this.ta?.selectionStart ?? null };
  }
  snap(kind = 'op') {
    this.changes = (this.changes || 0) + 1; // (the note menu checks nothing changed while it was open)
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnap = { kind, at: Date.now(), cur: this.cur };
    this.app.stepped?.(this); // (Undo goes through the page's steps in order: App.undo)
  }
  restore(st) {
    this.doc.blocks = st.blocks.map((b) => ({ ...b }));
    this.doc.preamble = st.preamble;
    if (st.indent !== undefined) { this.doc.indent = st.indent; this.doc.crlf = st.crlf; }
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
  /** Undo the newest step. A step made in two pages at once (notes moved to another page: move.js)
   *  is undone in both, together (its link), never in one alone; plain: just this page's part (the
   *  link itself). true: handled elsewhere (the link, or a move still being saved). */
  undo(plain = false) {
    if (!plain && this.locked) return true;
    if (!this.undoStack.length) { this.app.toast('Nothing to undo', 1200); return; }
    const link = this.undoStack.at(-1).link;
    if (link && !plain) { link.go(true); return true; }
    const now = this.snapshot();
    if (link) now.link = link;
    this.redoStack.push(now);
    this.restore(this.undoStack.pop());
  }
  redo(plain = false) {
    if (!plain && this.locked) return true;
    if (!this.redoStack.length) { this.app.toast('Nothing to redo', 1200); return; }
    const link = this.redoStack.at(-1).link;
    if (link && !plain) { link.go(false); return true; }
    const now = this.snapshot();
    if (link) now.link = link;
    this.undoStack.push(now);
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
    if (this.menuKey(e, this.sel.b)) return true;
    if (e.key === 'Escape') { this.clearSel(); return true; }
    if (this.app.keyIs(e, 'editor/select-all-blocks')) { this.selectAll(); return true; }
    if (this.app.keyIs(e, 'editor/select-parent')) { this.selectParent(); return true; }
    if (mod && k === 'z') { e.shiftKey ? this.app.redo(this) : this.app.undo(this); return true; }
    if (mod && k === 'y') { this.app.redo(this); return true; }
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
    if (mod && k === 'c') { this.copySel(); return true; }
    if (mod && k === 'x') { const [a, b] = this.selRange(); this.cutNotes(a, b).then((cut) => { if (cut) this.afterRemove(a); }); return true; }
    return false;
  }
  /** Every note shown (Ctrl+Shift+A; zoomed in: that note with its sub-notes). */
  selectAll() {
    let b = this.end - 1;
    while (b > this.start && this.hidden?.has(b)) b--;
    this.stopEdit();
    this.sel = { a: this.start, b };
    this.paintSel();
    this.app.selecting(this, true);
  }
  /** Ctrl+A with notes selected: the parent of the first one, with all its sub-notes (Logseq's
   *  select-parent); at the top level, every note. */
  selectParent() {
    if (!this.sel) return;
    const p = this.parentOf(Math.min(this.sel.a, this.sel.b));
    if (p < this.start) { this.selectAll(); return; }
    this.sel = { a: p, b: p };
    this.paintSel();
  }
  selText() { return this.blocksText(...this.selRange()); }
  /** Notes lo…hi-1 as Markdown bullets (a tab per level), for the clipboard. plain: without Logseq's
   *  bookkeeping (hidden properties: ids, folding, colours, auto headings, number lists…), numbered
   *  notes as "1." */
  blocksText(lo, hi, plain = false) {
    const min = Math.min(...this.blocks.slice(lo, hi).map((b) => b.depth));
    const hiddenProp = (l) => { const k = propKey(l); return !!k && (HIDDEN_PROPS.has(k) || k.startsWith('card-') || k.startsWith('hl-')); };
    const out = [];
    for (let j = lo; j < hi; j++) {
      const b = this.blocks[j];
      const ind = '\t'.repeat(b.depth - min);
      const mark = plain && this.nums.get(j) ? this.nums.get(j).n + '. ' : '- ';
      const lines = b.text.split('\n').filter((l, k) => !plain || k === 0 || !hiddenProp(l));
      out.push(lines.map((l, k) => (k === 0 ? ind + mark + l : ind + ' '.repeat(mark.length) + l)).join('\n'));
    }
    return out.join('\n');
  }
  async copySel() { return this.copyText(this.selText()); }
  /** Put text on the clipboard; msg: the message after (null: none). true when it got there. */
  async copyText(text, msg = 'Copied') {
    let ok = true;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.append(t);
      t.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      t.remove();
    }
    if (!ok) this.app.toast('Couldn’t copy to the clipboard.', 3000);
    else if (msg) this.app.toast(msg, 1000);
    return ok;
  }
  /** Cut: copy, and only once that worked (and nothing changed meanwhile) take the notes out. */
  async cutNotes(lo, hi, what) {
    const c = this.changes, blocks = this.blocks;
    if (!(await this.copyText(this.blocksText(lo, hi), null))) { this.app.toast('Couldn’t copy to the clipboard, so nothing was cut.', 4000); return false; }
    if (this.changes !== c || this.blocks !== blocks || !this.el.isConnected) return false;
    return this.removeNotes(lo, hi);
  }
  deleteSel() {
    const [lo, hi] = this.selRange();
    if (this.removeNotes(lo, hi)) this.afterRemove(lo);
  }
  /** After notes from lo on were taken out: the note before them (or now in their place) is selected. */
  afterRemove(lo) {
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
    // Enter on an empty numbered note (not in a number list itself) ends the list: a dot again (Logseq)
    if (!shown.trim() && i !== this.root && NUMBERED.test(this.textOf(i)) && !NUMBERED.test(this.blocks[this.parentOf(i)]?.text ?? '')) {
      this.snap();
      b.text = withProp(this.textOf(i), LIST, null);
      this.reflow(i, 0);
      return;
    }
    // Enter on an empty child: step out (but not out of a zoomed-in block)
    if (!shown.trim() && b.depth > this.baseDepth + (this.root === null ? 0 : 1) && i !== this.root) { this.outdent(i); return; }
    this.snap();
    const before = shown.slice(0, c), after = shown.slice(cEnd);
    if (c === 0 && after.trim() && i !== this.root) { // at the start: open a line above
      this.blocks.splice(i, 0, { depth: b.depth, text: '', raw: null });
      this.joinList(i, i + 1); // (in a number list, the new note is numbered too, as in Logseq)
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
    this.joinList(at, at + 1);
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
    this.joinList(a, z);
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
    this.joinList(a, z);
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
      this.joinList(j, j + chunk.length);
      this.afterMove(j, caret, editing === null ? null : j + (editing - a), z - a);
    } else {
      if (z >= this.end || this.blocks[z].depth !== d) return;
      this.snap();
      const nextEnd = this.subtreeEnd(z);
      const chunk = this.blocks.splice(a, z - a);
      const at = nextEnd - chunk.length;
      this.blocks.splice(at, 0, ...chunk);
      this.joinList(at, at + chunk.length);
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
    // Backspace at the start of a numbered note: a dot again first (Logseq)
    if (i !== this.root && NUMBERED.test(this.textOf(i))) {
      this.snap();
      b.text = withProp(this.textOf(i), LIST, null);
      this.reflow(i, 0);
      return;
    }
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

  /** The note being typed in becomes a heading of level n (0: none), the caret at its end (as
   *  Logseq's / menu does); a note without words yet gets "## " ready for them. */
  setHeading(n) {
    if (this.cur === null) return;
    this.snap();
    this.setText(this.cur, (t) => withHeading(t, n).replace(/^((?:\S+ )?#{1,6})(?=\n|$)/, '$1 '));
    this.caretToEnd();
  }
  caretToEnd() {
    if (!this.ta) return;
    const e = contentEnd(this.ta.value);
    this.ta.setSelectionRange(e, e);
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
    if (['TODO', 'DOING', 'LATER', 'NOW', 'WAITING', 'DONE', 'CANCELED'].includes(id)) { this.setMarker(i, id); this.caretToEnd(); return; } // (Logseq's ->marker)
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
      case 'blockref': return this.insertAtCaret('(())', 2); // (the "((" list opens: Suggest.blocks)
      case 'weblink': return this.insertLink();
      case 'imagelink': return this.insertLink(true);
      case 'tag': return this.insertAtCaret('#');
      case 'bold': return this.wrap('**', '**');
      case 'italic': return this.wrap('*', '*');
      case 'mark': return this.wrap('^^', '^^');
      case 'strike': return this.wrap('~~', '~~');
      case 'underline': return this.wrap('<ins>', '</ins>'); // (Logseq's)
      case 'code': return this.wrap('`', '`');
      case 'codeblock': return this.wrap('```\n', '\n```');
      case 'math': return this.wrap('$', '$');
      case 'h1': return this.setHeading(1);
      case 'h2': return this.setHeading(2);
      case 'h3': return this.setHeading(3);
      case 'h4': return this.setHeading(4);
      case 'h5': return this.setHeading(5);
      case 'h6': return this.setHeading(6);
      case 'numlist': return this.numberList(false);
      case 'numkids': return this.numberList(true);
      case 'pa': return this.setPriority('A');
      case 'pb': return this.setPriority('B');
      case 'pc': return this.setPriority('C');
      case 'image': return this.pickFile(true);
      case 'upload': return this.pickFile(false);
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
    const inRoot = i === this.root; // (the zoomed-in note itself: they go under it, in view)
    const base = this.blocks[i].depth + (inRoot ? 1 : 0);
    const add = tpl.map((b) => ({ depth: base + b.depth, text: b.text, raw: null }));
    let at;
    if (!inRoot && !this.textOf(i).trim()) { this.blocks.splice(i, 1); at = i; } else at = this.subtreeEnd(i);
    this.blocks.splice(at, 0, ...add);
    this.reflow(at + add.length - 1, 'end');
  }

  /** Pick files to add (pictures: only pictures): each copied into assets/ and linked (addFile). */
  pickFile(pictures) {
    const input = document.createElement('input');
    input.type = 'file';
    if (pictures) input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => { for (const f of input.files) await this.addFile(f); };
    input.click();
  }

  /** Copy a picture or any other file into the notes folder's assets/ and link it here, as the capture
   *  box does (app::asset_markdown): a picture as ![name](../assets/…), another file as
   *  [name.ext](../assets/…). */
  async addFile(file) {
    if (file.size > 25e6) { this.app.toast('That file is over 25 MB; pick a smaller one.'); return; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const pic = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(file.name || '') || (!file.name && file.type.startsWith('image/'));
    let path;
    try { path = await call('save_asset', { name: file.name || (pic ? 'image.png' : 'file'), data }); }
    catch (e) { this.app.toast(`Couldn’t add ${pic ? 'the picture' : 'the file'}: ${e}`); return; }
    const md = fileLink(file, path, pic);
    if (this.ta) this.insertAtCaret(md);
    else {
      this.snap();
      const at = this.end;
      this.blocks.splice(at, 0, { depth: this.baseDepth + (this.root === null ? 0 : 1), text: md, raw: null });
      this.reflow(at, 'end');
    }
  }

  /** / Link: an address and, if wanted, a label: [label](address), or just the address. Words
   *  selected: they're the label (or the address, when they are one). picture (/ Image link): a
   *  picture's address, shown as the picture: ![label](address). */
  async insertLink(picture = false) {
    const ta = this.ta;
    if (!ta) return;
    const s = ta.selectionStart, z = ta.selectionEnd;
    const sel = ta.value.slice(s, z).trim();
    const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(sel);
    const got = await formBox({ title: picture ? 'Image link' : 'Link', ok: picture ? 'Add picture' : 'Add link', fields: [
      { label: 'Address', value: isUrl ? sel : '', placeholder: 'https://…', type: 'url' },
      { label: 'Label (optional)', value: isUrl || sel.includes('\n') ? '' : sel, placeholder: 'the words that show' }] });
    if (this.ta !== ta) return; // (another note was opened meanwhile)
    ta.focus({ preventScroll: true });
    let [url, label] = (got ?? []).map((x) => x.trim());
    if (!url) return;
    if (/^www\./i.test(url)) url = 'https://' + url;
    url = url.replace(/\s/g, '%20');
    label = (label || '').replace(/[[\]\n]/g, '');
    ta.setSelectionRange(s, z);
    this.insertAtCaret(picture ? `![${label}](${url})` : label ? `[${label}](${url})` : url);
  }

  /** Number list / Number children (the / menu), as Logseq toggles them: this note, or its sub-notes
   *  one level down (one numbered already: all of them go back to dots). */
  numberList(kids) {
    const i = this.cur;
    if (i === null) return;
    let js = [i];
    if (kids) {
      js = [];
      for (let j = i + 1; j < this.subtreeEnd(i); j = this.subtreeEnd(j)) js.push(j);
      if (!js.length) { this.app.toast('This note has no sub-notes to number yet.', 3000); return; }
    }
    const on = js.some((j) => NUMBERED.test(this.textOf(j)));
    this.changeTexts(js, (t) => withProp(t, LIST, on ? null : 'number'), true);
  }

  /** A note picked in the "((" list (hit: {page, line, text}): its id goes between the "((" and "))"
   *  typed (the words searched for, from start, give way to it), the note getting an id:: first if it
   *  has none (noteId). The caret goes after the "))". */
  async referTo(hit, start, c) {
    const q = this.ta?.value.slice(start, c) ?? '';
    const i = this.cur, was = this.blocks[i]?.depth;
    const id = await noteId(this.app, hit);
    const ta = this.ta; // (saving the page may have drawn it again: the note's box now)
    if (!id) return;
    // the note typed in is still the one being typed in (the same place, and its "((" still there)
    if (!ta || this.cur !== i || this.blocks[i]?.depth !== was || !ta.value.includes('((' + q)) {
      this.app.toast('The reference wasn’t added: the note was closed or changed meanwhile. Pick the note again.', 5000);
      return;
    }
    const v = ta.value;
    let k = v.lastIndexOf('((' + q, Math.max(ta.selectionStart, start));
    if (k < 0) k = v.lastIndexOf('((' + q);
    this.snap();
    const a = k + 2, b = a + q.length;
    const closed = v.slice(b, b + 2) === '))' ? 2 : v[b] === ')' ? 1 : 0; // (what "((" brought along: both, or one)
    ta.setRangeText(id + '))', a, b + closed, 'end');
    ta.setSelectionRange(a + id.length + 2, a + id.length + 2);
    this.typed();
    ta.focus({ preventScroll: true });
  }

  /** The phone toolbar's "/": a "/" at the caret, and the command list (it filters as words are typed
   *  after it, as when "/" is typed after a space). */
  openCommands() {
    const ta = this.ta;
    if (!ta) return;
    const at = ta.selectionStart;
    this.beforeTyping();
    ta.setRangeText('/', at, ta.selectionEnd, 'end');
    this.typed();
    this.app.ac.close();
    this.app.ac.slashAt = { ta, at };
    this.app.ac.check(this);
  }

  /** The phone toolbar's date button (anchor: it): a link to today, tomorrow, yesterday or another day
   *  (while typing), or the note's scheduled date or deadline (as before). */
  dateMenu(anchor) {
    const i = this.cur ?? (this.sel ? this.selRange()[0] : null);
    if (i === null) return;
    const items = [];
    if (this.cur !== null) {
      items.push({ label: 'Today', hint: 'link', run: () => this.command('today') }, { label: 'Tomorrow', hint: 'link', run: () => this.command('tomorrow') },
        { label: 'Yesterday', hint: 'link', run: () => this.command('yesterday') }, { label: 'Another day…', hint: 'link', run: () => this.command('date') }, '-');
    }
    items.push({ label: 'Scheduled…', hint: 'to-do date', run: () => this.editDate(i, 'scheduled') }, { label: 'Deadline…', run: () => this.editDate(i, 'deadline') });
    menu(anchor, items, { keep: true, cls: 'tb-menu' });
  }

  /** A new note at the end of what's shown (the page; zoomed in, the note's last sub-note), and typing
   *  in it (the phone's "+" button): an empty one there already is used. */
  addAtEnd() {
    if (this.readonly) { this.edit(this.start); return; } // (it says why it can't)
    const depth = this.root === null ? 0 : this.blocks[this.root].depth + 1;
    const last = this.end - 1;
    if (last >= this.start && last !== this.root && this.blocks[last].depth === depth && !this.textOf(last).trim()) { this.edit(last, 0); return; }
    this.clearSel();
    this.snap();
    const at = this.end;
    this.blocks.splice(at, 0, { depth, text: '', raw: null });
    this.joinList(at, at + 1); // (after a numbered note, numbered too, as Enter does)
    this.reflow(at, 0);
  }

  toggleCollapse(i) {
    if (this.readonly) return;
    this.snap();
    const b = this.blocks[i];
    if (this.isCollapsed(i)) b.text = unfolded(b.text);
    else b.text = folded(b.text);
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
      if (anyFolded) b.text = unfolded(b.text);
      else if (!this.isCollapsed(j)) b.text = folded(b.text);
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
      if (anyFolded) b.text = unfolded(b.text);
      else if (!this.isCollapsed(i)) b.text = folded(b.text);
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
        // (behind: the same page was saved from the other side of this window meanwhile, App.catchUp;
        // a clean merge of the two sides needs no word)
        const side = !!this.behind;
        if (res.conflict) {
          this.dirty = true;
          this.conflict = true;
          if (this.quiet) { this.quiet = 'clash'; return; } // (notes being moved: move.js puts this page back itself)
          this.fromSide = side;
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
          if (!side) this.app.toast('Changes made elsewhere were added to this page', 2500);
        } else if (res.merged) {
          this.hash = res.hash;
          this.applyMerged(res.merged);
          if (!side) this.app.toast('Changes made elsewhere were added to this page', 2500);
        } else {
          this.hash = res.hash;
          this.base = sent;
        }
        this.app.saved(this, { doc: res.merged || sent, hash: res.hash }); // (what the file holds now)
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

  /** Take over the typing of x, the same file open on the other side, before it is saved (App.takeOver):
   *  its words and what they are to be saved against. x has nothing left to save. */
  takeFrom(x) {
    clearTimeout(x.timer);
    x.dirty = false;
    this.doc = clone(x.doc);
    this.base = clone(x.base);
    this.exists = x.exists;
    this.forgetUndo(); // (its steps were for the older words)
    this.render();
    this.markDirty();
  }

  /** Each note's level and words, to find a note again after the page changed (findAgain). */
  shape() { return this.blocks.map((b) => [b.depth, b.text]); }

  /** The same file was just saved from the other side (file: what it holds now, and its hash). When
   *  only one note's words differ from what this side shows, that note is updated in place: no
   *  reading the page again, no drawing a long page again, and the reading place stays. False: it
   *  isn't that simple (read the page again instead). */
  takeSaved(file) {
    if (!file?.hash || !file.doc || this.cur !== null || this.dirty || this.saving || this.conflict) return false;
    const a = this.blocks, b = file.doc.blocks;
    if (a.length !== b.length || (this.doc.preamble ?? '') !== (file.doc.preamble ?? '')) return false;
    let k = -1;
    for (let j = 0; j < a.length; j++) {
      if (a[j].depth !== b[j].depth) return false;
      if (a[j].text !== b[j].text) { if (k >= 0) return false; k = j; }
    }
    if (k >= 0 && foldedIn(a[k].text) !== foldedIn(b[k].text)) return false; // (folding changes which notes show)
    this.doc = clone(file.doc);
    this.base = clone(file.doc);
    this.hash = file.hash;
    this.exists = true;
    this.behind = false;
    this.forgetUndo(); // (its steps hold the page without the other side's change)
    if (k >= 0) { this.refreshBlock(k); if (this.root !== null) this.renderCrumbs(); }
    if (this.zoomLine !== null && this.root !== null) { // (a line added above it moves its line)
      const line = this.lineOf(this.root);
      if (line !== this.zoomLine) { this.zoomLine = line; this.app.zoomMoved?.(this); }
    }
    return true;
  }

  /** A zoomed-in view read again (or merged): its note is found again by its words, not by its old
   *  line (a note added above it moves it down), and the tab's place follows (App.zoomMoved).
   *  before/root: the notes and the zoomed note's index before. */
  rezoom(before, root) {
    if (!before || this.zoomLine === null || root === null) return;
    const j = findAgain(before, root, this.blocks);
    if (j === null) return;
    this.root = j;
    const line = this.lineOf(j);
    if (line !== this.zoomLine) { this.zoomLine = line; this.app.zoomMoved?.(this); }
  }

  /** The page as saved after combining with changes made elsewhere: show it, keep the caret. The
   *  undo steps are dropped: they hold the page from before the other changes came in, so going back
   *  to one would quietly remove them again. */
  applyMerged(doc) {
    const editing = this.cur;
    const caret = this.ta?.selectionStart ?? null;
    const key = editing !== null ? this.blocks[editing] : null;
    const before = this.zoomLine !== null ? this.shape() : null, root = this.root;
    this.doc = doc;
    this.base = clone(doc);
    this.forgetUndo();
    if (this.zoomLine !== null && this.root !== null) this.root = Math.min(this.root, this.blocks.length - 1);
    this.rezoom(before, root);
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

  /** An earlier version of the page put back (History, history.js), as one Undo step: the whole page
   *  (zoomed in on a note, the whole page shows again and the tab's place follows), then saved the
   *  usual way, against the version this side read (base_hash): a change made elsewhere meanwhile is
   *  merged in, or the clash screen asks. Resolves once saved (or the clash screen shows). */
  putBack(doc) {
    this.stopEdit();
    this.clearSel();
    this.snap();
    Object.assign(this.doc, { preamble: doc.preamble, blocks: doc.blocks.map((b) => ({ ...b })), indent: doc.indent, crlf: doc.crlf });
    if (!this.blocks.length) this.blocks.push({ depth: 0, text: '', raw: null });
    if (this.zoomLine !== null) {
      this.root = this.zoomLine = null;
      this.app.tabs?.replace(this.el, '#/page/' + encodeURIComponent(this.name));
    }
    this.render();
    this.markDirty();
    return this.flush();
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
    this.showBanner(`<span>This page was also changed ${this.elsewhere()}, in the same notes as here. Nothing on this page is saved until you choose.</span>
      <span class="btn-row"><button class="btn" data-a="choose">Choose what to keep…</button></span>`);
    this.app.conflicts?.add(this);
    this.banner.onclick = (e) => { if (e.target.closest('[data-a="choose"]')) openClash(this); };
    openClash(this);
  }

  /** Where the other change came from, for the clash's words: the other side of this window (the
   *  same page open there was saved meanwhile), else another device or app. */
  elsewhere() { return this.fromSide ? 'on the other side of this window' : 'somewhere else (your phone, Claude or another app)'; }

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
    const busy = () => this.cur !== null || this.dirty || this.saving || this.sel || this.conflict || this.menuOpen || this.press || this.locked;
    if (!forceIt && busy()) return false;
    const view = await call('page', { name: this.name, today: today(), time: nowTime() });
    if (!forceIt && busy()) return false; // typing started while it loaded
    this.stopEdit();
    const before = this.zoomLine !== null ? this.shape() : null, root = this.root;
    this.load(view);
    this.rezoom(before, root);
    if (!this.error) this.banner.hidden = true;
    this.forgetUndo();
    this.render();
    return true;
  }

  /** Read the page again while a note is open for editing with nothing typed since it was saved (the
   *  same page was saved from the other side): the same note opens again (found by its words), the
   *  caret where it was. False if typing started meanwhile (its own save then takes the change in). */
  async refresh() {
    const i = this.cur, ta = this.ta;
    if (i === null || !ta) return this.reload();
    const caret = ta.selectionStart, before = this.shape(), was = this.blocks[i].text, root = this.root;
    const view = await call('page', { name: this.name, today: today(), time: nowTime() });
    if (this.ta !== ta || this.dirty || this.saving || this.conflict) return false; // typing started, or another note
    this.stopEdit();
    this.load(view);
    this.rezoom(before, root);
    if (!this.error) this.banner.hidden = true;
    this.forgetUndo();
    this.render();
    const j = findAgain(before, i, this.blocks);
    if (j !== null) this.edit(j, caretAgain(was, this.blocks[j].text, caret));
    return true;
  }
}

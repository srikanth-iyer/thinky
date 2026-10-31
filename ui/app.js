// App shell: routing, journals and page views, search, sidebar, keyboard shortcuts, phone
// toolbar, background refresh. Lists live in views.js, Settings in settings.js, blocks in
// editor.js / render.js, floating bits in popups.js.

import { call, today, nowTime, store, isApp, isAndroid, listen, pageLinkUrl } from './api.js';
import { Outline, EDGE, PIN_H, findAgain, caretAgain, foldedIn, lineLook } from './editor.js';
import { renderBlock, propsHtml, visibleProps, esc, pagesIn } from './render.js';
import { Suggest, Preview, menu, confirmBox, promptBox, pickDate, place } from './popups.js';
import { pagesView, tagsView, propsView, todosView, taskRow, taskClicks, taskDay, byDay, num } from './views.js';
import { settingsView } from './settings.js';
import { h, pageLink, ICON, BRAND } from './dom.js';
import { keyOf } from './calendar.js';
import { Find } from './find.js';
import { Tabs, placeOf, parsePlace, sideNav } from './tabs.js';
import { openHistory } from './history.js';
import { SearchBox } from './search.js';
import { initFileDrop } from './filedrop.js';

// Looks: name and one-line note for the picker; the look itself lives in skins.css.
export const SKINS = [
  { id: 'plain', name: 'Plain', note: 'Logseq’s own look: off-white, flat and quiet' },
  { id: 'plainnight', name: 'Plain night', note: 'Plain in near-black, quiet' },
  { id: 'plainteal', name: 'Plain teal', note: 'Logseq’s dark look: deep blue-green' },
  { id: 'calm', name: 'Calm', note: 'The first look: light, teal, lifted cards' },
  { id: 'calmplain', name: 'Calm plain', note: 'Calm without the cards, on white' },
  { id: 'night', name: 'Night', note: 'The Board’s dark look, labels set into the page' },
  { id: 'paper', name: 'Paper', note: 'Dot-grid paper, serif writing, highlighter' },
  { id: 'sticker', name: 'Sticker', note: 'The Board’s sticker look: bold outlines' },
  { id: 'stickernight', name: 'Sticker night', note: 'Sticker, dimmed for evenings' },
  { id: 'automaton', name: 'Automaton', note: 'Lab notes on a rule 30 pattern' },
  { id: 'azulejo', name: 'Azulejo', note: 'Cobalt tiles on white' },
  { id: 'thinky', name: 'thinky', word: true, note: 'The logo’s cream, ink and red spark' },
];
const SKIN_IDS = new Set(SKINS.map((s) => s.id));
/** A look's name as HTML: the look named after the app shows the wordmark (his rule: the name is never plain letters). */
export const lookName = (s) => (s.word ? BRAND.word : esc(s.name));
/** The current look's colours for the Windows "Add to journal" box and the Android widgets, as #rrggbb: each token painted
 *  on a 1-pixel canvas over the box's background, so any CSS colour (see-through ones too) comes
 *  out as the colour seen. The names are the CSS tokens (outline_core::capture_box::COLOR_KEYS). */
function lookColors() {
  const probe = document.createElement('i');
  probe.style.display = 'none';
  document.body.append(probe);
  const g = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const paint = (token, under) => {
    probe.style.color = `var(--${token})`;
    g.fillStyle = under;
    g.fillRect(0, 0, 1, 1);
    g.fillStyle = getComputedStyle(probe).color;
    g.fillRect(0, 0, 1, 1);
    return '#' + [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((c) => c.toString(16).padStart(2, '0')).join('');
  };
  const out = { surface: paint('surface', '#ffffff') };
  for (const t of ['surface-2', 'ink', 'ink-soft', 'ink-faint', 'accent', 'accent-ink', 'line', 'line-soft', 'danger']) out[t] = paint(t, out.surface);
  probe.remove();
  return out;
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'Home', 'End', ' ', 'ArrowDown', 'ArrowUp']);
const QUIET_BUTTONS = '#histbar button, #topbar button, .side-fold, .title-row .icon-btn, #toast button';
// the sidebar's slide (App.slide; the same in app.css, html.sliding)
const SLIDE_MS = 200, SLIDE_EASE = 'cubic-bezier(.2, .7, .3, 1)';
// the sidebar's width (dragging its edge; 252 px until then) and the least width of each of two sides
const SIDE_MIN = 200, SIDE_MAX = 480, PANE_MIN = 340;
const VIEW_NAMES = { journals: 'Journals', pages: 'All pages', tags: 'Tags', props: 'Properties', settings: 'Settings', todos: 'To-dos', welcome: 'Welcome' };
const $ = (sel, root = document) => root.querySelector(sel);
/** A refusal's words (the app's answers are words; the dev server's come in an Error). */
const said = (e) => String(e?.message ?? e);
/** One note in a list of references: its words as on its page (a to-do word as a label, properties),
 *  in a .refhit row. n: a reference ({line, text, props}; line null = the page's own properties) or
 *  a note next to one ({line, text}); extra: HTML after the words (the Link button). */
function refRow(n, extra = '') {
  const row = h('div', 'refhit');
  const r = n.line === null ? { html: '', props: n.props } : renderBlock(n.text);
  // a to-do: its tick box, as on its page (he asked: not the word TODO); other words as labels
  let mk = '';
  if (r.marker) {
    if (!r.marker.startsWith('CANCEL')) mk += `<input type="checkbox" class="todo" ${r.marker === 'DONE' ? 'checked' : ''} aria-label="Done">`;
    if (!['TODO', 'DONE'].includes(r.marker)) mk += `<span class="mk">${esc(r.marker)}</span>`;
    row.refText = n.text;
    if (['DONE', 'CANCELED', 'CANCELLED'].includes(r.marker)) row.classList.add('marker-done');
  }
  row.innerHTML = `<div class="bc">${mk}${r.html}${propsHtml(r.props)}</div>${extra}`;
  if (r.html.includes(' data-ref="')) app.blockRefs(row); // ((block references)): the note's words (one look-up per list drawn)
  const { hf, lead } = lineLook(r); // (where linked references draw a dot or an arrow)
  if (hf) row.style.setProperty('--hf', hf);
  if (lead) row.style.setProperty('--lead', lead);
  return row;
}
/** The filter's words (small letters, accents dropped) lit in el's words: ranges added to the
 *  highlight hl (App.refTools). Matched in each piece of text as shown. */
function litWords(el, words, hl) {
  const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = fold(n.data);
    if (t.length !== n.data.length) continue; // (letters with accents written as two: places would differ)
    for (const w of words) {
      for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + w.length)) {
        const r = new Range();
        r.setStart(n, i);
        r.setEnd(n, i + w.length);
        hl.add(r);
      }
    }
  }
}
/** A linked reference's rows (App.refTree): the reference and the sub-notes not inside a folded
 *  one. A row is made the first time its note shows (in order, after the rows before it), then only
 *  hidden and shown again. */
function drawRefs(box) {
  const { hit, notes, shut, rows } = box.tree;
  let cut = Infinity;
  let prev = box.querySelector('.refpath');
  notes.forEach((n, k) => {
    const d = n.depth - hit.depth;
    const show = d <= cut;
    if (show) cut = shut.has(k) ? d : Infinity;
    let row = rows.get(k);
    if (!row && show) {
      row = refRow(n);
      row.dataset.line = n.line ?? '';
      row.dataset.k = k;
      if (hit.kids) row.dataset.d = d;
      if (k) {
        row.classList.add('kid');
        row.style.setProperty('--d', Math.min(d - 1, 5)); // its dot's place (app.css)
      }
      if (notes[k + 1]?.depth > n.depth) {
        row.classList.add('has-kids');
        row.classList.toggle('collapsed', shut.has(k));
        row.prepend(foldSays(h('button', 'fold'), shut.has(k)));
      }
      if (prev) prev.after(row); else box.prepend(row);
      rows.set(k, row);
    }
    if (row) { row.hidden = !show; prev = row; }
  });
}
/** A fold arrow says whether its note is folded (for screen readers). */
function foldSays(b, shut) {
  b.setAttribute('aria-expanded', String(!shut));
  b.setAttribute('aria-label', shut ? 'Unfold' : 'Fold');
  return b;
}
/** A note's first line as plain words, cut short (the path above a linked reference). */
function firstWords(text) {
  const line = text.split('\n')[0];
  const t = document.createElement('template'); // (inert: its pictures don't load)
  t.innerHTML = renderBlock(line).html;
  const w = [...(t.content.textContent.trim() || line.trim())];
  return w.length > 40 ? w.slice(0, 38).join('').trimEnd() + '…' : w.join('') || '…';
}
/** Two outlines showing the same file (the same page open on both sides). */
const sameFile = (a, b) => a.path === b.path && a.name.toLowerCase() === b.name.toLowerCase();
/** Two outlines of the same file that read the same version of it and differ in at most one note's
 *  words (the notes in the same places): typing in that note can simply come over (App.takeOver). */
function oneNoteApart(x, o) {
  const a = x.blocks, b = o.blocks;
  if (a.length !== b.length || (x.doc.preamble ?? '') !== (o.doc.preamble ?? '')) return false;
  let n = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k].depth !== b[k].depth) return false;
    if (a[k].text !== b[k].text && ++n > 1) return false;
  }
  return true;
}
/** Android: the card asking for "all files access" (Journals and Settings show it until it's on). */
export function accessCard(title) {
  const c = h('div', 'card');
  c.innerHTML = `<h2>${esc(title)}</h2>
    <p class="note">Android needs your permission before the app can read the notes folder that Drive Sync keeps up to date. Turn on <b>Allow access to manage all files</b> for ${BRAND.word}, then come back.</p>
    <button class="btn">Open the setting</button>`;
  c.querySelector('button').onclick = () => window.LeanAndroid?.openAllFilesSettings();
  return c;
}
const dateOf = ([y, m, d]) => new Date(y, m - 1, d);
/** Kept while the app is open (folded days and reference groups), not for the next start. */
const session = {
  get: (k, def) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? def; } catch { return def; } },
  set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* not available */ } },
};
/** The days folded in the Journals list (their names in small letters). */
const dayFolds = () => new Set(session.get('dayFolds', []));
/** Reference groups folded (App.refGroup): kind 'l' (linked) or 'u' (unlinked) references to host, from page. */
const refKey = (kind, host, page) => `${kind}:${String(host).toLowerCase()}\n${String(page).toLowerCase()}`;
const refFolds = () => new Set(session.get('refFolds', []));
/** The references' orders (Build 33, he asked: each both ways, and by date created): its key → [what
 *  it sorts by, which way, the words in the menu and on the button]. */
const REF_SORTS = {
  changed: ['changed', -1, 'Last changed, newest first'], 'changed-old': ['changed', 1, 'Last changed, oldest first'],
  name: ['name', 1, 'Name, A to Z'], 'name-za': ['name', -1, 'Name, Z to A'],
  created: ['created', -1, 'Date created, newest first'], 'created-old': ['created', 1, 'Date created, oldest first'],
};
/** The references' tools, per page (he asked, Oct 29): is the filter box open, and the sort picked. Kept in
 *  localStorage `refTools` = [[page in small letters, open 0/1, 'changed'|'name'], …], the page used
 *  last at the end, at most REF_TOOLS_MAX; a page back to closed + Last changed leaves the list. */
const REF_TOOLS_MAX = 200;
const refToolsList = () => { const l = store.get('refTools', []); return Array.isArray(l) ? l.filter((x) => Array.isArray(x)) : []; };
const refPrefs = (host) => {
  const e = refToolsList().find((x) => x[0] === String(host).toLowerCase());
  return { open: !!e?.[1], sort: REF_SORTS[e?.[2]] ? e[2] : 'changed' };
};
const setRefPrefs = (host, { open, sort }) => {
  const k = String(host).toLowerCase(), l = refToolsList().filter((x) => x[0] !== k);
  if (open || sort !== 'changed') l.push([k, open ? 1 : 0, sort]);
  store.set('refTools', l.slice(-REF_TOOLS_MAX));
};
/** "Linked references" folded shut from its heading (Build 34, the maintainer asked: like Unlinked references):
 *  localStorage `refShut` = [page or day in small letters…], the last folded at the end, at most 200. */
const refShutList = () => { const l = store.get('refShut', []); return Array.isArray(l) ? l.map(String) : []; };
const refShut = (host) => refShutList().includes(String(host).toLowerCase());
const setRefShut = (host, shut) => {
  const k = String(host).toLowerCase(), l = refShutList().filter((x) => x !== k);
  if (shut) l.push(k);
  store.set('refShut', l.slice(-REF_TOOLS_MAX));
};
/** The heading's "Linked references" as a fold button (the section's notes and tools hide). */
function foldableRefs(sec, host) {
  const btn = sec.querySelector('.sec-h .disclose');
  const show = (shut) => { sec.classList.toggle('shut', shut); btn.setAttribute('aria-expanded', String(!shut)); };
  show(refShut(host));
  btn.onclick = () => { const shut = !sec.classList.contains('shut'); setRefShut(host, shut); show(shut); };
}
const ymd = (dt) => [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];

// ---------------------------------------------------------------------------
// Keyboard shortcuts, in Logseq's notation ("mod+shift+up", "g j"). Logseq's
// :shortcuts in config.edn override these for the same action names.
const DEFAULT_KEYS = {
  'editor/move-block-up': ['alt+shift+up', 'mod+shift+up'],
  'editor/move-block-down': ['alt+shift+down', 'mod+shift+down'],
  'editor/highlight': [],
  'editor/toggle-open-blocks': ['t o'],
  'editor/select-parent': ['mod+a'], // (editing: the words first, then the note; then its parent…)
  'editor/select-all-blocks': ['mod+shift+a'],
  'go/search': ['mod+k'],
  'command-palette/toggle': ['mod+shift+p'], // the command list (search.js, commands.js)
  'go/search-in-page': ['mod+f'], // find (and replace) on the page that's open
  'go/replace-in-page': ['mod+h'],
  'go/journals': ['g j', 'mod+j'],
  'go/all-pages': ['g a'],
  'go/todos': ['g t'],
  'go/date': ['g d'],
  'go/next-journal': ['g n'],
  'go/prev-journal': ['g p'],
  'go/backward': ['alt+left', 'mod+open-square-bracket'],
  'go/forward': ['alt+right', 'mod+close-square-bracket'],
  'sidebar/open-today-page': [],
  'ui/toggle-left-sidebar': ['t l', 'mod+backslash'],
  'ui/toggle-wide-mode': ['t w'],
  'ui/text-bigger': ['mod+=', 'mod+plus'],
  'ui/text-smaller': ['mod+-'],
  'ui/text-reset': ['mod+0'],
};
const KEYNAME = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', '[': 'open-square-bracket', ']': 'close-square-bracket', '\\': 'backslash', ' ': 'space', '+': 'plus', escape: 'esc' };
const parseChord = (s) => {
  const parts = s.toLowerCase().split('+').filter(Boolean);
  if (s.endsWith('++')) parts.push('plus');
  const key = parts.pop();
  return { key, mod: parts.includes('mod') || parts.includes('ctrl') || parts.includes('meta'), shift: parts.includes('shift'), alt: parts.includes('alt') };
};
const evChord = (e) => ({ key: KEYNAME[e.key.toLowerCase()] ?? e.key.toLowerCase(), mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
const same = (a, b) => a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;

// ---------------------------------------------------------------------------
class App {
  constructor() {
    this.names = [];
    this.active = null;
    this.ac = new Suggest(this);
    this.preview = new Preview(this);
    this.find = new Find(this);
    this.sbox = new SearchBox(this); // the search box and the command list (search.js)
    this.tabs = new Tabs(this); // tabs and the two sides (tabs.js); the page(s) on screen are its panes
    this.pendingLine = null;
    this.conflicts = new Set();
    this.opening = new Set(); // notes waiting to open (editAfterSave): { done, keep }, for saveAll
    this.keyMap = { ...DEFAULT_KEYS };
    this.steps = []; this.redoSteps = []; // which outline each Undo step is in, newest last (undo below)
  }
  /** The outlines (editors) on screen, on both sides. */
  get outlines() { return this.tabs.panes.flatMap((p) => p.outlines); }
  /** The active pane: where links, the keys and find act ({el, outlines, …}, tabs.js). */
  get pane() { return this.tabs.pane; }
  /** The step of the browser's history we're at (Android's test script goes back that many). */
  get histN() { return this.tabs.n; }
  paneOf(el) { return this.tabs.panes.find((p) => p.el.contains(el)); }
  /** Save pane p's notes; false (with the reason shown) if its page has a clash to settle first. */
  async canLeave(p) {
    await Promise.all(p.outlines.map((o) => { o.stopEdit(); return o.flush(); }));
    return !this.stuckIn(p);
  }
  /** Typing that couldn't be saved (e.g. the file is offline), on a page about to leave the screen:
   *  a copy goes to logseq/bak first. */
  async keepCopy(o) {
    if (!o.dirty || o.readonly) return;
    try { await call('backup', { name: o.name, doc: o.doc }); this.toast(`Couldn’t save “${o.name}”; a copy of your changes is in logseq/bak.`, 6000); }
    catch (e) { this.toast(`Couldn’t save “${o.name}”: ${e}`, 6000); }
  }
  /** Words typed while a note was opening that couldn't go into it (he went elsewhere, the app is
   *  closing…): a copy in logseq/bak (as a note in a backup of that page), and a message. */
  async keepTyped(o, words, what, keepalive = false) {
    if (!words) return;
    let copy = '';
    try {
      await call('backup', { name: o.name, doc: { preamble: '', blocks: [{ depth: 0, text: words, raw: null }], indent: o.doc?.indent || '\t', crlf: !!o.doc?.crlf } }, { keepalive });
      copy = ' A copy is in logseq/bak.';
    } catch { /* (said below) */ }
    this.toast(`${what} wasn’t added: “${words}”.${copy}`, 10000);
  }
  /** Before another notes folder opens: both sides saved (what can't be saved kept in this folder's
   *  logseq/bak) and their editors stopped for good, so nothing is saved into the other folder.
   *  false if a page has a clash to settle first. */
  async leaveAll() {
    for (const p of this.tabs.panes) if (!(await this.canLeave(p))) return false;
    for (const p of this.tabs.panes) {
      for (const o of p.outlines) { await this.keepCopy(o); o.readonly = true; }
      p.outlines = [];
    }
    this.active = null;
    return true;
  }
  /** The active pane changed or shows another place: the arrows, the sidebar's highlight and the
   *  phone bar's title follow. */
  here() {
    const t = this.tabs.tab();
    if (!t) return;
    const { kind, arg } = parsePlace(placeOf(t));
    document.querySelectorAll('.nav a').forEach((a) => (a.dataset.view === kind ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const bar = $('#topbar .t');
    if (bar) bar.textContent = VIEW_NAMES[kind] ?? (arg || '');
    // the phone bar's Go to date shows on the Journals list only: on a page, its name keeps the room
    $('#topbar')?.classList.toggle('journals', kind === 'journals');
    const add = $('#addnote'); // phones: "+" adds a note (Journals list: to today), where there are notes
    if (add) { add.hidden = !['journals', 'page', 'zoom'].includes(kind); add.classList.remove('away'); }
    this.updateHistBar();
  }

  // ----- small services used by editors and views -----
  /** A short message at the bottom; action {label, run}: a button in it (e.g. Undo). */
  toast(msg, ms = 3200, action = null) {
    let t = $('#toast');
    if (!t) { t = h('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg;
    if (action) {
      const b = h('button', 'toast-act');
      b.type = 'button';
      b.textContent = action.label;
      b.onclick = () => { t.hidden = true; action.run(); };
      t.append(b);
    }
    t.classList.toggle('has-act', !!action);
    t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => (t.hidden = true), ms);
  }
  async openUrl(url) {
    if (/^leanoutliner:/i.test(url) && (await this.openLink(url))) return; // (a page or note of these notes: here)
    const T = window.__TAURI__;
    if (T?.opener?.openUrl) T.opener.openUrl(url).catch((e) => this.toast(String(e)));
    else window.open(url, '_blank', 'noopener');
  }
  showImage(src) {
    const back = h('div', 'modal-back lightbox', `<img src="${esc(src)}" alt="">`);
    back.onclick = () => back.remove();
    document.body.append(back);
  }
  workflow() { return this.summary?.config?.workflow || 'todo'; }
  /** Block references in el (render.js: span.bref[data-ref]) show the words of the note they name
   *  (its first line) and lead to it (data-page/data-line, editor.js click). The notes are looked up
   *  by id, together, a moment after drawing, each id once until something is saved or changed
   *  elsewhere (refCache). An id no note has keeps "↗ block". */
  blockRefs(el) {
    (this.refWait ??= new Set()).add(el);
    if (this.refT) return;
    this.refT = setTimeout(async () => {
      this.refT = 0;
      const spans = [...this.refWait].flatMap((x) => [...x.querySelectorAll('.bref[data-ref]:not([data-page])')]);
      this.refWait.clear();
      const cache = (this.refCache ??= new Map());
      const ask = [...new Set(spans.map((x) => x.dataset.ref))].filter((id) => !cache.has(id));
      if (ask.length) {
        try { (await call('blocks_by_id', { ids: ask })).forEach((hit, k) => cache.set(ask[k], hit)); } catch { return; }
      }
      for (const x of spans) {
        const hit = cache.get(x.dataset.ref);
        if (!hit || !x.isConnected) { x.title = 'Block reference: no note has this id'; continue; }
        const line = hit.text.split('\n')[0];
        const r = renderBlock(line);
        x.innerHTML = (r.marker ? `<span class="mk">${esc(r.marker)}</span> ` : '') + (r.html || '…');
        for (const a of x.querySelectorAll('a, .bref')) { // (no links inside: the whole of it leads to the note)
          const sp = h('span', a.className.replace(/\bbref\b/, ''), a.innerHTML);
          a.replaceWith(sp);
        }
        Object.assign(x.dataset, { page: hit.page, line: hit.line });
        x.title = `Block reference (${hit.page})`;
      }
    }, 0);
  }
  editing(outline, on) {
    this.active = on ? outline : (this.active === outline ? null : this.active);
    if (on) this.outlines.forEach((o) => o !== outline && o.clearSel());
    else if (outline.behind) setTimeout(() => this.catchUp(outline), 0); // (after Esc has selected the note)
    this.updateToolbar();
    this.pinSoon();
  }
  /** Long pages keep the parents of the note at the top of the screen pinned there (editor.js
   *  pinParents); worked out once per frame while scrolling. On a phone, not while typing: the
   *  keyboard leaves little room. */
  pinSoon() {
    if (this.pinF) return;
    this.pinF = requestAnimationFrame(() => {
      this.pinF = 0;
      const fb = $('#findbar');
      for (const p of this.tabs.panes) { // each side has its own (a hidden one, in a narrow window, none)
        if (!p.outlines.length || !p.el.offsetParent) continue;
        const cs = getComputedStyle(p.el);
        const narrow = cs.overflowY === 'visible';
        const top = (narrow ? $('#topbar').getBoundingClientRect().bottom : p.el.getBoundingClientRect().top) + (narrow && !fb.hidden ? fb.getBoundingClientRect().height : 0);
        const typing = narrow && p.outlines.some((o) => o.cur !== null);
        // sticky rows stop at the scrolling part's padding: in a wide window that's the pane's, so they
        // go up by as much to sit right under the top strip
        const z = (p.el.offsetWidth ? p.el.getBoundingClientRect().width / p.el.offsetWidth : 1) || 1; // text size zooms the pane, not the top bar
        const stick = narrow ? top / z : -parseFloat(cs.paddingTop);
        for (const o of p.outlines) o.pinParents(top, stick, typing);
        // a wide window: scrolling a note into view (typing, find) keeps it below the pinned rows
        if (!narrow) {
          const rows = Math.max(0, ...p.outlines.map((o) => (o.pins.hidden ? 0 : o.pins.firstChild.childElementCount)));
          const pad = rows ? `${8 + rows * PIN_H}px` : '';
          if (p.el.style.scrollPaddingTop !== pad) p.el.style.scrollPaddingTop = pad;
        }
      }
    });
  }
  selecting(outline, on) {
    if (on) { this.active = outline; this.outlines.forEach((o) => o !== outline && o.clearSel()); }
    this.updateToolbar();
  }
  updateToolbar() {
    const narrow = window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;
    const o = this.active;
    const tb = $('#toolbar');
    const text = this.textTa?.isConnected && document.activeElement === this.textTa; // (a page's properties box)
    tb.hidden = !(narrow && (text || (o && (o.cur !== null || o.sel))));
    tb.classList.toggle('tb-text', !!text);
    if (tb.hidden) $('#addnote')?.classList.remove('away'); // (done typing: the "+" is back)
  }
  /** Phones: the "+" steps aside while a finger scrolls the page down and comes back when it scrolls
   *  up or reaches the top. Only scrolling by a finger counts (touchedAt): the app's own scrolling
   *  (to a note being typed in, back to where a page was) leaves it as it is. */
  fabScroll() {
    const y = window.scrollY, last = this.fabY ?? y;
    this.fabY = y;
    const add = $('#addnote');
    if (!add || add.hidden) return;
    if (y < 48) add.classList.remove('away');
    else if (Date.now() - (this.touchedAt || 0) < 1000 && Math.abs(y - last) > 3) add.classList.toggle('away', y > last);
  }
  /** The phone's "+": a new note at the end of the page shown, or of today on the Journals list (the
   *  first day there), typing in it (Outline.addAtEnd). */
  addNote() {
    const { kind } = parsePlace(placeOf(this.tabs.tab()));
    const os = this.pane.outlines;
    const o = kind === 'journals' ? os.find((x) => x.journal?.join() === today().join()) : os[0];
    if (o) {
      this.unfoldFor(o); // (today folded: it opens first, so the new note shows)
      o.addAtEnd();
      // the new note in view at once (he asked: he had to look for it), and again once the phone's
      // keyboard has come up and the screen got shorter
      const show = () => o.ta?.isConnected && o.ta.scrollIntoView({ block: 'center' });
      show();
      const vv = window.visualViewport;
      if (vv) {
        const again = () => { vv.removeEventListener('resize', again); show(); };
        vv.addEventListener('resize', again);
        setTimeout(() => vv.removeEventListener('resize', again), 1500);
      }
    }
    else if (kind === 'journals') this.toast('Today’s journal is still opening. Try again in a moment.', 2500);
  }
  /** Editing starts on note i of outline o while the same page, open on the other side (x), has typing
   *  not saved yet, or a save on its way, or o missed a save from there (behind). So that this side
   *  never edits an older copy of a note (saving that would clash with his own words):
   *  - the simple case, the typing in one note while both read the same version of the file: it
   *    comes over at once (Outline.takeFrom; nothing can be typed in between): 'took';
   *  - else that side stops editing and saves first, this side reads the page again, then the
   *    clicked note opens, found again by its words (editAfterSave): 'wait';
   *  - nothing newer there: null (edit straight away). */
  takeOver(o, i, caret) {
    const x = this.outlines.find((y) => y !== o && sameFile(y, o) && (y.dirty || y.saving) && !y.conflict);
    if (!x && !o.behind) return null;
    if (x && !x.saving && !x.readonly && !o.dirty && !o.saving && !o.conflict && !o.readonly && !o.behind && o.hash === x.hash && oneNoteApart(x, o)) {
      x.stopEdit();
      o.takeFrom(x);
      return 'took';
    }
    if (o.conflict || o.readonly) return null;
    const w = {};
    w.done = this.editAfterSave(o, i, caret, w).catch(() => {}).finally(() => this.opening.delete(w));
    this.opening.add(w);
    return 'wait';
  }
  /** takeOver's second way: the other side's typing is saved first (and this side's, if any), this
   *  side reads the page again, then note i opens, found again by its words. Meanwhile what he types
   *  goes into a hidden box that has the keyboard (so pasting, accents, AltGr and IME work), and
   *  Enter, Tab, Shift+Tab, Esc, Backspace or Delete with that box empty are kept as steps; when the
   *  note opens it all goes in, the steps done by the editor as if typed there (replay); a word still
   *  being made with an input method is waited for (it goes in as committed, once). Esc before
   *  anything lets it go. A save that takes long says so, and it keeps waiting (opening an older copy
   *  would clash with his own words). Nothing opens if he goes on elsewhere meanwhile; what he typed
   *  then is kept in logseq/bak and shown, never dropped without a word. w.keep(): stop waiting and
   *  keep what was typed so (saveAll, when it can't wait any longer). */
  async editAfterSave(o, i, caret, w = {}) {
    const seq = this.editSeq = (this.editSeq || 0) + 1;
    const before = o.shape(), was = o.blocks[i]?.text ?? '';
    const box = h('textarea', 'ed-wait');
    box.setAttribute('aria-label', 'The note opens in a moment; what you type goes into it');
    const r = o.blockDiv(i)?.getBoundingClientRect();
    if (r) Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px' }); // (an IME's list shows there)
    document.body.append(box);
    box.focus({ preventScroll: true });
    const steps = [];
    const WAIT = 'Saving the other side first…';
    let left = false, done = false, composing = false, composed = null, kept = false;
    // a word being made with an input method (Japanese, Chinese…) goes into the box when it's committed
    box.addEventListener('compositionstart', () => { composing = true; });
    box.addEventListener('compositionend', () => { composing = false; composed?.(); });
    box.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      const key = e.key;
      if (key === 'Escape' && !steps.length && !box.value) { e.preventDefault(); e.stopPropagation(); left = true; return; } // never mind
      const step = (key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)) || key === 'Tab' || key === 'Escape'
        || ((key === 'Backspace' || key === 'Delete') && !box.value);
      if (!step) return; // (words, Shift+Enter, pasting… go into the box itself)
      e.preventDefault();
      e.stopPropagation();
      steps.push({ text: box.value, key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
      box.value = '';
    });
    box.addEventListener('paste', (e) => { // kept as a paste: the editor makes an outline of an outline, a picture of a picture…
      e.preventDefault();
      steps.push({ text: box.value, paste: { text: e.clipboardData?.getData('text/plain') ?? '', files: [...(e.clipboardData?.files || [])] } });
      box.value = '';
    });
    // (he clicked elsewhere; not when another window took the keyboard: it comes back to the box)
    box.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== box) left = true; }));
    const gone = () => left || seq !== this.editSeq || !this.outlines.includes(o) || this.outlines.some((y) => y.cur !== null);
    const finish = () => { // (once) the box's words taken, the box gone
      if (done) return;
      done = true;
      if (box.value) steps.push({ text: box.value });
      box.remove();
      const t = $('#toast');
      if (t?.textContent.startsWith(WAIT)) t.hidden = true;
    };
    const lost = (keepalive = false) => { // (once) what he typed, if it can't go in: logseq/bak, and a message
      if (kept) return;
      kept = true;
      return this.keepTyped(o, steps.map((st) => [st.text, st.paste?.text].filter(Boolean).join(' ')).join(' ').trim(), 'What you typed while the note was opening', keepalive);
    };
    w.keep = (keepalive) => { left = true; finish(); return lost(keepalive); };
    const slow = setTimeout(() => { if (!gone()) this.toast(`${WAIT} What you type goes into the note as soon as it opens.`, 120000); }, 1500);
    o.waiting = true; // (catchUp leaves it to this)
    try {
      const all = this.outlines.filter((y) => sameFile(y, o));
      for (const y of all) if (y !== o) y.stopEdit();
      await Promise.all(all.map((y) => y.flush()));
      if (!gone()) {
        o.clearSel();
        if (!o.dirty && !o.conflict) await o.reload(); // (as the file is now, with the other side's typing)
      }
    } catch { /* (a save that failed says so itself) */ } finally {
      o.waiting = false;
      clearTimeout(slow);
    }
    // a word still being composed: the note opens once it's committed (taken half-made, it would go in
    // twice, or unconverted); after 10 s, as it is
    if (composing && !gone()) {
      await new Promise((res) => { composed = () => setTimeout(res); setTimeout(res, 10000); });
      if (document.activeElement !== box) left = true; // (it ended because he clicked elsewhere)
    }
    finish();
    if (gone() || o.conflict) { await lost(); return; }
    const j = findAgain(before, i, o.blocks);
    if (j === null) { await lost(); return; }
    kept = true; // (from here it goes into the note; replay keeps what can't)
    o.edit(j, caretAgain(was, o.blocks[j].text, caret), true);
    await this.replay(o, steps);
  }
  /** What he typed while a note was opening (editAfterSave), into it now: the words at the caret, and
   *  each step (Enter, Tab…) done by the editor as if pressed there. */
  async replay(o, steps) {
    for (const [k, st] of steps.entries()) {
      const ta = o.ta;
      if (!ta) { // (after Esc there's no box any more: keep what didn't go in)
        await this.keepTyped(o, steps.slice(k).map((x) => [x.text, x.paste?.text].filter(Boolean).join(' ')).join(' ').trim(), 'What you typed after Esc');
        return;
      }
      if (st.text) o.insertAtCaret(st.text);
      if (st.paste) { // as a paste into the box (the editor's own paste does what it does with it; plain words go in here)
        const dt = new DataTransfer();
        if (st.paste.text) dt.setData('text/plain', st.paste.text);
        for (const f of st.paste.files) dt.items.add(f);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        o.ta.dispatchEvent(ev);
        if (!ev.defaultPrevented && st.paste.text && o.ta) o.insertAtCaret(st.paste.text);
      }
      if (!st.key || !o.ta) continue;
      // Backspace / Delete inside the words: done here (a key sent from a script doesn't delete), a whole
      // letter at a time (an emoji is two characters to JavaScript); at either end the editor joins notes
      const box = o.ta, a = box.selectionStart, z = box.selectionEnd, v = box.value;
      const letters = (t) => [...new Intl.Segmenter().segment(t)];
      if (st.key === 'Backspace' && z > 0) { o.snap(); box.setRangeText('', z > a ? a : letters(v.slice(0, a)).pop().index, z, 'end'); o.typed(); continue; }
      if (st.key === 'Delete' && (z > a || z < v.length)) { o.snap(); box.setRangeText('', a, z > a ? z : z + letters(v.slice(z))[0].segment.length, 'end'); o.typed(); continue; }
      box.dispatchEvent(new KeyboardEvent('keydown', { key: st.key, shiftKey: st.shiftKey, ctrlKey: st.ctrlKey, metaKey: st.metaKey, altKey: st.altKey, bubbles: true, cancelable: true }));
    }
  }
  /** file: what the file holds now (Outline.save), for the other side to catch up with. */
  saved(outline, file = null) {
    window.LeanAndroid?.refreshWidget?.();
    this.refCache?.clear(); // (block references show the newest words when drawn again)
    const key = outline.name.toLowerCase();
    const isNew = !this.names.some((n) => n.exists && n.name.toLowerCase() === key);
    // a page icon (icon::) added, changed or removed shows next to its name everywhere straight away
    const iconAt = (t) => (t || '').match(/(?:^|\n)\s*icon::[ \t]*(.*)/i)?.[1].trim() ?? '';
    const icon = iconAt(outline.doc?.preamble) || iconAt(outline.doc?.blocks?.[0]?.text);
    if (isNew || icon !== (this.icons?.get(key) ?? '')) this.refreshNames();
    this.widgetTasksSoon();
    outline.behind = false; // (its save took in what the file had)
    this.sparkSaved(outline);
    // the same page open on the other side shows what was just saved
    for (const o of this.outlines) if (o !== outline && sameFile(o, outline)) { o.behind = true; this.catchUp(o, file); }
  }
  /** Saved: a tiny spark by the page's title (a journal day's date) fades in and out (app.css
   *  .saved-mark). One element, moved to the title of the page just saved; it takes no room (no line
   *  moves), nothing per note. */
  sparkSaved(o) {
    const title = o.host?.closest?.('.sheet')?.querySelector('.page-title');
    if (!title) return;
    const m = this.savedMark ??= h('i', 'saved-mark');
    m.setAttribute('aria-hidden', 'true');
    m.classList.remove('on');
    if (m.parentNode !== title) title.append(m);
    void m.offsetWidth; // (start the fade again)
    m.classList.add('on');
  }
  /** Outline o is behind: the same page was saved from the other side (file: what it holds now, if
   *  known). It shows that now, keeping its reading place: one note changed, in place
   *  (Outline.takeSaved), else read again (notes selected there were picked in the older version:
   *  let go). A note open for editing with nothing typed opens again on the newer words
   *  (Outline.refresh). Not with typing of its own to save (that save takes the change in, as with
   *  changes made elsewhere), nor while it waits to open a note (editAfterSave reads it), nor during a
   *  clash; editing() tries again when its editing stops. */
  catchUp(o, file = null) {
    if (!o.behind || o.waiting || o.dirty || o.saving || o.conflict || !this.outlines.includes(o)) return;
    if (o.cur !== null) { o.refresh().catch(() => {}); return; }
    const at = this.readingPlace(o);
    if (o.takeSaved(file)) { this.backToPlace(o, at); return; }
    o.clearSel();
    o.reload().then((done) => { if (done) this.backToPlace(o, at); }, () => {});
  }
  /** The note at the top of outline o's side (wide windows: the side scrolls itself), to keep it
   *  there while o is drawn again: a note of o (found again by its words afterwards) or another. */
  readingPlace(o) {
    const p = this.paneOf(o.el);
    if (!p?.el.offsetParent || getComputedStyle(p.el).overflowY === 'visible') return null;
    const r = p.el.getBoundingClientRect();
    let blk = null;
    for (let y = r.top + 12; !blk && y < r.top + 240; y += 24) { // (below any pinned parents)
      const b = document.elementFromPoint(r.left + r.width / 2, y)?.closest('.blk');
      if (b && p.el.contains(b) && !b.closest('.pins')) blk = b;
    }
    if (!blk) return null;
    const off = blk.getBoundingClientRect().top - r.top;
    return o.el.contains(blk) ? { p, before: o.shape(), k: +blk.dataset.i, off } : { p, el: blk, off };
  }
  backToPlace(o, at) {
    if (!at || !at.p.el.isConnected) return;
    let el = at.el;
    if (!el) {
      const j = findAgain(at.before, at.k, o.blocks);
      if (j === null) return;
      o.ensureDrawn(j);
      el = o.blockDiv(j);
    }
    if (!el?.isConnected) return;
    const r = at.p.el.getBoundingClientRect();
    const z = (at.p.el.offsetWidth ? r.width / at.p.el.offsetWidth : 1) || 1; // (the text size zooms the side)
    at.p.el.scrollTop += (el.getBoundingClientRect().top - r.top - at.off) / z;
  }
  /** A zoomed-in note moved in its file (notes added above it): its tab's place says its new line. */
  zoomMoved(o) { this.tabs.replace(o.el, `#/zoom/${encodeURIComponent(o.name)}/${o.zoomLine}`); }
  recent() { return store.get('recent', []); }
  pushRecent(name) {
    const r = [name, ...this.recent().filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 10);
    store.set('recent', r);
    this.renderSideLists();
  }

  async refreshNames() {
    try { this.names = await call('pages'); } catch { /* vault not open */ }
    // pages with an icon:: (an emoji shown before their name everywhere)
    this.icons = new Map(this.names.filter((n) => n.icon).map((n) => [n.name.toLowerCase(), n.icon]));
    this.renderSideLists();
    this.tabs.paint(); // the tabs' names and icons
  }
  /** A page's icon (its icon:: emoji), ready to put before its name; '' without one. */
  icon(name) {
    const i = this.icons?.get(String(name).toLowerCase());
    return i ? `<span class="pg-ic" aria-hidden="true">${esc(i)}</span>` : '';
  }

  /** Does this key event trigger a Logseq action (single key combinations only)? */
  keyIs(e, action) {
    const ev = evChord(e);
    return (this.keyMap[action] || []).some((k) => !k.includes(' ') && same(parseChord(k), ev));
  }

  // ----- routing -----
  // The address (#/page/…) is the active pane's place; each tab has its own back/forward (tabs.js).
  go(kind, arg, opts = {}) {
    let hash = '#/' + kind + (arg !== undefined && arg !== null ? '/' + encodeURIComponent(arg) : '');
    if (kind === 'zoom') hash += '/' + (opts.line ?? 0);
    const how = this.tabs.how; // a Ctrl/Shift/middle click: a new tab, or the other side
    if (how) { this.tabs.how = null; this.tabs.open(hash, how, kind === 'zoom' ? null : opts.line ?? null); return; }
    this.pendingLine = opts.line ?? null;
    if (location.hash === hash) this.route();
    else location.hash = hash;
  }
  back() { return this.tabs.move(-1); }
  forward() { return this.tabs.move(1); }

  // ----- Undo and Redo across a page's outlines -----
  // Each outline keeps its own steps (a page has one; the Journals list one per day), and this list
  // says which outline each step was made in, newest last: Undo and Redo (the keys, the phone bar)
  // go back through the page's changes in the order they were made, whichever day they were in.
  // from: the outline asking; its own Undo when none is listed (it says if there's nothing).
  stepped(o) { this.steps.push(o); if (this.steps.length > 600) this.steps.splice(0, 100); this.redoSteps = []; }
  /** Outline o undid its newest step itself (a message's Undo button, find's replace): its entry goes too. */
  unstep(o) { const k = this.steps.lastIndexOf(o); if (k >= 0) { this.steps.splice(k, 1); this.redoSteps.push(o); } }
  undo(from) { this.step(this.steps, this.redoSteps, (o) => o.undoStack.length, (o) => o.undo() === true, from); }
  redo(from) { this.step(this.redoSteps, this.steps, (o) => o.redoStack.length, (o) => o.redo() === true, from); }
  step(list, other, has, act, from) {
    const here = this.pane.outlines, live = this.outlines;
    for (let k = list.length - 1; k >= 0; k--) {
      const o = list[k];
      if (!live.includes(o)) { list.splice(k, 1); continue; } // its page is no longer open
      // (a change in a day folded since: the day opens, so he sees what's undone;
      //  true: a step made in two pages at once, moving notes: its link keeps this list itself, move.js)
      if (here.includes(o) && has(o)) { this.unfoldFor(o); if (!act(o)) { list.splice(k, 1); other.push(o); } return; }
    }
    const o = here.includes(from) && this.shows(from) ? from : this.mainOutline();
    if (o) act(o);
  }

  // the back and forward arrows (laptop strip and phone bar): greyed out when there is nowhere to go.
  // The strip's are each side's own; the phone bar's, the active side's.
  updateHistBar() {
    const T = this.tabs;
    document.querySelectorAll('[data-h="back"], [data-h="forward"]').forEach((b) => {
      const nav = b.closest('.hb-nav'), p = nav ? T.panes[+nav.dataset.p] : T.pane, t = p?.tabs[p.cur];
      b.disabled = b.dataset.h === 'back' ? !(t?.at > 0) : !(t && t.at < t.hist.length - 1);
    });
    this.updateHome();
  }
  /** Home greys out, like the arrows, where it would do nothing: on the Journals list, already at the
   *  top (today). It stays in its place, so the buttons beside it never move. Also while scrolling. */
  updateHome() {
    const T = this.tabs;
    document.querySelectorAll('[data-a="home"]').forEach((b) => {
      const nav = b.closest('.hb-nav'), p = nav ? T.panes[+nav.dataset.p] : T.pane, t = p?.tabs[p.cur];
      const narrow = p && getComputedStyle(p.el).overflowY === 'visible'; // (the whole page scrolls)
      const top = p ? (narrow ? scrollY : p.el.scrollTop) : 0;
      b.disabled = !!t && parsePlace(placeOf(t)).kind === 'journals' && top < 40;
    });
  }

  /** The address changed, or the browser stepped back or forward: the active pane follows. force:
   *  draw it even if it shows that place already (a link to the page that's open). */
  route(force = true) {
    const T = this.tabs;
    if (!T.ready) return; // still starting: start() draws what the address says
    const p = T.pane;
    T.fromAddress();
    T.paint();
    this.here();
    if (!force && !T.moved(p)) return;
    p.line = this.pendingLine;
    this.pendingLine = null;
    return this.draw(p);
  }

  /** A page whose changes clash with changes made elsewhere can't be left until he chooses which to
   *  keep: true (and the reason shown) if pane p has one. */
  stuckIn(p) {
    const o = p.outlines.find((x) => x.conflict);
    if (o) { o.banner.scrollIntoView({ block: 'center' }); this.toast('First choose which version of this page to keep.', 4500); }
    return !!o;
  }

  /** Draw pane p's place (its shown tab's), after saving what it showed. opts.restore: scroll back to
   *  where the tab was (starting); a tab shown again does that by itself. */
  async draw(p, opts = {}) {
    const T = this.tabs;
    // Moving quickly (Back twice, two clicks) starts a new draw while an earlier one still waits
    // for saving or reading: only the newest goes on, so pages never mix (see also pageView).
    const seq = p.seq = (p.seq ?? 0) + 1;
    const active = p === T.pane;
    if (active) {
      document.body.classList.remove('drawer');
      this.ac.close();
      this.closeLooks?.();
      this.find.close();
      this.find.undo = null; // a replace's Undo belongs to the page it was made on
      this.preview.hide();
    }
    // (typing on the other side not saved yet is saved now too: the page drawn here may be that one,
    // and it must show it, or editing it here would clash with his own words)
    const others = this.outlines.filter((o) => !p.outlines.includes(o) && (o.dirty || o.saving));
    await Promise.all([...p.outlines.map((o) => { o.stopEdit(); return o.flush(); }), ...others.map((o) => o.flush())]);
    if (seq !== p.seq) return;
    // a page with a clash stays until the user chooses: the pane goes back to it. Also when the same
    // place is opened again (Home on the Journals list): redrawing would drop the choice.
    if (this.stuckIn(p)) { T.undo(p); return; }
    // couldn't save (e.g. the file is offline): keep a copy of the typing before leaving
    for (const o of p.outlines) {
      if (!o.dirty || o.readonly) continue;
      await this.keepCopy(o);
      if (seq !== p.seq) return;
    }
    const t = T.tab(p);
    const left = p.drawn?.t; // the tab it showed until now keeps how far down it was
    if (left && left !== t && p.restoring !== left && getComputedStyle(p.el).overflowY !== 'visible') left.top = Math.round(p.el.scrollTop);
    const restore = opts.restore || (left && left !== t);
    T.drew(p);
    if (p.outlines.includes(this.active)) this.active = null;
    p.outlines = [];
    this.updateToolbar();
    const { kind, arg, line: zoomLine } = parsePlace(placeOf(t));
    const line = p.line ?? null;
    p.line = null;
    p.obs?.disconnect(); // the journals' "load older days" watcher belongs to the old view
    p.obs = p.watch = p.anchor = null;
    const view = h('div', 'view');
    view.dataset.kind = kind; // (wide mode leaves Settings at its reading width)
    p.el.replaceChildren(view);
    if (active) window.scrollTo(0, 0); // phones and narrow windows scroll the whole page,
    p.el.scrollTop = 0; // wide windows just the pane under the top strip
    // (no notes folder: the welcome screen until one was ever chosen, else Settings, to choose again)
    if (active) document.documentElement.classList.toggle('welcome', kind === 'welcome');
    if (!this.vaultOpen && kind !== 'settings' && kind !== 'welcome') { if (active) this.go(store.get('vault', '') ? 'settings' : 'welcome'); return; }
    try {
      if (kind === 'journals') await this.journalsView(view);
      else if (kind === 'page' || kind === 'zoom') await this.pageView(view, arg, zoomLine, line);
      else if (kind === 'pages') await pagesView(this, view);
      else if (kind === 'tags') await tagsView(this, view);
      else if (kind === 'props') await propsView(this, view, arg);
      else if (kind === 'todos') await todosView(this, view);
      else if (kind === 'settings') await settingsView(this, view, arg);
      else if (kind === 'welcome') (await import('./welcome.js')).welcomeView(this, view); // (loaded only when it shows)
      else await this.journalsView(view);
    } catch (e) {
      view.append(h('p', 'err', esc('Something went wrong: ' + e)));
      call('log', { msg: `view ${kind}: ${e?.stack || e}` }).catch(() => {});
    }
    if (restore && seq === p.seq) T.scrollBack(p, t);
    if (seq === p.seq) this.unsplash();
  }

  /** The start-up drawing (index.html #splash) fades once the first page is drawn: only ever once. */
  unsplash() {
    const s = document.getElementById('splash');
    if (!s || s.classList.contains('done')) return;
    s.classList.add('done');
    setTimeout(() => s.remove(), 300);
    this.barsLater?.(); // (the phone's bars: from the drawing's cream to the look's colour)
    this.barsLater = null;
  }

  // ----- views -----
  async journalsView(view) {
    if (this.noAccess) view.append(accessCard('Your notes can’t be read yet'));
    // (Go to date: the calendar button in the top strip / phone bar, or g d)
    const list = h('div');
    view.append(list);
    const more = h('button', 'btn ghost more', 'Show older days');
    view.append(more);
    let end = today();
    let first = true;
    let loading = false;
    // Each step waits for the notes; if another page was opened meanwhile (this list is no longer on
    // screen), stop: the days must not join the new page's outlines (its undo, "t o", saving…).
    const loadBatch = async () => {
      if (loading || more.hidden || !more.isConnected) return;
      loading = true;
      more.disabled = true;
      let days = [];
      try {
        days = await call('journals', { end, count: 5, include_end: first });
        const shown = [];
        for (const d of days) {
          if (!list.isConnected) return;
          const sec = await this.daySheet(list, d);
          if (sec) shown.push([d.name, sec.querySelector('.day-refs')]);
        }
        this.addUnlinked(shown, true); // not waited for: the days show first
      } finally {
        loading = false;
        more.disabled = false;
      }
      if (!list.isConnected) return;
      first = false;
      if (days.length) {
        const last = dateOf(days[days.length - 1].date);
        last.setDate(last.getDate() - 1);
        end = ymd(last);
      }
      more.hidden = days.length < 5;
      // still near the bottom (a tall window, or short days)? keep going
      if (!more.hidden && more.getBoundingClientRect().top < innerHeight + 800) setTimeout(loadBatch, 0);
    };
    more.onclick = loadBatch;
    const pane = this.paneOf(view);
    await loadBatch();
    if (!more.isConnected || !pane) return; // moved on to another page meanwhile
    // scrolling near the end loads older days by itself (the button stays, just in case).
    // What scrolls: the pane in a wide window, the whole page in a narrow one (redone when that
    // changes, or when the pane moves to the other side).
    const watch = () => {
      pane.obs?.disconnect();
      const box = view.parentElement;
      if (!box || !more.isConnected) return;
      const root = getComputedStyle(box).overflowY === 'visible' ? null : box;
      pane.obs = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) loadBatch(); }, { root, rootMargin: '0px 0px 800px 0px' });
      pane.obs.observe(more);
    };
    pane.watch = watch;
    watch();
  }

  /** One day in the Journals list: its notes, then (today) the to-dos that are due, then the
   *  references to it from other pages: linked ones, and unlinked ones folded (addUnlinked adds
   *  those, for the days that have some). Returns the day's sheet. Its spacing (roomy, at least
   *  a set height even when empty): app.css `.sheet.day`. */
  async daySheet(list, day) {
    const sec = h('section', 'sheet day');
    const isToday = day.date.join() === today().join();
    if (isToday) sec.classList.add('today');
    const dt = dateOf(day.date);
    // a day folds away from its date (the arrow left of it on a laptop, on hover; at the right of the
    // weekday on phones), as in Logseq: only its date stays. Remembered while the app is open.
    const folded = dayFolds().has(day.name.toLowerCase());
    sec.classList.toggle('folded', folded);
    sec.innerHTML = `<div class="day-head"><button type="button" class="day-fold" aria-expanded="${!folded}" aria-label="${folded ? 'Unfold' : 'Fold'} ${esc(day.name)}" title="${folded ? 'Unfold' : 'Fold'} this day"></button><p class="weekday">${WEEKDAYS[dt.getDay()]}</p><h2 class="page-title">${pageLink(day.name)}</h2></div>`;
    sec.querySelector('a').onclick = (e) => { e.preventDefault(); this.go('page', day.name); };
    sec.dataset.day = day.name; // (unfoldFor)
    sec.querySelector('.day-fold').onclick = () => this.foldDay(sec, day.name);
    const body = h('div', 'day-body');
    const sched = h('div', 'day-sched');
    const refs = h('div', 'day-refs');
    refs.addEventListener('click', (e) => this.linkClick(e));
    sec.append(body, sched, refs);
    list.append(sec);
    const pv = await call('page', { name: day.name, today: today(), time: nowTime() });
    const pane = list.isConnected && this.paneOf(list);
    if (!pane) return null; // another page opened meanwhile (see journalsView)
    const o = new Outline(body, pv, this);
    pane.outlines.push(o);
    // a day with no notes yet (often one only other pages link to): its empty first note ("Click to
    // write…") with a roomy empty area under it that a click or tap also opens, so it's plain at a
    // glance that nothing is written there, and easy to start (he asked, Oct 27; app.css .day-body.blank)
    if (!o.readonly && o.blocks.length === 1 && !o.blocks[0].text.trim()) {
      body.classList.add('blank');
      body.addEventListener('click', (e) => { if (e.target === body || e.target === o.el) o.edit(o.end - 1); });
    }
    if (isToday) this.scheduledBox(sched, day.name);
    if (pv.refs.length) refs.append(this.dayLinked(pv.refs, day.name));
    return sec;
  }
  /** Fold a day in the Journals list away to its date, or open it again (its sheet, its name). The
   *  note being typed in there stops first. Remembered for this session (sessionStorage). */
  foldDay(sec, name) {
    const shut = !sec.classList.contains('folded');
    const pane = this.paneOf(sec);
    for (const o of pane?.outlines ?? []) {
      if (!shut || !sec.contains(o.el)) continue;
      o.stopEdit();
      o.clearSel();
      if (this.active === o) { this.active = null; this.updateToolbar(); } // (keys never act on a day that's folded)
    }
    sec.classList.toggle('folded', shut);
    const b = sec.querySelector('.day-fold');
    b.setAttribute('aria-expanded', String(!shut));
    b.setAttribute('aria-label', `${shut ? 'Unfold' : 'Fold'} ${name}`);
    b.title = `${shut ? 'Unfold' : 'Fold'} this day`;
    const all = dayFolds();
    if (shut) all.add(name.toLowerCase()); else all.delete(name.toLowerCase());
    session.set('dayFolds', [...all]);
    this.pinSoon();
  }

  /** Does outline o show, to be acted on: not inside a day folded in the Journals list? */
  shows(o) { return !!o && !o.el.closest('.sheet.day.folded'); }
  /** The outline that keys and commands which don't name one act on (Ctrl+A, t o): the one last used if
   *  it shows, else the active side's first that shows. Never one in a folded day: its notes can't be
   *  seen, so they're never selected, deleted or folded unseen. */
  mainOutline() {
    const here = this.pane.outlines.filter((o) => this.shows(o));
    return here.includes(this.active) ? this.active : here[0] ?? null;
  }
  /** Opens the folded day holding outline o, before something changes its notes where he can see it
   *  (Undo/Redo going back to a change there, the phone's "+", find going to a match there). */
  unfoldFor(o) {
    const sec = o?.el.closest('.sheet.day.folded');
    if (sec) this.foldDay(sec, sec.dataset.day ?? '');
  }

  /** "Linked references" under a day in the Journals list (only shown when there are some). */
  dayLinked(groups, day) {
    const sec = h('section', 'sec');
    const n = groups.reduce((s, g) => s + g.hits.length, 0);
    sec.innerHTML = `<h3 class="sec-h"><button class="disclose" aria-expanded="true">Linked references</button> <span class="n">${n}</span></h3>`;
    foldableRefs(sec, day);
    const MAX = 6; // a day linked from very many pages: the first few, then a button for the rest
    const fill = (gs, mark) => {
      gs = this.sortRefs(gs, day);
      const list = h('div', 'refs-list'), part = (x) => { const el = this.groupsEl(x, { tree: true, host: day }); mark?.(el); return el; };
      list.append(part(gs.slice(0, MAX)));
      if (gs.length > MAX) {
        const more = h('button', 'btn ghost small', `Show ${gs.length - MAX} more page${gs.length - MAX === 1 ? '' : 's'}`);
        more.onclick = () => more.replaceWith(part(gs.slice(MAX)));
        list.append(more);
      }
      sec.append(list);
    };
    this.refTools(sec, groups, day, fill); // (the same tools as a page's, kept per day)
    fill(groups);
    return sec;
  }

  /** Which of these pages are mentioned somewhere as plain text (not linked)? One look through the
   *  notes for all of them (unlinked_any), after they show; those get a folded "Unlinked references"
   *  at the end of their host (filled when opened), if it's still on screen. items: [[name, host]];
   *  day: the short form, under a day in the Journals list. */
  async addUnlinked(items, day = false) {
    if (!items.length) return;
    let any;
    try { any = await call('unlinked_any', { names: items.map(([name]) => name) }); } catch { return; }
    items.forEach(([name, host], k) => { if (any?.[k] && host?.isConnected) host.append(this.unlinkedSection(name, day)); });
  }

  /** Today's "Scheduled & deadline": to-dos from all pages that are overdue (folded), due today or
   *  coming up in the next days (config.edn :scheduled/future-days, 7 by default), like Logseq.
   *  Hidden when there are none; the box and the overdue part remember being folded. */
  async scheduledBox(host, todayName) {
    let tasks;
    try { tasks = await call('tasks', { done: false }); } catch { return; }
    if (!host.isConnected) return;
    const t = num(today());
    const ahead = this.summary?.config?.future_days ?? 7;
    const groups = [['overdue', 'Overdue', []], ['today', 'Today', []], ['soon', ahead === 1 ? 'Tomorrow' : `Next ${ahead} days`, []]];
    for (const x of tasks) {
      const w = taskDay(x);
      // ones written in today's journal are right above
      if (!Number.isFinite(w) || w > t + ahead || x.page.toLowerCase() === todayName.toLowerCase()) continue;
      groups[w < t ? 0 : w === t ? 1 : 2][2].push(x);
    }
    for (const [, , g] of groups) g.sort(byDay);
    const total = groups.reduce((s, [, , g]) => s + g.length, 0);
    if (!total) { host.replaceChildren(); return; }
    const folds = store.get('schedFolds', { box: false, overdue: true });
    const box = h('section', 'sched');
    box.innerHTML = `<h3 class="sched-h"><button class="disclose" data-f="box" aria-expanded="${!folds.box}">Scheduled &amp; deadline</button> <span class="n">${total}</span></h3>
      <div class="sched-body"${folds.box ? ' hidden' : ''}>${groups.filter(([, , g]) => g.length).map(([k, label, g]) => `<div class="sched-grp" data-g="${k}">
        ${k === 'overdue' ? `<h4><button class="disclose" data-f="overdue" aria-expanded="${!folds.overdue}">${label}</button> <span class="n">${g.length}</span></h4>`
          : `<h4>${label} <span class="n">${g.length}</span></h4>`}
        <div class="sched-list"${k === 'overdue' && folds.overdue ? ' hidden' : ''}>${g.map(taskRow).join('')}</div></div>`).join('')}</div>`;
    box.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]');
      if (!f) return;
      const open = f.getAttribute('aria-expanded') !== 'true';
      f.setAttribute('aria-expanded', String(open));
      (f.dataset.f === 'box' ? box.querySelector('.sched-body') : f.closest('.sched-grp').querySelector('.sched-list')).hidden = !open;
      store.set('schedFolds', { ...store.get('schedFolds', { box: false, overdue: true }), [f.dataset.f]: !open });
    });
    taskClicks(this, box, () => tasks, () => this.scheduledBox(host, todayName));
    host.replaceChildren(box);
  }

  /** The calendar to jump to a day. anchorEl: what it opens next to (the button pressed, or for
   *  g d the active side's date button, else the page). */
  async goToDate(anchorEl) {
    if (!this.vaultOpen) { this.toast('First choose your notes folder (Settings).', 3500); return; }
    // pressed again while open: that press closed it, so this click doesn't open it again (he asked)
    if (Date.now() - Number(anchorEl.dataset?.closedAt || 0) < 600) { delete anchorEl.dataset.closedAt; return; }
    const button = anchorEl.closest?.('button') || null;
    const marks = call('journal_days').then((ds) => new Set(ds.map(keyOf))).catch(() => null);
    const pick = await pickDate(anchorEl.getBoundingClientRect(), { title: 'Go to a day', marks, note: 'Dots mark days with notes.', button });
    if (!pick) return;
    try { this.go('page', await call('journal_name', { date: pick.date })); } catch (e) { this.toast(`That day can’t be opened: ${e}`, 5000); }
  }

  /** A page (or one of its notes, zoomed in). line: a note to show (coming from a reference). */
  async pageView(view, name, zoomLine = null, line = null) {
    const pv = await call('page', { name, today: today(), time: nowTime() });
    const pane = view.isConnected && this.paneOf(view);
    if (!pane) return; // moved on to another page while this one was read (see draw)
    this.pushRecent(pv.info.name);
    const head = h('div', 'page-head');
    if (pv.info.journal) { // a journal day: the weekday above the date, as in the Journals list
      head.classList.add('day-head');
      head.append(h('p', 'weekday', WEEKDAYS[dateOf(pv.info.journal).getDay()]));
    }
    // namespace parents: "APRON/Spice jars" shows "APRON /" above the title
    const parts = pv.info.name.split('/');
    const ns = parts.length > 1 && !pv.info.journal && parts.every((p) => p.trim());
    if (ns) head.append(h('p', 'ns-path', parts.slice(0, -1).map((p, k) => pageLink(parts.slice(0, k + 1).join('/'), p)).join(' / ') + ' /'));
    const titleRow = h('div', 'title-row');
    const fav = (this.summary?.config?.favorites || []).some((f) => f.toLowerCase() === pv.info.name.toLowerCase());
    const pic = (pv.info.props || []).find(([k]) => k === 'icon')?.[1]?.trim();
    const picHtml = pic && [...pic].length <= 8 ? `<span class="pg-ic" aria-hidden="true">${esc(pic)}</span>` : '';
    titleRow.innerHTML = `<h1 class="page-title">${picHtml}<span class="pt-name">${esc(ns ? parts[parts.length - 1] : pv.info.name)}</span></h1>
      <button class="icon-btn fav${fav ? ' on' : ''}" data-a="fav" data-name="${esc(pv.info.name)}" aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}" title="Favourite">${ICON.fav}</button>
      <button class="icon-btn" data-a="more" aria-label="Page actions" title="More">${ICON.more}</button>`;
    // page properties go right under the title (none: nothing; the ⋯ menu's "Add properties")
    const propsBox = h('div', 'page-props');
    head.append(titleRow, propsBox);
    // the title is on the page's sheet, with its notes (as a day's date is in the Journals list)
    const sheet = h('div', 'sheet page');
    const body = h('div');
    sheet.append(head, body);
    view.append(sheet);
    const outline = new Outline(body, pv, this, { zoomLine });
    pane.outlines.push(outline);
    this.renderPageProps(propsBox, outline, pv.info.props);
    // (the properties as the file has them now, after an earlier version was put back: history.js)
    outline.refreshHead = () => this.freshProps(propsBox, outline, pv.info.props);
    $('[data-a="fav"]', titleRow).onclick = () => this.toggleFavourite(pv.info.name);
    $('[data-a="more"]', titleRow).onclick = (e) => this.pageMenu(e.currentTarget, pv, propsBox, outline);
    // a click (a tap on a phone) on the title renames the page, as in Logseq; not a journal day's
    // (named by its date), nor a page that can't be changed here
    if (!pv.info.journal && !outline.readonly && !pv.error) {
      const h1 = $('h1', titleRow);
      h1.classList.add('renamable');
      h1.onclick = (e) => this.editTitle($('.pt-name', h1), pv, ns ? parts.slice(0, -1).join('/') + '/' : '', e);
    }

    // pages inside this namespace
    const key = pv.info.name.toLowerCase() + '/';
    const kids = this.names.filter((n) => n.name.toLowerCase().startsWith(key) && (n.exists || n.refs));
    if (kids.length && zoomLine === null) {
      const sec = h('section', 'sec');
      sec.innerHTML = `<h2 class="sec-h">Pages in ${esc(pv.info.name)} <span class="n">${kids.length}</span></h2>
        <ul class="tree">${kids.map((n) => { const rest = n.name.slice(key.length); const depth = rest.split('/').length - 1; return `<li style="--d:${depth}">${pageLink(n.name, rest.split('/').pop())}</li>`; }).join('')}</ul>`;
      view.append(sec);
    }
    if (pv.tagged.length) {
      const sec = h('section', 'sec');
      sec.innerHTML = `<h2 class="sec-h">Pages tagged with ${esc(pv.info.name)} <span class="n">${pv.tagged.length}</span></h2>
        <div class="tagged">${pv.tagged.map((n) => `<a class="tag" href="#" data-page="${esc(n)}">${esc(n)}</a>`).join('')}</div>`;
      view.append(sec);
    }
    // references to it: each section only when there are some (as under a day in the Journals list)
    if (pv.refs.length) {
      const refs = h('section', 'sec');
      const count = pv.refs.reduce((s, g) => s + g.hits.length, 0);
      refs.innerHTML = `<h2 class="sec-h"><button class="disclose" aria-expanded="true">Linked references</button> <span class="n">${count} in ${pv.refs.length} page${pv.refs.length === 1 ? '' : 's'}</span></h2>`;
      foldableRefs(refs, pv.info.name);
      view.append(refs);
      const name = pv.info.name;
      const fill = (gs, mark) => this.fillRefs(refs, this.sortRefs(gs, name), name, mark); // (after the page's own notes show, a little at a time)
      this.refTools(refs, pv.refs, name, fill); // filter, sort, fold all (more than one page)
      fill(pv.refs);
    }
    view.addEventListener('click', (e) => this.linkClick(e));
    if (line !== null && zoomLine === null) {
      const i = outline.indexForLine(line);
      requestAnimationFrame(() => outline.flash(i));
    }
    this.addUnlinked([[pv.info.name, view]]); // not waited for: the page shows first
  }

  /** "Unlinked references": found only when opened (it reads every note). day: the short form
   *  under a day in the Journals list. */
  unlinkedSection(name, day = false) {
    const sec = h('section', 'sec unlinked');
    sec.innerHTML = day ? '<h3 class="sec-h"><button class="disclose" aria-expanded="false">Unlinked references</button></h3><div class="body"></div>'
      : '<h2 class="sec-h"><button class="disclose" aria-expanded="false">Unlinked references</button> <span class="n">mentions of this page’s name that aren’t links yet</span></h2><div class="body"></div>';
    const btn = $('.disclose', sec);
    const body = $('.body', sec);
    btn.onclick = async () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      if (open) { body.replaceChildren(); return; }
      body.innerHTML = BRAND.wait('Looking through your notes…');
      let res;
      try { res = await call('unlinked', { name }); } catch (e) { body.innerHTML = `<p class="err">${esc(e)}</p>`; return; }
      const n = res.groups.reduce((s, g) => s + g.hits.length, 0);
      body.replaceChildren(h('p', 'note', n ? `${n} mention${n === 1 ? '' : 's'} in ${res.groups.length} page${res.groups.length === 1 ? '' : 's'}${res.more ? ' (showing the first 300)' : ''}. <b>Link</b> turns a mention into a link.` : 'No unlinked mentions.'),
        this.groupsEl(res.groups, { link: name, host: name }));
    };
    return sec;
  }

  /** Page properties as the backend read them (Logseq `key::` lines or a YAML header), under the
   *  title; a click on them edits them. A page without any shows nothing there: the ⋯ menu's "Add
   *  properties" opens the box (box.edit; box.has: are there any). Properties written as the page's
   *  first note, holding only them (Logseq's way), show in that note, not a second time here. */
  renderPageProps(box, outline, props) {
    const all = visibleProps(props || []);
    // none of its own: any come from that first note, shown there (here only when zoomed in on another
    // note), and changed there: the box would write a second set above it, and Logseq would then
    // take that set and drop the note's
    const fromFirst = !outline.doc.preamble.trim() && all.length > 0;
    const shown = !fromFirst || (outline.root !== null && outline.root !== 0) ? all : [];
    const editable = !outline.readonly && !fromFirst;
    box.innerHTML = shown.length ? propsHtml(shown) : '';
    box.title = editable && shown.length ? 'Click to edit page properties' : '';
    box.has = all.length > 0;
    box.onclick = (e) => {
      if (e.target.closest('.pk')) { this.go('props', e.target.closest('.pk').dataset.prop); return; }
      if (!e.target.closest('a')) box.edit?.();
    };
    box.edit = !editable ? null : () => {
      if (box.querySelector('textarea')) return;
      const ta = h('textarea', 'preamble-ed');
      ta.value = outline.doc.preamble.replace(/\r\n/g, '\n').replace(/\n+$/, '');
      ta.placeholder = 'tags:: idea, reading\nalias:: Another name';
      ta.rows = Math.max(2, ta.value.split('\n').length);
      box.replaceChildren(ta);
      // phones: the editing toolbar comes up for it too ([[ ]], #, …; he asked)
      this.textTa = ta;
      ta.addEventListener('focus', () => this.updateToolbar());
      ta.focus();
      this.updateToolbar();
      let snapped = false;
      ta.oninput = () => {
        if (!snapped) { outline.snap(); snapped = true; }
        const v = ta.value.trim();
        const pre = v ? v + '\n\n' : '';
        outline.doc.preamble = outline.doc.crlf ? pre.replace(/\n/g, '\r\n') : pre;
        outline.markDirty();
      };
      ta.onblur = async () => {
        this.textTa = null;
        this.updateToolbar();
        await outline.flush();
        await this.freshProps(box, outline, props);
      };
    };
  }
  /** The phone toolbar on a plain text box (a page's properties): k = the button. */
  textTool(ta, k) {
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    const put = (text, caret = text.length, sel = 0) => {
      ta.setRangeText(text, s, e, 'end');
      ta.setSelectionRange(s + caret, s + caret + sel);
      ta.dispatchEvent(new Event('input'));
    };
    const wrap = (a, z) => put(a + v.slice(s, e) + z, a.length, e - s);
    ({
      newline: () => put('\n'), tag: () => put('#'),
      link: () => (s !== e ? wrap('[[', ']]') : put('[[]]', 2)),
      bold: () => wrap('**', '**'), italic: () => wrap('*', '*'), mark: () => wrap('^^', '^^'),
      done: () => { ta.blur(); this.updateToolbar(); },
    })[k]?.();
  }
  /** Page properties drawn again as the page's file has them now (props: if it can't be read). */
  async freshProps(box, outline, props) {
    let fresh = props;
    try { fresh = (await call('page', { name: outline.name })).info.props; } catch {}
    if (box.isConnected) this.renderPageProps(box, outline, fresh);
  }

  /** Reference groups in the order picked in the tools above those references (refPrefs(host).sort,
   *  per page; a day in the Journals list is its own): 'changed' (the default) = the page whose file
   *  changed last first (g.changed, the app's own file times; else the pages list's), 'name' = pages A
   *  to Z, then journal days, newest first. */
  sortRefs(groups, host = '') {
    const [by, way] = REF_SORTS[refPrefs(host).sort];
    if (by === 'name') { // (days by their date, after the pages: a date's words don't sort; Z to A turns both round)
      const day = (g) => (g.journal ? g.journal[0] * 400 + g.journal[1] * 32 + g.journal[2] : 0);
      return [...groups].sort((a, b) => way * ((!!a.journal - !!b.journal) || (day(b) - day(a)) || a.page.localeCompare(b.page, undefined, { sensitivity: 'base', numeric: true })));
    }
    let t = null; // (only when the answer had no times: the pages list's)
    const at = (g) => g[by] ?? (t ??= new Map((this.names || []).map((x) => [String(x.name).toLowerCase(), x]))).get(g.page.toLowerCase())?.[by] ?? 0;
    return [...groups].sort((a, b) => way * (at(a) - at(b)));
  }
  /** Linked references from two pages or more get tools (he asked, Oct 29: three small buttons at the
   *  right end of the heading, no row of tools): Filter (opens a filter box under the heading, with the
   *  focus; every word typed, found in a note, the notes around it or its page's name; capitals and
   *  accents ignored), Sort (Last changed ↔ Name; its icon shows the order now) and Fold all / Open all
   *  (kept for the session, as each group's own arrow; its icon shows which it does). Filter again, or
   *  Esc in the empty box, closes the box and empties it. Per page (refPrefs): the box open or not, and
   *  the sort; never the words typed. fill(groups, mark) draws the list (a `.refs-list` in sec,
   *  replaced on each change; mark lights the words in what it draws); host = the page (or day) they
   *  link to. */
  refTools(sec, groups, host, fill) {
    if (groups.length < 2) return;
    const fold = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const texts = new Map(); // (each group's words, worked out the first time a word is typed)
    const textOf = (g) => {
      if (!texts.has(g)) texts.set(g, g.hits.map((x) => fold([g.page, x.text ?? '', ...(x.props || []).flat(), ...(x.parents || []).map((p) => p.text), ...(x.kids || []).map((k) => k.text)].join('\n'))));
      return texts.get(g);
    };
    const head = sec.querySelector('.sec-h'), count = head.querySelector('.n'), said = count.textContent;
    // the heading's words (and count) on the left, wrapping there if they must; the buttons at the right end
    const words0 = h('span', 'sec-t');
    words0.append(...head.childNodes);
    const acts = h('span', 'ref-acts');
    acts.innerHTML = '<button type="button" class="ref-tbtn ref-f"></button><button type="button" class="ref-tbtn ref-s"></button><button type="button" class="ref-tbtn ref-fa"></button>';
    head.classList.add('has-acts');
    head.append(words0, acts);
    const [btn, sortBtn, all] = acts.children;
    btn.innerHTML = ICON.filter;
    const bar = h('div', 'ref-tools');
    bar.innerHTML = `<label class="ref-find">${ICON.search}<input type="search" class="ref-filter" placeholder="Filter references" aria-label="Filter references" enterkeyhint="search" autocomplete="off" spellcheck="false"></label>`
      + '<div class="ref-chips" role="group" aria-label="Pages these references mention"></div>';
    head.after(bar);
    const input = $('.ref-filter', bar);
    // Logseq's filter buttons (Build 34, the maintainer asked): the pages these references mention (links and
    // tags in a note, its path and sub-notes, and the page it's on), most mentioned first. A click shows
    // only references mentioning it, a second hides those, a third lets it go; several combine. For the
    // session only (Logseq writes its filters into the page; this never writes).
    const hostKey = String(host).toLowerCase();
    const namesOf = new Map(); // a group → each reference's page names (small letters)
    const refNames = (g) => {
      if (!namesOf.has(g)) namesOf.set(g, g.hits.map((x) => new Set([g.page, ...[x.text, ...(x.parents || []).map((p) => p.text), ...(x.kids || []).map((k) => k.text)].flatMap(pagesIn)].map((n) => n.toLowerCase()))));
      return namesOf.get(g);
    };
    const counts = new Map(), shown = new Map(); // small letters → how many references / the name as written first
    for (const g of groups) g.hits.forEach((x, i) => {
      for (const n of refNames(g)[i]) if (n !== hostKey) counts.set(n, (counts.get(n) || 0) + 1);
      for (const n of [g.page, ...pagesIn(x.text)]) if (!shown.has(n.toLowerCase())) shown.set(n.toLowerCase(), n);
    });
    const picks = new Map(); // small letters → 'in' | 'out'
    const chipsEl = $('.ref-chips', bar);
    const CHIPS = 24; // the most mentioned first; "More" shows the rest
    const drawChips = (all = false) => {
      const names = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
      const list = all ? names : names.slice(0, CHIPS);
      chipsEl.innerHTML = list.map((n) => {
        const p = picks.get(n), say = p === 'in' ? 'Only these; click to hide them instead' : p === 'out' ? 'Hidden; click to stop filtering by it' : 'Click to show only these';
        return `<button type="button" class="chip ref-chip" data-n="${esc(n)}"${p ? ` data-pick="${p}"` : ''} aria-pressed="${p ? 'true' : 'false'}" title="${esc(say)}">${p === 'out' ? '<s>' : ''}${esc(shown.get(n) || n)}${p === 'out' ? '</s>' : ''} <span class="n">${counts.get(n)}</span></button>`;
      }).join('') + (!all && names.length > CHIPS ? `<button type="button" class="chip ref-more">${names.length - CHIPS} more</button>` : '');
      chipsEl.hidden = !names.length;
    };
    chipsEl.onclick = (e) => {
      if (e.target.closest('.ref-more')) { drawChips(true); return; }
      const c = e.target.closest('.ref-chip');
      if (!c) return;
      const n = c.dataset.n, p = picks.get(n);
      if (!p) picks.set(n, 'in'); else if (p === 'in') picks.set(n, 'out'); else picks.delete(n);
      drawChips(chipsEl.querySelector('.ref-more') === null && counts.size > CHIPS);
      draw();
    };
    drawChips();
    const keys = () => groups.map((g) => refKey('l', host, g.page));
    const tip = (b, t) => { b.setAttribute('aria-label', t); b.title = t; };
    const paint = () => {
      const { open, sort } = refPrefs(host);
      bar.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      tip(btn, open ? 'Hide the filter' : 'Filter references');
      sortBtn.innerHTML = REF_SORTS[sort][0] === 'name' ? ICON.sortName : ICON.sortChanged;
      sortBtn.dataset.sort = sort;
      tip(sortBtn, `Sorted: ${REF_SORTS[sort][2].toLowerCase()} (click to change)`);
      const f = refFolds(), shut = keys().every((k) => f.has(k));
      all.innerHTML = shut ? ICON.openAll : ICON.foldAll;
      all.dataset.shut = String(shut);
      tip(all, shut ? 'Open all' : 'Fold all');
    };
    // the words typed, lit where they show (a CSS highlight, as find on the page: the notes' own HTML
    // is untouched); none where the browser has no highlights. One name for all: the box typed in last.
    const lit = window.CSS?.highlights && typeof Highlight === 'function' ? new Highlight() : null;
    const draw = () => {
      const old = sec.querySelector(':scope > .refs-list');
      if (old) { this.dropLive(old); old.remove(); }
      sec.querySelector(':scope > .ref-none')?.remove();
      const words = fold(input.value).split(/\s+/).filter(Boolean);
      let gs = groups;
      const ins = [...picks].filter(([, p]) => p === 'in').map(([n]) => n), outs = [...picks].filter(([, p]) => p === 'out').map(([n]) => n);
      if (words.length || picks.size) gs = groups.map((g) => {
        const ts = words.length ? textOf(g) : null, ns = picks.size ? refNames(g) : null;
        return { ...g, hits: g.hits.filter((_, i) => words.every((w) => ts[i].includes(w)) && ins.every((n) => ns[i].has(n)) && !outs.some((n) => ns[i].has(n))) };
      }).filter((g) => g.hits.length);
      const filtering = words.length || picks.size;
      const n = gs.reduce((s, g) => s + g.hits.length, 0), of = groups.reduce((s, g) => s + g.hits.length, 0);
      count.textContent = filtering ? `${n} of ${of} match` : said; // (the heading's count while filtering)
      paint();
      lit?.clear();
      if (lit && words.length) CSS.highlights.set('ref-filter', lit);
      if (!gs.length) { sec.append(h('p', 'note ref-none', words.length ? `No references mention “${esc(input.value.trim())}”.` : 'No references match these pages.')); return; }
      fill(gs, words.length && lit ? (el) => litWords(el, words, lit) : null);
    };
    const set = (change) => setRefPrefs(host, { ...refPrefs(host), ...change });
    const close = () => {
      set({ open: false });
      clearTimeout(timer);
      const had = input.value || picks.size;
      input.value = '';
      picks.clear();
      drawChips();
      if (bar.contains(document.activeElement)) btn.focus({ preventScroll: true });
      if (had) draw(); else paint();
    };
    btn.onclick = () => {
      if (refPrefs(host).open) { close(); return; }
      set({ open: true });
      paint();
      input.focus({ preventScroll: true });
    };
    // Sort: a small menu of the orders, each both ways; the one in use ticked
    sortBtn.onclick = () => {
      const now = refPrefs(host).sort;
      const item = (k, label) => ({ label, hint: k === now ? '✓' : '', run: () => { set({ sort: k }); draw(); } });
      menu(sortBtn, [{ head: 'Last changed' }, item('changed', 'Newest first'), item('changed-old', 'Oldest first'),
        { head: 'Name' }, item('name', 'A to Z'), item('name-za', 'Z to A'),
        { head: 'Date created' }, item('created', 'Newest first'), item('created-old', 'Oldest first')], { cls: 'sort-menu' });
    };
    all.onclick = () => {
      const f = refFolds(), shut = !keys().every((k) => f.has(k));
      for (const k of keys()) if (shut) f.add(k); else f.delete(k);
      session.set('refFolds', [...f]);
      draw();
    };
    let timer;
    input.oninput = () => { clearTimeout(timer); timer = setTimeout(draw, 150); };
    input.onkeydown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (input.value) { input.value = ''; clearTimeout(timer); draw(); } else close(); }
      if (e.key === 'Enter') input.blur(); // (a phone's keyboard goes away, the matches stay)
    };
    // a group's own arrow changes what "Fold all" should do
    sec.addEventListener('click', (e) => { if (e.target.closest('.grp-fold')) setTimeout(paint); });
    paint();
  }

  /** A page's linked references (refTree each), drawn after its own notes have shown and a few at a
   *  time (about 12 ms of work, then the screen gets a turn), so a page that hundreds of notes link
   *  to opens as quickly as any other. Stops if the page is left meanwhile. */
  fillRefs(sec, groups, host = '', mark = null) {
    const wrap = h('div', 'refs-list');
    wrap.addEventListener('click', (e) => this.refClick(e));
    sec.append(wrap);
    // (mark: the filter's words lit in each reference as it's drawn, App.refTools)
    const tree = (x) => { const b = this.refTree(x); mark?.(b); return b; };
    let gi = 0, hi = 0, grp = null; // the group being filled, and its next reference
    const step = () => {
      if (!wrap.isConnected) return;
      const t0 = performance.now();
      while (gi < groups.length && performance.now() - t0 < 12) {
        const g = groups[gi];
        if (!g.hits.length) { gi++; continue; }
        if (!grp) {
          grp = this.refGroup(g, host && refKey('l', host, g.page), (el) => { for (const x of g.hits) el.append(tree(x)); });
          mark?.(grp.firstChild);
          wrap.append(grp);
          if (grp.later) { grp = null; gi++; continue; } // folded: its references wait until it's opened
        }
        grp.append(tree(g.hits[hi++]));
        if (hi >= g.hits.length) { grp = null; gi++; hi = 0; }
      }
      if (gi < groups.length) setTimeout(step, 0);
    };
    requestAnimationFrame(() => setTimeout(step, 0));
  }

  /** A group of references from one page (g.page), headed by its name with an arrow that folds the
   *  page's references away and opens them again, as nested notes fold (foldGroup; kept for this
   *  session under key, if any). Its references are the caller's to add; for a group that starts
   *  folded, draw(grp) is kept to add them when it's opened (grp.later). */
  refGroup(g, key, draw) {
    const grp = h('div', 'refgrp');
    grp.dataset.page = g.page;
    const shut = !!key && refFolds().has(key);
    // a clear heading (he asked, Oct 27): its icon:: emoji, else a small calendar for a journal day (days
    // and pages tell apart at a glance), the name, and how many of its notes are listed
    const ic = this.icon(g.page) || (g.journal ? `<span class="grp-day" aria-hidden="true">${ICON.calendar}</span>` : '');
    const n = g.hits?.length ?? 0;
    grp.innerHTML = `<h3><button type="button" class="grp-fold" aria-expanded="${!shut}" aria-label="${shut ? 'Unfold' : 'Fold'} the references from ${esc(g.page)}"></button>${ic}${pageLink(g.page)}<span class="grp-n">${n} note${n === 1 ? '' : 's'}</span></h3>`;
    grp.foldKey = key || null;
    if (shut) { grp.classList.add('folded'); grp.later = draw; }
    return grp;
  }
  /** The arrow on a reference group's heading (b) folds it, or opens it (drawing what waited). */
  foldGroup(b) {
    const grp = b.closest('.refgrp'), shut = !grp.classList.contains('folded');
    grp.classList.toggle('folded', shut);
    b.setAttribute('aria-expanded', String(!shut));
    b.setAttribute('aria-label', `${shut ? 'Unfold' : 'Fold'} the references from ${grp.dataset.page}`);
    if (!shut && grp.later) { const draw = grp.later; grp.later = null; draw(grp); }
    if (grp.foldKey) {
      const all = refFolds();
      if (shut) all.add(grp.foldKey); else all.delete(grp.foldKey);
      session.set('refFolds', [...all]);
    }
  }

  /** Reference lists. opts.link: page name, adds "Link" buttons (unlinked references). opts.tree:
   *  linked references, each with the notes around it (refTree). */
  groupsEl(groups, opts = {}) {
    const wrap = h('div');
    // (refClick also folds a group; elsewhere only that)
    wrap.addEventListener('click', (e) => { if (opts.tree) this.refClick(e); else if (e.target.closest('.grp-fold')) this.foldGroup(e.target.closest('.grp-fold')); });
    for (const g of groups) {
      const fill = (grp) => {
        for (const hit of g.hits) {
          if (opts.tree) { grp.append(this.refTree(hit)); continue; }
          const row = refRow(hit, opts.link ? '<button class="btn ghost small linkit">Link</button>' : '');
          row.style.setProperty('--d', Math.min(hit.depth, 4));
          row.onclick = async (e) => {
            if (e.target.closest('a')) return;
            if (e.target.matches('input.todo')) { e.preventDefault(); this.tickRef(g.page, hit.line, row.refText, row); return; }
            if (e.target.closest('.linkit')) {
              e.stopPropagation();
              try {
                const res = await call('link_mention', { page: g.page, line: hit.line, base: hit.text, target: opts.link });
                if (res.conflict) { this.toast('That note changed since; open the page to link it there.'); return; }
                row.remove();
                this.toast('Linked', 1200);
                await this.reloadPage(g.page);
              } catch (err) { this.toast(String(err)); }
              return;
            }
            this.go('page', g.page, { line: hit.line });
          };
          grp.append(row);
        }
      };
      const grp = this.refGroup(g, opts.host && refKey(opts.link ? 'u' : 'l', opts.host, g.page), fill);
      if (!grp.later) fill(grp);
      wrap.append(grp);
    }
    return wrap;
  }

  /** A linked reference as Logseq shows it: the notes it sits under as a faint path above it, then
   *  the note (a row as in other reference lists) with its sub-notes under it (.kid, a dot each),
   *  indented as in their page (data-d: levels below the reference). Levels from
   *  :ref/default-open-blocks-level on start folded (1 = the note itself, 2 = its sub-notes), and so
   *  does a note folded in its page; the arrow opens and folds them. Over the 50 sub-notes sent:
   *  "… N more". Clicks: refClick. */
  refTree(hit) {
    const box = h('div', 'refnote');
    if (hit.parents) {
      const path = h('div', 'refpath');
      path.innerHTML = hit.parents.map((p) => `<a href="#" data-line="${p.line}">${esc(firstWords(p.text))}</a>`).join('<span class="sep"> › </span>');
      box.append(path);
    }
    const open = Math.max(1, this.summary?.config?.ref_open_level ?? 2);
    const notes = hit.kids ? [hit, ...hit.kids] : [hit];
    // which notes start folded; rows are made only for notes that show (a folded note's sub-notes
    // when it's opened: a page linked from hundreds of notes stays quick)
    const shut = new Set();
    notes.forEach((n, k) => { if (notes[k + 1]?.depth > n.depth && (n.depth - hit.depth + 1 >= open || foldedIn(n.text))) shut.add(k); });
    box.tree = { hit, notes, shut, rows: new Map() };
    drawRefs(box);
    if (hit.more) {
      const more = h('div', 'refhit kid refmore', `<div class="bc">… ${hit.more} more</div>`);
      more.dataset.d = 1;
      box.append(more);
    }
    return box;
  }

  /** A click in a list of linked references (refTree): a part of the path or a note goes to that
   *  note in its page, "… N more" opens the reference on its own (all its sub-notes), an arrow
   *  folds or opens; a link in the words is linkClick's. */
  refClick(e) {
    const gf = e.target.closest('.grp-fold');
    if (gf) { this.foldGroup(gf); return; }
    const box = e.target.closest('.refnote');
    if (!box) return;
    const page = box.parentElement.dataset.page;
    const at = e.target.closest('.refpath [data-line]');
    if (at) { e.preventDefault(); this.go('page', page, { line: +at.dataset.line }); return; }
    if (box.live) return; // (being edited in place: its outline takes its own clicks)
    if (e.target.closest('a')) return;
    const f = e.target.closest('.fold');
    if (f) {
      const row = f.parentElement, k = +row.dataset.k;
      const shut = row.classList.toggle('collapsed');
      if (shut) box.tree.shut.add(k); else box.tree.shut.delete(k);
      foldSays(f, shut);
      drawRefs(box);
      return;
    }
    const row = e.target.closest('.refhit');
    if (!row) return;
    if (e.target.matches('input.todo')) { e.preventDefault(); this.tickRef(page, +row.dataset.line, row.refText, row); return; }
    const line = (row.classList.contains('refmore') ? box.querySelector('.refhit') : row).dataset.line;
    if (row.classList.contains('refmore') || line === '') { this.go(row.classList.contains('refmore') ? 'zoom' : 'page', page, { line: line === '' ? null : +line }); return; }
    // a note's words: edited right here, as part of this page (he asked, Oct 30, as Logseq does);
    // its page is a click on the group's name or on the path above it
    this.editRef(box, page, +line);
  }

  /** A linked reference (box: its .refnote) becomes the real note, editable where it is: an Outline of
   *  its own page zoomed in on it (opts.embed), with every rule of editing a page (saves with the
   *  file's version, merges, the clash screen, Undo, the other side's catching up). line: the note
   *  clicked (the reference or one of its sub-notes), where typing starts. Its rows go; the path stays. */
  async editRef(box, page, line) {
    if (box.live) { const o = box.live, i = o.indexForLine(line); if (i !== null && i !== undefined) o.edit(i); return; }
    if (box.opening) return;
    box.opening = true;
    const hit = box.tree?.hit;
    try {
      const pv = await call('page', { name: page, today: today(), time: nowTime() });
      const pane = box.isConnected && this.paneOf(box);
      if (!pane) return;
      const host = h('div', 'ref-live');
      const o = new Outline(host, pv, this, { zoomLine: hit.line, embed: true });
      // the note moved or went since the list was drawn: open its page instead
      const first = (s) => String(s ?? '').split('\n')[0].trim();
      if (o.root === null || o.root === undefined || !o.blocks[o.root] || o.readonly || first(o.blocks[o.root].text) !== first(hit.text)) { this.go('page', page, { line: hit.line }); return; }
      box.querySelectorAll(':scope > .refhit').forEach((r) => r.remove());
      box.tree = null;
      box.append(host);
      box.classList.add('live');
      box.live = o;
      pane.outlines.push(o);
      const i = o.indexForLine(line);
      o.edit(i ?? o.root);
    } catch (err) {
      this.toast(String(err));
    } finally {
      box.opening = false;
    }
  }
  /** Notes being edited inside references (editRef) under el, about to be drawn again or taken away:
   *  their typing saved, then let go. */
  dropLive(el) {
    for (const p of this.tabs.panes) {
      p.outlines = p.outlines.filter((o) => {
        if (!o.embed || !el.contains(o.el)) return true;
        o.stopEdit();
        o.flush();
        return false;
      });
    }
  }

  /** A to-do's tick box in a list of references: ticked off (or back on) in its own page's file,
   *  as the To-dos list does; the row shows it at once, and its page, if open, is read again. */
  async tickRef(page, line, text, row) {
    if (!text || !Number.isFinite(line)) return;
    const open = !/^(DONE|CANCELED|CANCELLED)\b/.test(text);
    try {
      const to = open ? await call('task_done', { text, today: today() }) : text.replace(/^(DONE|CANCELED|CANCELLED)/, this.workflow() === 'now' ? 'LATER' : 'TODO');
      const res = await call('save_block', { name: page, line, base: text, text: to });
      if (!res.ok) { this.toast('That to-do changed somewhere else; open its page to tick it there.'); return; }
      if (/^(TODO|LATER) /.test(to) && open) this.toast('Repeating to-do: moved to its next date', 2200);
      const ticked = /^DONE\b/.test(to);
      if (row) {
        row.refText = to;
        row.classList.toggle('marker-done', ticked);
        const box = row.querySelector('input.todo');
        if (box) box.checked = ticked;
      }
      this.widgetTasksSoon?.();
      await this.reloadPage(page); // (its own page, if it's open too)
    } catch (err) { this.toast(String(err)); }
  }

  linkClick(e) {
    const a = e.target.closest('a');
    if (!a || a.closest('.outline')) return;
    e.preventDefault();
    if (a.dataset.page) this.go('page', a.dataset.page);
    else if (a.getAttribute('href') && a.getAttribute('href') !== '#') this.openUrl(a.getAttribute('href'));
  }

  // ----- page actions -----
  /** The ⋯ menu beside a page's title. propsBox: its properties (renderPageProps); outline: its notes. */
  pageMenu(btn, pv, propsBox, outline) {
    const items = [];
    if (propsBox?.edit && !propsBox.has) items.push({ label: 'Add properties', run: () => propsBox.edit() });
    if (!pv.info.journal) items.push({ label: 'Rename…', run: () => this.renamePage(pv.info.name) });
    items.push({ label: 'Find on this page', run: () => this.find.open() });
    // its earlier versions: backups and safety copies (history.js)
    if (outline) items.push({ label: 'History…', run: () => openHistory(this, outline) });
    // as text, OPML or HTML, to the clipboard or a file (export.js, loaded when first used)
    if (outline) items.push({ label: 'Copy page as text…', run: () => import('./export.js').then((m) => m.exportPage(this, outline, pv)) });
    // a leanoutliner://page/… link: opens the app right at this page (links.rs, openLink)
    items.push({ label: 'Copy link', run: () => this.copyLink(pageLinkUrl(pv.info.name), 'Link to this page copied') });
    // the Windows app: its file, selected in File Explorer (not on a phone)
    if (isApp && !isAndroid && pv.info.exists) items.push({ label: 'Show file in Explorer', run: () => call('reveal_file', { name: pv.info.name }).catch((e) => this.toast(said(e), 5000)) });
    const T = this.tabs; // wide windows: tabs and two sides (tabs.js)
    if (T.on) {
      const p = this.paneOf(btn) ?? T.pane;
      const place = () => { T.activate(T.panes.indexOf(p)); return placeOf(T.tab(p)); };
      items.push({ label: 'Open in a new tab', run: () => T.open(place()) });
      items.push({ label: 'Open to the side', run: () => T.open(place(), 'side') });
      if (T.panes.length > 1) items.push({ label: 'Close this side', run: () => T.closePane(T.panes.indexOf(p)) });
    }
    // (wide windows on the laptop: a phone's notes use its whole width anyway)
    if (!isAndroid && !matchMedia('(max-width: 860px)').matches) items.push({ label: this.wide ? 'Back to reading width' : 'Wide mode: use the whole width', hint: 't w', run: () => this.setWide() });
    items.push({ label: 'Print or save as PDF', run: () => this.printPage() });
    if (pv.info.exists) items.push({ label: 'Delete page…', danger: true, run: async () => { if (await this.deletePages([pv.info.name])) this.go('journals'); } });
    menu(btn, items);
  }

  /** True (and says so) while a page waits for his choice on the clash screen: renaming or deleting
   *  pages then could take that page's file away from under it. only: just outline only's page (on
   *  either side; putting an earlier version back, history.js). */
  clashWaiting(only = null) {
    const o = (only ? this.sameFileAs(only) : this.outlines).find((x) => x.conflict);
    if (o) this.toast(`First choose which version of “${o.name}” to keep (the button at the top of the page).`, 5000);
    return !!o;
  }
  /** The outlines showing outline o's file (o itself too): the same page on both sides. */
  sameFileAs(o) { return this.outlines.filter((x) => sameFile(x, o)); }

  /** Rename a page (to: the new name; none: ask for it). A name another page already has offers to
   *  merge the two (mergePages), as Logseq does. True when it was renamed or merged. */
  async renamePage(name, to = null) {
    if (this.clashWaiting()) return false;
    let v = to;
    if (v === null) {
      const info = this.names.find((n) => n.name.toLowerCase() === name.toLowerCase());
      const n = info?.refs || 0;
      v = await promptBox({ title: 'Rename page', value: name, ok: 'Rename', body: n ? `Links to it in ${n} place${n === 1 ? '' : 's'} will be updated to the new name.` : '' });
    }
    if (v === null || !v.trim() || v.trim() === name) return false;
    v = v.trim();
    // a page with that name already? Then the two can be merged (its notes and links go there)
    let into;
    try { into = await call('rename_target', { name, new_name: v }); } catch (e) { this.toast(said(e), 6000); return false; }
    // (its other names, if it has some: they come along in a note, so they stop naming a page)
    const o = into && this.outlines.find((x) => x.root === null && x.name.toLowerCase() === name.toLowerCase());
    const alias = !!o && /(^|\n)[ \t]*(- )?alias::/i.test(`${o.doc?.preamble ?? ''}\n${o.blocks?.[0]?.text ?? ''}`);
    if (into && !(await confirmBox({
      title: `“${into}” already exists`,
      body: `Merge “${esc(name)}” into it? The notes of “${esc(name)}” go at the end of “${esc(into)}”, links to “${esc(name)}” will point to “${esc(into)}”, and its file goes to the bin (<code>logseq/.recycle</code>).${alias ? ` Its other names (<code>alias::</code>) come along in a note, so links to them stop leading anywhere, as in Logseq.` : ''}`,
      ok: 'Merge pages',
    }))) return false;
    if (!(await this.readyToRename())) return false;
    if (into) return this.mergePages(name, into);
    try {
      const res = await call('rename', { name, new_name: v });
      if (res.favorites && this.summary?.config) this.summary.config.favorites = res.favorites; // (a favourite follows its new name)
      await this.refreshNames();
      this.renameRecent(name, res.name);
      this.toast(res.files_changed ? `Renamed. Updated links in ${res.files_changed} other page${res.files_changed === 1 ? '' : 's'}.` : 'Renamed.', 4000);
      if (res.skipped.length) this.toast(`Renamed, but ${res.skipped.length} file(s) couldn’t be updated (not plain text, or being changed elsewhere just then): ${res.skipped.join(', ')}`, 8000);
      this.tabs.renamed(name, res.name); // every tab (and the address) follows the new name
      this.redrawAll();
      return true;
    } catch (e) { this.toast(said(e), 6000); return false; }
  }
  /** Before a rename, a merge or its Undo: every page saved (both sides are drawn again after it, as
   *  links in them may change: not with typing that couldn't be saved, which that would drop), and
   *  no clash waiting (saving just now may have met one). */
  async readyToRename() {
    await Promise.all(this.outlines.map((o) => { o.stopEdit(); return o.flush(); }));
    if (this.clashWaiting()) return false;
    const unsaved = this.outlines.find((o) => o.dirty && !o.readonly);
    if (unsaved) { this.toast(`“${unsaved.name}” couldn’t be saved just now, so nothing was renamed. Try again in a moment.`, 6000); return false; }
    return true;
  }
  /** Both sides drawn again where they were (they're saved; links in them may have changed). */
  redrawAll() {
    for (const p of this.tabs.panes) {
      if (getComputedStyle(p.el).overflowY !== 'visible') this.tabs.tab(p).top = Math.round(p.el.scrollTop);
      p.outlines = [];
      this.draw(p, { restore: true });
    }
  }
  /** Merge page name into page into (the core's merge_pages: name's notes at the end of into, links
   *  to name point at into, name's file to the bin), then show into; the message has an Undo. */
  async mergePages(name, into) {
    let res;
    try { res = await call('merge_pages', { name, into }); } catch (e) { this.toast(said(e), 7000); await this.refreshNames(); return false; }
    if (res.favorites && this.summary?.config) this.summary.config.favorites = res.favorites; // (a favourite of name now names into)
    await this.refreshNames();
    this.renameRecent(name, res.name);
    this.tabs.renamed(name, res.name, true); // (a tab zoomed into one of its notes shows the whole page)
    this.redrawAll();
    const notes = res.notes ? ` ${res.notes} note${res.notes === 1 ? '' : 's'} added at its end${res.props ? ' (its properties first)' : ''}.` : '';
    const links = res.files_changed ? ` Links updated in ${res.files_changed} other page${res.files_changed === 1 ? '' : 's'}.` : '';
    this.toast(`Merged “${name}” into “${res.name}”.${notes}${links}`, 9000, { label: 'Undo', run: () => this.undoMerge(res.undo, name) });
    if (res.skipped.length) setTimeout(() => this.toast(`These files link to “${name}” but couldn’t be changed (not plain text, or being changed elsewhere just then): ${res.skipped.join(', ')}`, 8000), 9000);
    return true;
  }
  /** The merge message's Undo: both pages (and the links) as they were, if nothing changed since. */
  async undoMerge(undo, name) {
    if (!(await this.readyToRename())) return;
    try {
      const back = await call('undo_merge', { undo });
      try { const s = await call('summary'); if (this.summary) this.summary.config = s.config; } catch { /* favourites as they were shown */ }
      await this.refreshNames();
      this.redrawAll();
      this.go('page', back);
      this.toast(`“${back}” is back as it was.`, 4000);
    } catch (e) { this.toast(said(e), 9000); await this.refreshNames(); this.redrawAll(); }
  }

  /** Rename a page by clicking its title, as in Logseq: the name becomes editable where it was
   *  clicked (tapped); Enter or leaving it renames (renamePage: links follow everywhere; a name
   *  another page has offers to merge the two), Esc puts it back. Switching to another window keeps
   *  it editable. prefix: a namespaced page's parents ("APRON/"), shown above its name. */
  editTitle(el, pv, prefix, e) {
    if (!el || el.isContentEditable) return;
    const old = el.textContent;
    el.contentEditable = 'plaintext-only';
    if (!el.isContentEditable) el.contentEditable = 'true';
    el.spellcheck = false;
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', 'Page name');
    el.parentElement.classList.add('renaming');
    el.focus({ preventScroll: true });
    // the caret where he clicked, else at the end
    const sel = getSelection(), at = e && document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const r = at && el.contains(at.startContainer) ? at : document.createRange();
    if (r !== at) { r.selectNodeContents(el); r.collapse(false); }
    sel.removeAllRanges();
    sel.addRange(r);
    let over = false;
    const finish = async (keep) => {
      if (over) return;
      over = true;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      el.parentElement?.classList.remove('renaming');
      if (document.activeElement === el) el.blur();
      const typed = el.textContent.replace(/\s+/g, ' ').trim();
      if (!keep || !typed || typed === old.trim()) { el.textContent = old; return; }
      el.textContent = typed;
      if (!(await this.renamePage(pv.info.name, prefix + typed)) && el.isConnected) el.textContent = old;
    };
    const onKey = (k) => {
      k.stopPropagation(); // (letters of the name, not the app's keys)
      if (k.isComposing) return;
      if (k.key === 'Enter') { k.preventDefault(); finish(true); }
      else if (k.key === 'Escape') { k.preventDefault(); finish(false); }
    };
    const onBlur = () => { if (document.hasFocus()) finish(true); }; // (another window: still renaming when he's back)
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  /** Put a link on the clipboard and say so. */
  async copyLink(link, said) {
    try { await navigator.clipboard.writeText(link); this.toast(said, 2500); } catch { this.toast('Couldn’t copy to the clipboard.', 4000); }
  }

  /** A leanoutliner://page/<name> or …/note/<id> link (outline_core::link): clicked in a note, in
   *  another program while the app is open (the "lean-link" event, links.rs) or before it started
   *  ("start_link"), or on the phone (MainActivity, openShortcut). A page opens; a note opens zoomed
   *  in, as Logseq's block links do. False when it isn't such a link. */
  async openLink(link) {
    let l = null;
    try { l = await call('link', { link: String(link) }); } catch { /* not ours */ }
    if (!l || (l.kind !== 'page' && l.kind !== 'note' && l.kind !== 'app')) return false;
    if (!this.vaultOpen) { this.toast('First choose your notes folder (Settings).', 4000); return true; }
    this.closeSearch();
    if (l.kind === 'page') this.go('page', l.name);
    if (l.kind === 'note') {
      let hit = null;
      try { [hit] = await call('blocks_by_id', { ids: [l.id] }); } catch { /* below */ }
      if (hit) this.go('zoom', hit.page, { line: hit.line });
      else this.toast('That note isn’t in your notes any more (no note has its id).', 5000);
    }
    return true;
  }

  renameRecent(from, to) {
    const seen = new Set(); // (merged into a page that was in the list already: once)
    store.set('recent', this.recent().map((n) => (n.toLowerCase() === from.toLowerCase() ? to : n)).filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())));
    this.renderSideLists();
  }

  /** Delete pages (they go to the bin, logseq/.recycle). Returns true if deleted. */
  async deletePages(names) {
    if (this.clashWaiting()) return false;
    const links = names.reduce((s, n) => s + (this.names.find((x) => x.name.toLowerCase() === n.toLowerCase())?.refs || 0), 0);
    const what = names.length === 1 ? `“${esc(names[0])}”` : `${names.length} pages`;
    const ok = await confirmBox({
      title: names.length === 1 ? 'Delete this page?' : `Delete ${names.length} pages?`,
      body: `${what} will be moved to the bin (<code>logseq/.recycle</code> in your notes folder); you can bring ${names.length === 1 ? 'it' : 'them'} back from Settings.${links ? ` <b>${links} link${links === 1 ? '' : 's'}</b> from other notes will point to a page without a file.` : ''}`,
      ok: 'Delete', danger: true,
    });
    if (!ok) return false;
    await Promise.all(this.outlines.map((o) => { o.stopEdit(); return o.flush(); }));
    if (this.clashWaiting()) return false; // (again: saving just now may have met one, on either side)
    try {
      const n = await call('delete', { names });
      await this.refreshNames();
      store.set('recent', this.recent().filter((r) => !names.some((x) => x.toLowerCase() === r.toLowerCase())));
      this.renderSideLists();
      for (const p of this.tabs.panes) { // (deleted pages' editors aren't saved again)
        const had = p.outlines.length;
        for (const o of p.outlines) if (names.some((x) => x.toLowerCase() === o.name.toLowerCase())) this.keepCopy(o); // (typing that couldn't be saved)
        p.outlines = p.outlines.filter((o) => !names.some((x) => x.toLowerCase() === o.name.toLowerCase()));
        if (p.outlines.length !== had && p !== this.pane) this.draw(p); // the other side showed one: as it is now
      }
      this.toast(`Deleted ${n} page${n === 1 ? '' : 's'}. You can restore them in Settings → Notes.`, 4000);
      return true;
    } catch (e) { this.toast(String(e), 6000); await this.refreshNames(); return false; }
  }

  printPage() {
    if (window.LeanAndroid?.print) window.LeanAndroid.print(document.title);
    else window.print();
  }

  /** What a page link's small menu adds for that link (tabs.js linkMenu, a right-click or a sidebar
   *  entry's ⋯): a favourite in the sidebar can be taken off the list there. */
  linkItems(a) {
    const name = a.closest('#favs') && a.dataset.page;
    return name ? [{ label: 'Remove from favourites', run: () => this.toggleFavourite(name) }] : [];
  }

  async toggleFavourite(name) {
    const favs = this.summary?.config?.favorites || [];
    const on = !favs.some((f) => f.toLowerCase() === name.toLowerCase());
    try {
      this.summary.config.favorites = await call('set_favorite', { name, on });
      this.renderSideLists();
      for (const b of document.querySelectorAll('.title-row [data-a="fav"]')) { // (the page may be open on both sides)
        if (b.dataset.name?.toLowerCase() !== name.toLowerCase()) continue;
        b.classList.toggle('on', on);
        b.setAttribute('aria-label', on ? 'Remove from favourites' : 'Add to favourites');
      }
      this.toast(on ? 'Added to favourites' : 'Removed from favourites', 1500);
    } catch (e) { this.toast(String(e), 5000); }
  }

  randomPage() {
    const pool = this.names.filter((n) => n.exists && !n.journal);
    if (pool.length) this.go('page', pool[Math.floor(Math.random() * pool.length)].name);
  }

  // ----- looks, text size, sidebar -----
  setSkin(id) {
    if (!SKIN_IDS.has(id)) id = 'calm'; // (Grimoire, taken out in Build 32, too; boot.js does the same before the first paint)
    document.documentElement.dataset.skin = id;
    store.set('skin', id);
    const cur = $('#side .look-cur');
    if (cur) cur.innerHTML = lookName(SKINS.find((s) => s.id === id));
    // the Android home-screen widgets and the "Add a note" pop-up follow the look (at every start and
    // look change; as #rrggbb, the colours as seen, which Android always reads: a look may use any
    // CSS colour, e.g. rgb() or color-mix(), and Android would fall back to its defaults for those)
    if (window.LeanAndroid?.setWidgetColors) {
      const c = lookColors();
      window.LeanAndroid.setWidgetColors(c.surface, c.ink, c['ink-faint'], c.accent);
    }
    // and so do the phone's status bar (clock, battery) and navigation bar: the page's colour,
    // with dark icons on a light look and light icons on a dark one
    const rgb = (getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    if (rgb.length === 3 && window.LeanAndroid?.setBarColors) {
      const hex = '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
      const bars = () => window.LeanAndroid.setBarColors(hex, 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 140);
      // while the start-up drawing shows, the bars stay its cream (MainActivity paints them so): then the look's
      const sp = document.getElementById('splash');
      if (sp && !sp.classList.contains('done')) { this.barsLater = bars; setTimeout(() => { this.barsLater?.(); this.barsLater = null; }, 12500); } else bars(); // (12 s: when the drawing goes by itself)
    }
    // and so does the Windows "Add to journal" box, which draws itself without this page: it reads
    // the colours from a small file the app keeps (written only when they change). A moment later,
    // so starting up and trying looks one after another stay quick.
    if (!isAndroid) {
      clearTimeout(this.lookTimer);
      this.lookTimer = setTimeout(() => call('save_look', { look: id, colors: lookColors() }).catch(() => {}), 700);
    }
  }
  /** The look picker: a short list that opens from the sidebar's Look button. Each row has a
   *  small live sample (data-skin on the sample paints it with that look's own colours and
   *  fonts). Picking applies at once and leaves the list open, so looks are easy to compare. */
  openLooks(anchor) {
    if (this.closeLooks) { this.closeLooks(); return; }
    const cur = document.documentElement.dataset.skin;
    const box = h('div', 'pop looks');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose a look');
    box.innerHTML = `<ul>${SKINS.map((s) => `<li><button type="button" data-look="${s.id}" aria-pressed="${s.id === cur}">
        <span class="look-sw" data-skin="${s.id}" aria-hidden="true"><span><i></i><b>Aa</b></span></span>
        <span class="look-txt"><b>${lookName(s)}</b><small>${esc(s.note)}</small></span></button></li>`).join('')}</ul>
      <a class="look-more" href="#/settings/look">Bigger previews and text size: Settings</a>`;
    document.body.append(box);
    const rows = () => [...box.querySelectorAll('[data-look]')];
    const onDown = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        const list = rows();
        const k = list.indexOf(document.activeElement);
        list[(k + (e.key === 'ArrowDown' ? 1 : list.length - 1) + list.length) % list.length].focus();
      }
    };
    const close = () => {
      box.remove();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      anchor.setAttribute('aria-expanded', 'false');
      this.closeLooks = null;
    };
    this.closeLooks = close;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-look]');
      if (b) { this.setSkin(b.dataset.look); rows().forEach((x) => x.setAttribute('aria-pressed', x === b)); }
      else if (e.target.closest('.look-more')) close();
    });
    setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true); }, 0);
    anchor.setAttribute('aria-expanded', 'true');
    place(box, anchor.getBoundingClientRect());
    (box.querySelector('[aria-pressed="true"]') || box.querySelector('[data-look]')).focus();
  }
  textSize(s) {
    if (s === undefined) return store.get('textSize', 1);
    s = Math.round(Math.min(1.6, Math.max(0.8, s)) * 20) / 20;
    store.set('textSize', s);
    document.documentElement.style.setProperty('--text-scale', s);
    return s;
  }
  /** Wide mode (Logseq's t w): the notes use the whole width of the window (or of their side)
   *  instead of stopping at a reading width. Remembered; boot.js puts it back before anything shows. */
  get wide() { return document.documentElement.classList.contains('wide'); }
  setWide(on = !this.wide, quiet = false) {
    document.documentElement.classList.toggle('wide', on);
    store.set('wide', on);
    if (!quiet) this.toast(on ? 'Wide mode: your notes use the whole width (t w to go back)' : 'Back to the reading width', 2200);
    this.pinSoon();
  }
  /** Show or hide the sidebar. In a wide window it slides away and the notes slide over with it, as
   *  in Logseq; the top strip stays as it is. */
  toggleSidebar(force) {
    const hide = force ?? !document.body.classList.contains('side-hidden');
    const done = hide !== document.body.classList.contains('side-hidden') && this.started ? this.slide() : null;
    document.body.classList.toggle('side-hidden', hide);
    store.set('sideHidden', hide);
    this.hideMore?.();
    const b = $('#histbar [data-a="side"]');
    if (b) { b.setAttribute('aria-expanded', String(!hide)); b.title = `${hide ? 'Show' : 'Hide'} the sidebar (t l)`; }
    done?.();
  }
  /** The sidebar is about to open or close in a wide window: what sits in the notes (each side's
   *  page, the find bar, the right side's buttons in the strip) is noted where it is now; the
   *  function returned, called once the layout changed, slides each from there to its new place.
   *  Only transforms move (no layout while sliding), so a 3,000-note page slides as smoothly as a short
   *  one; the sidebar itself slides by CSS (html.sliding, app.css). Not with reduced motion, nor in a
   *  narrow window (there it's a drawer). */
  slide() {
    if (matchMedia('(max-width: 860px), (prefers-reduced-motion: reduce)').matches) return null;
    const els = [...this.tabs.panes.map((p) => p.el.firstElementChild), $('#findbar'),
      ...document.querySelectorAll('#histbar .hb-nav[data-p="1"] > *, #histbar .tabs[data-p="1"], #histbar .tab-new[data-p="1"]')]
      .filter((el) => el && el.offsetParent);
    const was = els.map((el) => el.getBoundingClientRect().left); // (where they're seen, mid-slide too)
    for (const a of this.slideAnims ?? []) a?.cancel(); // (opened again while closing: from where it is)
    const root = document.documentElement;
    root.classList.add('sliding');
    return () => {
      const anims = els.map((el, k) => {
        const r = el.getBoundingClientRect(), dx = was[k] - r.left;
        const z = (el.offsetWidth ? r.width / el.offsetWidth : 1) || 1; // (the text size zooms the notes)
        return Math.abs(dx) < 0.5 ? null : el.animate([{ transform: `translateX(${dx / z}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: SLIDE_EASE });
      });
      clearTimeout(this.slideT);
      this.slideT = setTimeout(() => root.classList.remove('sliding'), SLIDE_MS + 40);
      this.slideAnims = anims;
    };
  }

  // ----- search and the command list: one box (search.js) -----
  openSearch() { this.sbox.open('search'); }
  openCommands() { this.sbox.open('commands'); }
  closeSearch() { this.sbox.close(); }

  // ----- chrome -----
  buildChrome() {
    // On Windows the app draws its own title bar (see below); null in a browser and on phones
    const win = isApp && !isAndroid ? window.__TAURI__?.window?.getCurrentWindow?.() : null;
    const side = $('#side');
    side.innerHTML = `
      <div class="brand">${ICON.brand}<button class="icon-btn hide-side" data-a="side" aria-label="Hide the sidebar" title="Hide the sidebar (t l)">${ICON.side}</button></div>
      <button class="searchbtn" data-a="search">${ICON.search.replace('<svg', '<svg width="16" height="16"')}<span>Search</span><kbd>Ctrl K</kbd></button>
      <nav class="nav">
        <a href="#/journals" data-view="journals">${ICON.journals}Journals</a>
        <a href="#/pages" data-view="pages">${ICON.pages}All pages</a>
        <a href="#/todos" data-view="todos">${ICON.todos}To-dos</a>
        <a href="#/tags" data-view="tags">${ICON.tags}Tags</a>
        <a href="#/props" data-view="props">${ICON.props}Properties</a>
      </nav>
      <div id="favs"></div>
      <div class="side-sec" data-sec="recent"><button type="button" class="side-h side-fold" aria-expanded="true">Recent</button><div class="side-list" id="recent"></div></div>
      <div class="side-foot">
        <a class="update" id="update" hidden href="#/settings/about">A newer version is ready</a>
        <nav class="nav">
          <button type="button" class="nav-btn cmd-btn" data-a="commands" aria-haspopup="dialog">${ICON.cmd}Commands</button>
          <button type="button" class="nav-btn" data-a="looks" aria-haspopup="dialog" title="Change the look">${ICON.palette}Look<span class="look-cur"></span></button>
          <a href="#/settings" data-view="settings">${ICON.settings}Settings</a>
        </nav>
      </div>`;
    side.addEventListener('click', (e) => {
      const fold = e.target.closest('.side-h.side-fold');
      if (fold) { // Favourites / Recent open and close; remembered
        const sec = fold.closest('.side-sec').dataset.sec;
        const shut = store.get('sideShut', {});
        shut[sec] = !shut[sec];
        store.set('sideShut', shut);
        this.applySideFolds();
        this.fitRecent();
        return;
      }
      // Settings while already in Settings: stay on its tab (no extra step for Back)
      if (e.target.closest('a[href="#/settings"]') && location.hash.startsWith('#/settings')) { e.preventDefault(); document.body.classList.remove('drawer'); return; }
      if (e.target.closest('[data-a="search"]')) this.openSearch();
      if (e.target.closest('[data-a="commands"]')) this.openCommands();
      if (e.target.closest('[data-a="side"]')) this.toggleSidebar(true);
      const lk = e.target.closest('[data-a="looks"]');
      if (lk) this.openLooks(lk);
      const a = e.target.closest('#recent a, #favs a');
      if (a) { e.preventDefault(); this.go('page', a.dataset.page); }
    });
    this.setSkin(document.documentElement.dataset.skin || 'thinky');
    this.sideExtras(side);
    this.textSize(this.textSize());
    this.applyTextStyle();
    // Recent shows only what fits: check again whenever its space changes (window size, the sidebar
    // shown again, Favourites folded, the update notice appearing…). The section's size doesn't
    // depend on how many pages it shows, so hiding some can't set this off again.
    new ResizeObserver(() => this.fitRecent()).observe($('.side-sec[data-sec="recent"]', side));
    // Small buttons (the bars, fold headings, a page's star and menu) don't keep the keyboard focus
    // after a click, like a window's own buttons, so Space or Enter afterwards scroll instead of
    // pressing them again; Tab still reaches them. (The message's button, e.g. Undo, neither: the note
    // being typed in stays open, the keyboard up.)
    document.addEventListener('mousedown', (e) => { if (e.target.closest?.(QUIET_BUTTONS)) e.preventDefault(); });
    // The window got narrow or wide (e.g. snapped to half the screen): a different part of the
    // screen scrolls now (see app.css). Keep what was at the top of the notes there, and let the
    // journals watch the right part for loading older days.
    let noteT = 0;
    let homeF = 0;
    const onScroll = () => {
      clearTimeout(noteT); noteT = setTimeout(() => this.noteTop(), 150); this.pinSoon();
      if (!homeF) homeF = requestAnimationFrame(() => { homeF = 0; this.updateHome(); this.fabScroll(); });
    };
    window.addEventListener('resize', () => this.pinSoon());
    for (const el of this.tabs.els) el.addEventListener('scroll', onScroll, { passive: true }); // (both sides)
    window.addEventListener('scroll', onScroll, { passive: true });
    matchMedia('(max-width: 860px)').addEventListener('change', () => { this.restoreTop(); this.tabs.panes.forEach((p) => p.watch?.()); });

    // back and forward at the top (laptop; on phones the top bar stays as it is)
    // On Windows the app draws its own title bar: these strips can be dragged to move the
    // window (double-click: maximise), with minimise / maximise / close at the right
    const winctl = win ? `<div class="winctl"><button data-w="min" aria-label="Minimise" title="Minimise">${ICON.winMin}</button><button data-w="max" aria-label="Maximise" title="Maximise">${ICON.winMax}</button><button data-w="close" class="close" aria-label="Close" title="Close">${ICON.winClose}</button></div>` : '';
    const winAction = (w) => ({ min: () => win.minimize(), max: () => win.toggleMaximize(), close: () => win.close() })[w]?.();
    const hb = $('#histbar');
    // Home (today in the Journals list) left of back and forward, in the laptop strip and the phone bar;
    // the tabs of each side follow (tabs.js), then its "+". Two halves: with two sides each one's Home,
    // arrows and tabs sit above it and act on it (app.css "tabs" block). The strip runs across the
    // whole window, above the sidebar too, and starts with the logo, the sidebar's button and Search
    // (.hb-app): nothing in it moves when the sidebar opens or closes (like Logseq's top bar)
    const home = `<button data-a="home" aria-label="Today in Journals" title="Today in Journals (g j)">${ICON.home}</button>`;
    const strip = (p) => `<div class="tabs" data-p="${p}" role="tablist" aria-label="Open pages${p ? ' on the right' : ''}" hidden></div>`
      + `<button type="button" class="tab-new" data-p="${p}" aria-label="New tab${p ? ' on the right' : ''}" title="New tab (Ctrl+T)" hidden>${ICON.plus}</button>`;
    const appBtns = `<span class="hb-app"><i class="hb-logo" title="thinky">${ICON.logo}</i>`
      + `<button data-a="side" aria-controls="side" aria-label="Sidebar" title="Hide the sidebar (t l)">${ICON.side}</button>`
      + `<button data-a="search" aria-label="Search" title="Search (Ctrl+K)">${ICON.search}</button></span>`;
    hb.innerHTML = `<div class="hb-h">${appBtns}<span class="hb-nav" data-p="0">${sideNav(0)}</span>${strip(0)}</div>`
      + `<div class="hb-h"><span class="hb-nav" data-p="1"></span>${strip(1)}<div class="drag"></div>${winctl}</div>`;
    this.toggleSidebar(store.get('sideHidden', false));
    hb.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.w) { winAction(b.dataset.w); return; }
      if (b.dataset.a === 'side') { this.toggleSidebar(); return; }
      if (b.dataset.a === 'search' && b.closest('.hb-app')) { this.openSearch(); return; }
      const nav = b.closest('.hb-nav');
      if (!nav) return; // (the tabs and "+": tabs.js)
      this.tabs.activate(+nav.dataset.p); // a side's buttons act on that side (also from the keyboard)
      if (b.dataset.a === 'home') this.go('journals');
      else if (b.dataset.a === 'date') this.goToDate(b);
      else if (b.dataset.h === 'back') this.back();
      else if (b.dataset.h === 'forward') this.forward();
    };
    this.tabs.bind();
    this.updateHistBar();
    if (win) {
      // the maximise button turns into "restore" while the window is maximised
      const syncMax = async () => {
        const m = await win.isMaximized().catch(() => false);
        document.querySelectorAll('[data-w="max"]').forEach((b) => {
          b.innerHTML = m ? ICON.winRestore : ICON.winMax;
          b.title = m ? 'Restore' : 'Maximise';
          b.setAttribute('aria-label', b.title);
        });
      };
      win.onResized(syncMax);
      syncMax();
    }

    const top = $('#topbar');
    top.innerHTML = `<button data-a="menu" aria-label="Menu" aria-controls="side" aria-expanded="false">${ICON.menu}</button>${home}
      <button data-h="back" aria-label="Back" title="Back">${ICON.back}</button><button data-h="forward" aria-label="Forward" title="Forward">${ICON.forward}</button>
      <span class="t"></span><button data-a="date" aria-label="Go to date" title="Go to date">${ICON.date}</button><button data-a="search" aria-label="Search">${ICON.search}</button>${winctl}`;
    // Tauri moves the window when one of these is pressed directly (not a button inside it).
    // Only on Windows: on a phone the press would ask for something phones can't do.
    // (#topbar is the strip a narrow window shows instead of #histbar.)
    if (win) for (const el of [$('.brand', side), hb, ...hb.querySelectorAll('.hb-h, .hb-app, .tabs'), $('.drag', hb), top, $('.t', top)]) el.setAttribute('data-tauri-drag-region', '');
    top.classList.toggle('has-winctl', !!win); // a very narrow window drops a few buttons (app.css)
    top.onclick = (e) => {
      const wb = e.target.closest('[data-w]');
      if (wb) { winAction(wb.dataset.w); return; }
      const hb = e.target.closest('[data-h]');
      if (hb) { if (!hb.disabled) hb.dataset.h === 'back' ? this.back() : this.forward(); return; }
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'menu') document.body.classList.toggle('drawer');
      if (a === 'search') this.openSearch();
      if (a === 'home') this.go('journals');
      if (a === 'date') this.goToDate(e.target.closest('button'));
    };
    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('drawer') && !e.target.closest('#side, #topbar, .pop, .modal-back')) document.body.classList.remove('drawer');
    });
    // the menu button says whether the menu (drawer) is open, whatever opened or closed it
    const menuBtn = $('[data-a="menu"]', top);
    new MutationObserver(() => menuBtn.setAttribute('aria-expanded', String(document.body.classList.contains('drawer')))).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // phones: a swipe in from the left edge opens the menu, a swipe to the left closes it
    // (Android's Back gesture keeps the very edge; notes swipe in and out further in, editor.js)
    let sw = null;
    document.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      const open = document.body.classList.contains('drawer');
      sw = e.touches.length === 1 && matchMedia('(max-width: 860px)').matches && (open || t.clientX < EDGE) ? { x: t.clientX, y: t.clientY, open } : null;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      this.touchedAt = Date.now(); // (the page scrolled by a finger: the "+" may step aside, fabScroll)
      if (!sw) return;
      const dx = e.touches[0].clientX - sw.x, dy = Math.abs(e.touches[0].clientY - sw.y);
      if (dy > 30 && dy > Math.abs(dx)) { sw = null; return; }
      if (Math.abs(dx) < 50 || Math.abs(dx) < dy * 1.5) return;
      if (!sw.open && dx > 0) document.body.classList.add('drawer');
      if (sw.open && dx < 0) document.body.classList.remove('drawer');
      sw = null;
    }, { passive: true });

    // phone editing toolbar: scrolls sideways, except "close keyboard", which stays at the end
    const tb = $('#toolbar');
    // his order (Oct 30): Undo and Redo first, the writing buttons, then moving the note, "/" last
    const tools = [['undo', 'Undo'], ['redo', 'Redo'], ['newline', 'New line in this block'],
      ['link', 'Link'], ['tag', 'Tag'], ['check', 'To-do'], ['date', 'Date: a link to a day, or scheduled / deadline'], ['bold', 'Bold'], ['italic', 'Italics'], ['mark', 'Highlight'], ['heading', 'Heading'],
      ['image', 'Add image'], ['more', 'Note menu: colour, heading, cut, copy…'], ['outdent', 'Outdent'], ['indent', 'Indent'], ['up', 'Move up'], ['down', 'Move down'], ['slash', 'Commands (/)']];
    const tbBtn = ([k, label], cls = '') => `<button data-t="${k}"${cls ? ` class="${cls}"` : ''} aria-label="${label}" title="${label}">${ICON[k]}</button>`;
    tb.innerHTML = `<div class="tb-scroll">${tools.map((t) => tbBtn(t)).join('')}</div>${tbBtn(['done', 'Close keyboard'], 'tb-pin')}`;
    // A button acts when it's tapped (the finger lifted where it went down), not as soon as a finger
    // lands on it: a sideways swipe that starts on a button scrolls the toolbar and presses nothing
    // (moving more than 10px, or the browser taking the touch over for scrolling, cancels it).
    let press = null;
    tb.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault(); // keep the keyboard open (the button never takes the focus)
      press = { b, id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    tb.addEventListener('pointermove', (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) press = null;
    });
    tb.addEventListener('pointercancel', () => { press = null; });
    tb.addEventListener('pointerup', (e) => {
      const p = press;
      press = null;
      if (!p || e.pointerId !== p.id || e.target.closest('button') !== p.b) return;
      const b = p.b;
      // a page's properties box: only the buttons that type something there
      if (this.textTa?.isConnected && document.activeElement === this.textTa) { this.textTool(this.textTa, b.dataset.t); return; }
      const o = this.active;
      if (!o) return;
      const i = o.cur ?? (o.sel ? o.selRange()[0] : null);
      if (i === null) return;
      const heading = () => { const m = o.textOf(i).match(/^(?:[A-Z-]+ )?(#{1,6}) /); o.setHeading(m ? (m[1].length >= 3 ? 0 : m[1].length + 1) : 1); };
      ({
        outdent: () => o.outdent(i), indent: () => o.indent(i), up: () => o.move(i, -1), down: () => o.move(i, 1),
        newline: () => o.insertAtCaret('\n'), tag: () => o.insertAtCaret('#'),
        // with words selected, the link button makes them a page link
        link: () => (o.ta && o.ta.selectionStart !== o.ta.selectionEnd ? o.wrap('[[', ']]') : o.insertAtCaret('[[]]', 2)),
        check: () => (o.sel ? o.cycleTodoSel() : o.cycleTodo()), date: () => o.dateMenu(b),
        slash: () => o.openCommands(), // (while typing; not for selected notes)
        bold: () => o.wrap('**', '**'), italic: () => o.wrap('*', '*'), mark: () => o.wrap('^^', '^^'), heading,
        image: () => o.pickFile(true), undo: () => this.undo(o), redo: () => this.redo(o),
        more: () => o.openMenu(o.cur ?? o.sel.b, { kb: true, touch: true, at: b.getBoundingClientRect() }), // (by the button; the editing box keeps the keyboard)
        done: () => { o.stopEdit(); o.clearSel(); document.activeElement?.blur(); this.updateToolbar(); },
      })[b.dataset.t]?.();
      // the toolbar went away (Close keyboard): the click that comes with this tap mustn't land on
      // what's under the finger now (the "+", a note)
      if (tb.hidden) {
        const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
        document.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', eat, true), 500);
      }
    });

    // phones: a round "+" at the bottom adds a note at the end of the page shown (on the Journals list,
    // today's) and opens the keyboard; hidden while typing (the toolbar is there) and where there are
    // no notes (here())
    const add = h('button');
    add.id = 'addnote';
    add.type = 'button';
    add.hidden = true;
    add.setAttribute('aria-label', 'Add a note');
    add.title = 'Add a note';
    add.innerHTML = ICON.addNote;
    add.onclick = () => this.addNote();
    if (isAndroid) add.classList.add('android'); // (shown on any Android, app.css)
    tb.after(add);

    document.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('hashchange', () => this.route(false));
    // the browser stepping between two steps with the same address (e.g. left by a page that
    // couldn't be left) fires no hashchange: the active tab follows here (others: hashchange)
    window.addEventListener('popstate', () => { if (this.tabs.ready && location.hash === placeOf(this.tabs.tab())) this.route(false); });
    // laptop mouse back/forward buttons
    window.addEventListener('mouseup', (e) => {
      if (e.button === 3) { e.preventDefault(); this.back(); }
      if (e.button === 4) { e.preventDefault(); this.forward(); }
    });

    // Pick up edits from Drive sync / Claude / other devices: the app is told about file
    // changes; coming back to it re-checks too, in case a notice was missed.
    // (not when "all files access" was just turned on: then the folder is opened again anyway, see start)
    const refresh = () => { if (!(this.noAccess && window.LeanAndroid?.hasAllFilesAccess?.())) this.rescan(); };
    listen('lean-files', refresh);
    // a page or note link clicked in another program while the app is open (links.rs)
    listen('lean-link', (e) => this.openLink(e.payload));
    // Put away (Android may then close the app without a word), reloaded or closed: save what can be
    // saved; a page waiting for his choice on the clash screen is saved nowhere, so it gets a copy
    // in logseq/bak if he typed more since the last one (editor.js backupPending)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
      else { this.outlines.forEach((o) => { o.flush(); o.backupPending(true); }); this.tabs.save(true); if (this.vaultOpen) call('persist').catch(() => {}); }
    });
    window.addEventListener('focus', refresh);
    // without file notifications (the dev server), fall back to a slow check
    if (!isApp) setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
    window.addEventListener('beforeunload', () => { this.outlines.forEach((o) => { o.flush(); o.backupPending(true); }); this.opening.forEach((w) => w.keep(true)); this.tabs.save(true); });
    // finish saving before the window closes (and remember how far down each tab was)
    listen('lean-close', async () => {
      this.tabs.save(true);
      await this.saveAll();
      call('quit').catch(() => {});
    });
  }

  /** Save every open page now (closing the app, installing an update). True when all is saved;
   *  false if something isn't: a clash waiting for him, a save that failed or took over `ms` in all.
   *  A note still opening (editAfterSave: the other side is saved first) opens first and takes what
   *  was typed meanwhile, so that is saved too; if it can't in time (the last quarter of `ms`, at
   *  least 1 s, is kept for saving), that typing goes to logseq/bak instead. */
  async saveAll(ms = 3500) {
    let done = false, kept = [];
    try {
      const end = Date.now() + ms;
      const timeUp = (v, at = end) => new Promise((r) => setTimeout(() => r(v), Math.max(0, at - Date.now())));
      if (this.opening.size) await Promise.race([Promise.all([...this.opening].map((w) => w.done)), timeUp(null, end - Math.max(1000, ms / 4))]);
      kept = [...this.opening]; // (still waiting)
      // (a page waiting for his choice on the clash screen is saved nowhere: it gets its copy in
      // logseq/bak first, editor.js backupPending)
      const all = Promise.all([...kept.map((w) => w.keep()), ...this.outlines.map(async (o) => { o.stopEdit(); await o.flush(); await o.backupPending(); })]).then(() => true);
      done = await Promise.race([all, timeUp(false)]);
    } catch { /* not saved */ }
    return done && !kept.length && !this.outlines.some((o) => !o.readonly && (o.dirty || o.conflict));
  }

  onKey(e) {
    const t = e.target;
    const typing = t.closest?.('input, textarea, select, [contenteditable]');
    if (!$('#search').hidden) { if (e.key === 'Escape') this.closeSearch(); return; }
    if (document.querySelector('.modal-back, .pop.datepick, .pop.menu')) return;
    const act = (name) => (this.keyMap[name] || []).some((k) => !k.includes(' ') && same(parseChord(k), evChord(e)));
    if (act('command-palette/toggle')) { e.preventDefault(); this.openCommands(); return; }
    if (act('go/search')) { e.preventDefault(); this.openSearch(); return; }
    // (not when the note being edited already used the key, e.g. :editor/highlight set to ctrl+h)
    if ((act('go/search-in-page') || act('go/replace-in-page')) && this.pane.outlines.length && !e.defaultPrevented) { e.preventDefault(); this.find.open(act('go/replace-in-page')); return; }
    if (act('go/backward')) { e.preventDefault(); this.back(); return; }
    if (act('go/forward')) { e.preventDefault(); this.forward(); return; }
    for (const a of ['ui/text-bigger', 'ui/text-smaller', 'ui/text-reset']) if (act(a)) { e.preventDefault(); this.runAction(a); return; }
    if (act('ui/toggle-left-sidebar') && (!typing || e.ctrlKey || e.metaKey)) { e.preventDefault(); this.toggleSidebar(); return; }
    if (act('go/journals') && (!typing || e.ctrlKey || e.metaKey)) { e.preventDefault(); this.go('journals'); return; }
    if (typing) return;
    // blocks selected: arrows, Tab, Delete, copy… act on them
    const o = this.pane.outlines.find((x) => x.sel && this.shows(x)); // (the active side's: keys act there)
    if (o && o.onSelKey(e)) { e.preventDefault(); return; }
    // Ctrl+A / Ctrl+Shift+A with nothing selected: every note on the page (a Journals day: the last
    // one edited, else the first), as Logseq does
    if (!o && (act('editor/select-parent') || act('editor/select-all-blocks'))) {
      const t = this.mainOutline(); // (never a folded day's: they'd be deleted unseen)
      if (t) { e.preventDefault(); t.selectAll(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      // right after a replace in find (several pages, maybe): undo it everywhere it changed things
      if (!e.shiftKey && this.find.canUndo) { e.preventDefault(); this.find.undoReplace(); return; }
      const last = this.active || this.pane.outlines[0];
      if (last) { e.preventDefault(); e.shiftKey ? this.redo(last) : this.undo(last); }
      return;
    }
    // Page Down, Space, arrows, Home / End (also with Ctrl): scroll the notes
    if (SCROLL_KEYS.has(e.key) && !e.altKey && !e.metaKey && (!e.ctrlKey || e.key === 'Home' || e.key === 'End')) {
      if (!e.defaultPrevented) this.focusForScroll(e);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // two-key sequences like "g j"
    const k = evChord(e);
    const now = Date.now();
    const seq = this.seq && now - this.seq.at < 1200 ? [...this.seq.keys, k] : [k];
    const matches = Object.entries(this.keyMap).filter(([, keys]) => keys.some((s) => {
      const parts = s.split(' ').filter(Boolean).map(parseChord);
      return parts.length > 1 && parts.length >= seq.length && seq.every((c, n) => same(parts[n], c));
    }));
    if (!matches.length) { this.seq = null; return; }
    const done = matches.find(([, keys]) => keys.some((s) => s.split(' ').filter(Boolean).length === seq.length && s.split(' ').filter(Boolean).map(parseChord).every((c, n) => same(c, seq[n]))));
    if (!done) { this.seq = { keys: seq, at: now }; return; }
    this.seq = null;
    e.preventDefault();
    this.runAction(done[0]);
  }

  /** Where the notes start on screen (below the top strip or bar), and how to move them by dy: the
   *  active pane (#main, or #main2 on the right) scrolls in a wide window, the whole page in a narrow one. */
  scroller() {
    const main = this.pane.el;
    if (getComputedStyle(main).overflowY === 'visible') return { top: $('#topbar').getBoundingClientRect().bottom, by: (dy) => window.scrollBy(0, dy) };
    const r = main.getBoundingClientRect();
    const z = (main.offsetWidth ? r.width / main.offsetWidth : 1) || 1; // text size zooms #main; its scrolling counts unzoomed
    return { top: r.top, by: (dy) => { main.scrollTop += dy / z; } };
  }
  /** Remember the block (or day) at the top of the notes, a moment after scrolling stops. */
  noteTop() {
    const p = this.pane;
    const { top } = this.scroller();
    const r = p.el.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, top + 12)?.closest('.blk, .sheet, .view > *');
    p.anchor = el && p.el.contains(el) ? { el, off: el.getBoundingClientRect().top - top } : null;
  }
  /** After the window switched between wide and narrow: scroll that block back to the top. */
  restoreTop() {
    const a = this.pane?.anchor;
    if (!a?.el.isConnected) return;
    const s = this.scroller();
    s.by(a.el.getBoundingClientRect().top - s.top - a.off);
  }

  /** Page Down, Space, arrows… In a wide window the notes scroll inside the pane, and the browser only
   *  scrolls that by keyboard when it (or something in it) has the focus: give it the focus first.
   *  Pop-ups keep their keys, and Space still presses a focused button. */
  focusForScroll(e) {
    const main = this.pane.el;
    if (getComputedStyle(main).overflowY === 'visible') return; // narrow window: the whole page scrolls
    const a = document.activeElement;
    if (a && a !== document.body && (main.contains(a) || a.closest('.pop, [role="dialog"]') || (e.key === ' ' && a.closest('button')))) return;
    // focusable only for this: if it always were, grabbing its scroll bar would pull the focus out
    // of the block being edited
    main.tabIndex = -1;
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    main.focus({ preventScroll: true });
  }

  async runAction(name) {
    const here = this.pane.outlines; // the active side's
    const journal = here.length === 1 ? here[0].journal : null;
    const shiftDay = async (n) => {
      const d = journal ? dateOf(journal) : new Date();
      d.setDate(d.getDate() + n);
      this.go('page', await call('journal_name', { date: ymd(d) }));
    };
    ({
      'go/journals': () => this.go('journals'),
      'go/all-pages': () => this.go('pages'),
      'go/todos': () => this.go('todos'),
      // the calendar opens under the date button that's showing (the active side's, or the phone bar's),
      // else under that side's Forward (a narrow window or a phone page hides the date button)
      'go/date': () => {
        const nav = `#histbar .hb-nav[data-p="${this.tabs.act}"]`;
        const at = [`${nav} [data-a="date"]`, '#topbar [data-a="date"]', `${nav} [data-h="forward"]`, '#topbar [data-h="forward"]'].map((s) => $(s)).find((b) => b?.offsetParent);
        this.goToDate(at || this.pane.el.querySelector('.view') || document.body);
      },
      'go/next-journal': () => shiftDay(1),
      'go/prev-journal': () => shiftDay(-1),
      'sidebar/open-today-page': async () => this.go('page', await call('journal_name', { date: today() })),
      'ui/toggle-left-sidebar': () => this.toggleSidebar(),
      'ui/toggle-wide-mode': () => this.setWide(),
      'editor/toggle-open-blocks': () => this.mainOutline()?.toggleAll(),
      'ui/text-bigger': () => this.toast(`Text size ${Math.round(this.textSize(this.textSize() + 0.05) * 100)}%`, 900),
      'ui/text-smaller': () => this.toast(`Text size ${Math.round(this.textSize(this.textSize() - 0.05) * 100)}%`, 900),
      'ui/text-reset': () => { this.textSize(1); this.toast('Text size 100%', 900); },
    })[name]?.();
  }

  renderSideLists() {
    this.hideMore?.(); // (the ⋯ was beside an entry drawn again now)
    const el = $('#recent');
    if (el) el.innerHTML = this.recent().map((n) => `<a href="#" data-page="${esc(n)}">${this.icon(n)}${esc(n)}</a>`).join('') || '<span class="note" style="padding:0 8px;font-size:13px">Pages you open show up here.</span>';
    const favs = this.summary?.config?.favorites || [];
    const f = $('#favs');
    if (f) f.innerHTML = favs.length ? `<div class="side-sec" data-sec="favs"><button type="button" class="side-h side-fold" aria-expanded="true">Favourites</button><div class="side-list">${favs.map((n) => `<a href="#" data-page="${esc(n)}">${this.icon(n)}${esc(n)}</a>`).join('')}</div></div>` : '';
    this.applySideFolds();
    requestAnimationFrame(() => this.fitRecent());
  }

  /** What the sidebar adds to the chrome (wide windows on the laptop, except dragging favourites):
   *  - the handles to make it wider or narrower and to move the line between two sides (grip);
   *  - a ⋯ beside the Favourites or Recent entry under the mouse, for the same small menu as a
   *    right-click on it (tabs.js linkMenu: a new tab, the other side, and for a favourite "Remove
   *    from favourites", linkItems). One button for all entries, put beside the one pointed at;
   *  - Favourites in another order by dragging one (a finger: hold it first), or Alt+Shift+↑/↓ on
   *    the one with the keyboard; written to config.edn (moveFavourite). */
  sideExtras(side) {
    // the handles: the sizes go on the page (boot.js puts them back before anything shows)
    const root = document.documentElement.style;
    const sideGrip = h('div', 'side-grip');
    const splitGrip = h('div', 'split-grip');
    $('#app').append(sideGrip);
    $('#col').append(splitGrip);
    this.grip(sideGrip, {
      label: 'Sidebar width', unit: 'px', step: 16,
      pos: (x) => x, // (the sidebar starts at the window's left edge)
      get: () => side.getBoundingClientRect().width,
      min: () => SIDE_MIN, max: () => Math.max(SIDE_MIN, Math.min(SIDE_MAX, innerWidth / 2)),
      set: (w) => root.setProperty('--side-w', Math.round(w) + 'px'),
      keep: (w) => store.set('sideW', Math.round(w)),
      reset: () => { root.removeProperty('--side-w'); store.set('sideW', null); },
    });
    const col = $('#col');
    const colBox = () => col.getBoundingClientRect();
    this.grip(splitGrip, {
      label: 'Width of the two sides', unit: '%', step: 0.02,
      pos: (x) => (x - colBox().left) / colBox().width,
      get: () => { const r = colBox(); return ($('#main').getBoundingClientRect().width) / r.width; },
      min: () => Math.min(0.5, PANE_MIN / colBox().width), max: () => Math.max(0.5, 1 - PANE_MIN / colBox().width),
      set: (f) => root.setProperty('--split', f.toFixed(4)),
      keep: (f) => store.set('splitAt', +f.toFixed(4)),
      reset: () => { root.removeProperty('--split'); store.set('splitAt', null); },
    });

    // the ⋯ beside the entry under the mouse
    const more = h('button', 'side-more', ICON.more);
    more.type = 'button';
    more.tabIndex = -1; // (the keyboard has the context-menu key on the entry itself)
    more.hidden = true;
    document.body.append(more);
    let at = null; // the entry it's beside
    const hideMore = () => { more.hidden = true; at = null; };
    side.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch' || this.favDrag) return;
      const a = this.tabs.on && e.target.closest?.('#favs .side-list a, #recent a');
      if (!a) { hideMore(); return; }
      if (a === at && !more.hidden) return;
      at = a;
      const r = a.getBoundingClientRect();
      more.setAttribute('aria-label', `More for “${a.dataset.page}”`);
      more.title = 'Open in a new tab, to the side…';
      Object.assign(more.style, { left: r.right - 28 + 'px', top: r.top + (r.height - 24) / 2 + 'px' });
      more.hidden = false;
    });
    side.addEventListener('pointerleave', (e) => { if (!more.contains(e.relatedTarget)) hideMore(); });
    more.addEventListener('pointerleave', (e) => { if (!side.contains(e.relatedTarget)) hideMore(); });
    side.addEventListener('scroll', hideMore, true); // (Favourites scrolls on its own)
    more.addEventListener('mousedown', (e) => e.preventDefault()); // (the note being typed in keeps the keyboard)
    more.addEventListener('click', () => { if (at?.isConnected) this.tabs.linkMenu(at, more.getBoundingClientRect()); });
    this.hideMore = hideMore;

    // Favourites in another order: drag one up or down
    side.addEventListener('pointerdown', (e) => {
      const a = e.button === 0 && e.target.closest?.('#favs .side-list a');
      if (a) this.dragFavourite(a, e);
    });
    side.addEventListener('dragstart', (e) => { if (e.target.closest?.('#favs a')) e.preventDefault(); }); // (not the browser's own dragging of links)
    side.addEventListener('click', (e) => { // (the click that ends a drag doesn't open the page)
      if (this.favDragged && e.target.closest?.('#favs a')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    side.addEventListener('contextmenu', (e) => { if (e.target.closest?.('#favs a') && matchMedia('(pointer: coarse)').matches) e.preventDefault(); });
    side.addEventListener('keydown', (e) => {
      const a = e.target.closest?.('#favs .side-list a');
      if (!a || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      e.stopPropagation();
      const names = this.favNames();
      const k = names.indexOf(a.dataset.page), j = k + (e.key === 'ArrowUp' ? -1 : 1);
      if (k < 0 || j < 0 || j >= names.length) return;
      names.splice(j, 0, names.splice(k, 1)[0]);
      this.moveFavourite(names, a.dataset.page);
    });
  }
  /** The favourites as the sidebar lists them. */
  favNames() { return [...document.querySelectorAll('#favs .side-list a')].map((a) => a.dataset.page); }
  /** Drag a favourite (a, pressed with event e) up or down the list: it moves among the others as the
   *  pointer goes; let go to keep that order, Esc to put it back. A mouse moves it at once; a finger
   *  holds it first (450 ms, as for a note's dot), so a swipe still scrolls the list. */
  dragFavourite(a, e) {
    const list = a.parentElement, id = e.pointerId, y0 = e.clientY, touch = e.pointerType === 'touch';
    const before = this.favNames();
    let on = false, held = !touch, timer = 0;
    const lift = () => {
      on = true;
      this.favDrag = true;
      this.hideMore?.();
      a.classList.add('fav-drag');
      document.body.classList.add('fav-dragging');
      if (touch) navigator.vibrate?.(10);
    };
    if (touch) timer = setTimeout(() => { held = true; lift(); }, 450);
    // a finger that has lifted the entry: the list mustn't scroll under it
    const noScroll = (ev) => { if (on && ev.cancelable) ev.preventDefault(); };
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!on) {
        if (!held || Math.abs(ev.clientY - y0) < 4) { if (touch && Math.abs(ev.clientY - y0) > 10) end(false); return; }
        lift();
      }
      // the entry goes before the first other one whose middle is below the pointer
      const rows = [...list.children].filter((x) => x !== a);
      const next = rows.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (next ? a.nextElementSibling !== next : list.lastElementChild !== a) list.insertBefore(a, next ?? null);
      const lr = list.getBoundingClientRect(); // near the ends of a long list: it scrolls
      if (ev.clientY < lr.top + 16) list.scrollTop -= 8; else if (ev.clientY > lr.bottom - 16) list.scrollTop += 8;
    };
    const end = (keep) => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('keydown', esc, true);
      list.removeEventListener('touchmove', noScroll);
      if (!on) return;
      this.favDrag = false;
      a.classList.remove('fav-drag');
      document.body.classList.remove('fav-dragging');
      this.favDragged = true; // (the click that follows isn't a click on the page)
      setTimeout(() => { this.favDragged = false; }, 0);
      const names = this.favNames();
      if (keep && names.join('\n') !== before.join('\n')) this.moveFavourite(names, a.dataset.page);
      else this.renderSideLists(); // (put back)
    };
    const up = (ev) => { if (ev.pointerId === id) end(true); };
    const cancel = (ev) => { if (ev.pointerId === id) end(false); };
    const esc = (ev) => { if (ev.key === 'Escape' && on) { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('keydown', esc, true);
    list.addEventListener('touchmove', noScroll, { passive: false });
  }
  /** Favourites in this order (names: all of them, as listed): config.edn's :favorites is changed in
   *  place (the core moves only the names, everything else in the file stays as it was). focus: the
   *  entry to keep the keyboard on (moved with Alt+Shift+↑/↓). */
  async moveFavourite(names, focus = null) {
    const had = document.activeElement?.closest?.('#favs a') ? focus : null;
    try {
      const favs = await call('reorder_favorites', { names });
      if (this.summary?.config) this.summary.config.favorites = favs;
    } catch (e) { this.toast(`The favourites couldn’t be put in that order: ${e?.message ?? e}`, 5000); }
    this.renderSideLists();
    if (had) [...document.querySelectorAll('#favs .side-list a')].find((x) => x.dataset.page === had)?.focus();
  }
  /** A drag handle (role separator) for a size: the sidebar's width, or where two sides meet.
   *  o: pos(clientX) → the size the pointer means, get() → the size now, min()/max(), set(v) (each frame
   *  while dragging), keep(v) (once let go), reset() (a double-click), step (← →), label, unit. */
  grip(el, o) {
    el.setAttribute('role', 'separator');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-label', o.label);
    el.tabIndex = 0;
    el.title = 'Drag to change the width; double-click for the usual width';
    let want = null, raf = 0;
    const say = (v) => el.setAttribute('aria-valuenow', String(Math.round(o.unit === '%' ? v * 100 : v)));
    const to = (v) => {
      want = Math.min(o.max(), Math.max(o.min(), v));
      say(want);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (want !== null) o.set(want); });
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // (no text selected, and the note being typed in keeps the keyboard)
      el.setPointerCapture?.(e.pointerId);
      const off = o.get() - o.pos(e.clientX);
      document.body.classList.add('resizing');
      const move = (ev) => to(o.pos(ev.clientX) + off);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        if (want !== null) { cancelAnimationFrame(raf); raf = 0; o.set(want); o.keep(want); want = null; }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => { o.reset(); say(o.get()); });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      to(o.get() + d * o.step);
      cancelAnimationFrame(raf); raf = 0;
      o.set(want); o.keep(want); want = null;
    });
    el.addEventListener('focus', () => say(o.get()));
  }

  /** Recent shows only as many pages as fit, so the sidebar never needs a scroll bar. */
  fitRecent() {
    const el = $('#recent');
    if (!el) return;
    const items = [...el.querySelectorAll('a')];
    items.forEach((a) => (a.hidden = false));
    if (!items.length || el.closest('.folded')) return;
    const limit = el.getBoundingClientRect().bottom + 0.5;
    for (const a of items) if (a.getBoundingClientRect().bottom > limit) a.hidden = true;
  }

  /** Link colour, how page links look and fonts chosen in Settings (this device only), on top of the look. */
  applyTextStyle() {
    const s = document.documentElement.style;
    const link = store.get('linkColor', '');
    if (link) { s.setProperty('--link', link); s.setProperty('--link-line', `color-mix(in srgb, ${link} 45%, transparent)`); }
    else { s.removeProperty('--link'); s.removeProperty('--link-line'); }
    const ls = store.get('linkStyle', ''); // underline | color | brackets (skins.css); '' = the look's own
    if (ls) document.documentElement.dataset.links = ls; else delete document.documentElement.dataset.links;
    for (const [k, v] of [['fontBody', '--font-body'], ['fontTitle', '--font-title']]) {
      const f = store.get(k, '');
      if (f) s.setProperty(v, f); else s.removeProperty(v);
    }
  }

  /** Favourites and Recent can be folded away (clicking their heading); the choice is remembered. */
  applySideFolds() {
    const shut = store.get('sideShut', {});
    document.querySelectorAll('#side .side-sec').forEach((sec) => {
      const closed = !!shut[sec.dataset.sec];
      sec.classList.toggle('folded', closed);
      sec.querySelector('.side-fold')?.setAttribute('aria-expanded', String(!closed));
    });
  }

  /** After the app itself changed a page from a list (a to-do ticked in "Scheduled & deadline", a
   *  mention linked): the same page open in an outline shows it too (a rescan doesn't see the app's
   *  own writes), so editing it next doesn't look like a clash. */
  async reloadPage(name) {
    const n = String(name).toLowerCase();
    for (const o of this.outlines) if (o.name.toLowerCase() === n) await o.reload();
  }

  async rescan() {
    if (!this.vaultOpen || this.scanning) return;
    this.scanning = true;
    try {
      const changed = await call('rescan');
      if (changed.length) {
        this.refCache?.clear();
        // the settings changed on disk (Logseq, the phone) or arrived late: taken in by the core
        // (core app.rs take_config); journals named or kept elsewhere now: every side drawn again
        const was = changed.includes('logseq/config.edn') && this.summary?.config;
        if (was) await this.useSettings(await call('summary'));
        const c = this.summary?.config;
        const moved = was && ['pages_dir', 'journals_dir', 'journal_title_format', 'journal_file_format'].some((k) => was[k] !== c[k]);
        await this.refreshNames();
        const set = new Set(changed);
        if (moved) await Promise.all(this.tabs.panes.map((p) => this.draw(p)));
        else for (const o of this.outlines) if (set.has(o.path)) await o.reload();
        this.widgetTasksSoon();
      }
    } catch { /* ignore */ }
    this.scanning = false;
  }

  /** The Android widget shows to-dos due today (scheduled for today or with today's deadline), sent
   *  by the app; nothing runs in the background. Overdue ones belong in the app, not on the home
   *  screen under today's date. Ones written in today's journal show there already. */
  widgetTasksSoon() {
    if (!window.LeanAndroid?.setWidgetTasks) return;
    clearTimeout(this.wtT);
    this.wtT = setTimeout(async () => {
      try {
        const tasks = await call('tasks', { done: false });
        const t = today().join();
        // asked each time: the app may have stayed open past midnight
        const todayPage = String(await call('journal_name', { date: today() })).toLowerCase();
        const due = tasks.filter((x) => [x.scheduled, x.deadline].some((w) => w && w.date.join() === t) && x.page.toLowerCase() !== todayPage)
          .slice(0, 20).map((x) => ({ text: x.text.split('\n')[0], page: x.page }));
        window.LeanAndroid.setWidgetTasks(JSON.stringify({ day: today().join('-'), tasks: due })); // the day: stale ones aren't shown
      } catch { /* ignore */ }
    }, 1500);
  }

  /** Android's Back button / gesture, handled here instead of by the browser inside the app: first
   *  close whatever is open (a pop-up, the search, the menu drawer, the note being edited), then go
   *  back a page, and only at the start leave the app (to the home screen, like other apps). */
  async listenBack() {
    const listen = isAndroid && window.__TAURI__?.app?.onBackButtonPress;
    if (!listen) return; // elsewhere, or an older app: Back simply goes back a page
    try { await listen(() => this.onBack()); } catch { /* Android's own Back keeps working */ }
  }
  onBack() {
    if (this.closeTop()) return;
    if (!this.back()) window.LeanAndroid?.leave?.();
  }
  /** Close the top-most open thing; false if nothing was open. */
  closeTop() {
    // pop-ups close on Escape (their own handlers, which also stop it going further)
    const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const lightbox = $('.modal-back.lightbox');
    if (lightbox) { lightbox.remove(); return true; }
    if ($('.modal-back, .pop.datepick, .pop.menu')) { esc(); return true; }
    if (!this.preview.el.hidden) { this.preview.hide(); return true; }
    if (this.closeLooks) { this.closeLooks(); return true; }
    if (!$('#search').hidden) { this.closeSearch(); return true; }
    if (this.ac.isOpen) { this.ac.close(); return true; }
    if (this.find.isOpen) { this.find.close(); return true; }
    if (document.body.classList.contains('drawer')) { document.body.classList.remove('drawer'); return true; }
    const wlBack = $('.welcome .wl-back'); // (the welcome screen's folder picker: back to its first step)
    if (wlBack) { wlBack.click(); return true; }
    const o = this.outlines.find((x) => x.cur !== null || x.sel);
    if (o) { o.stopEdit(); o.clearSel(); document.activeElement?.blur(); this.updateToolbar(); return true; }
    const a = document.activeElement; // e.g. the page properties box, a filter
    if (a?.matches?.('.pt-name[contenteditable]')) { esc(); return true; } // (a page's name being changed: as it was)
    if (a?.matches?.('input, textarea')) { a.blur(); return true; }
    return false;
  }

  async start() {
    this.listenBack();
    // script problems go to the problems log (Settings), each one at most once a minute, so a
    // problem that repeats can't push everything else out of it
    const sent = new Map();
    const log = (msg) => {
      if (/ResizeObserver loop/.test(msg)) return; // the browser's notice about late resizes: harmless
      const now = Date.now();
      if (now - (sent.get(msg) ?? -1e9) < 60000 || sent.size > 200) return;
      sent.set(msg, now);
      call('log', { msg }).catch(() => {});
    };
    window.addEventListener('error', (e) => log(`script: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
    window.addEventListener('unhandledrejection', (e) => log(`script: ${e.reason?.stack || e.reason}`));
    // a web link never opens a window of the app's own (Build 34, the security review): a middle
    // click, or Ctrl/Shift/Alt with a click, on one sends it to the browser, as a plain click does
    if (isApp) {
      const web = (e) => e.target.closest?.('a[href]:not([href^="#"])');
      document.addEventListener('mousedown', (e) => { if (e.button === 1 && web(e)) e.preventDefault(); }, true);
      const away = (e) => {
        const a = web(e);
        if (!a || (e.type === 'click' && !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) || (e.type === 'auxclick' && e.button !== 1)) return;
        e.preventDefault();
        e.stopPropagation();
        this.openUrl(a.getAttribute('href'));
      };
      document.addEventListener('click', away, true);
      document.addEventListener('auxclick', away, true);
    }
    this.buildChrome();
    this.renderSideLists();
    initFileDrop(this); // pictures and files dragged in from Explorer (filedrop.js)
    await this.openVault();
    // the tabs as they were, else one on the address the app started with, or the journals (that
    // first page replaces the address: adding it would leave a step behind it that Back goes to)
    this.tabs.start(this.vaultOpen);
    for (const p of this.tabs.panes) this.draw(p, { restore: true });
    // Android: coming back from the permission screen (or, on Android 7–10, the permission dialog
    // closing: "lean-access", from MainActivity). Open the folder again if it couldn't be read before
    // (without "all files access" it opens with no notes in it), then redraw.
    const reopen = async () => {
      if (!window.LeanAndroid) return;
      if (this.vaultOpen && !(this.noAccess && window.LeanAndroid.hasAllFilesAccess())) return;
      if (store.get('vault', '')) await this.openVault();
      this.route();
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reopen(); });
    document.addEventListener('lean-access', reopen);
    this.checkUpdate();
    this.started = true;
    this.openShortcut(); // Android: opened from a long-press shortcut on the app icon?
    // Windows: started by a page or note link (links.rs)
    if (isApp && !isAndroid) call('start_link').then((l) => l && this.openLink(l)).catch(() => {});
  }

  /** Android's long-press shortcuts on the app icon: "Today" and "Search" ("Add note" opens the
   *  pop-up, not the app). MainActivity keeps the one picked until the page takes it: at the end of
   *  start(), or straight away (from onNewIntent) when the app was already open. */
  async openShortcut() {
    if (!this.started) return; // still starting: start() asks once the notes are open
    const kind = window.LeanAndroid?.takeShortcut?.();
    if (!kind || !this.vaultOpen) return;
    if (/^leanoutliner:/i.test(kind)) { this.openLink(kind); return; } // (a page or note link)
    if (kind === 'today') { this.closeSearch(); this.go('page', await call('journal_name', { date: today() })); }
    else if (kind === 'search') { this.openSearch(); window.LeanAndroid.showKeyboard?.(); }
  }

  async openVault() {
    const path = store.get('vault', '');
    this.vaultOpen = false;
    // Android without "all files access": the folder opens, but no notes can be read in it
    this.noAccess = !!window.LeanAndroid && !window.LeanAndroid.hasAllFilesAccess();
    if (!path) return;
    try {
      await this.useSettings(await call('open', { path }));
      this.vaultOpen = true;
      this.vaultError = null;
      await this.refreshNames();
      this.renderSideLists();
      this.widgetTasksSoon();
    } catch (e) {
      this.vaultError = String(e?.message ?? e);
    }
  }

  /** The open folder's summary and its settings (config.edn): the shortcut keys, and the phone
   *  widget's and quick capture's settings. */
  async useSettings(s) {
    s.today = await call('journal_name', { date: today() });
    this.summary = s;
    const c = s.config;
    this.keyMap = { ...DEFAULT_KEYS };
    for (const [action, keys] of c.shortcuts || []) this.keyMap[action] = keys;
    window.LeanAndroid?.setWidgetConfig?.(s.root, c.journals_dir, c.journal_file_format, c.journal_title_format);
    this.sendCaptureConfig();
  }

  /** The phone's share pop-up and widget use the same quick capture format as the app. */
  sendCaptureConfig() {
    const c = this.summary?.config;
    if (!c || !window.LeanAndroid?.setCaptureConfig) return;
    window.LeanAndroid.setCaptureConfig(JSON.stringify({ text: c.capture_text, media: c.capture_media, today: c.capture_today, page: c.capture_page, pagesDir: c.pages_dir }));
  }

  /** Is there a newer build on the public repo’s releases page? Asked at most once a day at start;
   *  maxAge: how old an answer may be (About asks again when the last answer is over a minute old,
   *  its "Check" button always: true). */
  async checkUpdate(maxAge = 864e5) {
    if (!isApp) return null;
    let ver = '';
    try { ver = await window.__TAURI__.app.getVersion(); } catch { return null; }
    this.version = ver;
    const last = store.get('updateCheck', { at: 0, latest: null });
    let latest = last.latest;
    if (maxAge === true || Date.now() - last.at > maxAge) {
      try {
        // (given up after 8 s: About waits for this answer, and a bad network mustn't leave it blank)
        const r = await fetch('https://api.github.com/repos/srikanth-iyer/thinky/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
        // (with each file's size: About says how much "Update now" downloads)
        if (r.ok) { const j = await r.json(); latest = { tag: j.tag_name, url: j.html_url, sizes: Object.fromEntries((j.assets || []).map((a) => [a.name, a.size])) }; }
      } catch { /* offline */ }
      store.set('updateCheck', { at: Date.now(), latest });
    }
    const n = (s) => Number(String(s || '').match(/(\d+)$/)?.[1] || 0);
    this.latest = latest;
    const newer = !!latest && n(latest.tag) > n(ver);
    $('#update').hidden = !newer;
    document.documentElement.classList.toggle('has-update', newer); // (a small spark on Settings and About: app.css)
    return newer;
  }
}

const app = new App();
window.leanApp = app; // handy for debugging, and for the Android back button
app.start();

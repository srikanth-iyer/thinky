// Small floating things: suggestions while typing ([[links]], #tags, /commands, properties),
// the date picker, confirm/prompt boxes, and link previews on hover.

import { call, today, nowTime } from './api.js';
import { esc, renderBlock, propsHtml } from './render.js';
import { createCalendar } from './calendar.js';
import { h } from './dom.js';

/** A note folded in its page (collapsed:: true on a line after its first; editor.js foldedIn). */
const COLLAPSED = /\ncollapsed:: true(?=\n|$)/;

/** Place a floating element under (or above) a rectangle, inside the window. */
export function place(el, r) {
  el.style.left = '0px'; el.style.top = '0px';
  const w = el.offsetWidth, ht = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + ht > window.innerHeight - 8 && r.top - ht - 6 > 8) top = r.top - ht - 6;
  el.style.top = Math.max(8, Math.min(top, window.innerHeight - ht - 8)) + 'px';
  el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
}

/** Where the caret is in a textarea, as a small rectangle (for placing popups). */
export function caretRect(ta) {
  const r = ta.getBoundingClientRect();
  const cs = getComputedStyle(ta);
  const mirror = h('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'borderLeftWidth', 'boxSizing', 'whiteSpace', 'overflowWrap', 'wordBreak']) mirror.style[p] = cs[p];
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', whiteSpace: 'pre-wrap' });
  mirror.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = h('span'); mark.textContent = '​';
  mirror.append(mark);
  document.body.append(mirror);
  const m = mark.getBoundingClientRect();
  mirror.remove();
  return { left: m.left, right: m.left + 2, top: m.top, bottom: m.bottom };
}

// ---------------------------------------------------------------------------
// Suggestions while typing

// [label, hint, id (default: the label), more words it's found by (Logseq's names for it…)]. Also the
// command list's (commands.js); the "/" list itself leaves out NOT_IN_SLASH.
export const SLASH = [
  ['TODO', 'to-do'], ['DOING', 'to-do'], ['LATER', 'to-do'], ['NOW', 'to-do'], ['WAITING', 'to-do'], ['DONE', 'to-do'], ['CANCELED', 'to-do', 'CANCELED', 'cancelled'],
  ['Scheduled date…', 'date', 'sched'], ['Deadline…', 'date', 'deadline'], ['Date…', 'link to a day', 'date', 'date picker'],
  ['Today', 'link', 'today'], ['Tomorrow', 'link', 'tomorrow'], ['Yesterday', 'link', 'yesterday'], ['Current time', 'insert', 'time'],
  ['Page link', '[[ ]]', 'link', 'page reference'], ['Block reference', '(( ))', 'blockref', 'block ref'], ['Link…', 'address, label', 'weblink', 'url web http'],
  ['Tag', '#', 'tag'], ['Template…', 'insert', 'template'], ['Image…', 'from a file', 'image', 'picture photo'], ['Image link…', 'a picture on the web', 'imagelink', 'picture url'],
  ['Upload a file…', 'any file', 'upload', 'upload an asset attach pdf'],
  ['Bold', '**', 'bold'], ['Italic', '*', 'italic'], ['Highlight', '^^', 'mark'], ['Strikethrough', '~~', 'strike'], ['Underline', '<ins>', 'underline'],
  ['Code', '`', 'code'], ['Code block', '```', 'codeblock'], ['Formula', '$ $', 'math', 'latex math'],
  ['Heading 1', '#', 'h1', 'h1'], ['Heading 2', '##', 'h2', 'h2'], ['Heading 3', '###', 'h3', 'h3'],
  ['Heading 4', '####', 'h4', 'h4'], ['Heading 5', '#####', 'h5', 'h5'], ['Heading 6', '######', 'h6', 'h6'],
  ['Number list', 'this note', 'numlist', 'numbered ordered'], ['Number children', 'its sub-notes', 'numkids', 'numbered ordered list'],
  ['Priority A', '[#A]', 'pa'], ['Priority B', '[#B]', 'pb'], ['Priority C', '[#C]', 'pc'],
];

/** To-do words the "/" list doesn't offer (he asked, Oct 29: only TODO, DOING, DONE and CANCELED there).
 *  Notes that have them still show and work as before, and the command list (Ctrl+Shift+P) keeps them. */
const NOT_IN_SLASH = new Set(['LATER', 'NOW', 'WAITING']);

export class Suggest {
  constructor(app) {
    this.app = app;
    this.el = h('ul');
    this.el.id = 'ac';
    this.el.hidden = true;
    this.el.setAttribute('role', 'listbox');
    document.body.append(this.el);
    // An item is chosen when it's tapped (the finger lifted where it went down), not as soon as a
    // finger lands on it, so the list scrolls under a finger (he asked, Oct 30); moving more than
    // 10px, or the browser taking the touch over for scrolling, chooses nothing. A mouse press acts
    // at once, as before. The press never takes the focus (the keyboard stays up).
    let press = null;
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const li = e.target.closest('li[data-k]');
      if (!li) return;
      if (e.pointerType === 'mouse') { this.choose(+li.dataset.k); return; }
      press = { li, id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    this.el.addEventListener('pointermove', (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) press = null;
    });
    this.el.addEventListener('pointercancel', () => { press = null; });
    this.el.addEventListener('scroll', () => { press = null; }, { passive: true });
    this.el.addEventListener('pointerup', (e) => {
      const p = press;
      press = null;
      if (p && e.pointerId === p.id && e.target.closest('li[data-k]') === p.li) this.choose(+p.li.dataset.k);
    });
    this.valCache = new Map();
  }
  get isOpen() { return !this.el.hidden && !!this.items; }

  /** Look at the text before the caret and open the matching list (or close). */
  check(outline) {
    this.seq = (this.seq || 0) + 1; // each keystroke: a list still loading for an older one is dropped
    const ta = outline.ta;
    if (!ta || ta.selectionStart !== ta.selectionEnd) return this.close();
    const c = ta.selectionStart;
    const before = ta.value.slice(0, c);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    let m;
    // the toolbar's "/" (Outline.openCommands): the list stays open while what follows it is a word
    if (this.slashAt && this.slashAt.ta === ta) {
      const at = this.slashAt.at;
      if (c > at && ta.value[at] === '/' && /^(?!\s)[^/\n]{0,24}$/.test(before.slice(at + 1))) return this.slash(outline, at, before.slice(at + 1));
      this.slashAt = null;
    }
    if ((m = before.match(/\[\[([^[\]\n]*)$/))) return this.pages(outline, 'link', c - m[1].length, m[1]);
    // "((" (not right after a letter or digit: f((x)) is maths) and words: a note to refer to
    if ((m = before.match(/(?:^|[^\p{L}\p{N}])\(\(([^()\n]{0,80})$/u))) return this.blocks(outline, c - m[1].length, m[1]);
    if ((m = before.match(/(?:^|[\s(,])#([^\s#[\],;!?"'(){}<>`]*)$/))) return this.pages(outline, 'tag', c - m[1].length, m[1]);
    // "/" after a space or at a line's start, and what follows it (spaces too, as in Logseq: "/block ref";
    // the list closes when nothing matches)
    if ((m = line.match(/(?:^|\s)\/((?!\s)[^/\n]{0,24})$/)) && !/https?:\/\/\S*$/.test(line)) return this.slash(outline, c - m[1].length - 1, m[1]);
    if ((m = line.match(/^\s*::([\p{L}\p{N}_.\/-]*)$/u))) return this.propKeys(outline, c - m[1].length - 2, m[1]);
    if ((m = line.match(/^\s*([\p{L}\p{N}_.\/-]+)::\s?(.*)$/u))) {
      const items = m[2].split(',');
      const q = items[items.length - 1].trimStart();
      return this.propValues(outline, m[1].toLowerCase(), c - q.length, q);
    }
    this.close();
  }

  /** "[[" / "#" and words: pages found as the search box finds them (the core's `search_pages`:
   *  accents, any word order, typos); a page's other names (alias::) count as the page, as in
   *  Logseq: "SB → Sourdough Bread". Nothing typed: recent pages first. */
  async pages(outline, kind, start, q) {
    const seq = this.seq, cur = outline.cur;
    const ql = q.trim().toLowerCase();
    const names = this.app.names.filter((n) => n.exists || n.refs);
    let items;
    if (!ql) {
      const list = [...new Set(this.app.recent().concat(names.filter((n) => !n.journal).map((n) => n.name)))].slice(0, 8);
      items = list.map((n) => ({ label: n, html: esc(n), value: n }));
    } else {
      let hits = [];
      try { hits = await call('search_pages', { q, limit: 8 }); } catch { /* none */ }
      if (seq !== this.seq || !outline.ta || outline.cur !== cur) return; // typing went on (or another note opened) meanwhile: the newest keystroke decides
      items = hits.map((x) => x.alias
        ? { label: x.alias, html: `${esc(x.alias)} <span class="new">→ ${esc(x.page)}</span>`, value: x.alias }
        : { label: x.page, html: esc(x.page), value: x.page });
      const exact = names.some((x) => x.name.toLowerCase() === ql || x.aliases?.some((a) => a.toLowerCase() === ql));
      if (!exact && !items.some((it) => it.value.toLowerCase() === ql)) items.push({ label: q, html: `<span class="new">New page:</span> ${esc(q)}`, value: q });
    }
    this.show(outline, kind, start, q, items);
  }

  slash(outline, start, q) {
    const ql = q.toLowerCase();
    // (all of them: the list scrolls, as Logseq's does)
    // the ones whose name starts with what's typed first, then a word of it ("/link": Link…, then Page link)
    const rank = (label) => { const l = label.toLowerCase(); return l.startsWith(ql) ? 0 : l.split(/\s+/).some((w) => w.startsWith(ql)) ? 1 : 2; };
    const items = SLASH.filter(([label, , , more = '']) => !NOT_IN_SLASH.has(label)).filter(([label, , , more = '']) => !ql || `${label} ${more}`.toLowerCase().includes(ql) || label.toLowerCase().replace(/[^a-z]/g, '').startsWith(ql))
      .sort((a, b) => (ql ? rank(a[0]) - rank(b[0]) : 0))
      .map(([label, hint, id]) => ({ label, html: `${esc(label)}<span class="hint">${esc(hint)}</span>`, value: id || label }));
    if (!items.length) return this.close();
    this.show(outline, 'slash', start, q, items);
  }

  /** "((" and words: notes holding them, to refer to one (Logseq's block search). Not the note being
   *  typed in. Nothing typed yet: a line saying what to do. */
  async blocks(outline, start, q) {
    const seq = this.seq;
    // (notes only from two letters on: one would find nearly all, and Enter would pick one by chance)
    if ([...q.trim()].length < 2) return this.show(outline, 'block', start, q, [], 'Type words from the note to refer to');
    let hits = [];
    try { hits = await call('search_blocks', { q }); } catch { /* none */ }
    if (seq !== this.seq || !outline.ta) return;
    const self = outline.cur === null ? -1 : outline.lineOf(outline.cur);
    const items = hits.filter((x) => !(x.page.toLowerCase() === outline.name.toLowerCase() && x.line === self)).slice(0, 10).map((x) => {
      const first = x.text.split('\n')[0];
      const r = renderBlock(first);
      const t = document.createElement('template'); // (inert: its pictures don't load)
      t.innerHTML = r.html;
      const words = (r.marker ? r.marker + ' ' : '') + (t.content.textContent.trim() || first);
      return { label: words, html: `<span class="ac-w">${esc(words)}</span><span class="ac-p">${esc(x.page)}</span>`, value: x, cls: 'ac-blk' };
    });
    this.show(outline, 'block', start, q, items, items.length ? '' : 'No note has these words');
  }

  async propKeys(outline, start, q) {
    const seq = this.seq;
    if (!this.keys) {
      this.keysLoading ??= call('props').then((r) => r.map(([k]) => k), () => []);
      this.keys = await this.keysLoading;
      if (seq !== this.seq) return; // typing went on meanwhile: the newest keystroke decides
    }
    const ql = q.toLowerCase();
    const list = this.keys.filter((k) => k.includes(ql) && k !== 'id' && k !== 'collapsed').slice(0, 10);
    const items = list.map((k) => ({ label: k, html: esc(k), value: k }));
    if (q && !list.includes(ql)) items.push({ label: q, html: `<span class="new">New property:</span> ${esc(q)}`, value: q });
    if (!items.length) return this.close();
    if (outline.ta) this.show(outline, 'propkey', start, q, items);
  }

  async propValues(outline, key, start, q) {
    if (['id', 'collapsed', 'title'].includes(key)) return this.close();
    const seq = this.seq;
    // one request per property, shared by the keystrokes that arrive while it loads
    if (!this.valCache.has(key)) this.valCache.set(key, call('prop_values', { key }).then((r) => r.map(([v]) => v), () => []));
    const vals = await this.valCache.get(key);
    if (seq !== this.seq) return;
    const ql = q.toLowerCase();
    const list = vals.filter((v) => v.toLowerCase().includes(ql) && v.toLowerCase() !== ql).slice(0, 8);
    if (!list.length || !outline.ta) return this.close();
    this.show(outline, 'propval', start, q, list.map((v) => ({ label: v, html: esc(v), value: v })));
  }

  /** note: a quiet line instead of choices (items empty: nothing to pick yet). */
  show(outline, kind, start, q, items, note = '') {
    this.outline = outline; this.kind = kind; this.start = start; this.q = q; this.items = items; this.sel = 0;
    this.el.innerHTML = items.map((it, k) => `<li role="option" data-k="${k}" aria-selected="${k === 0}"${it.cls ? ` class="${it.cls}"` : ''}>${it.html}</li>`).join('')
      + (note ? `<li class="ac-note">${esc(note)}</li>` : '');
    this.el.hidden = false;
    place(this.el, caretRect(outline.ta));
  }

  close() { this.seq = (this.seq || 0) + 1; this.el.hidden = true; this.items = null; this.slashAt = null; }

  handleKey(e) {
    if (!this.isOpen) return false;
    if (!this.items.length) { // (only a note so far: Esc closes it, other keys go on as usual)
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      this.close();
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length;
      [...this.el.children].forEach((li, k) => li.setAttribute('aria-selected', k === this.sel));
      this.el.children[this.sel]?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.choose(this.sel); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  }

  choose(k) {
    const it = this.items?.[k];
    const o = this.outline;
    if (!it || !o?.ta) return this.close();
    const ta = o.ta;
    const c = ta.selectionStart;
    const kind = this.kind;
    this.close();
    if (kind === 'link') {
      const close = ta.value.slice(c, c + 2) === ']]' ? 2 : 0;
      ta.setRangeText(it.value + ']]', this.start, c + close, 'end');
    } else if (kind === 'tag') {
      const tag = /[\s,;!?"'()[\]{}<>`#]/.test(it.value) ? `[[${it.value}]]` : it.value;
      const space = /\s/.test(ta.value[c] ?? ' ') ? '' : ' ';
      ta.setRangeText(tag + space, this.start, c, 'end');
    } else if (kind === 'propkey') {
      ta.setRangeText(`${it.value}:: `, this.start, c, 'end');
    } else if (kind === 'propval') {
      ta.setRangeText(it.value, this.start, c, 'end');
    } else if (kind === 'template') {
      o.insertTemplate(it.value);
      return;
    } else if (kind === 'block') {
      o.referTo(it.value, this.start, c);
      return;
    } else if (kind === 'slash') {
      ta.setRangeText('', this.start, c, 'end'); // remove the "/command" typed
      o.typed();
      o.command(it.value);
      return;
    }
    o.typed();
    if (kind === 'propkey') this.check(o);
  }
}

// ---------------------------------------------------------------------------
// Date picker

/**
 * Pick a day. anchor: a rectangle to show it by. opts: { title, date, repeat: bool (offer a
 * repeat choice), marks: days to dot (a Set of keyOf(date), or a promise of one), note }.
 * Resolves {date, repeat} or null.
 */
export function pickDate(anchor, opts = {}) {
  return new Promise((resolve) => {
    const box = h('div', 'pop datepick');
    box.setAttribute('role', 'dialog');
    box.innerHTML = `<div class="pop-title">${esc(opts.title || 'Pick a day')}</div><div class="cal-host"></div>
      <div class="quick"><button type="button" data-q="0">Today</button><button type="button" data-q="1">Tomorrow</button>
      <button type="button" data-q="mon">Next Monday</button><button type="button" data-q="7">In a week</button></div>
      ${opts.note ? `<p class="pop-note">${esc(opts.note)}</p>` : ''}
      ${opts.repeat ? `<label class="rep">Repeat <select><option value="">never</option><option value=".+1d">every day</option>
        <option value=".+1w">every week</option><option value="++1m">every month</option><option value="++1y">every year</option></select></label>` : ''}`;
    document.body.append(box);
    const done = (v) => { cleanup(); resolve(v); };
    const repeat = () => box.querySelector('select')?.value || null;
    const cal = createCalendar(box.querySelector('.cal-host'), { date: opts.date || today(), today: today(), marks: opts.marks instanceof Set ? opts.marks : undefined, onPick: (d) => done({ date: d, repeat: repeat() }) });
    opts.marks?.then?.((m) => { if (m && box.isConnected) { cal.setMarks(m); cal.focusDay(); } });
    box.querySelector('.quick').onclick = (e) => {
      const q = e.target.dataset.q;
      if (q === undefined) return;
      const dt = new Date();
      if (q === 'mon') dt.setDate(dt.getDate() + (((8 - dt.getDay()) % 7) || 7));
      else dt.setDate(dt.getDate() + Number(q));
      done({ date: [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()], repeat: repeat() });
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    const onDown = (e) => {
      if (box.contains(e.target)) return;
      // a press on the button that opened it closes it (its click then doesn't open it again)
      if (opts.button?.contains(e.target)) opts.button.dataset.closedAt = String(Date.now());
      done(null);
    };
    const cleanup = () => { box.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    place(box, anchor);
    cal.focusDay();
  });
}

// ---------------------------------------------------------------------------
// Confirm and prompt boxes (instead of the browser's, which can't be styled)

function modal(inner, setup) {
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const box = h('div', 'modal', inner);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    back.append(box);
    document.body.append(back);
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(null); });
    setup(box, done);
  });
}

export function confirmBox({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false }) {
  return modal(`<h2>${esc(title)}</h2><div class="note">${body}</div>
    <div class="btn-row end"><button class="btn ghost" data-v="0">${esc(cancel)}</button><button class="btn${danger ? ' danger' : ''}" data-v="1">${esc(ok)}</button></div>`,
  (box, done) => {
    box.onclick = (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v !== undefined) done(v === '1'); };
    box.querySelector('[data-v="1"]').focus();
  }).then((v) => !!v);
}

export function promptBox({ title, body = '', value = '', ok = 'OK', placeholder = '' }) {
  return modal(`<h2>${esc(title)}</h2>${body ? `<div class="note">${body}</div>` : ''}
    <input class="filter" value="${esc(value)}" placeholder="${esc(placeholder)}">
    <div class="btn-row end"><button class="btn ghost" data-v="0">Cancel</button><button class="btn" data-v="1">${esc(ok)}</button></div>`,
  (box, done) => {
    const input = box.querySelector('input');
    box.onclick = (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v !== undefined) done(v === '1' ? input.value : null); };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(input.value); } };
    input.focus();
    input.select();
  });
}

/** A small form: fields [{label, value, placeholder, type}] (text boxes, the first takes the
 *  keyboard; Enter in the last one is OK). Resolves the values in order, or null. */
export function formBox({ title, body = '', fields, ok = 'OK' }) {
  return modal(`<h2>${esc(title)}</h2>${body ? `<div class="note">${body}</div>` : ''}
    ${fields.map((f, k) => `<label class="field">${esc(f.label)}<input class="filter" data-f="${k}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"></label>`).join('')}
    <div class="btn-row end"><button class="btn ghost" data-v="0">Cancel</button><button class="btn" data-v="1">${esc(ok)}</button></div>`,
  (box, done) => {
    const inputs = [...box.querySelectorAll('input')];
    const values = () => inputs.map((x) => x.value);
    box.onclick = (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v !== undefined) done(v === '1' ? values() : null); };
    inputs.forEach((x, k) => { x.onkeydown = (e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (k === inputs.length - 1) done(values()); else inputs[k + 1].focus(); }; });
    inputs[0]?.focus();
    inputs[0]?.select();
  });
}

/** A short list of actions under a button (anchor: anything with getBoundingClientRect, such as a
 *  point where he right-clicked). items: [{label, run, danger, hint}], '-' between groups, {head} a
 *  small heading over a group; hint:
 *  quiet words on the right, such as the keys that do the same. opts.keep: what has the keyboard
 *  keeps it (the phone toolbar's menus: the editing box and its keyboard stay up); opts.cls: a class. */
export function menu(anchor, items, opts = {}) {
  const box = h('ul', 'pop menu' + (opts.cls ? ' ' + opts.cls : ''));
  box.innerHTML = items.map((it, k) => it === '-' ? '<li class="nm-sep" role="separator"></li>' : it.head ? `<li class="m-head" role="presentation">${esc(it.head)}</li>` : `<li><button type="button" data-k="${k}" class="${it.danger ? 'danger' : ''}">${it.hint ? `<span class="mhint">${esc(it.hint)}</span>` : ''}${esc(it.label)}</button></li>`).join('');
  if (opts.keep) box.addEventListener('pointerdown', (e) => e.preventDefault());
  document.body.append(box);
  const close = () => { box.remove(); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('beforeinput', close, true); };
  const onDown = (e) => { if (!box.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  if (opts.keep) document.addEventListener('beforeinput', close, true); // (typing goes on: the menu goes)
  box.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { close(); items[+b.dataset.k].run(); } };
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true); }, 0);
  place(box, anchor.getBoundingClientRect());
  if (!opts.keep) box.querySelector('button')?.focus();
}

// ---------------------------------------------------------------------------
// The note menu (Logseq's block menu: editor.js openMenu says what's in it and what each does)

const COLOR_NAMES = { yellow: 'Yellow', red: 'Red', pink: 'Pink', green: 'Green', blue: 'Blue', purple: 'Purple', gray: 'Grey' };

/**
 * A menu for a note, by rectangle r: a row of background colours (o.colors, the one now o.color, ''
 * for none), a row of headings (H1–H6, auto, none; the one now o.heading: 1–6, 'auto' or 0; null:
 * no row), then o.items ({id, label, hint, danger, checked}, '-' between groups). o.pick(kind, value)
 * runs a choice: ('color', name or ''), ('heading', 1–6, 'auto' or 0), ('item', id). Real buttons,
 * easy to tap on phones (one column, rows close together, app.css); arrow keys move
 * between them; Esc, Android's Back (App.closeTop) and a press
 * outside close it (a tap outside does nothing else). o.focus: it takes the keyboard (else what had
 * it keeps it: the editing box on a phone keeps its keyboard). o.touch: opened by a finger. o.closed(picked)
 * when it closes.
 */
export function noteMenu(r, o) {
  const box = h('div', 'pop menu note-menu');
  box.setAttribute('role', 'menu');
  box.setAttribute('aria-label', 'Note');
  let html = '';
  if (o.colors) {
    html += `<div class="nm-row nm-colors" role="group" aria-label="Background colour">${o.colors.map((c) => `<button type="button" role="menuitemradio" class="nm-sw" data-c="${c}" style="--sw: var(--hl-${c})" aria-checked="${o.color === c}" aria-label="${COLOR_NAMES[c] || c}" title="${COLOR_NAMES[c] || c}"></button>`).join('')}`
      + `<button type="button" role="menuitemradio" class="nm-sw nm-none" data-c="" aria-checked="${!o.colors.includes(o.color)}" aria-label="No colour" title="No colour"></button></div>`;
  }
  if (o.heading !== null && o.heading !== undefined) {
    const hb = (v, label, text) => `<button type="button" role="menuitemradio" class="nm-h" data-h="${v}" aria-checked="${o.heading === v}" aria-label="${label}" title="${label}"><span>${text}</span></button>`;
    html += `<div class="nm-row nm-heads" role="group" aria-label="Heading">${[1, 2, 3, 4, 5, 6].map((n) => hb(n, `Heading ${n}`, `H${n}`)).join('')}`
      + hb('auto', 'Auto heading (its size follows its level)', 'H<small>a</small>') + hb(0, 'No heading', '<s>H</s>') + '</div>';
  }
  if (html) html += '<div class="nm-sep" role="separator"></div>';
  html += o.items.map((it, k) => it === '-' ? '<div class="nm-sep" role="separator"></div>'
    : `<button type="button" role="${it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}" class="nm-item${it.danger ? ' danger' : ''}" data-k="${k}"${it.checked === undefined ? '' : ` aria-checked="${!!it.checked}"`}><span class="nm-l">${esc(it.label)}</span>${it.hint ? `<span class="nm-hint">${esc(it.hint)}</span>` : ''}</button>`).join('');
  box.innerHTML = html;
  document.body.append(box);
  const before = document.activeElement;
  let open = true;
  const close = (picked = false) => {
    if (!open) return;
    open = false;
    const had = box.contains(document.activeElement);
    box.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('beforeinput', typed, true);
    window.removeEventListener('hashchange', away);
    if (had && !picked && before && before !== document.body && before.isConnected) before.focus?.({ preventScroll: true });
    o.closed?.(picked);
  };
  const away = () => close(); // (another page: the note it's for has left the screen)
  window.addEventListener('hashchange', away);
  // typing goes on elsewhere (the editing box keeps the keyboard when a finger opens it): it closes
  const typed = (e) => { if (!box.contains(e.target)) close(); };
  document.addEventListener('beforeinput', typed, true);
  // a press outside closes it; after a finger's, the tap doesn't also act on what's under it
  const onDown = (e) => {
    if (box.contains(e.target)) return;
    if (e.pointerType !== 'mouse') {
      const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
      document.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', eat, true), 700);
    }
    close();
  };
  const buttons = () => [...box.querySelectorAll('button')];
  const lineOf = (b) => (b.closest('.nm-row') ?? b); // (a row of swatches or headings is one line)
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    // a key while the menu doesn't have the keyboard: it's for what does (the menu goes)
    if (!box.contains(document.activeElement)) { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const all = buttons();
    const cur = all.indexOf(document.activeElement);
    const go = (b) => { if (b) { e.preventDefault(); e.stopPropagation(); b.focus(); } };
    if (e.key === 'Home') return go(all[0]);
    if (e.key === 'End') return go(all.at(-1));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (cur < 0) return go(all[0]);
      const row = all[cur].closest('.nm-row');
      if (!row) return;
      const rb = [...row.querySelectorAll('button')], k = rb.indexOf(all[cur]);
      return go(rb[(k + (e.key === 'ArrowRight' ? 1 : rb.length - 1)) % rb.length]);
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (cur < 0) return go(e.key === 'ArrowDown' ? all[0] : all.at(-1));
      const lines = [...new Set(all.map(lineOf))];
      const l = lines.indexOf(lineOf(all[cur]));
      const next = lines[(l + (e.key === 'ArrowDown' ? 1 : lines.length - 1)) % lines.length];
      if (!next.matches('.nm-row')) return go(next);
      // into a row: the same place along it (swatches and headings line up)
      const col = all[cur].closest('.nm-row') ? [...all[cur].parentElement.children].indexOf(all[cur]) : 0;
      const nb = [...next.querySelectorAll('button')];
      return go(nb[Math.min(col, nb.length - 1)]);
    }
  };
  // the buttons never take the focus from a mouse or a finger: the editing box keeps it (and a
  // phone its keyboard); the keyboard still reaches them when the menu has the focus
  box.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  const opened = Date.now();
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    // (opened by a finger let go: a click that comes with that finger, where the menu now is, isn't a choice)
    if (!b || (o.touch && Date.now() - opened < 350)) return;
    close(true);
    if (b.dataset.c !== undefined) o.pick('color', b.dataset.c);
    else if (b.dataset.h !== undefined) o.pick('heading', b.dataset.h === 'auto' ? 'auto' : +b.dataset.h);
    else o.pick('item', o.items[+b.dataset.k].id);
  });
  // (it never opens during a press or a key's capture phase: right away is safe)
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  place(box, r);
  if (o.focus) (box.querySelector('.nm-item') ?? box.querySelector('button'))?.focus({ preventScroll: true });
  return close;
}

// ---------------------------------------------------------------------------
// Link preview on hover (laptop only)

/** A page's notes in a small box: hovering a link or tag for a moment (laptop), or pressing and
 *  holding one (phone; a short tap still opens the page, and the box has an "Open" button). The box
 *  shows the whole page (read-only, folded notes' sub-notes left out) and scrolls; long pages are drawn
 *  a part at a time as it's scrolled (body). Laptop: the mouse can go into the box (to scroll it, or
 *  click a link or the title to open that page); it closes a moment after the mouse leaves both the
 *  link and the box. app: for opening a page (App.go, so Ctrl/Shift+click open a tab or the side). */
export class Preview {
  constructor(app = null) {
    this.app = app;
    this.el = h('div', 'pop preview');
    this.el.hidden = true;
    document.body.append(this.el);
    const linkAt = (t) => {
      const a = t?.closest?.('a[data-page]');
      return a && a.closest('.bc, .refhit, .props, .tagged') && !a.closest('.pop') ? a : null;
    };
    if (matchMedia('(pointer: coarse)').matches) { this.touch(linkAt); return; }
    // The box doesn't take the mouse at once (.pv-wait: clicks and the wheel go through to the notes
    // under it), so moving down past it to click a note still clicks that note. It takes the mouse once
    // it's entered on purpose: the pointer resting in it (300 ms), or the wheel turned over it (which
    // then scrolls the box, not the page). Before that, the pointer going anywhere but the link or the
    // box closes it quickly (120 ms); after, a moment after leaving both (300 ms).
    let shownFor = null; // the link the box is showing
    let dwell = 0;
    const hideIn = (ms) => { clearTimeout(this.t); this.t = setTimeout(() => this.hide(), ms); };
    const inBox = (x, y) => { const r = this.el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    this.take = () => { clearTimeout(dwell); dwell = 0; this.el.classList.remove('pv-wait'); document.removeEventListener('wheel', wheel, { capture: true }); };
    const wheel = (e) => {
      if (this.el.hidden || !this.el.classList.contains('pv-wait') || !inBox(e.clientX, e.clientY)) return;
      e.preventDefault();
      this.take();
      this.el.querySelector('.pv-body')?.scrollBy(0, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
    };
    this.waiting = () => { this.el.classList.add('pv-wait'); document.addEventListener('wheel', wheel, { capture: true, passive: false }); };
    this.stopWaiting = () => { clearTimeout(dwell); dwell = 0; document.removeEventListener('wheel', wheel, { capture: true }); };
    document.addEventListener('mousemove', (e) => {
      if (this.el.hidden || !this.el.classList.contains('pv-wait')) return;
      if (inBox(e.clientX, e.clientY)) { clearTimeout(this.t); if (!dwell) dwell = setTimeout(this.take, 300); return; }
      clearTimeout(dwell); dwell = 0;
      if (shownFor?.isConnected && shownFor.contains(e.target)) clearTimeout(this.t); else hideIn(120);
    }, { passive: true });
    document.addEventListener('mouseover', (e) => {
      if (this.el.contains(e.target)) { clearTimeout(this.t); return; } // (into the box, once it takes the mouse: it stays)
      const a = linkAt(e.target);
      if (a && a === shownFor && !this.el.hidden) { clearTimeout(this.t); return; } // (back on its link)
      if (!a || (!this.el.hidden && this.el.classList.contains('pv-wait') && inBox(e.clientX, e.clientY))) return; // (a link under the box)
      clearTimeout(this.t);
      this.t = setTimeout(() => { shownFor = a; this.show(a); }, 550);
    });
    document.addEventListener('mouseout', (e) => {
      const to = e.relatedTarget;
      if (this.el.hidden) { if (e.target.closest?.('a[data-page]')) clearTimeout(this.t); return; } // (not shown yet: not now)
      if (!to) { hideIn(300); return; } // (out of the window)
      if (this.el.classList.contains('pv-wait')) return; // (the pointer's moves decide, above)
      if (this.el.contains(to) || (shownFor && to.closest?.('a[data-page]') === shownFor)) return;
      if (this.el.contains(e.target) || e.target.closest?.('a[data-page]') === shownFor) hideIn(300);
    });
    document.addEventListener('pointerdown', (e) => { if (this.el.contains(e.target)) return; clearTimeout(this.t); this.hide(); }, true);
    // the title, or a link in the box: that page opens (the box's words are read-only)
    this.el.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-page], .pop-title');
      if (!a) return;
      e.preventDefault();
      const name = a.dataset.page ?? this.name;
      this.hide();
      if (name) this.open(name);
    });
    this.el.addEventListener('mousedown', (e) => { if (e.target.closest('a')) e.preventDefault(); }); // (the note being typed in keeps the keyboard)
  }
  open(name) {
    if (this.app) this.app.go('page', name);
    else location.hash = '#/page/' + encodeURIComponent(name);
  }

  touch(linkAt) {
    this.el.classList.add('touch');
    let from = null; // where the finger went down
    let held = null; // the link just held, until its finger lifts (the click that follows is ignored)
    let closedAt = 0, closedFrom = null; // a tap elsewhere only closes it: that tap's click isn't passed on
    const stop = () => { clearTimeout(this.t); from = null; };
    document.addEventListener('touchstart', (e) => {
      if (!this.el.hidden && !e.target.closest('.preview')) { this.hide(); closedAt = Date.now(); closedFrom = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } // a tap elsewhere closes it
      const a = linkAt(e.target);
      if (!a || e.touches.length > 1) { stop(); return; }
      from = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      clearTimeout(this.t);
      this.t = setTimeout(() => { held = { a, at: 0 }; navigator.vibrate?.(10); this.show(a, true); }, 450);
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (from && Math.hypot(e.touches[0].clientX - from.x, e.touches[0].clientY - from.y) > 10) stop(); // scrolling or swiping
      // the touch that closed it goes on to scroll: no click follows, so the next tap counts again
      if (closedAt && Math.hypot(e.touches[0].clientX - closedFrom.x, e.touches[0].clientY - closedFrom.y) > 10) closedAt = 0;
    }, { passive: true });
    document.addEventListener('touchend', () => { stop(); if (held) held.at = Date.now(); }, { passive: true });
    document.addEventListener('touchcancel', stop, { passive: true });
    document.addEventListener('click', (e) => {
      const swallow = (held && e.target.closest?.('a') === held.a && Date.now() - held.at < 800) || Date.now() - closedAt < 800;
      if (swallow) { e.preventDefault(); e.stopPropagation(); }
      held = null;
      closedAt = 0;
    }, true);
    // no Android menu for a long-pressed link (copy address…): holding shows the preview instead
    document.addEventListener('contextmenu', (e) => { if (linkAt(e.target)) e.preventDefault(); });
    // a tap on it closes it; on "Open" (or a link in it) that page opens
    this.el.addEventListener('click', (e) => {
      e.preventDefault();
      const b = e.target.closest('[data-open], a[data-page]');
      this.hide();
      const name = b?.dataset.open ?? b?.dataset.page;
      if (name) this.open(name);
    });
  }

  async show(a, touch = false) {
    const name = a.dataset.page;
    const seq = this.seq = (this.seq || 0) + 1;
    let pv;
    try { pv = await call('page', { name }); } catch { return; }
    if (seq !== this.seq || !a.isConnected || (!touch && !a.matches(':hover'))) return;
    // the page's notes, without the sub-notes of folded ones (as the page shows them)
    const blocks = [];
    let cut = Infinity;
    for (const b of pv.doc.blocks) {
      if (b.depth > cut) continue;
      cut = COLLAPSED.test(b.text) ? b.depth : Infinity;
      blocks.push(b);
    }
    const row = (b) => {
      const r = renderBlock(b.text);
      return `<div class="pv-b" style="--d:${Math.min(b.depth, 5)}">${r.marker ? `<span class="mk">${esc(r.marker)}</span>` : ''}${r.html}${propsHtml(r.props)}</div>`;
    };
    const refs = pv.refs.reduce((s, g) => s + g.hits.length, 0);
    const icon = (pv.info.props || []).find(([k]) => k === 'icon')?.[1]?.trim();
    const open = touch ? `<button type="button" class="btn small" data-open="${esc(pv.info.name)}">Open</button>` : '';
    this.name = pv.info.name;
    this.el.innerHTML = `<div class="pop-title" title="Open this page"><span>${icon && [...icon].length <= 8 ? esc(icon) + ' ' : ''}${esc(pv.info.name)}</span>${open}</div><div class="pv-body">${blocks.length ? '' : '<p class="note">Nothing written on this page yet.</p>'}</div><p class="note">${refs} linked reference${refs === 1 ? '' : 's'}</p>`;
    // drawn a part at a time: the first notes now, more each time it's scrolled near the end
    const body = this.el.querySelector('.pv-body');
    let k = 0;
    const more = () => {
      const end = Math.min(blocks.length, k + (k ? 150 : 60));
      const html = blocks.slice(k, end).map(row).join('');
      body.insertAdjacentHTML('beforeend', html);
      if (html.includes(' data-ref="')) this.app?.blockRefs?.(body); // ((block references)): the note's words
      k = end;
    };
    more();
    body.onscroll = () => { if (k < blocks.length && body.scrollTop + body.clientHeight > body.scrollHeight - 400) more(); };
    if (!touch) this.waiting?.(); // (laptop: it takes the mouse only once entered on purpose)
    this.el.hidden = false;
    place(this.el, a.getBoundingClientRect());
  }
  hide() { this.el.hidden = true; this.seq = (this.seq || 0) + 1; this.stopWaiting?.(); }
}

export { nowTime };

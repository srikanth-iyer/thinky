// Small floating things: suggestions while typing ([[links]], #tags, /commands, properties),
// the date picker, confirm/prompt boxes, and link previews on hover.

import { call, today, nowTime } from './api.js';
import { esc, renderBlock, propsHtml, stampText } from './render.js';
import { createCalendar } from './calendar.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

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

const SLASH = [
  ['TODO', 'to-do'], ['DOING', 'to-do'], ['LATER', 'to-do'], ['NOW', 'to-do'], ['WAITING', 'to-do'], ['DONE', 'to-do'],
  ['Scheduled date…', 'date', 'sched'], ['Deadline…', 'date', 'deadline'], ['Date…', 'link to a day', 'date'],
  ['Today', 'link', 'today'], ['Tomorrow', 'link', 'tomorrow'], ['Yesterday', 'link', 'yesterday'], ['Current time', 'insert', 'time'],
  ['Page link', '[[ ]]', 'link'], ['Tag', '#', 'tag'], ['Template…', 'insert', 'template'], ['Image…', 'from a file', 'image'],
  ['Bold', '**', 'bold'], ['Italic', '*', 'italic'], ['Highlight', '^^', 'mark'], ['Strikethrough', '~~', 'strike'],
  ['Code', '`', 'code'], ['Code block', '```', 'codeblock'], ['Formula', '$ $', 'math'],
  ['Heading 1', '#', 'h1'], ['Heading 2', '##', 'h2'], ['Heading 3', '###', 'h3'],
  ['Priority A', '[#A]', 'pa'], ['Priority B', '[#B]', 'pb'], ['Priority C', '[#C]', 'pc'],
];

export class Suggest {
  constructor(app) {
    this.app = app;
    this.el = h('ul');
    this.el.id = 'ac';
    this.el.hidden = true;
    this.el.setAttribute('role', 'listbox');
    document.body.append(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const li = e.target.closest('li[data-k]');
      if (li) this.choose(+li.dataset.k);
    });
    this.valCache = new Map();
  }
  get isOpen() { return !this.el.hidden && !!this.items; }

  /** Look at the text before the caret and open the matching list (or close). */
  check(outline) {
    const ta = outline.ta;
    if (!ta || ta.selectionStart !== ta.selectionEnd) return this.close();
    const c = ta.selectionStart;
    const before = ta.value.slice(0, c);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    let m;
    if ((m = before.match(/\[\[([^[\]\n]*)$/))) return this.pages(outline, 'link', c - m[1].length, m[1]);
    if ((m = before.match(/(?:^|[\s(,])#([^\s#[\],;!?"'(){}<>`]*)$/))) return this.pages(outline, 'tag', c - m[1].length, m[1]);
    if ((m = line.match(/(?:^|\s)\/([^\s/]{0,24})$/)) && !/https?:\/\/\S*$/.test(line)) return this.slash(outline, c - m[1].length - 1, m[1]);
    if ((m = line.match(/^\s*::([\p{L}\p{N}_.\/-]*)$/u))) return this.propKeys(outline, c - m[1].length - 2, m[1]);
    if ((m = line.match(/^\s*([\p{L}\p{N}_.\/-]+)::\s?(.*)$/u))) {
      const items = m[2].split(',');
      const q = items[items.length - 1].trimStart();
      return this.propValues(outline, m[1].toLowerCase(), c - q.length, q);
    }
    this.close();
  }

  pages(outline, kind, start, q) {
    const ql = q.toLowerCase();
    let names = this.app.names.filter((n) => n.exists || n.refs);
    let list;
    if (!ql) list = this.app.recent().concat(names.filter((n) => !n.journal).map((n) => n.name));
    else {
      list = names.map((n) => n.name).filter((n) => n.toLowerCase().includes(ql))
        .sort((a, b) => (b.toLowerCase().startsWith(ql) - a.toLowerCase().startsWith(ql)) || a.length - b.length);
    }
    list = [...new Set(list)].slice(0, 8);
    const exact = names.some((x) => x.name.toLowerCase() === ql);
    const items = list.map((n) => ({ label: n, html: esc(n), value: n }));
    if (q && !exact && !list.some((n) => n.toLowerCase() === ql)) items.push({ label: q, html: `<span class="new">New page:</span> ${esc(q)}`, value: q });
    this.show(outline, kind, start, q, items);
  }

  slash(outline, start, q) {
    const ql = q.toLowerCase();
    const items = SLASH.filter(([label]) => !ql || label.toLowerCase().includes(ql) || label.toLowerCase().replace(/[^a-z]/g, '').startsWith(ql))
      .slice(0, 12).map(([label, hint, id]) => ({ label, html: `${esc(label)}<span class="hint">${esc(hint)}</span>`, value: id || label }));
    if (!items.length) return this.close();
    this.show(outline, 'slash', start, q, items);
  }

  async propKeys(outline, start, q) {
    if (!this.keys) { try { this.keys = (await call('props')).map(([k]) => k); } catch { this.keys = []; } }
    const ql = q.toLowerCase();
    const list = this.keys.filter((k) => k.includes(ql) && k !== 'id' && k !== 'collapsed').slice(0, 10);
    const items = list.map((k) => ({ label: k, html: esc(k), value: k }));
    if (q && !list.includes(ql)) items.push({ label: q, html: `<span class="new">New property:</span> ${esc(q)}`, value: q });
    if (!items.length) return this.close();
    if (outline.ta) this.show(outline, 'propkey', start, q, items);
  }

  async propValues(outline, key, start, q) {
    if (['id', 'collapsed', 'title'].includes(key)) return this.close();
    if (!this.valCache.has(key)) {
      this.valCache.set(key, []);
      try { this.valCache.set(key, (await call('prop_values', { key })).map(([v]) => v)); } catch { /* none */ }
    }
    const ql = q.toLowerCase();
    const list = this.valCache.get(key).filter((v) => v.toLowerCase().includes(ql) && v.toLowerCase() !== ql).slice(0, 8);
    if (!list.length || !outline.ta) return this.close();
    this.show(outline, 'propval', start, q, list.map((v) => ({ label: v, html: esc(v), value: v })));
  }

  show(outline, kind, start, q, items) {
    this.outline = outline; this.kind = kind; this.start = start; this.q = q; this.items = items; this.sel = 0;
    this.el.innerHTML = items.map((it, k) => `<li role="option" data-k="${k}" aria-selected="${k === 0}">${it.html}</li>`).join('');
    this.el.hidden = false;
    place(this.el, caretRect(outline.ta));
  }

  close() { this.el.hidden = true; this.items = null; }

  handleKey(e) {
    if (!this.isOpen) return false;
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
    const onDown = (e) => { if (!box.contains(e.target)) done(null); };
    const cleanup = () => { box.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    place(box, anchor);
    cal.focusDay();
  });
}

export const stampFor = (date, repeat) => stampText(date, null, repeat);

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

/** A short list of actions under a button. items: [{label, run, danger}] */
export function menu(anchor, items) {
  const box = h('ul', 'pop menu');
  box.innerHTML = items.map((it, k) => `<li><button type="button" data-k="${k}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button></li>`).join('');
  document.body.append(box);
  const close = () => { box.remove(); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  const onDown = (e) => { if (!box.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  box.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { close(); items[+b.dataset.k].run(); } };
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true); }, 0);
  place(box, anchor.getBoundingClientRect());
  box.querySelector('button')?.focus();
}

// ---------------------------------------------------------------------------
// Link preview on hover (laptop only)

export class Preview {
  constructor() {
    if (matchMedia('(pointer: coarse)').matches) return;
    this.el = h('div', 'pop preview');
    this.el.hidden = true;
    document.body.append(this.el);
    document.addEventListener('mouseover', (e) => {
      const a = e.target.closest?.('a[data-page]');
      if (!a || !a.closest('.bc, .refhit, .props, .tagged') || a.closest('.pop')) return;
      clearTimeout(this.t);
      this.t = setTimeout(() => this.show(a), 550);
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest?.('a[data-page]')) { clearTimeout(this.t); this.hide(); }
    });
    document.addEventListener('pointerdown', () => { clearTimeout(this.t); this.hide(); }, true);
  }
  async show(a) {
    const name = a.dataset.page;
    let pv;
    try { pv = await call('page', { name }); } catch { return; }
    if (!a.isConnected || !a.matches(':hover')) return;
    const blocks = pv.doc.blocks.slice(0, 12);
    const body = blocks.map((b) => {
      const r = renderBlock(b.text);
      return `<div class="pv-b" style="--d:${Math.min(b.depth, 5)}">${r.marker ? `<span class="mk">${esc(r.marker)}</span>` : ''}${r.html}${propsHtml(r.props)}</div>`;
    }).join('');
    const refs = pv.refs.reduce((s, g) => s + g.hits.length, 0);
    this.el.innerHTML = `<div class="pop-title">${esc(pv.info.name)}</div>${body || '<p class="note">Nothing written on this page yet.</p>'}
      ${pv.doc.blocks.length > 12 ? '<p class="note">…</p>' : ''}<p class="note">${refs} linked reference${refs === 1 ? '' : 's'}</p>`;
    this.el.hidden = false;
    place(this.el, a.getBoundingClientRect());
  }
  hide() { if (this.el) this.el.hidden = true; }
}

export { nowTime };

// App shell: routing, views (journals, page, lists, settings), search, autocomplete,
// mobile toolbar, background refresh. Rendering of blocks lives in editor.js / render.js.

import { call, today, store, isApp } from './api.js';
import { Outline } from './editor.js';
import { renderBlock, propsHtml, visibleProps, esc } from './render.js';

// Looks. Colours here only paint the small swatches; the look itself lives in skins.css.
export const SKINS = [
  { id: 'calm', name: 'Calm', note: 'The first look: light, teal, lifted cards', bg: '#F4F6F3', dot: '#0B7B66' },
  { id: 'night', name: 'Night', note: 'The Board’s dark look, labels set into the page', bg: '#1B1E24', dot: '#86C4B3' },
  { id: 'paper', name: 'Paper', note: 'Ruled notebook, red margin, highlighter', bg: '#F4F2EC', dot: '#B23A26' },
  { id: 'sticker', name: 'Sticker', note: 'The Board’s sticker look: bold outlines', bg: '#FDF6E6', dot: '#6C4CF0' },
  { id: 'stickernight', name: 'Sticker night', note: 'Sticker, dimmed for evenings', bg: '#2B2838', dot: '#BDB0F5' },
  { id: 'screenplay', name: 'Screenplay', note: 'A script page: Courier type, scene headings', bg: '#E6E7EA', dot: '#141414' },
  { id: 'grimoire', name: 'Grimoire', note: 'Midnight blue and gold leaf, a book of tales', bg: '#10142A', dot: '#D9B35B' },
  { id: 'automaton', name: 'Automaton', note: 'Lab notebook with a rule 30 strip', bg: '#EEF0F4', dot: '#3047D9' },
  { id: 'azulejo', name: 'Azulejo', note: 'Cobalt tiles on white', bg: '#F3F6FB', dot: '#1D4FA3' },
];
const SKIN_IDS = new Set(SKINS.map((s) => s.id));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ICON = {
  journals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  pages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/></svg>',
  tags: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/></svg>',
  props: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h3M11 7h8M5 12h3M11 12h8M5 17h3M11 17h8"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.6" fill="currentColor"/></svg>',
  logo: '<svg viewBox="0 0 1024 1024"><rect x="64" y="64" width="896" height="896" rx="208" fill="var(--accent)"/><g fill="var(--surface)"><circle cx="332" cy="300" r="58"/><rect x="430" y="270" width="330" height="60" rx="30"/><circle cx="452" cy="512" r="46"/><rect x="534" y="488" width="226" height="48" rx="24"/><circle cx="332" cy="724" r="58"/><rect x="430" y="694" width="270" height="60" rx="30"/></g></svg>',
  outdent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6H10M20 12h-7M20 18H10M7 9l-3 3 3 3"/></svg>',
  indent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6H10M20 12h-7M20 18H10M4 9l3 3-3 3"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const pageLink = (name, label) => `<a href="#" data-page="${esc(name)}">${esc(label ?? name)}</a>`;
const dateOf = ([y, m, d]) => new Date(y, m - 1, d);
const ymd = (dt) => [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];

// ---------------------------------------------------------------------------
// Autocomplete for [[links]] and #tags inside the block being edited
class Autocomplete {
  constructor(app) {
    this.app = app;
    this.el = h('ul');
    this.el.id = 'ac';
    this.el.hidden = true;
    this.el.setAttribute('role', 'listbox');
    document.body.append(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const li = e.target.closest('li');
      if (li) this.choose(+li.dataset.k);
    });
  }
  check(outline) {
    const ta = outline.ta;
    if (!ta) return this.close();
    const c = ta.selectionStart;
    const before = ta.value.slice(0, c);
    let m = before.match(/\[\[([^[\]\n]*)$/);
    if (m) return this.open(outline, 'link', c - m[1].length, m[1]);
    m = before.match(/(?:^|[\s(,])#([^\s#[\],;!?"'(){}<>`]*)$/);
    if (m) return this.open(outline, 'tag', c - m[1].length, m[1]);
    this.close();
  }
  open(outline, kind, start, q) {
    this.outline = outline; this.kind = kind; this.start = start; this.q = q;
    const ql = q.toLowerCase();
    let names = this.app.names;
    if (!ql) names = this.app.recent().concat(names.filter((n) => !n.journal).map((n) => n.name));
    else {
      names = names.map((n) => n.name).filter((n) => n.toLowerCase().includes(ql))
        .sort((a, b) => (b.toLowerCase().startsWith(ql) - a.toLowerCase().startsWith(ql)) || a.length - b.length);
    }
    const items = [...new Set(names)].slice(0, 8);
    if (q && !items.some((n) => n.toLowerCase() === ql)) items.push(q);
    this.items = items;
    if (!items.length) return this.close();
    this.sel = 0;
    this.el.innerHTML = items.map((n, k) => `<li role="option" data-k="${k}" aria-selected="${k === 0}">${
      n === q && !this.app.names.some((x) => x.name.toLowerCase() === ql) ? `<span class="new">New page:</span> ${esc(n)}` : esc(n)}</li>`).join('');
    const r = outline.ta.getBoundingClientRect();
    this.el.hidden = false;
    const top = Math.min(r.bottom + 4, window.innerHeight - this.el.offsetHeight - 8);
    this.el.style.top = Math.max(8, top) + 'px';
    this.el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - this.el.offsetWidth - 8)) + 'px';
  }
  close() { this.el.hidden = true; this.items = null; }
  handleKey(e) {
    if (this.el.hidden || !this.items) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length;
      [...this.el.children].forEach((li, k) => li.setAttribute('aria-selected', k === this.sel));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.choose(this.sel); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  }
  choose(k) {
    const name = this.items?.[k];
    const o = this.outline;
    if (!name || !o?.ta) return this.close();
    const ta = o.ta;
    const c = ta.selectionStart;
    if (this.kind === 'link') {
      const close = ta.value.slice(c, c + 2) === ']]' ? 2 : 0;
      ta.setRangeText(name + ']]', this.start, c + close, 'end');
    } else {
      const tag = /\s/.test(name) ? `[[${name}]]` : name;
      const space = /\s/.test(ta.value[c] ?? ' ') ? '' : ' ';
      ta.setRangeText(tag + space, this.start, c, 'end');
    }
    this.close();
    o.blocks[o.cur].text = ta.value;
    o.autosize();
    o.markDirty();
  }
}

// ---------------------------------------------------------------------------
class App {
  constructor() {
    this.outlines = [];
    this.names = [];
    this.active = null;
    this.ac = new Autocomplete(this);
    this.pendingLine = null;
  }

  // ----- small services used by editors -----
  toast(msg, ms = 3200) {
    let t = $('#toast');
    if (!t) { t = h('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => (t.hidden = true), ms);
  }
  openUrl(url) {
    const T = window.__TAURI__;
    if (T?.opener?.openUrl) T.opener.openUrl(url).catch((e) => this.toast(String(e)));
    else window.open(url, '_blank', 'noopener');
  }
  editing(outline, on) {
    this.active = on ? outline : (this.active === outline ? null : this.active);
    const narrow = window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;
    $('#toolbar').hidden = !(this.active && narrow);
  }
  saved(outline) {
    window.LeanAndroid?.refreshWidget?.();
    if (!this.names.some((n) => n.name.toLowerCase() === outline.name.toLowerCase())) this.refreshNames();
  }
  recent() { return store.get('recent', []); }
  pushRecent(name) {
    const r = [name, ...this.recent().filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 10);
    store.set('recent', r);
    this.renderRecent();
  }

  async refreshNames() {
    try {
      const pages = await call('pages');
      this.names = pages.map(([name, journal, exists]) => ({ name, journal, exists }));
    } catch { /* vault not open */ }
  }

  // ----- routing -----
  go(kind, arg, opts = {}) {
    this.pendingLine = opts.line ?? null;
    const hash = '#/' + kind + (arg !== undefined && arg !== null ? '/' + encodeURIComponent(arg) : '');
    if (location.hash === hash) this.route();
    else location.hash = hash;
  }

  async route() {
    document.body.classList.remove('drawer');
    await Promise.all(this.outlines.map((o) => { o.stopEdit(); return o.flush(); }));
    this.outlines = [];
    this.active = null;
    $('#toolbar').hidden = true;
    this.ac.close();
    const [, kind = 'journals', ...rest] = location.hash.split('/');
    const arg = rest.length ? decodeURIComponent(rest.join('/')) : null;
    const main = $('#main');
    const view = h('div', 'view');
    main.replaceChildren(view);
    window.scrollTo(0, 0);
    document.querySelectorAll('.nav a').forEach((a) => (a.dataset.view === kind ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (!this.vaultOpen && kind !== 'settings') return this.go('settings');
    try {
      if (kind === 'journals') await this.journalsView(view);
      else if (kind === 'page') await this.pageView(view, arg);
      else if (kind === 'pages') await this.pagesView(view);
      else if (kind === 'tags') await this.tagsView(view);
      else if (kind === 'props') await this.propsView(view, arg);
      else if (kind === 'settings') await this.settingsView(view);
      else await this.journalsView(view);
    } catch (e) {
      view.append(h('p', 'err', esc('Something went wrong: ' + e)));
    }
    $('#topbar .t').textContent = { journals: 'Journals', pages: 'All pages', tags: 'Tags', props: 'Properties', settings: 'Settings' }[kind] ?? (arg || '');
  }

  // ----- views -----
  async journalsView(view) {
    const list = h('div');
    view.append(list);
    const more = h('button', 'btn ghost more', 'Show older days');
    view.append(more);
    let end = today();
    let first = true;
    const loadBatch = async () => {
      more.disabled = true;
      const days = await call('journals', { end, count: 5, include_end: first });
      first = false;
      for (const d of days) await this.daySheet(list, d);
      if (days.length) {
        const last = dateOf(days[days.length - 1].date);
        last.setDate(last.getDate() - 1);
        end = ymd(last);
      }
      more.hidden = days.length < 5;
      more.disabled = false;
    };
    more.onclick = loadBatch;
    await loadBatch();
  }

  async daySheet(list, day) {
    const sec = h('section', 'sheet');
    if (day.date.join() === today().join()) sec.classList.add('today');
    const dt = dateOf(day.date);
    sec.innerHTML = `<p class="weekday">${WEEKDAYS[dt.getDay()]}</p><h2 class="page-title">${pageLink(day.name)}</h2>`;
    sec.querySelector('a').onclick = (e) => { e.preventDefault(); this.go('page', day.name); };
    const body = h('div');
    body.style.marginTop = '10px';
    sec.append(body);
    list.append(sec);
    const pv = await call('page', { name: day.name });
    this.outlines.push(new Outline(body, pv, this));
  }

  async pageView(view, name) {
    const pv = await call('page', { name });
    this.pushRecent(pv.info.name);
    const head = h('div', 'page-head');
    if (pv.info.journal) head.append(h('p', 'weekday', WEEKDAYS[dateOf(pv.info.journal).getDay()]));
    head.append(h('h1', 'page-title', esc(pv.info.name)));
    view.append(head);
    const sheet = h('div', 'sheet');
    view.append(sheet);
    const propsBox = h('div', 'page-props');
    sheet.append(propsBox);
    const body = h('div');
    sheet.append(body);
    const outline = new Outline(body, pv, this);
    this.outlines.push(outline);
    this.renderPageProps(propsBox, outline, pv.info.props);

    if (pv.tagged.length) {
      const sec = h('section', 'sec');
      sec.innerHTML = `<h2 class="sec-h">Pages tagged with ${esc(pv.info.name)} <span class="n">${pv.tagged.length}</span></h2>
        <div class="tagged">${pv.tagged.map((n) => `<a class="tag" href="#" data-page="${esc(n)}">${esc(n)}</a>`).join('')}</div>`;
      view.append(sec);
    }
    const refs = h('section', 'sec');
    const count = pv.refs.reduce((s, g) => s + g.hits.length, 0);
    refs.innerHTML = `<h2 class="sec-h">Linked references <span class="n">${count ? count + ' in ' + pv.refs.length + (pv.refs.length === 1 ? ' page' : ' pages') : 'none yet'}</span></h2>`;
    refs.append(this.groupsEl(pv.refs));
    view.append(refs);
    view.addEventListener('click', (e) => this.linkClick(e));
    if (this.pendingLine !== null) {
      const i = outline.indexForLine(this.pendingLine);
      this.pendingLine = null;
      requestAnimationFrame(() => outline.flash(i));
    }
  }

  /** Page properties as the backend read them (Logseq `key::` lines or a YAML header). */
  renderPageProps(box, outline, props) {
    const shown = visibleProps(props || []);
    box.innerHTML = shown.length ? propsHtml(shown)
      : '<button class="btn ghost" style="font-size:12.5px;padding:3px 10px">Add page properties</button>';
    box.title = 'Click to edit page properties';
    box.onclick = (e) => {
      if (e.target.closest('a') || box.querySelector('textarea') || outline.readonly) return;
      const ta = h('textarea', 'preamble-ed');
      ta.value = outline.doc.preamble.replace(/\r\n/g, '\n').replace(/\n+$/, '');
      ta.placeholder = 'tags:: idea, reading\nalias:: Another name';
      ta.rows = Math.max(2, ta.value.split('\n').length);
      box.replaceChildren(ta);
      ta.focus();
      ta.oninput = () => {
        const v = ta.value.trim();
        const pre = v ? v + '\n\n' : '';
        outline.doc.preamble = outline.doc.crlf ? pre.replace(/\n/g, '\r\n') : pre;
        outline.markDirty();
      };
      ta.onblur = async () => {
        await outline.flush();
        let fresh = props;
        try { fresh = (await call('page', { name: outline.name })).info.props; } catch {}
        this.renderPageProps(box, outline, fresh);
      };
    };
  }

  groupsEl(groups) {
    const wrap = h('div');
    for (const g of groups) {
      const grp = h('div', 'refgrp');
      grp.innerHTML = `<h3>${pageLink(g.page)}</h3>`;
      for (const hit of g.hits) {
        const row = h('div', 'refhit');
        row.style.setProperty('--d', Math.min(hit.depth, 4));
        const r = hit.line === null ? { html: '', props: hit.props } : renderBlock(hit.text);
        const mk = r.marker ? `<span class="mk">${esc(r.marker)}</span>` : '';
        row.innerHTML = `<div class="bc">${mk}${r.html}${propsHtml(r.props)}</div>`;
        row.onclick = (e) => {
          if (e.target.closest('a')) return;
          this.go('page', g.page, { line: hit.line });
        };
        grp.append(row);
      }
      wrap.append(grp);
    }
    return wrap;
  }

  linkClick(e) {
    const a = e.target.closest('a');
    if (!a || a.closest('.outline')) return;
    e.preventDefault();
    if (a.dataset.page) this.go('page', a.dataset.page);
    else if (a.getAttribute('href') && a.getAttribute('href') !== '#') this.openUrl(a.getAttribute('href'));
  }

  async pagesView(view) {
    view.append(h('h1', 'page-title', 'All pages'));
    await this.refreshNames();
    const tools = h('div');
    tools.innerHTML = `<input class="filter" type="search" placeholder="Filter ${this.names.filter((n) => n.exists).length} pages" aria-label="Filter pages">
      <label class="toggle"><input type="checkbox" id="showj"> Show journal days</label>`;
    const ul = h('ul', 'rows');
    view.append(tools, ul);
    const input = $('input.filter', tools);
    const showj = $('#showj', tools);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const list = this.names.filter((n) => (showj.checked || !n.journal) && (!q || n.name.toLowerCase().includes(q))).slice(0, 600);
      ul.innerHTML = list.map((n) => `<li><a href="#" data-page="${esc(n.name)}"><span class="${n.exists ? '' : 'ghost'}">${esc(n.name)}</span>${n.exists ? '' : '<span class="meta">not created yet</span>'}</a></li>`).join('');
    };
    input.oninput = draw;
    showj.onchange = draw;
    draw();
    ul.addEventListener('click', (e) => this.linkClick(e));
    if (!matchMedia('(pointer: coarse)').matches) input.focus();
  }

  async tagsView(view) {
    view.append(h('h1', 'page-title', 'Tags'));
    view.append(h('p', 'note', 'Pages carry tags through their <code>tags::</code> property.'));
    const tags = await call('tags');
    const ul = h('ul', 'rows');
    ul.innerHTML = tags.map(([t, n]) => `<li><a href="#" data-page="${esc(t)}">${esc(t)}<span class="meta">${n} ${n === 1 ? 'page' : 'pages'}</span></a></li>`).join('')
      || '<li class="note">No tags yet.</li>';
    ul.addEventListener('click', (e) => this.linkClick(e));
    view.append(ul);
  }

  async propsView(view, key) {
    if (!key) {
      view.append(h('h1', 'page-title', 'Properties'));
      const keys = await call('props');
      const ul = h('ul', 'rows');
      ul.innerHTML = keys.map(([k, n]) => `<li><a href="#/props/${encodeURIComponent(k)}">${esc(k)}<span class="meta">${n}</span></a></li>`).join('')
        || '<li class="note">No properties yet.</li>';
      view.append(ul);
      return;
    }
    view.append(h('h1', 'page-title', esc(key)));
    const input = h('input', 'filter');
    input.type = 'search';
    input.placeholder = `Only where ${key} contains…`;
    const out = h('div');
    view.append(input, out);
    const draw = async () => {
      const groups = await call('with_property', { key, value: input.value.trim() });
      const n = groups.reduce((s, g) => s + g.hits.length, 0);
      out.replaceChildren(h('p', 'note', `${n} ${n === 1 ? 'match' : 'matches'} in ${groups.length} ${groups.length === 1 ? 'page' : 'pages'}`), this.groupsEl(groups));
    };
    let t;
    input.oninput = () => { clearTimeout(t); t = setTimeout(draw, 200); };
    view.addEventListener('click', (e) => this.linkClick(e));
    await draw();
  }

  async settingsView(view) {
    view.append(h('h1', 'page-title', this.vaultOpen ? 'Settings' : 'Welcome'));
    if (!this.vaultOpen) view.append(h('p', 'note', 'Choose the folder that holds your notes (the Logseq folder with <code>pages</code> and journals inside). Nothing is changed until you edit a page.'));

    // Android: file access
    if (window.LeanAndroid && !window.LeanAndroid.hasAllFilesAccess()) {
      const c = h('div', 'card');
      c.innerHTML = `<h2>Allow access to your files</h2>
        <p class="note">Android needs your permission before the app can read the notes folder that Drive Sync keeps up to date. Turn on <b>Allow access to manage all files</b> for Lean Outliner, then come back.</p>
        <button class="btn">Open the setting</button>`;
      $('button', c).onclick = () => window.LeanAndroid.openAllFilesSettings();
      view.append(c);
    }

    // Notes folder
    const vc = h('div', 'card');
    const path = store.get('vault', '');
    vc.innerHTML = `<h2>Notes folder</h2>
      ${path ? `<div class="path">${esc(path)}</div>` : '<p class="note">No folder chosen yet.</p>'}
      ${this.vaultError ? `<p class="err">${esc(this.vaultError)}</p>` : ''}
      ${this.vaultOpen ? `<p class="note">${this.summary.pages} pages · journals in <code>${esc(this.summary.config.journals_dir)}</code> · journal titles like “${esc(this.summary.today)}”</p>` : ''}
      <div class="btn-row"><button class="btn" data-a="pick">${path ? 'Choose another folder' : 'Choose folder'}</button>
      ${this.vaultOpen ? '<button class="btn ghost" data-a="check">Check this folder</button>' : ''}</div>
      <div class="check-out"></div>`;
    view.append(vc);
    $('[data-a="pick"]', vc).onclick = () => this.folderPicker(vc, path);
    const chk = $('[data-a="check"]', vc);
    if (chk) chk.onclick = async () => {
      chk.disabled = true;
      const out = $('.check-out', vc);
      out.innerHTML = '<p class="note">Reading every page…</p>';
      try {
        const r = await call('check');
        out.innerHTML = `<p class="note">${r.files} files read in ${r.load_ms} ms. ${r.roundtrip_failures.length
          ? `<b class="err">${r.roundtrip_failures.length} files would be reformatted if saved untouched:</b></p><div class="path">${r.roundtrip_failures.map(esc).join('<br>')}</div>`
          : 'Every file can be opened and saved without being reformatted.</p>'}`;
      } catch (e) { out.innerHTML = `<p class="err">${esc(e)}</p>`; }
      chk.disabled = false;
    };
    if (!path) this.folderPicker(vc, '');

    // Looks: each card is a live miniature drawn with that look's own tokens
    const sc = h('div', 'card');
    sc.innerHTML = '<h2>Look</h2><p class="note">Pick how your notes look. Each card is a live preview.</p><div class="skin-cards"></div>';
    const cards = $('.skin-cards', sc);
    const sample = `<div class="sheet"><p class="weekday">Sunday</p><div class="page-title">October 25th, 2026</div>
      <div class="outline" style="margin-top:10px">
        <div class="blk" style="--d:0"><span class="bul"></span><div class="bc">Read <a class="pl">Marta Pell</a> on bread <a class="tag"><span class="hash">#</span>reading</a></div></div>
        <div class="blk" style="--d:1"><span class="bul"></span><div class="bc">cold-proving is the <mark>key idea</mark></div></div>
        <div class="blk" style="--d:0"><span class="bul"></span><div class="bc"><input type="checkbox" class="todo" checked tabindex="-1">order more flour</div></div>
      </div></div>`;
    for (const s of SKINS) {
      const b = h('button', 'skin-card', `<div class="stage">${sample}</div><div class="label"><b>${s.name}</b><span>${s.note}</span></div>`);
      b.dataset.skin = s.id;
      b.setAttribute('aria-pressed', document.documentElement.dataset.skin === s.id);
      b.onclick = () => { this.setSkin(s.id); cards.querySelectorAll('.skin-card').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
      cards.append(b);
    }
    view.append(sc);

    const about = h('p', 'note');
    let ver = '';
    try { ver = await window.__TAURI__?.app?.getVersion?.(); } catch {}
    about.textContent = `Lean Outliner ${ver || '(preview)'}. Your notes stay as plain Markdown files in your folder.`;
    view.append(about);
  }

  async folderPicker(card, start) {
    let box = $('.picker', card);
    if (!box) { box = h('div', 'picker'); card.append(box); }
    const roots = await call('roots');
    let cur = start || roots[0];
    const show = async (p) => {
      let list;
      try { list = await call('list_dir', { path: p }); }
      catch (e) {
        box.innerHTML = `<div class="crumbs">${roots.map((r) => `<button data-p="${esc(r)}">${esc(r)}</button>`).join('')}</div>
          <p class="err" style="padding:10px">${esc(e)}</p>`;
        box.onclick = (ev) => { const b = ev.target.closest('[data-p]'); if (b) show(b.dataset.p); };
        return;
      }
      cur = list.path;
      box.innerHTML = `<div class="crumbs">${roots.map((r) => `<button data-p="${esc(r)}">${esc(r)}</button>`).join('')}
          ${list.parent ? `<button data-p="${esc(list.parent)}">↑ Up</button>` : ''}</div>
        <div class="path" style="margin:8px 10px">${esc(list.path)}</div>
        <ul>${list.dirs.map((d) => `<li><button data-p="${esc(d.path)}">${esc(d.name)}${d.vault ? '<span class="badge">notes folder</span>' : ''}</button></li>`).join('')
          || '<li class="note" style="padding:10px 12px">No folders here.</li>'}</ul>
        <div class="foot"><button class="btn" data-use ${list.vault ? '' : 'disabled'}>Use this folder</button>
          <span class="note">${list.vault ? 'This looks like a notes folder.' : 'Open the folder that contains <code>pages</code>.'}</span></div>`;
      box.onclick = (ev) => {
        const b = ev.target.closest('[data-p]');
        if (b) return show(b.dataset.p);
        if (ev.target.closest('[data-use]')) this.useVault(cur);
      };
    };
    await show(cur);
  }

  async useVault(path) {
    store.set('vault', path);
    this.vaultError = null;
    await this.openVault();
    this.go(this.vaultOpen ? 'journals' : 'settings');
  }

  async openVault() {
    const path = store.get('vault', '');
    this.vaultOpen = false;
    if (!path) return;
    try {
      const s = await call('open', { path });
      s.today = await call('journal_name', { date: today() });
      this.summary = s;
      this.vaultOpen = true;
      const c = s.config;
      window.LeanAndroid?.setWidgetConfig?.(s.root, c.journals_dir, c.journal_file_format, c.journal_title_format);
      this.vaultError = null;
      await this.refreshNames();
    } catch (e) {
      this.vaultError = String(e?.message ?? e);
    }
  }

  setSkin(id) {
    if (!SKIN_IDS.has(id)) id = 'calm';
    document.documentElement.dataset.skin = id;
    store.set('skin', id);
    document.querySelectorAll('.skins button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.look === id));
    // the Android home-screen widget follows the look
    const css = getComputedStyle(document.documentElement);
    const v = (k) => css.getPropertyValue(k).trim();
    window.LeanAndroid?.setWidgetColors?.(v('--surface'), v('--ink'), v('--ink-faint'), v('--accent'));
  }

  // ----- search -----
  openSearch() {
    const ov = $('#search');
    ov.hidden = false;
    const input = $('input', ov);
    const ul = $('.results', ov);
    input.value = '';
    ul.innerHTML = '';
    input.focus();
    let items = [];
    let sel = 0;
    const paint = () => [...ul.children].forEach((li, k) => li.setAttribute('aria-selected', k === sel));
    const run = async () => {
      const q = input.value.trim();
      if (!q) { ul.innerHTML = ''; items = []; return; }
      const hits = await call('search', { q });
      items = hits;
      if (!hits.some((x) => x.line === null && x.page.toLowerCase() === q.toLowerCase())) items = [{ page: q, line: null, create: true }, ...hits];
      sel = 0;
      ul.innerHTML = items.map((x) => x.create
        ? `<li>New page: <b>${esc(x.page)}</b></li>`
        : `<li>${esc(x.page)}${x.line === null ? '' : `<span class="snip">${esc(x.snippet)}</span>`}</li>`).join('');
      paint();
    };
    let t;
    input.oninput = () => { clearTimeout(t); t = setTimeout(run, 120); };
    const pick = (k) => { const x = items[k]; if (!x) return; this.closeSearch(); this.go('page', x.page, { line: x.line }); };
    input.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
      else if (e.key === 'Escape') this.closeSearch();
    };
    ul.onclick = (e) => { const li = e.target.closest('li'); if (li) pick([...ul.children].indexOf(li)); };
    ov.onclick = (e) => { if (e.target === ov) this.closeSearch(); };
  }
  closeSearch() { $('#search').hidden = true; }

  // ----- chrome -----
  buildChrome() {
    const side = $('#side');
    side.innerHTML = `
      <div class="brand">${ICON.logo}<span>Lean Outliner</span></div>
      <button class="searchbtn" data-a="search">${ICON.search.replace('<svg', '<svg width="16" height="16"')}<span>Search</span><kbd>Ctrl K</kbd></button>
      <nav class="nav">
        <a href="#/journals" data-view="journals">${ICON.journals}Journals</a>
        <a href="#/pages" data-view="pages">${ICON.pages}All pages</a>
        <a href="#/tags" data-view="tags">${ICON.tags}Tags</a>
        <a href="#/props" data-view="props">${ICON.props}Properties</a>
      </nav>
      <div><p class="side-h">Recent</p><div class="side-list" id="recent"></div></div>
      <div class="side-foot">
        <div class="skins">${SKINS.map((s) => `<button data-look="${s.id}" title="${s.name}" aria-label="${s.name} look" style="--sw-bg:${s.bg};--sw-dot:${s.dot}"></button>`).join('')}</div>
        <nav class="nav"><a href="#/settings" data-view="settings">${ICON.settings}Settings</a></nav>
      </div>`;
    side.addEventListener('click', (e) => {
      if (e.target.closest('[data-a="search"]')) this.openSearch();
      const sk = e.target.closest('[data-look]');
      if (sk) this.setSkin(sk.dataset.look);
      const a = e.target.closest('#recent a');
      if (a) { e.preventDefault(); this.go('page', a.dataset.page); }
    });
    this.setSkin(document.documentElement.dataset.skin || 'calm');

    const top = $('#topbar');
    top.innerHTML = `<button data-a="menu" aria-label="Menu">${ICON.menu}</button><span class="t"></span>
      <button data-a="search" aria-label="Search">${ICON.search}</button><button data-a="today" aria-label="Today">${ICON.today}</button>`;
    top.onclick = (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'menu') document.body.classList.toggle('drawer');
      if (a === 'search') this.openSearch();
      if (a === 'today') this.go('journals');
    };
    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('drawer') && !e.target.closest('#side') && !e.target.closest('#topbar')) document.body.classList.remove('drawer');
    });

    const tb = $('#toolbar');
    const tools = [['outdent', 'Outdent'], ['indent', 'Indent'], ['up', 'Move up'], ['down', 'Move down'], ['link', 'Link'], ['tag', 'Tag'], ['check', 'To-do'], ['done', 'Close keyboard']];
    tb.innerHTML = tools.map(([k, label]) => `<button data-t="${k}" aria-label="${label}">${ICON[k] ?? (k === 'link' ? '[[]]' : '#')}</button>`).join('');
    tb.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault(); // keep the keyboard open
      const o = this.active;
      if (!o || o.cur === null) return;
      const i = o.cur;
      ({
        outdent: () => o.outdent(i), indent: () => o.indent(i), up: () => o.move(i, -1), down: () => o.move(i, 1),
        link: () => o.insertAtCaret('[['), tag: () => o.insertAtCaret('#'), check: () => o.cycleTodo(),
        done: () => { o.stopEdit(); document.activeElement?.blur(); },
      })[b.dataset.t]?.();
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); this.openSearch(); }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); this.go('journals'); }
      if (e.key === 'Escape' && !$('#search').hidden) this.closeSearch();
    });
    window.addEventListener('hashchange', () => this.route());

    // Pick up edits from Drive sync / Claude / other devices
    const refresh = () => this.rescan();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
      else this.outlines.forEach((o) => o.flush());
    });
    window.addEventListener('focus', refresh);
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
    window.addEventListener('beforeunload', () => this.outlines.forEach((o) => o.flush()));
  }

  renderRecent() {
    const el = $('#recent');
    if (!el) return;
    el.innerHTML = this.recent().map((n) => `<a href="#" data-page="${esc(n)}">${esc(n)}</a>`).join('') || '<span class="note" style="padding:0 8px;font-size:13px">Pages you open show up here.</span>';
  }

  async rescan() {
    if (!this.vaultOpen || this.scanning) return;
    this.scanning = true;
    try {
      const changed = await call('rescan');
      if (changed.length) {
        await this.refreshNames();
        const set = new Set(changed);
        for (const o of this.outlines) if (set.has(o.path)) await o.reload();
      }
    } catch { /* ignore */ }
    this.scanning = false;
  }

  async start() {
    this.buildChrome();
    this.renderRecent();
    await this.openVault();
    if (!location.hash) location.hash = this.vaultOpen ? '#/journals' : '#/settings';
    else this.route();
    // Android: coming back from the permission screen — retry the folder and redraw Settings
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || !window.LeanAndroid || this.vaultOpen) return;
      if (store.get('vault', '')) await this.openVault();
      this.route();
    });
  }
}

const app = new App();
window.leanApp = app; // handy for debugging
app.start();

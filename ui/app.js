// App shell: routing, journals and page views, search, sidebar, keyboard shortcuts, phone
// toolbar, background refresh. Lists live in views.js, Settings in settings.js, blocks in
// editor.js / render.js, floating bits in popups.js.

import { call, today, nowTime, store, isApp, isAndroid, listen } from './api.js';
import { Outline } from './editor.js';
import { renderBlock, propsHtml, visibleProps, esc } from './render.js';
import { Suggest, Preview, menu, confirmBox, promptBox, pickDate, place } from './popups.js';
import { pagesView, tagsView, propsView, todosView, taskRow, taskClicks, taskDay, num } from './views.js';
import { settingsView } from './settings.js';
import { h, pageLink, ICON } from './dom.js';
import { keyOf } from './calendar.js';

// Looks: name and one-line note for the picker; the look itself lives in skins.css.
export const SKINS = [
  { id: 'plain', name: 'Plain', note: 'Flat, white and quiet: nothing but your notes' },
  { id: 'plainnight', name: 'Plain night', note: 'Plain for evenings: flat and quiet, dark' },
  { id: 'calm', name: 'Calm', note: 'The first look: light, teal, lifted cards' },
  { id: 'night', name: 'Night', note: 'The Board’s dark look, labels set into the page' },
  { id: 'paper', name: 'Paper', note: 'Ruled notebook, red margin, highlighter' },
  { id: 'sticker', name: 'Sticker', note: 'The Board’s sticker look: bold outlines' },
  { id: 'stickernight', name: 'Sticker night', note: 'Sticker, dimmed for evenings' },
  { id: 'grimoire', name: 'Grimoire', note: 'A quiet library at night: ink blue, warm gold' },
  { id: 'automaton', name: 'Automaton', note: 'Graph-paper lab notes with a rule 30 band' },
  { id: 'azulejo', name: 'Azulejo', note: 'Cobalt tiles on white' },
];
const SKIN_IDS = new Set(SKINS.map((s) => s.id));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'Home', 'End', ' ', 'ArrowDown', 'ArrowUp']);
const QUIET_BUTTONS = '#histbar button, #topbar button, .side-fold, .title-row .icon-btn';
const $ = (sel, root = document) => root.querySelector(sel);
/** Kept only while the app is open (survives a reload): how far the Forward arrow can go. */
const session = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* not available */ } },
};
/** Android: the card asking for "all files access" (Journals and Settings show it until it's on). */
export function accessCard(title) {
  const c = h('div', 'card');
  c.innerHTML = `<h2>${esc(title)}</h2>
    <p class="note">Android needs your permission before the app can read the notes folder that Drive Sync keeps up to date. Turn on <b>Allow access to manage all files</b> for Lean Outliner, then come back.</p>
    <button class="btn">Open the setting</button>`;
  c.querySelector('button').onclick = () => window.LeanAndroid?.openAllFilesSettings();
  return c;
}
const dateOf = ([y, m, d]) => new Date(y, m - 1, d);
const ymd = (dt) => [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];

// ---------------------------------------------------------------------------
// Keyboard shortcuts, in Logseq's notation ("mod+shift+up", "g j"). Logseq's
// :shortcuts in config.edn override these for the same action names.
const DEFAULT_KEYS = {
  'editor/move-block-up': ['alt+shift+up', 'mod+shift+up'],
  'editor/move-block-down': ['alt+shift+down', 'mod+shift+down'],
  'editor/highlight': [],
  'editor/toggle-open-blocks': ['t o'],
  'go/search': ['mod+k'],
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
    this.outlines = [];
    this.names = [];
    this.active = null;
    this.ac = new Suggest(this);
    this.preview = new Preview();
    this.pendingLine = null;
    this.conflicts = new Set();
    this.keyMap = { ...DEFAULT_KEYS };
    this.prevHash = location.hash;
  }

  // ----- small services used by editors and views -----
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
  showImage(src) {
    const back = h('div', 'modal-back lightbox', `<img src="${esc(src)}" alt="">`);
    back.onclick = () => back.remove();
    document.body.append(back);
  }
  workflow() { return this.summary?.config?.workflow || 'todo'; }
  editing(outline, on) {
    this.active = on ? outline : (this.active === outline ? null : this.active);
    if (on) this.outlines.forEach((o) => o !== outline && o.clearSel());
    this.updateToolbar();
  }
  selecting(outline, on) {
    if (on) { this.active = outline; this.outlines.forEach((o) => o !== outline && o.clearSel()); }
    this.updateToolbar();
  }
  updateToolbar() {
    const narrow = window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;
    const o = this.active;
    $('#toolbar').hidden = !(o && narrow && (o.cur !== null || o.sel));
  }
  saved(outline) {
    window.LeanAndroid?.refreshWidget?.();
    if (!this.names.some((n) => n.exists && n.name.toLowerCase() === outline.name.toLowerCase())) this.refreshNames();
    this.widgetTasksSoon();
  }
  recent() { return store.get('recent', []); }
  pushRecent(name) {
    const r = [name, ...this.recent().filter((n) => n.toLowerCase() !== name.toLowerCase())].slice(0, 10);
    store.set('recent', r);
    this.renderSideLists();
  }

  async refreshNames() {
    try { this.names = await call('pages'); } catch { /* vault not open */ }
  }

  /** Does this key event trigger a Logseq action (single key combinations only)? */
  keyIs(e, action) {
    const ev = evChord(e);
    return (this.keyMap[action] || []).some((k) => !k.includes(' ') && same(parseChord(k), ev));
  }

  // ----- routing -----
  go(kind, arg, opts = {}) {
    this.pendingLine = opts.line ?? null;
    let hash = '#/' + kind + (arg !== undefined && arg !== null ? '/' + encodeURIComponent(arg) : '');
    if (kind === 'zoom') hash += '/' + (opts.line ?? 0);
    if (location.hash === hash) this.route();
    else location.hash = hash;
  }
  back() { if (history.length > 1) { history.back(); return true; } return false; }

  // the back and forward arrows (laptop strip and phone bar): greyed out when there is nowhere to go
  updateHistBar() {
    document.querySelectorAll('[data-h="back"]').forEach((b) => (b.disabled = !(this.histN > 0)));
    document.querySelectorAll('[data-h="forward"]').forEach((b) => (b.disabled = !(this.histN < this.histMax)));
  }

  async route() {
    // Moving quickly (Back twice, two clicks) starts a new route() while an earlier one still waits
    // for saving or reading: only the newest goes on, so pages never mix (see also pageView).
    const seq = this.routeSeq = (this.routeSeq ?? 0) + 1;
    // where we are in the back/forward history, for the arrows at the top (the browser doesn't say);
    // numbered straight away, so a step that a newer move overtakes still gets its number
    const st = history.state;
    if (st && typeof st.n === 'number') this.histN = st.n; // went back or forward (or reloaded)
    else { // a new place: one step past where we were, and nothing ahead any more
      this.histN = (this.histN ?? -1) + 1;
      this.histMax = this.histN;
      history.replaceState({ ...(st || {}), n: this.histN }, '');
    }
    // how far Forward can go is kept for this session, so a reload doesn't forget it
    this.histMax = Math.max(this.histMax ?? session.get('histMax') ?? 0, this.histN);
    session.set('histMax', this.histMax);
    this.updateHistBar();
    document.body.classList.remove('drawer');
    this.ac.close();
    this.closeLooks?.();
    await Promise.all(this.outlines.map((o) => { o.stopEdit(); return o.flush(); }));
    if (seq !== this.routeSeq) return;
    // a page whose changes clash with changes made elsewhere stays open until the user chooses
    // (this history step then shows it again; it keeps the number it got above). Also when the
    // same place is opened again (Home on the Journals list): redrawing would drop the choice.
    const stuck = this.outlines.find((o) => o.conflict);
    if (stuck) {
      if (location.hash !== this.prevHash) history.replaceState(history.state, '', this.prevHash || '#/journals');
      stuck.banner.scrollIntoView({ block: 'center' });
      this.toast('First choose which version of this page to keep.', 4500);
      return;
    }
    // couldn't save (e.g. the file is offline): keep a copy of the typing before leaving
    for (const o of this.outlines) {
      if (!o.dirty || o.readonly) continue;
      try { await call('backup', { name: o.name, doc: o.doc }); this.toast(`Couldn’t save “${o.name}”; a copy of your changes is in logseq/bak.`, 6000); }
      catch (e) { this.toast(`Couldn’t save “${o.name}”: ${e}`, 6000); }
      if (seq !== this.routeSeq) return;
    }
    this.prevHash = location.hash;
    this.outlines = [];
    this.active = null;
    this.updateToolbar();
    const [, kind = 'journals', ...rest] = location.hash.split('/');
    let arg = rest.length ? decodeURIComponent(rest.join('/')) : null;
    let zoomLine = null;
    if (kind === 'zoom' && rest.length >= 2) { zoomLine = Number(rest[rest.length - 1]); arg = decodeURIComponent(rest.slice(0, -1).join('/')); }
    this.journalObs?.disconnect(); // the journals' "load older days" watcher belongs to the old view
    this.journalObs = this.journalWatch = this.topAnchor = null;
    const main = $('#main');
    const view = h('div', 'view');
    main.replaceChildren(view);
    window.scrollTo(0, 0); // phones and narrow windows scroll the whole page,
    main.scrollTop = 0; // wide windows just the part under the top strip
    document.querySelectorAll('.nav a').forEach((a) => (a.dataset.view === kind ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (!this.vaultOpen && kind !== 'settings') return this.go('settings');
    try {
      if (kind === 'journals') await this.journalsView(view);
      else if (kind === 'page' || kind === 'zoom') await this.pageView(view, arg, zoomLine);
      else if (kind === 'pages') await pagesView(this, view);
      else if (kind === 'tags') await tagsView(this, view);
      else if (kind === 'props') await propsView(this, view, arg);
      else if (kind === 'todos') await todosView(this, view);
      else if (kind === 'settings') await settingsView(this, view, arg);
      else await this.journalsView(view);
    } catch (e) {
      view.append(h('p', 'err', esc('Something went wrong: ' + e)));
      call('log', { msg: `view ${kind}: ${e?.stack || e}` }).catch(() => {});
    }
    $('#topbar .t').textContent = { journals: 'Journals', pages: 'All pages', tags: 'Tags', props: 'Properties', settings: 'Settings', todos: 'To-dos' }[kind] ?? (arg || '');
  }

  // ----- views -----
  async journalsView(view) {
    if (this.noAccess) view.append(accessCard('Your notes can’t be read yet'));
    const head = h('div', 'view-tools');
    head.innerHTML = `<button class="btn ghost small" data-a="date">${ICON.date}<span>Go to date</span></button>`;
    $('[data-a="date"]', head).onclick = (e) => this.goToDate(e.currentTarget);
    view.append(head);
    const list = h('div');
    view.append(list);
    const more = h('button', 'btn ghost more', 'Show older days');
    view.append(more);
    let end = today();
    let first = true;
    let dates = null;
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
        if (first) { try { dates = await call('journal_dates'); } catch { dates = []; } }
        const shown = [];
        for (const d of days) {
          if (!list.isConnected) return;
          const sec = await this.daySheet(list, d, first && d.date.join() === today().join() ? dates : null);
          if (sec) shown.push([d.name, sec]);
        }
        this.dayUnlinked(shown); // not waited for: the days show first
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
    await loadBatch();
    if (!more.isConnected) return; // moved on to another page meanwhile
    // scrolling near the end loads older days by itself (the button stays, just in case).
    // What scrolls: #main in a wide window, the whole page in a narrow one (redone when that changes).
    const watch = () => {
      this.journalObs?.disconnect();
      const main = $('#main');
      const root = getComputedStyle(main).overflowY === 'visible' ? null : main;
      this.journalObs = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) loadBatch(); }, { root, rootMargin: '0px 0px 800px 0px' });
      this.journalObs.observe(more);
    };
    this.journalWatch = watch;
    watch();
  }

  /** One day in the Journals list: its notes, then (today) the to-dos that are due, then the
   *  references to it from other pages: linked ones, and unlinked ones folded (dayUnlinked adds
   *  those, for the days that have some). Returns the day's sheet. */
  async daySheet(list, day, allDates) {
    const sec = h('section', 'sheet');
    const isToday = day.date.join() === today().join();
    if (isToday) sec.classList.add('today');
    const dt = dateOf(day.date);
    sec.innerHTML = `<div class="day-head"><span class="day-ic" aria-hidden="true">${ICON.calendar}</span><p class="weekday">${WEEKDAYS[dt.getDay()]}</p><h2 class="page-title">${pageLink(day.name)}</h2></div>`;
    sec.querySelector('a').onclick = (e) => { e.preventDefault(); this.go('page', day.name); };
    const body = h('div');
    body.style.marginTop = '10px';
    const sched = h('div', 'day-sched');
    const refs = h('div', 'day-refs');
    refs.addEventListener('click', (e) => this.linkClick(e));
    sec.append(body, sched, refs);
    list.append(sec);
    const pv = await call('page', { name: day.name, today: today(), time: nowTime() });
    if (!list.isConnected) return null; // another page opened meanwhile (see journalsView)
    this.outlines.push(new Outline(body, pv, this));
    if (isToday) this.scheduledBox(sched, day.name);
    if (pv.refs.length) refs.append(this.dayLinked(pv.refs));
    if (allDates) this.onThisDay(sec, day.date, allDates);
    return sec;
  }

  /** "Linked references" under a day in the Journals list (only shown when there are some). */
  dayLinked(groups) {
    const sec = h('section', 'sec');
    const n = groups.reduce((s, g) => s + g.hits.length, 0);
    sec.innerHTML = `<h3 class="sec-h">Linked references <span class="n">${n}</span></h3>`;
    const MAX = 6; // a day linked from very many pages: the first few, then a button for the rest
    sec.append(this.groupsEl(groups.slice(0, MAX)));
    if (groups.length > MAX) {
      const more = h('button', 'btn ghost small', `Show ${groups.length - MAX} more page${groups.length - MAX === 1 ? '' : 's'}`);
      more.onclick = () => more.replaceWith(this.groupsEl(groups.slice(MAX)));
      sec.append(more);
    }
    return sec;
  }

  /** Which of these days are mentioned somewhere as plain text (not linked)? One look through the
   *  notes for all of them; those days get a folded "Unlinked references" (filled when opened). */
  async dayUnlinked(shown) {
    if (!shown.length) return;
    let any;
    try { any = await call('unlinked_any', { names: shown.map(([name]) => name) }); } catch { return; }
    shown.forEach(([name, sec], k) => { if (any?.[k] && sec.isConnected) sec.querySelector('.day-refs')?.append(this.unlinkedSection(name, true)); });
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
    const prio = (x) => ({ A: 0, B: 1, C: 2 }[x.priority] ?? 1);
    for (const [, , g] of groups) g.sort((a, b) => (taskDay(a) - taskDay(b)) || (prio(a) - prio(b)));
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

  /** Links to the same day in earlier years. */
  async onThisDay(sec, [y, m, d], dates) {
    const past = dates.filter(([py, pm, pd]) => pm === m && pd === d && py < y).reverse().slice(0, 6);
    if (!past.length) return;
    const names = await Promise.all(past.map((p) => call('journal_name', { date: p })));
    const box = h('p', 'onthisday', `On this day: ${names.map((n, k) => pageLink(n, String(past[k][0]))).join(' · ')}`);
    box.addEventListener('click', (e) => this.linkClick(e));
    sec.append(box);
  }

  async goToDate(anchorEl) {
    const marks = call('journal_days').then((ds) => new Set(ds.map(keyOf))).catch(() => null);
    const pick = await pickDate(anchorEl.getBoundingClientRect(), { title: 'Go to a day', marks, note: 'Dots mark days with notes.' });
    if (pick) this.go('page', await call('journal_name', { date: pick.date }));
  }

  async pageView(view, name, zoomLine = null) {
    const pv = await call('page', { name, today: today(), time: nowTime() });
    if (!view.isConnected) return; // moved on to another page while this one was read (see route)
    this.pushRecent(pv.info.name);
    const head = h('div', 'page-head');
    if (pv.info.journal) { // a journal day: weekday above the date, calendar icon before it
      head.classList.add('day-head');
      head.append(h('span', 'day-ic', ICON.calendar), h('p', 'weekday', WEEKDAYS[dateOf(pv.info.journal).getDay()]));
      head.firstChild.setAttribute('aria-hidden', 'true');
    }
    // namespace parents: "APRON/Spice jars" shows "APRON /" above the title
    const parts = pv.info.name.split('/');
    const ns = parts.length > 1 && !pv.info.journal && parts.every((p) => p.trim());
    if (ns) head.append(h('p', 'ns-path', parts.slice(0, -1).map((p, k) => pageLink(parts.slice(0, k + 1).join('/'), p)).join(' / ') + ' /'));
    const titleRow = h('div', 'title-row');
    const fav = (this.summary?.config?.favorites || []).some((f) => f.toLowerCase() === pv.info.name.toLowerCase());
    titleRow.innerHTML = `<h1 class="page-title">${esc(ns ? parts[parts.length - 1] : pv.info.name)}</h1>
      <button class="icon-btn${fav ? ' on' : ''}" data-a="fav" aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}" title="Favourite">${ICON.star}</button>
      <button class="icon-btn" data-a="more" aria-label="Page actions" title="More">${ICON.more}</button>`;
    // page properties ("+ properties" when there are none) go right under the title
    const propsBox = h('div', 'page-props');
    head.append(titleRow, propsBox);
    view.append(head);
    const sheet = h('div', 'sheet');
    view.append(sheet);
    const body = h('div');
    sheet.append(body);
    const outline = new Outline(body, pv, this, { zoomLine });
    this.outlines.push(outline);
    this.renderPageProps(propsBox, outline, pv.info.props);
    $('[data-a="fav"]', titleRow).onclick = () => this.toggleFavourite(pv.info.name);
    $('[data-a="more"]', titleRow).onclick = (e) => this.pageMenu(e.currentTarget, pv);

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
    const refs = h('section', 'sec');
    const count = pv.refs.reduce((s, g) => s + g.hits.length, 0);
    refs.innerHTML = `<h2 class="sec-h">Linked references <span class="n">${count ? count + ' in ' + pv.refs.length + (pv.refs.length === 1 ? ' page' : ' pages') : 'none yet'}</span></h2>`;
    refs.append(this.groupsEl(pv.refs));
    view.append(refs);
    view.append(this.unlinkedSection(pv.info.name));
    view.addEventListener('click', (e) => this.linkClick(e));
    if (this.pendingLine !== null && zoomLine === null) {
      const i = outline.indexForLine(this.pendingLine);
      this.pendingLine = null;
      requestAnimationFrame(() => outline.flash(i));
    }
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
      body.innerHTML = '<p class="note">Looking through your notes…</p>';
      let res;
      try { res = await call('unlinked', { name }); } catch (e) { body.innerHTML = `<p class="err">${esc(e)}</p>`; return; }
      const n = res.groups.reduce((s, g) => s + g.hits.length, 0);
      body.replaceChildren(h('p', 'note', n ? `${n} mention${n === 1 ? '' : 's'} in ${res.groups.length} page${res.groups.length === 1 ? '' : 's'}${res.more ? ' (showing the first 300)' : ''}. <b>Link</b> turns a mention into a link.` : 'No unlinked mentions.'),
        this.groupsEl(res.groups, { link: name }));
    };
    return sec;
  }

  /** Page properties as the backend read them (Logseq `key::` lines or a YAML header). */
  renderPageProps(box, outline, props) {
    const shown = visibleProps(props || []);
    box.innerHTML = shown.length ? propsHtml(shown)
      : (outline.readonly ? '' : '<button class="add-props" aria-label="Add page properties">+ properties</button>');
    box.title = outline.readonly ? '' : 'Click to edit page properties';
    box.onclick = (e) => {
      if (e.target.closest('.pk')) { this.go('props', e.target.closest('.pk').dataset.prop); return; }
      if (e.target.closest('a') || box.querySelector('textarea') || outline.readonly) return;
      const ta = h('textarea', 'preamble-ed');
      ta.value = outline.doc.preamble.replace(/\r\n/g, '\n').replace(/\n+$/, '');
      ta.placeholder = 'tags:: idea, reading\nalias:: Another name';
      ta.rows = Math.max(2, ta.value.split('\n').length);
      box.replaceChildren(ta);
      ta.focus();
      let snapped = false;
      ta.oninput = () => {
        if (!snapped) { outline.snap(); snapped = true; }
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

  /** Reference lists. opts.link: page name, adds "Link" buttons (unlinked references). */
  groupsEl(groups, opts = {}) {
    const wrap = h('div');
    for (const g of groups) {
      const grp = h('div', 'refgrp');
      grp.innerHTML = `<h3>${pageLink(g.page)}</h3>`;
      for (const hit of g.hits) {
        const row = h('div', 'refhit');
        row.style.setProperty('--d', Math.min(hit.depth, 4));
        const r = hit.line === null ? { html: '', props: hit.props } : renderBlock(hit.text);
        const mk = r.marker ? `<span class="mk">${esc(r.marker)}</span>` : '';
        row.innerHTML = `<div class="bc">${mk}${r.html}${propsHtml(r.props)}</div>${opts.link ? '<button class="btn ghost small linkit">Link</button>' : ''}`;
        row.onclick = async (e) => {
          if (e.target.closest('a')) return;
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

  // ----- page actions -----
  pageMenu(btn, pv) {
    const items = [];
    if (!pv.info.journal) items.push({ label: 'Rename…', run: () => this.renamePage(pv.info.name) });
    items.push({ label: 'Print or save as PDF', run: () => this.printPage() });
    if (pv.info.exists) items.push({ label: 'Delete page…', danger: true, run: async () => { if (await this.deletePages([pv.info.name])) this.go('journals'); } });
    menu(btn, items);
  }

  async renamePage(name) {
    const info = this.names.find((n) => n.name.toLowerCase() === name.toLowerCase());
    const n = info?.refs || 0;
    const v = await promptBox({ title: 'Rename page', value: name, ok: 'Rename', body: n ? `Links to it in ${n} place${n === 1 ? '' : 's'} will be updated to the new name.` : '' });
    if (v === null || v.trim() === name) return;
    await Promise.all(this.outlines.map((o) => { o.stopEdit(); return o.flush(); }));
    try {
      const res = await call('rename', { name, new_name: v.trim() });
      await this.refreshNames();
      this.renameRecent(name, res.name);
      this.toast(res.files_changed ? `Renamed. Updated links in ${res.files_changed} other page${res.files_changed === 1 ? '' : 's'}.` : 'Renamed.', 4000);
      if (res.skipped.length) this.toast(`Renamed, but ${res.skipped.length} file(s) couldn’t be updated (not plain text): ${res.skipped.join(', ')}`, 8000);
      history.replaceState(history.state, '', '#/page/' + encodeURIComponent(res.name));
      this.prevHash = location.hash;
      this.outlines = [];
      this.route();
    } catch (e) { this.toast(String(e), 6000); }
  }

  renameRecent(from, to) {
    store.set('recent', this.recent().map((n) => (n.toLowerCase() === from.toLowerCase() ? to : n)));
    this.renderSideLists();
  }

  /** Delete pages (they go to the bin, logseq/.recycle). Returns true if deleted. */
  async deletePages(names) {
    const links = names.reduce((s, n) => s + (this.names.find((x) => x.name.toLowerCase() === n.toLowerCase())?.refs || 0), 0);
    const what = names.length === 1 ? `“${esc(names[0])}”` : `${names.length} pages`;
    const ok = await confirmBox({
      title: names.length === 1 ? 'Delete this page?' : `Delete ${names.length} pages?`,
      body: `${what} will be moved to the bin (<code>logseq/.recycle</code> in your notes folder); you can bring ${names.length === 1 ? 'it' : 'them'} back from Settings.${links ? ` <b>${links} link${links === 1 ? '' : 's'}</b> from other notes will point to a page without a file.` : ''}`,
      ok: 'Delete', danger: true,
    });
    if (!ok) return false;
    await Promise.all(this.outlines.map((o) => { o.stopEdit(); return o.flush(); }));
    try {
      const n = await call('delete', { names });
      await this.refreshNames();
      store.set('recent', this.recent().filter((r) => !names.some((x) => x.toLowerCase() === r.toLowerCase())));
      this.renderSideLists();
      this.outlines = this.outlines.filter((o) => !names.some((x) => x.toLowerCase() === o.name.toLowerCase()));
      this.toast(`Deleted ${n} page${n === 1 ? '' : 's'}. You can restore them in Settings → Notes.`, 4000);
      return true;
    } catch (e) { this.toast(String(e), 6000); await this.refreshNames(); return false; }
  }

  printPage() {
    if (window.LeanAndroid?.print) window.LeanAndroid.print(document.title);
    else window.print();
  }

  async toggleFavourite(name) {
    const favs = this.summary?.config?.favorites || [];
    const on = !favs.some((f) => f.toLowerCase() === name.toLowerCase());
    try {
      this.summary.config.favorites = await call('set_favorite', { name, on });
      this.renderSideLists();
      const b = $('[data-a="fav"]');
      if (b) { b.classList.toggle('on', on); b.setAttribute('aria-label', on ? 'Remove from favourites' : 'Add to favourites'); }
      this.toast(on ? 'Added to favourites' : 'Removed from favourites', 1500);
    } catch (e) { this.toast(String(e), 5000); }
  }

  randomPage() {
    const pool = this.names.filter((n) => n.exists && !n.journal);
    if (pool.length) this.go('page', pool[Math.floor(Math.random() * pool.length)].name);
  }

  // ----- looks, text size, sidebar -----
  setSkin(id) {
    if (id === 'screenplay') id = 'plain';
    if (!SKIN_IDS.has(id)) id = 'calm';
    document.documentElement.dataset.skin = id;
    store.set('skin', id);
    const cur = $('#side .look-cur');
    if (cur) cur.textContent = SKINS.find((s) => s.id === id).name;
    // the Android home-screen widgets and the "Add a note" pop-up follow the look
    const css = getComputedStyle(document.documentElement);
    const v = (k) => css.getPropertyValue(k).trim();
    window.LeanAndroid?.setWidgetColors?.(v('--surface'), v('--ink'), v('--ink-faint'), v('--accent'));
    // and so do the phone's status bar (clock, battery) and navigation bar: the page's colour,
    // with dark icons on a light look and light icons on a dark one
    const rgb = (getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    if (rgb.length === 3 && window.LeanAndroid?.setBarColors) {
      const hex = '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
      window.LeanAndroid.setBarColors(hex, 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 140);
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
        <span class="look-txt"><b>${esc(s.name)}</b><small>${esc(s.note)}</small></span></button></li>`).join('')}</ul>
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
  toggleSidebar(force) {
    const hide = force ?? !document.body.classList.contains('side-hidden');
    document.body.classList.toggle('side-hidden', hide);
    store.set('sideHidden', hide);
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
  closeSearch() {
    $('#search').hidden = true;
    $('#search input').blur(); // so the next keys (e.g. "t l") reach the app straight away
  }

  // ----- chrome -----
  buildChrome() {
    // On Windows the app draws its own title bar (see below); null in a browser and on phones
    const win = isApp && !isAndroid ? window.__TAURI__?.window?.getCurrentWindow?.() : null;
    const side = $('#side');
    side.innerHTML = `
      <div class="brand">${ICON.logo}<span>Lean Outliner</span><button class="icon-btn hide-side" data-a="side" aria-label="Hide the sidebar" title="Hide the sidebar (t l)">${ICON.side}</button></div>
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
      if (e.target.closest('[data-a="side"]')) this.toggleSidebar(true);
      const lk = e.target.closest('[data-a="looks"]');
      if (lk) this.openLooks(lk);
      const a = e.target.closest('#recent a, #favs a');
      if (a) { e.preventDefault(); this.go('page', a.dataset.page); }
    });
    this.setSkin(document.documentElement.dataset.skin || 'calm');
    const showSide = h('button', 'icon-btn show-side', ICON.side);
    showSide.setAttribute('aria-label', 'Show the sidebar');
    showSide.title = 'Show the sidebar (t l)';
    showSide.onclick = () => this.toggleSidebar(false);
    document.body.append(showSide);
    this.toggleSidebar(store.get('sideHidden', false));
    this.textSize(this.textSize());
    this.applyTextStyle();
    // Recent shows only what fits: check again whenever its space changes (window size, the sidebar
    // shown again, Favourites folded, the update notice appearing…). The section's size doesn't
    // depend on how many pages it shows, so hiding some can't set this off again.
    new ResizeObserver(() => this.fitRecent()).observe($('.side-sec[data-sec="recent"]', side));
    // Small buttons (the bars, fold headings, a page's star and menu) don't keep the keyboard focus
    // after a click, like a window's own buttons, so Space or Enter afterwards scroll instead of
    // pressing them again; Tab still reaches them
    document.addEventListener('mousedown', (e) => { if (e.target.closest?.(QUIET_BUTTONS)) e.preventDefault(); });
    // The window got narrow or wide (e.g. snapped to half the screen): a different part of the
    // screen scrolls now (see app.css). Keep what was at the top of the notes there, and let the
    // journals watch the right part for loading older days.
    let noteT = 0;
    const onScroll = () => { clearTimeout(noteT); noteT = setTimeout(() => this.noteTop(), 150); };
    $('#main').addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    matchMedia('(max-width: 860px)').addEventListener('change', () => { this.restoreTop(); this.journalWatch?.(); });

    // back and forward at the top (laptop; on phones the top bar stays as it is)
    // On Windows the app draws its own title bar: these strips can be dragged to move the
    // window (double-click: maximise), with minimise / maximise / close at the right
    const winctl = win ? `<div class="winctl"><button data-w="min" aria-label="Minimise" title="Minimise">${ICON.winMin}</button><button data-w="max" aria-label="Maximise" title="Maximise">${ICON.winMax}</button><button data-w="close" class="close" aria-label="Close" title="Close">${ICON.winClose}</button></div>` : '';
    const winAction = (w) => ({ min: () => win.minimize(), max: () => win.toggleMaximize(), close: () => win.close() })[w]?.();
    const hb = $('#histbar');
    // Home (today in the Journals list) left of back and forward, in the laptop strip and the phone bar
    const home = `<button data-a="home" aria-label="Today in Journals" title="Today in Journals (g j)">${ICON.home}</button>`;
    hb.innerHTML = `${home}<button data-h="back" aria-label="Back" title="Back (Alt+←)">${ICON.back}</button><button data-h="forward" aria-label="Forward" title="Forward (Alt+→)">${ICON.forward}</button><div class="drag"></div>${winctl}`;
    hb.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.w) { winAction(b.dataset.w); return; }
      if (b.dataset.a === 'home') { this.go('journals'); return; }
      if (b.dataset.h === 'back') history.back(); else history.forward();
    };
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
    top.innerHTML = `<button data-a="menu" aria-label="Menu">${ICON.menu}</button>${home}
      <button data-h="back" aria-label="Back" title="Back">${ICON.back}</button><button data-h="forward" aria-label="Forward" title="Forward">${ICON.forward}</button>
      <span class="t"></span><button data-a="search" aria-label="Search">${ICON.search}</button>${winctl}`;
    // Tauri moves the window when one of these is pressed directly (not a button inside it).
    // Only on Windows: on a phone the press would ask for something phones can't do.
    // (#topbar is the strip a narrow window shows instead of #histbar.)
    if (win) for (const el of [$('.brand', side), hb, $('.drag', hb), top, $('.t', top)]) el.setAttribute('data-tauri-drag-region', '');
    top.classList.toggle('has-winctl', !!win); // a very narrow window drops a few buttons (app.css)
    top.onclick = (e) => {
      const wb = e.target.closest('[data-w]');
      if (wb) { winAction(wb.dataset.w); return; }
      const hb = e.target.closest('[data-h]');
      if (hb) { if (!hb.disabled) hb.dataset.h === 'back' ? history.back() : history.forward(); return; }
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'menu') document.body.classList.toggle('drawer');
      if (a === 'search') this.openSearch();
      if (a === 'home') this.go('journals');
    };
    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('drawer') && !e.target.closest('#side, #topbar, .pop, .modal-back')) document.body.classList.remove('drawer');
    });

    // phone editing toolbar: scrolls sideways, except "close keyboard", which stays at the end
    const tb = $('#toolbar');
    const tools = [['outdent', 'Outdent'], ['indent', 'Indent'], ['up', 'Move up'], ['down', 'Move down'], ['newline', 'New line in this block'],
      ['link', 'Link'], ['tag', 'Tag'], ['check', 'To-do'], ['date', 'Date'], ['bold', 'Bold'], ['mark', 'Highlight'], ['heading', 'Heading'],
      ['image', 'Add image'], ['undo', 'Undo'], ['redo', 'Redo']];
    const tbBtn = ([k, label], cls = '') => `<button data-t="${k}"${cls ? ` class="${cls}"` : ''} aria-label="${label}" title="${label}">${ICON[k] ?? (k === 'link' ? '[[]]' : '#')}</button>`;
    tb.innerHTML = `<div class="tb-scroll">${tools.map((t) => tbBtn(t)).join('')}</div>${tbBtn(['done', 'Close keyboard'], 'tb-pin')}`;
    tb.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault(); // keep the keyboard open
      const o = this.active;
      if (!o) return;
      const i = o.cur ?? (o.sel ? o.selRange()[0] : null);
      if (i === null) return;
      const heading = () => { const m = o.textOf(i).match(/^(?:[A-Z-]+ )?(#{1,6}) /); o.setHeading(m ? (m[1].length >= 3 ? 0 : m[1].length + 1) : 1); };
      ({
        outdent: () => o.outdent(i), indent: () => o.indent(i), up: () => o.move(i, -1), down: () => o.move(i, 1),
        newline: () => o.insertAtCaret('\n'), link: () => o.insertAtCaret('[[]]', 2), tag: () => o.insertAtCaret('#'),
        check: () => (o.sel ? o.cycleTodoSel() : o.cycleTodo()), date: () => o.editDate(i, 'scheduled'),
        bold: () => o.wrap('**', '**'), mark: () => o.wrap('^^', '^^'), heading,
        image: () => o.pickImage(), undo: () => o.undo(), redo: () => o.redo(),
        done: () => { o.stopEdit(); o.clearSel(); document.activeElement?.blur(); this.updateToolbar(); },
      })[b.dataset.t]?.();
    });

    document.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('hashchange', () => this.route());
    // two history steps with the same address (left by a page that couldn't be left, see route):
    // moving between them fires no hashchange, so keep the arrows right here
    window.addEventListener('popstate', () => {
      if (location.hash !== this.prevHash) return; // a hashchange follows; route() takes care of it
      const n = history.state?.n;
      if (typeof n === 'number') { this.histN = n; this.updateHistBar(); }
    });
    // laptop mouse back/forward buttons
    window.addEventListener('mouseup', (e) => {
      if (e.button === 3) { e.preventDefault(); history.back(); }
      if (e.button === 4) { e.preventDefault(); history.forward(); }
    });

    // Pick up edits from Drive sync / Claude / other devices: the app is told about file
    // changes; coming back to it re-checks too, in case a notice was missed.
    // (not when "all files access" was just turned on: then the folder is opened again anyway, see start)
    const refresh = () => { if (!(this.noAccess && window.LeanAndroid?.hasAllFilesAccess?.())) this.rescan(); };
    listen('lean-files', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
      else { this.outlines.forEach((o) => o.flush()); if (this.vaultOpen) call('persist').catch(() => {}); }
    });
    window.addEventListener('focus', refresh);
    // without file notifications (the dev server), fall back to a slow check
    if (!isApp) setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
    window.addEventListener('beforeunload', () => this.outlines.forEach((o) => o.flush()));
    // finish saving before the window closes
    listen('lean-close', async () => {
      try { await Promise.race([Promise.all(this.outlines.map((o) => { o.stopEdit(); return o.flush(); })), new Promise((r) => setTimeout(r, 3500))]); } catch {}
      call('quit').catch(() => {});
    });
  }

  onKey(e) {
    const t = e.target;
    const typing = t.closest?.('input, textarea, select, [contenteditable]');
    if (!$('#search').hidden) { if (e.key === 'Escape') this.closeSearch(); return; }
    if (document.querySelector('.modal-back, .pop.datepick, .pop.menu')) return;
    const act = (name) => (this.keyMap[name] || []).some((k) => !k.includes(' ') && same(parseChord(k), evChord(e)));
    if (act('go/search')) { e.preventDefault(); this.openSearch(); return; }
    if (act('go/backward')) { e.preventDefault(); history.back(); return; }
    if (act('go/forward')) { e.preventDefault(); history.forward(); return; }
    if (act('ui/text-bigger')) { e.preventDefault(); this.toast(`Text size ${Math.round(this.textSize(this.textSize() + 0.05) * 100)}%`, 900); return; }
    if (act('ui/text-smaller')) { e.preventDefault(); this.toast(`Text size ${Math.round(this.textSize(this.textSize() - 0.05) * 100)}%`, 900); return; }
    if (act('ui/text-reset')) { e.preventDefault(); this.textSize(1); this.toast('Text size 100%', 900); return; }
    if (act('ui/toggle-left-sidebar') && (!typing || e.ctrlKey || e.metaKey)) { e.preventDefault(); this.toggleSidebar(); return; }
    if (act('go/journals') && (!typing || e.ctrlKey || e.metaKey)) { e.preventDefault(); this.go('journals'); return; }
    if (typing) return;
    // blocks selected: arrows, Tab, Delete, copy… act on them
    const o = this.outlines.find((x) => x.sel);
    if (o && o.onSelKey(e)) { e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      const last = this.active || this.outlines[0];
      if (last) { e.preventDefault(); e.shiftKey ? last.redo() : last.undo(); }
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

  /** Where the notes start on screen (below the top strip or bar), and how to move them by dy:
   *  #main scrolls in a wide window, the whole page in a narrow one. */
  scroller() {
    const main = $('#main');
    if (getComputedStyle(main).overflowY === 'visible') return { top: $('#topbar').getBoundingClientRect().bottom, by: (dy) => window.scrollBy(0, dy) };
    const r = main.getBoundingClientRect();
    const z = (main.offsetWidth ? r.width / main.offsetWidth : 1) || 1; // text size zooms #main; its scrolling counts unzoomed
    return { top: r.top, by: (dy) => { main.scrollTop += dy / z; } };
  }
  /** Remember the block (or day) at the top of the notes, a moment after scrolling stops. */
  noteTop() {
    const main = $('#main');
    const { top } = this.scroller();
    const r = main.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, top + 12)?.closest('.blk, .sheet, .view > *');
    this.topAnchor = el && main.contains(el) ? { el, off: el.getBoundingClientRect().top - top } : null;
  }
  /** After the window switched between wide and narrow: scroll that block back to the top. */
  restoreTop() {
    const a = this.topAnchor;
    if (!a?.el.isConnected) return;
    const s = this.scroller();
    s.by(a.el.getBoundingClientRect().top - s.top - a.off);
  }

  /** Page Down, Space, arrows… In a wide window the notes scroll inside #main, and the browser only
   *  scrolls that by keyboard when it (or something in it) has the focus: give it the focus first.
   *  Pop-ups keep their keys, and Space still presses a focused button. */
  focusForScroll(e) {
    const main = $('#main');
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
    const journal = this.outlines.length === 1 ? this.outlines[0].journal : null;
    const shiftDay = async (n) => {
      const d = journal ? dateOf(journal) : new Date();
      d.setDate(d.getDate() + n);
      this.go('page', await call('journal_name', { date: ymd(d) }));
    };
    ({
      'go/journals': () => this.go('journals'),
      'go/all-pages': () => this.go('pages'),
      'go/todos': () => this.go('todos'),
      'go/date': () => this.goToDate($('#main .view') || document.body),
      'go/next-journal': () => shiftDay(1),
      'go/prev-journal': () => shiftDay(-1),
      'sidebar/open-today-page': async () => this.go('page', await call('journal_name', { date: today() })),
      'ui/toggle-left-sidebar': () => this.toggleSidebar(),
      'editor/toggle-open-blocks': () => (this.active || this.outlines[0])?.toggleAll(),
    })[name]?.();
  }

  renderSideLists() {
    const el = $('#recent');
    if (el) el.innerHTML = this.recent().map((n) => `<a href="#" data-page="${esc(n)}">${esc(n)}</a>`).join('') || '<span class="note" style="padding:0 8px;font-size:13px">Pages you open show up here.</span>';
    const favs = this.summary?.config?.favorites || [];
    const f = $('#favs');
    if (f) f.innerHTML = favs.length ? `<div class="side-sec" data-sec="favs"><button type="button" class="side-h side-fold" aria-expanded="true">Favourites</button><div class="side-list">${favs.map((n) => `<a href="#" data-page="${esc(n)}">${esc(n)}</a>`).join('')}</div></div>` : '';
    this.applySideFolds();
    requestAnimationFrame(() => this.fitRecent());
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

  /** Link colour and fonts chosen in Settings (this device only), on top of the look. */
  applyTextStyle() {
    const s = document.documentElement.style;
    const link = store.get('linkColor', '');
    if (link) { s.setProperty('--link', link); s.setProperty('--link-line', `color-mix(in srgb, ${link} 45%, transparent)`); }
    else { s.removeProperty('--link'); s.removeProperty('--link-line'); }
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
        await this.refreshNames();
        const set = new Set(changed);
        for (const o of this.outlines) if (set.has(o.path)) await o.reload();
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
    if (this.histN > 0) history.back();
    else window.LeanAndroid?.leave?.();
  }
  /** Close the top-most open thing; false if nothing was open. */
  closeTop() {
    // pop-ups close on Escape (their own handlers, which also stop it going further)
    const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const lightbox = $('.modal-back.lightbox');
    if (lightbox) { lightbox.remove(); return true; }
    if ($('.modal-back, .pop.datepick, .pop.menu')) { esc(); return true; }
    if (this.closeLooks) { this.closeLooks(); return true; }
    if (!$('#search').hidden) { this.closeSearch(); return true; }
    if (this.ac.isOpen) { this.ac.close(); return true; }
    if (document.body.classList.contains('drawer')) { document.body.classList.remove('drawer'); return true; }
    const o = this.outlines.find((x) => x.cur !== null || x.sel);
    if (o) { o.stopEdit(); o.clearSel(); document.activeElement?.blur(); this.updateToolbar(); return true; }
    const a = document.activeElement; // e.g. the page properties box, a filter
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
    this.buildChrome();
    this.renderSideLists();
    await this.openVault();
    // the first page replaces the address the app started with (adding it would leave a step
    // behind it that Back goes to)
    if (!location.hash) history.replaceState(history.state, '', this.vaultOpen ? '#/journals' : '#/settings');
    this.route();
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
  }

  async openVault() {
    const path = store.get('vault', '');
    this.vaultOpen = false;
    // Android without "all files access": the folder opens, but no notes can be read in it
    this.noAccess = !!window.LeanAndroid && !window.LeanAndroid.hasAllFilesAccess();
    if (!path) return;
    try {
      const s = await call('open', { path });
      s.today = await call('journal_name', { date: today() });
      this.summary = s;
      this.vaultOpen = true;
      const c = s.config;
      this.keyMap = { ...DEFAULT_KEYS };
      for (const [action, keys] of c.shortcuts || []) this.keyMap[action] = keys;
      window.LeanAndroid?.setWidgetConfig?.(s.root, c.journals_dir, c.journal_file_format, c.journal_title_format);
      this.sendCaptureConfig();
      this.vaultError = null;
      await this.refreshNames();
      this.renderSideLists();
      this.widgetTasksSoon();
    } catch (e) {
      this.vaultError = String(e?.message ?? e);
    }
  }

  /** The phone's share pop-up and widget use the same quick capture format as the app. */
  sendCaptureConfig() {
    const c = this.summary?.config;
    if (!c || !window.LeanAndroid?.setCaptureConfig) return;
    window.LeanAndroid.setCaptureConfig(JSON.stringify({ text: c.capture_text, media: c.capture_media, today: c.capture_today, page: c.capture_page, pagesDir: c.pages_dir, oneTap: store.get('oneTap', false) }));
  }

  /** Once a day: is there a newer build on the public downloads page? */
  async checkUpdate(force = false) {
    if (!isApp) return null;
    let ver = '';
    try { ver = await window.__TAURI__.app.getVersion(); } catch { return null; }
    this.version = ver;
    const last = store.get('updateCheck', { at: 0, latest: null });
    let latest = last.latest;
    if (force || Date.now() - last.at > 864e5) {
      try {
        const r = await fetch('https://api.github.com/repos/srikanth-iyer/lean-outliner-releases/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) { const j = await r.json(); latest = { tag: j.tag_name, url: j.html_url }; }
      } catch { /* offline */ }
      store.set('updateCheck', { at: Date.now(), latest });
    }
    const n = (s) => Number(String(s || '').match(/(\d+)$/)?.[1] || 0);
    this.latest = latest;
    const newer = !!latest && n(latest.tag) > n(ver);
    $('#update').hidden = !newer;
    return newer;
  }
}

const app = new App();
window.leanApp = app; // handy for debugging, and for the Android back button
app.start();

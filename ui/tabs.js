// Tabs, and two pages side by side, in wide windows (like VS Code). The left and the right pane each
// have their own tabs and show one of them. A tab keeps its own back/forward list and how far down it
// was scrolled; tabs that aren't shown aren't loaded: showing one draws its page again (App.draw) and
// scrolls back to where it was. The address (#/page/…) is always the active pane's place, so links,
// the sidebar, search, find and the keys act there. The browser's own history is only listened to:
// a new address is a new place in the active tab, and the browser's back/forward (Android's test
// script, a stray mouse button) moves the active tab as many steps.
// Phones and narrow windows (≤ 860px) stay as they were: no strip, no split (only the active pane
// shows), and Ctrl+click opens the page in place.
import { store, isAndroid } from './api.js';
import { ICON } from './dom.js';
import { esc } from './render.js';
import { menu } from './popups.js';

const MAX = 50; // places kept per tab for back/forward
const VIEWS = { journals: 'Journals', pages: 'All pages', todos: 'To-dos', tags: 'Tags', props: 'Properties', settings: 'Settings' };
const NARROW = matchMedia('(max-width: 860px)');
const narrow = () => NARROW.matches;
/** Kept while the app is open, so a reload keeps back/forward (localStorage keeps the tabs for next time). */
const session = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* not available */ } },
};
const mkPane = (el, tabs = [], cur = 0) => ({ el, tabs, cur, outlines: [], seq: 0 });
/** A press on el's own scroll bar (not on what it shows): beside its page (a scroll bar that takes
 *  room), or on its last 18px (one drawn over the page, as some systems do; only empty margin there). */
function onScrollBar(el, e) {
  if (e.target !== el || el.scrollHeight <= el.clientHeight) return false;
  const r = el.getBoundingClientRect(), z = (el.offsetWidth ? r.width / el.offsetWidth : 1) || 1; // (the text size zooms it)
  return e.clientX >= Math.min(r.left + (el.clientLeft + el.clientWidth) * z, r.right - 18);
}
/** The place a tab shows (an address like "#/page/Name"). */
export const placeOf = (t) => t.hist[t.at];
/** A side's Home, Back, Forward and Go to date in the top strip: they act on that side (the right
 *  side's show only while there are two). */
export const sideNav = (p) => {
  const on = p ? ', on the right' : '';
  return `<button data-a="home" aria-label="Today in Journals${on}" title="Today in Journals (g j)">${ICON.home}</button>`
    + `<button data-h="back" aria-label="Back${on}" title="Back (Alt+←)">${ICON.back}</button><button data-h="forward" aria-label="Forward${on}" title="Forward (Alt+→)">${ICON.forward}</button>`
    + `<button data-a="date" aria-label="Go to date${on}" title="Go to date (g d)">${ICON.date}</button>`;
};
/** What a place shows: kind ('journals', 'page', 'zoom'…), the page's name (or a property), the zoomed-in line. */
export function parsePlace(place) {
  const [, kind = 'journals', ...rest] = String(place || '').split('/');
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  if (kind === 'zoom' && rest.length >= 2) return { kind, arg: dec(rest.slice(0, -1).join('/')), line: Number(rest[rest.length - 1]) };
  return { kind, arg: rest.length ? dec(rest.join('/')) : null, line: null };
}

export class Tabs {
  constructor(app) {
    this.app = app;
    // [{ el (#main or #main2), tabs: [{hist, at, top}], cur, outlines, … }]; one stands in until start()
    this.panes = [mkPane(document.getElementById('main'), [{ hist: [location.hash || '#/journals'], at: 0, top: 0 }])];
    this.ready = false; // (nothing is kept, and the address isn't followed, before start)
    this.act = 0; // the active pane
    this.n = 0; // the step of the browser's history we're at (history.state.n)
    this.how = null; // during a Ctrl/Shift/middle click: what it opens goes to a new 'tab' or the other 'side'
  }
  get pane() { return this.panes[this.act]; }
  tab(p = this.pane) { return p?.tabs[p.cur]; }
  /** Tabs and the split are for wide windows on the laptop. */
  get on() { return !isAndroid && !narrow(); }
  get els() { return [document.getElementById('main'), document.getElementById('main2')]; }

  // ----- starting, remembering -----
  /** The tabs as they were: after a reload with back/forward; at a new start the tabs alone, if there
   *  were several or two sides (one tab: the app starts as it always did). Else one tab on the address. */
  start(open) {
    const st = history.state;
    const reload = typeof st?.n === 'number';
    this.n = reload ? st.n : 0;
    if (!reload) history.replaceState({ ...(st || {}), n: 0 }, '');
    const kept = isAndroid ? null : store.get('tabs', null);
    const saved = !open ? null : (reload && session.get('tabs')) || (kept?.vault === store.get('vault', '') ? kept : null);
    const ok = (s) => typeof s === 'string' && s.startsWith('#/');
    // at a new start, a page that is gone (renamed or deleted elsewhere: no file, nothing links to it)
    // doesn't come back as an empty page
    const there = (place) => {
      const { kind, arg } = parsePlace(place);
      if (reload || (kind !== 'page' && kind !== 'zoom')) return true;
      const low = String(arg).toLowerCase();
      return this.app.names.some((n) => (n.name.toLowerCase() === low || n.aliases?.some((a) => a.toLowerCase() === low)) && (n.exists || n.refs));
    };
    this.panes = [];
    for (const sp of Array.isArray(saved?.panes) ? saved.panes.slice(0, 2) : []) {
      const tabs = [];
      for (const t of Array.isArray(sp?.tabs) ? sp.tabs : []) {
        const hist = (Array.isArray(t?.hist) ? t.hist : []).filter(ok).slice(-MAX);
        if (!hist.length) continue;
        const at = Math.min(Math.max(0, t.at | 0), hist.length - 1);
        if (!there(hist[at])) continue;
        tabs.push(reload ? { hist, at, top: +t.top || 0 } : { hist: [hist[at]], at: 0, top: +t.top || 0 });
      }
      if (tabs.length) this.panes.push(mkPane(this.els[this.panes.length], tabs, Math.min(Math.max(0, sp.cur | 0), tabs.length - 1)));
    }
    // (no notes folder open: the welcome screen if none was ever chosen, else Settings to choose again)
    if (!this.panes.length) this.panes.push(mkPane(this.els[0], [{ hist: [location.hash || (open ? '#/journals' : store.get('vault', '') ? '#/settings' : '#/welcome')], at: 0, top: 0 }]));
    this.act = Math.min(Math.max(0, saved?.act | 0), this.panes.length - 1);
    const t = this.tab();
    if (location.hash && location.hash !== placeOf(t)) { // started at another address: it's where to go
      if (reload) t.hist[t.at] = location.hash; else this.push(t, location.hash);
    }
    this.ready = true;
    this.changed();
  }

  /** Kept for a reload (with back/forward), and for the next start when there are several tabs or two
   *  sides (just the tabs and how far down each was). tops: note the shown tabs' scroll first. */
  save(tops = false) {
    if (!this.ready) return;
    if (tops && !narrow()) for (const p of this.panes) if (!p.restoring && p.el.offsetParent) this.tab(p).top = Math.round(p.el.scrollTop);
    const state = (all) => ({ act: this.act, panes: this.panes.map((p) => ({ cur: p.cur, tabs: p.tabs.map((t) => (all ? t : { hist: [placeOf(t)], at: 0, top: t.top })) })) });
    session.set('tabs', state(true));
    if (isAndroid || !this.app.vaultOpen) return;
    // (with the notes folder they belong to: another folder at the next start doesn't get them)
    const keep = this.panes.length > 1 || this.panes[0].tabs.length > 1 ? { vault: store.get('vault', ''), ...state(false) } : null;
    const json = JSON.stringify(keep);
    if (json !== this.kept) { this.kept = json; store.set('tabs', keep); } // (only when it changed)
  }

  // ----- the address and back/forward -----
  /** The address shows the active pane's place (without a new step in the browser's history). */
  sync() {
    const place = placeOf(this.tab());
    if (location.hash !== place) history.replaceState(history.state, '', place);
  }
  push(t, place) {
    t.hist = t.hist.slice(Math.max(0, t.at + 2 - MAX), t.at + 1);
    t.hist.push(place);
    t.at = t.hist.length - 1;
  }
  /** The address changed (a link, the sidebar, an address typed in) or the browser stepped back or
   *  forward: the active tab follows. */
  fromAddress() {
    const st = history.state;
    const t = this.tab();
    const place = location.hash || '#/journals';
    if (typeof st?.n === 'number') {
      const step = st.n - this.n;
      this.n = st.n;
      if (step) t.at = Math.min(Math.max(0, t.at + step), t.hist.length - 1);
      else if (place !== placeOf(t)) t.hist[t.at] = place; // the address was replaced (a page renamed)
    } else { // a new step in the browser's history: a new place in this tab
      history.replaceState({ ...(st || {}), n: ++this.n }, '');
      if (place !== placeOf(t)) this.push(t, place);
    }
    this.sync();
    this.save();
  }
  /** Does pane p have to draw again (it shows another tab or place than it did)? */
  moved(p) { const d = p.drawn, t = this.tab(p); return !d || d.t !== t || d.place !== placeOf(t); }
  /** Back (-1) or forward (1) in the active tab; false when there's nowhere to go. */
  move(d) {
    const p = this.pane, t = this.tab(p);
    const at = t.at + d;
    if (at < 0 || at >= t.hist.length) return false;
    t.at = at;
    this.changed();
    this.app.draw(p);
    return true;
  }
  /** Pane p is about to show its tab's place: noted, to go back to if it can't be left (undo). */
  drew(p) { const t = this.tab(p); p.drawn = { t, k: p.cur, hist: t.hist.slice(), at: t.at, place: placeOf(t) }; }
  /** Its page can't be left yet (a clash to settle first): the pane goes back to what it shows (a tab
   *  closed meanwhile comes back; one opened meanwhile stays, unopened). */
  undo(p) {
    const d = p.drawn;
    if (!d) return;
    let k = p.tabs.indexOf(d.t);
    if (k < 0) { k = Math.min(d.k, p.tabs.length); p.tabs.splice(k, 0, d.t); }
    p.cur = k;
    d.t.hist = d.hist.slice();
    d.t.at = d.at;
    this.changed();
  }
  /** The page shown in el's pane now goes by another address without being left (Settings' own tabs:
   *  #/settings/look): noted as that tab's place, no step for Back; in the address if it's the active side. */
  replace(el, place) {
    const p = this.panes.find((x) => x.el.contains(el));
    const t = p && this.tab(p);
    if (!t || placeOf(t) === place) return;
    t.hist[t.at] = place;
    if (p.drawn?.t === t) { p.drawn.place = place; p.drawn.hist[p.drawn.at] = place; }
    if (p === this.pane) this.sync();
    this.paint();
    this.save();
  }
  /** Places in every tab follow a renamed page. merged: it went into another page (its notes'
   *  lines are that page's now: a place zoomed into one shows the whole page). */
  renamed(from, to, merged = false) {
    const low = from.toLowerCase();
    for (const p of this.panes) for (const t of p.tabs) {
      t.hist = t.hist.map((place) => {
        const { kind, arg, line } = parsePlace(place);
        if ((kind !== 'page' && kind !== 'zoom') || String(arg).toLowerCase() !== low) return place;
        if (merged) return `#/page/${encodeURIComponent(to)}`;
        return `#/${kind}/${encodeURIComponent(to)}${kind === 'zoom' ? '/' + line : ''}`;
      });
      if (p.drawn?.t === t) p.drawn.place = placeOf(t);
    }
    this.changed();
  }

  // ----- tabs and sides -----
  /** The tabs changed: the address, the layout, the strip, the arrows and what's kept follow. */
  changed() { this.sync(); this.layout(); this.paint(); this.app.here(); this.save(); }
  /** The pane that was clicked or got the focus is the one links, the keys and find act on. */
  activate(pi) {
    if (pi === this.act || !this.panes[pi]) return;
    // the side he leaves stops editing and lets go of its selected notes, so the keys (Delete, Tab,
    // arrows, Ctrl+Z, a replace's Undo) never act there any more. (Only a real click or tap into a
    // side activates it, never scrolling it: see bind.)
    for (const o of this.pane.outlines) { o.stopEdit(); o.clearSel(); }
    const a = this.app.active;
    if (a && !this.panes[pi].outlines.includes(a)) { this.app.active = null; this.app.updateToolbar(); }
    this.app.find.undo = null;
    this.act = pi;
    this.app.find.close();
    this.sync();
    this.layout();
    this.app.here();
    this.save();
  }
  /** Show tab k of pane pi (that pane becomes the active one). */
  show(pi, k) {
    const p = this.panes[pi];
    if (!p?.tabs[k]) return;
    this.activate(pi);
    if (k === p.cur) return;
    p.cur = k;
    this.changed();
    this.app.draw(p);
  }
  /** Open a place in a new tab: in the active pane ('tab'), or on the other side ('side', made if there
   *  is only one). line: a note to show (as when opening it from a reference). */
  open(place, how = 'tab', line = null) {
    if (!this.on) { this.app.pendingLine = line; if (location.hash === place) this.app.route(); else location.hash = place; return; }
    if (how === 'side' && this.panes.length < 2) this.panes.push(mkPane(this.els[1]));
    const pi = how === 'side' ? 1 - this.act : this.act;
    const p = this.panes[pi];
    const t = { hist: [place], at: 0, top: 0 };
    p.tabs.splice(p.tabs.length ? p.cur + 1 : 0, 0, t);
    p.cur = p.tabs.indexOf(t);
    p.line = line;
    this.activate(pi); // (the side it opens on is the active one now)
    this.changed();
    this.app.draw(p);
  }
  /** Close tab k of pane pi. The last tab on a side closes the side; the very last tab stays. */
  close(pi, k) {
    const p = this.panes[pi];
    if (!p?.tabs[k]) return;
    if (p.tabs.length === 1) { if (this.panes.length > 1) this.closePane(pi); return; }
    const shown = k === p.cur;
    p.tabs.splice(k, 1);
    if (k < p.cur) p.cur--;
    else if (shown) p.cur = Math.min(k, p.tabs.length - 1); // the one to its right, else the left
    this.changed();
    if (shown) this.app.draw(p);
  }
  /** Close one side with its tabs: the other fills the window. Not while its page has a clash to settle. */
  async closePane(pi) {
    const p = this.panes[pi];
    if (this.panes.length < 2 || !p || !(await this.app.canLeave(p))) return;
    if (this.panes.length < 2 || !this.panes.includes(p)) return;
    this.dropPane(this.panes.indexOf(p));
    this.changed();
  }
  /** Take pane pi away (its notes are saved). #main is always the first pane: when the left one goes,
   *  the right one's page moves over as it is. The page left keeps what's at its top there. */
  dropPane(pi) {
    const p = this.panes[pi], q = this.panes[1 - pi];
    const r = q.el.getBoundingClientRect();
    const a = document.elementFromPoint(r.left + r.width / 2, r.top + 12)?.closest('.blk, .sheet, .view > *');
    const off = a && q.el.contains(a) ? a.getBoundingClientRect().top - r.top : null;
    p.obs?.disconnect();
    p.seq++; // a page still being drawn there stops
    for (const o of p.outlines) this.app.keepCopy(o); // typing that couldn't be saved: a copy in logseq/bak (as draw does)
    p.outlines = [];
    if (pi === 0) {
      const y = q.el.scrollTop;
      p.el.replaceChildren(...q.el.childNodes);
      q.el = p.el;
      q.el.scrollTop = y;
    } else p.el.replaceChildren();
    this.panes = [q];
    this.act = 0;
    this.layout();
    if (off !== null && a.isConnected) { const s = this.app.scroller(); s.by(a.getBoundingClientRect().top - s.top - off); }
    q.watch?.(); // the journals' "older days" watcher: maybe another scroller now
    this.app.find.close();
  }
  /** Another notes folder was opened: the tabs were the other folder's pages. One side with one tab
   *  on place (the caller draws it; App.leaveAll saved and stopped what was shown first). */
  reset(place) {
    while (this.panes.length > 1) this.dropPane(this.panes.length - 1);
    const p = this.panes[0];
    p.tabs = [{ hist: [place], at: 0, top: 0 }];
    p.cur = 0;
    p.drawn = null;
    this.act = 0;
    this.changed();
  }
  /** A dragged tab dropped in a strip (pane to, before tab at) or on a side of the notes (at null). */
  async moveTab(from, k, to, at = null) {
    const src = this.panes[from], t = src?.tabs[k];
    if (!t) return;
    if (to === from) {
      if (at === null) { this.show(from, k); return; } // dropped on its own side: just shown
      const cur = this.tab(src);
      src.tabs.splice(k, 1);
      src.tabs.splice(at > k ? at - 1 : at, 0, t);
      src.cur = src.tabs.indexOf(cur);
      this.changed();
      return;
    }
    const there = this.panes[to]; // (none yet: dropped on the right half, making two sides)
    if (!there && src.tabs.length < 2) return;
    const shown = src.tabs[src.cur] === t;
    // the pages that stop showing are saved first; one with a clash to settle stays
    if (shown && !(await this.app.canLeave(src))) return this.paint();
    if (there && !(await this.app.canLeave(there))) return this.paint();
    k = src.tabs.indexOf(t);
    if (k < 0 || !this.panes.includes(src) || (there && !this.panes.includes(there))) return this.paint();
    if (!there && this.panes.length < 2) this.panes.push(mkPane(this.els[1]));
    const dst = there || this.panes[1 - this.panes.indexOf(src)];
    if (!dst || dst === src) return this.paint();
    if (shown && !narrow()) t.top = Math.round(src.el.scrollTop);
    const curSrc = this.tab(src);
    src.tabs.splice(k, 1);
    dst.tabs.splice(at ?? dst.tabs.length, 0, t);
    dst.cur = dst.tabs.indexOf(t);
    if (!src.tabs.length) this.dropPane(this.panes.indexOf(src)); // its last tab went: that side closes
    else {
      src.cur = shown ? Math.min(k, src.tabs.length - 1) : src.tabs.indexOf(curSrc);
      if (shown) this.app.draw(src);
    }
    this.act = this.panes.indexOf(dst);
    this.app.find.close();
    this.changed();
    this.app.draw(dst);
  }

  // ----- what it looks like -----
  /** Two sides: the panes side by side (app.css "tabs" block); the active one marked. */
  layout() {
    const two = this.panes.length > 1;
    const col = document.getElementById('col');
    col.classList.toggle('split', two);
    col.classList.toggle('act1', two && this.act === 1);
    document.getElementById('app').classList.toggle('split', two); // (the top strip, across the window, splits too)
    this.els[1].hidden = !two;
    for (const el of this.els) el.classList.toggle('act', el === this.pane.el);
    document.querySelectorAll('#histbar .tabs').forEach((b) => b.classList.toggle('act', +b.dataset.p === this.act));
    const nav = document.querySelector('#histbar .hb-nav[data-p="1"]'); // the right side's own Home, Back, Forward, Go to date
    if (nav && two !== !!nav.firstChild) nav.innerHTML = two ? sideNav(1) : '';
  }
  /** The tab strip in the top bar: only when there are several tabs or two sides. Each side's tabs
   *  (a tablist: Tab reaches the shown one, the arrows the others), then its "+". */
  paint() {
    if (this.dragging || !this.panes.length) return;
    const many = this.panes.length > 1 || this.panes[0].tabs.length > 1;
    const had = document.activeElement?.closest?.('#histbar .tab'); // (the keyboard was on a tab: it stays on the strip)
    document.querySelectorAll('#histbar .tabs').forEach((box) => {
      const p = this.panes[+box.dataset.p], plus = box.nextElementSibling;
      if ((!many || !p) && box.hidden && !box.firstChild) return; // (one tab: nothing to show, as before)
      box.hidden = plus.hidden = !many || !p;
      box.innerHTML = box.hidden ? '' : p.tabs.map((t, k) => this.tabHtml(t, k, k === p.cur, p.el.id)).join('');
      const cur = box.querySelector('.tab.cur'); // very many tabs scroll sideways: the shown one stays in sight
      if (!cur) return;
      const b = box.getBoundingClientRect(), c = cur.getBoundingClientRect();
      if (c.left < b.left) box.scrollLeft -= b.left - c.left;
      else if (c.right > b.right) box.scrollLeft += c.right - b.right;
    });
    if (had && !had.isConnected) document.querySelector(`#histbar .tabs[data-p="${this.act}"] .tab.cur`)?.focus({ preventScroll: true });
  }
  /** A page's name (as the page writes it), its icon:: emoji or a small picture, for a tab. */
  label(place) {
    const { kind, arg } = parsePlace(place);
    if (kind !== 'page' && kind !== 'zoom') {
      return { text: kind === 'props' && arg ? arg : VIEWS[kind] ?? 'Journals', ic: `<span class="tab-ic" aria-hidden="true">${ICON[kind] && VIEWS[kind] ? ICON[kind] : ICON.journals}</span>` };
    }
    const low = String(arg).toLowerCase();
    const info = this.app.names.find((n) => n.name.toLowerCase() === low);
    return { text: info?.name ?? arg, ic: this.app.icon(arg) || (info?.journal ? `<span class="tab-ic" aria-hidden="true">${ICON.calendar}</span>` : '') };
  }
  /** A tab: named by its page alone (the × is for the mouse; the keyboard has Delete and Ctrl+W); only
   *  the shown one is in the Tab key's order. */
  tabHtml(t, k, cur, panel) {
    const { text, ic } = this.label(placeOf(t));
    return `<div class="tab${cur ? ' cur' : ''}" role="tab" aria-selected="${cur}" aria-controls="${panel}" tabindex="${cur ? 0 : -1}" data-k="${k}" title="${esc(text)}">${ic}<span class="tab-t">${esc(text)}</span><button type="button" class="tab-x" tabindex="-1" aria-hidden="true" title="Close (Ctrl+W)">${ICON.winClose}</button></div>`;
  }
  /** Scroll pane p back to where tab t was. Long pages and older journal days come in bit by bit, so
   *  it tries again as the page grows, until it's there, or he scrolls himself, or another page shows. */
  scrollBack(p, t) {
    if (narrow() || !t.top) return;
    const el = p.el, seq = p.seq;
    let tries = 0, last = null;
    p.restoring = t;
    const step = () => {
      const stop = seq !== p.seq || el !== p.el || (last !== null && el.scrollTop !== last);
      if (!stop) { el.scrollTop = t.top; last = el.scrollTop; }
      if (stop || Math.abs(last - t.top) <= 1 || ++tries >= 30) { if (p.restoring === t) p.restoring = null; return; }
      setTimeout(step, 100);
    };
    step();
  }

  // ----- mouse and keys -----
  bind() {
    const hb = document.getElementById('histbar');
    hb.addEventListener('pointerdown', (e) => {
      // a side's part of the strip (its Home/Back/Forward, tabs, "+") makes that side the active one;
      // the keyboard leaves the other side (as a click on this side's page would take it)
      const part = e.target.closest('.hb-nav, .tabs, .tab-new');
      if (!part) return;
      const pi = +part.dataset.p, a = document.activeElement;
      if (a && a !== document.body && !hb.contains(a) && !this.panes[pi]?.el.contains(a)) a.blur();
      this.activate(pi);
      if (e.button === 0 && e.target.closest('.tab') && !e.target.closest('.tab-x')) this.drag(e);
    });
    // a click doesn't put the keyboard on a tab (Space and the arrows go on scrolling the page); Tab does
    hb.addEventListener('mousedown', (e) => { if (e.target.closest('.tab')) e.preventDefault(); });
    hb.addEventListener('focusin', (e) => { const box = e.target.closest('.tabs'); if (box) this.activate(+box.dataset.p); });
    hb.addEventListener('wheel', (e) => { // the mouse wheel moves very many tabs sideways
      const box = e.target.closest('.tabs');
      if (box && box.scrollWidth > box.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { box.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    hb.addEventListener('click', (e) => {
      if (this.dragged) return;
      const plus = e.target.closest('.tab-new');
      if (plus) { this.activate(+plus.dataset.p); this.open('#/journals'); return; }
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const pi = +tab.parentElement.dataset.p;
      if (e.target.closest('.tab-x')) this.close(pi, +tab.dataset.k); else this.show(pi, +tab.dataset.k);
    });
    // the middle button closes a tab, and opens a link in a new tab (not the browser's autoscroll)
    document.addEventListener('mousedown', (e) => { if (e.button === 1 && this.on && e.target.closest?.('a[data-page], a[href^="#/"], #histbar .tab')) e.preventDefault(); }, true);
    document.addEventListener('auxclick', (e) => {
      if (e.button !== 1 || !this.on) return;
      const tab = e.target.closest?.('#histbar .tab');
      const a = !tab && e.target.closest?.('a[data-page], a[href^="#/"]');
      if (tab) this.close(+tab.closest('.tabs').dataset.p, +tab.dataset.k);
      else if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, clientX: e.clientX, clientY: e.clientY, view: window }));
      if (tab || a) e.preventDefault();
    });
    // Ctrl+click on a link: a new tab; Shift+click: the other side (as Logseq's Shift+click opens its
    // sidebar). Whatever the click opens (App.go) goes there; links that set the address themselves
    // (the sidebar's) are opened here.
    document.addEventListener('click', (e) => {
      const how = e.button !== 0 || !(e.ctrlKey || e.metaKey || e.shiftKey) || !this.on ? null : e.ctrlKey || e.metaKey ? 'tab' : 'side';
      if (!how || e.target.closest?.('#histbar, .modal-back, #search input')) return;
      this.how = how;
      setTimeout(() => { this.how = null; }, 0);
      const a = e.target.closest?.('a');
      const href = a?.getAttribute('href') || '';
      if (!a || !(href === '#' || href.startsWith('#/'))) return; // a web link opens as always
      e.preventDefault(); // (not in a window of its own)
      if (href.startsWith('#/')) { e.stopPropagation(); this.how = null; this.open(href, how); }
    }, true);
    // a right-click on a link to a page (sidebar entries, lists, reference headings…) or on a search
    // result that is a page or a note in one (search.js rows r-page, r-recent, r-hit; not a heading, a
    // command, a recent search or "New page"): a small menu to open it in a new tab or on the other side
    document.addEventListener('contextmenu', (e) => {
      if (e.defaultPrevented) return; // (a note's own menu opened: a right-click on its dot, or in the selected notes)
      const a = this.on && e.target.closest?.('a[data-page], a[href^="#/"], #search .results li:is(.r-page, .r-recent, .r-hit)');
      if (!a || a.closest('#histbar, .pop, .modal-back')) return;
      e.preventDefault();
      this.linkMenu(a, new DOMRect(e.clientX, e.clientY, 0, 0));
    });
    // before the note being edited sees them (Tab would indent it)
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    for (const el of this.els) {
      const mine = () => this.activate(this.panes.findIndex((p) => p.el === el));
      // a press makes it the active side; not one on its scroll bar (dragging it only scrolls, like the
      // wheel: typing goes on where it was), nor the middle button on the other side away from a link
      // (Windows' scrolling button), nor a finger that may only be scrolling (a tap does, on click)
      const scrolls = (e) => onScrollBar(el, e) || (e.button === 1 && this.pane?.el !== el && !e.target.closest?.('a[data-page], a[href^="#/"]'));
      el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' && !scrolls(e)) mine(); }, true);
      el.addEventListener('mousedown', (e) => { if (scrolls(e)) e.preventDefault(); }, true); // (nor takes the keyboard from the note being typed in)
      el.addEventListener('click', (e) => { if (e.pointerType === 'touch') mine(); }, true);
      el.addEventListener('focusin', mine);
    }
  }

  /** The small menu for a link to a page, or a search result (a right-click on it, or the ⋯ beside a
   *  sidebar entry): open it in a new tab or on the other side, as Ctrl+click and Shift+click do (the
   *  click is passed on with that key, so it opens just as they do), then what the app adds for it
   *  (App.linkItems: "Remove from favourites"). at: the rectangle it opens by. */
  linkMenu(a, at) {
    const x = at.left, y = at.bottom;
    const open = (key) => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, [key]: true, clientX: x, clientY: y, view: window }));
    menu({ getBoundingClientRect: () => at }, [
      { label: 'Open in a new tab', hint: 'Ctrl+click', run: () => open('ctrlKey') },
      { label: 'Open to the side', hint: 'Shift+click', run: () => open('shiftKey') },
      ...(this.app.linkItems?.(a) ?? []),
    ]);
  }

  /** Ctrl+T: a new tab (Journals); Ctrl+W: close it; Ctrl+Tab / Ctrl+Shift+Tab (or Ctrl+PageDown /
   *  PageUp): the next / previous tab on this side. And the keys of a tab that has the keyboard. */
  onKey(e) {
    const tab = e.target.closest?.('#histbar .tab');
    if (tab && !e.ctrlKey && !e.metaKey && !e.altKey && this.tabKey(e, tab)) { e.preventDefault(); e.stopPropagation(); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !this.on) return;
    if (!document.getElementById('search').hidden || document.querySelector('.modal-back, .pop.menu, .pop.datepick')) return;
    const p = this.pane, n = p.tabs.length;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Tab' || ((key === 'PageDown' || key === 'PageUp') && !e.shiftKey)) {
      const next = key === 'Tab' ? !e.shiftKey : key === 'PageDown';
      this.show(this.act, (p.cur + (next ? 1 : n - 1)) % n);
    } else if (key === 't' && !e.shiftKey) this.open('#/journals');
    else if (key === 'w' && !e.shiftKey) this.close(this.act, p.cur);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  /** A tab with the keyboard (the usual keys of a tab strip): ← → (Home, End) go along its side's tabs,
   *  Enter or Space shows that one, Delete closes it. true: the key was for the tab. */
  tabKey(e, tab) {
    const box = tab.parentElement, pi = +box.dataset.p;
    const all = [...box.querySelectorAll('.tab')], k = all.indexOf(tab), n = all.length;
    const to = { ArrowLeft: k - 1, ArrowRight: k + 1, Home: 0, End: n - 1 }[e.key];
    if (to !== undefined) all[(to + n) % n].focus();
    else if (e.key === 'Enter' || e.key === ' ') this.show(pi, k);
    else if (e.key === 'Delete') this.close(pi, k);
    else return false;
    return true;
  }

  /** Dragging a tab: along a strip to move it, to the other side's strip, or onto the right (or left)
   *  half of the notes to show it there, side by side. Esc puts it back. */
  drag(e) {
    const el = e.target.closest('.tab');
    const from = +el.closest('.tabs').dataset.p, k = +el.dataset.k;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, spot = null;
    const mark = document.createElement('div');
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        ghost = el.cloneNode(true);
        ghost.classList.add('ghost');
        document.body.append(ghost, mark);
        el.classList.add('dragging');
        this.dragging = true;
      }
      ghost.style.left = ev.clientX + 10 + 'px';
      ghost.style.top = ev.clientY + 8 + 'px';
      spot = this.spotAt(ev.clientX, ev.clientY);
      mark.hidden = !spot;
      if (!spot) return;
      const r = spot.zone || spot.line;
      const pad = spot.zone ? 6 : 0;
      mark.className = spot.zone ? 'tab-drop zone' : 'tab-drop';
      mark.textContent = spot.zone ? (this.panes.length > 1 ? 'Show it here' : 'Show it here, side by side') : '';
      Object.assign(mark.style, { left: r.left + pad + 'px', top: r.top + pad + 'px', width: (spot.zone ? r.width - 2 * pad : 3) + 'px', height: r.height - 2 * pad + 'px' });
    };
    const end = (drop) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', onEsc, true);
      if (!ghost) return;
      ghost.remove();
      mark.remove();
      el.classList.remove('dragging');
      this.dragging = false;
      this.dragged = true; // the click that follows the drag isn't a click on the tab
      setTimeout(() => { this.dragged = false; }, 0);
      if (drop && spot) this.moveTab(from, k, spot.p, spot.at); else this.paint();
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const onEsc = (ev) => { if (ev.key === 'Escape' && ghost) { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    el.setPointerCapture?.(e.pointerId);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', onEsc, true);
  }
  /** Where a dragged tab would go: {p, at, line} in a strip, {p, at: null, zone} on a side of the notes. */
  spotAt(x, y) {
    for (const box of document.querySelectorAll('#histbar .tabs:not([hidden])')) {
      const r = box.getBoundingClientRect();
      if (y < r.top - 8 || y > r.bottom + 8 || x < r.left - 8 || x > r.right + 48) continue;
      const tabs = [...box.querySelectorAll('.tab')];
      let at = tabs.findIndex((t) => { const b = t.getBoundingClientRect(); return x < b.left + b.width / 2; });
      if (at < 0) at = tabs.length;
      const b = (tabs[at] || tabs[at - 1])?.getBoundingClientRect();
      const left = !b ? r.left : tabs[at] ? b.left - 2 : b.right + 1;
      return { p: +box.dataset.p, at, line: { left, top: r.top + 3, height: r.height - 6 } };
    }
    const inside = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (this.panes.length > 1) {
      const pi = this.panes.findIndex((p) => inside(p.el.getBoundingClientRect()));
      return pi < 0 ? null : { p: pi, at: null, zone: this.panes[pi].el.getBoundingClientRect() };
    }
    const r = this.panes[0].el.getBoundingClientRect();
    if (!inside(r) || x < r.left + r.width / 2) return null; // the right half makes two sides
    return { p: 1, at: null, zone: { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height } };
  }
}

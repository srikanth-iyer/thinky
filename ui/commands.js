// The command list (Ctrl+Shift+P), like Logseq's command palette: every action the app has, found
// by typing its name (search.js shows and filters it, in the search box), run with Enter. Each one
// shows its key from the app's shortcut table (app.keyMap: DEFAULT_KEYS in app.js, changed by
// config.edn :shortcuts, as in Logseq), so the keys are learned along the way. The actions are the
// app's own (App, Tabs, Find, Outline, the / menu's commands): nothing here does the work itself.

import { isAndroid, isApp, call, pageLinkUrl } from './api.js';
import { SLASH, promptBox } from './popups.js';
import { openHistory } from './history.js';
import { placeOf, parsePlace } from './tabs.js';
import { SKINS } from './app.js';
import { TABS } from './settings.js';
import { esc } from './render.js';

// ---------------------------------------------------------------------------
// Keys as he'd press them: "mod+shift+p" → Ctrl+Shift+P, "g j" → g then j.
const KEY_NAMES = {
  mod: 'Ctrl', ctrl: 'Ctrl', meta: 'Ctrl', shift: 'Shift', alt: 'Alt', 'open-square-bracket': '[', 'close-square-bracket': ']',
  backslash: '\\', plus: '+', up: '↑', down: '↓', left: '←', right: '→', enter: 'Enter', tab: 'Tab', esc: 'Esc', space: 'Space',
  pageup: 'PageUp', pagedown: 'PageDown', delete: 'Delete', backspace: 'Backspace',
};
const chord = (c) => {
  const parts = c.split('+');
  if (c.endsWith('++')) parts.splice(-2, 2, 'plus');
  return parts.filter(Boolean).map((p) => KEY_NAMES[p] ?? (p.length === 1 && parts.length > 1 ? p.toUpperCase() : p.length > 1 ? p[0].toUpperCase() + p.slice(1) : p)).join('+');
};
/** One key (Logseq's notation) as keycaps: a key combination is one, a sequence ("g j") one per key. */
export const keyHtml = (k) => (k ? k.trim().split(/\s+/).map((c) => `<kbd>${esc(chord(c))}</kbd>`).join(' ') : '');
/** The first key of an action in the app's shortcut table ('' if it has none, or it was turned off). */
export const keyOf = (app, action) => (app.keyMap[action] || [])[0] || '';

// ---------------------------------------------------------------------------
/** The note being edited when the box opened (it stops when the box takes the keyboard), to edit it
 *  again before an editing command runs, or after the box is closed with Esc: {o, i, s, e, text}. */
export function editingNow(app) {
  const o = app.outlines.find((x) => x.cur !== null && x.ta);
  return o ? { o, i: o.cur, s: o.ta.selectionStart, e: o.ta.selectionEnd, text: o.blocks[o.cur]?.text } : null;
}
/** Edit that note again, the same words selected, if it's still on screen as it was. */
export function editAgain(app, ed) {
  const { o, i } = ed;
  if (!app.outlines.includes(o) || o.readonly || o.conflict || o.blocks[i]?.text !== ed.text) return false;
  if (o.cur !== i || !o.ta) o.edit(i, ed.s); // (as a click on it: the same page on the other side is minded)
  if (o.cur !== i || !o.ta) return false;
  o.ta.focus({ preventScroll: true });
  o.ta.setSelectionRange(ed.s, ed.e);
  return true;
}

/**
 * Every command that fits where he is: {id, label, group, run, key (an action of the shortcut
 * table) or keys (fixed keys, same notation), hint, also (more words it's found by), more (only
 * shown when typed for), edit (needs the note being edited)}. ed: editingNow() when the box opened.
 */
export function commandList(app, ed) {
  const T = app.tabs, p = app.pane;
  const t = T.tab();
  const { kind } = t ? parsePlace(placeOf(t)) : { kind: null };
  const page = (kind === 'page' || kind === 'zoom') && p.outlines.length === 1 ? p.outlines[0] : null;
  const propsBox = page && p.el.querySelector('.page-props');
  const sel = p.outlines.find((o) => o.sel);
  const phone = isAndroid || matchMedia('(max-width: 860px)').matches;
  const open = !!app.vaultOpen;
  const L = [];
  const add = (group, id, label, run, more = {}) => L.push({ group, id, label, run, ...more });

  // ----- go -----
  if (open) {
    add('Go', 'journals', 'Go to Journals', () => app.go('journals'), { key: 'go/journals', also: 'home today' });
    add('Go', 'all-pages', 'Go to All pages', () => app.go('pages'), { key: 'go/all-pages', also: 'list' });
    add('Go', 'todos', 'Go to To-dos', () => app.go('todos'), { key: 'go/todos', also: 'tasks' });
    add('Go', 'tags', 'Go to Tags', () => app.go('tags'));
    add('Go', 'props', 'Go to Properties', () => app.go('props'));
    add('Go', 'today', 'Open today’s journal page', () => app.runAction('sidebar/open-today-page'), { key: 'sidebar/open-today-page' });
    add('Go', 'date', 'Go to a date…', () => app.runAction('go/date'), { key: 'go/date', also: 'calendar day' });
    add('Go', 'next-day', 'Next journal day', () => app.runAction('go/next-journal'), { key: 'go/next-journal' });
    add('Go', 'prev-day', 'Previous journal day', () => app.runAction('go/prev-journal'), { key: 'go/prev-journal' });
  }
  add('Go', 'back', 'Back', () => app.back(), { key: 'go/backward' });
  add('Go', 'forward', 'Forward', () => app.forward(), { key: 'go/forward' });
  if (open) {
    add('Go', 'search', 'Search', null, { key: 'go/search', also: 'find' });
    add('Go', 'random', 'Open a random page', () => app.randomPage());
  }
  // the Settings tabs (as settings.js shows them: Capture and Shortcuts with a folder open, no
  // Shortcuts on phones)
  const SET_ALSO = { notes: 'folder bin deleted safety copies check', look: 'theme colours fonts text size', capture: 'quick capture share', keys: 'keyboard shortcuts keys', about: 'version update problems log' };
  for (const [id, label] of TABS) {
    if ((!open && (id === 'capture' || id === 'keys')) || (isAndroid && id === 'keys')) continue;
    add('Go', 'settings-' + id, `Settings: ${label}`, () => app.go('settings', id), { also: 'preferences options ' + (SET_ALSO[id] || '') });
  }

  if (open) {
    add('Page', 'new-page', 'New page…', async () => {
      const name = await promptBox({ title: 'New page', ok: 'Open', placeholder: 'Its name' });
      if (name?.trim()) app.go('page', name.trim());
    }, { also: 'create add' });
  }

  // ----- this page -----
  if (page) {
    const name = page.name;
    if (!page.journal) add('Page', 'rename', 'Rename this page…', () => app.renamePage(name));
    add('Page', 'history', 'Page history…', () => openHistory(app, page), { also: 'versions backup earlier' });
    if (propsBox?.edit && !propsBox.has) add('Page', 'props-add', 'Add page properties', () => propsBox.edit(), { also: 'tags alias' });
    const fav = (app.summary?.config?.favorites || []).some((f) => f.toLowerCase() === name.toLowerCase());
    add('Page', 'fav', fav ? 'Remove from favourites' : 'Add to favourites', () => app.toggleFavourite(name), { also: 'star favorite' });
    add('Page', 'print', 'Print or save as PDF', () => app.printPage(), { also: 'export' });
    add('Page', 'copy-link', 'Copy a link to this page', () => app.copyLink(pageLinkUrl(name), 'Link to this page copied'), { also: 'url leanoutliner share' });
    if (isApp && !isAndroid) add('Page', 'reveal', 'Show this page’s file in Explorer', () => call('reveal_file', { name }).catch((e) => app.toast(String(e?.message ?? e), 5000)), { also: 'folder open file' });
    if (T.on) {
      const place = placeOf(t);
      add('Page', 'new-tab', 'Open this page in a new tab', () => T.open(place));
      add('Page', 'to-side', 'Open this page to the side', () => T.open(place, 'side'), { also: 'split two' });
    }
  }
  if (open && p.outlines.length) {
    add('Page', 'find', 'Find on this page', () => app.find.open(), { key: 'go/search-in-page' });
    add('Page', 'replace', 'Find and replace on this page', () => app.find.open(true), { key: 'go/replace-in-page' });
    add('Page', 'fold-all', 'Fold or unfold all notes', () => app.runAction('editor/toggle-open-blocks'), { key: 'editor/toggle-open-blocks', also: 'collapse expand' });
  }

  // ----- the note being edited, or the notes selected -----
  if (ed) {
    const { o } = ed;
    const E = (id, label, run, more = {}) => add('Editing', id, label, () => run(o, o.cur), { edit: true, ...more });
    E('indent', 'Indent', (x, i) => x.indent(i), { keys: ['tab'], also: 'move right' });
    E('outdent', 'Outdent', (x, i) => x.outdent(i), { keys: ['shift+tab'], also: 'unindent move left' });
    E('up', 'Move note up', (x, i) => x.move(i, -1), { key: 'editor/move-block-up' });
    E('down', 'Move note down', (x, i) => x.move(i, 1), { key: 'editor/move-block-down' });
    E('todo', 'Next to-do state', (x) => x.cycleTodo(), { keys: ['mod+enter'], also: 'todo doing done task' });
    E('menu', 'Note menu…', (x, i) => x.openMenu(i, { kb: true }), { keys: ['shift+f10'], also: 'colour color heading cut copy block' });
    E('undo', 'Undo', (x) => app.undo(x), { keys: ['mod+z'] });
    E('redo', 'Redo', (x) => app.redo(x), { keys: ['mod+y'] });
    // the / menu's commands, run as from it (to-do words, dates, links, formatting, headings…)
    const SLASH_KEYS = { bold: { keys: ['mod+b'] }, italic: { keys: ['mod+i'] }, mark: { key: 'editor/highlight' } };
    for (const [label, hint, id] of SLASH) E('slash-' + (id || label), label, (x) => x.command(id || label), { hint, also: 'insert /', ...SLASH_KEYS[id] });
  } else if (sel) {
    const S = (id, label, run, more = {}) => add('Selected notes', id, label, () => run(sel, sel.selRange()[0]), more);
    S('indent', 'Indent the selected notes', (x, i) => x.indent(i), { keys: ['tab'] });
    S('outdent', 'Outdent the selected notes', (x, i) => x.outdent(i), { keys: ['shift+tab'] });
    S('up', 'Move the selected notes up', (x, i) => x.move(i, -1), { key: 'editor/move-block-up' });
    S('down', 'Move the selected notes down', (x, i) => x.move(i, 1), { key: 'editor/move-block-down' });
    S('todo', 'Next to-do state', (x) => x.cycleTodoSel(), { keys: ['mod+enter'] });
    S('menu', 'Note menu…', (x) => x.openMenu(x.sel.b, { kb: true }), { keys: ['shift+f10'], also: 'colour color heading cut copy' });
  }

  // ----- window, tabs, look -----
  if (T.on) {
    add('Window', 'tab-new', 'New tab', () => T.open('#/journals'), { keys: ['mod+t'] });
    const tp = T.pane;
    if (tp.tabs.length > 1 || T.panes.length > 1) add('Window', 'tab-close', 'Close this tab', () => T.close(T.act, tp.cur), { keys: ['mod+w'] });
    if (tp.tabs.length > 1) {
      add('Window', 'tab-next', 'Next tab', () => T.show(T.act, (tp.cur + 1) % tp.tabs.length), { keys: ['mod+tab'] });
      add('Window', 'tab-prev', 'Previous tab', () => T.show(T.act, (tp.cur + tp.tabs.length - 1) % tp.tabs.length), { keys: ['mod+shift+tab'] });
    }
    if (T.panes.length > 1) add('Window', 'side-close', 'Close this side', () => T.closePane(T.act), { also: 'split' });
  }
  if (phone) add('Window', 'menu', 'Open the menu', () => document.body.classList.add('drawer'), { also: 'sidebar drawer' });
  else add('Window', 'sidebar', 'Hide or show the sidebar', () => app.toggleSidebar(), { key: 'ui/toggle-left-sidebar' });
  add('Window', 'bigger', 'Bigger text', () => app.runAction('ui/text-bigger'), { key: 'ui/text-bigger', also: 'zoom in size' });
  add('Window', 'smaller', 'Smaller text', () => app.runAction('ui/text-smaller'), { key: 'ui/text-smaller', also: 'zoom out size' });
  add('Window', 'text-reset', 'Text size back to 100%', () => app.runAction('ui/text-reset'), { key: 'ui/text-reset', also: 'zoom reset size' });
  add('Look', 'look', 'Change the look…', () => {
    const b = document.querySelector('#side [data-a="looks"]');
    if (b?.offsetParent && !phone) app.openLooks(b); else app.go('settings', 'look');
  }, { also: 'theme skin colours' });
  const cur = document.documentElement.dataset.skin;
  for (const s of SKINS) add('Look', 'look-' + s.id, `Look: ${s.name}`, () => app.setSkin(s.id), { hint: s.id === cur ? 'now' : '', also: 'theme skin ' + s.note, more: true });
  // what's nearest first: the note being edited, this page, then going places, the window, the look
  const ORDER = ['Editing', 'Selected notes', 'Page', 'Go', 'Window', 'Look'];
  return L.map((c, k) => [c, k]).sort(([a, j], [b, k]) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || j - k).map(([c]) => c);
}

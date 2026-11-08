// Small helpers the search box needs at once, kept out of commands.js so the command list (and what it
// brings: Settings, History) loads only when it's first opened (Build 39: a faster start).
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


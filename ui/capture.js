// The "Add to journal" box (the Windows shortcut key or the browser button), like a launcher:
// type, Enter adds the note (in the quick capture format) where it goes and the box closes.
// It grows with the text, says where the note will go, and closes with Esc or ×, or when you
// click somewhere else with nothing new in it. No title bar: drag it by its edges or bottom strip.
import { call } from './api.js';
import { ICON } from './dom.js';

const ta = document.querySelector('textarea');
const where = document.querySelector('.cap-where');
const T = window.__TAURI__;
const win = T?.window?.getCurrentWindow?.() ?? null;
const Size = T?.dpi?.LogicalSize ?? T?.window?.LogicalSize;
document.querySelector('.cap-ic').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>';
document.querySelector('.cap-x').innerHTML = ICON.winClose;

const close = () => call('quit').catch(() => window.close());
let dest = ''; // where notes go, e.g. "October 26th, 2026"

const LINE = 30; // one line of the text box (capture.html)
const MAX_LINES = 6; // then it scrolls
let shown = 0;
/** Make the text box as tall as its text (up to 6 lines) and the window fit around it. */
function fit() {
  ta.style.height = '0px';
  const h = Math.min(Math.max(ta.scrollHeight, LINE), LINE * MAX_LINES);
  ta.style.height = h + 'px';
  const total = Math.ceil(15 + 12 + Math.max(h + 1, 32) + document.querySelector('.cap-foot').offsetHeight);
  if (total !== shown && win && Size) { shown = total; win.setSize(new Size(640, total)).catch(() => {}); }
}

let adding = false; // a second Enter while the note is being added must not add it twice
async function add() {
  const text = ta.value.trim();
  if (!text) return close();
  if (adding) return;
  adding = true;
  ta.readOnly = true;
  try {
    await call('quick_capture', { text, url: '' });
    where.className = 'cap-where ok';
    where.textContent = `✓ Added to ${dest || 'your notes'}`;
    setTimeout(close, 650);
  } catch (e) {
    adding = false;
    ta.readOnly = false;
    where.className = 'cap-where err';
    where.textContent = String(e);
    fit();
  }
}

// When the box is ready (its text filled in). The box takes the keyboard when it pops up, so an
// Enter meant for another window can land in it: Enter in its first half-second is ignored.
let readyAt = Infinity;
const GUARD_MS = 500;
ta.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { // Shift+Enter: a new line
    e.preventDefault();
    if (performance.now() - readyAt >= GUARD_MS) add();
  }
});
ta.addEventListener('input', fit);
// Esc and × close it, but not while a note is being added (that would cut the writing short)
const shut = () => { if (!adding) close(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); shut(); } });
document.querySelector('[data-a="close"]').onclick = shut;
// Clicked somewhere else: a box with nothing new in it goes away: empty, or still just the
// clipboard's text (that's still on the clipboard). One with typing, or with text from a web page,
// stays, so nothing is lost. Not while it's still starting (its text may not be filled in yet).
let hadFocus = false;
let fromClipboard = null; // the text the clipboard filled in
window.addEventListener('focus', () => { hadFocus = true; });
window.addEventListener('blur', () => {
  if (readyAt === Infinity || !hadFocus || adding) return;
  if (!ta.value.trim() || ta.value === fromClipboard) close();
});

(async () => {
  try {
    const w = await call('capture_where');
    dest = w.page;
    where.innerHTML = '';
    where.append('To ', Object.assign(document.createElement('b'), { textContent: w.today ? `today’s journal (${w.page})` : w.page }));
  } catch (e) {
    where.className = 'cap-where err';
    where.textContent = String(e);
  }
  try {
    const p = await call('prefill');
    ta.value = [p.text, p.url].filter((x) => x && x.trim()).join(' ');
    if (p.from === 'clipboard') fromClipboard = ta.value;
  } catch { /* nothing to pre-fill */ }
  fit();
  ta.focus();
  ta.select();
  hadFocus = document.hasFocus();
  readyAt = performance.now();
})();

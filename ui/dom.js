// Small shared helpers for building the page, and the icons.
import { esc } from './render.js';

export const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
/** "1 note", "3 notes" (`many` for other plurals). */
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const pageLink = (name, label) => `<a href="#" data-page="${esc(name)}">${esc(label ?? name)}</a>`;

/** The name and its marks, drawn from ui/brand/ (made once from the font, scripts/make_wordmark.py:
 *  the app ships no font for them). The letters take the look's ink (currentColor through <use>);
 *  the spark stays red. The box (0 0 207 91) is the file's own. */
export const BRAND = {
  // the icon in the look's colours (ui/brand/icon-in.svg: the drawing meant for that size, coloured by
  // --logo-tile/-ink/-spark; he asked, Oct 29: "modify the thinky icon accordingly" in other looks)
  icon: (big) => `<svg class="logo" viewBox="0 0 1024 1024" aria-hidden="true"><use href="brand/icon-in.svg#${big ? 'm' : 's'}"/></svg>`,
  wordmark: '<svg class="wordmark" viewBox="0 0 207 91" role="img" aria-label="thinky"><use href="brand/wordmark.svg#m"/></svg>',
  // the name inside a sentence or heading, as any word would sit there (he asked: wherever the name
  // shows, it's the wordmark, Oct 29); sized and lined up with the words around it (app.css .wm-in)
  word: '<svg class="wm-in" viewBox="0 0 207 91" role="img" aria-label="thinky"><use href="brand/wordmark.svg#m"/></svg>',
  // an empty screen or list: the icon's scribble alone, faded, over its line of words (he picked it,
  // Oct 29); the scribble takes the look's ink (brand/scribble.svg, currentColor), the spark stays red
  // a slow wait (opening a notes folder, the first search, reading every note…): the scribble drawing
  // itself round and round, small, beside its words (app.css .spin; still with reduced motion)
  spin: '<svg class="spin" viewBox="0 0 720 680" aria-hidden="true"><use class="sp-base" href="brand/scribble.svg#m"/><use class="sp-run" href="brand/scribble.svg#m"/></svg>',
  wait: (words, tag = 'p', cls = '') => `<${tag} class="wait-mark${cls ? ' ' + cls : ''}" role="status">${BRAND.spin}<span>${words}</span></${tag}>`,
  empty: (words, tag = 'div') => `<${tag} class="empty-mark"><svg class="scribble" viewBox="0 0 720 680" aria-hidden="true"><use href="brand/scribble.svg#m"/></svg><span>${words}</span></${tag}>`,
};

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;
export const ICON = {
  journals: svg('<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  pages: svg('<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/>'),
  todos: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  tags: svg('<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>'),
  props: svg('<path d="M5 7h3M11 7h8M5 12h3M11 12h8M5 17h3M11 17h8"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  filter: svg('<path d="M4.5 7h15M7.5 12h9M10.5 17h3"/>'), // (the references' tools, App.refTools)
  sortChanged: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'), // (sorted by: last changed)
  sortName: svg('<path d="M3.5 10.5 6.5 3.5l3 7M4.6 8h3.8M3.8 14h5.4l-5.4 6.5h5.4"/><path d="M17 4v16M13.5 16.5 17 20l3.5-3.5"/>'), // (by name, A to Z)
  foldAll: svg('<path d="m8 4 4 4 4-4M8 20l4-4 4 4M5 12h14"/>'), // (fold all: arrows in to a line)
  openAll: svg('<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>'), // (open all: arrows out)
  cmd: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m7.5 10 2.5 2-2.5 2M12 15h4.5"/>'), // the command list
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  home: svg('<path d="M3.5 11.2 12 4.5l8.5 6.7"/><path d="M6 9.6v9.9h12V9.6"/><path d="M10 19.5v-5h4v5"/>'),
  back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  forward: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  // window buttons (the app draws its own title bar on Windows)
  winMin: svg('<path d="M6 12h12"/>', ' stroke-width="1.3"'),
  winMax: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="1.2"/>', ' stroke-width="1.3"'),
  winRestore: svg('<rect x="6.5" y="8.5" width="9" height="9" rx="1.2"/><path d="M9 8.5V7.2c0-.7.5-1.2 1.2-1.2h6.6c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2h-1.3"/>', ' stroke-width="1.3"'),
  winClose: svg('<path d="M7 7l10 10M17 7 7 17"/>', ' stroke-width="1.3"'),
  plus: svg('<path d="M12 6v12M6 12h12"/>', ' stroke-width="1.5"'),
  // the phone's "+" (#addnote): the plus in the logo's pen line (a hand's slight curves, round ends)
  // with the red spark at its upper tip (app.css .fab-spark)
  addNote: svg('<path d="M11.7 7.1c.25 3.7.05 7.6.15 11.6M5.6 12.95c4.2-.35 8.2-.15 12.2-.4"/><path class="fab-spark" d="M17.9 2.3Q17.9 6.1 21.7 6.1Q17.9 6.1 17.9 9.9Q17.9 6.1 14.1 6.1Q17.9 6.1 17.9 2.3Z"/>'),
  // the app's icon (ui/brand/, his "scribble to spark", Oct 29 2026), in the look's colours (BRAND.icon)
  logo: '<svg class="logo" viewBox="0 0 1024 1024" aria-hidden="true"><use href="brand/icon-in.svg#s"/></svg>',
  // the sidebar's strip (narrow windows, the phone's menu): the icon with the name beside it (a row has room)
  brand: '<span class="brand-mark" aria-label="thinky" role="img"><svg class="logo" viewBox="0 0 1024 1024" aria-hidden="true"><use href="brand/icon-in.svg#s"/></svg>'
    + '<svg class="wordmark" viewBox="0 0 207 91" aria-hidden="true"><use href="brand/wordmark.svg#m"/></svg></span>',
  outdent: svg('<path d="M20 6H10M20 12h-7M20 18H10M7 9l-3 3 3 3"/>'),
  indent: svg('<path d="M20 6H10M20 12h-7M20 18H10M4 9l3 3-3 3"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  check: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  done: svg('<path d="M6 9l6 6 6-6"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  newline: svg('<path d="M19 5v6a3 3 0 0 1-3 3H6"/><path d="m9 10-4 4 4 4"/>'),
  date: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5.5-5.5 4 4 2.5-2.5 4.5 4.5"/>'),
  bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>', ' stroke-width="2.2"'),
  italic: svg('<path d="M10.5 5H18M6 19h7.5M14.5 5l-5 14"/>', ' stroke-width="2.2"'),
  link: svg('<path d="M7 5H4v14h3M10.5 5h-3v14h3M17 5h3v14h-3M13.5 5h3v14h-3"/>', ' stroke-width="2"'),
  tag: svg('<path d="M9.5 4 7.5 20M16.5 4l-2 16M5 9h15M4 15h15"/>', ' stroke-width="2"'),
  mark: svg('<path d="m15 4 5 5-9 9H6v-5z"/><path d="M4 21h16"/>'),
  heading: svg('<path d="M6 4v16M18 4v16M6 12h12"/>'),
  slash: svg('<path d="M15.5 4 8.5 20"/>', ' stroke-width="2.2"'),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  // a page's favourite button: the logo's four-point spark (an outline; filled in --spark when on)
  fav: svg('<path d="M12 3.2Q12 12 20.8 12Q12 12 12 20.8Q12 12 3.2 12Q12 12 12 3.2Z"/>'),
  side: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>'),
  shuffle: svg('<path d="M4 7h3.5c4 0 5 10 9 10H20M17 14l3 3-3 3M4 17h3.5c1.5 0 2.5-1.4 3.4-3M20 7h-3.5c-1.5 0-2.5 1.4-3.4 3M17 4l3 3-3 3"/>'),
  replace: svg('<path d="M4 8h11.5M12 4.5 15.5 8 12 11.5M20 16H8.5M12 12.5 8.5 16l3.5 3.5"/>'),
  palette: svg('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.8 0-1 .8-1.6 1.8-1.6h2.2a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.1-8.5-7.1z"/><circle cx="7.6" cy="11.2" r="1.1"/><circle cx="10" cy="7.5" r="1.1"/><circle cx="14.4" cy="7.5" r="1.1"/>'),
};

/** The "/" list's icons, by what each row does (popups.js SLASH's ids; Build 44, he said go: every row
 *  looked the same, so the list was slow to scan). Drawn like the rest (`svg`); a heading's level and a
 *  priority's letter are the letters themselves (`t`: a small badge, app.css .ac-ic). The phone toolbar's
 *  icons are used where it has one for the same thing. */
const box = '<rect x="4" y="4" width="16" height="16" rx="3"/>';
const cal = '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
const frame = '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>';
export const SLASH_ICON = {
  TODO: svg(box), DOING: svg(box + '<path d="M8.5 12h7"/>'), LATER: svg(box + '<path d="M12 8.5V12l2.5 1.5"/>'), NOW: svg(box + '<circle cx="12" cy="12" r="2" fill="currentColor"/>'),
  WAITING: svg(box + '<path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>', ' stroke-width="2.4"'), DONE: ICON.check, CANCELED: svg(box + '<path d="m9 9 6 6M15 9l-6 6"/>'),
  sched: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'), deadline: svg('<path d="M6 21V4.5M6 5h12l-3 4 3 4H6"/>'), date: ICON.date,
  today: svg(cal + '<circle cx="12" cy="15" r="1.4" fill="currentColor"/>'), tomorrow: svg(cal + '<path d="M9 15h6M13 13l2 2-2 2"/>'), yesterday: svg(cal + '<path d="M15 15H9M11 13l-2 2 2 2"/>'),
  time: svg('<circle cx="12" cy="12" r="5.5"/><path d="M12 9.5V12l1.8 1.2M9.6 7 10.2 3.5h3.6l.6 3.5M9.6 17l.6 3.5h3.6l.6-3.5"/>'),
  link: ICON.link, blockref: svg('<path d="M8 4.5c-3 4.5-3 10.5 0 15M11.5 7.5c-1.6 2.8-1.6 6.2 0 9M16 4.5c3 4.5 3 10.5 0 15M12.5 7.5c1.6 2.8 1.6 6.2 0 9"/>'),
  weblink: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  tag: ICON.tag, template: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  image: ICON.image, imagelink: svg(frame + '<path d="M9.5 14.5l5-5M10.5 9.5h4v4"/>'),
  upload: svg('<path d="M19 11.5l-7 7a4.2 4.2 0 0 1-6-6L13.5 5a2.8 2.8 0 0 1 4 4L10 16.5a1.4 1.4 0 0 1-2-2L14.5 8"/>'),
  bold: ICON.bold, italic: ICON.italic, mark: ICON.mark,
  strike: svg('<path d="M4.5 12h15M16 8c-.5-1.8-2-3-4-3-2.3 0-4 1.2-4 3 0 .8.3 1.4.8 2M8 16c.5 1.8 2 3 4 3 2.3 0 4-1.2 4-3 0-.4-.1-.7-.2-1"/>'),
  underline: svg('<path d="M7 4.5V11a5 5 0 0 0 10 0V4.5M6 20h12"/>'),
  code: svg('<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>'), codeblock: svg(frame + '<path d="m9.5 9.5-2.5 2.5 2.5 2.5M14.5 9.5l2.5 2.5-2.5 2.5"/>'),
  math: svg('<path d="M17 6.5V4.5H7l5.5 7.5L7 19.5h10v-2"/>'),
  h1: { t: 'H1' }, h2: { t: 'H2' }, h3: { t: 'H3' }, h4: { t: 'H4' }, h5: { t: 'H5' }, h6: { t: 'H6' },
  numlist: svg('<path d="M10.5 6.5H20M10.5 12H20M10.5 17.5H20M4.5 5.6 6 4.8V9M4.3 15.2c.4-.9 2.4-.9 2.4.3 0 .9-1.4 1.6-2.4 3h2.6"/>'),
  numkids: svg('<path d="M5 4.5V12a2 2 0 0 0 2 2h2.5M12.5 9.5H20M12.5 14H20M12.5 18.5H20"/>'),
  pa: { t: 'A', b: 1 }, pb: { t: 'B', b: 1 }, pc: { t: 'C', b: 1 },
};


/** Animations are on unless the system asks for less motion or Settings → Look turned them off
 * (html[data-motion="off"], boot.js before the first paint). */
/** Build 41 (he asked: one feel for everything that opens and closes): opening takes 0.2 s, fast at
 *  first and settling gently; closing 0.15 s, the same curve. app.css has the same numbers. */
export const OPEN_MS = 200, CLOSE_MS = 150, EASE = 'cubic-bezier(.2, .8, .2, 1)';
/** el (fixed on screen) opens out of a spot of it (from: {x, y, w, h} in el's own box, a corner) and grows
 *  to its whole size, its shadow too; back = it folds back into that spot. One movement, no fading
 *  until the very end of folding back. Returns the Animation (null when animations are off). */
export function grow(el, from, back = false) {
  if (!motionOn() || !el?.animate) return null;
  const W = el.offsetWidth, H = el.offsetHeight;
  const r = Math.min(9, from.w / 2, from.h / 2);
  const small = `inset(${from.y}px ${Math.max(0, W - from.x - from.w)}px ${Math.max(0, H - from.y - from.h)}px ${from.x}px round ${r}px)`;
  const big = 'inset(-32px -32px -56px -32px round 22px)'; // (the shadow too)
  const frames = back
    ? [{ clipPath: big, opacity: 1 }, { clipPath: small, opacity: 1, offset: 0.85 }, { clipPath: small, opacity: 0 }]
    : [{ clipPath: small }, { clipPath: big }];
  const a = el.animate(frames, { duration: back ? CLOSE_MS : OPEN_MS, easing: EASE });
  if (!back) a.finished.then(() => { el.style.clipPath = ''; }, () => {});
  return a;
}
/** A press (pointerdown) closed something lying over its button: the click this press makes, if it makes
 *  one, isn't passed on (it would open it again). Unlike waiting a while for a click, nothing is left
 *  to eat a later press's click when this one makes none (the press began on what closed). */
export function eatThisClick() {
  const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
  document.addEventListener('click', eat, { capture: true, once: true });
  const stop = () => setTimeout(() => document.removeEventListener('click', eat, true), 60);
  document.addEventListener('pointerup', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', eat, true), 1500); // (whatever happens)
}
/** Where in el's box the spot r (a rectangle on screen) is. */
export const spotIn = (el, r) => { const b = el.getBoundingClientRect(); return { x: r.left - b.left, y: r.top - b.top, w: r.width || 1, h: r.height || 1 }; };

export const motionOn = () => document.documentElement.dataset.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Build 38: something closing fades away the way it came (app.css "Closing"). Call it right before
 * removing or hiding el. A copy of it stays on screen for the closing animation, then goes; the real
 * one is gone at once, so nothing waits for it. The copy is drawn in a closed shadow root of its own
 * (with the page's styles), so no code, test or screen reader looking for open pop-ups ever finds it,
 * and it takes no clicks. */
let fadeSheets = null; // the page's styles, copied once for the shadow root
export function fadeAway(el, cls = '', anim = null) {
  if (!el?.isConnected || !motionOn()) return;
  try {
    fadeSheets ??= [...document.styleSheets].map((ss) => {
      const c = new CSSStyleSheet();
      try { c.replaceSync([...ss.cssRules].map((r) => r.cssText).join('\n')); } catch { /* (another origin's: none) */ }
      return c;
    });
    const host = document.createElement('div');
    host.className = 'fade-host';
    const root = host.attachShadow({ mode: 'closed' });
    root.adoptedStyleSheets = fadeSheets;
    const g = el.cloneNode(true);
    g.removeAttribute('id');
    for (const x of g.querySelectorAll('[id]')) x.removeAttribute('id');
    g.classList.add('fading');
    if (cls) g.classList.add(cls);
    const ins = el.querySelectorAll('input'), gins = g.querySelectorAll('input'); // (a copy shows the typed words too)
    ins.forEach((x, k) => { gins[k].value = x.value; });
    root.append(g);
    host.inert = true;
    host.setAttribute('aria-hidden', 'true');
    document.body.append(host);
    const bye = () => host.remove();
    // (Build 41) anim(copy): the copy's own closing movement (it folds back into its button): the copy
    // goes when that ends
    const a = anim?.(g);
    if (a) { g.classList.add('folding'); a.finished.then(bye, bye); }
    else g.addEventListener('animationend', (e) => { if (e.target === g) bye(); });
    setTimeout(bye, 500); // (whatever happens)
  } catch { /* the closing animation is only a nicety */ }
}

/** Settings' tabs (settings.js; also the command list's "Settings: …" commands). */
// (Build 48, his pick of Nov 13: About and Help apart, Property display under Look, Writing became
// Typing & keys; the old #/settings/writing and #/settings/keys open Typing & keys)
export const SETTINGS_TABS = [['about', 'About'], ['notes', 'Notes'], ['safety', 'Safety'], ['look', 'Look'], ['typing', 'Typing & keys'], ['capture', 'Capture'], ['help', 'Help']];

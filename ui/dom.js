// Small shared helpers for building the page, and the icons.
import { esc } from './render.js';

export const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
export const pageLink = (name, label) => `<a href="#" data-page="${esc(name)}">${esc(label ?? name)}</a>`;

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
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  home: svg('<path d="M3.5 11.2 12 4.5l8.5 6.7"/><path d="M6 9.6v9.9h12V9.6"/><path d="M10 19.5v-5h4v5"/>'),
  back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  forward: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  // window buttons (the app draws its own title bar on Windows)
  winMin: svg('<path d="M6 12h12"/>', ' stroke-width="1.3"'),
  winMax: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="1.2"/>', ' stroke-width="1.3"'),
  winRestore: svg('<rect x="6.5" y="8.5" width="9" height="9" rx="1.2"/><path d="M9 8.5V7.2c0-.7.5-1.2 1.2-1.2h6.6c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2h-1.3"/>', ' stroke-width="1.3"'),
  winClose: svg('<path d="M7 7l10 10M17 7 7 17"/>', ' stroke-width="1.3"'),
  logo: '<svg viewBox="0 0 1024 1024"><rect x="64" y="64" width="896" height="896" rx="208" fill="var(--accent)"/><g fill="var(--surface)"><circle cx="332" cy="300" r="58"/><rect x="430" y="270" width="330" height="60" rx="30"/><circle cx="452" cy="512" r="46"/><rect x="534" y="488" width="226" height="48" rx="24"/><circle cx="332" cy="724" r="58"/><rect x="430" y="694" width="270" height="60" rx="30"/></g></svg>',
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
  mark: svg('<path d="m15 4 5 5-9 9H6v-5z"/><path d="M4 21h16"/>'),
  heading: svg('<path d="M6 4v16M18 4v16M6 12h12"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  side: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>'),
  shuffle: svg('<path d="M4 7h3.5c4 0 5 10 9 10H20M17 14l3 3-3 3M4 17h3.5c1.5 0 2.5-1.4 3.4-3M20 7h-3.5c-1.5 0-2.5 1.4-3.4 3M17 4l3 3-3 3"/>'),
  replace: svg('<path d="M4 8h11.5M12 4.5 15.5 8 12 11.5M20 16H8.5M12 12.5 8.5 16l3.5 3.5"/>'),
  palette: svg('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.8 0-1 .8-1.6 1.8-1.6h2.2a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.1-8.5-7.1z"/><circle cx="7.6" cy="11.2" r="1.1"/><circle cx="10" cy="7.5" r="1.1"/><circle cx="14.4" cy="7.5" r="1.1"/>'),
};


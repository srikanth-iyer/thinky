// The welcome screen: the first start, before a notes folder is chosen (laptop and phone). What the
// app is, in a line, and two ways in: open a notes folder that's there already, or create a new one
// (with a short tour for someone new to outlining). Both go on in the folder picker (settings.js). The
// × (or Esc) closes it, to Settings, where the picker is too; from the picker, Esc and Android's Back
// go back to the first step. Loaded only when it shows (App.draw); while it shows, html.welcome hides
// the sidebar and the bars' buttons (app.css).

import { h, BRAND } from './dom.js';
import { accessCard } from './app.js';
import { folderPicker } from './settings.js';

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const FOLDER = svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2.2 2.4h7a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>');
const NEW_FOLDER = svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2.2 2.4h7a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5.5M9.25 13.75h5.5"/>');
const CLOSE = svg('<path d="M7 7l10 10M17 7 7 17"/>');
const BACK = svg('<path d="M15 6l-6 6 6 6"/>');
/** Android without "all files access" (the notes can't be read until it's on). */
const noAccess = () => !!window.LeanAndroid && !window.LeanAndroid.hasAllFilesAccess();

export function welcomeView(app, view) {
  const w = h('section', 'welcome');
  w.setAttribute('aria-labelledby', 'wl-title');
  view.append(w);
  const close = () => app.go(app.vaultOpen ? 'journals' : 'settings');
  // the first step: what it is, and the two ways in
  const home = () => {
    w.innerHTML = `<button type="button" class="icon-btn wl-close" aria-label="Close" title="Close">${CLOSE}</button>
      <div class="wl-logo" aria-hidden="true">${BRAND.icon(true)}</div>
      <h1 id="wl-title">Welcome to ${BRAND.word}</h1>
      <p class="wl-lead">A fast, simple place for your notes, written as outlines. They’re plain Markdown files in a folder you choose, kept on this device: yours to keep, and Logseq can open them too.</p>
      <div class="wl-access"></div>
      <div class="wl-choices">
        <button type="button" class="wl-choice" data-w="open"><span class="wl-ic">${FOLDER}</span><span class="wl-txt"><b>Open an existing notes folder</b><small>A folder you already use with Logseq, or one made here before.</small></span></button>
        <button type="button" class="wl-choice" data-w="new"><span class="wl-ic">${NEW_FOLDER}</span><span class="wl-txt"><b>Create a new notes folder</b><small>New to this? It comes with a short tour that shows you around.</small></span></button>
      </div>`;
    if (noAccess()) w.querySelector('.wl-access').append(accessCard('First, allow access to your files'));
  };
  // the second step: the folder picker, to open one or to make one
  const step = (mode) => {
    const open = mode === 'open';
    w.innerHTML = `<button type="button" class="icon-btn wl-close" aria-label="Close" title="Close">${CLOSE}</button>
      <button type="button" class="wl-back" data-w="home">${BACK}Back</button>
      <h1 id="wl-title" class="wl-h">${open ? 'Open your notes folder' : 'Where should it go?'}</h1>
      <p class="wl-lead small">${open
    ? 'Go to the folder that holds your notes (the one with <code>pages</code> and <code>journals</code> in it, as Logseq makes it), then <b>Use this folder</b>. Nothing in it changes until you write.'
    : 'Pick a place, name the new folder and <b>Create</b> it. It gets the layout Logseq uses, so Logseq can open it too.'}</p>
      <div class="wl-access"></div>
      <div class="card wl-pick"></div>`;
    if (noAccess()) w.querySelector('.wl-access').append(accessCard('First, allow access to your files'));
    folderPicker(app, w.querySelector('.wl-pick'), '', { mode });
  };
  w.addEventListener('click', (e) => {
    if (e.target.closest('.wl-close')) { close(); return; }
    const b = e.target.closest('[data-w]');
    if (!b) return;
    if (b.dataset.w === 'home') home(); else step(b.dataset.w);
    w.querySelector('[data-w], .pk-name input')?.focus({ preventScroll: true });
  });
  // Esc: from the picker back to the first step, from there closed (Android's Back does the first too,
  // App.closeTop); listened to while the screen is there
  const onKey = (e) => {
    if (!w.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.modal-back')) return;
    if (w.querySelector('.wl-back')) { home(); w.querySelector('[data-w]')?.focus({ preventScroll: true }); } else close();
  };
  document.addEventListener('keydown', onKey);
  home();
}

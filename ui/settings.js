// Settings, in tabs so nothing needs a long scroll: Notes (folder and its health check, deleted
// pages), Look (looks, text size, link colour and fonts), Capture (quick capture; on Windows also the
// browser button and the shortcut key), Shortcuts (keys), About (problems log, version, updates).
// The tab shows in the address (#/settings/look) and the last one is remembered.

import { call, store, nowTime, isApp, isAndroid } from './api.js';
import { esc } from './render.js';
import { h, ICON } from './dom.js';
import { promptBox } from './popups.js';
import { SKINS, accessCard } from './app.js';
import { fitChips } from './views.js';

const $ = (sel, root = document) => root.querySelector(sel);

const TABS = [['notes', 'Notes'], ['look', 'Look'], ['capture', 'Capture'], ['keys', 'Shortcuts'], ['about', 'About']];

export async function settingsView(app, view, want = null) {
  view.append(h('h1', 'page-title', app.vaultOpen ? 'Settings' : 'Welcome'));
  if (!app.vaultOpen) view.append(h('p', 'note', 'Choose the folder that holds your notes (the Logseq folder with <code>pages</code> and journals inside). Nothing is changed until you edit a page.'));

  // Android: file access first (without it a folder opens with no notes in it)
  if (window.LeanAndroid && !window.LeanAndroid.hasAllFilesAccess()) view.append(accessCard('Allow access to your files'));

  const platform = isApp ? await call('platform').catch(() => '') : '';
  if (!view.isConnected) return;
  // what each tab holds (Capture and Shortcuts once a notes folder is open)
  const parts = {
    notes: async () => [folderCard(app), ...(app.vaultOpen ? [binCard(app)] : [])],
    look: async () => [lookCard(app)],
    capture: async () => [captureCard(app), ...(platform === 'windows' ? [windowsCard(app)] : [])],
    keys: async () => [keysCard(app)],
    about: async () => [problemsCard(), await aboutCard(app)],
  };
  // (no Shortcuts on phones: they're for a keyboard, and five tabs don't fit a narrow screen)
  const tabs = TABS.filter(([id]) => (app.vaultOpen || !['capture', 'keys'].includes(id)) && !(isAndroid && id === 'keys'));
  let cur = want || store.get('settingsTab', 'notes');
  if (!app.vaultOpen || !tabs.some(([id]) => id === cur)) cur = want && tabs.some(([id]) => id === want) ? want : 'notes';
  const bar = h('div', 'chips set-tabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Settings');
  bar.innerHTML = tabs.map(([id, label]) => `<button class="chip" role="tab" id="st-${id}" data-tab="${id}" aria-controls="sp-${id}">${label}</button>`).join('');
  view.append(bar);
  fitChips(bar); // a hint (the end fades) if they still don't all fit
  const panels = {};
  const show = async (id) => {
    cur = id;
    bar.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    for (const p of Object.values(panels)) p.hidden = true;
    if (!panels[id]) { // built the first time it's shown
      const p = h('div', 'set-panel');
      p.id = 'sp-' + id;
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', 'st-' + id);
      panels[id] = p;
      view.append(p);
      p.append(...await parts[id]());
      if (cur !== id || !view.isConnected) return; // another tab (or page) was picked meanwhile
    }
    panels[id].hidden = false;
    if (app.vaultOpen) store.set('settingsTab', id);
    // the address names the tab (without adding a step for Back)
    const hash = '#/settings/' + id;
    if (location.hash !== hash) history.replaceState(history.state, '', hash);
    app.prevHash = location.hash; // the page now open is this address (see App.route)
  };
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  bar.addEventListener('keydown', (e) => { // arrow keys move between the tabs
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const ids = tabs.map(([id]) => id);
    const next = ids[(ids.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    show(next).then(() => bar.querySelector(`[data-tab="${next}"]`).focus());
  });
  await show(cur);
}

function folderCard(app) {
  const vc = h('div', 'card');
  const path = store.get('vault', '');
  vc.innerHTML = `<h2>Notes folder</h2>
    ${path ? `<div class="path">${esc(path)}</div>` : '<p class="note">No folder chosen yet.</p>'}
    ${app.vaultError ? `<p class="err">${esc(app.vaultError)}</p>` : ''}
    ${app.vaultOpen ? `<p class="note">${app.summary.pages} pages · journals in <code>${esc(app.summary.config.journals_dir)}</code> · journal titles like “${esc(app.summary.today)}”</p>` : ''}
    <div class="btn-row"><button class="btn" data-a="pick">${path ? 'Choose another folder' : 'Choose folder'}</button>
    ${app.vaultOpen ? '<button class="btn ghost" data-a="check">Check this folder</button>' : ''}</div>
    <div class="check-out"></div>`;
  $('[data-a="pick"]', vc).onclick = () => folderPicker(app, vc, path);
  const chk = $('[data-a="check"]', vc);
  if (chk) chk.onclick = async () => {
    chk.disabled = true;
    const out = $('.check-out', vc);
    out.innerHTML = '<p class="note">Reading every page…</p>';
    try {
      const r = await call('check');
      const list = (items) => `<div class="path">${items.map(esc).join('<br>')}</div>`;
      let html = `<p class="note">${r.files} files read in ${r.load_ms} ms.</p>`;
      html += r.roundtrip_failures.length
        ? `<p class="err"><b>${r.roundtrip_failures.length} files would be reformatted if saved untouched:</b></p>${list(r.roundtrip_failures)}`
        : '<p class="note">✓ Every file can be opened and saved without being reformatted.</p>';
      if (r.conflict_copies.length) html += `<p class="note"><b>${r.conflict_copies.length} look like copies made by a sync conflict</b> (e.g. “Page (1).md” next to “Page.md”). Compare each with the original, keep what you need, then delete the copy:</p>${list(r.conflict_copies)}`;
      if (r.duplicates.length) html += `<p class="note"><b>${r.duplicates.length} page names belong to more than one file.</b> The first file is the one shown:</p>${list(r.duplicates.map(([n, files]) => `${n}: ${files.join(', ')}`))}`;
      if (r.non_utf8.length) html += `<p class="note"><b>${r.non_utf8.length} files aren’t plain text</b> (shown read-only, never changed):</p>${list(r.non_utf8)}`;
      html += `<p class="note">Longest pages: ${r.biggest.map(([n, b]) => `${esc(n)} (${b} blocks)`).join(', ')}.<br>Most linked: ${r.most_linked.map(([n, c]) => `${esc(n)} (${c})`).join(', ')}.</p>`;
      out.innerHTML = html;
    } catch (e) { out.innerHTML = `<p class="err">${esc(e)}</p>`; }
    chk.disabled = false;
  };
  if (!path) folderPicker(app, vc, '');
  return vc;
}

/** Android without "all files access": folders show, but the notes in them can't be read. */
const noAccess = () => !!window.LeanAndroid && !window.LeanAndroid.hasAllFilesAccess();

async function folderPicker(app, card, start) {
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
      <div class="foot"><button class="btn" data-use ${list.vault && !noAccess() ? '' : 'disabled'}>Use this folder</button>
        <span class="note">${noAccess() ? 'First allow access to your files (above).' : list.vault ? 'This looks like a notes folder.' : 'Open the folder that contains <code>pages</code>.'}</span></div>`;
    box.onclick = (ev) => {
      const b = ev.target.closest('[data-p]');
      if (b) return show(b.dataset.p);
      if (ev.target.closest('[data-use]')) useVault(app, cur);
    };
  };
  await show(cur);
}

async function useVault(app, path) {
  store.set('vault', path);
  app.vaultError = null;
  await app.openVault();
  app.go(app.vaultOpen ? 'journals' : 'settings');
}

function lookCard(app) {
  // each card is a live miniature drawn with that look's own tokens
  const sc = h('div', 'card');
  sc.innerHTML = '<h2>Look</h2><p class="note">Pick how your notes look. Each card is a live preview.</p><div class="skin-cards"></div>';
  const cards = $('.skin-cards', sc);
  const sample = `<div class="sheet"><div class="day-head"><span class="day-ic">${ICON.calendar}</span><p class="weekday">Sunday</p><div class="page-title">October 25th, 2026</div></div>
    <div class="outline" style="margin-top:10px">
      <div class="blk" style="--d:0"><span class="bul"></span><div class="bc">Read <a class="pl">Marta Pell</a> on bread <a class="tag"><span class="hash">#</span>reading</a></div></div>
      <div class="blk" style="--d:1"><span class="bul"></span><div class="bc">cold-proving is the <mark>key idea</mark></div></div>
      <div class="blk" style="--d:0"><span class="bul"></span><div class="bc"><input type="checkbox" class="todo" checked tabindex="-1">order more flour</div></div>
    </div></div>`;
  for (const s of SKINS) {
    const b = h('button', 'skin-card', `<div class="stage">${sample}</div><div class="label"><b>${s.name}</b><span>${s.note}</span></div>`);
    b.dataset.skin = s.id;
    b.setAttribute('aria-pressed', document.documentElement.dataset.skin === s.id);
    b.onclick = () => { app.setSkin(s.id); cards.querySelectorAll('.skin-card').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
    cards.append(b);
  }
  const size = h('div', 'size-row');
  size.innerHTML = `<label>Text size <input type="range" min="0.8" max="1.6" step="0.05" value="${app.textSize()}"> <span class="v">${Math.round(app.textSize() * 100)}%</span></label>
    <span class="note">On the laptop also Ctrl + and Ctrl −.</span>`;
  const r = $('input', size);
  r.oninput = () => { $('.v', size).textContent = Math.round(app.textSize(Number(r.value)) * 100) + '%'; };
  sc.append(size);
  sc.append(textStyle(app));
  return sc;
}

// Link colour and fonts, on top of whichever look is chosen. Fonts are ones that come with the
// app or are already on the computer/phone, so nothing extra is downloaded or stored.
const LINK_COLOURS = ['#2F6BFF', '#7B5CFF', '#E0457B', '#E8590C', '#0F9D8A', '#D93636'];
// Fonts that come with the app work everywhere; the rest are the device's own (Windows has many,
// phones have their own sans-serif, serif, monospace and handwriting).
const ON = isAndroid ? 'this phone' : 'this computer';
const FONTS = [
  ['', 'The look’s own'],
  ['"Newsreader", Georgia, serif', 'Newsreader (comes with the app)'],
  ['"IBM Plex Sans", system-ui, sans-serif', 'IBM Plex Sans (comes with the app)'],
  ['"Bricolage Grotesque", system-ui, sans-serif', 'Bricolage Grotesque (comes with the app)'],
  ['"IBM Plex Mono", ui-monospace, monospace', 'IBM Plex Mono (comes with the app)'],
  ...(isAndroid ? [
    ['sans-serif', 'The phone’s own sans-serif'],
    ['serif', 'The phone’s own serif'],
    ['monospace', 'The phone’s own monospace'],
    ['cursive', 'The phone’s own handwriting'],
  ] : [
    ['"Segoe UI", system-ui, sans-serif', 'Segoe UI'],
    ['Calibri, "Segoe UI", sans-serif', 'Calibri'],
    ['Candara, "Segoe UI", sans-serif', 'Candara'],
    ['Bahnschrift, "Segoe UI", sans-serif', 'Bahnschrift'],
    ['Verdana, sans-serif', 'Verdana'],
    ['Cambria, Georgia, serif', 'Cambria'],
    ['Georgia, serif', 'Georgia'],
    ['Constantia, Georgia, serif', 'Constantia'],
    ['"Palatino Linotype", Palatino, serif', 'Palatino'],
    ['"Sitka Text", Georgia, serif', 'Sitka'],
    ['Consolas, ui-monospace, monospace', 'Consolas'],
    ['system-ui, sans-serif', 'This computer’s own sans-serif'],
    ['serif', 'This computer’s own serif'],
  ]),
  ['other', `Another font on ${ON}…`],
];

function textStyle(app) {
  const box = h('div', 'text-style');
  const link = store.get('linkColor', '');
  const opts = (cur) => {
    const known = FONTS.some(([v]) => v === cur);
    const custom = cur && !known ? `<option value="${esc(cur)}" selected>${esc(cur.split(',')[0].replace(/"/g, ''))}</option>` : '';
    return custom + FONTS.map(([v, label]) => `<option value="${esc(v)}"${known && v === cur ? ' selected' : ''}>${esc(label)}</option>`).join('');
  };
  box.innerHTML = `<div class="ts-row"><span class="ts-l">Link colour</span><div class="swatches" role="group" aria-label="Link colour">
      <button type="button" class="sw own" data-c="" aria-pressed="${!link}">Look’s own</button>
      ${LINK_COLOURS.map((c) => `<button type="button" class="sw" data-c="${c}" style="--c:${c}" title="${c}" aria-label="Link colour ${c}" aria-pressed="${link.toLowerCase() === c.toLowerCase()}"></button>`).join('')}
      <label class="sw pick" title="Any colour" aria-pressed="${!!link && !LINK_COLOURS.some((c) => c.toLowerCase() === link.toLowerCase())}"><input type="color" value="${esc(link || '#4A3CB0')}" aria-label="Pick any colour"></label></div></div>
    <div class="ts-row"><label class="ts-l" for="ts-body">Text font</label><select id="ts-body" data-k="fontBody">${opts(store.get('fontBody', ''))}</select></div>
    <div class="ts-row"><label class="ts-l" for="ts-title">Titles</label><select id="ts-title" data-k="fontTitle">${opts(store.get('fontTitle', ''))}</select></div>`;
  const setLink = (c) => {
    store.set('linkColor', c);
    app.applyTextStyle();
    box.querySelectorAll('.sw').forEach((b) => b.setAttribute('aria-pressed', String(b.classList.contains('pick') ? !!c && !LINK_COLOURS.includes(c) : (b.dataset.c || '') === c)));
  };
  box.querySelector('.swatches').addEventListener('click', (e) => {
    const b = e.target.closest('button.sw');
    if (b) setLink(b.dataset.c || '');
  });
  box.querySelector('input[type=color]').addEventListener('input', (e) => setLink(e.target.value));
  box.querySelectorAll('select').forEach((sel) => {
    let before = sel.value;
    sel.onchange = async () => {
      let v = sel.value;
      if (v === 'other') {
        const name = await promptBox({ title: 'Which font?', body: `Type the name of a font installed on ${ON}, for example ${isAndroid ? 'Roboto' : 'Garamond'}.`, placeholder: 'Font name' });
        const clean = (name || '').replace(/["';{}<>\\]/g, '').trim();
        if (!clean) { sel.value = before; return; }
        v = `"${clean}", system-ui, sans-serif`;
        sel.insertAdjacentHTML('afterbegin', `<option value="${esc(v)}">${esc(clean)}</option>`);
        sel.value = v;
      }
      before = v;
      store.set(sel.dataset.k, v);
      app.applyTextStyle();
    };
  });
  return box;
}

function captureCard(app) {
  const c = app.summary.config;
  const card = h('div', 'card');
  card.innerHTML = `<h2>Quick capture</h2>
    <p class="note">What gets added when you share something to the app (phone share menu, the widget’s +, the browser button and shortcut key on the laptop). Same settings as Logseq’s, kept in <code>logseq/config.edn</code>, so Logseq uses them too.
    <br><code>{time}</code> = time, <code>{date}</code> = today’s date, <code>{text}</code> = what you shared or typed, <code>{url}</code> = its web address (or the picture).</p>
    <label class="field">Shared text and links<input data-f="text" value="${esc(c.capture_text)}"></label>
    <label class="field">Shared pictures<input data-f="media" value="${esc(c.capture_media)}"></label>
    <div class="radio"><label><input type="radio" name="where" value="today" ${c.capture_today ? 'checked' : ''}> Add to today’s journal</label>
      <label><input type="radio" name="where" value="page" ${c.capture_today ? '' : 'checked'}> Add to the page <input data-f="page" value="${esc(c.capture_page)}" class="inline"></label></div>
    ${window.LeanAndroid ? `<label class="toggle"><input type="checkbox" data-f="onetap" ${store.get('oneTap', false) ? 'checked' : ''}> Add shared things straight away (no pop-up)</label>` : ''}
    <p class="note preview"></p>
    <div class="btn-row"><button class="btn" data-a="save">Save</button><span class="note saved" hidden>Saved to config.edn</span></div>`;
  const f = (k) => $(`[data-f="${k}"]`, card);
  const preview = () => {
    const tpl = f('text').value;
    const line = tpl.replace('{time}', nowTime()).replace('{date}', app.summary.today).replace('{text}', 'An article worth reading').replace('{url}', 'https://example.org/article');
    $('.preview', card).innerHTML = `Example: <code>- ${esc(line)}</code>`;
  };
  card.oninput = preview;
  preview();
  $('[data-a="save"]', card).onclick = async () => {
    try {
      const s = await call('set_capture', { text: f('text').value, media: f('media').value, today: $('[name="where"]:checked', card).value === 'today', page: f('page').value });
      app.summary.config = s.config;
      if (f('onetap')) store.set('oneTap', f('onetap').checked);
      app.sendCaptureConfig();
      $('.saved', card).hidden = false;
      setTimeout(() => ($('.saved', card).hidden = true), 2500);
    } catch (e) { app.toast(String(e), 6000); }
  };
  return card;
}

const BOOKMARKLET = "javascript:(function(){var s=String(getSelection()),u='leanoutliner://capture?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+'&text='+encodeURIComponent(s);location.href=u;var d=document.createElement('div');d.textContent='Sent to Lean Outliner';d.style.cssText='position:fixed;z-index:2147483647;top:16px;right:16px;background:#1a2130;color:#fff;padding:10px 14px;border-radius:10px;font:14px system-ui';document.body.appendChild(d);setTimeout(function(){d.remove()},2200)})();";

function windowsCard(app) {
  const card = h('div', 'card');
  const hk = store.get('captureKey', '');
  card.innerHTML = `<h2>Capture from anywhere on the laptop</h2>
    <h3>From the browser</h3>
    <p class="note">Drag this button onto your browser’s bookmarks bar. Then on any web page, click it to add the page (and any text you selected) to your journal, using the quick capture format above. The first time, the browser asks to open Lean Outliner: tick “Always allow”.</p>
    <div class="btn-row"><a class="btn bookmarklet" href="${esc(BOOKMARKLET)}" draggable="true" title="Drag me to the bookmarks bar">＋ Add to journal</a>
      <button class="btn ghost" data-a="copy">Copy the code instead</button></div>
    <p class="note small">No bookmarks bar? In Chrome or Edge press Ctrl+Shift+B. If dragging doesn’t work: copy the code, right-click the bookmarks bar, choose “Add page…”, name it “Add to journal” and paste the code as the address.</p>
    <h3>With a shortcut key</h3>
    <p class="note">Press a key combination (for example Ctrl+Alt+N) anywhere in Windows to open a small box that adds a note to your journal, pre-filled with what you last copied. It uses Windows’ own shortcut keys, so nothing of this app runs in the background.</p>
    <div class="btn-row"><input class="filter key" readonly placeholder="Click here, then press keys" value="${esc(hk)}">
      <button class="btn" data-a="setkey">Save</button><button class="btn ghost" data-a="clearkey" ${hk ? '' : 'hidden'}>Remove</button></div>`;
  $('.bookmarklet', card).onclick = (e) => { e.preventDefault(); app.toast('Drag this button to your browser’s bookmarks bar.'); };
  $('[data-a="copy"]', card).onclick = async () => { try { await navigator.clipboard.writeText(BOOKMARKLET); app.toast('Copied', 1200); } catch { app.toast('Couldn’t copy'); } };
  const key = $('.key', card);
  key.onkeydown = (e) => {
    e.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : (/^F\d+$/.test(e.key) ? e.key : null);
    if (!k) return;
    const mods = [e.ctrlKey && 'CTRL', e.altKey && 'ALT', e.shiftKey && 'SHIFT'].filter(Boolean);
    if (mods.length < 2 && !/^F\d+$/.test(k)) { app.toast('Use two of Ctrl, Alt and Shift with a key, e.g. Ctrl+Alt+N'); return; }
    key.value = [...mods, k].join('+');
  };
  $('[data-a="setkey"]', card).onclick = async () => {
    if (!key.value) return;
    try { await call('set_shortcut', { key: key.value }); store.set('captureKey', key.value); $('[data-a="clearkey"]', card).hidden = false; app.toast(`Done: press ${key.value} anywhere to add a note.`, 4000); }
    catch (e) { app.toast(String(e), 6000); }
  };
  $('[data-a="clearkey"]', card).onclick = async () => {
    try { await call('set_shortcut', { key: '' }); store.set('captureKey', ''); key.value = ''; $('[data-a="clearkey"]', card).hidden = true; }
    catch (e) { app.toast(String(e), 6000); }
  };
  return card;
}

function binCard(app) {
  const card = h('div', 'card');
  card.innerHTML = '<h2>Deleted pages</h2><p class="note">Pages you delete wait here (in <code>logseq/.recycle</code>, like Logseq). Bring one back with Restore.</p><ul class="rows bin"></ul>';
  const ul = $('.bin', card);
  const draw = async () => {
    let items = [];
    try { items = await call('recycled'); } catch { /* none */ }
    ul.innerHTML = items.slice(0, 50).map((r) => `<li><span>${esc(r.name)}</span><span class="meta">${new Date(r.when * 1000).toLocaleDateString()}</span><button class="btn ghost small" data-f="${esc(r.file)}">Restore</button></li>`).join('')
      || '<li class="note">Nothing here.</li>';
  };
  ul.onclick = async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    try { const name = await call('restore', { file: b.dataset.f }); await app.refreshNames(); app.toast(`Restored “${name}”`); draw(); }
    catch (err) { app.toast(String(err), 6000); }
  };
  draw();
  return card;
}

function keysCard(app) {
  const card = h('div', 'card');
  const nice = (k) => k.replace(/mod/g, 'Ctrl').replace(/open-square-bracket/, '[').replace(/close-square-bracket/, ']').replace(/backslash/, '\\').replace(/\+/g, ' + ').replace(/\b([a-z])\b/g, (m) => m.toUpperCase());
  const rows = [
    ['Search', 'go/search'], ['Journals', 'go/journals'], ['All pages', 'go/all-pages'], ['To-dos', 'go/todos'],
    ['Go to a date', 'go/date'], ['Next / previous journal day', 'go/next-journal'], ['Back', 'go/backward'], ['Forward', 'go/forward'],
    ['Hide or show the sidebar', 'ui/toggle-left-sidebar'], ['Move a block up', 'editor/move-block-up'], ['Move a block down', 'editor/move-block-down'],
    ['Fold or unfold all', 'editor/toggle-open-blocks'], ['Highlight', 'editor/highlight'], ['Bigger / smaller text', 'ui/text-bigger'],
  ];
  card.innerHTML = `<h2>Keyboard shortcuts</h2><p class="note">Also: Enter new block · Shift+Enter new line · Tab / Shift+Tab indent · Ctrl+Enter to-do · Esc select block (then Shift+↑↓ to select more) · Ctrl+Z undo · / commands · [[ link · # tag · :: property. Change these in <code>logseq/config.edn</code> (<code>:shortcuts</code>), like in Logseq.</p>
    <table class="keys">${rows.map(([label, a]) => `<tr><td>${label}</td><td>${(app.keyMap[a] || []).map((k) => `<kbd>${esc(nice(k))}</kbd>`).join(' or ') || '<span class="note">none</span>'}</td></tr>`).join('')}</table>`;
  return card;
}

function problemsCard() {
  const card = h('div', 'card');
  card.innerHTML = `<h2>Problems log</h2><p class="note">If something goes wrong, the details are noted here. Copy them and send them to Claude to fix.</p>
    <pre class="log">…</pre><div class="btn-row"><button class="btn ghost" data-a="copy">Copy</button><button class="btn ghost" data-a="clear">Clear</button></div>`;
  const pre = $('.log', card);
  const load = async () => { try { pre.textContent = (await call('errors')).trim() || 'No problems recorded.'; } catch (e) { pre.textContent = String(e); } };
  card.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'copy') { try { await navigator.clipboard.writeText(pre.textContent); } catch { /* ignore */ } }
    if (a === 'clear') { await call('clear_errors').catch(() => {}); load(); }
  };
  load();
  return card;
}

async function aboutCard(app) {
  const card = h('div', 'card');
  let ver = '';
  try { ver = await window.__TAURI__?.app?.getVersion?.(); } catch {}
  card.innerHTML = `<h2>About</h2><p class="note">Lean Outliner ${esc(ver || '(preview)')}. Your notes stay as plain Markdown files in your folder.</p>
    ${isApp ? `<div class="btn-row"><button class="btn ghost" data-a="upd">Check for a newer version</button><span class="note upd-out"></span></div>` : ''}`;
  const b = $('[data-a="upd"]', card);
  if (b) b.onclick = async () => {
    const out = $('.upd-out', card);
    out.textContent = 'Checking…';
    const newer = await app.checkUpdate(true);
    out.innerHTML = newer === null ? 'Couldn’t check (offline?).'
      : newer ? `A newer version (${esc(app.latest.tag)}) is ready: <a href="${esc(app.latest.url)}" data-ext>open the downloads page</a>.` : 'You have the latest version.';
    out.querySelector('[data-ext]')?.addEventListener('click', (e) => { e.preventDefault(); app.openUrl(app.latest.url); });
  };
  return card;
}

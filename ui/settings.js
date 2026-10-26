// Settings, in tabs so nothing needs a long scroll: Notes (folder and its health check, with pictures
// nothing uses; deleted pages; safety copies), Look (looks, text size, link colour and fonts), Capture
// (quick capture; on Windows also the browser button and the shortcut key), Shortcuts (keys), About
// (problems log, version, updates). The tab shows in the address (#/settings/look) and the last one
// is remembered.

import { call, store, nowTime, isApp, isAndroid, assetUrl } from './api.js';
import { esc } from './render.js';
import { h, ICON } from './dom.js';
import { promptBox, confirmBox } from './popups.js';
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
    notes: async () => [folderCard(app), ...(app.vaultOpen ? [binCard(app), safetyCard(app)] : [])],
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
      out.append(picturesBox(app, r));
    } catch (e) { out.innerHTML = `<p class="err">${esc(e)}</p>`; }
    chk.disabled = false;
  };
  if (!path) folderPicker(app, vc, '');
  return vc;
}

/** "1.4 MB", "820 KB" (as Windows counts them). */
const fileSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Part of "Check this folder": the pictures in assets/ that nothing uses, each with a tick box (all
 *  ticked), and a button that moves the ticked ones to the bin (the app checks each one again first,
 *  see core/src/app/pictures.rs). Pictures from the last 3 days aren't listed: a note using one may
 *  still be on its way. */
function picturesBox(app, r) {
  const box = h('div', 'pics-box');
  const list = (items) => `<div class="path">${items.map(esc).join('<br>')}</div>`;
  if (r.pictures_unreadable.length) {
    box.innerHTML = `<p class="note"><b>Pictures weren’t checked:</b> ${plural(r.pictures_unreadable.length, 'file')} couldn’t be read, so it isn’t certain which pictures are still used. If they’re in Google Drive, make them available offline, then check again.</p>${list(r.pictures_unreadable.slice(0, 20))}`;
    return box;
  }
  const pics = r.unused_pictures;
  const recent = r.pictures_recent || 0;
  const checked = r.pictures - recent;
  const newer = recent ? ` ${recent} added in the last 3 days ${recent === 1 ? 'isn’t' : 'aren’t'} listed (a note using ${recent === 1 ? 'it' : 'them'} may still be on its way).` : '';
  if (!r.pictures) return box;
  if (!checked) {
    box.innerHTML = `<p class="note">The ${plural(recent, 'picture')} in <code>assets</code> ${recent === 1 ? 'was' : 'were'} added in the last 3 days, so ${recent === 1 ? 'it isn’t' : 'they aren’t'} checked yet (a note using ${recent === 1 ? 'it' : 'them'} may still be on its way).</p>`;
    return box;
  }
  if (!pics.length) {
    box.innerHTML = `<p class="note">✓ Every picture in <code>assets</code> is used by a note (${plural(checked, 'picture')}).${newer}</p>`;
    return box;
  }
  const n = pics.length;
  box.innerHTML = `<h3>Pictures nothing uses</h3>
    <p class="note">${n} of the ${plural(checked, 'picture')} in <code>assets</code> ${n === 1 ? 'isn’t' : 'aren’t'} used by any note, whiteboard or setting: ${fileSize(r.unused_pictures_bytes)} in total.${newer}</p>
    <ul class="pics">${pics.map(([p, b]) => `<li><label><input type="checkbox" checked data-p="${esc(p)}"><span class="th"><img src="${esc(assetUrl(p.split('/').map(encodeURIComponent).join('/')))}" alt="" loading="lazy"></span><span class="nm">${esc(p.replace(/^assets\//i, ''))}</span><span class="meta">${fileSize(b)}</span></label></li>`).join('')}</ul>
    <div class="btn-row"><button class="btn ghost" data-a="bin-pics"></button></div>`;
  // pictures this window can't show (HEIC, TIFF…) keep a plain square
  box.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);
  const btn = $('[data-a="bin-pics"]', box);
  const ticked = () => [...box.querySelectorAll('.pics input:checked')].map((i) => i.dataset.p);
  const label = () => {
    const k = ticked().length;
    btn.textContent = k === n ? 'Move to the bin…' : `Move ${k} to the bin…`;
    btn.disabled = !k;
  };
  label();
  box.addEventListener('change', label);
  btn.onclick = async () => {
    const paths = ticked();
    const k = paths.length;
    if (!k) return;
    const ok = await confirmBox({
      title: k === 1 ? 'Move this picture to the bin?' : `Move these ${k} pictures to the bin?`,
      body: `${k === 1 ? 'It goes' : 'They go'} to the bin, <code>logseq/.recycle</code> in your notes folder (where deleted pages go), so nothing is lost; there ${k === 1 ? 'its name says' : 'each one’s name says'} where it came from (it starts with “assets%2F”). To bring one back: Settings → Notes → Deleted pages and pictures → Pictures → Put back. A picture a note has started using since the check stays where it is.`,
      ok: 'Move to the bin',
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      await app.rescan(); // take in notes changed elsewhere since the check
      const res = await call('bin_pictures', { paths });
      const m = res.moved.length;
      const left = res.skipped.length;
      box.innerHTML = `<h3>Pictures nothing uses</h3><p class="note">✓ Moved ${plural(m, 'picture')} to the bin (<code>logseq/.recycle</code>).</p>
        ${left ? `<p class="note"><b>${left} stayed where ${left === 1 ? 'it was' : 'they were'}:</b></p>${list(res.skipped.map(([p, why]) => `${p}: ${why}`))}` : ''}`;
      app.toast(`Moved ${plural(m, 'picture')} to the bin.`);
      app.binChanged?.();
    } catch (e) { app.toast(String(e), 6000); label(); }
  };
  return box;
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

/** The bin (logseq/.recycle, like Logseq): deleted pages (the newest 50) and, in a section of their
 *  own, every picture "Check this folder" moved there, newest move first; "Put back" returns one to
 *  exactly where it was (its name in the bin says so, see core/src/app/pictures.rs). */
function binCard(app) {
  const card = h('div', 'card');
  card.innerHTML = `<h2>Deleted pages and pictures</h2><p class="note">Pages you delete, and pictures moved here from “Check this folder”, wait in the bin (<code>logseq/.recycle</code> in your notes folder, like Logseq). Bring one back with Restore or Put back.</p>
    <ul class="rows bin bin-pages"></ul><h3 class="bin-pics-h" hidden>Pictures</h3><ul class="rows bin bin-pics" hidden></ul>`;
  const pages = $('.bin-pages', card);
  const pics = $('.bin-pics', card);
  const when = (r) => new Date(r.when * 1000).toLocaleDateString();
  const thumb = (r) => `<img class="bin-th" src="${esc(assetUrl('logseq/.recycle/' + encodeURIComponent(r.file)))}" alt="" loading="lazy">`;
  const draw = async () => {
    let items = [];
    try { items = await call('recycled'); } catch { /* none */ }
    const p = items.filter((r) => !r.picture);
    const q = items.filter((r) => r.picture); // newest move first (the list comes newest first)
    pages.innerHTML = p.slice(0, 50).map((r) => `<li><span>${esc(r.name)}</span><span class="meta">${when(r)}</span><button class="btn ghost small" data-f="${esc(r.file)}">Restore</button></li>`).join('')
      || '<li class="note">No deleted pages.</li>';
    pics.innerHTML = q.map((r) => `<li><span>${thumb(r)}${esc(r.picture.replace(/^assets\//i, ''))}</span><span class="meta">${when(r)}</span><button class="btn ghost small" data-f="${esc(r.file)}" data-pic>Put back</button></li>`).join('');
    pics.hidden = $('.bin-pics-h', card).hidden = !q.length;
  };
  card.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);
  card.onclick = async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    try {
      const name = await call('restore', { file: b.dataset.f }); // a picture: where it went ("assets/sub/x.png")
      const at = name.lastIndexOf('/');
      if (b.hasAttribute('data-pic')) app.toast(`Put “${name.slice(at + 1)}” back in ${name.slice(0, at)}.`);
      else { await app.refreshNames(); app.toast(`Restored “${name}”`); }
      draw();
    } catch (err) { app.toast(String(err), 6000); }
  };
  app.binChanged = draw; // pictures moved to the bin from the check above show up here
  draw();
  return card;
}

/** Safety copies (core/src/app/safety.rs): the notes changed in the last 3 days, copied each time the
 *  folder opens, and a note's earlier text when it was changed or removed somewhere else. Open a
 *  copy, then a note, to read it as it was and put that version back. */
function safetyCard(app) {
  const card = h('div', 'card');
  card.innerHTML = `<h2>Safety copies</h2>
    <p class="note">Each time your notes folder opens, the app keeps a copy of the notes changed in the last 3 days. When a note is changed or removed somewhere else (your ${isAndroid ? 'computer' : 'phone'}, Claude, another app), the app also keeps its text from before. The copies stay on this ${isAndroid ? 'phone' : 'computer'}, outside your notes folder: the newest 15, one a day for the last week, and every earlier text from the last week, at most about 100 MB in all (the oldest go first). If a note gets damaged or overwritten, open a copy and put the earlier version back.</p>
    <div class="sc"></div>`;
  const body = $('.sc', card);
  const when = (s) => new Date(s * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const NOW = { same: 'same as now', changed: 'changed since', gone: 'deleted since' };
  const row = (attr, label, meta) => `<li><button type="button" ${attr}><span>${esc(label)}</span><span class="meta">${esc(meta)}</span></button></li>`;
  const holds = (c) => [c.notes && plural(c.notes, 'note'), c.before && plural(c.before, 'earlier version')].filter(Boolean).join(' · ');

  const copies = async () => {
    let items = [];
    try { items = await call('safety_copies'); } catch { /* none */ }
    body.innerHTML = items.length
      ? `<ul class="rows sc-list">${items.map((c) => row(`data-id="${esc(c.id)}"`, when(c.when), holds(c))).join('')}</ul>`
      : '<p class="note">No copies yet. One is made the next time the folder opens, if a note changed in the last 3 days.</p>';
    body.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) copy(b.dataset.id); };
  };
  const copy = async (id) => {
    let c;
    try { c = await call('safety_copy', { id }); } catch (e) { app.toast(String(e), 5000); return copies(); }
    // a note's earlier text: "<page> — before a change made elsewhere", with that version's time
    const label = (x) => (x.before ? `${x.name} — before a change made elsewhere` : x.name);
    const meta = (x) => (x.before && x.now !== 'same' ? `as of ${when(x.changed)}` : NOW[x.now] || '');
    body.innerHTML = `<button type="button" class="btn ghost small" data-back>‹ All copies</button>
      <h3>Copy from ${esc(when(c.when))}</h3>
      <ul class="rows sc-list">${c.notes.map((x) => row(`data-p="${esc(x.path)}" data-before="${x.before || 0}"`, label(x), meta(x))).join('')}</ul>
      ${c.skipped.length ? `<p class="note small">Left out of this copy: ${c.skipped.map(([p, why]) => `${esc(p)} (${esc(why)})`).join(', ')}.</p>` : ''}`;
    body.onclick = (e) => {
      if (e.target.closest('[data-back]')) return copies();
      const b = e.target.closest('[data-p]');
      if (b) note(id, b.dataset.p, Number(b.dataset.before) || 0); // 0: the note as copied, 1, 2…: an earlier text
    };
  };
  const note = async (id, path, before) => {
    let n;
    try { n = await call('safety_note', { id, path, before }); } catch (e) { app.toast(String(e), 5000); return copy(id); }
    const asOf = before ? when(n.changed) : when(n.when); // an earlier text: when that version was saved
    const said = n.same ? 'The note reads like this now too, so there’s nothing to put back.'
      : `${before ? `This is the note as it was before it was changed somewhere else (that version is from ${esc(asOf)}).` : `This is the note as it was on ${esc(asOf)}.`}${n.exists ? '' : ' Its file has been deleted or renamed since; putting it back makes the file again.'}`;
    body.innerHTML = `<button type="button" class="btn ghost small" data-back>‹ Copy from ${esc(when(n.when))}</button>
      <h3>${esc(n.name)}${before ? ' — before a change made elsewhere' : ''}</h3><p class="note">${said}</p><pre class="sc-text"></pre>
      ${n.same ? '' : '<div class="btn-row"><button type="button" class="btn" data-a="put-back">Put this version back</button></div>'}`;
    $('.sc-text', body).textContent = n.text;
    body.onclick = async (e) => {
      if (e.target.closest('[data-back]')) return copy(id);
      if (!e.target.closest('[data-a="put-back"]')) return;
      const ok = await confirmBox({
        title: `Put back this version of “${n.name}”?`,
        body: `The note will read as it did ${before ? 'before it was changed somewhere else' : `on ${esc(asOf)}`}. Its text as it is now is kept first, as a backup copy in <code>logseq/bak</code>.`,
        ok: 'Put it back',
      });
      if (!ok) return;
      try {
        const r = await call('safety_restore', { id, path, before });
        if (r.changed) {
          app.toast(`Put back “${r.name}”. The text it replaced is in logseq/bak.`, 5000);
          await app.refreshNames();
          for (const o of app.outlines) if (o.path === r.path) await o.reload(); // an open page shows it
        } else app.toast('The note already reads like this.');
        note(id, path, before);
      } catch (err) { app.toast(String(err), 6000); }
    };
  };
  copies();
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
  card.innerHTML = `<h2>About</h2><p class="note">Lean Outliner ${esc(ver || '(preview)')}. Your notes stay as plain Markdown files in your folder.</p>`;
  if (isApp) card.append(await updateBox(app));
  return card;
}

// ---------------------------------------------------------------------------
// Newer versions. "Update now" (the installed app on Windows, and Android) downloads the new
// version, checks it's genuine, saves everything and installs it: on Windows the app restarts by
// itself (src-tauri/src/update.rs); on Android, Android asks to confirm and he opens the app again
// (android/MainActivity.kt). Otherwise (the portable copy, a build without the update key) the
// downloads page. One update at a time, shown by whichever About box is open (Settings may be left
// and opened again meanwhile). The box's data-stage says how far it has got (also for the tests).
const job = { busy: false, stage: '', html: '', show: null, android: null, app: null };
const UNSAVED = 'Some changes aren’t saved yet (see the message at the top of the page), so nothing was installed. Sort that out, then try again.';
const say = (stage, html) => { job.stage = stage; job.html = html; job.show?.(stage, html); };

async function updateBox(app) {
  const box = h('div', 'upd');
  job.app = app;
  const how = isAndroid ? { can: !!window.LeanAndroid?.update } : await call('update_status').catch(() => ({ can: false }));
  const page = () => (app.latest?.url ? ` <a href="${esc(app.latest.url)}" data-ext>the downloads page</a>` : ' the downloads page');
  const draw = (stage, html, button = '') => {
    box.dataset.stage = stage;
    box.innerHTML = `<p class="note upd-out" role="status">${html}</p>${button ? `<div class="btn-row">${button}</div>` : ''}`;
    box.querySelector('[data-ext]')?.addEventListener('click', (e) => { e.preventDefault(); app.openUrl(app.latest.url); });
  };
  const idle = (msg = '') => draw('idle', msg, '<button class="btn ghost" data-a="check">Check for a newer version</button>');
  const offer = () => {
    const name = `Build ${esc(String(app.latest.tag).replace(/^build-/, ''))}`;
    if (!how.can) return draw('newer', `A newer version (${name}) is ready: get it from${page()}.${how.msg ? ' ' + esc(how.msg) : ''}`); // why not (update.rs)
    // how much it downloads (on the phone he may want to wait for Wi-Fi)
    const bytes = app.latest.sizes?.[isAndroid ? 'LeanOutliner.apk' : 'LeanOutliner-setup.exe'];
    const size = bytes ? `about ${Math.max(1, Math.round(bytes / 1e6))} MB` : isAndroid ? 'about 8 MB' : 'about 2 MB';
    draw('newer', `A newer version (${name}) is ready. <b>Update now</b> downloads it (${size}), checks it’s genuine and installs it${isAndroid ? '' : ', then restarts Lean Outliner'}. Your notes are saved first. You can also get it from${page()}.`,
      '<button class="btn" data-a="update">Update now</button>');
  };
  // how the update is going, in this box (the newest one shown)
  job.show = (stage, html) => {
    if (stage === 'error') draw(stage, `${html} You can try again, or get it from${page()}.`, '<button class="btn" data-a="update">Update now</button>');
    else if (stage === 'confirm') draw(stage, `${html} (If Android’s box went away: Try again.)`, '<button class="btn ghost" data-a="update">Try again</button>');
    else draw(stage, html, '<button class="btn" data-a="update" disabled>Update now</button>');
  };
  box.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'check') {
      draw('checking', 'Checking…');
      const newer = await app.checkUpdate(true);
      if (newer) offer(); else idle(newer === null ? 'Couldn’t check (offline?).' : 'You have the latest version.');
    }
    if (a === 'update' && !job.busy && app.latest) updateNow(app, app.latest.tag);
  };
  if (job.busy || job.stage === 'confirm' || job.stage === 'error') job.show(job.stage, job.html);
  else if (await app.checkUpdate()) offer();
  else idle();
  return box;
}

/** Download, check, save, install; anything wrong is shown in words. */
async function updateNow(app, tag) {
  job.busy = true;
  try {
    if (isAndroid) await androidUpdate(app, tag);
    else {
      say('download', 'Downloading…');
      await call('update_download', { tag });
      say('check', 'Checking it’s genuine…');
      await call('update_check');
      await saveFirst(app);
      // everything is saved: from here on nothing more can be typed (it couldn't be saved before
      // the installer closes the app)
      document.body.inert = true;
      say('install', 'Installing: Lean Outliner will restart in a moment.');
      if (!document.querySelector('.upd')) app.toast('Installing the update: Lean Outliner will restart in a moment.', 60000); // (About was left)
      await call('update_install'); // the installer closes the app, updates it and starts it again
    }
    job.busy = false;
  } catch (e) {
    fail(app, String(e?.message ?? e));
  }
}
/** Something stopped the update: said in the About box, and at the bottom if he's elsewhere. */
function fail(app, msg) {
  job.busy = false;
  document.body.inert = false;
  say('error', esc(msg));
  if (!document.querySelector('.upd')) app?.toast('The update didn’t go ahead: ' + msg, 9000);
}

async function saveFirst(app) {
  say('save', 'Saving your notes…');
  if (!(await app.saveAll(15000))) throw new Error(UNSAVED);
  if (app.vaultOpen) await call('persist').catch(() => {});
}

/** Android: MainActivity downloads and checks the APK and says how it goes ("lean-update"
 *  events); once it's ready the page saves everything and hands over to Android's installer,
 *  which asks him to confirm. Its answer (cancelled, refused, done) can come any time after. */
function androidUpdate(app, tag) {
  const shown = () => (document.visibilityState === 'visible' ? Promise.resolve() : new Promise((r) => {
    const f = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); r(); } };
    document.addEventListener('visibilitychange', f);
  }));
  return new Promise((resolve, reject) => {
    job.android = async ({ stage, msg = '' }) => {
      if (stage === 'permission') say(stage, 'Android asks first: turn on <b>Allow from this source</b> for Lean Outliner, then come back here.');
      else if (stage === 'download') say(stage, `Downloading… ${esc(msg)}`);
      else if (stage === 'check') say(stage, 'Checking it’s genuine…');
      else if (stage === 'ready') {
        try { await saveFirst(app); } catch (err) { job.android = null; return reject(err); }
        await shown(); // Android only shows its installer over the app while it's on screen
        say('install', 'Installing: open Lean Outliner again when Android has finished.');
        window.LeanAndroid.installUpdate();
      } else if (stage === 'confirm') {
        say(stage, 'Tap <b>Update</b> in Android’s box. When Android has finished, open Lean Outliner again.');
        job.android = null; // the rest is Android's (its answer goes to androidSaid)
        resolve();
      } else if (stage === 'error' || stage === 'done') {
        job.android = null;
        androidSaid({ stage, msg });
        resolve();
      }
    };
    window.LeanAndroid.update(tag);
  });
}
function androidSaid({ stage, msg = '' }) {
  if (stage === 'done') return say(stage, 'Updated: open Lean Outliner again.');
  if (stage !== 'error') return;
  call('log', { msg: 'update (Android): ' + msg }).catch(() => {});
  fail(job.app, msg);
}
if (isAndroid) document.addEventListener('lean-update', (e) => (job.android || androidSaid)(e.detail || {}));

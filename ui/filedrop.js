// Pictures and files dragged in from outside the app (Windows Explorer, the desktop, another app) and
// dropped on a page: each is copied into the notes folder's assets/ under the name Logseq gives it
// (app::asset_file_name; a file that's in assets/ already is linked where it is) and linked where it
// was dropped, as "Upload a file" does: a picture as ![name](../assets/…), any other file as
// [name.ext](../assets/…). On the note being typed in: at the caret. On another note: under its words
// (a line of its own each). Elsewhere on a page or a Journals day: a new note at its end for each. The
// note (or the end of the notes) lights up while files are over it. One Undo step per drop.
// In the Windows app Tauri's own file drop owns these drags (the page's HTML5 drag and drop never
// sees them): its drag-drop events give each file's path, and `save_asset_path` (src-tauri lib.rs →
// app::save_dropped_file) copies it. In a browser (the dev server) and on Android: the HTML5 drop's
// File objects, sent like a pasted picture (`save_asset`); a file dropped anywhere else never opens
// in place of the app.
import { call, isApp, isAndroid } from './api.js';
import { fileLink, findAgain } from './editor.js';

/** What files dropped at x, y (on screen) would go into: {o, i, blk} a note of outline o, {o, i: null}
 *  the end of o (its sheet: a page, a day, but not on a note), or null (nowhere: the sidebar…). */
function targetAt(app, x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const ok = (o) => o && !o.readonly && !o.preview && !o.conflict && !o.locked;
  const blk = el.closest('.blk');
  const o = blk && app.outlines.find((x) => x.el.contains(blk));
  if (ok(o)) return { o, i: +blk.dataset.i, blk };
  const sheet = el.closest('.sheet');
  const s = sheet && app.outlines.find((x) => sheet.contains(x.el));
  return ok(s) ? { o: s, i: null } : null;
}

/** Copy the files (items: {name, save() → {path, md}}) and link them at x, y (targetAt). */
async function dropFiles(app, x, y, items) {
  const tg = targetAt(app, x, y);
  if (!tg) { app.toast('To add pictures or files, drop them onto a note or a page.', 3500); return; }
  const { o } = tg;
  const blocks = o.blocks, shape = o.shape();
  const links = [], bad = [];
  for (const f of items) {
    try { links.push((await f.save()).md); } catch (e) { bad.push(`“${f.name}”: ${String(e?.message ?? e).replace(/\.$/, '')}`); }
  }
  if (bad.length) app.toast(`Couldn’t add ${bad.join('; ')}.`, 8000);
  if (!links.length) return;
  if (!o.el.isConnected || o.readonly || o.locked || o.conflict) { app.toast('The page changed meanwhile, so the files weren’t linked (they’re in the assets folder).', 6000); return; }
  let i = tg.i;
  if (i !== null && o.blocks !== blocks) i = findAgain(shape, i, o.blocks); // (read again meanwhile: the same note by its words)
  if (i !== null && o.cur === i && o.ta) { // the note being typed in: at the caret (a space from the word before it)
    const before = o.ta.value.slice(0, o.ta.selectionStart);
    o.insertAtCaret((before && !/\s$/.test(before) ? ' ' : '') + links.join(' '));
    return;
  }
  o.snap();
  if (i !== null) o.setText(i, (t) => (t.trim() ? t + '\n' : '') + links.join('\n'));
  else {
    // a new note at the end for each (an empty page's empty note makes way)
    const depth = o.root === null ? 0 : o.blocks[o.root].depth + 1;
    const only = o.root === null && o.blocks.length === 1 && !o.blocks[0].text.trim() && o.cur === null;
    o.blocks.splice(only ? 0 : o.end, only ? 1 : 0, ...links.map((md) => ({ depth, text: md, raw: null })));
    o.render();
    o.markDirty();
  }
  if (app.active?.cur == null) app.active = o; // (Ctrl+Z undoes it)
}

/** A File from an HTML5 drop, copied into assets/ (as editor.js addFile does). */
async function saveFile(f) {
  if (f.size > 25e6) throw new Error('it’s over 25 MB; pick a smaller one');
  if (!f.size && !f.type) throw new Error('folders can’t be added; drop the files in it instead');
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
  const path = await call('save_asset', { name: f.name || 'file', data });
  return { path, md: fileLink(f, path) };
}

/** Start listening for files dragged in from outside. */
export function initFileDrop(app) {
  // the note (or the end of the notes) the files would go into lights up
  let lit = null, end = null;
  const light = (tg) => {
    const b = tg && tg.i !== null ? tg.blk : null, e = tg && tg.i === null ? tg.o.el : null;
    if (b !== lit) { lit?.classList.remove('file-over'); b?.classList.add('file-over'); lit = b; }
    if (e !== end) { end?.classList.remove('file-end'); e?.classList.add('file-end'); end = e; }
  };
  const T = window.__TAURI__;
  if (isApp && !isAndroid) {
    if (!T?.event?.listen) return;
    // Tauri gives the place in the window's own pixels
    const at = (p) => [(p?.x ?? 0) / devicePixelRatio, (p?.y ?? 0) / devicePixelRatio];
    let files = false; // (something else dragged in, e.g. words from a web page: nothing to do)
    T.event.listen('tauri://drag-enter', (e) => { files = !!e.payload?.paths?.length; if (files) light(targetAt(app, ...at(e.payload.position))); });
    T.event.listen('tauri://drag-over', (e) => { if (files) light(targetAt(app, ...at(e.payload?.position))); });
    T.event.listen('tauri://drag-leave', () => { files = false; light(null); });
    T.event.listen('tauri://drag-drop', (e) => {
      files = false;
      light(null);
      const paths = e.payload?.paths || [];
      if (!paths.length) return;
      dropFiles(app, ...at(e.payload.position), paths.map((p) => ({ name: p.split(/[\\/]/).pop(), save: () => call('save_asset_path', { path: p }) })));
    });
    return;
  }
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // (dropping is allowed here; anywhere else it would open the file in place of the app)
    const tg = targetAt(app, e.clientX, e.clientY);
    e.dataTransfer.dropEffect = tg ? 'copy' : 'none';
    light(tg);
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) light(null); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    light(null);
    const files = [...e.dataTransfer.files];
    if (files.length) dropFiles(app, e.clientX, e.clientY, files.map((f) => ({ name: f.name, save: () => saveFile(f) })));
  });
}

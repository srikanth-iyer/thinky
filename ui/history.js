// A page's History ("History…" in its ⋯ menu): its earlier versions, from the backups in logseq/bak
// (Logseq's and this app's) and this device's safety copies (core/src/app/history.rs), newest first,
// each with when, where it came from and how it differs from the page now. One opens drawn like the
// page, read-only (Outline with preview); "Put this version back" keeps the page's text as it is now
// in logseq/bak first (history_keep), then the page's editor saves the version the usual way
// (Outline.putBack: one Undo step; a change made elsewhere meanwhile is merged in, or the clash
// screen asks). Refused while a clash on the page waits, or for a file that isn't UTF-8 text.
import { call, isAndroid } from './api.js';
import { esc, propsHtml, visibleProps } from './render.js';
import { h, ICON } from './dom.js';
import { Outline, docKey } from './editor.js';
/** A page's title:: (in its properties or its first note), small letters; '' when it has none. */
const titleOf = (doc) => (`${doc?.preamble ?? ''}\n${doc?.blocks?.[0]?.text ?? ''}`.match(/^[ \t]*title::[ \t]*(.*?)[ \t]*\r?$/mi)?.[1] ?? '').toLowerCase();

const DEVICE = isAndroid ? 'phone' : 'computer';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Today 01:32", "Yesterday 18:05", "Oct 24, 02:00"; another year "Oct 24, 2025, 02:00" (local time). */
export function whenText(secs, now = new Date()) {
  const d = new Date(secs * 1000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 864e5);
  if (ago === 0) return `Today ${hm}`;
  if (ago === 1) return `Yesterday ${hm}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? '' : `, ${d.getFullYear()}`}, ${hm}`;
}
/** Where a version came from, in plain words (history.rs `from`). */
const FROM = {
  'logseq-phone': 'Backup made by Logseq on your phone',
  'logseq-computer': 'Backup made by Logseq on your computer',
  logseq: 'Backup made by Logseq',
  app: 'Backup made by this app',
  bak: 'Backup copy in logseq/bak',
  copy: `Safety copy on this ${DEVICE}`,
  before: 'Before a change made elsewhere',
};
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** How a version differs from the page now, briefly: "3 more notes, 1 changed". */
export function differs(v) {
  const p = [];
  if (v.more) p.push(count(v.more, 'more note'));
  if (v.fewer) p.push(count(v.fewer, 'fewer note'));
  if (v.changed) p.push(p.length ? `${v.changed} changed` : `${count(v.changed, 'note')} changed`);
  if (v.props) p.push(p.length ? 'properties changed' : 'Page properties changed');
  return p.join(', ') || 'Only spacing or line breaks differ';
}

/** The History of the page outline o shows (its ⋯ menu). */
export async function openHistory(app, o) {
  if (document.querySelector('.hist-back')) return;
  o.stopEdit();
  o.clearSel();
  const back = h('div', 'modal-back panel-back hist-back');
  const box = h('div', 'panel hist');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'hv-title');
  box.innerHTML = `<header class="panel-head"><div class="hv-top"><h2 id="hv-title">History of “${esc(o.name)}”</h2>
      <button type="button" class="icon-btn" data-h="close" aria-label="Close" title="Close (Esc)">${ICON.winClose}</button></div>
      <p class="note">Earlier versions of this page, newest first: backups in <code>logseq/bak</code> and this ${DEVICE}’s safety copies.</p></header>
    <div class="panel-body hv-body"><p class="note hv-wait">Looking for earlier versions…</p></div>
    <footer class="panel-foot" hidden></footer>`;
  back.append(box);
  document.body.append(back);
  const body = box.querySelector('.hv-body');
  const foot = box.querySelector('.panel-foot');
  box.querySelector('[data-h="close"]').focus();
  let list = [];
  let shown = null; // the version open: { k, v, r }
  let busy = false; // putting one back
  let asked = 0; // the version clicked last (an earlier click answered later is dropped)
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    o.el.closest('.view')?.querySelector('.title-row [data-a="more"]')?.focus({ preventScroll: true }); // (where it was opened)
  };
  const label = (v) => FROM[v.from] || FROM.bak;

  const showList = (k = 0) => {
    shown = null;
    foot.hidden = true;
    if (!list.length) {
      body.innerHTML = `<p class="note">No earlier versions of this page yet. They come from backups (Logseq’s, and this app’s when a page is changed in two places at once or a version is put back) and from this ${DEVICE}’s safety copies of the pages changed in the last 3 days.</p>`;
      return;
    }
    body.innerHTML = `<ul class="rows hv-list">${list.map((v, i) => `<li><button type="button" data-k="${i}"><span class="hv-when">${esc(whenText(v.when))}</span>
      <span class="hv-from">${esc(label(v))}</span>
      <span class="hv-diff">${esc(differs(v))}</span></button></li>`).join('')}</ul>`;
    const row = body.querySelector(`[data-k="${k}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  };
  const toList = () => { asked++; showList(shown?.k ?? 0); };

  const showVersion = async (k) => {
    const v = list[k];
    const ask = ++asked;
    let r;
    try { r = await call('history_version', { name: o.name, path: o.path, id: v.id }); } catch (e) { app.toast(String(e?.message ?? e), 6000); return; }
    if (!back.isConnected || busy || ask !== asked) return;
    shown = { k, v, r };
    body.innerHTML = `<button type="button" class="btn ghost small" data-h="list">‹ All versions</button>
      <p class="note hv-about"><b>${esc(whenText(v.when))}</b> · ${esc(label(v))} · ${esc(differs(v))}</p>
      ${r.same ? '<p class="note">The page reads exactly like this now, so there’s nothing to put back.</p>' : ''}
      <div class="sheet hv-sheet"><div class="page-head"><h1 class="page-title">${esc(o.name)}</h1><div class="page-props"></div></div><div class="hv-page"></div></div>`;
    // drawn like the page: its properties under the title (unless written as its first note, which
    // shows them), then its notes, every one unfolded (nothing here can be folded)
    const props = visibleProps(r.props || []);
    if (r.doc.preamble.trim() && props.length) body.querySelector('.page-props').innerHTML = propsHtml(props);
    const doc = JSON.parse(JSON.stringify(r.doc));
    for (const b of doc.blocks) b.text = b.text.replace(/\ncollapsed:: true(?=\n|$)/, '');
    const host = body.querySelector('.hv-page');
    if (!doc.blocks.length) host.before(h('p', 'note', 'This version of the page is empty.'));
    new Outline(host, { info: { name: o.name, path: o.path, exists: true, journal: o.journal }, doc, hash: '', readonly: true }, app, { preview: true });
    foot.hidden = r.same;
    foot.innerHTML = `<p class="note">What the page says now is kept first, as a backup copy in <code>logseq/bak</code>.</p>
      <div class="btn-row"><button type="button" class="btn" data-h="put">Put this version back</button></div>`;
    body.scrollTop = 0;
    body.querySelector('[data-h="list"]').focus({ preventScroll: true });
  };

  // first the page's own text as it is now, kept in logseq/bak; then the editor saves the version
  const putBack = async () => {
    if (!shown || busy) return;
    const { v } = shown;
    if (o.readonly) { app.toast(o.error || 'This page’s file isn’t plain UTF-8 text, so it isn’t changed from here (to keep it safe).', 6000); return; }
    busy = true;
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    let kept = null;
    try {
      // typing not saved yet goes in first (on either side); a clash on this page is settled first
      await Promise.all(app.sameFileAs(o).map((x) => { x.stopEdit(); return x.flush(); }));
      if (app.clashWaiting(o)) { close(); return; }
      if (o.dirty || !app.outlines.includes(o)) { app.toast(`“${o.name}” couldn’t be saved just now, so nothing was put back. Try again in a moment.`, 6000); return; }
      kept = await call('history_keep', { name: o.name, path: o.path, id: v.id });
    } catch (e) {
      app.toast(String(e?.message ?? e), 6000);
      return;
    } finally {
      if (!kept && back.isConnected) {
        busy = false;
        box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    }
    close();
    if (kept.same) { app.toast('The page already reads like this.', 3500); return; }
    // a version with another title:: would rename the page (its links would point at nothing): not put back
    const was = titleOf(kept.doc), now = titleOf(o.doc);
    if (was !== now) {
      app.toast(`That version calls the page “${was || o.name}” (its title:: line), so putting it back would rename the page. Nothing was changed: open it in History to copy what you need.`, 9000);
      return;
    }
    await o.putBack(kept.doc);
    if (o.conflict || o.dirty) return; // (the clash screen, or a save that failed, says so itself)
    o.refreshHead?.();
    const when = whenText(v.when).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase());
    const where = kept.bak ? ` Its text from before is kept in ${kept.bak}.` : '';
    // merged with a change made elsewhere meanwhile: no Undo (its steps are dropped, editor.js applyMerged)
    if (docKey(o.doc) !== docKey(kept.doc)) {
      app.toast(`Put back the version from ${when}, with the changes made elsewhere meanwhile.${where}`, 10000);
      return;
    }
    const step = o.undoStack.at(-1);
    app.toast(`Put back the version from ${when}.${where}`, 10000, step && { label: 'Undo', run: () => {
      if (o.undoStack.at(-1) !== step || !app.outlines.includes(o)) { app.toast('Something else was changed since, so this can’t be undone from here.', 3500); return; }
      o.undo();
      app.unstep?.(o); // (and out of the app's list of steps: Ctrl+Z goes on from the change before)
      o.flush().then(() => o.refreshHead?.());
    } });
  };

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const big = document.querySelector('.modal-back.lightbox'); // a picture opened big from the version
    if (big) { big.remove(); return; }
    if (busy) return;
    if (shown) toList(); else close();
  };
  document.addEventListener('keydown', onKey, true);
  body.addEventListener('keydown', (e) => { // ↑ ↓ along the list
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...body.querySelectorAll('.hv-list [data-k]')];
    const k = rows.indexOf(document.activeElement);
    if (k < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  box.addEventListener('click', (e) => {
    if (busy || e.target.closest('.hv-page')) return;
    const b = e.target.closest('[data-k], [data-h]');
    if (!b) return;
    if (b.dataset.k !== undefined) showVersion(+b.dataset.k);
    else if (b.dataset.h === 'close') close();
    else if (b.dataset.h === 'list') toList();
    else if (b.dataset.h === 'put') putBack();
  });
  back.addEventListener('pointerdown', (e) => { if (e.target === back && !busy) close(); });

  // (what was typed last saved first, so "how it differs" is from the page as he sees it)
  try {
    const waiting = o.conflict;
    await o.flush();
    if (o.conflict && !waiting) { close(); return; } // (that save met a change made elsewhere: the clash screen asks first)
    list = await call('history', { name: o.name, path: o.path });
  } catch (e) {
    if (back.isConnected) body.innerHTML = `<p class="err">${esc(e?.message ?? e)}</p>`;
    return;
  }
  if (back.isConnected) showList();
}

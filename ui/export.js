// "Copy page as text…" (a page's ⋯ menu): the page's notes as text (Markdown bullets), OPML or HTML,
// with Logseq's options (its "Copy / Export as…" box: properties, indentation, [[links]] as plain
// words), to the clipboard or saved as a file where the platform has a save dialog (not Android).
// Loaded the first time it's used (app.js pageMenu).

import { esc, renderBlock, stampText, PROP, hiddenKey } from './render.js';
import { store, isAndroid } from './api.js';
import { h } from './dom.js';

const KINDS = { text: 'Text', opml: 'OPML', html: 'HTML' };

/** Each note of the page as {depth (from 0), lines, mark ("1." for a numbered note, else null)},
 *  without hidden properties, and without any property when props is off. plain: [[x]] → x. */
function notesOf(outline, { props, plain }) {
  const base = Math.min(...outline.blocks.map((b) => b.depth));
  const words = (l) => (plain ? l.replace(/\[\[([^[\]\n]+)\]\]/g, '$1') : l);
  return outline.blocks.map((b, j) => {
    const lines = b.text.split('\n').filter((l, k) => {
      const m = k > 0 && l.match(PROP);
      return !m || (props && !hiddenKey(m[1].toLowerCase()));
    }).map(words);
    return { depth: b.depth - base, lines, mark: outline.nums?.get(j)?.mark ?? null };
  }).filter((n, k, all) => n.lines.join('').trim() || all[k + 1]?.depth > n.depth); // (an empty note only when notes hang under it)
}
/** The page's own properties (its first lines, before the notes), when wanted. */
const pageProps = (outline, o) => (o.props ? outline.doc.preamble.split('\n').filter((l) => l.trim() && !(PROP.test(l) && hiddenKey(l.match(PROP)[1].toLowerCase()))) : []);

/** As text: Logseq's Markdown bullets, a tab (or two spaces) a level, or (indent "none") just the
 *  notes' lines, one after the other. */
export function asText(outline, o) {
  const out = pageProps(outline, o);
  for (const n of notesOf(outline, o)) {
    if (o.indent === 'none') { out.push(...n.lines); continue; }
    const ind = (o.indent === 'spaces' ? '  ' : '\t').repeat(n.depth);
    const mark = (n.mark ?? '-') + ' ';
    n.lines.forEach((l, k) => out.push(k ? ind + ' '.repeat(mark.length) + l : ind + mark + l));
  }
  return out.join('\n') + '\n';
}

const xml = (s) => esc(s).replace(/\n/g, '&#10;');
/** As OPML (outliners such as Workflowy, Dynalist or OmniOutliner read it): an outline per note,
 *  its first line as text, its other lines as _note. */
export function asOpml(outline, o, title) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head>', `    <title>${xml(title)}</title>`, '  </head>', '  <body>'];
  const notes = notesOf(outline, o);
  let open = 0; // outlines open (not closed yet)
  notes.forEach((n, k) => {
    for (; open > n.depth; open--) out.push('  '.repeat(open + 1) + '</outline>');
    const note = n.lines.slice(1).join('\n');
    const kids = notes[k + 1]?.depth > n.depth;
    out.push(`${'  '.repeat(n.depth + 2)}<outline text="${xml((n.mark ? n.mark + ' ' : '') + n.lines[0])}"${note ? ` _note="${xml(note)}"` : ''}${kids ? '>' : '/>'}`);
    if (kids) open = n.depth + 1;
  });
  for (; open > 0; open--) out.push('  '.repeat(open + 1) + '</outline>');
  out.push('  </body>', '</opml>');
  return out.join('\n') + '\n';
}

/** A note's words as plain HTML: links, bold, italics, code, quotes kept; the app's own marks
 *  (page links, tags, pictures in the notes folder, formulas…) as words. */
function noteHtml(text, o) {
  const r = renderBlock(text);
  const t = document.createElement('template');
  t.innerHTML = r.html;
  const keep = new Set(['STRONG', 'EM', 'S', 'MARK', 'INS', 'CODE', 'PRE', 'BLOCKQUOTE', 'BR']);
  const clean = (el) => {
    for (const c of [...el.children]) {
      clean(c);
      const tag = c.tagName;
      if (c.matches('a[data-page]')) c.replaceWith(c.classList.contains('tag') ? c.textContent : o.plain ? c.textContent : `[[${c.dataset.page}]]`);
      else if (c.dataset.ref) c.replaceWith(`((${c.dataset.ref}))`);
      else if (tag === 'A') { const a = h('a', '', c.innerHTML); a.href = c.getAttribute('href'); c.replaceWith(a); }
      else if (tag === 'IMG') {
        const src = c.getAttribute('src') || '';
        if (/^https?:/i.test(src)) { const i = h('img'); i.src = src; i.alt = c.alt; c.replaceWith(i); } else c.replaceWith(c.alt ? `[${c.alt}]` : '');
      } else if (c.matches('.h')) c.replaceWith(Object.assign(h('strong'), { innerHTML: c.innerHTML }));
      else if (keep.has(tag)) { for (const at of [...c.attributes]) c.removeAttribute(at.name); }
      else c.replaceWith(...c.childNodes); // (the app's own boxes and labels: their words)
    }
  };
  clean(t.content);
  const div = document.createElement('div');
  div.append(t.content);
  const mk = r.marker ? `${esc(r.marker)} ` : '';
  const dates = r.dates.map((d) => `<br>${d.kind === 'deadline' ? 'DEADLINE' : 'SCHEDULED'}: ${esc(stampText(d.date, d.time, d.repeat))}`).join('');
  const props = o.props ? r.props.map(([k, v]) => `<br>${esc(k)}:: ${esc(v)}`).join('') : '';
  return mk + div.innerHTML + dates + props;
}
/** As HTML: nested lists (numbered notes in <ol>), for pasting into a mail, a document… */
export function asHtml(outline, o) {
  const out = [];
  const open = []; // the lists open: 'ul' or 'ol'
  const pp = pageProps(outline, o);
  if (pp.length) out.push(`<p>${pp.map(esc).join('<br>')}</p>`);
  for (const n of notesOf(outline, o)) {
    const tag = n.mark ? 'ol' : 'ul';
    while (open.length > n.depth + 1) out.push(`</li></${open.pop()}>`);
    if (open.length === n.depth + 1 && open.at(-1) !== tag) out.push(`</li></${open.pop()}>`);
    if (open.length === n.depth + 1) out.push('</li>');
    while (open.length < n.depth + 1) { out.push(`<${tag}>`); open.push(tag); }
    out.push(`<li>${noteHtml(n.lines.join('\n'), o)}`);
  }
  while (open.length) out.push(`</li></${open.pop()}>`);
  return out.join('\n') + '\n';
}

/** Put text on the clipboard (with html: as formatted words too). True when it got there. */
async function copy(text, html) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch { /* the older way below */ }
  let ok = false;
  const put = (e) => { e.clipboardData.setData('text/plain', text); if (html) e.clipboardData.setData('text/html', html); e.preventDefault(); ok = true; };
  document.addEventListener('copy', put, { once: true });
  try { document.execCommand('copy'); } catch { /* not allowed */ }
  document.removeEventListener('copy', put);
  return ok;
}

/** Save text as a file: the system's save dialog where there is one, else the browser's download. */
async function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  if (window.showSaveFilePicker) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const f = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.slice(1).toUpperCase(), accept: { [type]: [ext] } }] });
      const w = await f.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) { if (e?.name === 'AbortError') return false; } // (Cancel; anything else: the download below)
  }
  const a = h('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return true;
}

/** The box: a choice of Text / OPML / HTML, the options, what will be copied, Copy and Save. */
export function exportPage(app, outline, pv) {
  const title = pv?.info?.name ?? outline.name;
  const o = { kind: 'text', props: true, plain: false, indent: 'tabs', ...store.get('exportOpts', {}) };
  const back = h('div', 'modal-back');
  const box = h('div', 'modal export');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Copy page as text');
  box.innerHTML = `<h2>Copy “${esc(title)}”</h2>
    <div class="ex-kinds" role="group" aria-label="As">${Object.entries(KINDS).map(([k, l]) => `<button type="button" class="btn small ghost" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="ex-opts">
      <label class="ex-ind">Indentation <select><option value="tabs">Tabs</option><option value="spaces">Spaces</option><option value="none">None (no dashes)</option></select></label>
      <label><input type="checkbox" data-o="props"> Properties</label>
      <label><input type="checkbox" data-o="plain"> Links as plain words <span class="note">([[page]] → page)</span></label>
    </div>
    <textarea class="ex-out" readonly aria-label="What will be copied"></textarea>
    <div class="btn-row end"><button type="button" class="btn ghost" data-a="close">Close</button>${isAndroid ? '' : '<button type="button" class="btn ghost" data-a="save">Save as file…</button>'}<button type="button" class="btn" data-a="copy">Copy</button></div>`;
  back.append(box);
  document.body.append(back);
  const out = box.querySelector('.ex-out'), sel = box.querySelector('select');
  let text = '', html = '';
  const draw = () => {
    store.set('exportOpts', o);
    for (const b of box.querySelectorAll('[data-k]')) b.setAttribute('aria-pressed', String(b.dataset.k === o.kind));
    box.querySelector('.ex-ind').hidden = o.kind !== 'text';
    sel.value = o.indent;
    for (const c of box.querySelectorAll('[data-o]')) c.checked = !!o[c.dataset.o];
    html = o.kind === 'html' ? asHtml(outline, o) : '';
    text = o.kind === 'text' ? asText(outline, o) : o.kind === 'opml' ? asOpml(outline, o, title) : html;
    out.value = text;
  };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  sel.onchange = () => { o.indent = sel.value; draw(); };
  box.addEventListener('change', (e) => { const k = e.target.dataset?.o; if (k) { o[k] = e.target.checked; draw(); } });
  box.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k) { o.kind = k; draw(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'copy') {
      const ok = await copy(text, html);
      if (ok) { close(); app.toast(`Copied as ${KINDS[o.kind]}`, 1500); } else app.toast('Couldn’t copy to the clipboard.', 3000);
    }
    if (a === 'save') {
      const name = title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'page';
      const ext = { text: '.md', opml: '.opml', html: '.html' }[o.kind];
      const type = { text: 'text/markdown', opml: 'text/x-opml', html: 'text/html' }[o.kind];
      const file = o.kind === 'html' ? `<!doctype html>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n${html}` : text;
      if (await saveFile(name + ext, file, type)) { close(); app.toast('Saved', 1500); }
    }
  });
  draw();
  box.querySelector('[data-a="copy"]').focus();
}

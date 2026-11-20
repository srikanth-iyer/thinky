// The optional AI's page features (Build 52; he picked them from a clickable preview, Nov 20). Loaded
// the first time one is used (app.js). Each reads the page and every note that links to it (core
// ai.rs page_material, never the whole folder), shows what it suggests IN the page, and saves nothing
// until he presses the one filled button:
// - Ask about this page… (the page's ⋯ menu): a question box under the title; the answer's points
//   each name the page or day they came from (a click opens it). "Add to page" puts the question at the
//   end of the page with the points under it (by:: ai when that's on).
// - Suggest aliases and a description (the page's ⋯ menu): aliases to tick and a description to edit,
//   then "Add" writes them into the page's properties (alias:: joins the ones there; description::
//   replaces one), one Undo step.
// - Suggest links (a ✦ button on "Unlinked references"): each mention ticked when the AI thinks it
//   really means this page, unticked with why when it doesn't; "Link N" makes the ticked ones links
//   (link_mention, as the row's own Link button does), with Undo.
// The look follows Polish note's (app.css "the optional AI"): one line of buttons, only the first filled.
import { askPage, suggestNames, suggestLinks, aiSettings } from './ai.js';
import { call } from './api.js';
import { esc } from './render.js';
import { ICON, h, pageLink } from './dom.js';

const btn = (a, icon, label, cls = '') => `<button type="button" class="btn small pz-b${cls}" data-a="${a}" aria-label="${label}" title="${label}">${icon}<span>${label}</span></button>`;
const waitHtml = (words) => `<p class="pz-reading" aria-busy="true">${esc(words)}<span class="pz-sweep" aria-hidden="true"></span></p>`;
const said = (e) => String(e?.message ?? e);

/** The AI box under a page's title (one at a time on a page). */
function panelIn(head) {
  head.querySelector(':scope > .ai-panel')?.remove();
  const box = h('div', 'ai-panel');
  head.append(box);
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  const esc_ = (e) => { if (e.key === 'Escape' && box.isConnected && !document.querySelector('.pop:not([hidden]), .modal-back')) { e.preventDefault(); close(); } };
  const close = () => { box.remove(); document.removeEventListener('keydown', esc_, true); };
  document.addEventListener('keydown', esc_, true);
  box.close = close;
  return box;
}

// ---------------------------------------------------------------- Ask about this page
export function askAbout(app, head, outline, name) {
  const box = panelIn(head);
  box.classList.add('ai-ask');
  box.innerHTML = `<form class="ask-row"><input class="ask-q" type="text" enterkeyhint="send" autocomplete="off" placeholder="Ask about ${esc(name)}…" aria-label="Your question about ${esc(name)}">${btn('ask', ICON.polish, 'Ask', ' pz-keep')}<button type="button" class="icon-btn" data-a="close" aria-label="Close" title="Close">${ICON.winClose}</button></form>
    <p class="note small ask-reads">Reads this page and the notes that link to it.</p><div class="ask-out"></div>`;
  const input = box.querySelector('.ask-q');
  const out = box.querySelector('.ask-out');
  let asking = 0;
  const ask = async () => {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    const me = ++asking;
    out.innerHTML = waitHtml('Reading your notes…');
    let res;
    try { res = await askPage(name, q); } catch (e) { if (me === asking) out.innerHTML = `<p class="err">${esc(said(e))}</p>`; return; }
    if (me !== asking || !box.isConnected) return;
    if (res.none) { out.innerHTML = `<p class="ask-none">Your notes don’t say.</p>`; return; }
    out.innerHTML = `<p class="ask-said">${esc(q)}</p><ul class="ask-points">${res.points.map((p) => `<li>${esc(p.text)}${p.sources.map((s) => ` <button type="button" class="ask-src" data-page="${esc(s)}">${esc(s)}</button>`).join('')}</li>`).join('')}</ul>
      <div class="pz-bar">${btn('add', ICON.plus ?? ICON.tick, 'Add to page', ' pz-keep')}${btn('copy', ICON.copyText ?? ICON.tick, 'Copy', ' ghost')}${btn('again', ICON.retry, 'Retry', ' ghost')}</div>`;
    out.res = { q, points: res.points };
  };
  box.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); ask(); });
  box.addEventListener('click', async (e) => {
    const src = e.target.closest('.ask-src');
    if (src) { app.go('page', src.dataset.page); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') box.close();
    else if (a === 'ask') { e.preventDefault(); ask(); } else if (a === 'again') ask();
    else if (a === 'copy') {
      const r = out.res;
      const text = `${r.q}\n${r.points.map((p) => `- ${p.text}${p.sources.length ? ` (${p.sources.join(', ')})` : ''}`).join('\n')}`;
      try { await navigator.clipboard.writeText(text); app.toast('Copied', 1200); } catch { app.toast('Couldn’t copy.', 2500); }
    } else if (a === 'add') addAnswer(app, outline, name, out.res, box);
  });
  input.focus();
}

/** The question at the end of the page, its points under it, each naming where it came from. */
function addAnswer(app, o, name, r, box) {
  if (o.readonly || o.conflict) { app.toast('This page can’t be changed just now.', 3500); return; }
  if (o.cur !== null && o.cur !== undefined) o.stopEdit();
  const mark = aiSettings().mark;
  const from = (p) => p.sources.filter((s) => s.toLowerCase() !== name.toLowerCase()).map((s) => `[[${s}]]`);
  o.snap();
  // (an empty page's one empty note makes way)
  if (o.blocks.length === 1 && !o.blocks[0].text.trim()) o.blocks.length = 0;
  o.blocks.push({ depth: 0, text: r.q + (mark ? '\nby:: ai' : ''), raw: null });
  for (const p of r.points) o.blocks.push({ depth: 1, text: p.text + (from(p).length ? ` (${from(p).join(', ')})` : ''), raw: null });
  o.cur = null;
  o.ta = null;
  o.render();
  o.markDirty();
  o.undoToast('Added the answer to the page.');
  box.close();
}

// ---------------------------------------------------------------- aliases and a description
export async function suggestAliases(app, head, outline, propsBox, name) {
  const box = panelIn(head);
  box.innerHTML = waitHtml('Reading the page and the notes that link to it…');
  let res;
  try { res = await suggestNames(name); } catch (e) { box.innerHTML = `<p class="err">${esc(said(e))}</p>`; setTimeout(() => box.close(), 6000); return; }
  if (!box.isConnected) return;
  const desc = res.description ? `<div class="sug-group"><h5>Description${res.current ? ' <span class="note small">(replaces the one there)</span>' : ''}</h5><label class="sug-opt"><input type="checkbox" checked data-k="desc"><textarea rows="1" class="sug-desc" aria-label="Description">${esc(res.description)}</textarea></label></div>` : '';
  const al = res.aliases.length ? `<div class="sug-group"><h5>Aliases</h5><div class="sug-chips">${res.aliases.map((a) => `<label class="sug-chip"><input type="checkbox" checked data-alias="${esc(a)}">${esc(a)}</label>`).join('')}</div></div>` : '';
  box.innerHTML = desc + al + `<div class="pz-bar">${btn('add', ICON.plus ?? ICON.tick, 'Add', ' pz-keep')}${btn('again', ICON.retry, 'Retry', ' ghost')}${btn('undo', ICON.undoArrow, 'Undo', ' ghost')}</div>`;
  const count = () => box.querySelectorAll('input:checked').length;
  const label = () => { const n = count(); const b = box.querySelector('[data-a="add"]'); b.querySelector('span').textContent = `Add ${n}`; b.disabled = !n; };
  label();
  box.addEventListener('change', label);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'undo') box.close();
    else if (b.dataset.a === 'again') suggestAliases(app, head, outline, propsBox, name);
    else if (b.dataset.a === 'add') {
      const d = box.querySelector('[data-k="desc"]')?.checked ? box.querySelector('.sug-desc').value.replace(/\s+/g, ' ').trim() : '';
      const aliases = [...box.querySelectorAll('[data-alias]')].filter((x) => x.checked).map((x) => x.dataset.alias);
      if (setPageProps(app, outline, { alias: aliases, description: d })) {
        box.close();
        outline.flush().then(() => app.freshProps(propsBox, outline, null));
      }
    }
  });
}

const PROP_LINE = (key) => new RegExp(`^[ \\t]*${key}::(.*)$`, 'i');
/** text's `key:: …` line set (merge: the values joined with the ones there, each once), or added. */
function withPageProp(text, key, value, merge) {
  const lines = text.split('\n');
  const re = PROP_LINE(key);
  const k = lines.findIndex((l) => re.test(l));
  if (k < 0) return [...lines, `${key}:: ${value}`].join('\n');
  if (merge) {
    const had = lines[k].match(re)[1].split(',').map((x) => x.trim()).filter(Boolean);
    const all = [...had];
    for (const v of value.split(',').map((x) => x.trim())) if (v && !all.some((x) => x.toLowerCase() === v.toLowerCase())) all.push(v);
    value = all.join(', ');
  }
  lines[k] = `${key}:: ${value}`;
  return lines.join('\n');
}
/** Page properties set in the page's own place for them: the lines above its notes, or (Logseq's
 *  way) its first note when that holds only properties. A YAML header is left alone (it says so). */
function setPageProps(app, o, { alias, description }) {
  if (o.readonly || o.conflict) { app.toast('This page can’t be changed just now.', 3500); return false; }
  const pre = (o.doc.preamble || '').replace(/\r\n/g, '\n');
  if (/^---\s*\n/.test(pre)) { app.toast('This page’s properties are in a YAML header (---); add them there by hand.', 6000); return false; }
  const apply = (t) => {
    let x = t;
    if (alias.length) x = withPageProp(x, 'alias', alias.join(', '), true);
    if (description) x = withPageProp(x, 'description', description, false);
    return x;
  };
  if (o.cur !== null && o.cur !== undefined) o.stopEdit();
  o.snap();
  const first = o.blocks[0]?.text ?? '';
  const propsOnly = (t) => t.trim() && t.split('\n').every((l) => /^[ \t]*[\w.-]+::/.test(l));
  if (!pre.trim() && propsOnly(first)) {
    o.blocks[0].text = apply(first);
  } else {
    const lines = pre.replace(/\n+$/, '');
    const next = apply(lines).replace(/^\n+/, '') + '\n\n';
    o.doc.preamble = o.doc.crlf ? next.replace(/\n/g, '\r\n') : next;
  }
  o.cur = null;
  o.ta = null;
  o.render();
  o.markDirty();
  o.undoToast('Added to the page’s properties.');
  return true;
}

// ---------------------------------------------------------------- Suggest links
/** Unlinked references with the AI's verdicts (body: the section's list; name: the page). */
export async function suggestLinksIn(app, body, name) {
  body.innerHTML = waitHtml('Reading the page, the notes that link to it, then each mention…');
  let list;
  try { list = await suggestLinks(name); } catch (e) { body.innerHTML = `<p class="err">${esc(said(e))}</p>`; return; }
  if (!body.isConnected) return;
  const groups = new Map();
  list.forEach((m, k) => { if (!groups.has(m.page)) groups.set(m.page, []); groups.get(m.page).push([m, k]); });
  body.innerHTML = `<div class="ai-links">${[...groups].map(([page, ms]) => `<div class="refgrp"><div class="grp-h">${pageLink(page)}</div>${ms.map(([m, k]) => `<label class="ai-ref${m.link ? '' : ' no'}"><input type="checkbox" data-k="${k}"${m.link ? ' checked' : ''}><span><span class="ai-ref-t">${esc(m.text.split('\n')[0])}</span><span class="note small">${m.link ? '✓' : '✕'} ${esc(m.why)}</span></span></label>`).join('')}</div>`).join('')}</div>
    <div class="pz-bar">${btn('link', ICON.chain ?? ICON.tick, 'Link', ' pz-keep')}${btn('again', ICON.retry, 'Retry', ' ghost')}${btn('undo', ICON.undoArrow, 'Undo', ' ghost')}</div>`;
  const picked = () => [...body.querySelectorAll('input[data-k]:checked')].map((x) => list[+x.dataset.k]);
  const label = () => { const n = picked().length; const b = body.querySelector('[data-a="link"]'); b.querySelector('span').textContent = `Link ${n}`; b.disabled = !n; };
  label();
  body.onchange = label;
  body.onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'undo') { body.innerHTML = ''; body.dispatchEvent(new Event('ai-done', { bubbles: true })); return; }
    if (b.dataset.a === 'again') { suggestLinksIn(app, body, name); return; }
    if (b.dataset.a !== 'link') return;
    b.disabled = true;
    const done = [];
    let missed = 0;
    for (const m of picked()) {
      try {
        const to = await call('mention_linked', { base: m.text, target: name });
        const res = await call('link_mention', { page: m.page, line: m.line, base: m.text, target: name });
        if (res.conflict || !to) missed++;
        else done.push({ ...m, to });
      } catch { missed++; }
    }
    for (const p of new Set(done.map((m) => m.page))) await app.reloadPage(p);
    const undo = async () => {
      let back = 0;
      for (const m of done) {
        try { const r = await call('save_block', { name: m.page, line: m.line, base: m.to, text: m.text }); if (!r.conflict) back++; } catch {}
      }
      for (const p of new Set(done.map((m) => m.page))) await app.reloadPage(p);
      app.toast(back === done.length ? 'Put back as they were.' : `Put back ${back} of ${done.length}; the others changed since.`, 4000);
      app.redrawPage?.(body);
    };
    app.toast(`Linked ${done.length} note${done.length === 1 ? '' : 's'}.${missed ? ` ${missed} changed since, so ${missed === 1 ? 'it was' : 'they were'} left as they were.` : ''}`, 7000, done.length ? { label: 'Undo', run: undo } : null);
    app.redrawPage?.(body);
  };
}

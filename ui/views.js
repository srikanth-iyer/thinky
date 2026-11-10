// List views: All pages (with deleting and the namespace tree), Tags, Properties,
// To-dos and Calendar.

import { call, today, store } from './api.js';
import { renderBlock, datesHtml, esc, whenText, pagesIn, PROP_SHOWS, MARK_COLORS, builtinHidden } from './render.js';
import { h, pageLink, ICON, BRAND, plural } from './dom.js';
import { promptBox } from './popups.js';
import { makeChips } from './chips.js';

const $ = (sel, root = document) => root.querySelector(sel);

/** A row of filter buttons stays on one line; if it's wider than the screen (very large text) it
 *  scrolls sideways, and fades at the edge while more buttons are hidden there. */
export function fitChips(row) {
  const fade = () => row.classList.toggle('fade-end', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
  row.addEventListener('scroll', fade, { passive: true });
  new ResizeObserver(fade).observe(row);
  document.fonts?.ready.then(fade); // the buttons get wider once the font has loaded
}

// ---------------------------------------------------------------------------
// All pages' columns, as Logseq's table: what each sorts by, its first direction, and what the
// two directions are called (for the button's words to screen readers and its tooltip).
const SORTS = {
  name: { label: 'Name', desc: false, says: ['A to Z', 'Z to A'] },
  links: { label: 'Links', desc: true, says: ['fewest first', 'most first'] },
  created: { label: 'Created', desc: true, says: ['oldest first', 'newest first'] },
  changed: { label: 'Changed', desc: true, says: ['oldest first', 'newest first'] },
};
/** A file time (seconds) in few words: "Today 14:05", "Yesterday 09:12", "Oct 12, 2026". */
const shortWhen = (secs) => whenText(secs, { time: false, year: true });
const fullWhen = (secs) => (secs ? new Date(secs * 1000).toLocaleString() : '');

export async function pagesView(app, view) {
  await app.refreshNames();
  const opt = store.get('pagesOpts', { journals: false, ghosts: false, orphans: false, tree: false, sort: 'name' });
  if (!SORTS[opt.sort]) opt.sort = 'name';
  if (typeof opt.desc !== 'boolean') opt.desc = SORTS[opt.sort].desc; // (saved before there were directions)
  view.append(h('h1', 'page-title', 'All pages'));
  const tools = h('div', 'list-tools');
  tools.innerHTML = `<input class="filter" type="search" aria-label="Filter pages">
    <div class="chips" role="group" aria-label="Show">
      <button class="chip" data-o="journals" title="Also list journal days">Journals</button>
      <button class="chip" data-o="ghosts" title="Names that notes link to or tag, but that have no file yet">No file</button>
      <button class="chip" data-o="orphans" title="Only pages that nothing links to">Not linked</button>
      <button class="chip" data-o="tree" title="Only pages in a namespace: Garden/notes under Garden">Namespaces</button>
    </div>
    <div class="btn-row"><button class="btn ghost small" data-a="select">Select pages</button>
      <button class="btn ghost small" data-a="random">${ICON.shuffle}<span>Random page</span></button>
      <span class="sel-tools" hidden><button class="btn small danger" data-a="delete" disabled>Delete</button>
      <button class="btn ghost small" data-a="all">Select all shown</button><button class="btn ghost small" data-a="none">Done</button></span></div>`;
  // the columns' heads: a click sorts by that column, again turns the order round (remembered)
  const cols = h('div', 'pg-cols');
  cols.setAttribute('role', 'group');
  cols.setAttribute('aria-label', 'Sort by');
  cols.innerHTML = Object.entries(SORTS).map(([k, c]) => `<button type="button" class="pg-col c-${k}" data-s="${k}">${c.label}<span class="dir" aria-hidden="true"></span></button>`).join('');
  const ul = h('ul', 'rows pg-rows');
  const table = h('div', 'pg-table');
  table.append(cols, ul);
  view.append(tools, table);
  const input = $('input.filter', tools);
  cols.onclick = (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    if (opt.sort === b.dataset.s) opt.desc = !opt.desc;
    else { opt.sort = b.dataset.s; opt.desc = SORTS[opt.sort].desc; }
    store.set('pagesOpts', opt);
    draw();
  };
  // what each filter turned on does, in a line under them (he asked what No file and Namespaces are;
  // the buttons' tooltips don't show on a phone)
  const SAYS = { journals: 'Journals: journal days too.', ghosts: 'No file: names your notes link to or tag that have no page yet.',
    orphans: 'Not linked: only pages no note links to.', tree: 'Namespaces: groups of two or more pages named like “Garden/notes”, under “Garden”. The arrows fold and unfold them.' };
  const say = h('p', 'note chip-say');
  tools.querySelector('.chips').after(say);
  const sayOn = () => { const on = Object.keys(SAYS).filter((k) => opt[k]); say.textContent = on.map((k) => SAYS[k]).join(' '); say.hidden = !on.length; };
  sayOn();
  tools.querySelectorAll('[data-o]').forEach((el) => {
    el.setAttribute('aria-pressed', String(!!opt[el.dataset.o]));
    el.onclick = () => { opt[el.dataset.o] = !opt[el.dataset.o]; el.setAttribute('aria-pressed', String(opt[el.dataset.o])); store.set('pagesOpts', opt); sayOn(); draw(); };
  });
  fitChips($('.chips', tools));
  let selecting = false;
  const chosen = new Set();
  // the namespaces unfolded in the Namespaces list (small letters; everything else folded)
  const nsOpen = new Set(store.get('nsOpen', []));
  let shown = [];
  let lastClicked = null;

  // the order a column asks for (pages with no file have no times: last, either way; equals keep
  // the A to Z order they came in)
  const order = (v) => {
    const by = { links: (n) => n.refs, created: (n) => n.created, changed: (n) => n.changed }[opt.sort];
    if (!by) return opt.desc ? v.reverse() : v;
    const dir = opt.desc ? -1 : 1;
    return v.sort((a, b) => {
      const x = by(a), y = by(b);
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      return x == null ? 0 : dir * (x - y);
    });
  };
  const list = () => {
    const q = input.value.trim().toLowerCase();
    const v = app.names.filter((n) => (opt.journals || !n.journal) && (opt.ghosts || n.exists) && (!opt.orphans || (n.exists && !n.refs && !n.journal))
      && (!q || n.name.toLowerCase().includes(q)));
    return order(v);
  };
  // ns (the Namespaces list only): { sub: pages under this one, open } → a fold arrow before it, and
  // a parent's name in bold with its count of subpages
  const row = (n, label = n.name, depth = 0, ns = null) => `<li style="--d:${depth}" class="${[chosen.has(n.name) && 'chosen', ns && (ns.sub ? 'ns-parent' : 'ns-sub')].filter(Boolean).join(' ')}">${ns ? (ns.sub
      ? `<button type="button" class="ns-fold" data-ns="${esc(n.name.toLowerCase())}" aria-expanded="${ns.open}" aria-label="${ns.open ? 'Fold' : 'Unfold'} ${esc(n.name)}" title="${ns.open ? 'Hide' : 'Show'} its ${plural(ns.sub, 'page')}"></button>`
      : '<span class="ns-fold-gap" aria-hidden="true"></span>') : ''}
    <a href="#" data-page="${esc(n.name)}"><span class="pg-name${n.exists ? '' : ' ghost'}">${selecting && n.exists ? `<input type="checkbox" tabindex="-1" ${chosen.has(n.name) ? 'checked' : ''}>` : ''}${n.icon ? `<span class="pg-ic" aria-hidden="true">${esc(n.icon)}</span>` : ''}${esc(label)}${ns?.sub ? ` <span class="ns-n">${ns.sub}</span>` : ''}</span>
    <span class="meta c-links">${n.exists ? (n.refs ? plural(n.refs, 'link') : '') : 'no file yet'}</span>
    <span class="meta c-created" title="${n.created ? 'Created ' + esc(fullWhen(n.created)) : ''}">${shortWhen(n.created)}</span>
    <span class="meta c-changed" title="${n.changed ? 'Changed ' + esc(fullWhen(n.changed)) : ''}">${shortWhen(n.changed)}</span></a></li>`;
  const draw = () => {
    shown = list();
    // Namespaces (Build 34, he asked): only pages in one ("a/b" and its parents, "a"), under their
    // parents, each level in the columns' order
    const tree = opt.tree && !input.value.trim();
    const sort = opt.sort, desc = opt.desc;
    table.dataset.sort = sort; // (narrow: only the column it's sorted by shows beside the names)
    for (const b of cols.querySelectorAll('[data-s]')) {
      const k = b.dataset.s, on = k === sort, c = SORTS[k];
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.dir').textContent = on ? (desc ? '↓' : '↑') : '';
      b.title = on ? `Sorted ${c.says[+desc]}; click for ${c.says[+!desc]}` : `Sort by ${c.label.toLowerCase()}, ${c.says[+c.desc]}`;
      b.setAttribute('aria-label', on ? `${c.label}, sorted ${c.says[+desc]}` : `Sort by ${c.label.toLowerCase()}`);
    }
    const files = app.names.filter((n) => n.exists && !n.journal).length;
    input.placeholder = `Filter ${files} pages`;
    if (tree) {
      // "a/b/c" sits under "a/b", under "a"; a parent with no page of its own is shown greyed
      const byName = new Map(shown.map((n) => [n.name.toLowerCase(), n]));
      const kids = new Map([['', []]]); // a parent's name (small letters) → its children
      const add = (name) => {
        const key = name.toLowerCase();
        if (kids.has(key)) return;
        kids.set(key, []);
        const cut = name.lastIndexOf('/');
        const parent = cut < 0 ? '' : name.slice(0, cut);
        if (parent) add(parent);
        kids.get(parent.toLowerCase()).push(byName.get(key) || { name, exists: false, refs: 0 });
      };
      for (const n of shown) if (n.name.includes('/')) add(n.name);
      // Build 36 (he asked, Nov 4): a namespace only when it holds more than one page under it
      // ("a" with only "a/b" isn't one); each parent folds (its subpages hidden, remembered, folded
      // at first so the list is short), and parents stand out from their subpages
      const under = (key) => kids.get(key).reduce((s, c) => s + 1 + under(c.name.toLowerCase()), 0);
      kids.set('', kids.get('').filter((n) => under(n.name.toLowerCase()) > 1));
      const rows = [];
      const walk = (key, depth) => {
        for (const n of order(kids.get(key).sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase())))) {
          const k = n.name.toLowerCase(), sub = under(k), open = sub > 0 && nsOpen.has(k);
          rows.push(row(n, n.name.slice(n.name.lastIndexOf('/') + 1), depth, { sub, open }));
          if (open) walk(k, depth + 1);
        }
      };
      walk('', 0);
      // the pages that show (Select all shown takes these); the namespaces' own lists live in kids
      const seen = new Set();
      const mark = (key) => { for (const c of kids.get(key)) { const k = c.name.toLowerCase(); seen.add(k); if (nsOpen.has(k)) mark(k); } };
      mark('');
      shown = shown.filter((n) => seen.has(n.name.toLowerCase()));
      ul.className = 'rows pg-rows tree-rows';
      ul.innerHTML = rows.join('') || BRAND.empty('No namespaces yet: two pages named like “Garden/notes” and “Garden/ideas” make one.', 'li');
    } else {
      ul.className = 'rows pg-rows';
      ul.innerHTML = shown.map((n) => row(n)).join('') || BRAND.empty('No pages match.', 'li');
    }
    $('[data-a="delete"]', tools).disabled = !chosen.size;
    $('[data-a="delete"]', tools).textContent = chosen.size ? `Delete ${plural(chosen.size, 'page')}` : 'Delete';
  };
  const setSelecting = (on) => {
    selecting = on;
    chosen.clear();
    $('.sel-tools', tools).hidden = !on;
    for (const el of tools.querySelectorAll('[data-a="select"], [data-a="random"]')) el.hidden = on;
    draw();
  };
  tools.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'select') setSelecting(true);
    if (a === 'none') setSelecting(false);
    if (a === 'random') app.randomPage();
    if (a === 'all') { shown.filter((n) => n.exists).forEach((n) => chosen.add(n.name)); draw(); }
    if (a === 'delete' && chosen.size) {
      if (await app.deletePages([...chosen])) setSelecting(false);
      else draw();
    }
  };
  ul.addEventListener('click', (e) => {
    const f = e.target.closest('.ns-fold');
    if (f) {
      const k = f.dataset.ns;
      if (nsOpen.has(k)) nsOpen.delete(k); else nsOpen.add(k);
      store.set('nsOpen', [...nsOpen]);
      draw();
      ul.querySelector(`.ns-fold[data-ns="${CSS.escape(k)}"]`)?.focus(); // (the keyboard stays on it)
      return;
    }
    const a = e.target.closest('a[data-page]');
    if (!a) return;
    e.preventDefault();
    if (!selecting) { app.go('page', a.dataset.page); return; }
    const name = a.dataset.page;
    const n = app.names.find((x) => x.name === name);
    if (!n?.exists) return;
    if (e.shiftKey && lastClicked) {
      const names = shown.filter((x) => x.exists).map((x) => x.name);
      const [i, j] = [names.indexOf(lastClicked), names.indexOf(name)].sort((x, y) => x - y);
      if (i >= 0 && j >= 0) names.slice(i, j + 1).forEach((x) => chosen.add(x));
    } else if (chosen.has(name)) chosen.delete(name);
    else chosen.add(name);
    lastClicked = name;
    draw();
  });
  let t;
  input.oninput = () => { clearTimeout(t); t = setTimeout(draw, 80); };
  draw();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

// ---------------------------------------------------------------------------
export async function tagsView(app, view) {
  view.append(h('h1', 'page-title', 'Tags'));
  view.append(h('p', 'note', 'Tags from pages’ <code>tags::</code> property, and <code>#tags</code> written in notes.'));
  const tags = await call('tags');
  // Build 43 (he asked, Nov 10): a filter box and A to Z / Most used, as the Properties list has
  // ("most used" = pages with tags:: + notes with #name); the order is remembered like Properties'
  const opt = store.get('tagsOpts', { sort: 'name' });
  const tools = h('div', 'list-tools');
  tools.innerHTML = `<input class="filter" type="search" placeholder="Filter tags" aria-label="Filter tags">
    <div class="chips" role="group" aria-label="Sort">${[['name', 'A to Z', 'By name'], ['count', 'Most used', 'The most used first']].map(([k, l, tt]) => `<button class="chip" data-s="${k}" title="${tt}" aria-pressed="${opt.sort === k}">${l}</button>`).join('')}</div>`;
  const ul = h('ul', 'rows');
  view.append(tools, ul);
  const input = $('input', tools);
  // [name, pages with tags::, notes with #name] (Build 33: the #tags too, he asked)
  const says = (p, n) => [p && plural(p, 'page'), n && plural(n, 'note')].filter(Boolean).join(' · ');
  const used = ([, p, n]) => (p || 0) + (n || 0);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const list = tags.filter(([t]) => !q || t.toLowerCase().includes(q));
    list.sort(opt.sort === 'count' ? (a, b) => used(b) - used(a) || a[0].localeCompare(b[0]) : (a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base', numeric: true }));
    ul.innerHTML = list.map(([t, p, n]) => `<li><a href="#" data-page="${esc(t)}">${esc(t)}<span class="meta">${says(p, n || 0)}</span></a></li>`).join('')
      || BRAND.empty(tags.length ? 'No tags match.' : 'No tags yet.', 'li');
  };
  input.oninput = draw;
  tools.onclick = (e) => {
    const c = e.target.closest('[data-s]');
    if (!c) return;
    opt.sort = c.dataset.s; store.set('tagsOpts', opt);
    tools.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', b === c));
    draw();
  };
  ul.addEventListener('click', (e) => app.linkClick(e));
  draw();
}

// ---------------------------------------------------------------------------
export async function propsView(app, view, key) {
  if (!key) {
    // he asked (Oct 30): sort, filter and search. The box filters the property names as he types and,
    // from two letters on, also finds notes whose values have those words (any property).
    view.append(h('h1', 'page-title', 'Properties'));
    const keys = await call('props');
    const opt = store.get('propsOpts', { sort: 'name' });
    const tools = h('div', 'list-tools');
    tools.innerHTML = `<input class="filter" type="search" placeholder="Filter names, or search values" aria-label="Filter property names or search their values">
      <div class="chips" role="group" aria-label="Sort">${[['name', 'A to Z', 'By name'], ['count', 'Most used', 'The most used first']].map(([k, l, tt]) => `<button class="chip" data-s="${k}" title="${tt}" aria-pressed="${opt.sort === k}">${l}</button>`).join('')}</div>`;
    const ul = h('ul', 'rows');
    const found = h('div', 'prop-found');
    view.append(tools, ul, found);
    const input = $('input', tools);
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const list = keys.filter(([k]) => !q || k.toLowerCase().includes(q));
      list.sort(opt.sort === 'count' ? (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]) : (a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base', numeric: true }));
      ul.innerHTML = list.map(([k, n]) => `<li><a href="#/props/${encodeURIComponent(k)}">${esc(k)}<span class="meta">${n}</span></a></li>`).join('')
        || (q.length >= 2 ? '' : BRAND.empty(keys.length ? 'No property names match.' : 'No properties yet.', 'li')); // (from two letters the values below speak)
      ul.hidden = !ul.children.length;
    };
    let timer, seq = 0;
    const search = async () => {
      const q = input.value.trim(), mine = ++seq;
      if (q.length < 2) { found.replaceChildren(); return; }
      const groups = await call('with_property', { key: '', value: q });
      if (mine !== seq || !view.isConnected) return;
      const n = groups.reduce((s, g) => s + g.hits.length, 0);
      const head = h('h2', 'sec-h', `Values with “${esc(q)}” <span class="n">${n}</span>`);
      found.replaceChildren(head, n ? app.groupsEl(groups) : h('p', 'note', ul.hidden ? 'No property names or values have these words.' : 'No property values have these words.'));
    };
    input.oninput = () => { draw(); clearTimeout(timer); timer = setTimeout(search, 250); };
    tools.onclick = (e) => {
      const c = e.target.closest('[data-s]');
      if (!c) return;
      opt.sort = c.dataset.s; store.set('propsOpts', opt);
      tools.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', b === c));
      draw();
    };
    found.addEventListener('click', (e) => app.linkClick(e));
    draw();
    return;
  }
  view.append(h('h1', 'page-title', esc(key)));
  // Build 36 (he asked: author and authors as one): rename it in every note; a name already used
  // merges the two (core app.rs rename_property)
  const tools = h('div', 'btn-row');
  tools.innerHTML = '<button class="btn ghost small" data-a="rename">Rename or merge…</button>';
  view.append(tools, propShowRow(app, key.toLowerCase()));
  tools.onclick = async (e) => {
    if (!e.target.closest('[data-a="rename"]')) return;
    const keys = (await call('props').catch(() => [])).map(([k]) => k).filter((k) => k !== key.toLowerCase());
    const like = keys.filter((k) => k.startsWith(key.toLowerCase().slice(0, 4)) || key.toLowerCase().startsWith(k.slice(0, 4))).slice(0, 3);
    const to = (await promptBox({ title: `Rename “${key}” in every note`,
      body: `Type the name to use instead. If it's a name already used${like.length ? ` (such as ${like.map((k) => `<code>${esc(k)}</code>`).join(', ')})` : ''}, the two become one: a note with both keeps one line with both values.`,
      value: like[0] || key, ok: 'Rename' }))?.trim();
    if (!to || to.toLowerCase() === key.toLowerCase()) return;
    let r;
    try { r = await call('rename_property', { key, new_key: to }); } catch (err) { app.toast(String(err), 7000); return; }
    for (const o of [...app.outlines]) await o.reload?.().catch(() => {}); // (pages open elsewhere show the new name)
    app.toast(`Renamed in ${plural(r.files_changed, 'file')} (${plural(r.lines, 'line')})${r.skipped.length ? `; ${plural(r.skipped.length, 'file')} couldn’t be changed: ${r.skipped.join(', ')}` : ''}`, r.skipped.length ? 9000 : 3200);
    app.go('props', to.toLowerCase());
  };
  const input = h('input', 'filter');
  input.type = 'search';
  input.placeholder = `Only where ${key} contains…`;
  const out = h('div');
  view.append(input, out);
  const draw = async () => {
    const groups = await call('with_property', { key, value: input.value.trim() });
    const n = groups.reduce((s, g) => s + g.hits.length, 0);
    out.replaceChildren(h('p', 'note', `${plural(n, 'match', 'matches')} in ${plural(groups.length, 'page')}`), app.groupsEl(groups));
  };
  let t;
  input.oninput = () => { clearTimeout(t); t = setTimeout(draw, 200); };
  view.addEventListener('click', (e) => app.linkClick(e));
  await draw();
}

// ---------------------------------------------------------------------------
const SHOW_SAY = { show: 'Show', quiet: 'Quiet', icon: 'Icon', hidden: 'Hidden' };
/** How this property shows on notes (Build 43, he asked Nov 10: on its own page too, not only in
 *  Settings → Writing → Property display). The same saved rule (logseq/thinky.json "propertyDisplay"),
 *  so a change in either place is the other's too; read fresh before each save. */
function propShowRow(app, key) {
  const row = h('div', 'prop-show-row');
  if (builtinHidden(key)) {
    row.innerHTML = `<p class="note small"><code>${esc(key)}::</code> is one the app always hides (Logseq keeps it for itself).</p>`;
    return row;
  }
  const cap = (c) => c[0].toUpperCase() + c.slice(1);
  const draw = () => {
    const x = app.folderSettings?.propertyDisplay?.[key] || {};
    const show = PROP_SHOWS.includes(x.show) ? x.show : 'show';
    row.innerHTML = `<span class="psr-l">Shows on notes as</span>
      <select class="pr-show" aria-label="How ${esc(key)} shows">${PROP_SHOWS.map((v) => `<option value="${v}"${v === show ? ' selected' : ''}>${SHOW_SAY[v]}</option>`).join('')}</select>
      <input class="pr-icon" value="${esc(x.icon || '●')}" maxlength="2" aria-label="The icon for ${esc(key)}" title="The icon (a character or emoji)"${show === 'icon' ? '' : ' hidden'}>
      <select class="pr-mark" aria-label="A mark on notes with ${esc(key)}"><option value="">No mark</option>${MARK_COLORS.map((c) => `<option value="${c}"${c === x.mark ? ' selected' : ''}>${cap(c)} mark</option>`).join('')}</select>
      <a class="psr-more small" href="#/settings/writing" title="Every property’s rule, with examples">All properties…</a>`;
  };
  row.addEventListener('change', async () => {
    const r = { ...(app.folderSettings?.propertyDisplay || {}) };
    const rule = { show: $('.pr-show', row).value, icon: $('.pr-icon', row).value.trim() || '●', mark: $('.pr-mark', row).value };
    if (rule.show === 'show' && !rule.mark) delete r[key]; else r[key] = rule; // (as usual = no rule)
    try { await app.setFolderSetting('propertyDisplay', Object.keys(r).length ? r : null); } catch (err) { app.toast(String(err), 6000); }
    draw();
  });
  draw();
  return row;
}

// ---------------------------------------------------------------------------
/** Day number of a [y, m, d] date (for comparing dates). */
export const num = ([y, m, d]) => Math.round(new Date(y, m - 1, d) / 864e5);
const GROUPS = { DOING: 'doing', NOW: 'doing', 'IN-PROGRESS': 'doing', STARTED: 'doing', TODO: 'todo', LATER: 'todo', WAITING: 'todo', WAIT: 'todo', DONE: 'done', CANCELED: 'canceled', CANCELLED: 'canceled' };
/** Finished: done or cancelled. */
const closed = (x) => ['done', 'canceled'].includes(GROUPS[x.marker]);
/** The earliest of a to-do's scheduled and deadline days (Infinity without either). */
export const taskDay = (x) => Math.min(...[x.scheduled, x.deadline].filter(Boolean).map((w) => num(w.date)));
const prioRank = (x) => ({ A: 0, B: 1, C: 2 }[x.priority] ?? 1);
/** To-dos by day (the earlier of scheduled and deadline), then priority A, B (or none), C. */
export const byDay = (a, b) => (taskDay(a) - taskDay(b)) || (prioRank(a) - prioRank(b));

/** One to-do as a row: tick box, marker, text, dates, and the page it's on. */
export function taskRow(x) {
  const r = renderBlock(x.text);
  const open = !closed(x);
  const label = !['TODO', 'DONE'].includes(x.marker) ? `<span class="mk">${esc(x.marker)}</span>` : '';
  const prio = x.priority ? `<span class="prio p${x.priority}">${x.priority}</span>` : '';
  return `<div class="todo-item${open ? '' : ' marker-done'}" data-page="${esc(x.page)}" data-line="${x.line}">
    <input type="checkbox" class="todo" ${open ? '' : 'checked'} aria-label="Done">
    <div class="bc">${label}${prio}${r.html}${datesHtml(r.dates, open)}<div class="where">${pageLink(x.page)}${x.under?.length ? ` <span class="under" title="Linked by the notes it sits under">· under ${x.under.map((n) => pageLink(n)).join(', ')}</span>` : ''}</div></div></div>`;
}

/** Clicks in a list of taskRow()s: the box ticks the to-do off (or back on) in its file, anything
 *  else opens it where it's written. tasks(): the to-dos shown; reload(): after a change. */
export function taskClicks(app, list, tasks, reload) {
  list.addEventListener('click', async (e) => {
    const it = e.target.closest('.todo-item');
    if (!it) return;
    const a = e.target.closest('a');
    if (a) { e.preventDefault(); if (a.dataset.page) app.go('page', a.dataset.page); else if (a.getAttribute('href') && a.getAttribute('href') !== '#') app.openUrl(a.getAttribute('href')); return; }
    const x = tasks().find((t) => t.page === it.dataset.page && String(t.line) === it.dataset.line);
    if (!x) return;
    if (e.target.classList.contains('todo')) {
      e.preventDefault();
      const open = !closed(x);
      const text = open ? await call('task_done', { text: x.text, today: today() }) : x.text.replace(/^(DONE|CANCELED|CANCELLED)/, app.workflow() === 'now' ? 'LATER' : 'TODO');
      try {
        const res = await call('save_block', { name: x.page, line: x.line, base: x.text, text });
        if (!res.ok) { app.toast('That to-do changed somewhere else; refreshed the list.'); await reload(); return; }
        if (/^(TODO|LATER) /.test(text) && open) app.toast('Repeating to-do: moved to its next date', 2200);
        app.widgetTasksSoon?.();
        await app.reloadPage?.(x.page); // the same page open below (Journals) shows the tick too
        await reload();
      } catch (err) { app.toast(String(err)); }
      return;
    }
    app.go('page', x.page, { line: x.line });
  });
}

// The to-do list's orders (Build 34, he asked: newest first by default, the other way round too, and by date)
const TODO_ORDERS = [['recent', 'Newest', 'Pages changed most recently first'], ['oldest', 'Oldest', 'Pages changed longest ago first'], ['due', 'By date', 'Overdue, today, the next days, later, no date']];

export async function todosView(app, view) {
  const opt = store.get('todoOpts', { kind: 'all' });
  if (!['all', 'todo', 'doing', 'done', 'canceled'].includes(opt.kind)) opt.kind = 'all'; // (Waiting and the Done add-on went, Build 33)
  if (!TODO_ORDERS.some(([k]) => k === opt.sort)) opt.sort = 'recent'; // (Build 34: newest first unless he picks another)
  view.append(h('h1', 'page-title', 'To-dos'));
  const tools = h('div', 'list-tools');
  // one filter at a time (he asked: Done shows only finished ones); the words of his own workflow
  // (config.edn: NOW/LATER or DOING/TODO); To do also takes WAITING ones
  const now = app.workflow() === 'now';
  const kinds = [['all', 'Open', 'Every open to-do'], ['todo', now ? 'Later' : 'To do', now ? 'LATER, TODO and WAITING' : 'TODO, LATER and WAITING'], ['doing', now ? 'Now' : 'Doing', 'NOW and DOING'], ['done', 'Done', 'Finished to-dos'], ['canceled', 'Cancelled', 'Cancelled to-dos']];
  // Build 37 (he asked, Nov 5–6): the order on the right of the Show row, as one joined group with a ⇅
  // mark (it sorts; the left ones filter); the page buttons behind a filter button (as Linked
  // references), with a box to find a button; closing it lets every pick go (he chose this)
  tools.innerHTML = `<input class="filter" type="search" placeholder="Filter to-dos" aria-label="Filter to-dos">
    <div class="todo-bar">
      <div class="chips todo-kinds" role="group" aria-label="Show">${kinds.map(([k, l, t]) => `<button class="chip" data-k="${k}" title="${t}" aria-pressed="${opt.kind === k}">${l}</button>`).join('')}</div>
      <div class="todo-acts">
        <div class="seg todo-order" role="group" aria-label="Order"><span class="seg-ic" aria-hidden="true" title="Order">⇅</span>${TODO_ORDERS.map(([k, l, t]) => `<button class="chip" data-sort="${k}" title="${t}" aria-pressed="${opt.sort === k}">${l}</button>`).join('')}</div>
        <button type="button" class="ref-tbtn todo-f" aria-expanded="false" aria-controls="todo-panel">${ICON.filter}</button>
      </div>
    </div>
    <div class="todo-panel" id="todo-panel" hidden><label class="chip-find">${ICON.search}<input type="search" class="chip-find-in" placeholder="Find a page" aria-label="Find a page button" autocomplete="off" spellcheck="false"></label>
      <div class="ref-chips todo-chips" role="group" aria-label="Pages these to-dos are on or mention"></div></div>`;
  const out = h('div', 'todos');
  view.append(tools, out);
  const input = $('input.filter', tools);
  const chipsEl = $('.todo-chips', tools), panel = $('.todo-panel', tools), fbtn = $('.todo-f', tools), findIn = $('.chip-find-in', tools);
  let tasks = [];
  // the pages each to-do is on, links to, or sits under (a parent note's link)
  const namesOf = new Map(); // a to-do → its page names (small letters)
  const names = (x) => {
    if (!namesOf.has(x)) namesOf.set(x, new Set([x.page, ...pagesIn(x.text), ...(x.under || [])].map((n) => n.toLowerCase())));
    return namesOf.get(x);
  };
  const ofKind = (x) => (opt.kind === 'all' ? !closed(x) : GROUPS[x.marker] === opt.kind);
  const typed = (x, q) => !q || x.text.toLowerCase().includes(q) || x.page.toLowerCase().includes(q) || (x.under || []).some((n) => n.toLowerCase().includes(q));
  let counts = new Map(), written = new Map();
  // the buttons count the to-dos shown by Show and the words typed (so typing narrows the buttons too)
  const countChips = () => {
    counts = new Map(); written = new Map();
    const q = input.value.trim().toLowerCase();
    for (const x of tasks.filter((t) => ofKind(t) && typed(t, q))) {
      for (const n of names(x)) counts.set(n, (counts.get(n) || 0) + 1);
      for (const n of [x.page, ...pagesIn(x.text), ...(x.under || [])]) if (!written.has(n.toLowerCase())) written.set(n.toLowerCase(), n);
    }
  };
  const chips = makeChips({ el: chipsEl, counts: () => counts, written: () => written, onChange: () => draw(), label: 'pages' });
  const paintPanel = () => {
    const open = !!opt.panel;
    panel.hidden = !open;
    fbtn.setAttribute('aria-expanded', String(open));
    const n = chips.picks.size, t = open ? 'Hide the page buttons (and let their picks go)' : 'Filter by page';
    fbtn.title = t; fbtn.setAttribute('aria-label', t);
    fbtn.dataset.on = n ? 'true' : 'false';
    if (open) chips.draw();
  };
  fbtn.onclick = () => {
    opt.panel = !opt.panel; store.set('todoOpts', opt);
    if (!opt.panel) { findIn.value = ''; chips.clear(); draw(); }
    paintPanel();
    if (opt.panel) findIn.focus({ preventScroll: true });
  };
  findIn.oninput = () => chips.find(findIn.value.trim());
  const load = async () => { tasks = await call('tasks', { done: ['done', 'canceled'].includes(opt.kind) }); namesOf.clear(); countChips(); paintPanel(); draw(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const t = num(today());
    const list = tasks.filter((x) => ofKind(x) && typed(x, q) && chips.passes(names(x)));
    let groups;
    if (opt.sort === 'due') {
      const ahead = app.summary?.config?.future_days ?? 7; // (config.edn :scheduled/future-days, as today's box)
      groups = [['Overdue', []], ['Today', []], [ahead === 1 ? 'Tomorrow' : `Next ${ahead} days`, []], ['Later', []], ['No date', []], [opt.kind === 'canceled' ? 'Cancelled' : 'Done', []]];
      for (const x of list) {
        const w = taskDay(x);
        const g = closed(x) ? 5 : !Number.isFinite(w) ? 4 : w < t ? 0 : w === t ? 1 : w <= t + ahead ? 2 : 3;
        groups[g][1].push(x);
      }
      for (const [, g] of groups) g.sort(byDay);
    } else {
      // by when its page last changed (the file's time: a to-do has no time of its own), newest or
      // oldest first; on one page, in the page's order
      const dir = opt.sort === 'oldest' ? 1 : -1;
      const at = (x) => x.changed ?? 0;
      const sorted = list.slice().sort((a, b) => dir * (at(a) - at(b)) || a.page.localeCompare(b.page) || a.line - b.line);
      groups = [[opt.sort === 'oldest' ? 'Oldest first' : 'Newest first', sorted]];
    }
    const filtering = q || chips.picks.size;
    fbtn.dataset.on = chips.picks.size ? 'true' : 'false';
    out.innerHTML = groups.filter(([, g]) => g.length).map(([name, g]) => `<section class="sec"><h2 class="sec-h">${name} <span class="n">${g.length}</span></h2>
      ${g.map((x) => taskRow(x)).join('')}</section>`).join('')
      || BRAND.empty(filtering && tasks.length ? 'Nothing matches.' : { done: 'No finished to-dos.', canceled: 'No cancelled to-dos.' }[opt.kind] || 'No open to-dos here. Start a block with TODO (or press Ctrl+Enter) to make one.');
  };
  tools.onclick = (e) => {
    const o = e.target.closest('[data-sort]');
    if (o) {
      if (o.dataset.sort === opt.sort) return;
      opt.sort = o.dataset.sort; store.set('todoOpts', opt);
      tools.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', b === o));
      draw();
      return;
    }
    if (e.target.closest('.todo-panel')) return; // (the buttons look after themselves: chips.js)
    const c = e.target.closest('[data-k]');
    if (!c || c.dataset.k === opt.kind) return;
    const was = ['done', 'canceled'].includes(opt.kind);
    opt.kind = c.dataset.k; store.set('todoOpts', opt);
    tools.querySelectorAll('[data-k]').forEach((b) => b.setAttribute('aria-pressed', b === c));
    if (was !== ['done', 'canceled'].includes(opt.kind)) load(); else { countChips(); chips.draw(); draw(); }
  };
  tools.querySelectorAll('.todo-kinds').forEach(fitChips);
  input.oninput = () => { countChips(); chips.draw(); draw(); };
  taskClicks(app, out, () => tasks, load);
  await load();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

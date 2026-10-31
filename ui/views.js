// List views: All pages (with deleting and the namespace tree), Tags, Properties,
// To-dos and Calendar.

import { call, today, store } from './api.js';
import { renderBlock, datesHtml, esc, whenText, pagesIn } from './render.js';
import { h, pageLink, ICON, BRAND, plural } from './dom.js';

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
    orphans: 'Not linked: only pages no note links to.', tree: 'Namespaces: only pages in a namespace, “Garden/notes” under “Garden”.' };
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
  const row = (n, label = n.name, depth = 0) => `<li style="--d:${depth}"${chosen.has(n.name) ? ' class="chosen"' : ''}>
    <a href="#" data-page="${esc(n.name)}"><span class="pg-name${n.exists ? '' : ' ghost'}">${selecting && n.exists ? `<input type="checkbox" tabindex="-1" ${chosen.has(n.name) ? 'checked' : ''}>` : ''}${n.icon ? `<span class="pg-ic" aria-hidden="true">${esc(n.icon)}</span>` : ''}${esc(label)}</span>
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
      const rows = [];
      const walk = (key, depth) => {
        for (const n of order(kids.get(key).sort((x, y) => x.name.toLowerCase().localeCompare(y.name.toLowerCase())))) {
          rows.push(row(n, n.name.slice(n.name.lastIndexOf('/') + 1), depth));
          walk(n.name.toLowerCase(), depth + 1);
        }
      };
      walk('', 0);
      shown = rows.length ? shown.filter((n) => kids.has(n.name.toLowerCase())) : [];
      ul.className = 'rows pg-rows tree-rows';
      ul.innerHTML = rows.join('') || BRAND.empty('No namespaces yet: a page named like “Garden/notes” makes one.', 'li');
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
  const ul = h('ul', 'rows');
  // [name, pages with tags::, notes with #name] (Build 33: the #tags too, he asked)
  const says = (p, n) => [p && plural(p, 'page'), n && plural(n, 'note')].filter(Boolean).join(' · ');
  ul.innerHTML = tags.map(([t, p, n]) => `<li><a href="#" data-page="${esc(t)}">${esc(t)}<span class="meta">${says(p, n || 0)}</span></a></li>`).join('')
    || BRAND.empty('No tags yet.', 'li');
  ul.addEventListener('click', (e) => app.linkClick(e));
  view.append(ul);
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
    <div class="bc">${label}${prio}${r.html}${datesHtml(r.dates, open)}<div class="where">${pageLink(x.page)}</div></div></div>`;
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
  tools.innerHTML = `<input class="filter" type="search" placeholder="Filter to-dos" aria-label="Filter to-dos">
    <div class="chips" role="group" aria-label="Show">${kinds.map(([k, l, t]) => `<button class="chip" data-k="${k}" title="${t}" aria-pressed="${opt.kind === k}">${l}</button>`).join('')}</div>
    <div class="chips todo-order" role="group" aria-label="Order">${TODO_ORDERS.map(([k, l, t]) => `<button class="chip" data-sort="${k}" title="${t}" aria-pressed="${opt.sort === k}">${l}</button>`).join('')}</div>
    <div class="ref-chips todo-chips" role="group" aria-label="Pages these to-dos are on or mention"></div>`;
  const out = h('div', 'todos');
  view.append(tools, out);
  const input = $('input', tools);
  const chipsEl = $('.todo-chips', tools);
  let tasks = [];
  // Filter buttons (Build 34, he asked, as the references' ones): the pages each to-do is on or links
  // to, most used first. A click shows only those, a second hides those, a third lets it go.
  const picks = new Map(); // small letters → 'in' | 'out'
  const namesOf = new Map(); // a to-do → its page names (small letters)
  const names = (x) => {
    if (!namesOf.has(x)) namesOf.set(x, new Set([x.page, ...pagesIn(x.text)].map((n) => n.toLowerCase())));
    return namesOf.get(x);
  };
  const ofKind = (x) => (opt.kind === 'all' ? !closed(x) : GROUPS[x.marker] === opt.kind);
  let counts = new Map(), written = new Map(), more = false;
  const countChips = () => {
    counts = new Map(); written = new Map();
    for (const x of tasks.filter(ofKind)) {
      for (const n of names(x)) counts.set(n, (counts.get(n) || 0) + 1);
      for (const n of [x.page, ...pagesIn(x.text)]) if (!written.has(n.toLowerCase())) written.set(n.toLowerCase(), n);
    }
    for (const n of [...picks.keys()]) if (!counts.has(n)) picks.delete(n);
  };
  const CHIPS = 24;
  const drawChips = () => {
    const all = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
    const list = more ? all : all.slice(0, CHIPS);
    chipsEl.innerHTML = list.map((n) => {
      const p = picks.get(n), say = p === 'in' ? 'Only these; click to hide them instead' : p === 'out' ? 'Hidden; click to stop filtering by it' : 'Click to show only these';
      return `<button type="button" class="chip ref-chip" data-n="${esc(n)}"${p ? ` data-pick="${p}"` : ''} aria-pressed="${p ? 'true' : 'false'}" title="${esc(say)}">${p === 'out' ? '<s>' : ''}${esc(written.get(n) || n)}${p === 'out' ? '</s>' : ''} <span class="n">${counts.get(n)}</span></button>`;
    }).join('') + (!more && all.length > CHIPS ? `<button type="button" class="chip ref-more">${all.length - CHIPS} more</button>` : '');
    chipsEl.hidden = all.length < 2; // (one page only: nothing to choose between)
  };
  const load = async () => { tasks = await call('tasks', { done: ['done', 'canceled'].includes(opt.kind) }); namesOf.clear(); countChips(); drawChips(); draw(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const t = num(today());
    const ins = [...picks].filter(([, p]) => p === 'in').map(([n]) => n), outs = [...picks].filter(([, p]) => p === 'out').map(([n]) => n);
    const list = tasks.filter((x) => ofKind(x)
      && (!q || x.text.toLowerCase().includes(q) || x.page.toLowerCase().includes(q))
      && ins.every((n) => names(x).has(n)) && !outs.some((n) => names(x).has(n)));
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
    const filtering = q || picks.size;
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
    if (e.target.closest('.ref-more')) { more = true; drawChips(); return; }
    const r = e.target.closest('.ref-chip');
    if (r) {
      const n = r.dataset.n, p = picks.get(n);
      if (!p) picks.set(n, 'in'); else if (p === 'in') picks.set(n, 'out'); else picks.delete(n);
      drawChips(); draw();
      return;
    }
    const c = e.target.closest('[data-k]');
    if (!c || c.dataset.k === opt.kind) return;
    const was = ['done', 'canceled'].includes(opt.kind);
    opt.kind = c.dataset.k; store.set('todoOpts', opt);
    tools.querySelectorAll('[data-k]').forEach((b) => b.setAttribute('aria-pressed', b === c));
    if (was !== ['done', 'canceled'].includes(opt.kind)) load(); else { countChips(); drawChips(); draw(); }
  };
  tools.querySelectorAll('.chips').forEach(fitChips);
  input.oninput = draw;
  taskClicks(app, out, () => tasks, load);
  await load();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

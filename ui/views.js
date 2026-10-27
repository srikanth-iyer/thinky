// List views: All pages (with deleting and the namespace tree), Tags, Properties,
// To-dos and Calendar.

import { call, today, store } from './api.js';
import { renderBlock, datesHtml, esc } from './render.js';
import { h, pageLink, ICON } from './dom.js';

const $ = (sel, root = document) => root.querySelector(sel);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A file time (seconds) in few words: "Today 14:05", "Yesterday 09:12", "Oct 12, 2026". */
export function shortWhen(secs, now = new Date()) {
  if (!secs) return '';
  const d = new Date(secs * 1000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const yday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Today ${hm}`;
  if (d.toDateString() === yday.toDateString()) return `Yesterday ${hm}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
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
      <button class="chip" data-o="tree" title="Pages like Garden/notes under Garden">Namespaces</button>
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
  tools.querySelectorAll('[data-o]').forEach((el) => {
    el.setAttribute('aria-pressed', String(!!opt[el.dataset.o]));
    el.onclick = () => { opt[el.dataset.o] = !opt[el.dataset.o]; el.setAttribute('aria-pressed', String(opt[el.dataset.o])); store.set('pagesOpts', opt); draw(); };
  });
  fitChips($('.chips', tools));
  let selecting = false;
  const chosen = new Set();
  let shown = [];
  let lastClicked = null;

  const list = () => {
    const q = input.value.trim().toLowerCase();
    let v = app.names.filter((n) => (opt.journals || !n.journal) && (opt.ghosts || n.exists) && (!opt.orphans || (n.exists && !n.refs && !n.journal))
      && (!q || n.name.toLowerCase().includes(q)));
    // the list comes A to Z, and sorting keeps that order among equals; pages with no file have no
    // times: last, either way
    const by = { links: (n) => n.refs, created: (n) => n.created, changed: (n) => n.changed }[opt.sort];
    if (!by) return opt.desc ? v.reverse() : v;
    const dir = opt.desc ? -1 : 1;
    return v.sort((a, b) => {
      const x = by(a), y = by(b);
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      return x == null ? 0 : dir * (x - y);
    });
  };
  const row = (n, label = n.name, depth = 0) => `<li style="--d:${depth}"${chosen.has(n.name) ? ' class="chosen"' : ''}>
    <a href="#" data-page="${esc(n.name)}"><span class="pg-name${n.exists ? '' : ' ghost'}">${selecting && n.exists ? `<input type="checkbox" tabindex="-1" ${chosen.has(n.name) ? 'checked' : ''}>` : ''}${n.icon ? `<span class="pg-ic" aria-hidden="true">${esc(n.icon)}</span>` : ''}${esc(label)}</span>
    <span class="meta c-links">${n.exists ? (n.refs ? plural(n.refs, 'link') : '') : 'no file yet'}</span>
    <span class="meta c-created" title="${n.created ? 'Created ' + esc(fullWhen(n.created)) : ''}">${shortWhen(n.created)}</span>
    <span class="meta c-changed" title="${n.changed ? 'Changed ' + esc(fullWhen(n.changed)) : ''}">${shortWhen(n.changed)}</span></a></li>`;
  const draw = () => {
    shown = list();
    // (Namespaces: pages under their parents, A to Z; the sorting waits until that's off)
    const tree = opt.tree && !input.value.trim();
    const sort = tree ? 'name' : opt.sort, desc = !tree && opt.desc;
    table.dataset.sort = sort; // (narrow: only the column it's sorted by shows beside the names)
    for (const b of cols.querySelectorAll('[data-s]')) {
      const k = b.dataset.s, on = k === sort, c = SORTS[k];
      b.setAttribute('aria-pressed', String(on));
      b.disabled = tree;
      b.querySelector('.dir').textContent = on ? (desc ? '↓' : '↑') : '';
      b.title = tree ? 'With Namespaces on, pages are listed A to Z under their parents' : on ? `Sorted ${c.says[+desc]}; click for ${c.says[+!desc]}` : `Sort by ${c.label.toLowerCase()}, ${c.says[+c.desc]}`;
      b.setAttribute('aria-label', on ? `${c.label}, sorted ${c.says[+desc]}` : `Sort by ${c.label.toLowerCase()}`);
    }
    const files = app.names.filter((n) => n.exists && !n.journal).length;
    input.placeholder = `Filter ${files} pages`;
    if (opt.tree && !input.value.trim()) {
      // namespaces: "a/b/c" sits under "a" and "a/b"
      const byName = new Map(shown.map((n) => [n.name.toLowerCase(), n]));
      const rows = [];
      const seen = new Set();
      const sorted = shown.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      for (const n of sorted) {
        const parts = n.name.split('/');
        for (let k = 1; k < parts.length; k++) {
          const parent = parts.slice(0, k).join('/');
          if (seen.has(parent.toLowerCase())) continue;
          seen.add(parent.toLowerCase());
          rows.push(row(byName.get(parent.toLowerCase()) || { name: parent, exists: false, refs: 0 }, parts[k - 1], k - 1));
        }
        if (!seen.has(n.name.toLowerCase())) { seen.add(n.name.toLowerCase()); rows.push(row(n, parts[parts.length - 1], parts.length - 1)); }
      }
      ul.className = 'rows pg-rows tree-rows';
      ul.innerHTML = rows.join('') || '<li class="note">No pages match.</li>';
    } else {
      ul.className = 'rows pg-rows';
      ul.innerHTML = shown.map((n) => row(n)).join('') || '<li class="note">No pages match.</li>';
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
  view.append(h('p', 'note', 'Pages carry tags through their <code>tags::</code> property.'));
  const tags = await call('tags');
  const ul = h('ul', 'rows');
  ul.innerHTML = tags.map(([t, n]) => `<li><a href="#" data-page="${esc(t)}">${esc(t)}<span class="meta">${plural(n, 'page')}</span></a></li>`).join('')
    || '<li class="note">No tags yet.</li>';
  ul.addEventListener('click', (e) => app.linkClick(e));
  view.append(ul);
}

// ---------------------------------------------------------------------------
export async function propsView(app, view, key) {
  if (!key) {
    view.append(h('h1', 'page-title', 'Properties'));
    const keys = await call('props');
    const ul = h('ul', 'rows');
    ul.innerHTML = keys.map(([k, n]) => `<li><a href="#/props/${encodeURIComponent(k)}">${esc(k)}<span class="meta">${n}</span></a></li>`).join('')
      || '<li class="note">No properties yet.</li>';
    view.append(ul);
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
const GROUPS = { DOING: 'doing', NOW: 'doing', 'IN-PROGRESS': 'doing', STARTED: 'doing', TODO: 'todo', LATER: 'todo', WAITING: 'waiting', WAIT: 'waiting', DONE: 'done', CANCELED: 'done', CANCELLED: 'done' };
/** The earliest of a to-do's scheduled and deadline days (Infinity without either). */
export const taskDay = (x) => Math.min(...[x.scheduled, x.deadline].filter(Boolean).map((w) => num(w.date)));

/** One to-do as a row: tick box, marker, text, dates, and the page it's on. */
export function taskRow(x) {
  const r = renderBlock(x.text);
  const open = GROUPS[x.marker] !== 'done';
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
      const open = GROUPS[x.marker] !== 'done';
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

export async function todosView(app, view) {
  const opt = store.get('todoOpts', { done: false, kind: 'all' });
  view.append(h('h1', 'page-title', 'To-dos'));
  const tools = h('div', 'list-tools');
  // the words of his own workflow (config.edn: NOW/LATER or DOING/TODO); each filter shows both kinds
  const now = app.workflow() === 'now';
  const kinds = [['all', 'Open', 'Every open to-do'], ['doing', now ? 'Now' : 'Doing', 'NOW and DOING'], ['todo', now ? 'Later' : 'To do', 'LATER and TODO'], ['waiting', 'Waiting', 'WAITING']];
  tools.innerHTML = `<input class="filter" type="search" placeholder="Filter to-dos" aria-label="Filter to-dos">
    <div class="chips" role="group" aria-label="Show">${kinds.map(([k, l, t]) => `<button class="chip" data-k="${k}" title="${t}" aria-pressed="${opt.kind === k}">${l}</button>`).join('')}
      <button class="chip chip-end" data-o="done" title="Also show finished to-dos" aria-pressed="${!!opt.done}">Done</button></div>`;
  const out = h('div', 'todos');
  view.append(tools, out);
  const input = $('input', tools);
  let tasks = [];
  const load = async () => { tasks = await call('tasks', { done: opt.done }); draw(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const t = num(today());
    const list = tasks.filter((x) => (opt.kind === 'all' ? true : GROUPS[x.marker] === opt.kind || (opt.done && GROUPS[x.marker] === 'done'))
      && (!q || x.text.toLowerCase().includes(q) || x.page.toLowerCase().includes(q)));
    const when = taskDay;
    const groups = [['Overdue', []], ['Today', []], ['Next 7 days', []], ['Later', []], ['No date', []], ['Done', []]];
    for (const x of list) {
      const w = when(x);
      const g = GROUPS[x.marker] === 'done' ? 5 : !Number.isFinite(w) ? 4 : w < t ? 0 : w === t ? 1 : w <= t + 7 ? 2 : 3;
      groups[g][1].push(x);
    }
    const prio = (x) => ({ A: 0, B: 1, C: 2 }[x.priority] ?? 1);
    for (const [, g] of groups) g.sort((a, b) => (when(a) - when(b)) || (prio(a) - prio(b)));
    out.innerHTML = groups.filter(([, g]) => g.length).map(([name, g]) => `<section class="sec"><h2 class="sec-h">${name} <span class="n">${g.length}</span></h2>
      ${g.map((x) => taskRow(x)).join('')}</section>`).join('')
      || `<p class="note">${tasks.length ? 'Nothing matches.' : 'No open to-dos. Start a block with TODO (or press Ctrl+Enter) to make one.'}</p>`;
  };
  tools.onclick = (e) => {
    const c = e.target.closest('[data-k]');
    if (c) { opt.kind = c.dataset.k; store.set('todoOpts', opt); tools.querySelectorAll('[data-k]').forEach((b) => b.setAttribute('aria-pressed', b === c)); draw(); }
    const d = e.target.closest('[data-o="done"]');
    if (d) { opt.done = !opt.done; d.setAttribute('aria-pressed', String(opt.done)); store.set('todoOpts', opt); load(); }
  };
  fitChips($('.chips', tools));
  input.oninput = draw;
  taskClicks(app, out, () => tasks, load);
  await load();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

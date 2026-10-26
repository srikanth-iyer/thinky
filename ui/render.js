// Block text → HTML (view mode). Logseq-flavoured Markdown, deliberately small.

import { tex, findMath } from './math.js';
import { assetUrl, today } from './api.js';

export const HIDDEN_PROPS = new Set(['id', 'collapsed', 'ls-type', 'hl-type', 'hl-page', 'hl-stamp', 'hl-color',
  'heading', 'created-at', 'updated-at', 'annotation-id', 'hid', 'card-last-interval', 'card-repeats',
  'card-ease-factor', 'card-next-schedule', 'card-last-reviewed', 'card-last-score', 'logseq.order-list-type',
  'template-including-parent']);
export const MARKERS = /^(TODO|DOING|DONE|LATER|NOW|WAITING|WAIT|CANCELED|CANCELLED|IN-PROGRESS|STARTED)(?=\s|$)/;
export const PROP = /^\s*([\p{L}\p{N}_.\/-]+)::(?:\s(.*)|$)/u;
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)(\?.*)?$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Only web, mail and phone links open; anything else (javascript:, file:, …) stays text. */
export const safeHref = (u) => (/^(https?:|mailto:|tel:)/i.test(u.trim()) ? u.trim() : null);

const link = (name, label, cls = 'pl') =>
  `<a class="${cls}" data-page="${esc(name)}" href="#">${label ?? esc(name)}</a>`;
// tags carry their '#' in a span, so a skin can hide or replace it
const tagLink = (name) => `<a class="tag" data-page="${esc(name)}" href="#"><span class="hash">#</span>${esc(name)}</a>`;

// Find matching ]] for [[ at i (nesting aware). Returns index after ]] or -1.
function closeBrackets(s, i) {
  let depth = 0;
  for (let j = i; j < s.length - 1; j++) {
    if (s[j] === '[' && s[j + 1] === '[') { depth++; j++; }
    else if (s[j] === ']' && s[j + 1] === ']') { depth--; j++; if (depth === 0) return j + 1; }
  }
  return -1;
}

// Index after the ')' matching the '(' at i (balanced, e.g. Wikipedia URLs), or -1.
function closeParen(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')' && --depth === 0) return j + 1;
    else if (s[j] === '\n') return -1;
  }
  return -1;
}

function image(alt, url, attrs) {
  const u = url.trim();
  let src = null;
  if (/^https?:/i.test(u) || /^data:image\//i.test(u)) src = u;
  else if (!/^[a-z]+:/i.test(u)) src = assetUrl(u);
  if (!src) return esc(alt || u);
  if (!IMG.test(u) && !/^data:image\//i.test(u)) {
    const name = decodeURIComponent(u.split('/').pop() || u);
    return `<span class="file" title="${esc(u)}">📎 ${esc(alt || name)}</span>`;
  }
  const w = attrs?.match(/:width\s+(\d+)/)?.[1];
  const h = attrs?.match(/:height\s+(\d+)/)?.[1];
  const size = (w ? ` width="${w}"` : '') + (h ? ` height="${h}"` : '');
  return `<img class="img" src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${size}>`;
}

export function inline(s) {
  const maths = findMath(s);
  let mk = 0;
  let out = '';
  let i = 0;
  let prev = ' ';
  while (i < s.length) {
    while (mk < maths.length && maths[mk].start < i) mk++;
    if (mk < maths.length && maths[mk].start === i) {
      const m = maths[mk];
      out += `<span class="math${m.display ? ' display' : ''}">${tex(m.tex)}</span>`;
      i = m.end; prev = '$'; mk++; continue;
    }
    const c = s[i];
    const rest = s.slice(i);
    let m;
    if (c === '`' && (m = rest.match(/^(`+)([\s\S]*?)\1/))) {
      out += `<code>${esc(m[2])}</code>`; i += m[0].length; prev = '`'; continue;
    }
    if (rest.startsWith('{{') && (m = rest.match(/^\{\{[\s\S]*?\}\}/))) {
      out += `<span class="macro">${esc(m[0])}</span>`; i += m[0].length; prev = '}'; continue;
    }
    if (rest.startsWith('((') && (m = rest.match(/^\(\(([0-9a-f-]{36})\)\)/))) {
      out += '<span class="macro" title="Block reference">↗ block</span>'; i += m[0].length; prev = ')'; continue;
    }
    if (rest.startsWith('[[')) {
      const end = closeBrackets(s, i);
      if (end > 0) { out += link(s.slice(i + 2, end - 2).trim()); i = end; prev = ']'; continue; }
    }
    if (c === '#' && /[\s(,]/.test(prev)) {
      if (rest.startsWith('#[[')) {
        const end = closeBrackets(s, i + 1);
        if (end > 0) { const n = s.slice(i + 3, end - 2).trim(); out += tagLink(n); i = end; prev = ']'; continue; }
      }
      if ((m = rest.match(/^#([^\s,;!?"'()[\]{}<>`#]+)/))) {
        const t = m[1].replace(/[.:]+$/, '');
        if (t) { out += tagLink(t); i += 1 + t.length; prev = 'x'; continue; }
      }
    }
    // [label](url), ![alt](url){:width 200}, [label]([[Page]])
    if ((c === '[' || (c === '!' && s[i + 1] === '[')) && (m = rest.match(/^!?\[([^\]\n]*)\]\(/))) {
      const close = closeParen(s, i + m[0].length - 1);
      if (close > 0) {
        const label = m[1];
        const url = s.slice(i + m[0].length, close - 1);
        let after = close;
        let attrs = null;
        const am = s.slice(close).match(/^\{(:[^}]*)\}/);
        if (am) { attrs = am[1]; after = close + am[0].length; }
        const page = url.match(/^\[\[(.+)\]\]$/);
        if (c === '!') out += image(label, url, attrs);
        else if (page) out += link(page[1].trim(), inline(label) || esc(page[1]));
        else {
          const href = safeHref(url);
          out += href ? `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener">${inline(label) || esc(url)}</a>` : `<span class="ext-off" title="${esc(url)}">${inline(label) || esc(url)}</span>`;
        }
        i = after; prev = ')'; continue;
      }
    }
    if (/[\s(]/.test(prev) && (m = rest.match(/^https?:\/\/[^\s<>]+/))) {
      let u = m[0];
      // trailing punctuation isn't part of the address; ')' only when unbalanced
      for (;;) {
        if (/[.,;:!?'"]$/.test(u)) u = u.slice(0, -1);
        else if (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1);
        else break;
      }
      out += `<a class="ext" href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`;
      i += u.length; prev = 'x'; continue;
    }
    if ((m = rest.match(/^\*\*([\s\S]+?)\*\*/)) || (m = rest.match(/^__([\s\S]+?)__/))) {
      out += `<strong>${inline(m[1])}</strong>`; i += m[0].length; prev = '*'; continue;
    }
    if ((m = rest.match(/^~~([\s\S]+?)~~/))) { out += `<s>${inline(m[1])}</s>`; i += m[0].length; prev = '~'; continue; }
    if ((m = rest.match(/^\^\^([\s\S]+?)\^\^/)) || (m = rest.match(/^==([\s\S]+?)==/))) {
      out += `<mark>${inline(m[1])}</mark>`; i += m[0].length; prev = '='; continue;
    }
    if (/[\s(]/.test(prev) && ((m = rest.match(/^\*([^\s*][^*]*?)\*/)) || (m = rest.match(/^_([^\s_][^_]*?)_(?![\p{L}\p{N}])/u)))) {
      out += `<em>${inline(m[1])}</em>`; i += m[0].length; prev = '*'; continue;
    }
    out += esc(c);
    prev = c;
    i++;
  }
  return out;
}

/** `<2026-10-26 Mon 10:00 .+1d>` → {date:[y,m,d], time, repeat} */
export function parseStamp(s) {
  const m = s.match(/<(\d{4})-(\d{2})-(\d{2})(?:\s+[A-Za-z]{2,3})?(?:\s+(\d{1,2}:\d{2}))?(?:\s+((?:\.\+|\+\+|\+)\d+[hdwmy]))?\s*>/);
  return m ? { date: [+m[1], +m[2], +m[3]], time: m[4] || null, repeat: m[5] || null } : null;
}

export const stampText = ([y, m, d], time, repeat) => {
  const dt = new Date(y, m - 1, d);
  return `<${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${DAYS[dt.getDay()]}${time ? ' ' + time : ''}${repeat ? ' ' + repeat : ''}>`;
};

const dayNum = ([y, m, d]) => Math.round(new Date(y, m - 1, d) / 864e5);

/** "Mon, Oct 27" / "Today" / "Tomorrow" */
export function niceDate(date) {
  const diff = dayNum(date) - dayNum(today());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const dt = new Date(date[0], date[1] - 1, date[2]);
  const yr = date[0] !== today()[0] ? ` ${date[0]}` : '';
  return `${DAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}${yr}`;
}

/** Date chips for SCHEDULED/DEADLINE. `open`: the to-do isn't done (overdue colouring). */
export function datesHtml(dates, open = true) {
  if (!dates?.length) return '';
  const t = dayNum(today());
  return '<div class="dates">' + dates.map((d) => {
    const n = dayNum(d.date);
    const cls = !open ? '' : n < t ? ' overdue' : n === t ? ' due' : '';
    const icon = d.kind === 'deadline' ? '⚑' : '◷';
    const label = d.kind === 'deadline' ? 'Deadline' : 'Scheduled';
    return `<span class="date-chip${cls}" title="${label}${d.repeat ? ', repeats ' + esc(d.repeat) : ''}">${icon} ${label} ${esc(niceDate(d.date))}${d.time ? ' ' + esc(d.time) : ''}${d.repeat ? ' ↻' : ''}</span>`;
  }).join('') + '</div>';
}

// Full block: marker, priority, heading, properties, dates, drawers, code fences, display math.
// Returns { html, marker, priority, props, dates, heading } (props = the visible properties;
// heading = 1–6 when the first line is a "#" heading, else 0).
export function renderBlock(text) {
  const lines = text.split('\n');
  const body = [];
  const props = [];
  const dates = [];
  let fence = null;
  let mathBlock = null;
  let drawer = false;
  for (const line of lines) {
    const t = line.trim();
    if (fence !== null) {
      if (t.startsWith('```')) { body.push({ code: fence.join('\n') }); fence = null; }
      else fence.push(line);
      continue;
    }
    if (mathBlock !== null) {
      if (t === '$$') { body.push({ math: mathBlock.join('\n') }); mathBlock = null; }
      else mathBlock.push(line);
      continue;
    }
    if (drawer) { if (/^:END:$/i.test(t)) drawer = false; continue; }
    if (/^:[A-Za-z-]+:$/.test(t)) { drawer = true; continue; } // :LOGBOOK: … :END:
    if (t.startsWith('```')) { fence = []; continue; }
    if (t === '$$') { mathBlock = []; continue; }
    const sd = t.match(/^(SCHEDULED|DEADLINE):\s*(<.*>)/);
    if (sd) {
      const st = parseStamp(sd[2]);
      if (st) { dates.push({ kind: sd[1] === 'DEADLINE' ? 'deadline' : 'scheduled', ...st }); continue; }
    }
    const pm = line.match(PROP);
    if (pm) {
      const k = pm[1].toLowerCase();
      if (!HIDDEN_PROPS.has(k) && !k.startsWith('card-') && !k.startsWith('hl-')) props.push([k, pm[2] ?? '']);
      continue;
    }
    body.push({ text: line });
  }
  if (fence !== null) body.push({ code: fence.join('\n') });
  if (mathBlock !== null) body.push({ math: mathBlock.join('\n') });

  let marker = null;
  let priority = null;
  let heading = 0;
  let html = '';
  body.forEach((b, idx) => {
    if (b.code !== undefined) { html += `<pre><code>${esc(b.code)}</code></pre>`; return; }
    if (b.math !== undefined) { html += `<div class="math display">${tex(b.math)}</div>`; return; }
    let t = b.text;
    if (idx === 0) {
      const mm = t.match(MARKERS);
      if (mm) { marker = mm[1]; t = t.slice(mm[0].length).replace(/^\s/, ''); }
      const pr = t.match(/^\[#([A-Ca-c])\]\s?/) || t.match(/\s\[#([A-Ca-c])\](?=\s|$)/);
      if (pr) { priority = pr[1].toUpperCase(); t = t.replace(pr[0], ''); }
      const h = t.match(/^(#{1,6})\s+(.*)$/);
      if (h) { heading = h[1].length; html += `<span class="h h${heading}">${inline(h[2])}</span>`; return; }
    }
    if (html && !html.endsWith('</pre>') && !html.endsWith('</div>')) html += '<br>';
    html += inline(t);
  });
  return { html, marker, priority, props, dates, heading };
}

/** Drop bookkeeping properties (ids, fold state, flashcard and highlight data). */
export function visibleProps(props) {
  return props.filter(([k]) => !HIDDEN_PROPS.has(k) && !k.startsWith('card-') && !k.startsWith('hl-'));
}

export function propsHtml(props) {
  if (!props.length) return '';
  return '<div class="props">' + props.map(([k, v]) => {
    const vals = (k === 'tags' || k === 'tag' || k === 'alias' || k === 'aliases')
      ? v.split(',').map((x) => x.trim().replace(/^#/, '').replace(/^\[\[(.*)\]\]$/, '$1')).filter(Boolean).map((n) => link(n)).join(', ')
      : inline(v);
    return `<span class="prop"><span class="pk" data-prop="${esc(k)}">${esc(k)}</span><span class="pv">${vals}</span></span>`;
  }).join('') + '</div>';
}

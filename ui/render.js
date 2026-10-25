// Block text → HTML (view mode). Logseq-flavoured Markdown, deliberately small.

const HIDDEN_PROPS = new Set(['id', 'collapsed', 'ls-type', 'hl-type', 'hl-page', 'hl-stamp', 'hl-color',
  'heading', 'created-at', 'updated-at', 'annotation-id', 'hid', 'card-last-interval', 'card-repeats',
  'card-ease-factor', 'card-next-schedule', 'card-last-reviewed', 'card-last-score', 'logseq.order-list-type']);
const MARKERS = /^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELED|CANCELLED)\s/;
const PROP = /^\s*([\p{L}\p{N}_.\/-]+)::(?:\s(.*)|$)/u;

export const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const link = (name, label, cls = 'pl') =>
  `<a class="${cls}" data-page="${esc(name)}" href="#">${esc(label ?? name)}</a>`;
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

export function inline(s) {
  let out = '';
  let i = 0;
  let prev = ' ';
  while (i < s.length) {
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
    if ((m = rest.match(/^!?\[([^\]]*)\]\(([^)\s]+)\)/))) {
      out += `<a class="ext" href="${esc(m[2])}" target="_blank" rel="noopener">${inline(m[1]) || esc(m[2])}</a>`;
      i += m[0].length; prev = ')'; continue;
    }
    if (/[\s(]/.test(prev) && (m = rest.match(/^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/))) {
      out += `<a class="ext" href="${esc(m[0])}" target="_blank" rel="noopener">${esc(m[0])}</a>`;
      i += m[0].length; prev = 'x'; continue;
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

// Full block: marker, heading, properties, code fences, line breaks.
// Returns { html, marker, props } where props are the visible properties.
export function renderBlock(text) {
  const lines = text.split('\n');
  const body = [];
  const props = [];
  let fence = null;
  for (const line of lines) {
    if (fence !== null) {
      if (line.trim().startsWith('```')) { body.push({ code: fence.join('\n') }); fence = null; }
      else fence.push(line);
      continue;
    }
    if (line.trim().startsWith('```')) { fence = []; continue; }
    const pm = line.match(PROP);
    if (pm) {
      const k = pm[1].toLowerCase();
      if (!HIDDEN_PROPS.has(k) && !k.startsWith('card-') && !k.startsWith('hl-')) props.push([k, pm[2] ?? '']);
      continue;
    }
    body.push({ text: line });
  }
  if (fence !== null) body.push({ code: fence.join('\n') });

  let marker = null;
  let html = '';
  body.forEach((b, idx) => {
    if (b.code !== undefined) { html += `<pre><code>${esc(b.code)}</code></pre>`; return; }
    let t = b.text;
    if (idx === 0) {
      const mm = t.match(MARKERS);
      if (mm) { marker = mm[1]; t = t.slice(mm[0].length); }
      const h = t.match(/^(#{1,6})\s+(.*)$/);
      if (h) { html += `<span class="h h${h[1].length}">${inline(h[2])}</span>`; return; }
    }
    if (html && !html.endsWith('</pre>')) html += '<br>';
    html += inline(t);
  });
  return { html, marker, props };
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

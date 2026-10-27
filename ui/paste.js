// Pasting formatted words (a web page, Word, Google Docs): the clipboard's HTML → Logseq Markdown
// notes, read with the browser's own DOMParser by this small hand-written converter (no library).
// Loaded the first time it's needed (editor.js onPaste). Kept: links, bold, italics, strikethrough,
// highlights, code, headings, quotes, line breaks, lists (nested ones as sub-notes, numbered ones
// numbered), table rows, pictures on the web. Dropped: styles, scripts, comments, Word's own markup
// (its list bullets, <o:p>…), anything hidden.

const DROP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'EMBED',
  'CANVAS', 'VIDEO', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'XML']);
const BLOCKS = 'p,div,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,table,tr,td,th,thead,tbody,tfoot,caption,section,article,header,footer,aside,main,nav,figure,figcaption,dl,dt,dd,hr,address,center,form,fieldset,details,summary';
const BLOCK = new Set(BLOCKS.toUpperCase().split(','));
const css = (n, prop) => (n.getAttribute('style') || '').match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, 'i'))?.[1].trim().toLowerCase() ?? null;
const hidden = (n) => DROP.has(n.tagName) || n.hidden || css(n, 'display') === 'none' || /mso-list\s*:\s*ignore/i.test(n.getAttribute('style') || '');
/** A box from a code editor (VS Code and the like): spaces kept (white-space: pre…) in a fixed-width
 *  font. Its colours and italic comments aren't formatting: one code block. */
const codeBox = (n) => /^pre/.test(css(n, 'white-space') || '') && /monospace|consolas|menlo|monaco|courier|fira code|jetbrains/i.test(css(n, 'font-family') || '');
/** A box's words as lines (each inner box or <br> a line; nothing else in them changes). */
function boxText(n) {
  let out = '';
  const go = (x) => {
    for (const c of x.childNodes) {
      if (c.nodeType === 3) out += c.data;
      else if (c.nodeType === 1 && !hidden(c)) {
        if (c.tagName === 'BR') { out += '\n'; continue; }
        const box = BLOCK.has(c.tagName);
        if (box && out && !out.endsWith('\n')) out += '\n';
        go(c);
        if (box && !out.endsWith('\n')) out += '\n';
      }
    }
  };
  go(n);
  return out;
}

/** HTML → [{depth, text, num}]: one note per paragraph, heading, list item, quote, code block or
 *  table row; depth: how far in (nested list items); num: an item of a numbered list. */
export function htmlToNotes(html) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const notes = [];
  let para = null; // the note being written: {depth, head, quote, num, segs: [{t, raw}]} (raw: code, as it is)
  const start = (depth, o = {}) => { end(); para = { depth, ...o, segs: [{ t: '', raw: false }] }; };
  const add = (s, ctx) => {
    if (!s) return;
    if (!para) { if (!s.trim()) return; start(ctx.depth); }
    para.segs.at(-1).t += s;
  };
  const addCode = (s, ctx) => {
    if (!para) start(ctx.depth);
    para.segs.push({ t: s, raw: true }, { t: '', raw: false });
  };
  const end = () => {
    if (!para) return;
    const p = para;
    para = null;
    const parts = [];
    for (const g of p.segs) {
      if (g.raw) { parts.push(g.t); continue; }
      const lines = g.t.split('\n').map((l) => l.replace(/[ \t ​]+/g, ' ').trim()).filter(Boolean);
      if (lines.length) parts.push(lines.join('\n'));
    }
    let text = parts.join('\n');
    if (!text.trim()) return;
    if (p.head) text = '#'.repeat(p.head) + ' ' + text.replace(/\n/g, ' ');
    if (p.quote) text = text.split('\n').map((l) => '> ' + l).join('\n');
    notes.push({ depth: p.depth, text, num: !!p.num });
  };

  /** A part of a line: its words with their marks (f: marks already on from outside). Anything
   *  block-like inside counts as a space. */
  const inl = (n, f) => {
    if (n.nodeType === 3) return n.data.replace(/[\r\n\t]+/g, ' ');
    if (n.nodeType !== 1 || hidden(n)) return '';
    const tag = n.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') { // (copied from this app: the picture's link as written; from the web: its address)
      if (n.dataset.md) return n.dataset.md;
      const src = (n.getAttribute('src') || '').trim();
      return /^https?:\/\//i.test(src) ? `![${(n.getAttribute('alt') || '').replace(/[[\]\n]/g, '')}](${src.replace(/\s/g, '%20')})` : '';
    }
    if (/^[0-9a-f-]{36}$/i.test(n.dataset.ref || '')) return `((${n.dataset.ref}))`; // (this app's block reference)
    if (tag === 'A' && n.dataset.page) { // (this app's page link or tag)
      const name = n.dataset.page;
      return n.classList.contains('tag') ? '#' + (/[\s,;!?"'()[\]{}<>`#]/.test(name) ? `[[${name}]]` : name) : `[[${name}]]`;
    }
    if (/^(CODE|KBD|SAMP|TT)$/.test(tag)) {
      const t = n.textContent.replace(/\s+/g, ' ');
      if (!t.trim()) return t;
      return t.includes('`') ? '`` ' + t + ' ``' : '`' + t + '`';
    }
    const kids = (g) => [...n.childNodes].map((c) => inl(c, g)).join('');
    if (tag === 'A') {
      const href = (n.getAttribute('href') || '').trim();
      const label = kids(f).replace(/\s+/g, ' ').trim();
      if (!/^(https?:|mailto:)/i.test(href) || label.includes('![')) return label; // (a place on the same page, a script…: its words; a picture: the picture)
      if (!label || label === href || 'mailto:' + label === href) return href;
      return `[${label.replace(/[[\]]/g, '')}](${href.replace(/\s/g, '%20')})`;
    }
    let g = f, open = '';
    const on = (k, mk) => { if (!g[k]) { g = { ...g, [k]: true }; open += mk; } };
    const weight = css(n, 'font-weight'), style = css(n, 'font-style');
    const heavy = weight === null ? null : /^(bold|bolder|[6-9]00|1000)$/.test(weight);
    // (Google Docs wraps everything in <b style="font-weight:normal">; Word's own "mso-bidi-font-weight" isn't it)
    if ((tag === 'B' || tag === 'STRONG' ? heavy !== false : heavy) && !f.head) on('bold', f.italic ? '__' : '**');
    if (/^(I|EM|CITE|DFN|VAR)$/.test(tag) ? style !== 'normal' : style === 'italic' || style === 'oblique') on('italic', g.bold ? '_' : '*');
    if (/^(S|DEL|STRIKE)$/.test(tag) || /line-through/.test(css(n, 'text-decoration(?:-line)?') || '')) on('strike', '~~');
    if (tag === 'MARK' || css(n, 'background(?:-color)?') === 'yellow') on('mark', '^^');
    if (BLOCK.has(tag)) return ' ' + kids(g) + ' ';
    const inner = kids(g);
    if (!open) return inner;
    const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/); // (spaces go outside the marks: "**word** ", not "**word **")
    return m[2] ? m[1] + open + m[2] + [...open].reverse().join('') + m[3] : inner;
  };

  /** The notes in n's children. ctx: {depth, inLi (in a list item: a list inside goes one level
   *  deeper), lines (in a list item or quote: paragraphs are lines of its note), head}. */
  const walk = (n, ctx) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { add(c.data.replace(/[\r\n\t]+/g, ' '), ctx); continue; }
      if (c.nodeType !== 1 || hidden(c)) continue;
      if (c.tagName === 'BR') { if (para) add('\n', ctx); continue; }
      if (BLOCK.has(c.tagName)) block(c, ctx);
      else if (c.querySelector(BLOCKS)) walk(c, ctx); // (an inline wrapper round paragraphs: Google Docs' <b>)
      else add(inl(c, { head: ctx.head }), ctx);
    }
  };
  const item = (li, depth, num) => { start(depth, { num }); walk(li, { depth, inLi: true, lines: true }); end(); };
  const list = (n, depth) => {
    end();
    const num = n.tagName === 'OL';
    for (const c of n.children) {
      if (hidden(c)) continue;
      if (c.tagName === 'LI') item(c, depth, num);
      else if (c.tagName === 'UL' || c.tagName === 'OL') list(c, depth + 1); // (Google Docs puts a nested list here)
      else { walk(c, { depth }); end(); }
    }
  };
  const block = (n, ctx) => {
    const tag = n.tagName;
    const h = tag.match(/^H([1-6])$/);
    if (h) {
      if (ctx.lines && para) { add('\n', ctx); walk(n, { ...ctx, head: true }); return; }
      start(ctx.depth, { head: +h[1] });
      walk(n, { ...ctx, head: true });
      end();
      return;
    }
    if (tag === 'UL' || tag === 'OL') { list(n, ctx.inLi ? ctx.depth + 1 : ctx.depth); return; }
    if (tag === 'LI') { item(n, ctx.depth, false); return; }
    if (tag === 'PRE' || codeBox(n)) {
      const code = (tag === 'PRE' ? n.textContent : boxText(n)).replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
      if (!code.trim()) return;
      if (!(ctx.lines && para)) start(ctx.depth);
      addCode('```\n' + code + '\n```', ctx);
      if (!ctx.lines) end();
      return;
    }
    if (tag === 'BLOCKQUOTE') { start(ctx.depth, { quote: true }); walk(n, { ...ctx, lines: true }); end(); return; }
    if (tag === 'TABLE') { // a row a note, its cells side by side
      end();
      for (const tr of n.querySelectorAll('tr')) {
        if (tr.closest('table') !== n) continue;
        const cells = [...tr.children].filter((x) => /^T[DH]$/.test(x.tagName)).map((x) => inl(x, {}).replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (cells.length) { start(ctx.depth); add(cells.join(' | '), ctx); end(); }
      }
      return;
    }
    if (tag === 'HR') { if (!ctx.lines) end(); return; }
    if (tag === 'DD') { end(); walk(n, { ...ctx, depth: ctx.depth + 1 }); end(); return; }
    // a paragraph or another box: a note of its own (in a list item or a quote: a line of its note)
    if (ctx.lines) {
      if (para?.segs.at(-1).t.trim()) add('\n', ctx);
      walk(n, ctx);
      return;
    }
    end();
    // Word's lists are paragraphs: "mso-list:l0 level2" says how deep, the hidden bullet if numbered
    const word = (n.getAttribute('style') || '').match(/mso-list\s*:\s*l\d+\s+level(\d+)/i);
    if (word) {
      const mark = [...n.querySelectorAll('[style]')].find((x) => /mso-list\s*:\s*ignore/i.test(x.getAttribute('style')))?.textContent ?? '';
      start(ctx.depth + Math.max(0, +word[1] - 1), { num: /^\s*([0-9]+|[a-z]{1,4})[.)]/i.test(mark) });
    }
    walk(n, ctx);
    end();
  };

  walk(body, { depth: 0 });
  end();
  return notes;
}

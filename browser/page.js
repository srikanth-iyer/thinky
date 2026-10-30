// thinky highlights: the part that runs inside the web page. The extension puts it in a
// page only when he uses it there (the toolbar button, the right-click menu or the shortcut), so
// it never runs on pages he just reads. It sets up `window.__leanOutliner` once; background.js
// and popup.js then call its functions (each call is a separate small script).
(() => {
  if (window.__leanOutliner) return;

  const NAME = 'lean-outliner';
  const ZW = '​'; // an invisible space: stops words being read as links, tags or properties
  const ranges = new Map(); // highlight id → its Range on this page

  // ------------------------------------------------------------ the yellow marks
  // Edge's Custom Highlight API colours text without changing the page's own HTML.
  function style() {
    if (document.getElementById(NAME + '-style')) return;
    const s = document.createElement('style');
    s.id = NAME + '-style';
    s.textContent = `::highlight(${NAME}) { background-color: #ffe27a; color: #1a1a1a; }`;
    (document.head || document.documentElement).append(s);
  }
  function repaint() {
    if (!window.CSS || !CSS.highlights) return;
    style();
    CSS.highlights.set(NAME, new Highlight(...ranges.values()));
  }

  // ------------------------------------------------------------ the article
  // Its address (the page's own "canonical" one when it names one on the same site), title and
  // the site's name, from the page's hidden information when there is some.
  function meta(sel) {
    const m = document.querySelector(sel);
    return (m && (m.content || m.getAttribute('content')) || '').trim();
  }
  function pageInfo() {
    let url = location.href.split('#')[0];
    const c = document.querySelector('link[rel="canonical"]');
    try {
      if (c && c.href) {
        const u = new URL(c.href, location.href);
        if (u.protocol.startsWith('http') && u.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '')) url = u.href.split('#')[0];
      }
    } catch (e) { /* a broken canonical link: keep the page's own address */ }
    const title = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title || '';
    return { url, title: title.replace(/\s+/g, ' ').trim(), site: meta('meta[property="og:site_name"]') };
  }

  // ------------------------------------------------------------ a passage as Markdown
  // Words that would mean something else in his notes get an invisible space: [[ (( {{ ::, and
  // # in front of a word (a tag). Line starts (- , ``` …) are made safe by the app itself.
  function safe(t) {
    return t
      .replace(/\[\[/g, '[' + ZW + '[')
      .replace(/\]\]/g, ']' + ZW + ']')
      .replace(/\(\(/g, '(' + ZW + '(')
      .replace(/\{\{/g, '{' + ZW + '{')
      .replace(/::/g, ':' + ZW + ':')
      .replace(/(^|[\s(,])#(?=\S)/g, '$1#' + ZW);
  }
  const MATH = '.katex, .katex-display, mjx-container, .MathJax, .MathJax_Display, .mwe-math-element, math';
  // maths: the TeX it was written in, where the page keeps it (KaTeX, Wikipedia, MathJax 2)
  function tex(el) {
    const a = el.querySelector('annotation[encoding="application/x-tex"]');
    let t = a ? a.textContent : '';
    if (!t && el.matches('math') && el.getAttribute('alttext')) t = el.getAttribute('alttext');
    if (!t) {
      const img = el.querySelector('img[alt]');
      if (img && /mwe-math/.test(img.className)) t = img.alt;
    }
    if (!t) {
      const s = el.nextElementSibling;
      if (s && s.matches('script[type^="math/tex"]')) t = s.textContent;
    }
    t = (t || '').trim().replace(/^\{\\displaystyle\s*([\s\S]*)\}$/, '$1').trim();
    if (!t) return null;
    const display = el.matches('.katex-display, .MathJax_Display, mjx-container[display="true"]') || !!el.closest('.katex-display') || el.getAttribute('display') === 'block';
    return display ? `$$${t}$$` : `$${t}$`;
  }
  const BLOCK = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TR|SECTION|ARTICLE|FIGCAPTION|DD|DT|UL|OL|TABLE)$/;
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON|IFRAME|CANVAS|VIDEO|AUDIO|SELECT|INPUT|TEXTAREA)$/;
  function md(node) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += safe(n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      const tag = n.nodeName.toUpperCase();
      if (n.nodeType === 1) {
        if (SKIP.test(tag) || n.getAttribute('aria-hidden') === 'true' || n.hidden) return;
        if (n.matches(MATH)) { const t = tex(n); if (t) { out += t; return; } }
        if (tag === 'BR') { out += '\n'; return; }
        if (tag === 'IMG') return;
      }
      const inner = () => { const before = out; out = ''; n.childNodes.forEach(walk); const got = out; out = before; return got; };
      const wrap = (mark) => { const t = inner(); const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/); out += m[2] ? m[1] + mark + m[2] + mark + m[3] : t; };
      if (tag === 'STRONG' || tag === 'B') return wrap('**');
      if (tag === 'EM' || tag === 'I' || tag === 'CITE') return wrap('*');
      if (tag === 'CODE' && n.parentNode && n.parentNode.nodeName !== 'PRE') { out += '`' + n.textContent.replace(/`/g, "'") + '`'; return; }
      if (tag === 'A' && /^https?:/i.test(n.href || '')) {
        const label = inner().trim().replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'));
        out += label ? `[${label}](${n.href.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')})` : '';
        return;
      }
      const block = BLOCK.test(tag);
      if (block) out += '\n';
      n.childNodes.forEach(walk);
      if (block) out += '\n';
    };
    walk(node);
    // tidy: spaces at line ends, more than one empty line, spaces before punctuation from tags
    return out
      .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // a selection that starts or ends inside maths takes the whole formula
  function widen(r) {
    const m = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest(MATH);
    const s = m(r.startContainer), e = m(r.endContainer);
    if (s) r.setStartBefore(s.closest('.katex-display') || s);
    if (e) r.setEndAfter(e.closest('.katex-display') || e);
    return r;
  }

  // ------------------------------------------------------------ finding passages again
  // The page's words as one string with spaces squeezed, and where each letter came from, so a
  // passage saved earlier (its plain words) can be found and marked again after a reload.
  function textMap() {
    const nodes = [];
    let flat = '';
    const map = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n;
    let space = true;
    while ((n = w.nextNode())) {
      nodes.push(n);
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i++) {
        const sp = /\s/.test(v[i]);
        if (sp && space) continue;
        flat += sp ? ' ' : v[i];
        map.push([n, i]);
        space = sp;
      }
    }
    return { flat, map };
  }
  const squeeze = (s) => s.replace(/\s+/g, ' ').trim();
  function find(plain, tm, near) {
    const q = squeeze(plain);
    if (!q) return null;
    let at = -1, best = Infinity;
    for (let i = tm.flat.indexOf(q); i >= 0; i = tm.flat.indexOf(q, i + 1)) {
      const d = Math.abs(i - (near || 0));
      if (d < best) { best = d; at = i; }
    }
    if (at < 0) return null;
    const [sn, so] = tm.map[at];
    const [en, eo] = tm.map[at + q.length - 1];
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo + 1);
    return r;
  }

  // a link that opens the article at this passage: a "text fragment" (its first and last words)
  function fragment(url, plain) {
    const e = (x) => encodeURIComponent(x).replace(/-/g, '%2D');
    const w = squeeze(plain).split(' ').filter(Boolean);
    if (!w.length) return '';
    const t = w.length > 8 ? e(w.slice(0, 4).join(' ')) + ',' + e(w.slice(-4).join(' ')) : e(w.join(' '));
    return url.split('#')[0] + '#:~:text=' + t;
  }

  // ------------------------------------------------------------ what the extension calls
  window.__leanOutliner = {
    pageInfo,
    // The selected passage: {plain, text (Markdown), pos, link}, or null when nothing is selected.
    selection() {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const r = widen(sel.getRangeAt(0).cloneRange());
      const plain = squeeze(r.toString());
      if (!plain) return null;
      const before = document.createRange();
      before.setStart(document.body, 0);
      try { before.setEnd(r.startContainer, r.startOffset); } catch (e) { /* outside body */ }
      const pos = squeeze(before.toString()).length;
      return { plain, text: md(r.cloneContents()) || safe(plain), pos, link: fragment(pageInfo().url, plain), range: r };
    },
    // Highlight the selection: marked yellow, returned for the extension to keep.
    highlight() {
      const s = this.selection();
      if (!s) return null;
      const id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      ranges.set(id, s.range);
      repaint();
      getSelection().removeAllRanges();
      return { id, plain: s.plain, text: s.text, pos: s.pos, link: s.link };
    },
    // Mark again the highlights kept for this page (after a reload); returns how many showed.
    paint(items) {
      ranges.clear();
      const tm = textMap();
      let shown = 0;
      for (const it of items || []) {
        const r = find(it.plain, tm, it.pos);
        if (r) { ranges.set(it.id, r); shown++; }
      }
      repaint();
      return shown;
    },
    clear() { ranges.clear(); repaint(); },
    // A small message in the page's corner.
    toast(msg, bad) {
      const d = document.createElement('div');
      d.textContent = msg;
      d.style.cssText = `position:fixed;z-index:2147483647;top:16px;right:16px;max-width:360px;background:${bad ? '#8a1f1f' : '#1a2130'};color:#fff;padding:10px 14px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.25)`;
      document.documentElement.append(d);
      setTimeout(() => d.remove(), bad ? 6000 : 2600);
    },
  };
})();

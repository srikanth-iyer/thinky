// Plain Node tests of the page's modules that load on their own (no dev server, no browser):
//   node dev/ui-tests/unit.mjs
// math.js (review claim 22a: a formula that would draw too much shows as its source) and render.js
// (review, medium: a formula inside inline code is code; a link's label holds no other link).
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { tex } = await import('../../ui/math.js');
const { inline } = await import('../../ui/render.js');

let fails = 0;
const check = (c, m, x = '') => { if (c) console.log('  ok  ' + m); else { fails++; console.log('  FAIL ' + m + (x ? ' :: ' + String(x).slice(0, 300) : '')); } };
const count = (html, re) => (html.match(re) || []).length;
const timed = (f) => { const t = Date.now(); const v = f(); return [v, Date.now() - t]; };

console.log('math.js: formulas that would draw too much');
{
  // the review's case: a short note, a matrix of hundreds of thousands of cells
  const row = '&'.repeat(499);
  const big = `\\begin{matrix}${Array(500).fill(row).join('\\\\')}\\end{matrix}`;
  check(big.length < 260_000, 'the source is short beside what it would draw');
  const [h, ms] = timed(() => tex(big));
  check(h.startsWith('<span class="m-src">') && !h.includes('m-mat'), 'a 500 × 500 matrix shows as its source', h.slice(0, 80));
  check(count(h, /<span/g) === 1, 'one element, not 250,000', count(h, /<span/g));
  check(ms < 500, 'and quickly', ms + ' ms');
  const short = `\\begin{bmatrix}${Array(300).fill('&'.repeat(299)).join('\\\\')}\\end{bmatrix}`;
  check(short.length < 100_000 && tex(short).startsWith('<span class="m-src">'), 'a 1 KB-a-row note (300 × 300) too');
  // just under and just over the cap (2000 cells)
  const m = (r, c) => `\\begin{pmatrix}${Array(r).fill(Array(c).fill('x').join('&')).join('\\\\')}\\end{pmatrix}`;
  const ok = tex(m(40, 50));
  check(ok.includes('m-mat') && count(ok, /<span><i>x<\/i><\/span>/g) === 2000, '2,000 cells still draw', count(ok, /<span><i>x<\/i><\/span>/g));
  check(tex(m(41, 50)).startsWith('<span class="m-src">'), '2,050 cells don’t');
  // matrices inside matrices count together
  const inner = m(10, 10); // 100 cells
  const nest = `\\begin{matrix}${Array(25).fill(inner).join('&')}\\end{matrix}`; // 25 + 2,500
  check(tex(nest).startsWith('<span class="m-src">'), 'cells of matrices inside a matrix count too');
  const nestOk = `\\begin{matrix}${Array(3).fill(inner).join('&')}\\end{matrix}`;
  check(tex(nestOk).includes('m-mat'), 'a few small matrices inside one still draw');
  // the count starts again for each formula
  check(tex(m(40, 50)).includes('m-mat') && tex(m(40, 50)).includes('m-mat'), 'each formula has its own count');
  // the source is escaped
  const evil = `\\begin{matrix}${Array(60).fill(Array(60).fill('<img src=x onerror=alert(1)>').join('&')).join('\\\\')}\\end{matrix}`;
  const eh = tex(evil);
  check(eh.startsWith('<span class="m-src">') && !eh.includes('<img') && eh.includes('&lt;img'), 'shown as plain words: nothing in it is HTML', eh.slice(0, 120));
}

console.log('math.js: nesting');
{
  const deep = (n) => '{'.repeat(n) + 'x' + '}'.repeat(n);
  check(tex(deep(10)) === '<i>x</i>', '10 groups deep draws');
  check(tex(deep(40)) === '<i>x</i>', '40 groups deep draws');
  check(tex(deep(41)).startsWith('<span class="m-src">'), '41 groups deep shows its source');
  const [h, ms] = timed(() => tex(deep(5000)));
  check(h.startsWith('<span class="m-src">') && ms < 500, '5,000 groups deep: its source, quickly (no stack overflow)', ms + ' ms');
  const fr = (n) => (n ? `\\frac{${fr(n - 1)}}{y}` : 'x');
  check(tex(fr(20)).includes('m-frac'), 'fractions 20 deep draw');
  check(tex(fr(45)).startsWith('<span class="m-src">'), 'fractions 45 deep show their source');
  const pw = (n) => 'x' + '^{x'.repeat(n) + '}'.repeat(n);
  check(tex(pw(15)).includes('<sup>'), 'powers 15 deep draw');
  check(tex(pw(60)).startsWith('<span class="m-src">'), 'powers 60 deep show their source');
}

console.log('math.js: ordinary formulas are as before');
{
  check(tex('x^2') === '<i>x</i><sup>2</sup>', 'x^2');
  check(tex('\\frac{a}{b}') === '<span class="m-frac"><span><i>a</i></span><span><i>b</i></span></span>', '\\frac');
  check(tex('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}') === '<span class="m-mat m-b" style="--cols:2"><span><i>a</i></span><span><i>b</i></span><span><i>c</i></span><span><i>d</i></span></span>', 'a 2 × 2 matrix');
  check(tex('\\begin{cases} 1 & x \\\\ 0 \\end{cases}').includes('m-cases m-left') && tex('\\begin{cases} 1 & x \\\\ 0 \\end{cases}').includes('--cols:2'), 'cases with a short row');
  check(tex('\\begin{constructor}a\\end{constructor}').includes('m-mat'), 'an unknown environment, no "constructor" fence');
  check(tex('\\alpha + \\beta').includes('α') && tex('\\alpha + \\beta').includes('β'), 'Greek');
}

console.log('render.js: a formula and inline code');
{
  const h = inline('cost `$x$` and $y$');
  check(h === 'cost <code>$x$</code> and <span class="math"><i>y</i></span>', 'a formula inside inline code is code; one outside still draws', h);
  const h2 = inline('`a $b` c$');
  check(h2 === '<code>a $b</code> c$', 'a formula that starts inside code and ends after it isn’t drawn', h2);
  const h3 = inline('$a `b$ and c`');
  check(h3 === '$a <code>b$ and c</code>', 'one that starts before code and ends inside it isn’t either', h3);
  check(inline('$x$ then `code`') === '<span class="math"><i>x</i></span> then <code>code</code>', 'apart, both as usual');
  check(inline('``a`b`` $c$') === '<code>a`b</code> <span class="math"><i>c</i></span>', 'double backticks');
  check(inline('just a ` and $x$') === 'just a ` and <span class="math"><i>x</i></span>', 'a lone backtick is not code');
}

console.log('render.js: a link’s label holds no other link');
{
  const anchors = (h) => count(h, /<a[\s>]/g);
  const h = inline('[see #tag and https://x.example/a](https://example.org)');
  check(anchors(h) === 1 && h.includes('href="https://example.org"'), 'a web link whose label has a tag and an address: one link', h);
  check(h.includes('#tag') && h.includes('https://x.example/a'), 'their words still show', h);
  const h2 = inline('[**bold** #tag](https://example.org)');
  check(anchors(h2) === 1 && h2.includes('<strong>bold</strong>'), 'formatting in the label stays', h2);
  const h3 = inline('[about #tag and ~~https://x.example~~]([[Target]])');
  check(anchors(h3) === 1 && h3.includes('data-page="Target"'), 'a page link with its own words: one link, to its page', h3);
  const h4 = inline('[x ((6f0e8b1e-1111-4222-8333-444455556666)) {{video https://youtu.be/dQw4w9WgXcQ}}](https://example.org)');
  check(anchors(h4) === 1 && !h4.includes('bref') && !h4.includes('class="yt"'), 'no block reference or video player inside a link', h4);
  const h5 = inline('[**#Page**](https://example.org)');
  check(anchors(h5) === 1, 'a tag inside bold inside a label: no link', h5);
  // outside a label, as before
  const h6 = inline('#tag [[Page]] https://x.example [w](https://example.org)');
  check(anchors(h6) === 4, 'outside a label: each is its own link', h6);
  // a label that isn't safe to link stays a span: its words may still link
  const h7 = inline('[[[Page]]](javascript:alert(1))');
  check(!h7.includes('javascript:') || !/<a[^>]*href="javascript/.test(h7), 'never a javascript: link', h7);
}

if (fails) { console.log(`FAILED: ${fails}`); process.exit(1); }
console.log('all passed');

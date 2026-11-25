// Plain Node tests of the page's modules that load on their own (no dev server, no browser):
//   node dev/ui-tests/unit.mjs
// math.js (review claim 22a: a formula that would draw too much shows as its source) and render.js
// (review, medium: a formula inside inline code is code; a link's label holds no other link), ai.js on
// the phone (review, medium: an answer that never comes back ends the wait), in a process of its own.
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (process.argv[2] === '--android-ai') { await androidAi(); process.exit(0); }
const { tex } = await import('../../ui/math.js');
const { inline, propsHtml, pagesIn, splitList, tagBody } = await import('../../ui/render.js');

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

console.log('render.js: tags:: and alias:: values split only at commas outside [[ ]] (audit finding 9)');
{
  const pages = (html) => [...html.matchAll(/data-page="([^"]*)"/g)].map((m) => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  // the audit's case: a page name with a comma inside [[ ]]
  check(JSON.stringify(pages(propsHtml([['tags', '[[New York, NY]], travel']]))) === '["New York, NY","travel"]', 'tags:: [[New York, NY]], travel → two links, the comma kept in the name', propsHtml([['tags', '[[New York, NY]], travel']]));
  check(JSON.stringify(pages(propsHtml([['alias', 'NYC, [[New York, NY]]']]))) === '["NYC","New York, NY"]', 'alias:: too, the bracketed name last');
  check(JSON.stringify(pages(propsHtml([['tags', '#[[A, B]], #c, [[d]]']]))) === '["A, B","c","d"]', '#[[A, B]], #c and [[d]]: each without its # or brackets');
  check(JSON.stringify(pages(propsHtml([['tag', 'x, [[y, z]]']]))) === '["x","y, z"]' && JSON.stringify(pages(propsHtml([['aliases', 'p, [[q, r]]']]))) === '["p","q, r"]', 'tag:: and aliases:: as well');
  // as before for plain lists
  check(JSON.stringify(splitList('a, b,c')) === '["a","b","c"]', 'plain commas still split');
  check(JSON.stringify(splitList(' a ,, , b ')) === '["a","b"]', 'empty items name no page');
  check(JSON.stringify(splitList('[[ spaced ]]')) === '["spaced"]', 'spaces inside the brackets go');
  check(JSON.stringify(splitList('[[a, [[b, c]]]], d')) === '["a, [[b, c]]","d"]', 'nested brackets: the commas inside stay (as the core reads it)');
  check(JSON.stringify(splitList('[[open, b')) === '["[[open, b"]', 'an unclosed [[: the rest is one item (as the core reads it)');
  check(JSON.stringify(splitList('a]], b')) === '["a]]","b"]', 'a stray ]]: commas after it still split (as the core reads it)');
  check(JSON.stringify(splitList('')) === '[]', 'an empty value: no pages');
  // other properties are drawn as words, not split
  const other = propsHtml([['source', '[[New York, NY]], travel']]);
  check(pages(other).length === 1 && pages(other)[0] === 'New York, NY', 'another property: its [[link]] as written in the words', other);
}

console.log('render.js: one rule for a #tag (audit finding 10)');
{
  // the filter buttons of Linked references and To-dos read tags as they are drawn
  check(JSON.stringify(pagesIn('release #v1.2 today')) === '["v1.2"]', '#v1.2 is "v1.2", not "v1"', pagesIn('release #v1.2 today'));
  check(JSON.stringify(pagesIn('see #v1.2.')) === '["v1.2"]', 'a "." after it is the sentence\'s');
  check(JSON.stringify(pagesIn('#U.S. and #time: 5')) === '["U.S","time"]', 'a "." or ":" at its end is trimmed, as when drawn');
  check(JSON.stringify(pagesIn('#a:b #c/d #e-f')) === '["a:b","c/d","e-f"]', 'a ":" or "/" inside it is kept');
  check(JSON.stringify(pagesIn('#... #. #:')) === '[]', 'a tag of only dots or colons names no page');
  check(JSON.stringify(pagesIn('#x, #y; #z! #w?')) === '["x","y","z","w"]', 'commas, semicolons, ! and ? end it');
  check(JSON.stringify(pagesIn('a#b (#c) ,#d')) === '["c","d"]', 'only after a space, "(" or "," (not inside a word)');
  check(JSON.stringify(pagesIn('#[[New York, NY]] [[ Page ]]')) === '["New York, NY","Page"]', '#[[…]] and [[…]] as before');
  check(JSON.stringify(pagesIn('#a<b>')) === '["a"]', 'a "<" ends it, as when drawn');
  // what pagesIn reads is what inline draws, for the same words
  for (const w of ['#v1.2', '#U.S.', '#a:b:', '#x.y.z', '#café.', '#2026-11-23']) {
    const drawn = (inline(w).match(/data-page="([^"]*)"/) || [])[1];
    check(drawn === pagesIn(w)[0], `drawn and read the same: ${w} → ${drawn}`, `${drawn} vs ${pagesIn(w)[0]}`);
  }
  // writing a page's name after "#": bare only when it reads back as the same page
  check(tagBody('Sourdough') === 'Sourdough' && tagBody('v1.2') === 'v1.2' && tagBody('a:b') === 'a:b', 'plain names, and "." or ":" inside: bare');
  check(tagBody('U.S.') === '[[U.S.]]', 'a name ending in "." → [[U.S.]]');
  check(tagBody('Time:') === '[[Time:]]' && tagBody('a.:') === '[[a.:]]', 'a name ending in ":" (or ".:") → [[ ]]');
  check(tagBody('New York') === '[[New York]]' && tagBody('a,b') === '[[a,b]]' && tagBody('x#y') === '[[x#y]]' && tagBody('a<b') === '[[a<b]]', 'a space, comma, # or < → [[ ]] as before');
  for (const n of ['U.S.', 'Time:', 'v1.2', 'New York', 'Q&A?', '...', 'a.b.']) {
    const drawn = (inline('#' + tagBody(n)).match(/data-page="([^"]*)"/) || [])[1]?.replace(/&amp;/g, '&');
    check(drawn === n, `#${tagBody(n)} reads back as "${n}"`, drawn);
  }
}

console.log('ai.js on the phone: an answer that never comes back');
{
  // (a process of its own: api.js decides whether it's the phone once, when it is first loaded)
  const { execFileSync } = await import('node:child_process');
  let out;
  try { out = execFileSync(process.execPath, ['--no-warnings', new URL(import.meta.url).pathname, '--android-ai'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  for (const line of out.trim().split('\n')) {
    const [ok, ...words] = line.split(' ');
    check(ok === 'ok', words.join(' '), ok === 'ok' ? '' : line);
  }
}

console.log('the website demo\'s first notes: his wording (Nov 25)');
{
  // he asked (Nov 25): thinky is "a mardown based outliner"; "don't say adhd like minds. its for everyone";
  // "inspired by logse and obsidian" (Logseq and Obsidian)
  const fs = await import('node:fs');
  const intro = fs.readFileSync(new URL('../../web/demo/web-core.js', import.meta.url), 'utf8').match(/const INTRO = `([^`]*)`/)?.[1] ?? '';
  check(/Markdown-based outliner/.test(intro), 'it calls thinky a Markdown-based outliner', intro.slice(0, 120));
  check(!/ADHD/i.test(intro) && /for everyone/.test(intro), 'it says it is for everyone, with no ADHD wording');
  check(/Inspired by Logseq and Obsidian/.test(intro), 'inspired by Logseq and Obsidian');
}

if (fails) { console.log(`FAILED: ${fails}`); process.exit(1); }
console.log('all passed');

/** The phone's AI requests (ai.js send): Android's answer comes back as a "lean-ai" event; one that never
 *  comes, or a bridge that throws, must not leave the page waiting for ever. Prints "ok words" or "no words". */
async function androidAi() {
  const say = (c, m, x = '') => console.log((c ? 'ok ' : 'no ') + m + (c || !x ? '' : ' :: ' + String(x).slice(0, 200)));
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { classList: { toggle() {} } } });
  // the app's own commands (they build and read the requests): answered here, as the core does
  globalThis.fetch = async (url) => ({ ok: true, json: async () => (String(url).endsWith('ai_models_request') ? { method: 'GET', url: 'https://api.openai.com/v1/models' } : ['m1']) });
  let answer = 'never', sent = 0;
  globalThis.LeanAndroid = {
    aiSend(id, provider, req) {
      sent++;
      if (answer === 'throws') throw new Error('The bridge is gone');
      if (answer === 'answers') setTimeout(() => document.dispatchEvent(new CustomEvent('lean-ai', { detail: JSON.stringify({ id, status: 200, body: '{}' }) })), 5);
    },
  };
  // long waits pass at once here; the time asked for is noted
  const real = setTimeout, asked = [];
  globalThis.setTimeout = (f, ms, ...a) => { if (ms >= 10_000) asked.push(ms); return real(f, ms >= 10_000 ? 20 : ms, ...a); };
  const ai = await import('../../ui/ai.js');
  const s = { provider: 'openai', base: '', textModel: '', pictureModel: '', mark: true, extra: { polish: '' } };
  const t0 = Date.now();
  const err = await ai.listModels(s).then(() => null, (e) => e.message);
  say(err === 'The AI service didn’t answer in time. Try again.', 'no answer from Android: the wait ends, saying so', err);
  say(asked.includes(150_000) && ai.REPLY_MS === 150_000, 'after 150 s (Android’s own request gives up after 120 s)', asked);
  say(Date.now() - t0 < 2000 && sent === 1, 'sent once', sent);
  answer = 'throws';
  const err2 = await ai.listModels(s).then(() => null, (e) => e.message);
  say(err2 === 'The bridge is gone', 'the bridge throws: its words, at once', err2);
  answer = 'answers';
  asked.length = 0;
  const got = await ai.listModels(s).then((v) => v, (e) => 'error: ' + e.message);
  say(JSON.stringify(got) === '["m1"]', 'an answer in time: as before', got);
  // an answer that comes after the wait ended is let go (nothing is still waiting for it)
  answer = 'never';
  let id = null;
  LeanAndroid.aiSend = (i) => { id = i; };
  const err3 = await ai.listModels(s).then(() => null, (e) => e.message);
  document.dispatchEvent(new CustomEvent('lean-ai', { detail: JSON.stringify({ id, status: 200, body: '{}' }) }));
  say(/in time/.test(err3 || '') && !!id, 'a late answer changes nothing', err3);
}

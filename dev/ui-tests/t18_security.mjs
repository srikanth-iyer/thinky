// The security review (Oct 30, 2026): a note can't stop a page from drawing, files from the notes
// folder are never pages that run, and pictures from the web carry no referrer.
import { open, check, failures, write, go, BASE } from './lib.mjs';

// notes written before the page opens (as a sync app would bring them)
write('pages/Odd notes.md', [
  '- formula $\\toString$ and $\\constructor$ and $\\__proto__$ here',
  '- $$\\begin{constructor}a\\end{constructor}$$',
  '- file ![doc](../assets/report%zz.pdf)',
  '- picture ![p](https://example.org/p.png)',
  '- old web ![o](http://example.net/old.png) here',
  '- share ![s](\\\\evil.example\\s\\a.png) and ![t](//evil.example/t.png) and ![c](C:/Windows/w.png) and ![e](%5C%5Cevil.example%5Cu.png)',
  '- the last note still shows',
].join('\n') + '\n');
write('assets/evil.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>window.parent.postMessage("ran", "*")</script></svg>');

const { browser, page, errors } = await open();
const asked = [];
page.on('request', (r) => asked.push(r.url()));
console.log('a page with notes no rule expected still draws');
await go(page, '#/page/' + encodeURIComponent('Odd notes'));
await page.waitForSelector('.outline .blk', { timeout: 8000 });
const body = await page.evaluate(() => document.querySelector('.view')?.innerText || '');
check(!/Something went wrong/.test(body), 'no "Something went wrong"', body.slice(0, 200));
check(body.includes('the last note still shows') && body.includes('formula'), 'every note is there', body.slice(0, 300));
const img = await page.evaluate(() => document.querySelector('.view img[src^="https://example.org"]')?.getAttribute('referrerpolicy'));
check(img === 'no-referrer', 'a picture from the web is asked for without a referrer', String(img));

console.log('a picture on the old, open web (http://) is never fetched; its address stays a link');
const plain = asked.filter((u) => u.startsWith('http://example.net'));
check(plain.length === 0, 'no http:// picture asked for', plain.join(' '));
const off = await page.evaluate(() => { const e = document.querySelector('.view .pic-off'); return e && { text: e.textContent, href: e.querySelector('a')?.getAttribute('href') }; });
check(off && /Picture not shown/.test(off.text) && off.href === 'http://example.net/old.png' && /example\.net/.test(off.text), 'it says so, with a link to the address', JSON.stringify(off));
console.log('a picture never points at another computer or a drive');
const shares = asked.filter((u) => /evil\.example|%5C|Windows/i.test(u));
check(shares.length === 0, 'no request for \\\\server, //server or C: pictures', shares.join(' '));
const st = await page.evaluate(async (base) => (await fetch(base + '/vault/' + encodeURIComponent('\\\\evil.example\\s\\a.png'))).status, BASE);
check(st === 404, 'the server refuses a \\\\server path too', String(st));

console.log('a file from the notes folder is served as inert content');
const h = await page.evaluate(async (base) => { const r = await fetch(base + '/vault/assets/evil.svg'); return { csp: r.headers.get('content-security-policy') || '', sniff: r.headers.get('x-content-type-options') }; }, BASE);
check(/(^|;)\s*sandbox/.test(h.csp) && /default-src 'none'/.test(h.csp) && h.sniff === 'nosniff', 'sandboxed, no script, no sniffing', JSON.stringify(h));

const real = errors.filter((e) => !/a note could not be drawn|Failed to load resource/.test(e)); // (the web picture itself can't load here)
check(real.length === 0, 'no page errors', real.join('\n'));
await browser.close();
process.exit(failures() ? 1 : 0);

// Build 52 (0.6.1): the other AI features, against a stand-in AI service on this computer (as t31):
// Picture to text (the note menu and "/": the picture goes with the question, the words come in as
// sub-notes on Keep), Ask about this page (the page's ⋯ menu: the page and what links to it are read,
// each point names its source, "Add to page"), Suggest aliases and a description (into the page's
// properties), Suggest links (the Unlinked references' ✦: ticks and why, Link N, Undo). Nothing is
// saved before the filled button; buttons on one line, laptop and phone.
import http from 'node:http';
import { open, check, failures, go, sleep, write, read, readWhen, SHOTS } from './lib.mjs';

const seen = [];
const say = (body) => {
  if (body.includes('image_url')) return '- Talk plan for the [[CBeRa]] seminar\n  - why noise helps\n  - ask [[Nobody Here]]\n- Q&A';
  if (body.includes('The question:')) return '- The invoice for the fees, by Dec 15. [2]\n- The report, due in January. [3]';
  if (body.includes('The mentions to decide on')) return '1: yes - about the noise plots\n2: no - a footballer';
  if (body.includes('suggest other names')) return 'description: The CBR project that funds my fellowship\nalias: Sibera\nalias: Diogo\nalias: CBR fellowship';
  return 'Fine.';
};
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-small' }, { id: 'fake-vision' }] }));
    if (req.url === '/v1/chat/completions') return setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: say(body) } }] })), 300);
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// a tiny real PNG (1×1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fs = await import('node:fs');
const { VAULT } = await import('./lib.mjs');
fs.mkdirSync(VAULT + '/assets', { recursive: true });
fs.writeFileSync(VAULT + '/assets/board_1.png', PNG);
write('pages/Diogo Silva.md', 'alias:: Diogo\n\n- finance contact\n');
write('pages/CBeRa.md', '- Funding for my fellowship\n');
write('pages/Luis Rocha.md', '- collaborator\n');
write('pages/Board.md', '- Photo of the whiteboard ![board](../assets/board_1.png)\n- after it\n');
write('Diary/October 28th, 2026.md', '- asked Rita whether [[CBeRa]] covers the fees\n\t- needs the invoice by Dec 15\n');
write('Diary/October 9th, 2026.md', '- [[CBeRa]] report due end of January\n');
write('Diary/November 17th, 2026.md', '- ask Luis Rocha about the noise plots\n- Luis Rocha the footballer scored twice\n');
const BOARD = read('pages/Board.md');

const { browser, page, errors } = await open();
await page.evaluate((port) => localStorage.setItem('ai', JSON.stringify({ provider: 'other', base: `http://127.0.0.1:${port}/v1`, textModel: 'fake-small', pictureModel: 'fake-vision', mark: true })), PORT);
await page.reload();

const oneLine = async (sel) => {
  const tops = await page.locator(sel).evaluateAll((bs) => bs.map((b) => [b.textContent.trim(), Math.round(b.getBoundingClientRect().top), b.classList.contains('ghost'), b.scrollWidth <= b.clientWidth + 1]));
  return { tops, ok: tops.length > 0 && tops.every((t) => Math.abs(t[1] - tops[0][1]) <= 1 && t[3]), filledFirst: !tops[0]?.[2] && tops.slice(1).every((t) => t[2]) };
};

console.log('1. Picture to text');
await go(page, '#/page/Board');
await page.waitForSelector('.blk');
await page.locator('.blk').first().locator('> .bul').click({ button: 'right' });
await page.waitForSelector('.note-menu');
check((await page.locator('.note-menu').innerText()).includes('Picture to text'), 'the note menu offers it on a note with a picture');
await page.locator('.note-menu :text("Picture to text")').first().click();
await page.waitForSelector('.pz-pic .pz-bar', { timeout: 8000 });
const preq = JSON.parse(seen.findLast((r) => r.url === '/v1/chat/completions').body);
check(preq.model === 'fake-vision', 'the model for pictures');
check(preq.messages[1].content[0].image_url.url === 'data:image/png;base64,' + PNG.toString('base64'), 'the picture goes with the question');
const shownPic = await page.locator('.pz-pic').innerText();
check(shownPic.includes('Talk plan for the') && shownPic.includes('why noise helps') && shownPic.includes('Q&A'), 'the words are shown under the note', shownPic);
check(read('pages/Board.md') === BOARD, 'nothing saved yet');
const pb = await oneLine('.pz-pic .pz-bar .pz-b');
check(pb.ok && pb.filledFirst && pb.tops.map((t) => t[0]).join(',') === 'Keep,Retry,Undo', 'Keep, Retry, Undo on one line', JSON.stringify(pb.tops));
await sleep(900);
await page.screenshot({ path: SHOTS + '/t32-picture.png' });
await page.click('.pz-pic [data-pz="keep"]');
const afterPic = await readWhen('pages/Board.md', (t) => t.includes('Talk plan'));
check(afterPic === '- Photo of the whiteboard ![board](../assets/board_1.png)\n\t- Talk plan for the [[CBeRa]] seminar\n\t  by:: ai\n\t\t- why noise helps\n\t\t- ask Nobody Here\n\t- Q&A\n\t  by:: ai\n- after it\n', 'kept: sub-notes under the picture, an invented page as plain words', afterPic);
await page.keyboard.press('Control+z');
check((await readWhen('pages/Board.md', (t) => t === BOARD)) === BOARD, 'one Undo step');

console.log('2. "/picture to text" while typing');
await page.locator('.blk', { hasText: 'after it' }).first().locator('> .bc').click();
await page.keyboard.press('End');
await page.keyboard.type(' /picture');
await page.waitForSelector('#ac:not([hidden])');
check((await page.locator('#ac').innerText()).includes('Picture to text'), 'in the "/" list');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

console.log('3. Ask about this page');
await go(page, '#/page/CBeRa');
await page.waitForSelector('.blk');
await page.click('.title-row [data-a="more"]');
await page.waitForSelector('.pop:not([hidden])');
const pmenu = await page.locator('.pop:not([hidden])').innerText();
check(pmenu.includes('Ask about this page') && pmenu.includes('Suggest aliases and a description'), 'the page menu offers both', pmenu);
await page.locator('.pop:not([hidden]) :text("Ask about this page")').click();
await page.waitForSelector('.ai-ask .ask-q');
await page.fill('.ask-q', 'What do I still owe?');
await page.keyboard.press('Enter');
await page.waitForSelector('.ask-points', { timeout: 8000 });
const areq = JSON.parse(seen.findLast((r) => r.url === '/v1/chat/completions').body);
check(areq.messages[1].content.includes('needs the invoice by Dec 15') && areq.messages[1].content.includes('[1] The page "CBeRa"'), 'the page and what links to it are read');
const pts = await page.locator('.ask-points li').allInnerTexts();
check(pts.length === 2 && /October 28th, 2026/.test(pts[0]) && /October 9th, 2026/.test(pts[1]), 'each point names where it came from', pts.join(' | '));
const ab = await oneLine('.ai-ask .pz-bar .pz-b');
check(ab.ok && ab.filledFirst, 'Add to page, Copy, Retry on one line', JSON.stringify(ab.tops));
check(read('pages/CBeRa.md') === '- Funding for my fellowship\n', 'nothing saved yet');
await page.screenshot({ path: SHOTS + '/t32-ask.png' });
await page.click('.ai-ask [data-a="add"]');
const afterAsk = await readWhen('pages/CBeRa.md', (t) => t.includes('What do I still owe?'));
check(afterAsk === '- Funding for my fellowship\n- What do I still owe?\n  by:: ai\n\t- The invoice for the fees, by Dec 15. ([[October 28th, 2026]])\n\t- The report, due in January. ([[October 9th, 2026]])\n'
  || afterAsk.includes('- What do I still owe?') && afterAsk.includes('([[October 28th, 2026]])'), 'Add to page: the question, the points under it, their days linked', afterAsk);
await page.keyboard.press('Control+z');
await readWhen('pages/CBeRa.md', (t) => !t.includes('owe'));

console.log('4. Suggest aliases and a description');
await page.click('.title-row [data-a="more"]');
await page.locator('.pop:not([hidden]) :text("Suggest aliases and a description")').click();
await page.waitForSelector('.ai-panel .sug-chips', { timeout: 8000 });
const chips = await page.locator('.sug-chip').allInnerTexts();
check(chips.join('|') === 'Sibera|CBR fellowship', 'another page\'s alias (Diogo) is never offered', chips.join('|'));
await page.locator('.sug-chip', { hasText: 'CBR fellowship' }).click();
check((await page.locator('.ai-panel [data-a="add"]').innerText()).trim() === 'Add 2', 'the count follows the ticks');
await page.screenshot({ path: SHOTS + '/t32-aliases.png' });
await page.click('.ai-panel [data-a="add"]');
const afterNames = await readWhen('pages/CBeRa.md', (t) => t.includes('alias::'));
check(afterNames === 'alias:: Sibera\ndescription:: The CBR project that funds my fellowship\n\n- Funding for my fellowship\n', 'into the page\'s properties', afterNames);
await page.waitForFunction(() => /Sibera/.test(document.querySelector('.page-props')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
check(/Sibera/.test(await page.locator('.page-props').innerText()), 'shown under the title');

console.log('5. Suggest links');
await go(page, '#/page/Luis Rocha');
await page.waitForSelector('.sec.unlinked .ai-chip', { timeout: 8000 });
await page.click('.sec.unlinked .ai-chip');
await page.waitForSelector('.ai-links', { timeout: 8000 });
const refs = await page.locator('.ai-ref').evaluateAll((rs) => rs.map((r) => [r.querySelector('input').checked, r.textContent]));
check(refs.length === 2 && refs[0][0] && /noise plots/.test(refs[0][1]) && !refs[1][0] && /a footballer/.test(refs[1][1]), 'ticked when it means the page, unticked with why when not', JSON.stringify(refs));
const lb = await oneLine('.sec.unlinked .pz-bar .pz-b');
check(lb.ok && lb.filledFirst && lb.tops[0][0] === 'Link 1', 'Link 1, Retry, Undo on one line', JSON.stringify(lb.tops));
await page.screenshot({ path: SHOTS + '/t32-links.png' });
await page.click('.sec.unlinked [data-a="link"]');
const afterLinks = await readWhen('Diary/November 17th, 2026.md', (t) => t.includes('[['));
check(afterLinks === '- ask [[Luis Rocha]] about the noise plots\n- Luis Rocha the footballer scored twice\n', 'only the ticked one is linked', afterLinks);
await page.waitForSelector('#toast .toast-act', { timeout: 4000 });
await page.click('#toast .toast-act');
check((await readWhen('Diary/November 17th, 2026.md', (t) => !t.includes('[['))).includes('ask Luis Rocha about'), 'Undo puts the note back');

console.log('6. phone: the buttons stay on one line');
await page.setViewportSize({ width: 320, height: 700 });
await go(page, '#/page/CBeRa');
await page.waitForSelector('.blk');
await page.click('.title-row [data-a="more"]');
await page.locator('.pop:not([hidden]) :text("Ask about this page")').click();
await page.fill('.ask-q', 'What do I still owe?');
await page.keyboard.press('Enter');
await page.waitForSelector('.ask-points', { timeout: 8000 });
const phb = await oneLine('.ai-ask .pz-bar .pz-b');
check(phb.ok, 'one line at 320px', JSON.stringify(phb.tops));
await page.screenshot({ path: SHOTS + '/t32-ask-phone.png' });

console.log('7. without an AI set up, none of it shows');
await page.evaluate(() => localStorage.removeItem('ai'));
await page.setViewportSize({ width: 1200, height: 800 });
await page.reload();
await go(page, '#/page/Luis Rocha');
await page.waitForSelector('.blk');
check(await page.locator('.ai-chip').count() === 0 || !(await page.locator('.ai-chip').first().isVisible()), 'no Suggest links');
await page.click('.title-row [data-a="more"]');
check(!(await page.locator('.pop:not([hidden])').innerText()).includes('Ask about'), 'no AI in the page menu');

server.close();
const errs = errors.filter((e) => !/status of 400/.test(e));
check(errs.length === 0, 'no script errors', errs.join('\n'));
await browser.close();
process.exit(failures() ? 1 : 0);

// Build 51 (0.6.0): the optional AI features. Settings → AI (a service, its key kept outside the page,
// models from the service's own list), and Polish note: the AI's version shown in the note, saved only
// on Keep, one line of buttons, links only to pages that exist. Against a stand-in AI service on this
// computer (the "Other (OpenAI-style)" kind), so the requests go out through the dev server's curl as
// the app's go through Windows' curl.exe. Also Calm plain's own teal.
import http from 'node:http';
import { open, check, failures, go, sleep, write, read, readWhen, SHOTS } from './lib.mjs';

// ---- the stand-in AI service
const seen = [];
const ANSWER = '- TODO Call [[Diogo Silva]] about the [[CBeRa]] invoice\n  SCHEDULED: <2026-11-24 Tue>\n- TODO Ask [[Nobody Page]] about the noise plots #nosuchtag\n  priority:: high';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-small' }, { id: 'fake-vision' }] }));
    if (req.url === '/v1/chat/completions') {
      const slow = body.includes('slow please');
      return setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: body.includes('already fine') ? 'This is already fine.' : ANSWER } }] })), slow ? 1500 : 300);
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

write('pages/Diogo Silva.md', 'alias:: Diogo\n\n- finance contact\n');
write('pages/CBeRa.md', '- the project\n');
write('pages/Polish test.md', '- call diogo abt sibera invoice next tue. also ask luis re noise plots\n  id:: 6f0e8b1e-1111-4222-8333-444455556666\n- This is already fine.\n- slow please tidy\n');
const BEFORE = read('pages/Polish test.md');

const { browser, page, errors } = await open();

console.log('1. nothing shows before an AI is set up');
await go(page, '#/page/Polish test');
await page.waitForSelector('.blk');
check(!(await page.evaluate(() => document.documentElement.classList.contains('ai-on'))), 'no ai-on');
await page.locator('.blk').first().hover();
check(await page.locator('.pz-spark').count() === 0 || !(await page.locator('.pz-spark').isVisible()), 'no ✦ on the note');
await page.locator('.blk > .bul').first().click({ button: 'right' });
await page.waitForSelector('.note-menu');
check(!(await page.locator('.note-menu').innerText()).includes('Polish'), 'no Polish note in the note menu');
await page.keyboard.press('Escape');

console.log('2. Settings → AI');
await go(page, '#/settings/ai');
await page.waitForSelector('.ai-card');
const opts = await page.locator('[data-f="provider"] option').allInnerTexts();
check(opts[0] === 'Off' && opts.includes('Claude (Anthropic)') && opts.includes('Ollama (on this computer)') && opts.includes('Other (OpenAI-style)'), 'the services, Off first', opts.join(' | '));
check(await page.locator('.ai-models').isHidden(), 'nothing else until one is picked');
await page.selectOption('[data-f="provider"]', 'claude');
check(await page.locator('.ai-key').isVisible() && await page.locator('.ai-base').isHidden(), 'Claude: a key, no address');
await page.selectOption('[data-f="provider"]', 'ollama');
check(await page.locator('.ai-key').isHidden() && await page.locator('.ai-base').isVisible(), 'Ollama: an address, no key');
await page.selectOption('[data-f="provider"]', 'other');
await page.fill('[data-f="base"]', `http://example.com/v1`);
await page.locator('[data-f="base"]').dispatchEvent('change');
await page.waitForFunction(() => /Only a program on this computer/.test(document.querySelector('.ai-test')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check(/Only a program on this computer/.test(await page.locator('.ai-test').innerText()), 'http to the internet is refused', await page.locator('.ai-test').innerText());
await page.fill('[data-f="base"]', `http://127.0.0.1:${PORT}/v1`);
await page.locator('[data-f="base"]').dispatchEvent('change');
await page.fill('[data-f="key"]', 'sk-local-1');
await page.click('[data-a="savekey"]');
await page.waitForFunction(() => /A key is saved/.test(document.querySelector('.ai-keysay')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
for (let k = 0; k < 40 && !seen.some((r) => r.url === '/v1/models' && r.auth); k++) await sleep(100);
await page.waitForFunction(() => /Connected: 2 models/.test(document.querySelector('.ai-test')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
check(/Connected: 2 models/.test(await page.locator('.ai-test').innerText()), 'the key is saved and the models are listed', await page.locator('.ai-test').innerText());
check(/A key is saved/.test(await page.locator('.ai-keysay').innerText()) && await page.inputValue('[data-f="key"]') === '', 'it says a key is saved, and the box is empty again (the page never gets it back)');
check(seen.some((r) => r.url === '/v1/models' && r.auth === 'Bearer sk-local-1'), 'the key went in the request header');
const tm = await page.locator('[data-f="textModel"] option').allInnerTexts();
check(tm.includes('fake-small') && tm.includes('fake-vision') && tm.at(-1) === 'Type a name…', 'the text model list', tm.join(' | '));
await page.selectOption('[data-f="textModel"]', 'fake-small');
const pm = await page.locator('[data-f="pictureModel"] option').allInnerTexts();
check(pm[0] === 'Same as the model for text' && pm.includes('fake-vision'), 'the picture model list', pm.join(' | '));
await page.selectOption('[data-f="pictureModel"]', 'fake-vision');
check(await page.evaluate(() => document.documentElement.classList.contains('ai-on')), 'ai-on once a model is chosen');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ai')));
check(saved.provider === 'other' && saved.textModel === 'fake-small' && saved.pictureModel === 'fake-vision' && saved.mark === true && !JSON.stringify(saved).includes('sk-local'), 'kept on this device, without the key', JSON.stringify(saved));
await page.locator('.ai-adv summary').click();
await page.fill('[data-f="polish"]', 'Keep my abbreviations.');
await page.locator('[data-f="polish"]').dispatchEvent('change');
await page.screenshot({ path: SHOTS + '/t31-settings-ai.png', fullPage: true });

console.log('3. Polish note: the AI\'s version in the note, not saved');
await go(page, '#/page/Polish test');
await page.waitForSelector('.blk');
const first = page.locator('.blk').first();
await first.hover();
await sleep(200);
check(await page.locator('.blk').first().locator('.pz-spark').isVisible(), 'the ✦ at the end of the note under the mouse');
const sb = await page.locator('.blk').first().locator('.pz-spark').boundingBox(), wb = await page.locator('.blk').first().locator('> .bc').boundingBox();
check(sb.x >= wb.x + wb.width - 1, 'in the margin, never on the words', JSON.stringify([sb, wb]));
await page.locator('.blk').first().locator('.pz-spark').click();
await page.waitForSelector('.ai-menu', { timeout: 3000 });
check(await page.locator('.ai-menu').textContent().then((t) => /Nothing changes until you press Keep/.test(t) && /Polish note/.test(t)), 'the ✦ first opens a small menu that says what it does');
check(!seen.some((r) => r.url === '/v1/chat/completions'), 'nothing is asked of the AI by the ✦ alone');
await page.locator('.ai-menu button', { hasText: 'Polish note' }).click();
await page.waitForSelector('.blk.pz-working .pz-sweep', { timeout: 3000 }).catch(() => {});
check(await page.locator('.blk.pz-working .pz-sweep').count() === 1, 'while it waits: the sweeping line');
await page.waitForSelector('.pz-bar', { timeout: 8000 });
const req = seen.findLast((r) => r.url === '/v1/chat/completions');
const sent = JSON.parse(req.body);
check(sent.model === 'fake-small' && req.auth === 'Bearer sk-local-1', 'the model chosen, with the key');
check(sent.messages[0].content.includes('Never make up a page name') && sent.messages[0].content.endsWith('Keep my abbreviations.'), 'the fixed rules, then his own wishes');
check(sent.messages[1].content.includes('Diogo Silva (also called: Diogo)') && !sent.messages[1].content.includes('id::'), 'nearby pages offered; the note\'s id never sent');
const shown = await page.locator('.pz').innerText();
check(shown.includes('Call') && shown.includes('Diogo Silva') && shown.includes('Nobody Page'), 'the AI\'s version is shown in the note', shown);
check(await page.locator('.pz .pz-note').nth(1).locator('a.pl', { hasText: 'Nobody Page' }).count() === 0, 'an invented page is plain words, not a link');
check(await page.locator('.pz-new').count() > 3, 'the new words are tinted');
check(/no such page or tag\): Nobody Page, nosuchtag/.test(await page.locator('.pz-why').innerText()), 'it says which were left as plain words');
const tops = await page.locator('.pz-bar .pz-b').evaluateAll((bs) => bs.map((b) => [b.textContent.trim(), Math.round(b.getBoundingClientRect().top), b.classList.contains('ghost')]));
check(tops.map((t) => t[0]).join(',') === 'Keep,Changes,Retry,Undo' && tops.every((t) => t[1] === tops[0][1]), 'Keep, Changes, Retry, Undo on one line', JSON.stringify(tops));
check(!tops[0][2] && tops.slice(1).every((t) => t[2]), 'Keep the only filled one');
check(read('pages/Polish test.md') === BEFORE, 'nothing is saved yet');
await sleep(1500); // (the words fade in)
await page.screenshot({ path: SHOTS + '/t31-polish-shown.png' });
await page.click('[data-pz="diff"]');
await sleep(300);
check(await page.locator('.pz-diff.open').count() === 1 && (await page.locator('.pz-old').innerText()).includes('call diogo abt'), 'Changes: the old words, struck');
const below = await page.locator('.blk').nth(1).boundingBox();
check(below.y > (await page.locator('.pz-diff').boundingBox()).y, 'it opens in the page, moving the notes below down');
await page.screenshot({ path: SHOTS + '/t31-polish-changes.png' });

console.log('4. Undo leaves it; Keep saves it (one Undo step)');
await page.click('[data-pz="undo"]');
check(await page.locator('.pz').count() === 0 && (await page.locator('.blk').first().innerText()).includes('call diogo abt'), 'Undo: the note as it was');
await page.locator('.blk').first().hover();
await page.locator('.blk').first().locator('.pz-spark').click(); await page.locator('.ai-menu button', { hasText: 'Polish note' }).click();
await page.waitForSelector('.pz-bar', { timeout: 8000 });
await page.click('[data-pz="keep"]');
const after = await readWhen('pages/Polish test.md', (t) => t.includes('TODO Call'));
check(after.startsWith('- TODO Call [[Diogo Silva]] about the [[CBeRa]] invoice\n  SCHEDULED: <2026-11-24 Tue>\n  id:: 6f0e8b1e-1111-4222-8333-444455556666\n  by:: ai\n- TODO Ask Nobody Page about the noise plots nosuchtag\n  by:: ai\n- This is already fine.'), 'kept: two notes, its id kept, by:: ai, no invented link or property', after);
check(/Polished the note into 2 notes/.test(await page.locator('#toast').innerText()), 'the message, with Undo');
await page.click('#toast .toast-act');
check((await readWhen('pages/Polish test.md', (t) => t === BEFORE)) === BEFORE, 'Undo puts it all back');

console.log('4b. a click on the AI\'s words edits them before Keep (Build 54)');
await page.locator('.blk').first().hover();
await page.locator('.blk').first().locator('.pz-spark').click(); await page.locator('.ai-menu button', { hasText: 'Polish note' }).click();
await page.waitForSelector('.pz-bar', { timeout: 8000 });
await page.locator('.pz .pz-note').nth(1).click();
check(await page.locator('.pz .pz-ed').count() === 2, 'each of its notes becomes a text box');
check(await page.evaluate(() => document.activeElement?.classList.contains('pz-ed') && document.activeElement === document.querySelectorAll('.pz-ed')[1]), 'the one clicked has the keyboard');
check(!(await page.locator('.pz .pz-ed').first().inputValue()).includes('id::'), 'its id:: is kept aside, not shown');
await page.keyboard.press('Escape');
check(await page.locator('.pz .pz-note').count() === 2 && await page.locator('.pz').count() === 1, 'Esc shows them drawn again, the suggestion still open');
await page.locator('.pz .pz-note').nth(1).click();
await page.locator('.pz .pz-ed').nth(1).fill('TODO Ask Felipe about the noise plots');
await page.locator('.pz .pz-ed').nth(1).press('Tab');
await page.screenshot({ path: SHOTS + '/t31-polish-editing.png' });
check(read('pages/Polish test.md') === BEFORE, 'still nothing saved while editing');
await page.click('[data-pz="keep"]');
const edited = await readWhen('pages/Polish test.md', (t) => t.includes('Ask Felipe'));
check(edited.startsWith('- TODO Call [[Diogo Silva]] about the [[CBeRa]] invoice\n  SCHEDULED: <2026-11-24 Tue>\n  id:: 6f0e8b1e-1111-4222-8333-444455556666\n  by:: ai\n- TODO Ask Felipe about the noise plots\n- This is already fine.'), 'kept as typed: the first as the AI wrote it with its id, the second as changed', edited);
await page.click('#toast .toast-act');
check((await readWhen('pages/Polish test.md', (t) => t === BEFORE)) === BEFORE, 'Undo puts it back');

console.log('5. nothing to change; Esc; the note menu and the "/" list');
await page.locator('.blk', { hasText: 'already fine' }).first().locator('> .bul').click({ button: 'right' });
await page.waitForSelector('.note-menu');
await page.locator('.note-menu [data-id="polish"], .note-menu :text("Polish note")').first().click();
await page.waitForFunction(() => /already reads well/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
check(/already reads well/.test(await page.locator('#toast').innerText()), 'a note the AI leaves alone: it says so');
await page.locator('.blk', { hasText: 'slow please' }).first().hover();
await page.locator('.blk', { hasText: 'slow please' }).first().locator('.pz-spark').click(); await page.locator('.ai-menu button', { hasText: 'Polish note' }).click();
await page.waitForSelector('.pz-bar', { timeout: 8000 });
await page.keyboard.press('Escape');
check(await page.locator('.pz').count() === 0, 'Esc closes it, nothing changed');
const bc = page.locator('.blk', { hasText: 'slow please' }).first().locator('> .bc');
await bc.click();
await page.keyboard.press('End');
await page.keyboard.type(' /polish');
await page.waitForSelector('#ac:not([hidden])');
check((await page.locator('#ac').innerText()).includes('Polish note'), '"/polish" offers it');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

console.log('6. Calm plain\'s own teal');
const teal = await page.evaluate(() => { const d = document.createElement('div'); d.dataset.skin = 'calmplain'; const i = document.createElement('i'); i.style.color = 'var(--accent)'; d.append(i); document.body.append(d); const c = getComputedStyle(i).color; const l = (i.style.color = 'var(--link)', getComputedStyle(i).color); d.remove(); return [c, l]; });
check(teal[0] === 'rgb(15, 116, 135)' && teal[1] === 'rgb(11, 103, 120)', 'accent and links one teal family', teal.join(' '));

for (const look of ['thinky', 'calmplain', 'thinkynight']) {
  await page.evaluate((l) => window.leanApp?.setSkin?.(l), look);
  await sleep(300);
  await page.locator('.blk').first().hover();
  await page.locator('.blk').first().locator('.pz-spark').click(); await page.locator('.ai-menu button', { hasText: 'Polish note' }).click();
  await page.waitForSelector('.pz-bar', { timeout: 8000 });
  await sleep(900);
  await page.screenshot({ path: `${SHOTS}/t31-look-${look}.png` });
  await page.click('[data-pz="undo"]');
}

console.log('7. a phone: ✦ in the toolbar');
const ph = await open({ viewport: { width: 390, height: 800 }, touch: true });
await ph.page.evaluate((s) => localStorage.setItem('ai', JSON.stringify(s)), saved);
await ph.page.reload();
await ph.page.waitForSelector('.sheet .outline');
await go(ph.page, '#/page/Polish test');
await ph.page.waitForSelector('.blk');
await ph.page.locator('.blk > .bc').first().tap();
await ph.page.waitForSelector('textarea.ed');
await sleep(300);
check(await ph.page.locator('#toolbar [data-t="polish"]').isVisible(), 'the toolbar has ✦');
check(await ph.page.locator('.pz-spark').count() === 0 || !(await ph.page.locator('.pz-spark').first().isVisible()), 'and no ✦ on the note itself');
await ph.page.locator('#toolbar [data-t="polish"]').tap(); await ph.page.waitForSelector('.ai-menu'); await ph.page.locator('.ai-menu button', { hasText: 'Polish note' }).tap();
await ph.page.waitForSelector('.pz-bar', { timeout: 8000 });
await sleep(900);
const pt = await ph.page.locator('.pz-bar .pz-b').evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.right)]; }));
check(pt.every((t) => Math.abs(t[0] - pt[0][0]) <= 1) && pt.every((t) => t[1] <= 390 - 8), 'one line on a phone too, inside the screen', JSON.stringify(pt));
await ph.page.screenshot({ path: SHOTS + '/t31-phone.png' });
check(ph.errors.filter((e) => !/status of 400/.test(e)).length === 0, 'no page errors (phone)', ph.errors.join('\n'));
await ph.browser.close();

const real = (es) => es.filter((e) => !/status of 400/.test(e)); // (the refusals checked above come back as 400s)
check(real(errors).length === 0, 'no page errors', real(errors).join('\n'));
await browser.close();
server.close();
if (failures()) process.exitCode = 1;

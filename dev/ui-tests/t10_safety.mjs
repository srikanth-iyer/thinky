// Safety: "Check this folder" lists the pictures nothing uses and moves them to the bin; a safety copy
// of the notes changed lately is made each time the folder opens, and a note can be put back from one.
import fs from 'node:fs';
import { open, read, write, exists, check, failures, sleep, go, BASE, VAULT, SHOTS } from './lib.mjs';

const { browser, page, errors } = await open();

console.log('Check this folder: pictures nothing uses');
// Every picture a test makes is new (the file system knows when each was made), and pictures from the
// last 3 days are left alone: the dev server looks at them as from 4 days later (X-Test-Now).
const later = Math.floor(Date.now() / 1000) + 4 * 86400;
for (const cmd of ['check', 'bin_pictures']) {
  await page.route(`**/api/${cmd}`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-test-now': String(later) } }));
}
const pic = (name) => fs.copyFileSync(VAULT + '/assets/unused.png', VAULT + '/assets/' + name);
pic('keep.png'); // another picture nothing uses
pic('fresh.png'); // and one that arrives "then" (its note may still be on its way)
fs.utimesSync(VAULT + '/assets/fresh.png', later, later);
pic('Screenshot (2).png'); // names that look like the bin's own marks, or like a folder's
pic('photo_2024.png');
fs.mkdirSync(VAULT + '/assets/photo');
// a bin with many deleted pages (Logseq keeps them there too)
fs.mkdirSync(VAULT + '/logseq/.recycle', { recursive: true });
for (let i = 0; i < 60; i++) write(`logseq/.recycle/pages_Old page ${i}.md`, `- deleted page ${i}\n`);
await go(page, '#/settings');
await page.locator('[data-a="check"]').click();
await page.waitForSelector('.pics-box h3', { timeout: 5000 });
const names = await page.locator('.pics .nm').allTextContents();
check(names.join(',') === 'Screenshot (2).png,keep.png,photo_2024.png,unused.png', 'lists only the pictures nothing uses (not the one in a page, the one on a whiteboard, the PDF or the one from the last 3 days)', names.join(','));
const said = await page.locator('.pics-box').textContent();
check(/4 of the 6 pictures/.test(said) && /\d KB in total/.test(said), 'with how many pictures were checked, and the total size', said);
check(said.includes('1 added in the last 3 days isn’t listed'), 'and how many new ones were left out', said);
const shows = await page.waitForFunction(() => { const i = document.querySelector('.pics img'); return i && i.complete && i.naturalWidth === 40; }, null, { timeout: 3000 }).then(() => true, () => false);
check(shows, 'a small picture of each shows');
check(await page.locator('.pics input[type="checkbox"]:checked').count() === 4, 'each has a tick box, all ticked');
await page.locator('.pics label', { hasText: 'keep.png' }).click(); // untick it
check(await page.locator('[data-a="bin-pics"]').textContent() === 'Move 3 to the bin…', 'the button counts the ticked ones', await page.locator('[data-a="bin-pics"]').textContent());
await page.screenshot({ path: SHOTS + '/check-pictures.png' });
await page.locator('[data-a="bin-pics"]').click();
await page.waitForSelector('.modal');
const asked = await page.locator('.modal').textContent();
check(asked.includes('logseq/.recycle') && asked.includes('“assets%2F”') && asked.includes('Put back'), 'it asks first, saying where they go, their names there and how to bring one back', asked);
await page.locator('.modal [data-v="1"]').click();
await sleep(800);
check(['unused.png', 'Screenshot (2).png', 'photo_2024.png'].every((n) => !exists('assets/' + n) && exists('logseq/.recycle/assets%2F' + n)), '“Move to the bin” moves the ticked ones into logseq/.recycle, each named by where it came from');
check(exists('assets/keep.png') && exists('assets/fresh.png') && exists('assets/dot.png') && exists('assets/board.png') && exists('assets/paper.pdf'), 'the unticked one and the others stay in assets');
check((await page.locator('.pics-box').textContent()).includes('Moved 3 pictures to the bin'), 'and it says so');
console.log('the bin lists the pictures, all of them, with “Put back”');
const binPics = page.locator('.bin-pics li');
check(await binPics.count() === 3 && await page.locator('.bin-pages li').count() === 50, '“Pictures” has all three, even with 60 deleted pages above (the newest 50 shown)', await binPics.count());
const binShows = await page.waitForFunction(() => { const i = document.querySelector('.bin-pics img'); return i && i.complete && i.naturalWidth === 40; }, null, { timeout: 3000 }).then(() => true, () => false);
check(binShows, 'each with a small picture');
await page.locator('.bin-pics').evaluate((el) => el.previousElementSibling.scrollIntoView());
await page.screenshot({ path: SHOTS + '/bin-pictures.png' });
for (const n of ['Screenshot (2).png', 'photo_2024.png', 'unused.png']) {
  const row = page.locator('.bin-pics li', { hasText: n });
  await row.locator('button').click();
  await sleep(500);
  check(exists('assets/' + n) && !exists('logseq/.recycle/assets%2F' + n), `Put back: “${n}” is in assets again, exactly as it was`);
  check((await page.locator('#toast').textContent()).includes(`Put “${n}” back in assets`), 'and it says so', await page.locator('#toast').textContent());
}
check(!fs.readdirSync(VAULT + '/assets/photo').length && await binPics.count() === 0, 'nothing went into the folder whose name starts “photo”, and the bin has no pictures left');
// one from a folder inside assets (moved to the bin earlier): it goes back there, and the message says so
fs.copyFileSync(VAULT + '/assets/unused.png', VAULT + '/logseq/.recycle/assets%2Fsub%2Fdeep.png');
await page.evaluate(() => window.leanApp.binChanged());
await page.locator('.bin-pics li', { hasText: 'sub/deep.png' }).locator('button').click();
await sleep(500);
check(exists('assets/sub/deep.png') && !exists('logseq/.recycle/assets%2Fsub%2Fdeep.png'), 'a picture from a folder inside assets goes back into that folder (made again if gone)');
check((await page.locator('#toast').textContent()).includes('Put “deep.png” back in assets/sub.'), 'and the message names that folder', await page.locator('#toast').textContent());
await page.unroute('**/api/check');
await page.unroute('**/api/bin_pictures');

console.log('safety copies');
const card = page.locator('.card', { has: page.locator('h2', { hasText: 'Safety copies' }) });
const rows = card.locator('.sc-list [data-id]');
// copies are made in the background: look again (Settings redrawn) until they're there
const copiesShown = async (n) => {
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.leanApp.go('settings'));
    await sleep(250);
    if ((await rows.count()) >= n) return true;
  }
  return false;
};
check(await copiesShown(1), 'one was made when the folder opened (the sample notes are all new)');
// a note gets overwritten (say by a bad sync), then the app starts again
const good = read('pages/Marta Pell.md');
write('pages/Marta Pell.md', '- oops, overwritten\n');
await page.goto(BASE + '/?t=' + Date.now() + '#/settings');
await page.waitForSelector('.card h2');
check(await copiesShown(2), 'starting again with a changed note makes another, newest first');
check(/\d+ notes$/.test((await rows.first().textContent()).trim()), 'each says when it was made and how many notes it has', await rows.first().textContent());
await rows.nth(1).click(); // the older one, from before the note was overwritten
await sleep(400);
const noteRow = card.locator('.sc-list [data-p="pages/Marta Pell.md"]');
check((await noteRow.count()) === 1 && (await noteRow.textContent()).includes('changed since'), 'opening a copy lists its notes; this one has changed since');
await noteRow.click();
await sleep(400);
check((await card.locator('.sc-text').textContent()) === good, 'opening a note shows its text as it was (read-only)', await card.locator('.sc-text').textContent());
await page.screenshot({ path: SHOTS + '/safety-copy.png' });
await card.locator('[data-a="put-back"]').click();
await page.waitForSelector('.modal');
check((await page.locator('.modal').textContent()).includes('logseq/bak'), 'it asks first, saying the text as it is now is kept');
await page.locator('.modal [data-v="1"]').click();
await sleep(800);
check(read('pages/Marta Pell.md') === good, '“Put this version back” writes the old text', read('pages/Marta Pell.md'));
const bak = VAULT + '/logseq/bak/pages/Marta Pell';
const kept = fs.existsSync(bak) ? fs.readdirSync(bak).map((f) => fs.readFileSync(bak + '/' + f, 'utf8')) : [];
check(kept.length === 1 && kept[0] === '- oops, overwritten\n', 'after keeping the overwritten text in logseq/bak', JSON.stringify(kept));
check((await card.textContent()).includes('reads like this now too') && (await card.locator('[data-a="put-back"]').count()) === 0, 'the copy now matches the note');
await card.locator('[data-back]').click();
await sleep(300);
check((await noteRow.textContent()).includes('same as now'), 'and the list says so');
await go(page, '#/page/Marta%20Pell');
await sleep(300);
check((await page.locator('.outline').first().textContent()).includes('Notes on Wild Yeast'), 'the page shows the version put back');

console.log('a note changed elsewhere while the app is open: each text from before is kept');
write('pages/Marta Pell.md', '- changed on the phone\n');
await page.evaluate(() => window.leanApp.rescan());
await sleep(400);
write('pages/Marta Pell.md', '- damaged later\n'); // changed again before the app is put away
await page.evaluate(() => window.leanApp.rescan());
await sleep(400);
// put away (the app writes its index then; the texts the changes replaced go into a copy first)
const hide = (s) => page.evaluate((st) => { Object.defineProperty(document, 'visibilityState', { value: st, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, s);
await hide('hidden');
await sleep(500);
await hide('visible');
check(await copiesShown(3), 'a copy of its own');
check((await rows.first().textContent()).includes('2 earlier versions'), 'which says it holds two earlier versions', await rows.first().textContent());
await rows.first().click();
await sleep(400);
const earlier = card.locator('.sc-list [data-p="pages/Marta Pell.md"]:not([data-before="0"])');
check((await earlier.count()) === 2 && (await earlier.first().textContent()).includes('Marta Pell — before a change made elsewhere'), 'both listed as “Marta Pell — before a change made elsewhere”', await card.locator('.sc-list').textContent());
await card.screenshot({ path: SHOTS + '/safety-earlier.png' });
// the one from before the first change: the good text
let found = false;
for (let k = 0; k < 2 && !found; k++) {
  await card.locator('.sc-list [data-p="pages/Marta Pell.md"]:not([data-before="0"])').nth(k).click();
  await sleep(400);
  found = (await card.locator('.sc-text').textContent()) === good;
  if (!found) { await card.locator('[data-back]').click(); await sleep(300); }
}
check(found && (await card.textContent()).includes('before it was changed somewhere else'), 'its text from before the first change is there');
await card.locator('[data-a="put-back"]').click();
await page.waitForSelector('.modal');
await page.locator('.modal [data-v="1"]').click();
await sleep(800);
check(read('pages/Marta Pell.md') === good, 'put back the same way', read('pages/Marta Pell.md'));
const kept2 = fs.readdirSync(bak).map((f) => fs.readFileSync(bak + '/' + f, 'utf8'));
check(kept2.includes('- damaged later\n'), 'the text it replaced kept in logseq/bak first', JSON.stringify(kept2));

console.log('Check this folder: one of a kind is said as one ("1 file looks like a copy"), several as several');
const say = async (one) => {
  await page.unroute('**/api/check');
  await page.route('**/api/check', async (route) => {
    const r = await (await route.fetch()).json();
    const k = one ? 1 : 2;
    Object.assign(r, {
      conflict_copies: ['Diary/October 15th, 2026 (conflict 2026-10-26-17-05-48).md', 'pages/A (1).md'].slice(0, k),
      duplicates: [['Larder', ['pages/Larder .md', 'pages/Larder.md']], ['B', ['pages/B.md', 'pages/b .md']]].slice(0, k),
      non_utf8: ['pages/odd.md', 'pages/odd2.md'].slice(0, k),
      roundtrip_failures: ['pages/x.md', 'pages/y.md'].slice(0, k),
    });
    await route.fulfill({ json: r });
  });
  await go(page, '#/settings/notes');
  await page.locator('[data-a="check"]').click();
  await page.waitForSelector('.pics-box', { timeout: 5000 });
  return (await page.locator('.check-out').textContent()).replace(/\s+/g, ' ');
};
let words = await say(true);
check(words.includes('1 file would be reformatted') && words.includes('1 file looks like a copy made by a sync conflict') && words.includes('Compare it with the original')
  && words.includes('1 page name belongs to more than one file') && words.includes('1 file isn’t plain text'), 'one of each: said as one', words);
words = await say(false);
check(words.includes('2 files would be reformatted') && words.includes('2 files look like copies made by a sync conflict') && words.includes('Compare each with the original')
  && words.includes('2 page names belong to more than one file') && words.includes('2 files aren’t plain text'), 'two of each: said as several', words);

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

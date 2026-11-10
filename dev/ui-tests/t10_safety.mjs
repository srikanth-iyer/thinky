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
// an older copy (Logseq's backup) of a page that used unused.png then (logseq/bak doesn't count as a use)
fs.mkdirSync(VAULT + '/logseq/bak/pages/Sourdough Bread', { recursive: true });
write('logseq/bak/pages/Sourdough Bread/2026-05-31T10_00_00.000Z.Desktop.md', '- Mix, fold, rest, shape\n\t- the crumb ![crumb](../assets/unused.png)\n');
await go(page, '#/settings');
await page.locator('[data-a="check"]').click();
await page.waitForSelector('.pics-box h3', { timeout: 5000 });
const names = await page.locator('.pics .nm').allTextContents();
check(names.join(',') === 'Screenshot (2).png,keep.png,photo_2024.png,unused.png', 'lists only the pictures nothing uses (not the one in a page, the one on a whiteboard, the PDF or the one from the last 3 days)', names.join(','));
const said = await page.locator('.pics-box').textContent();
check(/4 of the 6 pictures/.test(said) && /\d KB in total/.test(said), 'with how many pictures were checked, and the total size', said);
check(said.includes('One picture was added in the last 3 days, so it was left out of this check'), 'and how many new ones were left out, and why', said);
const shows = await page.waitForFunction(() => { const i = document.querySelector('.pics img'); return i && i.complete && i.naturalWidth === 40; }, null, { timeout: 3000 }).then(() => true, () => false);
check(shows, 'a small picture of each shows');
check(await page.locator('.pics input[type="checkbox"]:checked').count() === 4, 'each has a tick box, all ticked');
// a click on a picture or its name shows it big, and doesn't touch its tick box; a click closes it
await page.locator('.pics .pic-open', { hasText: 'keep.png' }).click();
check(await page.locator('.modal-back.lightbox img').count() === 1 && /keep\.png/.test(await page.locator('.modal-back.lightbox img').getAttribute('src')), 'a click on a picture shows it big');
check(await page.locator('.pics input[type="checkbox"]:checked').count() === 4, 'and leaves its tick box as it was');
await page.locator('.modal-back.lightbox').click();
check(await page.locator('.modal-back.lightbox').count() === 0, 'a click closes it');
// "Where was it used?": found in the page's older copy, with the notes above it; "Open …" asks first
await page.locator('.pics li', { hasText: 'unused.png' }).locator('.pic-older').click();
await page.waitForSelector('.pic-ctx .pc-list li, .pic-ctx p.note', { timeout: 8000 });
const ctx = await page.locator('.pic-ctx').textContent();
check(/Sourdough Bread/.test(ctx) && /Mix, fold, rest, shape/.test(ctx) && /Logseq on a computer/.test(ctx) && await page.locator('.pic-ctx .pc-note img').count() === 1, '“Where was it used?” finds the note in the page’s older copy, with the note above it and the picture', ctx);
await page.screenshot({ path: SHOTS + '/picture-older.png' });
await page.locator('.pic-ctx .pc-go').click();
await page.waitForSelector('.modal');
check(/isn’t on the page now/.test(await page.locator('.modal').textContent()), 'Open … asks first, saying the note isn’t there now');
await page.locator('.modal button', { hasText: 'Cancel' }).click();
await sleep(200);
check(/settings/.test(await page.evaluate(() => location.hash)), 'Cancel stays here');
await page.locator('.pics li', { hasText: 'keep.png' }).locator('.pic-older').click();
await page.waitForSelector('.pics li:has-text("keep.png") .pic-ctx p.note', { timeout: 8000 });
check(/Not in any older copy/.test(await page.locator('.pics li', { hasText: 'keep.png' }).locator('.pic-ctx').textContent()), 'a picture no older copy used: says so');
await page.locator('.pics li', { hasText: 'keep.png' }).locator('.pic-older').click();
check(await page.locator('.pics li', { hasText: 'keep.png' }).locator('.pic-ctx').count() === 0, 'pressed again: closes');
await page.locator('.pics li', { hasText: 'keep.png' }).locator('input[type="checkbox"]').click(); // untick it
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
await go(page, '#/settings/safety'); // (the bin is on Safety since Build 40)
const binPics = page.locator('.bin-pics li');
check(await binPics.count() === 3 && await page.locator('.bin-pages li').count() === 50, '“Pictures” has all three, even with 60 deleted pages above (the newest 50 shown)', await binPics.count());
const binShows = await page.waitForFunction(() => { const i = document.querySelector('.bin-pics img'); return i && i.complete && i.naturalWidth === 40; }, null, { timeout: 3000 }).then(() => true, () => false);
check(binShows, 'each with a small picture');
await page.locator('.bin-pics').evaluate((el) => el.previousElementSibling.scrollIntoView());
await page.screenshot({ path: SHOTS + '/bin-pictures.png' });
// a click on a picture in the bin shows it big; on a page, the page read-only, with Restore there too
await page.locator('.bin-pics .bin-see', { hasText: 'unused.png' }).click();
check(/assets%252Funused\.png|assets%2Funused\.png/.test(await page.locator('.modal-back.lightbox img').getAttribute('src') || ''), 'a click on a picture in the bin shows it big', await page.locator('.modal-back.lightbox img').getAttribute('src'));
await page.locator('.modal-back.lightbox').click();
const oldOne = (await page.locator('.bin-pages .bin-see').first().textContent()).trim(); // ("Old page N")
const oldN = oldOne.replace('Old page ', '');
await page.locator('.bin-pages .bin-see').first().click();
await page.waitForSelector('.bin-view .hv-page .blk');
check((await page.locator('.bin-view .hv-page').textContent()).includes('deleted page ' + oldN) && (await page.locator('#bv-title').textContent()).includes(oldOne), 'a click on a deleted page shows what it holds', await page.locator('.bin-view').textContent());
check(await page.locator('.bin-view textarea, .bin-view [contenteditable="true"]').count() === 0 && exists(`logseq/.recycle/pages_${oldOne}.md`), 'read-only: nothing changes');
await page.screenshot({ path: SHOTS + '/bin-page.png' });
await page.keyboard.press('Escape');
check(await page.locator('.bin-view').count() === 0, 'Esc closes it');
await page.locator('.bin-pages .bin-see', { hasText: oldOne }).first().click();
await page.locator('.bin-view [data-h="restore"]').click();
await sleep(600);
check(exists(`pages/${oldOne}.md`) && !exists(`logseq/.recycle/pages_${oldOne}.md`) && await page.locator('.bin-view').count() === 0, 'Restore this page: it is back in pages, the box closed');
for (const n of ['Screenshot (2).png', 'photo_2024.png', 'unused.png']) {
  const row = page.locator('.bin-pics li', { hasText: n });
  await row.locator('button[data-f]').click();
  await sleep(500);
  check(exists('assets/' + n) && !exists('logseq/.recycle/assets%2F' + n), `Put back: “${n}” is in assets again, exactly as it was`);
  check((await page.locator('#toast').textContent()).includes(`Put “${n}” back in assets`), 'and it says so', await page.locator('#toast').textContent());
}
check(!fs.readdirSync(VAULT + '/assets/photo').length && await binPics.count() === 0, 'nothing went into the folder whose name starts “photo”, and the bin has no pictures left');
// one from a folder inside assets (moved to the bin earlier): it goes back there, and the message says so
fs.copyFileSync(VAULT + '/assets/unused.png', VAULT + '/logseq/.recycle/assets%2Fsub%2Fdeep.png');
await page.evaluate(() => window.leanApp.binChanged());
await page.locator('.bin-pics li', { hasText: 'sub/deep.png' }).locator('button[data-f]').click();
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
    await page.evaluate(() => window.leanApp.go('settings', 'safety'));
    await sleep(250);
    if ((await rows.count()) >= n) return true;
  }
  return false;
};
check(await copiesShown(1), 'one was made when the folder opened (the sample notes are all new)');
// a note gets overwritten (say by a bad sync), then the app starts again
const good = read('pages/Marta Pell.md');
write('pages/Marta Pell.md', '- oops, overwritten\n');
await page.goto(BASE + '/?t=' + Date.now() + '#/settings/safety');
await page.waitForSelector('.card h2');
check(await copiesShown(2), 'starting again with a changed note makes another, newest first');
check(/\d+ notes · this computer$/.test((await rows.first().textContent()).trim()), 'each says when it was made, how many notes it has and which device made it', await rows.first().textContent());
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

console.log('Check this folder: a conflict copy compared with its page and merged');
const SB = read('pages/Sourdough Bread.md');
write('pages/Sourdough Bread (conflict 2026-11-08-13-18-30).md', SB.replace('- Mix, fold, rest, shape', '- Mix, fold, rest, shape, bake') + '- an oven note from the phone\n');
write('pages/Copy me.md', '- the same words\n');
write('pages/Copy me (1).md', '- the same words\n');
await page.evaluate(() => window.leanApp.rescan?.());
await go(page, '#/settings/notes');
await page.locator('[data-a="check"]').click();
await page.waitForSelector('.conflict-copies .cc-merge', { timeout: 8000 });
check(await page.locator('.conflict-copies li').count() === 2, 'each conflict copy has Compare and merge', await page.locator('.conflict-copies').textContent());
// one that says just what its page says: only offered to the bin
await page.locator('.cc-merge[data-copy="pages/Copy me (1).md"]').click();
await page.waitForSelector('.modal');
check(/same as the page/.test(await page.locator('.modal').textContent()), 'a copy with the same words: offered to the bin only');
await page.locator('.modal button', { hasText: 'Move to the bin' }).click();
await sleep(600);
check(!exists('pages/Copy me (1).md') && exists('pages/Copy me.md') && await page.locator('.conflict-copies li').count() === 1, 'it goes to the bin, its row too; the page stays');
// the other: its page opens, then the clash screen in its copy mode
await page.locator('.cc-merge').first().click();
await page.waitForSelector('.clash-back .cl-copy, .clash-back.cl-copy, .panel.cl-copy', { timeout: 8000 });
const cl = (await page.locator('.panel.cl-copy').textContent()).replace(/\s+/g, ' ');
check(/Compare with the conflict copy/.test(cl) && /differ in 2 places/.test(cl) && /This page/.test(cl) && /The copy/.test(cl) && !/Before both changes/.test(cl) && /\(not on this page\)/.test(cl) && !/\(removed\)/.test(cl), 'the clash screen compares the page and the copy: 2 places, no “before”', cl);
check(/#\/page\/Sourdough/.test(await page.evaluate(() => location.hash)), 'with the page open behind it');
await page.screenshot({ path: SHOTS + '/conflict-copy.png' });
const picks = await page.locator('.panel.cl-copy .cl-item').evaluateAll((els) => els.map((el) => el.querySelector('input:checked')?.value));
check(picks.join(',') === 'both,theirs', 'pre-picked so nothing is lost: both where each has its own words, the copy’s where only it has some', picks.join(','));
await page.locator('.panel.cl-copy [data-c="apply"]').click();
await sleep(1200);
const merged = read('pages/Sourdough Bread.md');
check(merged.includes('- Mix, fold, rest, shape\n') && merged.includes('- Mix, fold, rest, shape, bake') && merged.includes('- an oven note from the phone') && merged.startsWith('alias:: SB'), 'the page has both versions of the changed note and the copy’s new one; its properties stay', merged);
check(!exists('pages/Sourdough Bread (conflict 2026-11-08-13-18-30).md') && fs.readdirSync(VAULT + '/logseq/.recycle').some((f) => f.includes('Sourdough Bread (conflict')), 'the copy is in the bin');
const bakSB = VAULT + '/logseq/bak/pages/Sourdough Bread';
check(fs.readdirSync(bakSB).some((f) => fs.readFileSync(bakSB + '/' + f, 'utf8') === SB), 'the page as it was is in logseq/bak');
check(/copy is in the bin/.test(await page.locator('#toast').textContent()), 'and it says so', await page.locator('#toast').textContent());

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
check(words.includes('1 file would be reformatted') && words.includes('1 file looks like a copy made by a sync conflict') && words.includes('shows it side by side with its page')
  && words.includes('1 page name belongs to more than one file') && words.includes('1 file isn’t plain text'), 'one of each: said as one', words);
words = await say(false);
check(words.includes('2 files would be reformatted') && words.includes('2 files look like copies made by a sync conflict') && words.includes('shows each side by side with its page')
  && words.includes('2 page names belong to more than one file') && words.includes('2 files aren’t plain text'), 'two of each: said as several', words);

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

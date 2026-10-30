// Safety copies in the notes folder (Build 32): each device keeps its copies in logseq/.safety-<device>/,
// one file per copy, so Google Drive keeps them in the cloud; Settings → Safety copies and a page's
// History list this computer's and the phone's, each saying which device made it, and a version from
// the phone's copy can be put back here. (core/src/app/safety.rs; the rules: core/tests/safety*.rs)
import fs from 'node:fs';
import { open, read, write, check, failures, sleep, go, VAULT, SHOTS } from './lib.mjs';

const SHOTS32 = process.env.SHOTS32 || SHOTS;
fs.mkdirSync(SHOTS32, { recursive: true });
const LOGSEQ = VAULT + '/logseq';
const { browser, page, errors } = await open();

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

console.log('the copy made when the folder opened is in the notes folder, one file, in this computer’s folder');
check(await copiesShown(1), 'a copy was made');
const devs = fs.readdirSync(LOGSEQ).filter((f) => f.startsWith('.safety'));
check(devs.length === 1 && /^\.safety-computer-[0-9a-f]{8}$/.test(devs[0]), 'logseq holds one hidden folder of copies, this computer’s (“.safety-computer-…”)', devs.join(','));
const mine = devs[0] ? fs.readdirSync(LOGSEQ + '/' + devs[0]) : [];
check(mine.length === 1 && /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.copy$/.test(mine[0]), 'and in it one file for the whole copy', mine.join(','));
const raw = mine[0] ? fs.readFileSync(`${LOGSEQ}/${devs[0]}/${mine[0]}`, 'utf8') : '';
const head = JSON.parse(raw.slice(0, raw.indexOf('\n')) || '{}');
check(head.files?.some((f) => f.path === 'pages/Marta Pell.md'), 'its first line lists the notes in it', raw.slice(0, 200));
check((await rows.first().textContent()).trim().endsWith('· this computer'), 'Settings says this computer made it', await rows.first().textContent());

console.log('a copy the phone made (Google Drive brought it): listed, read, put back here');
const good = read('pages/Marta Pell.md');
const PHONE_TEXT = '- Wrote Notes on Wild Yeast\n- written on the phone\n';
const when = Math.floor(Date.now() / 1000) - 2 * 3600;
const stamp = new Date(when * 1000).toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
const list = { v: 2, root: '/storage/emulated/0/vault', when, files: [{ path: 'pages/Marta Pell.md', mtime_ns: (when - 60) * 1e9, size: Buffer.byteLength(PHONE_TEXT), at: [0, Buffer.byteLength(PHONE_TEXT)] }], skipped: [] };
const PHONE = LOGSEQ + '/.safety-phone-0badcafe';
fs.mkdirSync(PHONE, { recursive: true });
fs.writeFileSync(`${PHONE}/${stamp}.copy`, JSON.stringify(list) + '\n' + PHONE_TEXT);
check(await copiesShown(2), 'both copies listed, newest first');
const all = (await rows.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
check(all.length === 2 && /\d+ notes? · this computer$/.test(all[0]) && all[1].endsWith('1 note · your phone'), 'each says which device made it: “this computer”, “your phone”', JSON.stringify(all));
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: SHOTS32 + '/safety-after-copies-list-laptop.png' });
await rows.nth(1).click();
await sleep(400);
check((await card.locator('h3').textContent()).includes('made by your phone'), 'the phone’s copy says so at its top', await card.locator('h3').textContent());
await card.locator('.sc-list [data-p="pages/Marta Pell.md"]').click();
await sleep(400);
check((await card.locator('.sc-text').textContent()) === PHONE_TEXT, 'its note reads as the phone copied it');
await card.locator('[data-a="put-back"]').click();
await page.waitForSelector('.modal');
await page.locator('.modal [data-v="1"]').click();
await sleep(800);
check(read('pages/Marta Pell.md') === PHONE_TEXT, 'put back here from the phone’s copy', read('pages/Marta Pell.md'));
const bak = VAULT + '/logseq/bak/pages/Marta Pell';
const kept = fs.existsSync(bak) ? fs.readdirSync(bak).map((f) => fs.readFileSync(bak + '/' + f, 'utf8')) : [];
check(kept.length === 1 && kept[0] === good, 'the text it replaced kept in logseq/bak first', JSON.stringify(kept));
check(fs.readFileSync(`${PHONE}/${stamp}.copy`, 'utf8') === JSON.stringify(list) + '\n' + PHONE_TEXT, 'the phone’s copy itself is left as it was');

console.log('a page’s History lists the phone’s copy too, saying so');
write('pages/Marta Pell.md', good); // (so the phone's version differs from the page again)
await page.evaluate(() => window.leanApp.rescan());
await go(page, '#/page/Marta%20Pell');
await sleep(400);
await page.locator('.title-row [data-a="more"]').click();
await sleep(150);
await page.locator('.pop.menu button', { hasText: 'History…' }).click();
await page.waitForFunction(() => document.querySelector('.hist') && !document.querySelector('.hist .hv-wait'));
await sleep(200);
const hist = (await page.locator('.hist .hv-list [data-k]').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
check(hist.some((t) => t.includes('Safety copy made by your phone')), '“Safety copy made by your phone”', JSON.stringify(hist));
check((await page.locator('.hist header .note').textContent()).includes('your phone’s'), 'the History says where its versions come from', await page.locator('.hist header .note').textContent());
await page.locator('.hist').screenshot({ path: SHOTS32 + '/safety-after-history-laptop.png' });
await page.keyboard.press('Escape');

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

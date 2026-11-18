// Build 50 (he asked, Nov 18): Settings → Backups → Choose… with the GitHub kind takes a git clone
// that holds a copy of the notes (it has `pages`, so it looks like a notes folder). The open notes
// folder, a notes folder that isn't a git clone, and (with the zip kind) any notes folder stay refused.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { open, check, failures, sleep, go, DIR, VAULT } from './lib.mjs';

// a GitHub stand-in: a bare repository, and a clone of it that already holds a copy of the notes
const REMOTE = DIR + '/remote.git';
const COPY = DIR + '/vault-copy';
const PLAIN = DIR + '/other-notes';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
for (const d of [REMOTE, COPY, PLAIN]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(REMOTE, { recursive: true });
git(REMOTE, 'init', '-q', '--bare', '-b', 'main');
git(DIR, 'clone', '-q', REMOTE, COPY);
git(COPY, 'config', 'user.email', 'test@example.com');
git(COPY, 'config', 'user.name', 'test');
fs.mkdirSync(COPY + '/pages', { recursive: true });
fs.writeFileSync(COPY + '/pages/Old copy.md', '- an older copy\n');
git(COPY, 'add', '-A');
git(COPY, 'commit', '-q', '-m', 'first copy');
git(COPY, 'push', '-q', 'origin', 'HEAD');
fs.mkdirSync(PLAIN + '/pages', { recursive: true }); // a notes folder, not a git clone

const { browser, page, errors } = await open();
const use = () => page.locator('.bk-pick [data-use]');
const msg = () => page.locator('.bk-pick .pk-msg').textContent();
const pickAt = async (path) => {
  await page.locator('.bk-dest').fill(path);
  await page.locator('.bk-dest').dispatchEvent('change');
  await page.locator('.bk-choose').click();
  await page.waitForSelector('.bk-pick .picker [data-use]');
  await page.waitForFunction((p) => document.querySelector('.bk-pick .picker .path')?.textContent.replace(/\\/g, '/').replace(/\/+$/, '') === p, path.replace(/\/+$/, ''));
};
const shut = async () => { await page.locator('.bk-pick [data-cancel]').click(); await sleep(100); };

console.log('Backups → Choose… with the GitHub kind');
await go(page, '#/settings/safety');
await page.waitForSelector('.backup-card');
await page.locator('.bk-on-in').check();
await page.locator('input[name="bk-kind"][value="git"]').check();
await sleep(200);

await pickAt(VAULT);
check(await use().isDisabled() && /your notes folder/.test(await msg()), 'the open notes folder: refused', await msg());
await shut();

await pickAt(PLAIN);
check(await use().isDisabled() && /not a git repository/.test(await msg()), 'a notes folder that isn’t a git clone: refused', await msg());
await shut();

await pickAt(COPY + '/pages');
check(await use().isDisabled() && /inside the notes folder/.test(await msg()), 'a folder inside the clone: refused', await msg());
await page.locator('.bk-pick [data-p]', { hasText: '↑ Up' }).click();
await page.waitForFunction(() => !document.querySelector('.bk-pick [data-use]')?.disabled);
check(/copy of your notes/.test(await msg()), 'a git clone holding a copy of the notes: can be used, and says so', await msg());
check(await page.locator('.bk-pick li [data-p]', { hasText: 'pages' }).count() === 1, '(it still shows its folders)');
await use().click();
check(await page.locator('.bk-dest').inputValue().then((v) => v.replace(/\\/g, '/')) === COPY && await page.locator('.bk-pick .picker').count() === 0, 'Use this folder: its path goes in the box', await page.locator('.bk-dest').inputValue());

console.log('Back up now into it: the copy matches the notes, saved and uploaded');
await page.locator('.bk-now').click();
for (let t = 0; t < 8000 && !/Last backup/.test(await page.locator('.bk-last').textContent()); t += 200) await sleep(200);
check(/Last backup/.test(await page.locator('.bk-last').textContent()), 'the card says it was backed up', await page.locator('.bk-last').textContent());
const log = git(REMOTE, 'log', '--format=%s', 'main');
check(/^Backup /.test(log.split('\n')[0]) && log.split('\n').length === 2, 'a new snapshot is on the remote', log);
check(!fs.existsSync(COPY + '/pages/Old copy.md') && fs.readdirSync(COPY + '/pages').length === fs.readdirSync(VAULT + '/pages').length, 'the clone now matches the notes folder (the old copy’s extra page removed)');
check(git(REMOTE, 'show', 'main~1:pages/Old copy.md') === '- an older copy', 'the older copy stays in the history');

console.log('With the zip kind, a notes-looking folder is still refused');
await page.locator('input[name="bk-kind"][value="zip"]').check();
await sleep(200);
await pickAt(COPY);
check(await use().isDisabled() && /notes folder/.test(await msg()), 'zip: the clone (a notes folder) is refused', await msg());
await shut();
await page.locator('.bk-on-in').uncheck();

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

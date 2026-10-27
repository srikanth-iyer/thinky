// One-click updates (Settings → About). "Update now" downloads the newer build, checks it's
// genuine, saves everything first and then installs it; the portable copy (and any copy that
// can't update itself) keeps the downloads page; problems are said in plain words with a way to
// try again; an update never installs over changes that aren't saved.
// The app's own parts are stand-ins that record what the page asks of them and answer as the real
// ones do: window.__TAURI__ (the Windows commands of src-tauri/src/update.rs; everything else goes
// to the dev server) and, on the phone, window.LeanAndroid (android/MainActivity.kt, whose reports
// arrive as "lean-update" events). GitHub's answer about the newest release is stood in for too.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, read, write, BASE, VAULT, SHOTS } from './lib.mjs';

const RELEASE = 'https://github.com/srikanth-iyer/lean-outliner-releases/releases/tag/build-24';

/** Open the app at Settings → About. `update`: how the Windows commands answer; `android`: a phone
 *  (with how its update steps go) instead of the laptop. */
async function start({ update = {}, version = '0.1.20', latest = 'build-24', android = null, hash = '#/settings/about' } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(android ? { viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
  const assets = [{ name: 'LeanOutliner-setup.exe', size: 2192007 }, { name: 'LeanOutliner.apk', size: 7888095 }, { name: 'LeanOutliner-setup.exe.sig', size: 239 }];
  await page.route('https://api.github.com/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: latest, html_url: RELEASE, assets }) }));
  await page.addInitScript(({ update, version, android }) => {
    window.__calls = [];
    // every stage the About box shows, as it changes
    window.__stages = [];
    new MutationObserver((ms) => {
      for (const m of ms) if (m.target.classList?.contains('upd') && window.__stages.at(-1) !== m.target.dataset.stage) window.__stages.push(m.target.dataset.stage);
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-stage'] });
    const rec = (...c) => window.__calls.push(c);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__TAURI__ = {
      core: {
        invoke: async (_name, { cmd, args }) => {
          rec(cmd, args);
          if (cmd === 'platform') return android ? 'android' : 'windows';
          if (cmd === 'update_status') return update.status || { can: true };
          if (cmd === 'update_download') {
            await wait(update.slow || 100);
            if (update.downloadError && !window.__fixed) throw update.downloadError; // Tauri rejects with the words
            return true;
          }
          if (cmd === 'update_check') {
            if (update.hold) await new Promise((r) => (window.__go = () => { window.__go = null; r(); })); // the test says when
            if (update.checkError) throw update.checkError;
            return true;
          }
          if (cmd === 'update_install') {
            if (update.installError && !window.__fixed) throw update.installError;
            window.__installed = true;
            window.__inertAtInstall = document.body.inert;
            return true;
          }
          // everything else: the dev server, as the real app would answer
          const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
          const j = await r.json();
          if (!r.ok) throw j.error || r.statusText;
          return j;
        },
      },
      app: { getVersion: async () => version },
      event: { listen: async () => () => {} },
      opener: { openUrl: async (u) => rec('openUrl', u) },
    };
    if (!android) return;
    // the phone: MainActivity's update steps, reported the way updateEvent does
    const fire = (stage, msg = '') => setTimeout(() => document.dispatchEvent(new CustomEvent('lean-update', { detail: { stage, msg } })), 0);
    window.__fire = fire;
    const download = async () => {
      for (const pc of ['', '0%', '50%', '100%']) { fire('download', pc); await wait(120); }
      fire('check');
      await wait(120);
      fire(android.notNewer ? 'error' : 'ready', android.notNewer ? 'Nothing was installed: the download isn’t newer than this version.' : '');
    };
    window.LeanAndroid = {
      hasAllFilesAccess: () => true, setBarColors() {}, setWidgetColors() {}, setWidgetTasks() {}, setWidgetConfig() {},
      setCaptureConfig() {}, refreshWidget() {}, leave() {}, openAllFilesSettings() {},
      update(tag) {
        rec('android.update', tag);
        // Android's "Install unknown apps" screen first; back from it (allowed), the download goes on
        if (android.permission && !window.__allowed) { fire('permission'); window.__back = () => { window.__allowed = true; download(); }; return; }
        download();
      },
      installUpdate() { rec('android.installUpdate'); fire('install'); setTimeout(() => fire('confirm'), 150); },
    };
  }, { update, version, android });
  await page.goto(BASE + '/');
  await page.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
  await page.goto(BASE + '/?t=' + Date.now() + hash);
  if (hash === '#/settings/about') await page.waitForSelector('.upd[data-stage]');
  await sleep(300);
  return { browser, page, errors };
}
const allErrors = [];
const stage = (page) => page.evaluate(() => document.querySelector('.upd')?.dataset.stage || null);
const text = (page) => page.evaluate(() => document.querySelector('.upd-out')?.textContent || '');
const calls = (page) => page.evaluate(() => window.__calls.map((c) => c[0]));
/** The stages the box went through since the last call, once it reaches `last` (or a problem). */
async function stages(page, last, ms = 6000) {
  await page.waitForFunction((l) => [l, 'error'].includes(window.__stages.at(-1)), last, { timeout: ms }).catch(() => {});
  return page.evaluate(() => window.__stages.splice(0));
}

// --------------------------------------------------------------------------------------------
console.log('the installed app on the laptop: one click downloads, checks, saves and installs');
let { browser, page, errors } = await start({ update: { slow: 400 } });
check(await stage(page) === 'newer', 'a newer build found: offered', await stage(page));
check(/A newer version \(Build 24\) is ready\. Update now downloads it \(about 2 MB\), checks it’s genuine and installs it, then restarts Lean Outliner\. Your notes are saved first/.test(await text(page)), 'said in plain words, with how much it downloads', await text(page));
check(await page.locator('.upd [data-a="update"]').isEnabled(), 'with an “Update now” button');
check(await page.locator('#update').isVisible(), 'and the sidebar says “A newer version is ready”');
await page.screenshot({ path: SHOTS + '/update-offer.png' });
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
const seen = await stages(page, 'install');
check(seen.join(' ') === 'download check save install', 'downloading, checking it’s genuine, saving, installing', seen.join(' '));
check(await text(page) === 'Installing: Lean Outliner will restart in a moment.', 'it says the app will restart', await text(page));
check(await page.locator('.upd [data-a="update"]').isDisabled(), 'the button can’t be pressed twice meanwhile');
let c = (await calls(page)).filter((x) => x.startsWith('update_'));
check(c.join(' ') === 'update_status update_download update_check update_install', 'the app was asked for exactly that, in order', c.join(' '));
const dl = await page.evaluate(() => window.__calls.find((x) => x[0] === 'update_download')[1]);
check(JSON.stringify(dl) === '{"tag":"build-24"}', 'only the build it saw is passed (the app makes the address)', JSON.stringify(dl));
allErrors.push(...errors);
await browser.close();

console.log('what was being typed when the update arrives is saved before it installs');
({ browser, page, errors } = await start({ update: { hold: true } }));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
await page.waitForFunction(() => typeof window.__go === 'function'); // downloaded, being checked
await page.evaluate(() => { location.hash = '#/page/Rosa%20Penhallow'; });
await page.waitForSelector('.outline .blk');
await page.locator('.outline .blk > .bc', { hasText: 'Baker at Millbrook' }).first().click();
await page.waitForSelector('textarea.ed');
await page.keyboard.press('End');
await page.keyboard.type(' typed while it downloaded');
await page.evaluate(() => window.__go()); // well before the usual save, 0.8 s after typing stops
await page.waitForFunction(() => window.__installed, null, { polling: 10, timeout: 5000 });
const atInstall = read('pages/Rosa Penhallow.md');
check(atInstall.includes('[[Apron club]] typed while it downloaded'), 'the page was saved before the installer started', atInstall);
check(await page.evaluate(() => window.__inertAtInstall === true), 'after that last save nothing more can be typed (it couldn’t be saved)');
const installing = await page.evaluate(() => document.querySelector('#toast:not([hidden])')?.textContent || '');
check(installing === 'Installing the update: Lean Outliner will restart in a moment.', 'About isn’t on screen: a message at the bottom says it’s installing', installing);
c = await calls(page);
check(c.lastIndexOf('save') >= 0 && c.lastIndexOf('save') < c.indexOf('update_install'), 'saved, then installed', c.slice(-6).join(' '));
check(c.includes('persist') && c.lastIndexOf('persist') < c.indexOf('update_install'), 'and the index kept, as when closing', c.slice(-6).join(' '));
allErrors.push(...errors);
await browser.close();

console.log('a clash waiting for him: nothing is installed, and he’s told why');
({ browser, page, errors } = await start({ update: { hold: true } }));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
await page.waitForFunction(() => typeof window.__go === 'function');
await page.evaluate(() => { location.hash = '#/page/Rosa%20Penhallow'; });
await page.waitForSelector('.outline .blk');
await page.locator('.outline .blk > .bc', { hasText: 'Baker at Millbrook' }).first().click();
await page.waitForSelector('textarea.ed');
await page.keyboard.press('End');
await page.keyboard.type(' mine');
write('pages/Rosa Penhallow.md', read('pages/Rosa Penhallow.md').replace('Baker', 'Cook'));
await sleep(1500);
check(await page.locator('.banner:not([hidden])').count() === 1, 'the clash is waiting for his choice');
await page.evaluate(() => window.__go());
await sleep(800);
check(!(await page.evaluate(() => window.__installed)), 'the installer was not started');
const toast = await page.evaluate(() => document.querySelector('#toast:not([hidden])')?.textContent || '');
check(/The update didn’t go ahead: Some changes aren’t saved yet/.test(toast), 'a message at the bottom says why', toast);
check(read('pages/Rosa Penhallow.md').includes('Cook at'), 'the other version is untouched (his choice still to make)');
// he chooses on the clash screen (as suggested): then the page is saved
if (!(await page.locator('.clash').isVisible())) await page.locator('.banner [data-a="choose"]').click();
await page.locator('.clash [data-c="apply"]').click();
await sleep(800);
check(!(await page.locator('.clash').isVisible()) && await page.locator('.banner:not([hidden])').count() === 0, 'his choice is made and saved');
await page.evaluate(() => { location.hash = '#/settings/about'; });
await page.waitForSelector('.upd[data-stage]');
check(await stage(page) === 'error' && /aren’t saved yet.*You can try again/.test(await text(page)), 'About still says why, with Try again', await text(page));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
await page.waitForFunction(() => typeof window.__go === 'function' && (window.__go(), true));
check((await stages(page, 'install')).pop() === 'install', 'once settled, Try again installs it');
allErrors.push(...errors);
await browser.close();

console.log('another window of the app is open: not installed, he’s told to close it; the page works again');
const OTHER = 'Lean Outliner is also open in another window, or the Add to journal box is open. Close it, then press Update now again.';
({ browser, page, errors } = await start({ update: { installError: OTHER } }));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
check((await stages(page, 'error')).join(' ') === 'download check save install error', 'it stopped at installing', await stage(page));
check(await text(page) === OTHER + ' You can try again, or get it from the downloads page.', 'said plainly', await text(page));
check(await page.evaluate(() => !document.body.inert && !window.__installed), 'nothing installed, and the page takes typing again');
await page.evaluate(() => { window.__fixed = true; window.__stages.splice(0); }); // he closed the other window
await page.locator('.upd [data-a="update"]').click();
check((await stages(page, 'install')).pop() === 'install' && await page.evaluate(() => window.__installed), 'pressed again, it installs');
allErrors.push(...errors);
await browser.close();

console.log('the portable copy: the downloads page, and why');
({ browser, page, errors } = await start({ update: { status: { can: false, why: 'portable', msg: 'This is the portable copy (it isn’t installed), so it can’t update itself.' } } }));
check(await stage(page) === 'newer' && await page.locator('.upd [data-a="update"]').count() === 0, 'no “Update now”');
check(/ready: get it from the downloads page\. This is the portable copy \(it isn’t installed\), so it can’t update itself\./.test(await text(page)), 'the downloads page, and why', await text(page));
await page.locator('.upd a[data-ext]').click();
await sleep(200);
c = await page.evaluate(() => window.__calls.filter((x) => x[0] === 'openUrl').map((x) => x[1]));
check(c[0] === RELEASE, 'the link opens the release in the browser', c.join(','));
allErrors.push(...errors);
await browser.close();

console.log('offline, then online: said plainly, Try again works');
({ browser, page, errors } = await start({ update: { downloadError: 'Couldn’t reach GitHub to download the update. Are you online?' } }));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
check((await stages(page, 'error')).pop() === 'error', 'the download stopped');
check(await text(page) === 'Couldn’t reach GitHub to download the update. Are you online? You can try again, or get it from the downloads page.', 'in plain words, with the downloads page', await text(page));
check(await page.locator('.upd[data-stage="error"] .upd-out').evaluate((e) => getComputedStyle(e).color) !== await page.locator('.card .note').first().evaluate((e) => getComputedStyle(e).color), 'shown as a problem (its own colour)');
await page.screenshot({ path: SHOTS + '/update-error.png' });
await page.evaluate(() => { window.__fixed = true; });
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
check((await stages(page, 'install')).pop() === 'install', 'Try again goes all the way');
allErrors.push(...errors);
await browser.close();

console.log('a download that isn’t genuine is never installed');
const notGenuine = 'The download didn’t pass the check that it’s genuine (its signature isn’t from Lean Outliner’s key), so it was deleted and nothing was installed.';
({ browser, page, errors } = await start({ update: { checkError: notGenuine } }));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
check((await stages(page, 'error')).join(' ') === 'download check error', 'stopped at the check', await stage(page));
check((await text(page)).startsWith(notGenuine), 'said so', await text(page));
check(!(await calls(page)).includes('update_install'), 'the installer was not started');
allErrors.push(...errors);
await browser.close();

console.log('up to date: nothing offered; checking by hand says so');
({ browser, page, errors } = await start({ latest: 'build-20' }));
check(await stage(page) === 'idle' && !(await page.locator('#update').isVisible()), 'no update offered');
await page.locator('.upd [data-a="check"]').click();
await sleep(400);
check(await text(page) === 'You have the latest version.', 'checking says it’s the latest', await text(page));
allErrors.push(...errors);
await browser.close();

console.log('the sidebar’s notice leads to About');
({ browser, page, errors } = await start({ hash: '#/journals' }));
await page.waitForSelector('#update:not([hidden])');
await page.locator('#update').click();
await page.waitForSelector('.upd[data-stage]');
check(await page.evaluate(() => location.hash) === '#/settings/about' && await stage(page) === 'newer', 'Settings → About, with Update now', await page.evaluate(() => location.hash));
allErrors.push(...errors);
await browser.close();

// --------------------------------------------------------------------------------------------
console.log('the phone: Android’s permission first, then download, check, save, Android’s installer');
({ browser, page, errors } = await start({ android: { permission: true } }));
check(await stage(page) === 'newer' && /downloads it \(about 8 MB\), checks it’s genuine and installs it\. Your notes/.test(await text(page)), 'offered, with the download’s size (Wi-Fi?), no restart promised (Android doesn’t)', await text(page));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
check((await stages(page, 'permission')).pop() === 'permission', 'Android asks first');
check(/turn on Allow from this source for Lean Outliner, then come back here/.test(await text(page)), 'and he’s told what to do there', await text(page));
await page.screenshot({ path: SHOTS + '/update-android-permission.png' });
await page.evaluate(() => window.__back());
const seenA = await stages(page, 'confirm');
check(seenA.join(' ') === 'download check save install confirm', 'downloading, checking, saving, installing, Android asking', seenA.join(' '));
check(/Tap Update in Android’s box\. When Android has finished, open Lean Outliner again\./.test(await text(page)), 'he’s told to confirm and open the app again', await text(page));
c = await calls(page);
check(c.filter((x) => x === 'android.update').length === 1 && c.indexOf('android.installUpdate') > c.lastIndexOf('persist'), 'saved before Android’s installer took over', c.slice(-5).join(' '));
check(await page.evaluate(() => window.__calls.find((x) => x[0] === 'android.update')[1]) === 'build-24', 'only the build is passed');
await page.screenshot({ path: SHOTS + '/update-android-confirm.png' });
// Android's answer comes later: here it refuses (another key)
await page.evaluate(() => window.__fire('error', 'Android refused the update: it isn’t signed like the app on this phone (INSTALL_FAILED_UPDATE_INCOMPATIBLE).'));
await sleep(300);
check(await stage(page) === 'error' && /Android refused the update: it isn’t signed like the app on this phone/.test(await text(page)), 'Android’s refusal is shown', await text(page));
const log = await page.evaluate(() => window.__calls.filter((x) => x[0] === 'log').map((x) => x[1].msg).join('|'));
check(/update \(Android\): Android refused/.test(log), 'and noted in the problems log', log);
allErrors.push(...errors);
await browser.close();

console.log('the phone: a download that isn’t newer is refused there');
({ browser, page, errors } = await start({ android: { notNewer: true } }));
await page.evaluate(() => window.__stages.splice(0));
await page.locator('.upd [data-a="update"]').click();
check((await stages(page, 'error')).pop() === 'error' && /isn’t newer than this version/.test(await text(page)), 'said so', await text(page));
check(!(await calls(page)).includes('android.installUpdate'), 'Android’s installer was not asked');
allErrors.push(...errors);
await browser.close();

console.log('an older phone app without one-click updates: the downloads page');
({ browser, page, errors } = await start({ android: {}, hash: '#/journals' }));
await page.evaluate(() => { delete window.LeanAndroid.update; location.hash = '#/settings/about'; });
await page.waitForSelector('.upd[data-stage]');
check(await page.locator('.upd [data-a="update"]').count() === 0 && /get it from the downloads page/.test(await text(page)), 'no Update now, the downloads page', await text(page));
allErrors.push(...errors);
await browser.close();

console.log('About asks again when its answer is over a minute old: a build out since then shows at once');
({ browser, page, errors } = await start({ latest: 'build-20', hash: '#/journals' }));
await page.waitForFunction(() => localStorage.getItem('updateCheck'));
check(await page.locator('#update').isHidden(), 'at start: nothing newer (the same build)');
let asked = 0;
await page.unroute('https://api.github.com/**');
await page.route('https://api.github.com/**', (route) => { asked++; route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tag_name: 'build-25', html_url: RELEASE, assets: [] }) }); });
// a minute later he opens About: it asks GitHub again (a day-old answer no longer stands)
await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('updateCheck')); c.at -= 70e3; localStorage.setItem('updateCheck', JSON.stringify(c)); location.hash = '#/settings/about'; });
await page.waitForSelector('.upd[data-stage]');
await sleep(300);
check(asked === 1 && await stage(page) === 'newer' && /Build 25/.test(await text(page)), 'the new build is offered at once', `${asked} · ${await text(page)}`);
// opened again within the minute: that answer stands (GitHub isn't asked each time)
await page.evaluate(() => { location.hash = '#/journals'; });
await sleep(400);
await page.evaluate(() => { location.hash = '#/settings/about'; });
await page.waitForSelector('.upd[data-stage]');
await sleep(300);
check(asked === 1 && await stage(page) === 'newer', 'opened again soon after: not asked again', String(asked));
allErrors.push(...errors);
await browser.close();

check(allErrors.length === 0, 'no script errors', allErrors.join(' | '));
if (allErrors.length) console.log('script errors:', allErrors.join(' | '));
console.log(failures() ? `${failures()} FAILED` : 'all ok');
process.exit(failures() ? 1 : 0);

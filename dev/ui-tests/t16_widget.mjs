// The Android home-screen widgets follow the look ("Can the widget also update with theme?", his
// journal, Oct 28): at every start and every look change the page hands Android the look's colours
// (LeanAndroid.setWidgetColors: page, words, faint words, accent) as #rrggbb, the colours as seen,
// whatever CSS colour a look uses (Android's Color.parseColor reads only #rrggbb, and would fall back
// to its defaults for rgb() or color-mix()). Here a stand-in for the Android bridge records the calls;
// the emulator test (scripts/android_test.sh step 7b) checks the widgets themselves.
import { open, check, failures, sleep, BASE } from './lib.mjs';

const LOOKS = ['plain', 'plainnight', 'plainteal', 'calm', 'calmplain', 'night', 'paper', 'sticker', 'stickernight', 'automaton', 'azulejo'];
const { browser, page, errors } = await open();
await page.addInitScript(() => {
  window.__widget = [];
  const known = {
    hasAllFilesAccess: () => true,
    setWidgetColors: (...a) => window.__widget.push(a),
    takeShortcut: () => null,
  };
  window.LeanAndroid = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => null) });
});
await page.evaluate(() => localStorage.setItem('skin', JSON.stringify('plainnight')));
await page.goto(BASE + '/?t=' + Date.now() + '#/journals');
await page.waitForSelector('.sheet .outline');
await sleep(300);
const tokens = () => page.evaluate(() => { const c = getComputedStyle(document.documentElement); return ['--surface', '--ink', '--ink-faint', '--accent'].map((k) => c.getPropertyValue(k).trim().toLowerCase()); });
const last = () => page.evaluate(() => window.__widget.at(-1) || []);

const first = await page.evaluate(() => window.__widget[0] || []);
check(first.length === 4 && JSON.stringify(first) === JSON.stringify(await tokens()), 'at start: the look’s colours (Plain night)', JSON.stringify(first));
check(JSON.stringify(first) === JSON.stringify(['#1a1a1a', '#e6e6e6', '#878787', '#8ab4f8']), 'Plain night’s near-black page, light words', JSON.stringify(first));
let all = true;
const bad = [];
for (const id of LOOKS) {
  await page.evaluate((x) => window.leanApp.setSkin(x), id);
  const got = await last(), want = await tokens();
  if (JSON.stringify(got) !== JSON.stringify(want) || !got.every((c) => /^#[0-9a-f]{6}$/.test(c))) { all = false; bad.push([id, got, want]); }
}
check(all, `every look change hands over that look’s colours, as #rrggbb (${LOOKS.length} looks)`, JSON.stringify(bad));
const teal = await page.evaluate(() => { window.leanApp.setSkin('plainteal'); return window.__widget.at(-1); });
check(JSON.stringify(teal) === JSON.stringify(['#023643', '#a4b5b6', '#6a8a8f', '#8ec2c2']), 'Plain teal: Logseq’s dark blue-green', JSON.stringify(teal));
// a colour Android couldn't read as written: handed over as the colour seen
const odd = await page.evaluate(() => {
  const s = document.documentElement.style;
  s.setProperty('--surface', 'rgb(10, 20, 30)');
  s.setProperty('--accent', 'color-mix(in srgb, #ff0000 50%, #0000ff)');
  window.leanApp.setSkin('calm');
  s.removeProperty('--surface');
  s.removeProperty('--accent');
  return window.__widget.at(-1);
});
check(odd[0] === '#0a141e' && /^#[78][0-9a-f]00[78][0-9a-f]$/.test(odd[3]), 'rgb() and color-mix() come out as #rrggbb', JSON.stringify(odd));

check(!errors.length, 'no script errors', errors.join(' | '));
await browser.close();
process.exit(failures() ? 1 : 0);

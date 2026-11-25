// The website's looks: the app's own looks (ui/skins.css, its pictures and fonts, and the list of
// looks in ui/app.js), copied into the website's look/ folder, so the site can wear any of them and
// always has the same looks as the newest release. The website's build (.github/workflows/pages.yml)
// runs it; site/look.js shows the choice of looks, and site/style.css reads the look's colours and fonts.
//   node web/site-looks.mjs <thinky folder> <website folder being built>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// where the app's files are, and where the website is being put together
const [SRC, OUT] = process.argv.slice(2).map((p) => path.resolve(p));
if (!SRC || !OUT) { console.error('usage: node web/site-looks.mjs <thinky folder> <website folder>'); process.exit(2); }
const UI = path.join(SRC, 'ui');
const LOOK = path.join(OUT, 'look');

// 1. the files a look needs, as they are: the looks' colours (skins.css) and the pictures they use
//    (skins/), the fonts, and the thinky wordmark (the looks named after the app show it)
fs.mkdirSync(path.join(LOOK, 'brand'), { recursive: true });
for (const f of ['skins.css', 'fonts.css']) fs.copyFileSync(path.join(UI, f), path.join(LOOK, f));
for (const d of ['skins', 'fonts']) fs.cpSync(path.join(UI, d), path.join(LOOK, d), { recursive: true });
// a look's pictures (url(skins/…) in skins.css) are read through the site's style.css, and browsers
// resolve such a picture either next to the page's style.css or next to skins.css: so the few small
// pictures go in both places (site/skins/ and look/skins/)
fs.cpSync(path.join(UI, 'skins'), path.join(OUT, 'skins'), { recursive: true });
fs.copyFileSync(path.join(UI, 'brand', 'wordmark.svg'), path.join(LOOK, 'brand', 'wordmark.svg'));

// 2. the list of looks (name, light or dark, a few words about it) from the app's SKINS list.
//    app.js can't be loaded outside the app, so the list is read out of its text: everything from
//    "export const SKINS = [" to the "];" that closes it, which holds only plain values.
const app = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');
const m = app.match(/export const SKINS = (\[[\s\S]*?\n\]);/);
if (!m) { console.error('site-looks: no SKINS list found in ui/app.js'); process.exit(1); }
// (read in an empty sandbox, so the text can only make values, never reach files or the network)
const looks = vm.runInNewContext('(' + m[1] + ')', Object.create(null), { timeout: 1000 });
// keep only what the website shows, and check each look has its colours in skins.css
const css = fs.readFileSync(path.join(UI, 'skins.css'), 'utf8');
const list = looks.map(({ id, name, dark, note, pair, word, after }) => ({ id, name, dark: !!dark, note, pair, word: !!word, after: after || '' }));
const missing = list.filter((l) => !css.includes(`[data-skin="${l.id}"]`)).map((l) => l.id);
if (missing.length) { console.error('site-looks: no colours in skins.css for ' + missing.join(', ')); process.exit(1); }
fs.writeFileSync(path.join(LOOK, 'looks.js'), `// made by web/site-looks.mjs from ui/app.js: the app's looks, for site/look.js\nwindow.THINKY_LOOKS = ${JSON.stringify(list, null, 1)};\n`);
console.log(`site-looks: ${list.length} looks copied into ${path.relative(process.cwd(), LOOK) || LOOK}`);

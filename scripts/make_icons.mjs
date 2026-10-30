// Makes the app's icons from ui/brand/icon*.svg (his "scribble to spark" icon, Oct 29, 2026):
// src-tauri/icons (Windows: icon.ico, the PNGs) and src-tauri/icons/android (launcher icons).
// Each size uses the drawing meant for it (the designer's rule): icon.svg (fine lines) for 128px
// and up, icon-mid.svg for about 40–96px, icon-small.svg (thick lines, drawn a bit bigger) for 32px
// and smaller. Android sizes go by how big the icon looks (48dp on the home screen: the mid one) at
// every density. Run here (needs Playwright's Chromium):
//   node scripts/make_icons.mjs [/path/to/playwright/index.mjs]
import fs from 'fs';
const PW = process.argv[2] || '/opt/npm-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const read = (f) => fs.readFileSync('ui/brand/' + f, 'utf8');
const SVG = { big: read('icon.svg'), mid: read('icon-mid.svg'), small: read('icon-small.svg') };
const TILE = /<rect [^>]*\/>/;
// the drawing alone (Android's adaptive icon: the cream is its background colour), kept inside the
// safe zone: Android shows the middle 72dp of the 108dp layer and promises the middle 66dp (a circle)
// in every mask shape. The drawing's farthest point (the spark's tip) is 444 units from the middle
// of the 1024 box, so 33dp / 444 units: the drawing comes out as big as on the tile, nearly.
const foreground = (svg) => { const half = 54 / (33 / 446); const o = 512 - half;
  return svg.replace(TILE, '').replace('viewBox="0 0 1024 1024"', `viewBox="${o.toFixed(1)} ${o.toFixed(1)} ${(2 * half).toFixed(1)} ${(2 * half).toFixed(1)}"`); };
const round = (svg) => svg.replace(TILE, '<circle cx="512" cy="512" r="480" fill="#F4EEE3"/>');

const b = await chromium.launch();
const page = await b.newPage();
async function png(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
const pick = (size) => (size >= 128 ? SVG.big : size > 32 ? SVG.mid : SVG.small);
const out = (f, buf) => { fs.writeFileSync(f, buf); console.log(f, buf.length); };

// Windows and the bundle
out('src-tauri/icons/32x32.png', await png(pick(32), 32));
out('src-tauri/icons/128x128.png', await png(pick(128), 128));
out('src-tauri/icons/128x128@2x.png', await png(pick(256), 256));
out('src-tauri/icons/icon.png', await png(pick(512), 512));
// icon.ico: 16, 24, 32, 48, 64 and 256, each a PNG inside (small files; Windows Vista and later)
const sizes = [16, 24, 32, 48, 64, 256];
const pngs = [];
for (const s of sizes) pngs.push(await png(pick(s), s));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let at = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
  head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(at, e + 12);
  at += pngs[i].length;
});
out('src-tauri/icons/icon.ico', Buffer.concat([head, ...pngs]));

// Android: legacy square and round icons (48dp) and the adaptive icon's foreground layer (108dp)
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  const dir = `src-tauri/icons/android/mipmap-${d}`;
  out(`${dir}/ic_launcher.png`, await png(SVG.mid, 48 * k));
  out(`${dir}/ic_launcher_round.png`, await png(round(SVG.mid), 48 * k));
  out(`${dir}/ic_launcher_foreground.png`, await png(foreground(SVG.mid), 108 * k));
}
await b.close();

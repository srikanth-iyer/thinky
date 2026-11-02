import fs from 'node:fs';
// Settings → Capture → "Highlights from your browser" in the Windows app: Set up puts the extension's
// files in place (native_host.rs) and shows where to get it (the Edge and Chrome stores, Build 35) and
// the steps for Edge's "Load unpacked"; once set up it says so.
// The app's own commands are stand-ins (window.__TAURI__, as in t13_update); everything else goes
// to the dev server.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, BASE, VAULT, SHOTS } from './lib.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI)));
await page.addInitScript(() => {
  window.__calls = [];
  const FOLDER = 'C:\\Users\\you\\AppData\\Local\\com.srikanth.leanoutliner\\browser-extension';
  window.__TAURI__ = {
    app: { getVersion: async () => '0.1.32' },
    event: { listen: async () => () => {} },
    opener: { openUrl: async (u) => { window.__opened = (window.__opened || []).concat(u); } },
    core: {
      invoke: async (_n, { cmd, args }) => {
        window.__calls.push(cmd);
        if (cmd === 'platform') return 'windows';
        if (cmd === 'browser_status') return { set_up: sessionStorage.getItem('setUp') === '1', folder: FOLDER };
        if (cmd === 'browser_setup') { sessionStorage.setItem('setUp', '1'); return { folder: FOLDER }; }
        if (cmd === 'get_shortcut') return { key: '', helper: true, running: false };
        const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        const j = await r.json();
        if (!r.ok) throw j.error || r.statusText;
        return j;
      },
    },
  };
});
await page.goto(BASE + '/');
await page.evaluate((v) => { localStorage.clear(); localStorage.setItem('vault', JSON.stringify(v)); }, VAULT);
await page.goto(BASE + '/?t=' + Date.now() + '#/settings/capture');
await page.waitForSelector('[data-a="setup"]');
const card = page.locator('.card', { has: page.locator('[data-a="setup"]') });
check(await card.locator('h2').textContent() === 'Highlights from your browser', 'the card is there on Windows (Build 35: Edge or Chrome)');
check(await card.locator('.steps').isHidden(), 'the steps wait for Set up');
check(await page.locator('.bookmarklet, [href^="javascript:"]').count() === 0 && !/bookmark/i.test(await page.textContent('.view')), 'no bookmark button: web pages can\'t add notes (removed, Build 34)');
check(await page.locator('h2', { hasText: 'Capture from anywhere on the laptop' }).count() === 1, 'the shortcut key card stays');
// the extension's keys (Build 34): Highlight is Ctrl+Shift+H, as the manifest says, and where to change them
const manifest = JSON.parse(fs.readFileSync(new URL('../../browser/manifest.json', import.meta.url), 'utf8'));
check(manifest.commands.highlight.suggested_key.default === 'Ctrl+Shift+H' && manifest.commands.journal.suggested_key.default === 'Alt+Shift+J', 'the extension suggests Ctrl+Shift+H for Highlight (J stays Alt+Shift: Ctrl+Shift+J is Edge’s developer tools)');
const how = await card.locator('.how').textContent();
check(/Ctrl\s*\+\s*Shift\s*\+\s*H/.test(how), 'the card names Ctrl+Shift+H', how);
check((await card.locator('.ext-keys').textContent()) === 'edge://extensions/shortcuts' && (await card.locator('.ext-keys-chrome').textContent()) === 'chrome://extensions/shortcuts', 'and where to change the keys, in Edge and in Chrome', await card.locator('.keys-how').textContent());
await card.locator('[data-a="copykeys"]').click();
await sleep(200);
check(await page.evaluate(() => navigator.clipboard.readText()) === 'edge://extensions/shortcuts', 'Copy address copies it');
await page.click('[data-a="setup"]');
await page.waitForSelector('.steps:not([hidden])');
check(await page.evaluate(() => window.__calls.includes('browser_setup')), 'Set up asks the app');
// the store pages (Build 35): each button opens its store's page for the extension, in the browser
await card.locator('[data-a="edge"]').click();
await card.locator('[data-a="chrome"]').click();
await sleep(200);
const opened = await page.evaluate(() => window.__opened || []);
check(opened[0] === 'https://microsoftedge.microsoft.com/addons/detail/cpdmmmcipjfebaemgdnbamipolboaokn' && opened[1] === 'https://chromewebstore.google.com/detail/ggainimehhgjmblabbjkiemfhhlhcgnk', 'Get it for Edge / Chrome open the store pages', JSON.stringify(opened));
const core = fs.readFileSync(new URL('../../core/src/clip.rs', import.meta.url), 'utf8');
check(opened.every((u) => core.includes(u.split('/').pop())), 'the same ids the app answers (clip.rs)');
check(await card.locator('.unpacked').isVisible() && !(await card.locator('.unpacked ol').isVisible()), 'loading it by hand is there, folded');
await card.locator('.unpacked summary').click();
check((await card.locator('.ext-folder').textContent()).endsWith('browser-extension'), 'the folder to load is named');
check(await card.locator('.ext-state').isVisible() && /Set up/.test(await card.locator('.ext-state').textContent()), 'it says it’s set up');
await card.screenshot({ path: SHOTS + '/t16_settings.png' });
// opened again later: already set up
await page.reload();
await page.waitForSelector('[data-a="setup"]');
await sleep(300);
check(await page.locator('[data-a="setup"]').textContent() === 'Show the steps again', 'once set up, the button shows the steps');
check(errors.length === 0, 'no errors (CSP included)', errors.join('; '));
await browser.close();
if (failures()) process.exit(1);

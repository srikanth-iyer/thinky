// Settings → Capture → "Highlights from Edge" in the Windows app: Set up puts the extension's files
// in place (native_host.rs) and shows the steps for Edge's "Load unpacked"; once set up it says so.
// The app's own commands are stand-ins (window.__TAURI__, as in t13_update); everything else goes
// to the dev server.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { check, failures, sleep, BASE, VAULT, SHOTS } from './lib.mjs';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1100, height: 1400 } })).newPage();
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
    opener: { openUrl: async () => {} },
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
check(await card.locator('h2').textContent() === 'Highlights from Edge', 'the card is there on Windows');
check(await card.locator('.steps').isHidden(), 'the steps wait for Set up');
check(await page.locator('h3', { hasText: 'A bookmark button (without the extension)' }).count() === 1, 'the bookmark button stays, below');
await page.click('[data-a="setup"]');
await page.waitForSelector('.steps:not([hidden])');
check(await page.evaluate(() => window.__calls.includes('browser_setup')), 'Set up asks the app');
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

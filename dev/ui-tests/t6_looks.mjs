// The look picker: one sidebar button, a list with live samples, keyboard, phone drawer.
import { open, check, failures, sleep, SHOTS } from './lib.mjs';

const { browser, page, errors } = await open();
// the Windows capture box gets the look's colours through save_look (it can't read the CSS)
const saved = [];
await page.route('**/api/save_look', async (route) => { saved.push(JSON.parse(route.request().postData() || '{}')); await route.continue(); });
const csp = await page.evaluate(async () => (await fetch('/')).headers.get('content-security-policy'));
check(csp && csp.includes("script-src 'self'"), 'dev server sends the app CSP', csp);
check(await page.locator('#side .skins').count() === 0, 'no row of look dots in the sidebar');
const btn = page.locator('#side [data-a="looks"]');
check(await btn.isVisible(), 'sidebar has one Look button');
const curName = async () => (await page.locator('#side .look-cur').textContent()).trim();
const skin = () => page.evaluate(() => document.documentElement.dataset.skin);
check((await curName()) === 'Calm' && (await skin()) === 'calm', 'button shows the current look', await curName());

await btn.click();
await sleep(150);
const pop = page.locator('.pop.looks');
check(await pop.isVisible(), 'clicking it opens the list');
check(await page.locator('.pop.looks [data-look]').count() === 11, '11 looks listed');
check(await page.evaluate(() => document.activeElement?.dataset.look) === 'calm', 'focus starts on the current look');
const bgs = await page.evaluate(() => [...document.querySelectorAll('.look-sw')].map((e) => getComputedStyle(e).backgroundColor));
check(new Set(bgs).size >= 6, 'each sample is painted in its own look', bgs.join(' | '));
const box = await pop.boundingBox();
check(box.y >= 0 && box.y + box.height <= 900 && box.x >= 0, 'list fits on screen', JSON.stringify(box));
await page.screenshot({ path: SHOTS + '/looks-laptop.png' });

// keyboard: down to Night (past Calm plain), Enter applies, list stays open
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await sleep(100);
check((await skin()) === 'night' && (await curName()) === 'Night', 'Enter applies the look', await skin());
await sleep(1000);
const sent = saved.at(-1);
check(sent?.look === 'night' && sent.colors.surface === '#2a2f38' && sent.colors['surface-2'] === '#242830' && sent.colors.ink === '#e6e9ee'
  && sent.colors.accent === '#86c4b3' && sent.colors['accent-ink'] === '#12141a' && sent.colors.danger === '#eba394' && Object.keys(sent.colors).length === 10,
  'the look’s colours are saved for the Windows capture box', JSON.stringify(sent));
check(await pop.isVisible(), 'list stays open to compare');
check(await page.locator('.pop.looks [aria-pressed="true"]').getAttribute('data-look') === 'night', 'tick moves to the new look');
for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowUp'); // Night → Calm plain → Calm → Plain night → Plain → (round) Azulejo
check(await page.evaluate(() => document.activeElement?.dataset.look) === 'azulejo', 'arrow keys wrap around');
await page.keyboard.press('Escape');
await sleep(100);
check(await pop.count() === 0, 'Esc closes the list');
check((await skin()) === 'night', 'Esc keeps the chosen look');

// mouse: open, pick, click outside closes; button toggles
await btn.click(); await sleep(120);
await page.locator('.pop.looks [data-look="plain"]').click();
check((await skin()) === 'plain', 'clicking a row applies it');
await page.mouse.click(900, 400); await sleep(120);
check(await pop.count() === 0, 'clicking elsewhere closes the list');
await btn.click(); await sleep(120);
await btn.click(); await sleep(120);
check(await pop.count() === 0, 'the button opens and closes the list');
const kept = await page.evaluate(() => localStorage.getItem('skin'));
check(kept === '"plain"', 'the choice is remembered', kept);
// Settings still has the big previews
await page.evaluate(() => { location.hash = '#/settings/look'; }); await sleep(500);
check(await page.locator('.skin-card').count() === 11, 'Settings still shows the large previews');
console.log('link colour and fonts');
await page.evaluate(() => { location.hash = '#/settings/look'; });
await sleep(700);
await page.locator('.text-style .sw[data-c="#E0457B"]').click();
await sleep(200);
const linkVar = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--link').trim());
check((await linkVar()).toLowerCase() === '#e0457b', 'picking a swatch colours the links', await linkVar());
await page.locator('#ts-body').selectOption({ label: 'Georgia' });
await page.locator('#ts-title').selectOption({ label: 'Bricolage Grotesque (comes with the app)' });
await sleep(200);
const fonts = () => page.evaluate(() => { const c = getComputedStyle(document.documentElement); return [c.getPropertyValue('--font-body').trim(), c.getPropertyValue('--font-title').trim()]; });
check((await fonts())[0].startsWith('Georgia') && (await fonts())[1].includes('Bricolage'), 'text and title fonts change', JSON.stringify(await fonts()));
await page.reload();
await sleep(900);
check((await linkVar()).toLowerCase() === '#e0457b' && (await fonts())[0].startsWith('Georgia'), 'still there after a restart', JSON.stringify([await linkVar(), await fonts()]));
await page.evaluate(() => { location.hash = '#/settings/look'; });
await sleep(700);
await page.locator('.text-style .sw.own').click();
await page.locator('#ts-body').selectOption({ value: '' });
await page.locator('#ts-title').selectOption({ value: '' });
await sleep(200);
check(!(await page.evaluate(() => document.documentElement.style.getPropertyValue('--link'))) && !(await page.evaluate(() => document.documentElement.style.getPropertyValue('--font-body'))), 'back to the look’s own');

await browser.close();

// phone: drawer stays open while choosing
const m = await open({ viewport: { width: 390, height: 800 }, touch: true });
await m.page.locator('#topbar [data-a="menu"]').tap(); await sleep(350);
await m.page.locator('#side [data-a="looks"]').tap(); await sleep(200);
const mb = await m.page.locator('.pop.looks').boundingBox();
check(mb && mb.x >= 0 && mb.x + mb.width <= 390 && mb.y >= 0 && mb.y + mb.height <= 800, 'phone: list fits the screen', JSON.stringify(mb));
await m.page.screenshot({ path: SHOTS + '/looks-phone.png' });
await m.page.locator('.pop.looks [data-look="sticker"]').tap(); await sleep(200);
check(await m.page.evaluate(() => document.documentElement.dataset.skin) === 'sticker', 'phone: tap applies the look');
check(await m.page.evaluate(() => document.body.classList.contains('drawer')), 'phone: the drawer stays open');
await m.page.screenshot({ path: SHOTS + '/looks-phone-sticker.png' });
await m.browser.close();

const all = [...errors, ...m.errors];
check(all.length === 0, 'no script errors or CSP blocks', all.join(' | '));
console.log(failures() ? `${failures()} FAILED` : 'all passed');

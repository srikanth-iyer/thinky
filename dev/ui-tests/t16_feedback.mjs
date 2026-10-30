// Settings › About › Send feedback: the message and the app's version open a new GitHub issue in
// the browser (window.open in the dev server; the opener in the app). Nothing is posted anywhere:
// any request leaving the page would fail the test. An empty message opens nothing.
import { open, check, failures, sleep, go } from './lib.mjs';

const { browser, page, errors } = await open();
const posted = [];
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => { posted.push(route.request().url()); return route.abort(); });

console.log('Settings › About shows the feedback box');
await go(page, '#/settings/about');
await page.waitForSelector('.fb .fb-msg');
await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
const first = await page.evaluate(() => document.querySelector('.card')?.querySelector('h2')?.textContent);
check(first === 'Send feedback', 'it is the first box in About', String(first));
check(!(await page.$('.fb .fb-mail')) && !(await page.$('.fb .fb-log')), 'no email box, no problems-log tick: nothing personal is added');

console.log('an empty message opens nothing');
await page.click('.fb [data-a="send"]');
await sleep(200);
check((await page.evaluate(() => window.__opened.length)) === 0, 'nothing opened');
check(/Write a message/.test(await page.textContent('.fb .fb-out')), 'it asks for a message');

console.log('a message opens a new issue with the words and the version');
await page.fill('.fb .fb-msg', 'The + button is great & so is search\nSecond line');
await page.click('.fb [data-a="send"]');
await page.waitForFunction(() => window.__opened.length === 1);
const url = new URL(await page.evaluate(() => window.__opened[0]));
check(url.origin + url.pathname === 'https://github.com/srikanth-iyer/thinky/issues/new', 'the public repo’s new-issue page', url.href);
check(url.searchParams.get('title') === 'The + button is great & so is search', 'the first line is the title', url.searchParams.get('title'));
const body = url.searchParams.get('body') || '';
check(body.startsWith('The + button is great & so is search\nSecond line\n\n---\nthinky '), 'the message, then the details', body);
check(/^thinky \S.* · \S+$/.test(body.split('---\n')[1] || ''), 'only the version and the system', body.split('---\n')[1]);
check(!/Mozilla|window|look /.test(body), 'no browser, window or look details', body);
check(/Opened in your browser/.test(await page.textContent('.fb .fb-out')), 'it says it opened');
check(posted.length === 0, 'nothing was sent from the page', posted.join(' '));

check(errors.length === 0, 'no page errors', errors.join('\n'));
await browser.close();
process.exit(failures() ? 1 : 0);

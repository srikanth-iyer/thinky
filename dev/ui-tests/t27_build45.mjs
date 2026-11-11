// Build 45 (the maintainer's note of Nov 11: All pages' filter box nearly touched the title): whatever sits
// right under a page's title keeps clear of it, by the same gap on every screen (--title-gap, skins.css).
import { open, check, failures, sleep, go, lookIds } from './lib.mjs';

// The gap from the title's own box to the top edge of what shows first under it, in px.
// (the title's letters reach about 1.5px below its box: descenders, at line-height 1.08)
const gapUnder = (page) => page.evaluate(() => {
  const view = document.querySelector('.pane.act .view') || document.querySelector('.view');
  const h1 = view.querySelector('h1.page-title');
  const b = h1.getBoundingClientRect();
  // the first thing with a box of its own that starts under the title, left to right overlapping it
  const next = [...view.querySelectorAll('input.filter, .set-tabs .chip, .btn-row .btn, .page-props, .props, p.note')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.height > 2 && r.top >= b.bottom - 8)
    .sort((x, y) => x.r.top - y.r.top)[0];
  return next ? { gap: +(next.r.top - b.bottom).toFixed(1), what: next.el.className || next.el.tagName, size: parseFloat(getComputedStyle(h1).fontSize) } : null;
});

const SCREENS = [['All pages', '#/pages'], ['To-dos', '#/todos'], ['Properties', '#/props'], ['a property’s page', '#/props/status'], ['Tags', '#/tags'],
  ['Settings', '#/settings/notes'], ['a page with properties', '#/page/Sourdough%20Bread']];

for (const [device, opts, least] of [['laptop', {}, 12], ['phone', { viewport: { width: 390, height: 800 }, touch: true }, 9]]) {
  const { browser, page, errors } = await open({ ...opts, look: 'thinky' });
  console.log(`${device}: under a page's title`);
  const gaps = [];
  for (const [name, hash] of SCREENS) {
    await go(page, hash);
    await sleep(300);
    const g = await gapUnder(page);
    check(g && g.gap >= least, `${name}: ${g?.gap}px of room under the title (at least ${least})`, JSON.stringify(g));
    if (g && name !== 'Tags') gaps.push(g.gap); // (Tags has a line of words under its title, with its own spacing)
  }
  check(Math.max(...gaps) - Math.min(...gaps) <= 1, 'the same gap on every one of them', gaps.join(', '));
  // every look: the properties box and the filter box (looks set their own title size and properties box)
  if (device === 'laptop') {
    for (const look of await lookIds(page)) {
      await page.evaluate((l) => document.documentElement.setAttribute('data-skin', l), look);
      const out = [];
      for (const hash of ['#/pages', '#/page/Sourdough%20Bread']) { await go(page, hash); await sleep(150); const g = await gapUnder(page); out.push(g); }
      check(out.every((g) => g && g.gap >= g.size * 0.3), `${look}: at least 0.3 of the title's size under it`, JSON.stringify(out));
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-skin', 'thinky'));
  }
  // Settings → Look: the ring round the chosen look's card doesn't touch the "Day look" heading
  await go(page, '#/settings/look');
  await page.waitForSelector('.skin-card[aria-pressed="true"]');
  const ring = await page.evaluate(() => {
    const card = document.querySelector('.skin-cards:not([hidden]) .skin-card[aria-pressed="true"]');
    const h = card.closest('.skin-cards').previousElementSibling; // its "Day look" / "Night look" heading
    const cs = getComputedStyle(card);
    const reach = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset); // how far the ring goes outside the card
    const rg = document.createRange(); rg.selectNodeContents(h);
    return { clear: +(card.getBoundingClientRect().top - reach - rg.getBoundingClientRect().bottom).toFixed(1), head: h.textContent.trim() };
  });
  check(ring.clear >= 4, `“${ring.head}”: the chosen card's ring is ${ring.clear}px clear of the heading's letters`, JSON.stringify(ring));
  check(!errors.length, 'no script errors', errors.join(' | '));
  await browser.close();
}
process.exit(failures() ? 1 : 0);

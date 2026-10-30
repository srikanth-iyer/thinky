// thinky highlights: the extension's background part. It owns the list of highlights (kept
// in the extension's own storage, one list per article), the right-click menu and the keyboard
// shortcut, and talks to thinky through Edge's "native messaging": Edge starts
// thinky's program for a moment, hands it the message, and passes its answer back.

const HOST = 'com.srikanth.leanoutliner';

// ------------------------------------------------------------ the same article, however written
// (the same rules as outline_core::clip::normalize_url, so a list matches the app's page)
const TRACKING = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi|mkt_tok)$/i;
function articleKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const q = u.searchParams.toString();
    return `https://${host}${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`;
  } catch (e) {
    return url;
  }
}

// The title without the site's name at its end ("How Bread Rises | Kitchen Weekly" → "How Bread
// Rises"), so the box shows the page name the app will use (outline_core::capture::clean_title).
function cleanTitle(title, site, url) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { /* none */ }
  const names = [String(site || '').trim().toLowerCase(), host].filter(Boolean);
  for (const sep of [' | ', ' - ', ' – ', ' — ', ' · ', ' : ', ' :: ', ' / ']) {
    const i = t.lastIndexOf(sep);
    if (i > 0) {
      const tail = t.slice(i + sep.length).trim().toLowerCase();
      if (names.some((n) => tail === n || tail.replace(/ /g, '') === n.split('.')[0])) return t.slice(0, i).trim();
    }
  }
  return t;
}

// ------------------------------------------------------------ the kept highlights
// storage key "a:<article>" → {url, title, site, items: [{id, plain, text, pos, link}]}
async function getList(key) {
  const k = 'a:' + key;
  return (await chrome.storage.local.get(k))[k] || null;
}
async function putList(key, list) {
  const k = 'a:' + key;
  if (!list || !list.items.length) await chrome.storage.local.remove(k);
  else await chrome.storage.local.set({ [k]: list });
}

// ------------------------------------------------------------ the page's helper (page.js)
async function run(tabId, func, args = []) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'] });
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r ? r.result : undefined;
}
const toast = (tabId, msg, bad) => run(tabId, (m, b) => window.__leanOutliner.toast(m, b), [msg, !!bad]).catch(() => {});

async function badge(tabId, n) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0B7B66' }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
}

// Highlight the selected text in this tab: marked yellow and kept for its article.
async function highlight(tab) {
  let got;
  try {
    got = await run(tab.id, () => {
      const o = window.__leanOutliner;
      return { info: o.pageInfo(), h: o.highlight() };
    });
  } catch (e) {
    return { error: CANT };
  }
  if (!got || !got.h) {
    await toast(tab.id, 'Select some text first, then highlight it.');
    return { error: 'Nothing selected.' };
  }
  const key = articleKey(got.info.url);
  const list = (await getList(key)) || { url: got.info.url, title: cleanTitle(got.info.title, got.info.site, got.info.url), site: got.info.site, items: [] };
  list.items.push(got.h);
  list.items.sort((a, b) => a.pos - b.pos);
  await putList(key, list);
  await badge(tab.id, list.items.length);
  return { count: list.items.length };
}

// Send the kept highlights of this tab's article to thinky, in reading order.
async function sendAll(tab, title) {
  let info;
  try {
    info = await run(tab.id, () => window.__leanOutliner.pageInfo());
  } catch (e) {
    return { error: CANT };
  }
  const key = articleKey(info.url);
  const list = await getList(key);
  if (!list || !list.items.length) return { error: 'No highlights on this page yet.' };
  const msg = { cmd: 'clip', url: list.url, title: title || list.title, site: list.site, highlights: list.items.map((h) => ({ text: h.text, link: h.link })) };
  const res = await talk(msg);
  if (res.ok) {
    await putList(key, null);
    await badge(tab.id, 0);
    await run(tab.id, () => window.__leanOutliner.clear()).catch(() => {});
  }
  return res;
}

// The selected text straight into today's journal (the usual quick capture), linked to its spot.
async function toJournal(tab) {
  let got;
  try {
    got = await run(tab.id, () => {
      const o = window.__leanOutliner;
      const s = o.selection();
      return { info: o.pageInfo(), s: s && { text: s.text, link: s.link } };
    });
  } catch (e) {
    return { error: CANT };
  }
  const { info, s } = got;
  const res = await talk({ cmd: 'journal', text: s ? s.text : '', url: s ? s.link : info.url, title: info.title, site: info.site });
  await toast(tab.id, res.ok ? 'Added to your journal' : res.error, !res.ok);
  return res;
}

const CANT = 'Highlights can’t be made on this page: Edge doesn’t let extensions into some pages (PDFs, Edge’s own pages, the add-ons store).';
const NOT_SET_UP = 'thinky isn’t set up for the browser yet. In thinky, open Settings → Capture and click “Set up” under “Browser extension”.';

// One message to thinky and its answer; {ok: false, error} when it can't be reached.
async function talk(msg) {
  try {
    const res = await chrome.runtime.sendNativeMessage(HOST, msg);
    return res && typeof res === 'object' ? res : { ok: false, error: 'thinky gave no answer.' };
  } catch (e) {
    const m = String(e && e.message || e);
    if (/not found|forbidden|not allowed/i.test(m)) return { ok: false, error: NOT_SET_UP };
    return { ok: false, error: 'Couldn’t reach thinky: ' + m };
  }
}

// ------------------------------------------------------------ menus, keys, the popup's requests
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'hl', title: 'Highlight for thinky', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'journal', title: 'Send to today’s journal', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'send', title: 'Send highlights to thinky', contexts: ['page'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id < 0) return;
  if (info.menuItemId === 'hl') await highlight(tab);
  else if (info.menuItemId === 'journal') await toJournal(tab);
  else if (info.menuItemId === 'send') {
    const r = await sendAll(tab);
    await toast(tab.id, r.ok ? added(r) : r.error, !r.ok);
  }
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (cmd === 'highlight') await highlight(tab);
  else if (cmd === 'journal') await toJournal(tab);
});

function added(r) {
  const n = r.added === 1 ? '1 highlight' : `${r.added} highlights`;
  if (!r.added) return `Already on “${r.page}”: nothing new to add.`;
  return `Added ${n} to “${r.page}”` + (r.skipped ? ` (${r.skipped} already there)` : '');
}

// the popup asks through messages: {do: 'list'|'send'|'remove'|'clear'|'paint', tabId, …}
chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  (async () => {
    const tab = await chrome.tabs.get(m.tabId);
    if (m.do === 'send') return reply(await sendAll(tab, m.title));
    if (m.do === 'journal') return reply(await toJournal(tab));
    let info;
    try {
      info = await run(tab.id, () => window.__leanOutliner.pageInfo());
    } catch (e) {
      return reply({ error: CANT });
    }
    const key = articleKey(info.url);
    let list = await getList(key);
    if (m.do === 'remove' && list) {
      list.items = list.items.filter((h) => h.id !== m.id);
      await putList(key, list);
    }
    if (m.do === 'clear') {
      await putList(key, null);
      list = null;
    }
    if (m.do === 'title' && list) {
      list.title = m.title;
      await putList(key, list);
    }
    const items = list ? list.items : [];
    await run(tab.id, (its) => window.__leanOutliner.paint(its), [items]).catch(() => {});
    await badge(tab.id, items.length);
    reply({ info, title: list ? list.title : cleanTitle(info.title, info.site, info.url), items });
  })().catch((e) => reply({ error: String(e && e.message || e) }));
  return true; // the answer comes later
});

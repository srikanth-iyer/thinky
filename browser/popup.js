// thinky highlights: the toolbar button's box. It shows this page's highlights, lets him
// fix the page name or drop a highlight, and sends them all with one click. The work itself is
// done by background.js (it keeps the list and talks to thinky).

const $ = (id) => document.getElementById(id);
let tabId = 0;

const ask = (m) => chrome.runtime.sendMessage({ tabId, ...m });

function say(msg, bad) {
  $('status').textContent = msg || '';
  $('status').className = bad ? 'bad' : '';
}

function added(r) {
  if (!r.added) return `Already on “${r.page}”: nothing new to add.`;
  const n = r.added === 1 ? '1 highlight' : `${r.added} highlights`;
  return `Added ${n} to “${r.page}”` + (r.skipped ? ` (${r.skipped} already there)` : '') + '.';
}

// a highlight's Markdown as plain words to read: no invisible spaces, ** or *, links as their words
const readable = (t) => String(t || '').replace(/\u200b/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|\*/g, '').replace(/\s+/g, ' ').trim();

function show(r) {
  if (r.error) {
    say(r.error, true);
    $('title').disabled = $('send').disabled = true;
    $('journal').hidden = true;
    return;
  }
  // "Send the selected text…" only with text selected on the page
  const sel = !!(r.info && r.info.selected);
  $('journal').disabled = !sel;
  $('journal').title = sel ? '' : 'Select some text on the page first';
  if (document.activeElement !== $('title')) $('title').value = r.title || '';
  const list = $('list');
  list.textContent = '';
  for (const h of r.items) {
    const li = document.createElement('li');
    const q = document.createElement('span');
    q.className = 'q';
    q.textContent = readable(h.text) || h.plain;
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = 'Remove this highlight';
    x.setAttribute('aria-label', 'Remove this highlight');
    x.onclick = async () => show(await ask({ do: 'remove', id: h.id }));
    li.append(q, x);
    list.append(li);
  }
  const n = r.items.length;
  $('empty').hidden = n > 0;
  $('clear').hidden = n === 0;
  $('send').disabled = n === 0;
  $('send').textContent = n ? `Send ${n} highlight${n === 1 ? '' : 's'}` : 'Send';
}

// this page's passages already in his notes (asked of thinky; the page marks them too)
async function showKept() {
  const k = await ask({ do: 'kept' });
  const box = $('kept');
  const items = (k && !k.error && k.highlights) || [];
  box.hidden = !items.length;
  if (!items.length) return;
  const n = items.length;
  $('kept-h').textContent = `${n} highlight${n === 1 ? '' : 's'} already in “${k.page}”`;
  const list = $('kept-list');
  list.textContent = '';
  for (const h of items) {
    const li = document.createElement('li');
    li.textContent = h.plain;
    list.append(li);
  }
}

// "Show my highlights again": turning it on asks Edge for the "all websites" permission (it has to
// be asked from a click); turning it off gives it back
async function showAgain() {
  const o = await ask({ do: 'opts' });
  $('again').checked = !!(o.showAgain && o.allSites);
}
$('again').addEventListener('change', async (e) => {
  if (e.target.checked) {
    let ok = false;
    try { ok = await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch (err) { ok = false; }
    await ask({ do: 'opts', set: { showAgain: ok } });
    if (!ok) say('Edge didn’t allow it, so it stays off.', true);
  } else {
    await ask({ do: 'opts', set: { showAgain: false } });
    try { await chrome.permissions.remove({ origins: ['<all_urls>'] }); } catch (err) { /* (kept by the test's copy) */ }
  }
  await showAgain();
});

$('title').addEventListener('change', async () => {
  const t = $('title').value.trim();
  if (t) await ask({ do: 'title', title: t });
});

$('send').onclick = async () => {
  $('send').disabled = true;
  say('Sending…');
  const r = await ask({ do: 'send', title: $('title').value.trim() });
  if (r.ok) {
    say(added(r));
    show(await ask({ do: 'list' }));
    showKept();
  } else {
    say(r.error || 'Something went wrong.', true);
    $('send').disabled = false;
  }
};

$('clear').onclick = async () => {
  show(await ask({ do: 'clear' }));
  say('Cleared.');
};

// the settings (behind the gear: set once, so they don't take room in the box every time)
$('gear').onclick = () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  $('gear').setAttribute('aria-expanded', String(open));
};

$('journal').onclick = async () => {
  say('Sending…');
  const r = await ask({ do: 'journal' });
  say(r.ok ? 'Added to your journal.' : r.error, !r.ok);
};

(async () => {
  // (?tab=<id>: the box opened as a page of its own, as the tests do)
  const want = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = want ? [await chrome.tabs.get(want)] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return say('No page open.', true);
  tabId = tab.id;
  show(await ask({ do: 'list' }));
  showAgain();
  showKept();
})();

// the Highlight key as Edge has it now (set at edge://extensions/shortcuts; a setup from before
// Build 34 keeps Alt+Shift+H), so the hint never names a key that doesn't work
chrome.commands?.getAll?.((cmds) => {
  const k = (cmds || []).find((c) => c.name === 'highlight')?.shortcut;
  const el = document.getElementById('hlkey');
  if (el && k) el.textContent = k;
  else if (el && cmds) el.closest('p').innerHTML = 'No highlights here yet. Select some text, then right-click → <i>Highlight for thinky</i>.'; // (no key set: just the menu)
});

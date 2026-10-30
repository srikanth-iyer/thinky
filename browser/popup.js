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
  } else {
    say(r.error || 'Something went wrong.', true);
    $('send').disabled = false;
  }
};

$('clear').onclick = async () => {
  show(await ask({ do: 'clear' }));
  say('Cleared.');
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
})();

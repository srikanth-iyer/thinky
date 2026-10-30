// The clash screen. A page was changed here and somewhere else (the phone, Claude, Logseq) since it
// was opened, in the same notes, so the two versions can't simply be combined (changes in different
// notes are, without asking: merge.rs). Only the notes that differ are shown, side by side: this
// device's version and the other copy's, with how they were before both changes, one of the two
// pre-picked as the suggestion. Where nothing (or only empty bullets) was there before, both added
// notes: "Keep both" (this device's, then the other copy's) is offered and pre-picked, as it loses
// nothing (unless one side already has all the other's notes: that side; or keeping both would put
// a note's words on the page more times than either version has them: the usual suggestion).
// Keeping a choice first saves a backup copy of each version that loses something
// (logseq/bak), then saves the page as usual (merging anything newer).
import { call } from './api.js';
import { renderBlock, esc } from './render.js';
import { h, ICON } from './dom.js';
import { docKey } from './editor.js';

const words = (bs) => bs.map((b) => b.text).join('\n');
/** the words without pictures' sizes ({:height …, :width …} right after a link) */
const unsized = (bs) => words(bs).replace(/\)\{\s*:[^}\r\n]*\}/g, ')');
/** Which side to suggest: the one that keeps more (all of the other's words and more, or the one
 *  still there when the other removed the notes); otherwise this device's, where he was writing. */
function suggest(c) {
  if (!c.mine.length) return 'theirs';
  if (!c.theirs.length) return 'mine';
  if (c.base?.length && unsized(c.mine) === unsized(c.base)) return 'theirs'; // here only a picture's size changed
  const m = words(c.mine), t = words(c.theirs);
  return t.includes(m) && !m.includes(t) ? 'theirs' : 'mine';
}
/** Notes as they'd show on the page (one level of indent per depth, relative to the first). */
function notesHtml(blocks) {
  if (!blocks.length) return '<p class="cl-none">(removed)</p>';
  const min = Math.min(...blocks.map((b) => b.depth));
  return blocks.map((b) => {
    const r = renderBlock(b.text);
    return `<div class="cl-b" style="--d:${Math.min(b.depth - min, 6)}">${r.marker ? `<span class="mk">${esc(r.marker)}</span>` : ''}${r.html || '&nbsp;'}</div>`;
  }).join('');
}
const propsHtml = (t) => (t.trim() ? `<pre class="cl-props">${esc(t.trim())}</pre>` : '<p class="cl-none">(none)</p>');
/** Both devices added notes where nothing (or only empty bullets) was before: keeping both loses nothing. */
const bothAdded = (p) => p.mine.length > 0 && p.theirs.length > 0 && p.base.every((b) => !b.text.trim());
/** Whether notes `a` have every note of `b` (the same words, as many times). */
function hasAll(a, b) {
  const left = new Map();
  for (const x of a) left.set(x.text, (left.get(x.text) || 0) + 1);
  for (const x of b) {
    const k = left.get(x.text) || 0;
    if (!k) return false;
    left.set(x.text, k - 1);
  }
  return true;
}
/** The choice pre-picked for a clash. Where both added notes: "Keep both", unless one side already
 *  has every note of the other (the same note moved or added there on both devices): then that side,
 *  which loses nothing either and doesn't show that note twice. See also `noTwice`. */
function prePick(p) {
  if (!bothAdded(p)) return suggest(p);
  if (hasAll(p.mine, p.theirs)) return 'mine';
  if (hasAll(p.theirs, p.mine)) return 'theirs';
  return 'both';
}
/** How many times each note's words are on a page (empty notes don't count). */
function counts(texts) {
  const n = new Map();
  for (const t of texts) if (t.trim()) n.set(t, (n.get(t) || 0) + 1);
  return n;
}
/** "Keep both" stays pre-picked only if the page the pre-picks make has no note's words more times
 *  than this device's page or the other copy has them; otherwise those items get the usual
 *  suggestion. (A note moved to the end on one device and another moved there on the other would
 *  show twice: each device still has it in its old place.) `mine`: this device's notes' words. */
function noTwice(c, items, mine) {
  if (!items.some((it) => it.pick === 'both')) return;
  const page = counts(pageBlocks(c, items.map((it) => it.pick)).map((b) => b.text));
  const m = counts(mine), t = counts(c.theirs.blocks.map((b) => b.text));
  for (const [w, n] of page) {
    if (n > Math.max(m.get(w) || 0, t.get(w) || 0)) {
      for (const it of items) if (it.pick === 'both') it.pick = suggest(it);
      return;
    }
  }
}
/** The page's notes with these choices (one per item; the page properties' first, if both changed
 *  them): the parts nobody has to choose, and each clash as picked. */
function pageBlocks(c, picks) {
  const blocks = [];
  let k = c.preamble ? 1 : 0;
  for (const p of c.parts) {
    if (p.kind === 'same') blocks.push(...p.blocks);
    else {
      const pick = picks[k++];
      blocks.push(...(pick === 'both' ? [...p.mine, ...p.theirs] : pick === 'mine' ? p.mine : p.theirs));
    }
  }
  return blocks;
}

/** Show the clash screen for outline o (its page clashed while saving). Resolves when he chose
 *  (true) or put it off (false). */
export async function openClash(o) {
  if (document.querySelector('.clash-back')) return false;
  o.stopEdit();
  let c;
  const asked = docKey(o.doc); // the version compared (see keep)
  const mineWords = o.doc.blocks.map((b) => b.text);
  try { c = await call('clash', { name: o.name, doc: o.doc, base: o.base, path: o.path }); }
  catch (err) { wholeChoice(o, err); return false; }
  // what to choose from: the page properties (if both changed them), then each clash in page order
  const items = [];
  if (c.preamble) items.push({ props: true, base: c.preamble[0], mine: c.preamble[1], theirs: c.preamble[2], pick: 'mine' });
  for (const p of c.parts || []) if (p.kind === 'clash') items.push({ ...p, both: bothAdded(p), pick: prePick(p) });
  const whole = !c.parts; // too long to compare note by note: keep one version or the other
  if (!whole && !items.length) return keep(o, c, asked, null, [], [], []); // the file changed again: nothing clashes now
  if (!whole) noTwice(c, items, mineWords);
  o.stopEdit(); // a note clicked while comparing: typing must not go on under the screen

  const back = h('div', 'modal-back panel-back clash-back');
  const box = h('div', 'panel clash');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'cl-title');
  const n = items.length;
  box.innerHTML = `<header class="panel-head cl-head">
      <h2 id="cl-title">Changed in two places</h2>
      <p class="note">“${esc(o.name)}” was changed here and ${o.elsewhere()} in the same ${whole ? 'page' : n === 1 ? 'note' : 'notes'}. ${whole ? 'It’s too long to compare note by note: choose which version to keep.' : `Choose which version to keep for ${n === 1 ? 'it' : 'each'}.`}</p>
      <div class="cl-bar">
        <span class="cl-key"><i class="mine"></i>This device <i class="theirs"></i>Other copy <i class="base"></i>Before both changes</span>
        ${n > 1 ? `<span class="cl-nav"><span class="cl-n" aria-live="polite">1 of ${n}</span><button type="button" class="icon-btn" data-c="prev" aria-label="Previous difference">${ICON.up}</button><button type="button" class="icon-btn" data-c="next" aria-label="Next difference">${ICON.down}</button></span>` : ''}
      </div>
    </header>
    <div class="panel-body cl-list">${whole ? '' : items.map((it, k) => `<section class="cl-item" data-k="${k}">
      ${it.props ? '<h3 class="cl-what">Page properties</h3>' : ''}
      <div class="cl-cols" role="radiogroup" aria-label="Version to keep">
        ${['mine', 'theirs'].map((side) => `<label class="cl-col ${side}">
          <input type="radio" name="cl${k}" value="${side}"${it.pick === side ? ' checked' : ''}>
          <span class="cl-h"><i class="${side}"></i>${side === 'mine' ? 'This device' : 'Other copy'}${it.pick === side ? ' <em>suggested</em>' : ''}</span>
          <div class="cl-notes">${it.props ? propsHtml(it[side]) : notesHtml(it[side])}</div>
        </label>`).join('')}
        ${it.both ? `<label class="cl-col both">
          <input type="radio" name="cl${k}" value="both"${it.pick === 'both' ? ' checked' : ''}>
          <span class="cl-h"><i class="mine"></i><i class="theirs"></i>Keep both: this device’s, then the other copy’s${it.pick === 'both' ? ' <em>suggested</em>' : ''}</span>
        </label>` : ''}
      </div>
      <div class="cl-base"><span class="cl-h"><i class="base"></i>Before both changes</span><div class="cl-notes">${it.props ? propsHtml(it.base) : it.base.length ? notesHtml(it.base) : '<p class="cl-none">(not there yet)</p>'}</div></div>
    </section>`).join('')}</div>
    <footer class="panel-foot cl-foot">
      <p class="note">The version you don’t keep is saved as a backup copy in <code>logseq/bak</code>, so nothing is lost.</p>
      <div class="btn-row">
        <button type="button" class="btn ghost" data-c="later">Decide later</button>
        ${whole ? '<button type="button" class="btn ghost" data-c="theirs">Use the other copy</button><button type="button" class="btn" data-c="mine">Keep this device’s</button>'
          : `<span class="cl-all">${n > 1 ? 'All: <button type="button" class="link" data-c="all-mine">this device</button> · <button type="button" class="link" data-c="all-theirs">other copy</button>' : ''}</span><button type="button" class="btn" data-c="apply"></button>`}
      </div>
    </footer>`;
  back.append(box);
  document.body.append(back);

  const radios = (k) => box.querySelectorAll(`input[name="cl${k}"]`);
  const picked = () => items.map((it, k) => [...radios(k)].find((r) => r.checked)?.value || it.pick);
  const label = () => {
    box.querySelectorAll('.cl-col').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    const b = box.querySelector('[data-c="apply"]');
    if (b) b.textContent = picked().every((p, k) => p === items[k].pick) ? (n === 1 ? 'Keep the suggested one' : 'Keep the suggested ones') : 'Keep my choices';
  };
  label();
  box.addEventListener('change', label);
  let cur = 0;
  const go = (k) => {
    cur = (k + n) % n;
    const it = box.querySelector(`.cl-item[data-k="${cur}"]`);
    it?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    box.querySelectorAll('.cl-item.cur').forEach((x) => x.classList.remove('cur'));
    it?.classList.add('cur');
    const t = box.querySelector('.cl-n');
    if (t) t.textContent = `${cur + 1} of ${n}`;
  };
  if (n > 1) go(0);

  return new Promise((resolve) => {
    let busy = false; // keeping a choice: the backups are being made
    const close = (done) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(done);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy) close(false); // decide later: the page's banner offers the screen again
    };
    document.addEventListener('keydown', onKey, true);
    box.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-c]')?.dataset.c;
      if (!a || busy) return;
      if (a === 'later') { close(false); return; }
      if (a === 'prev' || a === 'next') { go(cur + (a === 'prev' ? -1 : 1)); return; }
      if (a === 'all-mine' || a === 'all-theirs') {
        items.forEach((_, k) => radios(k).forEach((r) => { r.checked = r.value === a.slice(4); }));
        label();
        return;
      }
      // keep: a = 'apply' (the choices), 'mine' or 'theirs' (the whole page). The screen stays up
      // while the backups are made, then closes: if the page changed yet again meanwhile, saving
      // may ask again with a new one.
      const picks = whole ? [] : picked();
      busy = true;
      box.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
      await keep(o, c, asked, whole ? a : null, items, picks, whole ? [a] : picks, close);
    });
  });
}

/** Build the page from the choices, back up what loses something, then save. `asked`: the version
 *  that was compared; `close(done)` takes the screen away (once the backups are made, so nothing
 *  can be typed meanwhile). False if nothing was changed (a backup couldn't be made: the page's
 *  banner still offers the choice). */
async function keep(o, c, asked, wholeSide, items, picks, sides, close = () => {}) {
  let doc;
  if (wholeSide) doc = wholeSide === 'mine' ? o.doc : c.theirs;
  else {
    const blocks = pageBlocks(c, picks);
    const preamble = c.preamble ? (picks[0] === 'mine' ? o.doc.preamble : c.theirs.preamble)
      : o.doc.preamble === o.base.preamble ? c.theirs.preamble : o.doc.preamble;
    doc = { preamble, blocks, indent: c.theirs.indent, crlf: c.theirs.crlf };
  }
  // a backup copy of each version that loses something (this device's: unless that exact version
  // is in logseq/bak already, from when the clash showed); and this device's anyway if it changed
  // since it was compared (a note typed in while comparing isn't in the choices)
  try {
    if (sides.includes('theirs') || docKey(o.doc) !== asked) await o.backupMine();
    if (sides.includes('mine')) await call('backup', { name: o.name, doc: c.theirs });
  } catch (err) {
    close(false);
    o.app.toast('Couldn’t keep a backup copy, so nothing was changed: ' + err, 6000);
    return false;
  }
  close(true);
  o.doc = JSON.parse(JSON.stringify(doc));
  // no Undo back to before the choice: it would quietly bring back what was just chosen against
  // (only its backup copy would hold the other version)
  o.forgetUndo();
  o.base = c.theirs;
  o.hash = c.hash;
  o.conflict = false;
  o.dirty = true;
  o.banner.hidden = true;
  o.app.conflicts?.delete(o);
  o.render();
  await o.save(); // the file may have changed again meanwhile: merged then, or asked again
  const lost = sides.includes('mine') || sides.includes('theirs'); // ("both" loses nothing)
  if (!o.conflict) o.app.toast(lost ? 'Kept your choice; the other version is in logseq/bak.' : items.length ? 'Kept both.' : 'Saved.', 3500);
  return true;
}

/** The two versions couldn't be compared (say the file couldn't be read): the choice as it was
 *  before the clash screen, a whole version each, on the page's banner. */
function wholeChoice(o, err) {
  if (err) o.app.toast('Couldn’t compare the two versions: ' + err, 6000);
  o.showBanner(`<span>This page was also changed ${o.elsewhere()}, and the two versions couldn’t be compared note by note. Nothing on this page is saved until you choose. The version you don’t keep is saved as a backup copy in <code>logseq/bak</code>.</span>
    <span class="btn-row"><button class="btn" data-a="choose">Try again</button><button class="btn ghost" data-a="theirs">Use the other version</button><button class="btn" data-a="mine">Keep mine</button></span>`);
  o.banner.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'choose') { o.showConflict(); return; }
    if (a === 'mine') { // the file's version goes to logseq/bak first (app.rs save, with force)
      while (o.saving) await o.saving; // a save already on its way finishes first, then this one, forced
      o.dirty = true;
      o.conflict = false;
      await o.save(true);
      if (o.saveError) { // couldn't save (its message says why): still only here, still waiting
        o.conflict = true;
        wholeChoice(o, null);
        return;
      }
    } else if (a === 'theirs') {
      try { await o.backupMine(); } catch (err2) { o.app.toast('Couldn’t keep a backup copy, so nothing was changed: ' + err2, 6000); return; }
      o.dirty = false;
      o.conflict = false;
      await o.reload(true);
    } else return;
    if (!o.conflict) o.app.conflicts?.delete(o);
  };
}

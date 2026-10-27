// Notes dragged by their dot to another page (editor.js dragEnd, loaded the first time): another day in
// the Journals list, the page on the other side, or a page in the sidebar's Favourites / Recent (its
// end). With Alt held, a block reference to them goes there instead (Logseq's way) and they stay.
//
// Two files change, so the order is what keeps every note safe:
//   1. both pages as their files have them: typing waiting to be saved is saved first (a clash
//      waiting there, or a save that fails: nothing moves);
//   2. the notes go into the other page, which is saved at once;
//   3. only then are they taken out of their page, saved at once.
// If 2 can't be saved, that page goes back as it was and nothing else happens. If 3 can't be saved,
// the notes are taken out of the other page again (saved). So a note is never lost, and it's in two
// pages only if even that fails (the message says so, and which). A clash (the page was changed
// elsewhere meanwhile) counts as "couldn't be saved": the page then shows what its file has now,
// without the clash screen; nothing of his is in it to choose between.
// Notes keep their words, id:: included (references to them keep working); they're written in the
// other file's own way (its indent and line ends: `raw` dropped).
// Undo and Redo do both pages as one step (a Link, kept on both outlines' undo steps), in the same
// safe order: the page getting the notes back first. Never one page alone: a step that can't be
// done in both any more (a page closed, or changed elsewhere since) can't be undone, nor can the
// steps before it on those pages (each would bring the notes back, or take them away, in one alone).
// While this runs, the two pages can't be edited, dragged or undone (`locked`), so nothing typed is
// caught in between.
import { call, today, nowTime } from './api.js';
import { withProp, idIn, newId, clone, docKey, referWhy } from './editor.js';

const said = (e) => String(e?.message ?? e).replace(/^Error: /, '').replace(/\.$/, '');
const empty = () => ({ depth: 0, text: '', raw: null });
/** The newest entry of outline o in the app's list of steps moves to list `to` (or just goes). */
function shift(o, from, to = null) {
  const k = from.lastIndexOf(o);
  if (k >= 0) from.splice(k, 1);
  to?.push(o);
}
/** Where notes ([{depth, text}]) are, one after another, in blocks: at `near` if they're there, else
 *  the last place they are. -1: nowhere (changed meanwhile). */
function findRun(blocks, notes, near) {
  const at = (k) => k >= 0 && notes.every((n, m) => blocks[k + m]?.depth === n.depth && blocks[k + m].text === n.text);
  if (near != null && at(near)) return near;
  for (let k = blocks.length - notes.length; k >= 0; k--) if (at(k)) return k;
  return -1;
}

/** o as its file has it: what's typed is saved first (the usual save: a change made elsewhere is merged
 *  in, a clash opens its screen). false: it couldn't be. */
async function settle(o) {
  o.stopEdit();
  await o.flush();
  return !o.dirty && !o.conflict;
}

/** Save o's change now, once, without the clash screen: true, 'clash' (its file was changed elsewhere
 *  in the same notes meanwhile), or why it couldn't be saved. */
async function saveNow(o) {
  clearTimeout(o.timer);
  o.quiet = true;
  let tried = false;
  for (;;) {
    if (o.saving) { await o.saving; continue; } // (one on its way first, and any queued behind it)
    if (!o.dirty || o.conflict || o.readonly || tried) break;
    tried = true;
    await o.save();
  }
  const clash = o.quiet === 'clash' || o.conflict;
  o.quiet = false;
  if (clash) return 'clash';
  return o.dirty ? said(o.saveError || 'it couldn’t be saved') : true;
}

/** o's change (its newest step, linked to L) couldn't be saved (r): o goes back to what its file has.
 *  A clash: read again, showing the change made elsewhere. */
async function putBack(o, r, L) {
  if (o.undoStack.at(-1)?.link === L) { const st = o.undoStack.pop(); shift(o, o.app.steps); o.restore(st); }
  if (r === 'clash') { o.conflict = false; try { await o.reload(true); } catch { /* it says so when read next */ } }
  else { clearTimeout(o.timer); o.dirty = false; } // (what the file has: nothing to save)
}

/** Steps one after another, each saved before the next ({run, back}: true or why not). If one can't
 *  be done, the ones done go back, newest first. stuck: one of those couldn't go back either. */
async function inTurn(steps) {
  const done = [];
  for (const s of steps) {
    const r = await s.run();
    if (r === true) { done.push(s); continue; }
    let stuck = null;
    for (const d of done.reverse()) { const b = await d.back(); if (b !== true) stuck ??= { step: d, why: b }; }
    return { ok: false, step: s, why: r, stuck };
  }
  return { ok: true };
}

// ---------- a page that isn't on screen: its file, read and saved like the editor saves ----------
async function savePage(app, pv, doc, base) {
  let res;
  try { res = await call('save', { name: pv.info.name, doc, base_hash: pv.hash, force: false, path: pv.info.path, base }); } catch (e) { return said(e); }
  if (res.conflict) return 'clash';
  app.refCache?.clear();
  if (!pv.info.exists) app.refreshNames(); // (a new page: it exists now)
  app.reloadPage(pv.info.name); // (open somewhere meanwhile: it shows it)
  return true;
}
async function readPage(p) {
  try { return await call('page', { name: p.name, today: today(), time: nowTime() }); } catch (e) { return said(e); }
}
/** p.notes at the end of page p (its file read now, saved against what was read: a change made
 *  elsewhere meanwhile is merged in, a clash adds nothing). An empty page's empty note makes way. */
async function addToPage(app, p) {
  const pv = await readPage(p);
  if (typeof pv === 'string') return pv;
  if (pv.readonly) return pv.error || 'it can’t be changed here';
  if (p.path && pv.info.path !== p.path) return 'its file changed (renamed or moved)';
  const base = pv.from_template ? { ...clone(pv.doc), blocks: [] } : pv.doc;
  const doc = clone(pv.doc);
  p.was = doc.blocks.length === 1 && !doc.blocks[0].text.trim() ? doc.blocks.pop() : null;
  p.at = doc.blocks.length;
  doc.blocks.push(...p.notes.map((n) => ({ depth: n.depth, text: n.text, raw: null })));
  return savePage(app, pv, doc, base);
}
/** p.notes out of page p again (found by their words, where they were put if still there). */
async function takeFromPage(app, p) {
  const pv = await readPage(p);
  if (typeof pv === 'string') return pv;
  if (pv.readonly) return pv.error || 'it can’t be changed here';
  const doc = clone(pv.doc);
  const k = findRun(doc.blocks, p.notes, p.at);
  if (k < 0) return 'they were changed there meanwhile';
  doc.blocks.splice(k, p.notes.length);
  if (!doc.blocks.length && p.was) doc.blocks.push(p.was);
  return savePage(app, pv, doc, pv.doc);
}

/** A change made in two pages at once (or in a page not on screen), undone and redone as one step.
 *  parts, in the order they were done: {o} (an outline: its step is on its undo list, marked with this
 *  link) or {name, path, notes} (a page's file: the notes added at its end). */
class Link {
  constructor(app, what) { this.app = app; this.what = what; this.parts = []; this.state = 'doing'; }
  get outs() { return this.parts.filter((p) => p.o).map((p) => p.o); }
  /** Every page's step still there, on top (undo: its undo list; else its redo list). */
  intact(undo) { return this.outs.every((o) => (undo ? o.undoStack : o.redoStack).at(-1)?.link === this); }
  /** It can't be undone or redone any more: nor can the steps before it on its pages (each would
   *  bring the notes back, or take them away, in one page alone). */
  drop() {
    this.state = 'dead';
    for (const o of this.outs) for (const s of [o.undoStack, o.redoStack]) {
      const k = s.findLastIndex((x) => x.link === this);
      if (k >= 0) s.splice(0, k + 1);
    }
  }
  /** Undo (undo true) or redo it, in both pages, each saved before the next. */
  async go(undo) {
    const app = this.app;
    if (this.state !== (undo ? 'done' : 'undone')) { if (this.state === 'doing') app.toast('Still saving… try again in a moment.', 2500); return; }
    if (app.moving) { app.toast('Still saving a move… try again in a moment.', 2500); return; }
    for (const o of this.outs) {
      const live = app.outlines.includes(o);
      const st = undo ? o.undoStack : o.redoStack;
      if (live && st.at(-1)?.link === this) continue;
      if (live && st.some((x) => x.link === this)) {
        app.toast(`First ${undo ? 'undo' : 'redo'} the newer changes in “${o.name}”${app.pane.outlines.includes(o) ? '' : ' (on the other side)'}.`, 5000);
        return;
      }
      this.drop();
      app.toast(`That ${this.what} can’t be ${undo ? 'undone' : 'redone'} any more: “${o.name}” was changed elsewhere or closed since.`, 6000);
      return;
    }
    const was = this.state;
    this.state = 'doing';
    app.moving = true;
    for (const o of this.outs) o.locked = true;
    try {
      for (const o of this.outs) if ((o.dirty || o.saving) && !(await settle(o))) { app.toast(`Couldn’t ${undo ? 'undo' : 'redo'}: “${o.name}” couldn’t be saved first.`, 6000); this.state = was; return; }
      if (!this.intact(undo)) { this.state = was; this.drop(); app.toast(`That ${this.what} can’t be ${undo ? 'undone' : 'redone'} any more: a page was changed elsewhere meanwhile.`, 6000); return; }
      // the page getting the notes back first: undo goes back through the parts, redo as they were done
      const order = undo ? [...this.parts].reverse() : this.parts;
      const res = await inTurn(order.map((p) => ({ run: () => this.one(p, undo), back: () => this.one(p, !undo) })));
      if (res.ok) {
        this.state = undo ? 'undone' : 'done';
        for (const o of this.outs) shift(o, undo ? app.steps : app.redoSteps, undo ? app.redoSteps : app.steps);
        return;
      }
      this.state = was;
      if (!this.intact(undo)) this.drop(); // (a page read again after a clash: its steps are gone)
      const name = res.step.part.o?.name ?? res.step.part.name;
      const why = res.why === 'clash' ? `“${name}” was changed elsewhere just now` : `couldn’t save “${name}” (${res.why})`;
      if (res.stuck && this.what === 'move') app.toast(`Careful: undoing the move stopped half way (${why}), and going back failed too, so the notes are now in two pages. Delete them from one.`, 15000);
      else app.toast(`Couldn’t ${undo ? 'undo' : 'redo'} the ${this.what}: ${why}. Both pages are as they were.`, 8000);
    } finally {
      for (const o of this.outs) o.locked = false;
      app.moving = false;
    }
  }
  /** One page's part, undone (undo) or done again, and saved now; if that can't be saved, the page
   *  goes back to what its file has. */
  async one(p, undo) {
    if (!p.o) return undo ? takeFromPage(this.app, p) : addToPage(this.app, p);
    const o = p.o;
    const key = docKey(o.doc);
    if (undo) o.undo(true); else o.redo(true);
    if (docKey(o.doc) === key) { clearTimeout(o.timer); o.dirty = false; return true; } // (a step that changed nothing here: nothing to save)
    const r = await saveNow(o);
    if (r === true) return true;
    if (undo) o.redo(true); else o.undo(true); // (as its file still has it)
    if (r === 'clash') { o.conflict = false; try { await o.reload(true); } catch { /* said when read next */ } }
    else { clearTimeout(o.timer); o.dirty = false; }
    return r;
  }
}

/** Notes dragged from outline S (D: editor.js's drag) were dropped elsewhere (hit: {o, t} another
 *  outline and its place, or {page} a page in the sidebar). The same page (its own, or open on the
 *  other side): a move within it (one page, its usual Undo). Another page: transfer. */
export async function dropElsewhere(S, D, hit) {
  const app = S.app;
  const sorry = (why) => app.toast(`Nothing was ${D.alt ? 'added' : 'moved'}: ${why}`, 8000);
  if (app.moving) return sorry('the last move is still being saved. Try again in a moment.');
  let T = hit.o ?? null, t = hit.t ?? null, pv = null;
  if (hit.page) { // a page in the sidebar: to its end, through its outline if it's on screen
    pv = await readPage({ name: hit.page });
    if (typeof pv === 'string') return sorry(pv);
    const isIt = (o) => o.path === pv.info.path && o.name.toLowerCase() === pv.info.name.toLowerCase();
    T = isIt(S) ? S : app.outlines.filter(isIt).sort((a, b) => (a.root === null ? 0 : 1) - (b.root === null ? 0 : 1))[0] ?? null;
    if (T) t = { own: false, B: null, end: T.blocks.length, d: 0, blocks: T.blocks };
    else if (pv.readonly) return sorry(pv.error || `“${pv.info.name}” can’t be changed here.`);
  }
  if (S.blocks !== D.blocks || S.changes !== D.changes || (T && T.blocks !== t.blocks)) return sorry('the page changed meanwhile. Please try again.');
  if (T && T.path === S.path && T.name.toLowerCase() === S.name.toLowerCase()) { // the same page
    // (its place t counts in T's notes: only the same as S's while both sides hold the same words)
    if (T !== S && docKey(T.doc) !== docKey(S.doc)) { T.flush?.(); S.flush?.(); return sorry('the other side shows this page with changes not saved yet. Try again in a moment.'); }
    if (D.alt) S.dropRefs(D, t); else S.dropNotes(D, t);
    if (T !== S || hit.page) app.toast(D.alt ? 'Reference added.' : `Moved${hit.page ? ' to the end of the page' : ''}.`, 2500);
    return;
  }
  return transfer(S, D, T, t, pv);
}

/** Notes [D.a, D.z) of S into outline T at its place t, or to the end of page pv (T null): moved, or
 *  (Alt) a reference to each top one there. In the safe order (top of this file), one Undo step. */
async function transfer(S, D, T, t, pv) {
  const app = S.app;
  const name = T ? T.name : pv.info.name;
  const sorry = (why) => app.toast(`Nothing was ${D.alt ? 'added' : 'moved'}: ${why}`, 8000);
  const outs = T ? [S, T] : [S];
  const bad = outs.find((o) => o.readonly || o.conflict);
  if (bad) return sorry(bad.conflict ? `“${bad.name}” has a clash to settle first.` : `“${bad.name}” can’t be changed here.`);
  if (D.alt) { // (the same rules as (( : an id Logseq can read, given only to a note written as a Logseq bullet)
    for (let j = D.a; j < D.z; j++) {
      const why = S.blocks[j].depth === D.depth && referWhy(S.blocks[j]);
      if (why) return sorry(why);
    }
  }
  const tc = T?.changes;
  const L = new Link(app, D.alt ? 'reference' : 'move');
  app.moving = true;
  for (const o of outs) o.locked = true;
  try {
    for (const o of outs) if (!(await settle(o))) return sorry(o.conflict ? `“${o.name}” has a clash to settle first.` : `“${o.name}” couldn’t be saved first.`);
    if (S.blocks !== D.blocks || S.changes !== D.changes || (T && (T.blocks !== t.blocks || T.changes !== tc))) return sorry('the page changed meanwhile. Please try again.');
    const len = D.z - D.a;
    const tops = [];
    for (let j = D.a; j < D.z; j++) if (S.blocks[j].depth === D.depth) tops.push(j);
    // a change in an outline: one step, linked; saved at once (put back if it can't be)
    const step = (o, change, back) => ({
      part: { o },
      run: async () => {
        o.snap();
        o.undoStack.at(-1).link = L;
        change();
        o.render();
        o.markDirty();
        const r = await saveNow(o);
        if (r !== true) await putBack(o, r, L);
        return r;
      },
      back,
    });
    // ... and going back once saved: its step taken off again (or, if a change made elsewhere was
    // merged in meanwhile, its notes found by their words), saved at once
    const unstep = async (o, notes = null, near = null) => {
      const was = o.snapshot(); // (what its file has now: shown again if going back can't be saved)
      if (o.undoStack.at(-1)?.link === L) { const st = o.undoStack.pop(); shift(o, app.steps); o.restore(st); }
      else if (notes) {
        const k = findRun(o.blocks, notes, near);
        if (k < 0) return 'they were changed there meanwhile';
        o.blocks.splice(k, notes.length);
        if (!o.blocks.length) o.blocks.push(empty());
        o.render();
        o.markDirty();
      } else return true; // (an id:: left on a note: harmless)
      const r = await saveNow(o);
      if (r === 'clash') { o.conflict = false; try { await o.reload(true); } catch { /* said when read next */ } }
      else if (r !== true) { o.restore(was); clearTimeout(o.timer); o.dirty = false; }
      return r;
    };
    // what goes there: the notes themselves (their levels from the top one's), or references to them
    const ids = new Map(tops.map((j) => [j, idIn(S.blocks[j].text) || newId()]));
    const notes = D.alt ? tops.map((j) => ({ depth: 0, text: `((${ids.get(j)}))` }))
      : S.blocks.slice(D.a, D.z).map((b) => ({ depth: b.depth - D.depth, text: b.text }));
    let into;
    if (T) {
      const only = T.root === null && T.blocks.length === 1 && !T.blocks[0].text.trim(); // (an empty day: in place of its empty note)
      const at = only ? 0 : t.B ?? t.end;
      const there = notes.map((n) => ({ depth: n.depth + (only ? 0 : t.d), text: n.text }));
      into = step(T, () => {
        T.stopEdit();
        T.clearSel();
        T.blocks.splice(at, only ? 1 : 0, ...there.map((n) => ({ ...n, raw: null })));
        T.joinList(at, at + there.length);
      }, () => unstep(T, there, at));
    } else {
      const part = { name: pv.info.name, path: pv.info.path, notes };
      into = { part, run: () => addToPage(app, part), back: () => takeFromPage(app, part) };
    }
    const steps = [];
    if (D.alt) {
      const need = tops.filter((j) => !idIn(S.blocks[j].text));
      // the ids first, so a reference never names a note that has no id in its file. None needed: a
      // step here all the same, changing nothing, so Ctrl+Z on this side reaches the reference too
      if (need.length) steps.push(step(S, () => { for (const j of need) S.blocks[j].text = withProp(S.blocks[j].text, 'id', ids.get(j)); S.clearSel(); }, () => unstep(S)));
      else steps.push({ part: { o: S }, run: async () => { S.snap(); S.undoStack.at(-1).link = L; return true; }, back: async () => { if (S.undoStack.at(-1)?.link === L) { S.undoStack.pop(); shift(S, app.steps); } return true; } });
      steps.push(into);
    } else {
      steps.push(into, step(S, () => {
        S.clearSel();
        S.blocks.splice(D.a, len);
        if (!S.blocks.length) S.blocks.push(empty());
      }, null));
    }
    const res = await inTurn(steps);
    if (!res.ok) {
      const who = res.step.part.o?.name ?? res.step.part.name;
      const why = res.why === 'clash' ? `“${who}” was changed elsewhere just now (it shows that now). Please try again.` : `couldn’t save “${who}” (${res.why}).`;
      if (res.stuck && !D.alt) app.toast(`Careful: the notes are now in both “${S.name}” and “${name}”: ${why} Taking them out of “${name}” again failed too (${res.stuck.why === 'clash' ? 'it was changed elsewhere' : res.stuck.why}). Delete them from one of the two.`, 20000);
      else sorry(why);
      return;
    }
    L.parts = steps.map((s) => s.part);
    L.state = 'done';
    if (!L.intact(true)) L.drop(); // (a change made elsewhere was merged into one meanwhile: no Undo)
    if (app.active?.cur == null) app.active = S;
    const msg = D.alt ? `${tops.length > 1 ? 'References' : 'Reference'} added in “${name}”.` : `Moved to “${name}”.`;
    app.toast(msg, 6000, L.state === 'done' ? { label: 'Undo', run: () => L.go(true) } : null);
  } finally {
    for (const o of outs) o.locked = false;
    app.moving = false;
  }
}

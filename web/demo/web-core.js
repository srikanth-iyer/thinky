// thinky's own core (core/, the Rust code that reads, writes and searches notes) running inside
// this web page, for the website's "try it" demo. The core is built as WebAssembly (a program
// format browsers run; web/core-wasm), and is handed a pretend notes folder kept in the page's
// memory (the WASI file layer in ./wasi, copied next to it by web/build-demo.sh: MIT/Apache licensed, from @bjorn3/browser_wasi_shim 0.4.2).
// Nothing leaves the visitor's browser: no server, no account.
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory, wasi as W } from './wasi/index.js';

// Two things the pretend disk lacks, which the core uses to tell changed files from unchanged:
// each file's "last changed" time (always 0 in the file layer), and the right place for times in its
// answer (its write_bytes puts them at bytes 38/46/52; WASI's layout has them at 40/48/56).
const nowNs = () => BigInt(Date.now()) * 1000000n;
W.Filestat.prototype.write_bytes = function (view, ptr) {
  view.setBigUint64(ptr, this.dev, true);
  view.setBigUint64(ptr + 8, this.ino, true);
  view.setUint8(ptr + 16, this.filetype);
  view.setBigUint64(ptr + 24, this.nlink, true);
  view.setBigUint64(ptr + 32, this.size, true);
  view.setBigUint64(ptr + 40, this.atim, true);
  view.setBigUint64(ptr + 48, this.mtim, true);
  view.setBigUint64(ptr + 56, this.ctim, true);
};
const fileStat = File.prototype.stat;
File.prototype.stat = function () {
  const st = fileStat.call(this);
  this.mtime ??= nowNs();
  st.mtim = st.atim = st.ctim = this.mtime;
  return st;
};
for (const m of ['fd_write', 'fd_pwrite', 'fd_filestat_set_size']) {
  const f = OpenFile.prototype[m];
  OpenFile.prototype[m] = function (...a) { this.file.mtime = nowNs(); dirty = true; return f.apply(this, a); };
}
OpenFile.prototype.fd_filestat_set_times = function (atim, mtim, flags) {
  // (WASI's flags: 4 = set the given time, 8 = set now; the file layer's own names for them are wrong)
  if (flags & 4) this.file.mtime = mtim;
  else if (flags & 8) this.file.mtime = nowNs();
  return W.ERRNO_SUCCESS;
};

const NOTES = '/notes'; // where the pretend notes folder sits
const SAVED = 'webDemoNotes4';
// The first notes a visitor sees on today's journal page (website demo only; the app's own new
// notes folders don't get them). Plain outline text, as in any journal file.
const INTRO = `- **thinky**: an outliner notes app for Windows and Android that helps you place thoughts and ideas in the right place, so they are remembered at the right time.
\t- **Why I made it**: I was an avid Logseq user. When Logseq decided to move away from Markdown files, I built my own, so I could keep working the way I loved and add the features I wanted along the way.
\t- Inspired by Logseq and Obsidian: every note is a plain Markdown file in a folder you own.
\t- Designed with ADHD-like minds in mind.
\t- Built around linked references, so each note stays in view of its larger context, and ideas connect to the setting and function they belong to.
\t- Works with AI tools that can read and change your notes directly (in the app; they're off in this demo).
\t- Open source and free for anyone to use and adopt.
- This is an online demo of thinky, running in your browser. Try anything: your notes stay in this browser and nothing is sent anywhere.
- To get thinky for Windows or Android, see the [thinky website](https://srikanth-iyer.github.io/thinky/).
`; // the visitor's notes, kept in this browser between visits (localStorage)
let dirty = false; // a file changed since the notes were last kept

let started;
/** The core, started on first use (one per page). */
export function webCore() {
  return (started ??= start());
}

/** Every text file under `dir`, as { "pages/a.md": text } (pictures and other non-text files left out). */
function snapshot(dir, prefix = '', out = {}) {
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (const [name, e] of dir.contents) {
    if (e instanceof Directory) snapshot(e, prefix + name + '/', out);
    else if (e instanceof File) try { out[prefix + name] = dec.decode(e.data); } catch { /* not text */ }
  }
  return out;
}

/** The kept notes (from snapshot) as the pretend folder's contents. */
function restore(files) {
  const enc = new TextEncoder(), top = new Directory(new Map());
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split('/');
    let d = top;
    for (const p of parts.slice(0, -1)) {
      if (!d.contents.has(p)) { const nd = new Directory(new Map()); nd.parent = d; d.contents.set(p, nd); }
      d = d.contents.get(p);
    }
    d.contents.set(parts.at(-1), new File(enc.encode(text)));
  }
  return top;
}

function loadKept() {
  try { return JSON.parse(localStorage.getItem(SAVED) || 'null'); } catch { return null; }
}

async function start() {
  const enc = new TextEncoder(), dec = new TextDecoder();
  // the pretend disk: "/" holds the "notes" folder (the visitor's kept notes, or an empty one that the
  // core fills with its own sample pages below)
  const kept = loadKept();
  const root = new PreopenDirectory('/', new Map([['notes', kept ? restore(kept) : new Directory(new Map())]]));
  const url = new URL('thinky_core.wasm', import.meta.url);
  let module;
  try {
    module = await WebAssembly.compileStreaming(fetch(url));
  } catch {
    // (a server that doesn't say the file is application/wasm: load it the slower way)
    module = await WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  }

  // One running copy of the core. If it stops on an error (a Rust "panic": the program can't go on),
  // a fresh copy is started on the same pretend disk and the notes are opened again, so the page
  // keeps working; only the command that failed is lost.
  let x;
  function boot() {
    const fds = [
      new OpenFile(new File([])), // (nothing to read from the keyboard)
      ConsoleStdout.lineBuffered((m) => console.log('[core] ' + m)),
      ConsoleStdout.lineBuffered((m) => console.warn('[core] ' + m)),
      root,
    ];
    const wasi = new WASI([], [], fds, { debug: false });
    const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi.wasiImport });
    wasi.initialize(instance);
    x = instance.exports;
  }
  boot();

  function raw(cmd, args) {
    const c = enc.encode(cmd), a = enc.encode(JSON.stringify(args ?? {}));
    const cp = x.thinky_alloc(c.length), ap = x.thinky_alloc(a.length);
    new Uint8Array(x.memory.buffer, cp, c.length).set(c);
    new Uint8Array(x.memory.buffer, ap, a.length).set(a);
    const out = x.thinky_call(cp, c.length, ap, a.length);
    x.thinky_free(cp, c.length);
    x.thinky_free(ap, a.length);
    // the answer: 4 bytes of length, then JSON (memory may have grown: read it fresh)
    const len = new DataView(x.memory.buffer).getUint32(out, true);
    return JSON.parse(dec.decode(new Uint8Array(x.memory.buffer, out + 4, len)));
  }

  let opened = null; // the "open" arguments, to open again after a restart
  /** One command to the core, as the app's call(): its answer, or an Error with the core's words. */
  function call(cmd, args = {}) {
    let j;
    try {
      j = raw(cmd, args);
    } catch (e) {
      if (!(e instanceof WebAssembly.RuntimeError)) throw e;
      console.warn('[core] stopped on an error in ' + cmd + '; starting it again', e);
      boot();
      if (opened) raw('open', opened);
      throw new Error('Something went wrong in ' + cmd + ' (the demo started its notes engine again).');
    }
    if ('error' in j) throw new Error(j.error);
    if (cmd === 'open') opened = args;
    if (dirty) keepSoon();
    return j.ok;
  }

  // keep the visitor's notes in this browser a moment after a change, and when the page is left
  let timer = 0;
  function keep() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(SAVED, JSON.stringify(snapshot(root.dir.contents.get('notes')))); } catch { /* full, or not allowed */ }
  }
  function keepSoon() { clearTimeout(timer); timer = setTimeout(keep, 800); }
  addEventListener('pagehide', keep);
  document.addEventListener('visibilitychange', () => { if (document.hidden) keep(); });

  if (!kept) {
    // the core's own sample notes (the welcome screen's "Start with a few sample pages"), dated today
    const d = new Date();
    call('start_notes', { path: NOTES, today: [d.getFullYear(), d.getMonth() + 1, d.getDate()], demo: true });
    // the website's own first notes, above the app's welcome: what thinky is for and why it exists
    const day = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}.md`;
    const journal = root.dir.contents.get('notes')?.contents?.get('journals')?.contents?.get(day);
    if (journal instanceof File) {
      journal.data = enc.encode(INTRO + new TextDecoder().decode(journal.data));
      dirty = true;
    }
  }

  /** A file in the pretend folder ("assets/x.png"), as bytes, or null: for pictures. */
  function readFile(rel) {
    let e = root.dir.contents.get('notes');
    for (const part of rel.split('/').filter(Boolean)) e = e?.contents?.get(part);
    return e instanceof File ? e.data : null;
  }
  /** Start over: forget the visitor's notes (the page is then reloaded). */
  function reset() { clearTimeout(timer); dirty = false; removeEventListener('pagehide', keep); localStorage.removeItem(SAVED); }
  return { call, readFile, reset, folder: NOTES };
}

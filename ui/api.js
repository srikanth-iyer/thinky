// Backend bridge: Tauri when running as the app, HTTP when running under the dev server, and the
// core itself inside the page on the website's demo (web/demo/web-core.js, which web/build-demo.sh
// copies next to this file; <html data-web-demo>, or a
// <meta name="thinky-web-demo"> where the page's <html> isn't its own).
const T = window.__TAURI__;
// (`?.`: also loaded in plain Node by dev/ui-tests/unit.mjs, with no page or a stand-in one)
const WEB = !T && typeof document !== 'undefined' && !!(document.documentElement?.hasAttribute?.('data-web-demo') || document.querySelector?.('meta[name="thinky-web-demo"]'));
/** the website's demo (not the app): app.js offers only the online looks there (WEB_LOOKS) */
export const isWebDemo = WEB;
/** the demo's core, once started (assetUrl needs it at once) */
let web = null;

/** A command on the website's demo: the core in the page answers, except what only the app's own
 *  shell answers (Windows/Android), which the demo doesn't have. */
async function webCall(cmd, args) {
  // (kept out of ui/, so the app never carries it: only the demo's folder has it, hence a name the
  // type check doesn't look up)
  const demoCore = './web-core.js';
  web ??= await (await import(demoCore)).webCore();
  if (cmd === 'start_link') return null; // (the Windows app's: a link it was started with)
  if (cmd === 'ai_key_has') return false;
  if (cmd.startsWith('ai_key') || cmd === 'ai_send') throw new Error('The AI features need the thinky app: this demo runs only in your browser.');
  return web.call(cmd, args);
}

/** opts.keepalive: the request may outlive the page (sent while it closes or reloads; the dev
 *  server only, and only small ones, as browsers allow) */
export async function call(cmd, args = {}, opts = {}) {
  if (T) return T.core.invoke('call', { cmd, args });
  if (WEB) return webCall(cmd, args);
  const body = JSON.stringify(args);
  const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: !!opts.keepalive && body.length < 60000 });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export const isApp = !!T;
/** The app's name as people see it (the welcome screen…): the one place to change when it's renamed. */
export const APP_NAME = 'thinky';

/** Links that open the app right at a page or a note (outline_core::link reads them back). */
export const pageLinkUrl = (name) => 'leanoutliner://page/' + encodeURIComponent(name.trim());
export const noteLinkUrl = (id) => 'leanoutliner://note/' + encodeURIComponent(id.trim().toLowerCase());
export const isAndroid = !!window.LeanAndroid;

/** Listen to an app event (file changes, window closing). No-op under the dev server. */
export function listen(event, fn) {
  T?.event?.listen?.(event, fn);
}

export function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

/** "14:05" (now, or at Date d) */
export function nowTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Address of a file in the notes folder (e.g. "../assets/x.png") for showing it. */
export function assetUrl(rel) {
  const p = rel.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '').replace(/^\/+/, '');
  let decoded = p;
  try { decoded = decodeURIComponent(p); } catch { /* keep as written */ }
  // never a drive or a network share (\\server\share): only files inside the notes folder
  if (/^\\|:/.test(decoded)) return 'data:,';
  if (T?.core?.convertFileSrc) return T.core.convertFileSrc(decoded, 'vault');
  if (WEB) {
    // a picture in the demo's pretend folder: its bytes, handed to the browser as a blob (a file kept
    // in the page's memory); never a picture that could run script (SVG, HTML)
    const bytes = web?.readFile(decoded);
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[decoded.split('.').pop().toLowerCase()];
    return bytes && type ? URL.createObjectURL(new Blob([bytes], { type })) : 'data:,';
  }
  return '/vault/' + decoded.split('/').map(encodeURIComponent).join('/');
}

export const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// the demo opens its own sample notes (web-core.js makes them in /notes) without the welcome screen
if (WEB && !store.get('vault', '')) store.set('vault', '/notes');

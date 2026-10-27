// Backend bridge: Tauri when running as the app, HTTP when running under the dev server.
const T = window.__TAURI__;

/** opts.keepalive: the request may outlive the page (sent while it closes or reloads; the dev
 *  server only, and only small ones, as browsers allow) */
export async function call(cmd, args = {}, opts = {}) {
  if (T) return T.core.invoke('call', { cmd, args });
  const body = JSON.stringify(args);
  const r = await fetch('/api/' + cmd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: !!opts.keepalive && body.length < 60000 });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export const isApp = !!T;

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

/** "14:05" */
export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Address of a file in the notes folder (e.g. "../assets/x.png") for showing it. */
export function assetUrl(rel) {
  const p = rel.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '').replace(/^\/+/, '');
  let decoded = p;
  try { decoded = decodeURIComponent(p); } catch { /* keep as written */ }
  if (T?.core?.convertFileSrc) return T.core.convertFileSrc(decoded, 'vault');
  return '/vault/' + decoded.split('/').map(encodeURIComponent).join('/');
}

export const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Backend bridge: Tauri when running as the app, HTTP when running under the dev server.
const T = window.__TAURI__;

export async function call(cmd, args = {}) {
  if (T) return T.core.invoke('call', { cmd, args });
  const r = await fetch('/api/' + cmd, { method: 'POST', body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export const isApp = !!T;

export function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

export const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

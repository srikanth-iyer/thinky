// The optional AI features (Build 51; he asked, Nov 18): off until an AI service is chosen in Settings →
// AI. Not tied to one company: Claude, OpenAI, Gemini, OpenRouter, or a program on this computer
// (Ollama, LM Studio). The requests are built by the app's own Rust code (core ai.rs: one place for
// both request formats and Polish note's fixed instructions) and sent by the shell, which keeps the
// key outside the notes folder and never hands it to the page: Windows' Credential Manager + its
// curl.exe (src-tauri ai_key.rs), Android's Keystore + its own web code (AiKeys.kt), the dev server's
// memory + curl. Settings here are this device's own (localStorage `ai`), like its key.
import { call, store, today, isAndroid } from './api.js';

const DEFAULTS = { provider: '', base: '', textModel: '', pictureModel: '', mark: true, extra: { polish: '' } };

/** This device's AI settings (Settings → AI). */
export function aiSettings() {
  const s = store.get('ai', null) || {};
  return { ...DEFAULTS, ...s, extra: { ...DEFAULTS.extra, ...(s.extra || {}) } };
}
export function setAiSettings(patch) {
  const s = { ...aiSettings(), ...patch };
  store.set('ai', s);
  document.documentElement.classList.toggle('ai-on', aiOn(s));
  return s;
}
/** An AI is set up: a service and a text model chosen (the features show only then). */
export const aiOn = (s = aiSettings()) => !!(s.provider && s.textModel);

/** What the Rust side needs to build a request: the service, its address, the model. */
export const setupOf = (s = aiSettings(), model = s.textModel) => ({ provider: s.provider, base: s.base || '', model: model || '' });

let PROVIDERS = null;
export async function providers() {
  if (!PROVIDERS) PROVIDERS = await call('ai_providers');
  return PROVIDERS;
}

// ---------- keys (kept by the system, never by the page) ----------
export async function keySet(provider, key) {
  if (isAndroid) {
    const why = window.LeanAndroid.aiKeySet(provider, key);
    if (why) throw new Error(why);
    return !!key.trim();
  }
  return call('ai_key_set', { provider, key });
}
export async function keyHas(provider) {
  if (isAndroid) return !!window.LeanAndroid.aiKeyHas(provider);
  return call('ai_key_has', { provider }).catch(() => false);
}

// ---------- sending ----------
const waiting = new Map(); // (Android: request id → its promise's resolve)
if (isAndroid) {
  document.addEventListener('lean-ai', (e) => {
    let d = e.detail;
    try { if (typeof d === 'string') d = JSON.parse(d); } catch { return; }
    const done = waiting.get(d.id);
    if (done) { waiting.delete(d.id); done(d); }
  });
}
let seq = 0;
/** Send one request built by the Rust side; {status, body}. */
async function send(provider, req) {
  if (isAndroid) {
    const id = 'ai' + (++seq) + '-' + Date.now();
    const d = await new Promise((resolve) => { waiting.set(id, resolve); window.LeanAndroid.aiSend(id, provider, JSON.stringify(req)); });
    if (d.error) throw new Error(d.error);
    return { status: d.status, body: d.body };
  }
  return call('ai_send', { provider, req });
}

/** The models a service offers (Settings' lists and its Test button). */
export async function listModels(s = aiSettings()) {
  const setup = setupOf(s, '');
  const req = await call('ai_models_request', { setup });
  const r = await send(s.provider, req);
  return call('ai_models_read', { setup, status: r.status, body: r.body });
}

/** Polish note: the note's text in, {notes: [text…], unlinked, same} out (core ai.rs checks it:
 *  only pages and tags that exist, the note's own properties kept, `by:: ai` when asked). */
export async function polishText(text) {
  const s = aiSettings();
  if (!aiOn(s)) throw new Error('Set up an AI in Settings → AI first.');
  const setup = setupOf(s);
  const req = await call('ai_polish_request', { setup, text, today: today(), extra: s.extra.polish || '' });
  const r = await send(s.provider, req);
  return call('ai_polish_read', { setup, status: r.status, body: r.body, text, mark: !!s.mark });
}

document.documentElement.classList.toggle('ai-on', aiOn());

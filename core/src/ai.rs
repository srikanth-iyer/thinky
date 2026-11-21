//! Optional AI features (Build 51; he asked, Nov 18): off unless someone sets up an AI in Settings → AI.
//! Not tied to one company: Claude's own request format, or the OpenAI-style one that OpenAI, Gemini,
//! OpenRouter and local programs (Ollama, LM Studio) all accept. Nothing here runs by itself: each
//! request starts from a button the person pressed, and every change it suggests is shown to them
//! before anything is saved (ui/polish.js).
//!
//! What lives here (no OS, no key): the providers' presets, the request for each format (address,
//! headers, body), reading the answer, and Polish note's fixed instructions and the checks on its
//! answer (it may only link pages and use tags that already exist). The request is sent by the shell
//! with the key it keeps outside the notes folder: Windows' own curl.exe (`send_with_curl`, the key
//! from Windows' Credential Manager), Android's own web code (MainActivity), the dev server's curl.

use crate::date::{self, Date};
use crate::search::fold;
use crate::Vault;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;

/// A provider the Settings list offers: its web address is filled in, the person adds a key (or,
/// for a program on their own computer, nothing).
#[derive(Serialize, Clone, Copy)]
pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub base: &'static str,
    /// "required", "optional" (a local program) or "none"
    pub key: &'static str,
    /// "claude" or "openai" (the request format)
    pub format: &'static str,
    /// a few words under the list
    pub note: &'static str,
}

pub const PROVIDERS: &[Provider] = &[
    Provider { id: "claude", name: "Claude (Anthropic)", base: "https://api.anthropic.com/v1", key: "required", format: "claude", note: "A key from console.anthropic.com" },
    Provider { id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "required", format: "openai", note: "A key from platform.openai.com" },
    Provider { id: "gemini", name: "Gemini (Google)", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "required", format: "openai", note: "A key from aistudio.google.com" },
    Provider { id: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", key: "required", format: "openai", note: "One key for many companies' models" },
    Provider { id: "ollama", name: "Ollama (on this computer)", base: "http://localhost:11434/v1", key: "none", format: "openai", note: "Works offline, no key" },
    Provider { id: "lmstudio", name: "LM Studio (on this computer)", base: "http://localhost:1234/v1", key: "none", format: "openai", note: "Works offline, no key" },
    Provider { id: "other", name: "Other (OpenAI-style)", base: "", key: "optional", format: "openai", note: "Any service or program that speaks the OpenAI format" },
];

pub fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

/// What the page sends: the provider picked, its address (the preset's unless "Other") and the model.
#[derive(Deserialize, Clone, Default)]
pub struct Setup {
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub base: String,
    #[serde(default)]
    pub model: String,
}

/// One request, ready for the shell to send. `auth` says where the key goes ("x-api-key", "bearer"),
/// or nothing; the key itself is never in here.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Request {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub auth: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    /// an http:// address on this computer or the home network (a local program)
    #[serde(default)]
    pub local: bool,
    /// the service needs a key (not an "Other" one, where a key is up to the person)
    #[serde(default)]
    pub key_required: bool,
}

/// A web address the requests may go to: https anywhere, http only to this computer or the home
/// network (Ollama, LM Studio). No spaces, quotes or line breaks (the curl settings written from it),
/// and no `@`, `{` or `}` anywhere (review claim 3: `http://localhost:80@attacker.example` names
/// attacker.example to curl, and curl reads `{a,b}` as a list of addresses). The computer's name ends
/// at the first `/`, `?` or `#`; a number address is read strictly (`0127.0.0.1` is refused, not
/// taken as 127.0.0.1), and one in `[ ]` must be a real IPv6 address.
/// Gives it without a final "/", and whether it is such a local address.
pub fn check_base(base: &str) -> Result<(String, bool), String> {
    let b = base.trim().trim_end_matches('/');
    if b.is_empty() {
        return Err("Type the web address of the AI service.".into());
    }
    if b.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\\' || c == '\'') {
        return Err("That web address has spaces or quotes in it.".into());
    }
    if b.contains(['@', '{', '}']) {
        return Err("That web address has a character it can't have (@, { or }).".into());
    }
    let (http, rest) = if let Some(r) = b.strip_prefix("https://") {
        (false, r)
    } else if let Some(r) = b.strip_prefix("http://") {
        (true, r)
    } else {
        return Err("The address must start with https:// (or http:// for a program on this computer).".into());
    };
    let no_host = || "That web address has no name of a computer in it.".to_string();
    let host_port = rest.split(['/', '?', '#']).next().unwrap_or("");
    let (host, port) = if let Some(h) = host_port.strip_prefix('[') {
        let (h, after) = h.split_once(']').ok_or_else(no_host)?;
        let ip: std::net::Ipv6Addr = h.parse().map_err(|_| no_host())?;
        if !after.is_empty() && !after.starts_with(':') {
            return Err(no_host());
        }
        (Host::V6(ip), after.strip_prefix(':'))
    } else {
        let (h, port) = match host_port.split_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (host_port, None),
        };
        let h = h.to_ascii_lowercase();
        if h.is_empty() || !h.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_') {
            return Err(no_host());
        }
        if h.chars().all(|c| c.is_ascii_digit() || c == '.') {
            // a number address: four plain numbers 0-255, no leading zeros (std's strict reading)
            (Host::V4(h.parse().map_err(|_| "That web address's number (IP address) isn't a usual one.".to_string())?), port)
        } else {
            (Host::Name(h), port)
        }
    };
    if let Some(p) = port {
        if p.is_empty() || p.len() > 5 || !p.chars().all(|c| c.is_ascii_digit()) || p.parse::<u32>().map_or(true, |n| n == 0 || n > 65535) {
            return Err("That web address's port (the number after \":\") isn't a usual one.".into());
        }
    }
    let local = match &host {
        Host::V4(ip) => ip.is_loopback() || ip.is_private(),
        Host::V6(ip) => ip.is_loopback(),
        Host::Name(h) => is_local_name(h),
    };
    if http && !local {
        return Err("Only a program on this computer or your home network may use http://. Use https:// for a service on the internet.".into());
    }
    Ok((b.to_string(), http && local))
}

enum Host {
    V4(std::net::Ipv4Addr),
    V6(std::net::Ipv6Addr),
    Name(String),
}

fn is_local_name(h: &str) -> bool {
    h == "localhost" || h.ends_with(".local") || h.ends_with(".lan") || h.ends_with(".localhost")
}

/// Where a service's key goes in a request: "x-api-key" (Claude) or "bearer" (the OpenAI style), or
/// nothing for a service that takes no key (Ollama, LM Studio) or one this app doesn't know. The
/// shells take this from the service the key was saved for, never from the page's `Request::auth`
/// (review claim 1).
pub fn key_header(service: &str) -> Option<&'static str> {
    match service {
        "claude" => Some("x-api-key"),
        "openai" | "gemini" | "openrouter" | "other" => Some("bearer"),
        _ => None,
    }
}

/// What a shell says when it doesn't send a key (`key_may_go` is false).
pub const KEY_ELSEWHERE: &str = "That address isn't the one this service's key belongs to, so the key wasn't sent.";

/// May the key saved for `service` go with a request to `url`? (review claim 1: the page builds the
/// request, so a page that isn't ours, or a changed address, must not get a key sent somewhere else.)
/// A preset service's key goes only under its own fixed address (`PROVIDERS`' base + "/", exactly,
/// capitals and all); "Other"'s key only under the address saved with it on this device
/// (`other_base`, which must itself pass `check_base`); Ollama, LM Studio and unknown services take
/// no key. Mirrored in Kotlin (android/kotlin/AiKeys.kt `keyMayGo`).
pub fn key_may_go(service: &str, url: &str, other_base: Option<&str>) -> bool {
    let Some(p) = provider(service) else { return false };
    if key_header(service).is_none() || check_base(url).is_err() {
        return false;
    }
    let base = if p.id == "other" {
        match other_base.map(check_base) {
            Some(Ok((b, _))) => b,
            _ => return false,
        }
    } else {
        p.base.to_string()
    };
    url.starts_with(&format!("{base}/"))
}

/// A service's address: a service that needs a key always uses its own fixed address (a typed one
/// is ignored, review claim 1); Ollama, LM Studio and "Other" take the typed one.
fn setup_base(s: &Setup) -> Result<(String, bool, &'static Provider), String> {
    let p = provider(&s.provider).ok_or("Pick an AI service in Settings → AI.")?;
    let base = if p.key != "required" && (p.id == "other" || !s.base.trim().is_empty()) { s.base.as_str() } else { p.base };
    let (b, local) = check_base(base)?;
    Ok((b, local, p))
}

/// The request that lists the models a service offers (Settings' model lists, and its Test button).
pub fn models_request(s: &Setup) -> Result<Request, String> {
    let (base, local, p) = setup_base(s)?;
    let claude = p.format == "claude";
    Ok(Request {
        method: "GET".into(),
        url: if claude { format!("{base}/models?limit=100") } else { format!("{base}/models") },
        auth: auth_of(p),
        headers: if claude { vec![("anthropic-version".into(), "2023-06-01".into())] } else { vec![] },
        body: None,
        local,
        key_required: p.key == "required",
    })
}

fn auth_of(p: &Provider) -> Option<String> {
    key_header(p.id).map(str::to_string)
}

/// The models in a service's answer to `models_request`, sorted by name.
pub fn read_models(s: &Setup, status: u16, body: &str) -> Result<Vec<String>, String> {
    let v = answer_json(s, status, body)?;
    let mut ids: Vec<String> = v.get("data").or_else(|| v.get("models")).and_then(Value::as_array).map(|a| {
        a.iter().filter_map(|m| m.get("id").or_else(|| m.get("name")).and_then(Value::as_str)).map(|m| m.trim_start_matches("models/").to_string()).collect()
    }).unwrap_or_default();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Err("The service answered, but listed no models. Type the model's name instead.".into());
    }
    Ok(ids)
}

/// One question to a chat model: fixed instructions (`system`) and the person's material (`user`).
pub fn chat_request(s: &Setup, system: &str, user: &str, max_tokens: u32) -> Result<Request, String> {
    chat_request_with(s, system, user, None, max_tokens)
}

/// A picture sent with a question: its type ("image/png"…) and its bytes in base64.
pub struct Picture {
    pub media_type: &'static str,
    pub data: String,
}

/// `chat_request`, with a picture in front of the words when there is one (Picture to text): Claude
/// takes it as an "image" part, the OpenAI style as an "image_url" with a data: address (OpenAI,
/// Gemini, OpenRouter, Ollama and LM Studio all read that).
pub fn chat_request_with(s: &Setup, system: &str, user: &str, picture: Option<&Picture>, max_tokens: u32) -> Result<Request, String> {
    let (base, local, p) = setup_base(s)?;
    let model = s.model.trim();
    if model.is_empty() {
        return Err("Pick a model in Settings → AI.".into());
    }
    let (url, headers, body) = if p.format == "claude" {
        // (no temperature: Claude's newer models refuse it, "`temperature` is deprecated for this model")
        let content = match picture {
            Some(pic) => json!([{ "type": "image", "source": { "type": "base64", "media_type": pic.media_type, "data": pic.data } }, { "type": "text", "text": user }]),
            None => json!(user),
        };
        let body = json!({ "model": model, "max_tokens": max_tokens, "system": system, "messages": [{ "role": "user", "content": content }] });
        (format!("{base}/messages"), vec![("anthropic-version".to_string(), "2023-06-01".to_string())], body)
    } else {
        // (no max_tokens or temperature: some newer models refuse them, and these answers are short)
        let content = match picture {
            Some(pic) => json!([{ "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", pic.media_type, pic.data) } }, { "type": "text", "text": user }]),
            None => json!(user),
        };
        let body = json!({ "model": model, "stream": false, "messages": [{ "role": "system", "content": system }, { "role": "user", "content": content }] });
        (format!("{base}/chat/completions"), vec![], body)
    };
    Ok(Request { method: "POST".into(), url, auth: auth_of(p), headers, body: Some(body.to_string()), local, key_required: p.key == "required" })
}

/// The words of a chat model's answer to `chat_request`.
pub fn read_chat(s: &Setup, status: u16, body: &str) -> Result<String, String> {
    let v = answer_json(s, status, body)?;
    let text = if provider(&s.provider).is_some_and(|p| p.format == "claude") {
        v.get("content").and_then(Value::as_array).map(|a| a.iter().filter_map(|c| c.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(""))
    } else {
        v.pointer("/choices/0/message/content").and_then(Value::as_str).map(str::to_string)
    };
    match text {
        Some(t) if !t.trim().is_empty() => Ok(t),
        _ => Err("The AI's answer was empty.".into()),
    }
}

fn answer_json(s: &Setup, status: u16, body: &str) -> Result<Value, String> {
    let v: Option<Value> = serde_json::from_str(body).ok();
    if !(200..300).contains(&status) {
        let said = v.as_ref().and_then(|v| v.pointer("/error/message").or_else(|| v.get("error")).or_else(|| v.get("message"))).and_then(|m| m.as_str().map(str::to_string));
        let who = provider(&s.provider).map_or("The service", |p| p.name);
        return Err(match status {
            401 | 403 => format!("{who} refused the key ({status}). Check it in Settings → AI."),
            404 => format!("{who} doesn't know that address or model (404).{}", said.map(|m| format!(" It said: {m}")).unwrap_or_default()),
            429 => format!("{who} says too many requests, or no credit left (429). Try again later."),
            0 => "No answer from the service.".to_string(),
            _ => format!("{who} answered with an error ({status}).{}", said.map(|m| format!(" It said: {}", m.chars().take(300).collect::<String>())).unwrap_or_default()),
        });
    }
    v.ok_or_else(|| "The service's answer couldn't be read.".to_string())
}

// ------------------------------------------------------------------ sending (curl)

/// A value inside double quotes in a curl settings file: backslashes and quotes escaped.
fn quoted(v: &str) -> String {
    format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Can this key be sent in a header? Printable letters only (no spaces, quotes or line breaks).
pub fn key_ok(key: &str) -> bool {
    !key.is_empty() && key.len() <= 512 && key.chars().all(|c| c.is_ascii_graphic() && c != '"' && c != '\\')
}

/// How long a request's body file may stay in `tmp` before `sweep_temp` takes it away: longer than
/// any request runs (curl's `max-time` is 120 s).
const TEMP_AGE: std::time::Duration = std::time::Duration::from_secs(600);

/// Takes away request body files (`ai-<pid>-<n>.json`) left in `tmp` by a run that stopped before
/// removing its own (a crash, a power cut): they hold note text, unencrypted. Only files of another
/// run, or older than `TEMP_AGE`, so a request on its way is never touched. `send_with_curl` calls it
/// once per run; a shell may call it at start.
pub fn sweep_temp(tmp: &Path) {
    let Ok(rd) = std::fs::read_dir(tmp) else { return };
    let mine = format!("ai-{}-", std::process::id());
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.starts_with("ai-") || !name.ends_with(".json") || !e.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age > TEMP_AGE);
        if !name.starts_with(&mine) || old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Send `req` with a curl program (Windows' own curl.exe; the dev server's): its settings come in on
/// curl's input, so the key never shows in the list of running programs; the body goes through a
/// file in `tmp`, removed after. https only, or http to a local program: the address and whether it
/// is local come from `check_base` itself, never from the page's `req.local` (review claim 3), and
/// curl reads it literally (`globoff`: no `{a,b}` or `[1-9]` lists). Gives the answer's status and
/// words. The key goes in the header `req.auth` names: a shell sets that from `key_header` of the
/// service the key belongs to, after `key_may_go` (or uses `send_keyed`, which does both).
pub fn send_with_curl(curl: &Path, req: &Request, key: Option<&str>, tmp: &Path) -> Result<(u16, String), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let (url, local) = check_base(&req.url)?;
    let mut cfg = String::new();
    cfg.push_str(&format!("url = {}\n", quoted(&url)));
    cfg.push_str(&format!("request = {}\n", quoted(if req.method == "GET" { "GET" } else { "POST" })));
    cfg.push_str("globoff\nsilent\nshow-error\nmax-time = 120\nconnect-timeout = 15\nmax-filesize = 8000000\n");
    cfg.push_str(if local { "proto = \"=http,https\"\nproto-redir = \"=http,https\"\n" } else { "proto = \"=https\"\nproto-redir = \"=https\"\n" });
    cfg.push_str("write-out = \"\\n%{http_code}\"\n");
    cfg.push_str("header = \"Accept: application/json\"\n");
    for (k, v) in &req.headers {
        if k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !v.contains(['\n', '\r']) {
            cfg.push_str(&format!("header = {}\n", quoted(&format!("{k}: {v}"))));
        }
    }
    match (req.auth.as_deref(), key) {
        (Some(_), Some(k)) if !key_ok(k) => return Err("The saved key has spaces or quotes in it. Paste it again in Settings → AI.".into()),
        (Some("x-api-key"), Some(k)) => cfg.push_str(&format!("header = {}\n", quoted(&format!("x-api-key: {k}")))),
        (Some(_), Some(k)) => cfg.push_str(&format!("header = {}\n", quoted(&format!("Authorization: Bearer {k}")))),
        (Some(_), None) if req.key_required => return Err("No key is saved for this service yet. Add it in Settings → AI.".into()),
        _ => {}
    }
    static SWEPT: std::sync::Once = std::sync::Once::new();
    SWEPT.call_once(|| sweep_temp(tmp));
    let body_file = match &req.body {
        Some(b) => {
            static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let _ = std::fs::create_dir_all(tmp);
            let f = tmp.join(format!("ai-{}-{}.json", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
            std::fs::write(&f, b).map_err(|e| format!("Couldn't get the request ready ({e})."))?;
            cfg.push_str("header = \"Content-Type: application/json\"\n");
            cfg.push_str(&format!("data-binary = {}\n", quoted(&format!("@{}", f.display()))));
            Some(f)
        }
        None => None,
    };
    let mut c = Command::new(curl);
    c.args(["-q", "--config", "-"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // (no console window)
    }
    let run = (|| {
        let mut child = c.spawn().map_err(|e| format!("Couldn't start the download tool (curl) ({e})."))?;
        let fed = match child.stdin.take() {
            Some(mut input) => input.write_all(cfg.as_bytes()).map_err(|e| e.to_string()),
            None => Err("no input".to_string()),
        };
        if let Err(e) = fed {
            // never leave curl running (or a zombie) behind: stop it and wait for it
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Couldn't start the download tool (curl) ({e})."));
        }
        child.wait_with_output().map_err(|e| e.to_string())
    })();
    if let Some(f) = body_file {
        let _ = std::fs::remove_file(f);
    }
    let out = run?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr).trim().trim_start_matches("curl: ").lines().last().unwrap_or("").to_string();
        let host = url.split('/').nth(2).unwrap_or("");
        return Err(if local {
            format!("Couldn't reach the program at {host}. Is it running? ({why})")
        } else {
            format!("Couldn't reach {host}. Are you online? ({why})")
        });
    }
    let (body, code) = text.rsplit_once('\n').unwrap_or(("", text.as_str()));
    Ok((code.trim().parse().unwrap_or(0), body.to_string()))
}

/// The shells' one way to send with a saved key (Windows' ai_key, the dev server): the header comes
/// from the service (`key_header`), never from the page, and the key goes only where `key_may_go`
/// allows; elsewhere it isn't sent and the request is refused (`KEY_ELSEWHERE`). A request without a
/// key (no key saved, or a service that takes none) goes as `send_with_curl` sends it.
pub fn send_keyed(curl: &Path, service: &str, req: &Request, key: Option<&str>, other_base: Option<&str>, tmp: &Path) -> Result<(u16, String), String> {
    let mut req = req.clone();
    req.auth = key_header(service).map(str::to_string);
    let key = if req.auth.is_some() { key } else { None };
    if key.is_some() && !key_may_go(service, &req.url, other_base) {
        return Err(KEY_ELSEWHERE.into());
    }
    send_with_curl(curl, &req, key, tmp)
}

// ------------------------------------------------------------------ Polish note

/// Polish note's fixed instructions (he decided, Nov 18: built in and tested, so they can't be broken;
/// a person may add their own wishes after them, never replace them).
const POLISH_RULES: &str = "You tidy up one note from a person's outliner notes (Logseq-style Markdown). Reply with only the tidied note, nothing before or after it.

Rules:
- Keep the person's meaning, facts, names, numbers and language. Never add information that isn't there.
- Fix spelling, capitals, punctuation and shorthand (\"abt\" -> \"about\"). Keep it as short as it was; don't make it formal or wordy.
- If it is something to do, start it with TODO. If it gives a day for it (\"next tue\", \"on Friday\"), add a line under it: SCHEDULED: <YYYY-MM-DD Ddd>, worked out from today's date. Use DEADLINE: instead when it says \"by\" or \"due\".
- Several separate things to do become separate notes: start each with \"- \". Put a SCHEDULED or DEADLINE line right under its own note, indented by two spaces.
- Page links: write [[Name]] only for names in the list of pages below, spelled exactly as listed. Never make up a page name. Keep the links the note already has.
- Tags: use only tags from the list of tags below, at most two, and only when they clearly fit. Never make up a tag.
- No headings, bold, code blocks, properties (key:: value) or remarks of your own.";

/// The words of a note to send (its first line and what follows), and the property lines kept
/// aside (id::, collapsed::, by::…: the AI never sees or changes them).
fn split_props(text: &str) -> (String, Vec<String>) {
    let mut words = vec![];
    let mut props = vec![];
    for (n, line) in text.split('\n').enumerate() {
        if n > 0 && crate::parse::property(line.trim()).is_some() {
            props.push(line.trim().to_string());
        } else {
            words.push(line);
        }
    }
    (words.join("\n").trim_end().to_string(), props)
}

fn words_of(s: &str) -> Vec<String> {
    fold(s).split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() >= 3).map(str::to_string).collect()
}

/// Pages worth offering for a note: those whose name or alias shares a word with it (or starts the
/// same way, 4 letters at least), most linked first, at most 60. Never the whole notes folder.
fn candidate_pages(v: &Vault, text: &str) -> Vec<String> {
    let note = words_of(text);
    let near = |w: &str| note.iter().any(|n| n == w || (n.len() >= 4 && w.len() >= 4 && (n.starts_with(w) || w.starts_with(n.as_str()))));
    let mut hits: Vec<(usize, String)> = vec![];
    for p in v.all_pages() {
        if p.journal.is_some() {
            continue;
        }
        let names: Vec<&String> = std::iter::once(&p.name).chain(p.aliases.iter()).collect();
        if names.iter().any(|n| words_of(n).iter().any(|w| near(w))) {
            let mut line = p.name.clone();
            if !p.aliases.is_empty() {
                line.push_str(&format!(" (also called: {})", p.aliases.join(", ")));
            }
            hits.push((p.refs, line));
        }
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    hits.into_iter().take(60).map(|h| h.1).collect()
}

/// The tags in use, most used first (at most 150).
fn tags_in_use(v: &Vault) -> Vec<String> {
    let mut t = v.all_tags();
    t.sort_by(|a, b| (b.1 + b.2).cmp(&(a.1 + a.2)));
    t.into_iter().take(150).map(|t| t.0).collect()
}

const WEEKDAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/// Polish note's question: the fixed instructions, then today, the pages and tags it may use, the
/// person's own wishes (Settings → AI → Advanced), and the note's words.
pub fn polish_question(v: &Vault, text: &str, today: Date, extra: &str) -> (String, String) {
    let (words, _) = split_props(text);
    let mut system = POLISH_RULES.to_string();
    let extra = extra.trim();
    if !extra.is_empty() {
        system.push_str("\n\nThe person's own wishes (follow them unless they break a rule above):\n");
        system.push_str(&extra.chars().take(2000).collect::<String>());
    }
    let (y, m, d) = today;
    let mut user = format!("Today is {} {y:04}-{m:02}-{d:02}. A link to a day is written like today's: [[{}]].\n\n", WEEKDAYS[date::weekday(today)], v.config.journal_title(today));
    let pages = candidate_pages(v, &words);
    user.push_str("Pages you may link:\n");
    user.push_str(&if pages.is_empty() { "(none)".to_string() } else { pages.join("\n") });
    let tags = tags_in_use(v);
    user.push_str("\n\nTags you may use:\n");
    user.push_str(&if tags.is_empty() { "(none)".to_string() } else { tags.join(", ") });
    user.push_str("\n\nThe note:\n<<<\n");
    user.push_str(&words);
    user.push_str("\n>>>");
    (system, user)
}

/// What an answer may link (folded): pages and their aliases, tags in use, and whatever `also`
/// linked already. (Days are checked by their title, `journal_from_title`.)
fn known_names(v: &Vault, also: &str) -> HashSet<String> {
    let mut known: HashSet<String> = HashSet::new();
    for p in v.all_pages() {
        known.insert(fold(&p.name));
        for al in &p.aliases {
            known.insert(fold(al));
        }
    }
    for t in v.all_tags() {
        known.insert(fold(&t.0));
    }
    for n in crate::text::link_names(also) {
        known.insert(fold(&n));
    }
    known
}

/// Polish note's answer as notes ready to go in: each `text` as the editor keeps a note (first line,
/// then its other lines). The first takes the note's own property lines back; with `mark`, every note
/// says `by:: ai` (unless it already says who wrote it). Links and tags to pages that don't exist
/// become plain words (`unlinked` names them). `same` = nothing changed.
pub fn polish_answer(v: &Vault, original: &str, answer: &str, mark: bool) -> Result<Value, String> {
    let (words, props) = split_props(original);
    let mut a = answer.trim().to_string();
    // a whole answer in a code block, or between the <<< >>> it was sent in
    if a.starts_with("```") {
        a = a.lines().skip(1).collect::<Vec<_>>().join("\n");
        if let Some(i) = a.rfind("```") {
            a.truncate(i);
        }
    }
    let a = a.trim().trim_start_matches("<<<").trim_end_matches(">>>").trim();
    let limit = (words.chars().count() * 4 + 600).max(2000);
    if a.is_empty() {
        return Err("The AI's answer was empty. Try again.".into());
    }
    if a.chars().count() > limit {
        return Err("The AI's answer was much longer than the note, so it wasn't used. Try again.".into());
    }
    // notes: a line starting with "- " starts one (the first may not have it); their other lines
    // lose the indent they were written with
    let mut notes: Vec<Vec<String>> = vec![];
    for line in a.lines() {
        if let Some(rest) = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
            notes.push(vec![rest.trim_end().to_string()]);
        } else if line.trim().is_empty() {
            continue;
        } else if let Some(n) = notes.last_mut() {
            n.push(line.trim().to_string());
        } else {
            notes.push(vec![line.trim().to_string()]);
        }
    }
    if notes.len() > 8 {
        return Err("The AI split the note into too many pieces, so its answer wasn't used. Try again.".into());
    }
    let known = known_names(v, &words);
    let is_known = |name: &str| known.contains(&fold(name)) || v.config.journal_from_title(name).is_some();
    let mut unlinked: Vec<String> = vec![];
    let mut out: Vec<String> = vec![];
    for (i, lines) in notes.into_iter().enumerate() {
        // no properties of its own (only the note's own come back, below)
        let kept: Vec<String> = lines.into_iter().enumerate().filter(|(n, l)| *n == 0 || crate::parse::property(l).is_none()).map(|(_, l)| l).collect();
        let (text, gone) = crate::text::unlink_unknown(&kept.join("\n"), &is_known);
        unlinked.extend(gone);
        let mut text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let mine: Vec<&String> = if i == 0 { props.iter().collect() } else { vec![] };
        let has_by = mine.iter().any(|p| crate::parse::property(p).is_some_and(|(k, _)| k == "by"));
        for p in mine {
            text.push('\n');
            text.push_str(p);
        }
        if mark && !has_by {
            text.push_str("\nby:: ai");
        }
        out.push(text);
    }
    if out.is_empty() {
        return Err("The AI's answer had nothing usable in it. Try again.".into());
    }
    unlinked.sort();
    unlinked.dedup();
    let same = out.len() == 1 && split_props(&out[0]).0.trim() == words.trim();
    Ok(json!({ "notes": out, "unlinked": unlinked, "same": same }))
}

// ------------------------------------------------------------------ shared by the features below

/// An answer that came back in a code block: its inside.
fn unfence(a: &str) -> String {
    let a = a.trim();
    if let Some(rest) = a.strip_prefix("```") {
        let rest = rest.split_once('\n').map_or("", |(_, r)| r);
        return rest.rfind("```").map_or(rest, |i| &rest[..i]).trim().to_string();
    }
    a.to_string()
}

/// The most linked pages (not days), with their other names: what Picture to text may link, when
/// there are no words of the note's own to choose them by.
fn top_pages(v: &Vault, n: usize) -> Vec<String> {
    let mut all: Vec<_> = v.all_pages().into_iter().filter(|p| p.journal.is_none()).collect();
    all.sort_by(|a, b| b.refs.cmp(&a.refs).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    all.into_iter()
        .take(n)
        .map(|p| if p.aliases.is_empty() { p.name } else { format!("{} (also called: {})", p.name, p.aliases.join(", ")) })
        .collect()
}

/// A page and every note that links to it (with the notes it sits under and its sub-notes), as
/// numbered sources for the AI: [1] is the page itself, then one per page or day that links to it.
/// At most `budget` characters (the rest is left out, and it says so). Gives the text and the
/// sources' names in order (index 0 = [1]).
fn page_material(v: &Vault, name: &str, budget: usize) -> (String, Vec<String>, usize) {
    let info = v.page_info(name);
    let mut out = String::new();
    let mut sources = vec![info.name.clone()];
    out.push_str(&format!("[1] The page \"{}\"", info.name));
    if !info.aliases.is_empty() {
        out.push_str(&format!(" (also called: {})", info.aliases.join(", ")));
    }
    out.push_str(":\n");
    for (k, val) in &info.props {
        if !matches!(k.as_str(), "id" | "collapsed" | "title") {
            out.push_str(&format!("{k}:: {val}\n"));
        }
    }
    let notes = v.page_notes(name);
    if notes.is_empty() {
        out.push_str("(no notes of its own)\n");
    }
    for (d, t) in notes {
        push_note(&mut out, d, &t);
    }
    let mut refs = 0;
    let mut cut = false;
    for g in v.linked_refs(name) {
        if out.chars().count() > budget {
            cut = true;
            break;
        }
        sources.push(g.page.clone());
        let what = if g.journal.is_some() { "The journal day" } else { "The page" };
        out.push_str(&format!("\n[{}] {what} \"{}\":\n", sources.len(), g.page));
        for hit in &g.hits {
            refs += 1;
            for p in &hit.parents {
                push_note(&mut out, p.depth, &p.text);
            }
            push_note(&mut out, hit.depth, &hit.text);
            for k in &hit.kids {
                push_note(&mut out, k.depth, &k.text);
            }
        }
    }
    if cut {
        out.push_str("\n(more notes link to it; they were left out for length)\n");
    }
    let out: String = out.chars().take(budget + 2000).collect();
    (out, sources, refs)
}

fn push_note(out: &mut String, depth: usize, text: &str) {
    let (words, _) = split_props(text);
    let pad = "  ".repeat(depth.min(8));
    for (n, line) in words.lines().enumerate() {
        out.push_str(&pad);
        out.push_str(if n == 0 { "- " } else { "  " });
        out.push_str(line.trim_end());
        out.push('\n');
    }
}

// ------------------------------------------------------------------ Picture to text (Build 52)

const PICTURE_RULES: &str = "You turn a picture from a person's notes (a whiteboard, a page of paper, a screenshot) into outliner notes (Logseq-style Markdown). Reply with only the notes, nothing before or after them.

Rules:
- One note per line, each starting with \"- \". A point that belongs under another is indented two more spaces.
- Copy the words as they are written, in the picture's order and language. Fix only plain spelling slips. Never add information that isn't in the picture.
- Lists, numbered or not, become notes (leave out the numbers). A heading or title becomes a note with the points under it.
- Page links: write [[Name]] only for names in the list of pages below, spelled exactly as listed. Never make up a page name.
- No headings (#), bold, code blocks, properties (key:: value) or remarks of your own.
- If the picture has no words, write one short note saying what it shows.";

/// The picture types the services read.
pub fn picture_type(name: &str) -> Option<&'static str> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// The largest picture sent (Claude takes at most 5 MB a picture).
pub const MAX_PICTURE_BYTES: usize = 5 * 1024 * 1024;

pub fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Picture to text's question: the fixed instructions, the pages it may link (the note's own words'
/// pages, then the most linked), and the note's words for context.
pub fn picture_question(v: &Vault, note: &str) -> (String, String) {
    let (words, _) = split_props(note);
    let mut pages = candidate_pages(v, &words);
    for p in top_pages(v, 80) {
        if pages.len() >= 120 {
            break;
        }
        if !pages.contains(&p) {
            pages.push(p);
        }
    }
    let mut user = String::from("Pages you may link:\n");
    user.push_str(&if pages.is_empty() { "(none)".to_string() } else { pages.join("\n") });
    user.push_str("\n\nThe note the picture is in (for context only; don't copy it):\n<<<\n");
    user.push_str(&words.chars().take(2000).collect::<String>());
    user.push_str("\n>>>\n\nWrite the picture's words as notes.");
    (PICTURE_RULES.to_string(), user)
}

/// Picture to text's answer as notes `{text, depth}` (depth 0 = right under the note with the
/// picture), each checked as Polish note's are: links only to pages that exist (`unlinked` names the
/// others), no properties of their own, `by:: ai` on the top ones with `mark`. At most 60 notes.
pub fn picture_answer(v: &Vault, note: &str, answer: &str, mark: bool) -> Result<Value, String> {
    let a = unfence(answer);
    let known = known_names(v, note);
    let is_known = |name: &str| known.contains(&fold(name)) || v.config.journal_from_title(name).is_some();
    let mut notes: Vec<(usize, String)> = vec![];
    let mut unlinked: Vec<String> = vec![];
    for line in a.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let indent: usize = line.chars().take_while(|c| *c == ' ' || *c == '\t').map(|c| if c == '\t' { 2 } else { 1 }).sum();
        let t = line.trim();
        let t = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")).unwrap_or(t).trim();
        // (a number the AI kept anyway: "1. x" → "x")
        let t = match t.split_once(". ") {
            Some((n, rest)) if !n.is_empty() && n.len() <= 3 && n.chars().all(|c| c.is_ascii_digit()) => rest,
            _ => t,
        };
        if t.is_empty() || crate::parse::property(t).is_some() {
            continue;
        }
        let t = t.trim_start_matches('#').trim();
        let (text, gone) = crate::text::unlink_unknown(t, &is_known);
        unlinked.extend(gone);
        let text = text.trim().to_string();
        if !text.is_empty() {
            notes.push((indent / 2, text));
        }
    }
    if notes.is_empty() {
        return Err("The AI found no words in the picture. Try again, or try another model for pictures.".into());
    }
    if notes.len() > 60 {
        notes.truncate(60);
    }
    // depths: the first at 0, each at most one deeper than the one before
    let mut prev: Option<usize> = None;
    let base = notes.iter().map(|n| n.0).min().unwrap_or(0);
    let out: Vec<Value> = notes
        .into_iter()
        .map(|(d, mut text)| {
            let d = d - base;
            let d = match prev { None => 0, Some(p) => d.min(p + 1) };
            prev = Some(d);
            if mark && d == 0 {
                text.push_str("\nby:: ai");
            }
            json!({ "text": text, "depth": d })
        })
        .collect();
    unlinked.sort();
    unlinked.dedup();
    Ok(json!({ "notes": out, "unlinked": unlinked }))
}

// ------------------------------------------------------------------ Ask this page (Build 52)

const ASK_RULES: &str = "You answer a person's question about one page of their outliner notes, using only the notes given: the page itself and every note that links to it, each under a numbered source.

Rules:
- Answer only from these notes. If they don't say, answer exactly: Your notes don't say.
- Answer in short points, one per line, each starting with \"- \". At most 8 points. Plain, short sentences in the person's language.
- End each point with the numbers of the sources it comes from, in square brackets, like [2] or [2][5].
- Dates: say them as the notes do. Don't work out anything the notes don't say.
- No headings, bold, code blocks or remarks of your own before or after the points.";

pub fn ask_question(v: &Vault, page: &str, question: &str) -> Result<(String, String, Vec<String>), String> {
    let q = question.trim();
    if q.is_empty() {
        return Err("Type a question first.".into());
    }
    let (material, sources, _) = page_material(v, page, 60_000);
    let user = format!("The notes:\n<<<\n{material}>>>\n\nThe question: {}", q.chars().take(1000).collect::<String>());
    Ok((ASK_RULES.to_string(), user, sources))
}

/// Ask this page's answer: points `{text, sources: [page names]}` (a source number that isn't one is
/// dropped), links in them only to pages that exist; `none` = the notes don't say.
pub fn ask_answer(v: &Vault, answer: &str, sources: &[String]) -> Result<Value, String> {
    let a = unfence(answer);
    if a.trim().trim_end_matches('.').eq_ignore_ascii_case("your notes don't say") || a.trim().trim_end_matches('.').eq_ignore_ascii_case("- your notes don't say") {
        return Ok(json!({ "points": [], "none": true }));
    }
    let known = known_names(v, "");
    let is_known = |name: &str| known.contains(&fold(name)) || v.config.journal_from_title(name).is_some();
    let mut points = vec![];
    for line in a.lines() {
        let t = line.trim();
        let t = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")).unwrap_or(t).trim();
        if t.is_empty() {
            continue;
        }
        // the [n] marks, wherever they are, become its sources
        let mut words = String::new();
        let mut srcs: Vec<String> = vec![];
        let mut rest = t;
        while let Some(i) = rest.find('[') {
            let after = &rest[i + 1..];
            match after.find(']').map(|j| (&after[..j], j)) {
                Some((n, j)) if !n.is_empty() && n.len() <= 3 && n.chars().all(|c| c.is_ascii_digit()) && !rest[..i].ends_with('[') && !after[j + 1..].starts_with(']') => {
                    words.push_str(&rest[..i]);
                    if let Some(name) = n.parse::<usize>().ok().and_then(|k| k.checked_sub(1)).and_then(|k| sources.get(k)) {
                        if !srcs.contains(name) {
                            srcs.push(name.clone());
                        }
                    }
                    rest = &after[j + 1..];
                }
                _ => {
                    words.push_str(&rest[..=i]);
                    rest = after;
                }
            }
        }
        words.push_str(rest);
        let (text, _) = crate::text::unlink_unknown(words.trim(), &is_known);
        let text = text.trim().trim_end_matches(',').to_string();
        if !text.is_empty() {
            points.push(json!({ "text": text, "sources": srcs }));
        }
        if points.len() >= 12 {
            break;
        }
    }
    if points.is_empty() {
        return Err("The AI's answer had nothing usable in it. Try again.".into());
    }
    Ok(json!({ "points": points, "none": false }))
}

// ------------------------------------------------------------------ Link suggestions (Build 52)

const LINKS_RULES: &str = "A person's outliner notes have a page, and notes that mention its name (or another name of it) without linking to it. You decide, for each such mention, whether it really means this page, or the same word used for something else (another person with that first name, an ordinary word).

First read the page and the notes that already link to it, to learn what or who the page is about. Then answer one line per mention, in this form:
<number>: yes - <a short reason, under 12 words>
<number>: no - <a short reason, under 12 words>
Nothing before or after these lines. When unsure, say no.";

/// The most mentions one link suggestion asks about.
pub const MAX_MENTIONS: usize = 40;

/// The mentions a page's link suggestions look at: its unlinked references (at most `MAX_MENTIONS`).
pub fn link_mentions(v: &Vault, page: &str) -> Vec<Value> {
    let (groups, _) = v.unlinked_refs(page, MAX_MENTIONS);
    let mut out = vec![];
    for g in groups {
        for h in g.hits {
            if let Some(line) = h.line {
                out.push(json!({ "page": g.page, "journal": g.journal, "line": line, "text": h.text, "depth": h.depth }));
            }
        }
    }
    out
}

pub fn links_question(v: &Vault, page: &str, mentions: &[Value]) -> Result<(String, String), String> {
    if mentions.is_empty() {
        return Err("This page has no unlinked mentions.".into());
    }
    let (material, _, _) = page_material(v, page, 30_000);
    let mut user = format!("The page and the notes that link to it:\n<<<\n{material}>>>\n\nThe mentions to decide on:\n");
    for (i, m) in mentions.iter().enumerate() {
        let text = m.get("text").and_then(Value::as_str).unwrap_or("");
        let (words, _) = split_props(text);
        let words: String = words.replace('\n', " ").chars().take(500).collect();
        user.push_str(&format!("{}: (in \"{}\") {}\n", i + 1, m.get("page").and_then(Value::as_str).unwrap_or(""), words));
    }
    Ok((LINKS_RULES.to_string(), user))
}

/// One `{link, why}` per mention, in order; a mention the AI didn't answer is a "no".
pub fn links_answer(answer: &str, count: usize) -> Result<Value, String> {
    // (the count comes from the page: never more than `link_mentions` gives, before anything is made)
    let count = count.min(MAX_MENTIONS);
    let a = unfence(answer);
    let mut out: Vec<Value> = (0..count).map(|_| json!({ "link": false, "why": "The AI didn't say." })).collect();
    let mut any = false;
    for line in a.lines() {
        let t = line.trim().trim_start_matches("- ");
        let Some((n, rest)) = t.split_once(':') else { continue };
        let Some(i) = n.trim().parse::<usize>().ok().and_then(|n| n.checked_sub(1)).filter(|i| *i < count) else { continue };
        let rest = rest.trim();
        let low = rest.to_lowercase();
        let yes = low.starts_with("yes");
        if !yes && !low.starts_with("no") {
            continue;
        }
        let why = rest[if yes { 3 } else { 2 }..].trim_start_matches([' ', '-', '–', '—', ':', ',']).trim();
        out[i] = json!({ "link": yes, "why": why.chars().take(120).collect::<String>() });
        any = true;
    }
    if !any {
        return Err("The AI's answer couldn't be read. Try again.".into());
    }
    Ok(json!(out))
}

// ------------------------------------------------------------------ aliases and a description (Build 52)

const NAMES_RULES: &str = "You suggest other names (aliases) and a one-line description for one page of a person's outliner notes, from the page and the notes that link to it.

Reply with exactly these lines and nothing else:
description: <one short line saying what or who the page is, in the person's words where possible, under 20 words>
alias: <another name>
alias: <another name>

Rules:
- Aliases: names the notes themselves use for the same thing (spellings, short forms, first names, how the person writes it), at most 5. Never one that is the page's own name, and never a name made up.
- If there is no good alias, give no alias lines.";

pub fn names_question(v: &Vault, page: &str) -> (String, String) {
    let (material, _, _) = page_material(v, page, 30_000);
    (NAMES_RULES.to_string(), format!("The page and the notes that link to it:\n<<<\n{material}>>>"))
}

/// `{description, aliases}`: aliases that aren't already this page's names, nor another page's or
/// alias (an alias there would make two pages answer to one name); the description one plain line.
pub fn names_answer(v: &Vault, page: &str, answer: &str) -> Result<Value, String> {
    let a = unfence(answer);
    let info = v.page_info(page);
    let own = v.resolve(page);
    let mut taken: HashSet<String> = HashSet::new();
    taken.insert(fold(&info.name));
    for al in &info.aliases {
        taken.insert(fold(al));
    }
    let mut description = String::new();
    let mut aliases: Vec<String> = vec![];
    for line in a.lines() {
        let t = line.trim().trim_start_matches("- ");
        let Some((k, val)) = t.split_once(':') else { continue };
        let raw = val.trim().trim_matches(['"', '“', '”']).trim();
        match k.trim().to_lowercase().as_str() {
            "description" if description.is_empty() && !raw.is_empty() => {
                // plain words: a link the AI wrote becomes its words
                let (val, _) = crate::text::unlink_unknown(raw, &|_| false);
                description = val.replace("[[", "").replace("]]", "").trim().chars().take(200).collect();
            }
            "alias" | "aliases" => {
                // (a link, or a day such as "Nov 17th, 2026", is never an alias)
                if raw.contains(['[', ']']) || v.config.journal_from_title(raw).is_some() {
                    continue;
                }
                for one in raw.split(',') {
                    let one = one.trim().trim_matches(['"', '“', '”', '#']).trim();
                    if one.is_empty() || one.chars().count() > 60 || one.contains(['[', ']', '#', '\n']) || one.contains("::") {
                        continue;
                    }
                    let f = fold(one);
                    if taken.contains(&f) {
                        continue;
                    }
                    // another page's name or alias, or a day
                    let other = v.resolve(one);
                    if (other != own && v.page_info(one).exists) || v.config.journal_from_title(one).is_some() {
                        continue;
                    }
                    taken.insert(f);
                    aliases.push(one.to_string());
                }
            }
            _ => {}
        }
    }
    aliases.truncate(5);
    if description.is_empty() && aliases.is_empty() {
        return Err("The AI had nothing to suggest. Try again.".into());
    }
    let current = info.props.iter().find(|(k, _)| k == "description").map(|p| p.1.clone());
    Ok(json!({ "description": description, "aliases": aliases, "current": current }))
}

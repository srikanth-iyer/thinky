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
/// network (Ollama, LM Studio). No spaces, quotes or line breaks (the curl settings written from it).
/// Gives it without a final "/", and whether it is such a local address.
pub fn check_base(base: &str) -> Result<(String, bool), String> {
    let b = base.trim().trim_end_matches('/');
    if b.is_empty() {
        return Err("Type the web address of the AI service.".into());
    }
    if b.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\\' || c == '\'') {
        return Err("That web address has spaces or quotes in it.".into());
    }
    let (http, rest) = if let Some(r) = b.strip_prefix("https://") {
        (false, r)
    } else if let Some(r) = b.strip_prefix("http://") {
        (true, r)
    } else {
        return Err("The address must start with https:// (or http:// for a program on this computer).".into());
    };
    let host_port = rest.split('/').next().unwrap_or("");
    let host = if let Some(h) = host_port.strip_prefix('[') { h.split(']').next().unwrap_or("") } else { host_port.split(':').next().unwrap_or("") };
    let host = host.to_ascii_lowercase();
    if host.is_empty() || host.contains('@') {
        return Err("That web address has no name of a computer in it.".into());
    }
    let local = is_local_host(&host);
    if http && !local {
        return Err("Only a program on this computer or your home network may use http://. Use https:// for a service on the internet.".into());
    }
    Ok((b.to_string(), http && local))
}

fn is_local_host(h: &str) -> bool {
    if h == "localhost" || h == "::1" || h.ends_with(".local") || h.ends_with(".lan") || h.ends_with(".localhost") {
        return true;
    }
    let parts: Vec<u32> = h.split('.').filter_map(|p| p.parse().ok()).collect();
    if parts.len() != 4 || h.split('.').count() != 4 {
        return false;
    }
    matches!(parts.as_slice(), [127, ..] | [10, ..] | [192, 168, ..]) || (parts[0] == 172 && (16..=31).contains(&parts[1]))
}

fn setup_base(s: &Setup) -> Result<(String, bool, &'static Provider), String> {
    let p = provider(&s.provider).ok_or("Pick an AI service in Settings → AI.")?;
    let base = if p.id == "other" || !s.base.trim().is_empty() { s.base.as_str() } else { p.base };
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
    match (p.format, p.key) {
        (_, "none") => None,
        ("claude", _) => Some("x-api-key".into()),
        _ => Some("bearer".into()),
    }
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
    let (base, local, p) = setup_base(s)?;
    let model = s.model.trim();
    if model.is_empty() {
        return Err("Pick a model in Settings → AI.".into());
    }
    let (url, headers, body) = if p.format == "claude" {
        let body = json!({ "model": model, "max_tokens": max_tokens, "temperature": 0.2, "system": system, "messages": [{ "role": "user", "content": user }] });
        (format!("{base}/messages"), vec![("anthropic-version".to_string(), "2023-06-01".to_string())], body)
    } else {
        // (no max_tokens or temperature: some newer models refuse them, and these answers are short)
        let body = json!({ "model": model, "stream": false, "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }] });
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

/// Send `req` with a curl program (Windows' own curl.exe; the dev server's): its settings come in on
/// curl's input, so the key never shows in the list of running programs; the body goes through a
/// file in `tmp`, removed after. https only, or http to a local program. Gives the answer's status
/// and words.
pub fn send_with_curl(curl: &Path, req: &Request, key: Option<&str>, tmp: &Path) -> Result<(u16, String), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    check_base(&req.url)?;
    let mut cfg = String::new();
    cfg.push_str(&format!("url = {}\n", quoted(&req.url)));
    cfg.push_str(&format!("request = {}\n", quoted(if req.method == "GET" { "GET" } else { "POST" })));
    cfg.push_str("silent\nshow-error\nmax-time = 120\nconnect-timeout = 15\nmax-filesize = 8000000\n");
    cfg.push_str(if req.local { "proto = \"=http,https\"\nproto-redir = \"=http,https\"\n" } else { "proto = \"=https\"\nproto-redir = \"=https\"\n" });
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
        child.stdin.take().ok_or("no input")?.write_all(cfg.as_bytes()).map_err(|e| e.to_string())?;
        child.wait_with_output().map_err(|e| e.to_string())
    })();
    if let Some(f) = body_file {
        let _ = std::fs::remove_file(f);
    }
    let out = run?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr).trim().trim_start_matches("curl: ").lines().last().unwrap_or("").to_string();
        let host = req.url.split('/').nth(2).unwrap_or("");
        return Err(if req.local {
            format!("Couldn't reach the program at {host}. Is it running? ({why})")
        } else {
            format!("Couldn't reach {host}. Are you online? ({why})")
        });
    }
    let (body, code) = text.rsplit_once('\n').unwrap_or(("", text.as_str()));
    Ok((code.trim().parse().unwrap_or(0), body.to_string()))
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
    // what may be linked: pages and their aliases, tags in use, days, and whatever the note linked already
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
    for n in crate::text::link_names(&words) {
        known.insert(fold(&n));
    }
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

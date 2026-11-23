//! Dev server: serves ../ui and answers POST /api/<cmd> with the same dispatch the app uses;
//! /vault/<path> serves the open notes folder's files (images), like the app's vault:// links.
//! HTML pages carry the app's Content-Security-Policy, so tests here hit the same limits.
//! Usage: devserver <vault dir> [port]   (DEV_TRACE=1 logs each request)
//!
//! A tiny hand-written HTTP/1.1 server: one thread per connection, one request per
//! connection. (tiny_http 0.12 now and then held back a request for seconds right after
//! starting, which made browser tests hang.)
use outline_core::app::{asset_file, check_vault_at, dispatch, App};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Sent with every file from the notes folder (pictures and attachments): shown as itself, never
/// as a page that can run script or reach the app (src-tauri lib.rs sends the same).
const VAULT_CSP: &str = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";

fn mime(p: &std::path::Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css",
        Some("js") => "text/javascript",
        Some("woff2") => "font/woff2",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn decode(s: &str) -> String {
    // the core's decoder (outline_core::link::percent_bytes), so all of them agree
    String::from_utf8_lossy(&outline_core::link::percent_bytes(s, false)).into_owned()
}

struct Request {
    method: String,
    url: String,
    origin: Option<String>,
    host: Option<String>,
    /// `X-Test-Now: <seconds since 1970>`: UI tests ask "Check this folder" as at another time
    /// (every picture a test makes is new, and pictures from the last 3 days are left alone).
    test_now: Option<u64>,
    body: Vec<u8>,
}

/// Read one request (request line, headers, a Content-Length body).
fn read_request(stream: &TcpStream) -> Option<Request> {
    let mut r = BufReader::new(stream);
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let (method, url) = (parts.next()?.to_string(), parts.next()?.to_string());
    let (mut len, mut origin, mut host, mut test_now) = (0usize, None, None, None);
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).ok()? == 0 {
            return None;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            match k.trim().to_ascii_lowercase().as_str() {
                "content-length" => len = v.trim().parse().ok()?,
                "origin" => origin = Some(v.trim().to_string()),
                "host" => host = Some(v.trim().to_ascii_lowercase()),
                "x-test-now" => test_now = v.trim().parse().ok(),
                _ => {}
            }
        }
    }
    if len > 64 << 20 {
        return None;
    }
    let mut body = vec![0; len];
    r.read_exact(&mut body).ok()?;
    Some(Request { method, url, origin, host, test_now, body })
}

fn respond(mut stream: &TcpStream, code: u16, headers: &[(&str, &str)], body: &[u8]) {
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let mut head = format!("HTTP/1.1 {code} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body)).and_then(|_| stream.flush());
}

struct Server {
    ui: PathBuf,
    state: Mutex<Option<App>>,
    me: [String; 2],
    csp: Option<String>,
    trace: Option<std::time::Instant>,
}

/// Saved keys: (service, key, the address saved with it: only "Other"'s, whose address the person types).
static AI_KEYS: Mutex<Vec<(String, String, String)>> = Mutex::new(Vec::new());

fn ai_command(cmd: &str, args: &serde_json::Value) -> Option<Result<serde_json::Value, String>> {
    use serde_json::json;
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let keys = || AI_KEYS.lock().unwrap_or_else(|p| p.into_inner());
    Some(match cmd {
        "ai_key_set" => {
            let (p, k) = (s("provider"), s("key").trim().to_string());
            // "Other": the address the key belongs to, kept with it (the app keeps it next to the key)
            let base = if p == "other" { s("base").trim().to_string() } else { String::new() };
            keys().retain(|(q, ..)| *q != p);
            if k.is_empty() {
                Ok(json!(false))
            } else if !outline_core::ai::key_ok(&k) {
                Err("That key has spaces, quotes or line breaks in it.".into())
            } else {
                keys().push((p, k, base));
                Ok(json!(true))
            }
        }
        "ai_key_has" => Ok(json!(keys().iter().any(|(q, ..)| *q == s("provider")))),
        "ai_send" => (|| {
            let req: outline_core::ai::Request = serde_json::from_value(args.get("req").cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
            let service = s("provider");
            // the key saved for this service, and the address saved with it ("" for all but "Other")
            let saved = keys().iter().find(|(q, ..)| *q == service).map(|(_, k, b)| (k.clone(), b.clone()));
            let key = saved.as_ref().map(|(k, _)| k.as_str());
            let base = saved.as_ref().map(|(_, b)| b.as_str()).filter(|b| !b.is_empty());
            // as the app sends (audit finding 15: the core's one way): the header and whether a key is
            // needed come from the service, never the page, and a key goes only to its own service's
            // address (`ai::key_may_go`; review claim 1), else refused with nothing sent
            let tmp = std::env::temp_dir().join("thinky-dev-ai");
            let (status, body) = outline_core::ai::send_keyed(Path::new("curl"), &service, &req, key, base, &tmp)?;
            Ok(json!({ "status": status, "body": body }))
        })(),
        _ => return None,
    })
}

/// The file in `ui` a page address names, or None. Decoded first, then every part must be a plain
/// name (no "..", ".", empty part, drive, `\`, `:` or NUL), so `/%2fetc/passwd` or
/// `/%5cWindows%5cwin.ini` never leave the folder; and the file found must really be inside it (no
/// link out). Checked before anything is read (review claim 20).
fn ui_file(ui: &Path, url: &str) -> Option<PathBuf> {
    let rel = if url == "/" { "index.html".to_string() } else { decode(url.strip_prefix('/')?) };
    let mut path = ui.to_path_buf();
    for part in rel.split('/') {
        let plain = !part.is_empty() && part != "." && part != ".." && !part.contains(['\\', ':', '\0']);
        let mut c = Path::new(part).components();
        if !plain || !matches!((c.next(), c.next()), (Some(std::path::Component::Normal(_)), None)) {
            return None;
        }
        path.push(part);
    }
    let (root, file) = (ui.canonicalize().ok()?, path.canonicalize().ok()?);
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

/// A file the browser would run as a page (by its type, so `/index.HTML` too) gets the app's
/// Content-Security-Policy.
fn runs_as_page(mime: &str) -> bool {
    mime.starts_with("text/html") || mime.starts_with("image/svg+xml")
}

/// The API answers only POSTs that say they come from this server's own page: one with no Origin
/// (another program, or a page that hides where it is from) is refused too.
fn api_allowed(method: &str, origin: Option<&str>, me: &[String]) -> bool {
    method == "POST" && origin.is_some_and(|o| me.iter().any(|m| m == o))
}

fn handle(sv: &Server, stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
    let Some(req) = read_request(&stream) else { return };
    let url = req.url.split('?').next().unwrap_or("/").to_string();
    if let Some(t0) = sv.trace {
        eprintln!("{:>7.1} ms  {} {}", t0.elapsed().as_secs_f64() * 1000.0, req.method, url);
    }
    // only this computer's own address: a web page that points its own name at 127.0.0.1 ("DNS
    // rebinding") sends that name as the Host, and is refused here on every route
    if !req.host.as_ref().is_some_and(|h| sv.me.iter().any(|m| m.strip_prefix("http://") == Some(h.as_str()))) {
        return respond(&stream, 403, &[], b"forbidden");
    }
    if let Some(cmd) = url.strip_prefix("/api/") {
        // only this page may call the API (another web page open in the browser can't, nor a request
        // that names no page), and only by POST
        if !api_allowed(&req.method, req.origin.as_deref(), &sv.me) {
            return respond(&stream, 403, &[], b"forbidden");
        }
        let args = serde_json::from_slice(&req.body).unwrap_or(serde_json::Value::Null);
        // the optional AI features (Build 51): the app keeps keys with Windows (src-tauri ai_key.rs);
        // here they live in memory only, and requests go out with this computer's curl (UI tests point
        // them at a stand-in AI service on this computer). Not under the notes' lock: a slow answer
        // mustn't hold up the page.
        if let Some(out) = ai_command(cmd, &args) {
            let (code, out) = match out {
                Ok(v) => (200, v.to_string()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            };
            return respond(&stream, code, &[("Content-Type", "application/json")], out.as_bytes());
        }
        let mut state = sv.state.lock().unwrap_or_else(|p| p.into_inner());
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match (cmd, req.test_now, state.as_ref()) {
            ("check", Some(now), Some(app)) => check_vault_at(&app.root, now).map(|r| serde_json::to_value(r).unwrap_or_default()),
            ("bin_pictures", Some(now), Some(app)) => {
                let paths: Vec<String> = serde_json::from_value(args.get("paths").cloned().unwrap_or_default()).unwrap_or_default();
                app.bin_pictures_at(&paths, now).map(|r| serde_json::to_value(r).unwrap_or_default())
            }
            // the Windows app's shell answers this one (src-tauri links.rs: a link it was started
            // with); the dev server never is
            ("start_link", _, _) => Ok(serde_json::Value::Null),
            _ => dispatch(&mut state, cmd, args),
        }));
        drop(state);
        let (code, out) = match res {
            Ok(Ok(v)) => (200, v.to_string()),
            Ok(Err(e)) => (400, serde_json::json!({ "error": e }).to_string()),
            Err(_) => (500, serde_json::json!({ "error": format!("internal error in {cmd}") }).to_string()),
        };
        return respond(&stream, code, &[("Content-Type", "application/json")], out.as_bytes());
    }
    if let Some(rel) = url.strip_prefix("/vault/") {
        let root = sv.state.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|a| a.root.clone());
        return match root.and_then(|r| asset_file(&r, &decode(rel))).and_then(|f| std::fs::read(&f).ok().map(|b| (f, b))) {
            // (a file from the notes folder is never a page that runs: an SVG or HTML file synced
            // into assets/ could otherwise run script with the app's own rights)
            Some((f, bytes)) => respond(&stream, 200, &[("Content-Type", mime(&f)), ("Content-Security-Policy", VAULT_CSP), ("X-Content-Type-Options", "nosniff")], &bytes),
            None => respond(&stream, 404, &[], b"not found"),
        };
    }
    match ui_file(&sv.ui, &url).and_then(|f| std::fs::read(&f).ok().map(|b| (f, b))) {
        Some((path, bytes)) => {
            let mut headers = vec![("Content-Type", mime(&path))];
            if let (Some(c), true) = (&sv.csp, runs_as_page(mime(&path))) {
                headers.push(("Content-Security-Policy", c));
            }
            respond(&stream, 200, &headers, &bytes)
        }
        None => respond(&stream, 404, &[], b"not found"),
    }
}

fn main() {
    // Started by a browser as the extension's receiver (native messaging, for testing browser/
    // on Linux): the same code as the Windows app's, with the notes folder in $LEAN_CLIP_VAULT.
    if std::env::args().nth(1).is_some_and(|a| a.starts_with("chrome-extension://")) {
        let root = || std::env::var_os("LEAN_CLIP_VAULT").map(PathBuf::from).ok_or_else(|| "No notes folder (LEAN_CLIP_VAULT).".to_string());
        let now = || {
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
            let t = secs.rem_euclid(86400);
            (outline_core::date::civil_from_days(secs.div_euclid(86400)), format!("{:02}:{:02}", t / 3600, t / 60 % 60))
        };
        outline_core::clip::serve(&mut std::io::stdin().lock(), &mut std::io::stdout().lock(), root, now);
        return;
    }
    let vault = std::env::args().nth(1).expect("usage: devserver <vault> [port]");
    let port = std::env::args().nth(2).unwrap_or("8765".into());
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // the app's data folder (safety copies' device name, core/src/app/safety.rs): $LEAN_DATA_DIR (the
    // UI tests use a fresh one per test), else a folder in the system's temp folder
    let data = std::env::var_os("LEAN_DATA_DIR").map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("lean-outliner-dev-data"));
    outline_core::app::set_data_dir(data);
    let app = App::open(std::path::Path::new(&vault)).expect("open vault");
    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).expect("port in use");
    let sv = Arc::new(Server {
        ui: here.join("../ui"),
        state: Mutex::new(Some(app)),
        me: [format!("http://127.0.0.1:{port}"), format!("http://localhost:{port}")],
        csp: std::fs::read_to_string(here.join("../src-tauri/tauri.conf.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|c| c["app"]["security"]["csp"].as_str().map(String::from)),
        trace: std::env::var("DEV_TRACE").is_ok().then(std::time::Instant::now),
    });
    eprintln!("http://127.0.0.1:{port}  vault={vault}");
    for stream in listener.incoming().flatten() {
        let sv = sv.clone();
        std::thread::spawn(move || handle(&sv, stream));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // (where a key may go is the core's send_keyed's, tested in core/tests/ai_keys.rs)
    use outline_core::ai::KEY_ELSEWHERE;

    #[test]
    fn the_key_commands_keep_others_address() {
        use serde_json::json;
        let set = |p: &str, k: &str, b: &str| ai_command("ai_key_set", &json!({ "provider": p, "key": k, "base": b })).unwrap();
        assert_eq!(set("other", "sk-x", "https://ai.example.org/v1"), Ok(json!(true)));
        assert_eq!(set("claude", "sk-c", "https://attacker.example/v1"), Ok(json!(true)));
        let keys = AI_KEYS.lock().unwrap().clone();
        assert!(keys.contains(&("other".into(), "sk-x".into(), "https://ai.example.org/v1".into())));
        assert!(keys.contains(&("claude".into(), "sk-c".into(), String::new())), "only Other keeps an address");
        assert_eq!(set("claude", "has space", ""), Err("That key has spaces, quotes or line breaks in it.".into()));
        assert_eq!(set("other", "", ""), Ok(json!(false)));
        assert_eq!(ai_command("ai_key_has", &json!({ "provider": "other" })).unwrap(), Ok(json!(false)), "an empty key removes it");
        // a request to another address is refused before anything is sent
        assert_eq!(set("openai", "sk-o", ""), Ok(json!(true)));
        let out = ai_command("ai_send", &json!({ "provider": "openai", "req": { "method": "GET", "url": "https://attacker.example/v1/models", "auth": "bearer" } })).unwrap();
        assert_eq!(out, Err(KEY_ELSEWHERE.into()));
        // ai_send goes through the core's send_keyed (audit finding 15): "Other"'s key only to the
        // address saved with it, a saved address never widens a preset service's, and a key saved
        // with no address goes nowhere
        let send = |p: &str, url: &str| ai_command("ai_send", &json!({ "provider": p, "req": { "method": "GET", "url": url, "auth": "x-api-key" } })).unwrap();
        assert_eq!(set("other", "sk-x", "https://ai.example.org/v1"), Ok(json!(true)));
        assert_eq!(send("other", "https://attacker.example/v1/models"), Err(KEY_ELSEWHERE.into()));
        assert_eq!(send("other", "https://ai.example.org.attacker.example/v1/models"), Err(KEY_ELSEWHERE.into()));
        assert_eq!(set("claude", "sk-c", "https://attacker.example/v1"), Ok(json!(true))); // (the bad key above removed it)
        assert_eq!(send("claude", "https://attacker.example/v1/models"), Err(KEY_ELSEWHERE.into()), "Claude's key, though an address was typed with it");
        AI_KEYS.lock().unwrap().push(("other".into(), "sk-old".into(), String::new())); // saved before addresses were kept
        AI_KEYS.lock().unwrap().retain(|(q, k, _)| q != "other" || k == "sk-old");
        assert_eq!(send("other", "https://ai.example.org/v1/models"), Err(KEY_ELSEWHERE.into()));
        // the header and whether a key is needed come from the service: Claude with no key saved is
        // refused before anything is sent, though the page says none is needed
        assert_eq!(set("claude", "", ""), Ok(json!(false)));
        let out = ai_command("ai_send", &json!({ "provider": "claude", "req": { "method": "GET", "url": "https://api.anthropic.com/v1/models", "key_required": false } })).unwrap();
        assert!(out.unwrap_err().starts_with("No key is saved"));
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("devserver-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("ui/sub")).unwrap();
        std::fs::write(d.join("ui/index.html"), "<p>").unwrap();
        std::fs::write(d.join("ui/app.js"), "x").unwrap();
        std::fs::write(d.join("ui/sub/a b.js"), "y").unwrap();
        std::fs::write(d.join("secret.txt"), "no").unwrap();
        d
    }

    #[test]
    fn page_files_come_only_from_the_ui_folder() {
        let d = scratch("ui");
        let ui = d.join("ui");
        let real = |p: &str| ui.join(p).canonicalize().unwrap();
        assert_eq!(ui_file(&ui, "/"), Some(real("index.html")));
        assert_eq!(ui_file(&ui, "/app.js"), Some(real("app.js")));
        assert_eq!(ui_file(&ui, "/sub/a%20b.js"), Some(real("sub/a b.js")), "decoded");
        for bad in [
            "/%2fetc/passwd",
            "/%2Fetc%2Fpasswd",
            "//etc/passwd",
            "/%5cWindows%5cwin.ini",
            "/%5C%5Cserver%5Cshare%5Ca.js",
            "/..%2fsecret.txt",
            "/%2e%2e/secret.txt",
            "/../secret.txt",
            "/sub/../index.html",
            "/sub/%2e%2e/index.html",
            "/./index.html",
            "/C:/Windows/win.ini",
            "/C%3a/Windows/win.ini",
            "/index.html%00.js",
            "/sub/",
            "/sub",
            "/nosuch.js",
            "app.js",
            "",
        ] {
            assert_eq!(ui_file(&ui, bad), None, "{bad}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(d.join("secret.txt"), ui.join("link.txt")).unwrap();
            std::os::unix::fs::symlink(&d, ui.join("up")).unwrap();
            assert_eq!(ui_file(&ui, "/link.txt"), None, "a link out of the folder");
            assert_eq!(ui_file(&ui, "/up/secret.txt"), None);
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn pages_get_the_policy_whatever_the_case_of_their_name() {
        for name in ["index.html", "index.HTML", "a.Html", "a.htm", "a.HTM", "logo.svg", "logo.SVG"] {
            assert!(runs_as_page(mime(Path::new(name))), "{name}");
        }
        for name in ["app.js", "app.css", "font.woff2", "a.png", "a", "a.html.txt"] {
            assert!(!runs_as_page(mime(Path::new(name))), "{name}");
        }
    }

    #[test]
    fn only_this_page_may_call_the_api() {
        let me = ["http://127.0.0.1:8766".to_string(), "http://localhost:8766".to_string()];
        assert!(api_allowed("POST", Some("http://127.0.0.1:8766"), &me));
        assert!(api_allowed("POST", Some("http://localhost:8766"), &me));
        assert!(!api_allowed("POST", None, &me), "no Origin: refused");
        assert!(!api_allowed("POST", Some("null"), &me));
        assert!(!api_allowed("POST", Some("http://127.0.0.1:8767"), &me));
        assert!(!api_allowed("POST", Some("https://evil.example"), &me));
        assert!(!api_allowed("POST", Some(""), &me));
        assert!(!api_allowed("GET", Some("http://127.0.0.1:8766"), &me), "only by POST");
    }
}

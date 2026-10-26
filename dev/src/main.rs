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
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn mime(p: &std::path::Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html") => "text/html; charset=utf-8",
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
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

struct Request {
    method: String,
    url: String,
    origin: Option<String>,
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
    let (mut len, mut origin, mut test_now) = (0usize, None, None);
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
    Some(Request { method, url, origin, test_now, body })
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

fn handle(sv: &Server, stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));
    let Some(req) = read_request(&stream) else { return };
    let url = req.url.split('?').next().unwrap_or("/").to_string();
    if let Some(t0) = sv.trace {
        eprintln!("{:>7.1} ms  {} {}", t0.elapsed().as_secs_f64() * 1000.0, req.method, url);
    }
    if let Some(cmd) = url.strip_prefix("/api/") {
        // only this page may call the API (another web page open in the browser can't)
        if req.origin.as_ref().is_some_and(|o| !sv.me.contains(o)) {
            return respond(&stream, 403, &[], b"forbidden");
        }
        let args = serde_json::from_slice(&req.body).unwrap_or(serde_json::Value::Null);
        let mut state = sv.state.lock().unwrap_or_else(|p| p.into_inner());
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match (cmd, req.test_now, state.as_ref()) {
            ("check", Some(now), Some(app)) => check_vault_at(&app.root, now).map(|r| serde_json::to_value(r).unwrap_or_default()),
            ("bin_pictures", Some(now), Some(app)) => {
                let paths: Vec<String> = serde_json::from_value(args.get("paths").cloned().unwrap_or_default()).unwrap_or_default();
                app.bin_pictures_at(&paths, now).map(|r| serde_json::to_value(r).unwrap_or_default())
            }
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
            Some((f, bytes)) => respond(&stream, 200, &[("Content-Type", mime(&f))], &bytes),
            None => respond(&stream, 404, &[], b"not found"),
        };
    }
    let rel = if url == "/" { "index.html".to_string() } else { decode(url.trim_start_matches('/')) };
    let safe = !rel.split(['/', '\\']).any(|c| c == ".." || c.contains(':'));
    let path = sv.ui.join(&rel);
    match std::fs::read(&path) {
        Ok(bytes) if safe => {
            let mut headers = vec![("Content-Type", mime(&path))];
            if let (Some(c), true) = (&sv.csp, rel.ends_with(".html")) {
                headers.push(("Content-Security-Policy", c));
            }
            respond(&stream, 200, &headers, &bytes)
        }
        _ => respond(&stream, 404, &[], b"not found"),
    }
}

fn main() {
    let vault = std::env::args().nth(1).expect("usage: devserver <vault> [port]");
    let port = std::env::args().nth(2).unwrap_or("8765".into());
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // safety copies (core/src/app/safety.rs): $LEAN_DATA_DIR (the UI tests use a fresh one per test),
    // else a folder in the system's temp folder
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

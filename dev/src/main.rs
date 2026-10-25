//! Dev server: serves ../ui and answers POST /api/<cmd> with the same dispatch the app uses.
//! Usage: devserver <vault dir> [port]
use outline_core::app::{dispatch, App};
use std::path::PathBuf;

fn main() {
    let vault = std::env::args().nth(1).expect("usage: devserver <vault> [port]");
    let port = std::env::args().nth(2).unwrap_or("8765".into());
    let ui = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../ui");
    let mut state = Some(App::open(std::path::Path::new(&vault)).expect("open vault"));
    let server = tiny_http::Server::http(format!("127.0.0.1:{port}")).unwrap();
    eprintln!("http://127.0.0.1:{port}  vault={vault}");
    for mut req in server.incoming_requests() {
        let url = req.url().split('?').next().unwrap_or("/").to_string();
        let resp = if let Some(cmd) = url.strip_prefix("/api/") {
            let mut body = String::new();
            req.as_reader().read_to_string(&mut body).ok();
            let args = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| dispatch(&mut state, cmd, args)));
            let (code, out) = match res {
                Ok(Ok(v)) => (200, v.to_string()),
                Ok(Err(e)) => (400, serde_json::json!({ "error": e }).to_string()),
                Err(_) => (500, serde_json::json!({ "error": format!("internal error in {cmd}") }).to_string()),
            };
            tiny_http::Response::from_string(out).with_status_code(code)
                .with_header("Content-Type: application/json".parse::<tiny_http::Header>().unwrap())
        } else {
            let rel = if url == "/" { "index.html".to_string() } else { url.trim_start_matches('/').to_string() };
            let path = ui.join(&rel);
            match std::fs::read(&path) {
                Ok(bytes) if !rel.contains("..") => {
                    let ct = match path.extension().and_then(|e| e.to_str()) {
                        Some("html") => "text/html; charset=utf-8",
                        Some("css") => "text/css",
                        Some("js") => "text/javascript",
                        Some("woff2") => "font/woff2",
                        Some("svg") => "image/svg+xml",
                        _ => "application/octet-stream",
                    };
                    tiny_http::Response::from_data(bytes)
                        .with_header(format!("Content-Type: {ct}").parse::<tiny_http::Header>().unwrap())
                        .with_status_code(200)
                }
                _ => tiny_http::Response::from_data(b"not found".to_vec()).with_status_code(404),
            }
        };
        let _ = req.respond(resp);
    }
}

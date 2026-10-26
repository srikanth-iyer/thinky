//! Tauri shell: one command, `call`, forwards every UI request to outline_core's dispatch.
//! Platform glue lives here too: showing images from the notes folder, noticing file
//! changes, finishing saves before the window closes, and the Windows capture box.
use outline_core::app::{collect_changes, dispatch, App};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::{Emitter, Manager};

mod watch;
pub mod win;

struct State(Mutex<Option<App>>);

/// The open notes folder, for showing its images (kept apart from the app, so pictures
/// never wait behind a slow request).
static ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);
/// Text handed to the capture box (from a browser link or the clipboard).
static PREFILL: Mutex<Option<(String, String)>> = Mutex::new(None);
static CLOSING: AtomicBool = AtomicBool::new(false);

fn lock(s: &State) -> MutexGuard<'_, Option<App>> {
    s.0.lock().unwrap_or_else(|p| p.into_inner())
}

/// A bug in one request must never take the whole app (and unsaved typing) down:
/// catch the panic, log it, report it, keep going.
fn guarded(cmd: &str, f: impl FnOnce() -> Result<Value, String>) -> Result<Value, String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(e) => {
            let msg = e.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| e.downcast_ref::<String>().cloned()).unwrap_or_default();
            let m = format!("Internal error in “{cmd}”: {msg}");
            outline_core::log::record(&m);
            Err(m)
        }
    }
}

#[tauri::command(async)]
fn call(app: tauri::AppHandle, state: tauri::State<'_, State>, cmd: String, args: Value) -> Result<Value, String> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    guarded(&cmd, || match cmd.as_str() {
        // look for changed files without holding up other requests while reading them
        "rescan" => {
            let plan = lock(&state).as_ref().map(|a| a.scan_plan()).ok_or("no vault open")?;
            let ch = collect_changes(plan);
            Ok(json!(lock(&state).as_mut().map(|a| a.apply_changes(ch)).unwrap_or_default()))
        }
        "quit" => {
            if let Some(a) = lock(&state).as_mut() {
                a.persist();
            }
            app.exit(0);
            Ok(json!(true))
        }
        "platform" => Ok(json!(std::env::consts::OS)),
        "clipboard" => Ok(json!(win::clipboard_text())),
        "prefill" => {
            let p = PREFILL.lock().unwrap_or_else(|p| p.into_inner()).clone();
            Ok(match p {
                Some((text, url)) => json!({ "text": text, "url": url, "from": "link" }),
                None => json!({ "text": win::clipboard_text(), "url": "", "from": "clipboard" }),
            })
        }
        "set_shortcut" => {
            win::set_capture_shortcut(&s("key"))?;
            Ok(json!(true))
        }
        // the capture box says where a note will go: today's journal or the quick capture page
        "capture_where" => {
            let root = outline_core::app::last_vault_or_why()?;
            // the same rule as adding the note: only a missing config.edn means Logseq's defaults
            let cfg = match std::fs::read_to_string(root.join("logseq").join("config.edn")) {
                Ok(t) => outline_core::Config::from_edn(&t),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => outline_core::Config::default(),
                Err(e) => return Err(format!("Couldn't read logseq/config.edn ({e}).")),
            };
            let (today, _) = win::local_now();
            Ok(json!({ "today": cfg.capture_today, "page": if cfg.capture_today { cfg.journal_title(today) } else { cfg.capture_page.clone() } }))
        }
        // the capture box: add to the notes folder last opened, without loading it
        "quick_capture" => {
            let root = outline_core::app::last_vault_or_why()?;
            let (today, time) = win::local_now();
            Ok(json!(outline_core::capture::capture_to_vault(&root, &s("text"), &s("url"), today, &time)?))
        }
        _ => {
            let r = dispatch(&mut lock(&state), &cmd, args.clone());
            if cmd == "open" && r.is_ok() {
                if let Some(a) = lock(&state).as_ref() {
                    *ROOT.lock().unwrap_or_else(|p| p.into_inner()) = Some(a.root.clone());
                    let cfg = &a.vault.config;
                    let dirs = vec![a.root.join(&cfg.pages_dir), a.root.join(&cfg.journals_dir)];
                    let h = app.clone();
                    watch::start(a.root.clone(), dirs, move || {
                        let _ = h.emit("lean-files", ());
                    });
                }
            }
            r
        }
    })
}

/// `%20` etc. in a URL path.
fn decode_path(s: &str) -> String {
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

fn mime(p: &std::path::Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(State(Mutex::new(None)))
        .setup(|app| {
            if let Ok(dir) = app.path().app_cache_dir() {
                outline_core::app::set_cache_dir(dir);
            }
            std::thread::spawn(win::register_link_handler);
            if let Some(w) = app.get_webview_window("capture") {
                place_capture_box(&w);
            }
            Ok(())
        })
        // pictures in notes: vault://localhost/assets/x.png → <notes folder>/assets/x.png
        .register_asynchronous_uri_scheme_protocol("vault", |_ctx, req, responder| {
            let path = decode_path(req.uri().path());
            std::thread::spawn(move || {
                let root = ROOT.lock().unwrap_or_else(|p| p.into_inner()).clone();
                let file = root.and_then(|r| outline_core::app::asset_file(&r, &path));
                let resp = match file.and_then(|f| std::fs::read(&f).ok().map(|b| (f, b))) {
                    Some((f, bytes)) => tauri::http::Response::builder()
                        .header(tauri::http::header::CONTENT_TYPE, mime(&f))
                        .header(tauri::http::header::CACHE_CONTROL, "max-age=600")
                        .body(bytes),
                    None => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                if let Ok(r) = resp {
                    responder.respond(r);
                }
            });
        })
        .on_window_event(|window, event| {
            // let the page finish saving before the window goes away
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && !CLOSING.swap(true, Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("lean-close", ());
                    let h = window.app_handle().clone();
                    std::thread::spawn(move || {
                        // if the page doesn't answer (it hung), close anyway
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        h.exit(0);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![call])
}

/// The app's settings and built-in files (the `ui/` folder, icons). Generated in ONE place:
/// each `generate_context!` embeds a full copy of them in the program.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    builder().run(context()).expect("error while running the app");
}

/// The small "Add to journal" box (Windows shortcut key, browser link with `box=1`), like a
/// launcher (Spotlight, Raycast): no title bar, one wide line to type in that grows with the
/// text (capture.js), a little above the middle of the screen, on top, not in the taskbar.
/// Windows 11 gives it rounded corners and a shadow (`shadow`).
pub fn run_capture_box(prefill: Option<(String, String)>) {
    *PREFILL.lock().unwrap_or_else(|p| p.into_inner()) = prefill;
    let mut ctx = context();
    if let Some(w) = ctx.config_mut().app.windows.first_mut() {
        w.label = "capture".into();
        w.url = tauri::WebviewUrl::App("capture.html".into());
        w.title = "Add to journal".into();
        w.decorations = false;
        w.shadow = true;
        w.width = 640.0;
        w.height = 98.0; // one line; capture.js grows it with the text
        w.min_width = None;
        w.min_height = None;
        w.resizable = false;
        w.always_on_top = true;
        w.skip_taskbar = true;
        w.focus = true;
        w.visible = false; // shown once it's in place (place_capture_box)
    }
    builder().run(ctx).expect("error while running the capture box");
}

/// Centre the capture box across the screen, a quarter of the way down, then show it.
fn place_capture_box(w: &tauri::WebviewWindow) {
    let monitor = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten());
    if let (Some(m), Ok(size)) = (monitor, w.outer_size()) {
        let (mp, ms) = (m.position(), m.size());
        let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
        let y = mp.y + ms.height as i32 / 4;
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
}

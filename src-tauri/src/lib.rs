//! Tauri shell: one command, `call`, forwards every UI request to outline_core's dispatch.
//! Platform glue lives here too: showing images from the notes folder, noticing file
//! changes, finishing saves before the window closes, and the Windows capture box.
use outline_core::app::{collect_changes, dispatch, App};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::{Emitter, Manager};

pub mod update;
// Android's "Add a note" pop-up adds through the core (JNI; the tests run everywhere)
pub mod android_capture;
#[cfg(windows)]
pub mod capture_box;
pub mod hotkey;
pub mod links;
pub mod native_host;
mod watch;
pub mod win;

struct State(Mutex<Option<App>>);

/// The open notes folder, for showing its images (kept apart from the app, so pictures
/// never wait behind a slow request).
static ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);
/// The files last dropped on the window from Explorer (its drag-drop event): `save_asset_path`
/// copies only these, so the page can never ask for any other file on the computer.
static DROPPED: Mutex<Vec<std::path::PathBuf>> = Mutex::new(Vec::new());
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
            let mut st = lock(&state);
            let changed = st.as_mut().map(|a| a.apply_changes(ch)).unwrap_or_default();
            // the settings changed (config.edn): the journals folder may be another one now
            if let Some(a) = st.as_ref().filter(|_| changed.iter().any(|c| c == outline_core::app::CONFIG_REL)) {
                watch_notes(&app, a);
            }
            Ok(json!(changed))
        }
        "quit" => {
            if let Some(a) = lock(&state).as_mut() {
                a.persist();
            }
            app.exit(0);
            Ok(json!(true))
        }
        "platform" => Ok(json!(std::env::consts::OS)),
        // a picture or file dropped on the window from Explorer (Tauri's drag-drop event gives its
        // path; ui/filedrop.js): copied into the open notes folder's assets/, and its link
        "save_asset_path" => {
            let root = lock(&state).as_ref().map(|a| a.root.clone()).ok_or("no notes folder is open")?;
            let file = std::path::PathBuf::from(s("path"));
            if !DROPPED.lock().unwrap_or_else(|p| p.into_inner()).contains(&file) {
                return Err("only files dropped on the window can be added this way".into());
            }
            let (path, md) = outline_core::app::save_dropped_file(&root, &file)?;
            Ok(json!({ "path": path, "md": md }))
        }
        // a leanoutliner://page/… or …/note/… link the app was started with (links.rs), once
        "start_link" => Ok(json!(links::take_start())),
        // the page ⋯ menu's "Show in Explorer": its file, selected in a File Explorer window
        "reveal_file" => {
            let file = lock(&state).as_ref().ok_or("no vault open")?.page_file(&s("name"))?;
            tauri_plugin_opener::reveal_item_in_dir(&file).map_err(|e| format!("Couldn’t show the file: {e}"))?;
            Ok(json!(true))
        }
        // the browser extension (native_host.rs): set it up (its files, the receiver for Edge),
        // then show its folder in Explorer for Edge's "Load unpacked"
        "browser_setup" => {
            let dir = native_host::setup()?;
            let _ = tauri_plugin_opener::reveal_item_in_dir(&dir);
            Ok(json!({ "folder": dir.display().to_string() }))
        }
        "browser_status" => Ok(json!({ "set_up": native_host::is_set_up(), "folder": native_host::folder().map(|d| d.display().to_string()) })),
        // the capture box's shortcut key (hotkey.rs): the key as saved, or what's set now
        "set_shortcut" => Ok(json!(hotkey::set(&s("key"))?)),
        "get_shortcut" => Ok(hotkey::state()),
        // one-click updates (update.rs); the page passes only the build it saw ("build-24")
        "update_status" | "update_download" | "update_check" => update::command(&cmd, &s("tag"), &app.package_info().version.to_string()),
        "update_install" => {
            if let Some(a) = lock(&state).as_mut() {
                a.persist(); // as when quitting (the page saved the notes themselves first)
            }
            update::install(&app.package_info().version.to_string())?;
            app.exit(0);
            Ok(json!(true))
        }
        _ => {
            let r = dispatch(&mut lock(&state), &cmd, args.clone());
            if cmd == "open" && r.is_ok() {
                if let Some(a) = lock(&state).as_ref() {
                    watch_notes(&app, a);
                }
            }
            r
        }
    })
}

/// Pictures come from the open notes folder, and its pages and journals folders are watched for
/// changes made elsewhere (`lean-files` → the page rescans).
fn watch_notes(app: &tauri::AppHandle, a: &App) {
    *ROOT.lock().unwrap_or_else(|p| p.into_inner()) = Some(a.root.clone());
    let cfg = &a.vault.config;
    let dirs = vec![a.root.join(&cfg.pages_dir), a.root.join(&cfg.journals_dir)];
    let h = app.clone();
    watch::start(a.root.clone(), dirs, move || {
        let _ = h.emit("lean-files", ());
    });
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
            // the safety copies' name for this device (they live in the notes folder's logseq/.safety-<device>),
            // and copies kept while the notes folder can't be written: not the cache (Android may clear it)
            if let Ok(dir) = app.path().app_local_data_dir() {
                outline_core::app::set_data_dir(dir);
            }
            std::thread::spawn(win::register_link_handler);
            std::thread::spawn(update::tidy); // the last update's installer, once it has run
            std::thread::spawn(hotkey::at_start); // the shortcut key's helper runs
            std::thread::spawn(native_host::refresh); // the browser extension's files, once set up
            links::listen(app.handle().clone()); // page and note links clicked while it's open
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
            // files dropped from Explorer: the only ones save_asset_path will copy
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                *DROPPED.lock().unwrap_or_else(|p| p.into_inner()) = paths.clone();
            }
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

//! Tauri shell: one command, `call`, forwards every UI request to outline_core's dispatch.
//! Platform glue lives here too: showing images from the notes folder, noticing file
//! changes, finishing saves before the window closes, and the Windows capture box.
use outline_core::app::{collect_changes, dispatch, App};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::{Emitter, Manager};

pub mod update;
mod ai_key;
// Android's "Add a note" pop-up adds through the core (JNI; the tests run everywhere)
pub mod android_capture;
#[cfg(windows)]
pub mod capture_box;
pub mod hotkey;
pub mod links;
pub mod native_host;
mod shell_rules;
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
            let (plan, root) = lock(&state).as_ref().map(|a| (a.scan_plan(), a.root.clone())).ok_or("no vault open")?;
            let ch = collect_changes(plan);
            let mut st = lock(&state);
            // another notes folder opened while these were read: they belong to the old one, never
            // to this (review 17b; App::apply_changes checks it too)
            let changed = st.as_mut().filter(|a| a.root == root).map(|a| a.apply_changes(ch)).unwrap_or_default();
            // the settings changed (config.edn): the journals folder may be another one now
            if let Some(a) = st.as_ref().filter(|_| changed.iter().any(|c| c == outline_core::app::CONFIG_REL)) {
                watch_notes(&app, a);
            }
            Ok(json!(changed))
        }
        // a backup reads every file and may push to GitHub: done without holding the notes folder,
        // so saving and typing never wait for it (review A2; core `backup::backup_now_at`)
        "backup_now" => {
            let root = lock(&state).as_ref().map(|a| a.root.clone()).ok_or("no vault open")?;
            let keep = args.get("keep").and_then(Value::as_u64).unwrap_or(4) as usize;
            let push = args.get("push").and_then(Value::as_bool).unwrap_or(true);
            serde_json::to_value(outline_core::app::backup::backup_now_at(&root, &s("kind"), &s("dest"), keep, push, &s("stamp"))).map_err(|e| e.to_string())
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
        // the optional AI features (ai_key.rs): a service's key kept by Windows (with "Other"'s address,
        // the only place its key may go), and a request sent with it, only to that service
        "ai_key_set" => Ok(json!(ai_key::set(&s("provider"), &s("key"), &s("base"))?)),
        "ai_key_has" => Ok(json!(ai_key::has(&s("provider"))?)),
        "ai_send" => {
            let req: outline_core::ai::Request = serde_json::from_value(args.get("req").cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
            let (status, body) = ai_key::send(&s("provider"), &req)?;
            Ok(json!({ "status": status, "body": body }))
        }
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

/// Pictures come from the open notes folder, and its pages and journals folders (and config.edn,
/// Build 49) are watched for changes made elsewhere (`lean-files` → the page rescans).
fn watch_notes(app: &tauri::AppHandle, a: &App) {
    *ROOT.lock().unwrap_or_else(|p| p.into_inner()) = Some(a.root.clone());
    let cfg = &a.vault.config;
    let dirs = vec![a.root.join(&cfg.pages_dir), a.root.join(&cfg.journals_dir)];
    let h = app.clone();
    watch::start(a.root.clone(), dirs, a.root.join("logseq"), move || {
        let _ = h.emit("lean-files", ());
    });
}

/// `%20` etc. in a URL path.
fn decode_path(s: &str) -> String {
    // the core's decoder (outline_core::link::percent_bytes), so all of them agree
    String::from_utf8_lossy(&outline_core::link::percent_bytes(s, false)).into_owned()
}

fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // the window shows only the app's own page: no web page, file or other address can ever
        // be loaded into it, so nothing outside reaches its commands (or Android's LeanAndroid
        // bridge). Web links open in the browser instead (the opener plugin, App.openUrl).
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-guard")
                .on_navigation(|_, url| {
                    let ok = outline_core::link::is_app_page(url.as_str());
                    if !ok {
                        outline_core::log::record(&format!("The window was kept from going to another address ({}).", url.scheme()));
                    }
                    ok
                })
                .build(),
        )
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
            // (Windows only: on Android each would be a thread that does nothing)
            #[cfg(windows)]
            {
                std::thread::spawn(win::register_link_handler);
                std::thread::spawn(update::tidy); // the last update's installer, once it has run
                std::thread::spawn(hotkey::at_start); // the shortcut key's helper runs
                std::thread::spawn(native_host::refresh); // the browser extension's files, once set up
                // the AI requests' body files another run left behind (ai.rs `sweep_temp`, review medium row)
                std::thread::spawn(|| {
                    if let Some(c) = outline_core::app::cache_dir() {
                        outline_core::ai::sweep_temp(&c.join("ai"));
                    }
                });
            }
            links::listen(app.handle().clone()); // page and note links clicked while it's open
            Ok(())
        })
        // pictures in notes: vault://localhost/assets/x.png → <notes folder>/assets/x.png, read by a
        // few threads in turn (a page of a hundred pictures asks for them all at once), none bigger
        // than ASSET_MAX (25 MB, each is read whole; a bigger picture gets a small picture saying so,
        // `too_big_picture`), sent as a picture type (shell_rules::picture_type)
        .register_asynchronous_uri_scheme_protocol("vault", |_ctx, req, responder| {
            let path = decode_path(req.uri().path());
            static POOL: OnceLock<shell_rules::Pool> = OnceLock::new();
            POOL.get_or_init(|| shell_rules::Pool::new(4)).run(move || {
                let root = ROOT.lock().unwrap_or_else(|p| p.into_inner()).clone();
                let file = root.and_then(|r| outline_core::app::asset_file(&r, &path));
                // a picture over the app's limit: a small picture that says so, not a broken one
                // (outline_core::app::too_big_picture; read only its size, never the file)
                if file.as_deref().is_some_and(|f| shell_rules::picture_type(f).starts_with("image/") && outline_core::app::too_big_to_show(f)) {
                    let r = tauri::http::Response::builder()
                        .header(tauri::http::header::CONTENT_TYPE, "image/svg+xml")
                        .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
                        .header("X-Content-Type-Options", "nosniff")
                        .body(outline_core::app::too_big_picture().into_bytes());
                    if let Ok(r) = r {
                        responder.respond(r);
                    }
                    return;
                }
                let resp = match file.and_then(|f| shell_rules::read_capped(&f, shell_rules::ASSET_MAX).ok().map(|b| (f, b))) {
                    Some((f, bytes)) => tauri::http::Response::builder()
                        .header(tauri::http::header::CONTENT_TYPE, shell_rules::picture_type(&f))
                        .header(tauri::http::header::CACHE_CONTROL, "max-age=600")
                        // never a page that runs: an SVG or HTML file synced into assets/ could
                        // otherwise run script with the app's own rights (dev/src/main.rs the same)
                        .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
                        .header("X-Content-Type-Options", "nosniff")
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
            // let the page finish saving before the window goes away: the main window never closes by
            // itself (a second click while it saves too, review 17a); the page closes it ("quit")
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let main = window.label() == "main";
                let step = shell_rules::close_step(main, main && CLOSING.swap(true, Ordering::SeqCst));
                if step.prevent {
                    api.prevent_close();
                }
                if step.ask_page {
                    let _ = window.emit("lean-close", ());
                    let h = window.app_handle().clone();
                    std::thread::spawn(move || {
                        // if the page doesn't answer (it hung), close anyway, with the index cache kept
                        // as "quit" keeps it (unless a request still holds the app after a second)
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        let st = h.state::<State>();
                        shell_rules::retry(20, std::time::Duration::from_millis(50), || match st.0.try_lock() {
                            Ok(mut a) => Some(a.as_mut().map(|a| a.persist())),
                            Err(std::sync::TryLockError::Poisoned(p)) => Some(p.into_inner().as_mut().map(|a| a.persist())),
                            Err(std::sync::TryLockError::WouldBlock) => None,
                        });
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

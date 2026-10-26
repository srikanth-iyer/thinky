// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

/// Where the app keeps its cache (Tauri's app_cache_dir), found without starting Tauri.
fn cache_dir() -> Option<PathBuf> {
    let base = if cfg!(windows) { std::env::var_os("LOCALAPPDATA").map(PathBuf::from) } else { std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")) };
    Some(base?.join("com.srikanth.leanoutliner"))
}

/// Add a note to today's journal (or the capture page) of the last-opened notes folder.
fn capture(text: &str, url: &str) -> Result<String, String> {
    if let Some(d) = cache_dir() {
        outline_core::app::set_cache_dir(d);
    }
    let root = outline_core::app::last_vault_or_why()?;
    let (today, time) = lean_outliner_lib::win::local_now();
    outline_core::capture::capture_to_vault(&root, text, url, today, &time)
}

/// The "Add to journal" box: on Windows the native one, which appears at once (no web engine to
/// start); the web one elsewhere, or when the native one can't be made.
fn open_box(prefill: Option<(String, String)>) {
    #[cfg(windows)]
    if lean_outliner_lib::capture_box::run(prefill.clone()).is_ok() {
        return;
    }
    lean_outliner_lib::run_capture_box(prefill);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).cloned().unwrap_or_default();
    // `--capture-box-selftest <folder>`: CI's check of the native box, with a made-up notes folder
    // and cache inside <folder> (see capture_box/selftest.rs); the exit code counts the failures.
    if arg(1) == "--capture-box-selftest" {
        if arg(2).is_empty() {
            std::process::exit(2);
        }
        #[cfg(windows)]
        std::process::exit(lean_outliner_lib::capture_box::selftest(std::path::Path::new(&arg(2))));
        #[cfg(not(windows))]
        std::process::exit(2);
    }
    // `lean-outliner --check <vault> <report.json>`: read-only vault health check, no window.
    if args.len() >= 4 && args[1] == "--check" {
        let res = std::panic::catch_unwind(|| outline_core::app::check_vault(std::path::Path::new(&args[2])));
        let out = match res {
            Ok(Ok(r)) => serde_json::to_string_pretty(&r).unwrap_or_default(),
            Ok(Err(e)) => serde_json::json!({ "error": e }).to_string(),
            Err(_) => serde_json::json!({ "error": "the check crashed" }).to_string(),
        };
        let _ = std::fs::write(&args[3], out);
        return;
    }
    // `--verify-update <installer> <signature file> <build number>`: would this app accept that
    // installer as that build? CI runs it on the app it has just built. Exit code 0 = yes.
    if arg(1) == "--verify-update" {
        let (p, n) = (std::path::Path::new, arg(4).parse().unwrap_or(0));
        let r = lean_outliner_lib::update::verify_files(p(&arg(2)), p(&arg(3)), n, None);
        println!("{}", r.as_ref().map_or_else(|e| format!("refused: {e}"), |_| "genuine".to_string()));
        std::process::exit(if r.is_ok() { 0 } else { 1 });
    }
    // `lean-outliner --capture "text" ["url"]`: straight into the journal, no window.
    if arg(1) == "--capture" {
        if capture(&arg(2), &arg(3)).is_err() {
            open_box(Some((arg(2), arg(3))));
        }
        return;
    }
    // `--capture-box`: the small window (opened by the Start-menu shortcut key).
    if arg(1) == "--capture-box" {
        if let Some(d) = cache_dir() {
            outline_core::app::set_cache_dir(d);
        }
        open_box(None);
        return;
    }
    // `leanoutliner://capture?…` from the browser bookmarklet.
    if let Some((text, url, boxed)) = lean_outliner_lib::win::parse_link(&arg(1)) {
        if boxed || capture(&text, &url).is_err() {
            if let Some(d) = cache_dir() {
                outline_core::app::set_cache_dir(d);
            }
            open_box(Some((text, url)));
        }
        return;
    }
    lean_outliner_lib::run()
}

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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).cloned().unwrap_or_default();
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
    // `lean-outliner --capture "text" ["url"]`: straight into the journal, no window.
    if arg(1) == "--capture" {
        if capture(&arg(2), &arg(3)).is_err() {
            lean_outliner_lib::run_capture_box(Some((arg(2), arg(3))));
        }
        return;
    }
    // `--capture-box`: the small window (opened by the Start-menu shortcut key).
    if arg(1) == "--capture-box" {
        if let Some(d) = cache_dir() {
            outline_core::app::set_cache_dir(d);
        }
        lean_outliner_lib::run_capture_box(None);
        return;
    }
    // `leanoutliner://capture?…` from the browser bookmarklet.
    if let Some((text, url, boxed)) = lean_outliner_lib::win::parse_link(&arg(1)) {
        if boxed || capture(&text, &url).is_err() {
            if let Some(d) = cache_dir() {
                outline_core::app::set_cache_dir(d);
            }
            lean_outliner_lib::run_capture_box(Some((text, url)));
        }
        return;
    }
    lean_outliner_lib::run()
}

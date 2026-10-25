// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `lean-outliner --check <vault> <report.json>`: read-only vault health check, no window.
    let args: Vec<String> = std::env::args().collect();
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
    lean_outliner_lib::run()
}

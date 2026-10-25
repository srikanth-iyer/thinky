//! Tauri shell: one command, `call`, forwards every UI request to outline_core's dispatch.
use outline_core::app::{dispatch, App};
use std::sync::Mutex;

struct State(Mutex<Option<App>>);

#[tauri::command(async)]
fn call(state: tauri::State<'_, State>, cmd: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
    // A bug in one request must never take the whole app (and unsaved typing) down:
    // catch the panic, report it, keep going. A poisoned lock is still usable.
    let mut g = state.0.lock().unwrap_or_else(|p| p.into_inner());
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| dispatch(&mut g, &cmd, args))) {
        Ok(r) => r,
        Err(e) => {
            let msg = e.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| e.downcast_ref::<String>().cloned()).unwrap_or_default();
            Err(format!("Internal error in “{cmd}”: {msg}"))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(State(Mutex::new(None)))
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_cache_dir() {
                outline_core::app::set_cache_dir(dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![call])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

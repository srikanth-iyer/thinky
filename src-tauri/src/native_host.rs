//! The browser extension's receiver (Build 32). Edge starts this program with the extension's
//! address as its first argument (`chrome-extension://<id>/`, then `--parent-window=…`) whenever
//! the extension sends highlights or a passage: Edge's "native messaging". It answers through its
//! standard input and output (outline_core::clip::serve: the filing and the messages are there,
//! tested in core/tests/clip.rs and, in a real browser, dev/ui-tests/t16_browser.mjs) and exits
//! when Edge closes the pipe. Nothing of Tauri or the web engine starts, and nothing stays running.
//!
//! Setting up (Settings → Capture → Browser extension → Set up, Windows only; `setup`): the
//! extension's files (browser/, built into the program) go to
//! `%LOCALAPPDATA%\com.srikanth.leanoutliner\browser-extension\` for Edge's "Load unpacked", the
//! host manifest (`native-host.json`, outline_core::clip::host_manifest: this exe, only the
//! extension's fixed id) beside it, and its path in the registry for Edge and Chrome:
//! `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.srikanth.leanoutliner` (Chrome:
//! `…\Google\Chrome\…`). Once set up, each start of the app (`refresh`) brings the files and the
//! manifest up to date (an update's new extension files, a moved portable exe); Edge loads an
//! unpacked extension's files again when it restarts.

use std::path::PathBuf;

/// Was this program started by a browser as the extension's receiver?
pub fn is_host_call(arg1: &str) -> bool {
    arg1.starts_with("chrome-extension://")
}

/// Answer the extension until Edge closes the pipe. The notes folder is the one last opened in
/// the app (as for the capture box); tests can point it elsewhere with `LEAN_CLIP_VAULT`.
pub fn run() {
    let root = || match std::env::var_os("LEAN_CLIP_VAULT") {
        Some(v) if !v.is_empty() => Ok(PathBuf::from(v)),
        _ => outline_core::app::last_vault_or_why(),
    };
    outline_core::clip::serve(&mut std::io::stdin().lock(), &mut std::io::stdout().lock(), root, crate::win::local_now);
}

/// The extension's files, built into the Windows program (browser/ in the repo, ~25 KB; not in
/// the phone's app).
#[cfg(windows)]
const FILES: [(&str, &[u8]); 9] = [
    ("manifest.json", include_bytes!("../../browser/manifest.json")),
    ("background.js", include_bytes!("../../browser/background.js")),
    ("page.js", include_bytes!("../../browser/page.js")),
    ("popup.html", include_bytes!("../../browser/popup.html")),
    ("popup.css", include_bytes!("../../browser/popup.css")),
    ("popup.js", include_bytes!("../../browser/popup.js")),
    ("icons/32.png", include_bytes!("../../browser/icons/32.png")),
    ("icons/48.png", include_bytes!("../../browser/icons/48.png")),
    ("icons/128.png", include_bytes!("../../browser/icons/128.png")),
];

#[cfg(windows)]
const KEYS: [&str; 2] = ["Software\\Microsoft\\Edge\\NativeMessagingHosts", "Software\\Google\\Chrome\\NativeMessagingHosts"];

fn home() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("com.srikanth.leanoutliner"))
}

/// The folder Edge loads the extension from.
pub fn folder() -> Option<PathBuf> {
    Some(home()?.join("browser-extension"))
}

#[cfg(windows)]
/// Write a file only when its bytes differ (so setting up again, or each start, writes nothing
/// that's already right).
fn put(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    if std::fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(());
    }
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("Couldn’t make {}: {e}", d.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("Couldn’t write {}: {e}", path.display()))
}

/// Put the extension's files and the receiver's manifest in place and tell Edge and Chrome where
/// the manifest is. Returns the extension's folder.
#[cfg(not(windows))]
pub fn setup() -> Result<PathBuf, String> {
    Err("The browser extension is set up from the Windows app.".into())
}

#[cfg(windows)]
pub fn setup() -> Result<PathBuf, String> {
    let dir = folder().ok_or("Couldn’t find your AppData folder.")?;
    for (name, bytes) in FILES {
        put(&dir.join(name), bytes)?;
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let manifest = home().ok_or("Couldn’t find your AppData folder.")?.join("native-host.json");
    put(&manifest, outline_core::clip::host_manifest(&exe.display().to_string()).as_bytes())?;
    let m = manifest.display().to_string();
    let mut ok = false;
    for k in KEYS {
        let key = format!("{k}\\{}", outline_core::clip::HOST_NAME);
        if crate::win::reg_default(&key).as_deref() == Some(m.as_str()) || crate::win::set_reg_default(&key, &m) {
            ok = true;
        }
    }
    if !ok {
        return Err("Windows didn’t let thinky tell Edge where it is (the registry refused).".into());
    }
    Ok(dir)
}

/// Is the receiver set up for Edge (its registry entry there)?
pub fn is_set_up() -> bool {
    cfg!(windows) && crate::win::reg_default(&format!("Software\\Microsoft\\Edge\\NativeMessagingHosts\\{}", outline_core::clip::HOST_NAME)).is_some()
}

/// At the app's start, once set up: bring the files and the manifest up to date (an update's new
/// extension files, a portable exe that moved). Cheap when nothing changed: a registry read and
/// a read of each file.
pub fn refresh() {
    if is_set_up() {
        if let Err(e) = setup() {
            outline_core::log::record(&format!("browser extension: {e}"));
        }
    }
}

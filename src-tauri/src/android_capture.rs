//! Android's "Add a note" pop-up (android/kotlin/QuickCaptureActivity.kt: the widgets' "+", the
//! share sheet's "Add to journal", the Quick Settings tile) adds through the core's own code, so a
//! note lands exactly where the app and the Windows box put it (the quick capture page found by
//! `title::`, alias or file name as everywhere; a new page's own file; the checked write). The
//! pop-up works while the app is closed: it loads this library itself (`LeanCore.load`) and calls
//! `LeanCore.capture(args, bytes)` on a helper thread.
//!
//! One call, JSON in and out, so the Java side has a single plain signature:
//! in  {cache, data, vault, y, m, d, time, text} for words, or {…, name, typeExt} + the picture's
//!     bytes, or {…, link} for a picture copied by an earlier try (not copied twice), or
//!     {…, cmd: "where"} for where notes go;
//! out {ok: true, rel} ({ok: true, today, page} for "where") or {ok: false, error, link?}
//!     (`link`: the Markdown of a picture already copied).
//! The JNI name follows the Kotlin class: package com.srikanth.leanoutliner (checked by
//! scripts/android_overlay.py), object `LeanCore`, method `capture`. Only that function is
//! Android's; `capture` is built everywhere so the tests below run on any computer.

#[cfg(target_os = "android")]
use jni::{
    objects::{JByteArray, JClass, JString},
    sys::jstring,
    JNIEnv,
};
use serde_json::{json, Value};
use std::path::PathBuf;

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_srikanth_leanoutliner_LeanCore_capture<'local>(mut env: JNIEnv<'local>, _class: JClass<'local>, args: JString<'local>, bytes: JByteArray<'local>) -> jstring {
    // never let a panic cross into Java: the pop-up shows it and keeps the text
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Value {
        let args: String = match env.get_string(&args) {
            Ok(s) => s.into(),
            Err(e) => return json!({ "ok": false, "error": format!("Couldn't read the note ({e}).") }),
        };
        let bytes = if bytes.is_null() {
            None
        } else {
            match env.convert_byte_array(&bytes) {
                Ok(b) => Some(b),
                Err(e) => return json!({ "ok": false, "error": format!("Couldn't read the picture ({e}).") }),
            }
        };
        match serde_json::from_str::<Value>(&args) {
            Ok(a) => capture(&a, bytes.as_deref()),
            Err(e) => json!({ "ok": false, "error": format!("Couldn't read the note ({e}).") }),
        }
    }))
    .unwrap_or_else(|_| json!({ "ok": false, "error": "Something went wrong while adding it, so nothing was added." }));
    env.new_string(out.to_string()).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

/// The work, apart from JNI (also what the tests below call).
pub fn capture(a: &Value, bytes: Option<&[u8]>) -> Value {
    let s = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let n = |k: &str| a.get(k).and_then(Value::as_u64).unwrap_or(0) as u32;
    // the app's own cache and data folders, as the app sets them (Tauri: cacheDir, dataDir), so
    // the notes folder is opened with the app's index cache; set once per process (the app, if it
    // starts later in this process, gives the same folders)
    if !s("cache").is_empty() {
        outline_core::app::set_cache_dir(PathBuf::from(s("cache")));
    }
    if !s("data").is_empty() {
        outline_core::app::set_data_dir(PathBuf::from(s("data")));
    }
    let vault = s("vault");
    if vault.is_empty() {
        return json!({ "ok": false, "error": "Open thinky once and choose your notes folder first." });
    }
    let root = PathBuf::from(vault);
    let today = (n("y") as i32, n("m"), n("d"));
    let time = s("time");
    if today.1 == 0 || today.2 == 0 {
        return json!({ "ok": false, "error": "Couldn't tell today's date, so nothing was added." });
    }
    if s("cmd") == "where" {
        // the pop-up's "to …" line: today's journal or the quick capture page, as config.edn says now
        return match outline_core::capture::read_config(&root) {
            Ok(cfg) => {
                let (journal, page) = outline_core::capture::default_place(&cfg, today);
                json!({ "ok": true, "today": journal, "page": page })
            }
            Err(e) => json!({ "ok": false, "error": format!("Couldn't read logseq/config.edn ({e}).") }),
        };
    }
    let res = match bytes {
        None if s("link").is_empty() => outline_core::capture::capture_to_usual(&root, &s("text"), "", false, today, &time),
        None => outline_core::capture::capture_media_to_usual(&root, &s("link"), today, &time),
        Some(bytes) => {
            // as the Windows box does: config.edn readable before anything is copied
            if let Err(e) = outline_core::capture::read_config(&root) {
                return json!({ "ok": false, "error": format!("Couldn't read logseq/config.edn ({e}), so nothing was added.") });
            }
            let name = with_type_ext(&s("name"), &s("typeExt"));
            let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
            let rel = match outline_core::app::save_asset_file_at(&root, &name, bytes, ms) {
                Ok(r) => r,
                Err(e) => return json!({ "ok": false, "error": format!("{e} Nothing was added.") }),
            };
            let link = outline_core::app::asset_markdown(&name, &rel);
            return match outline_core::capture::capture_media_to_usual(&root, &link, today, &time) {
                Ok(rel) => json!({ "ok": true, "rel": rel }),
                Err(e) => json!({ "ok": false, "error": e, "link": link }),
            };
        }
    };
    match res {
        Ok(rel) => json!({ "ok": true, "rel": rel }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

/// A shared file's name with the extension of its type (Android's, e.g. "jpg") when it has none
/// of its own that `asset_file_name` keeps: its own extension, else its type's, else none.
fn with_type_ext(name: &str, type_ext: &str) -> String {
    let name = if name.trim().is_empty() { "image" } else { name };
    let ext: String = type_ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(10).collect::<String>().to_ascii_lowercase();
    if ext.is_empty() || outline_core::app::asset_file_name(name, 0).contains('.') {
        name.to_string()
    } else {
        format!("{name}.{ext}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(tag: &str, config: &str) -> PathBuf {
        let v = std::env::temp_dir().join(format!("lean-android-capture-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&v);
        for d in ["pages", "journals", "logseq"] {
            std::fs::create_dir_all(v.join(d)).unwrap();
        }
        std::fs::write(v.join("logseq/config.edn"), config).unwrap();
        v
    }
    fn args(v: &std::path::Path, more: Value) -> Value {
        let mut a = json!({ "vault": v.to_string_lossy(), "y": 2026, "m": 10, "d": 28, "time": "09:15" });
        a.as_object_mut().unwrap().extend(more.as_object().unwrap().clone());
        a
    }

    #[test]
    fn the_phone_adds_where_the_app_does() {
        const INBOX: &str = r#"{:quick-capture-options {:insert-today? false :default-page "Inbox"}}"#;
        // the reviewer's case: pages/inbox.md is the page "Mail" (title::): a new Inbox (2).md, Mail untouched
        let v = vault("inbox", INBOX);
        std::fs::write(v.join("pages/inbox.md"), "title:: Mail\n- mail").unwrap();
        assert_eq!(capture(&args(&v, json!({ "cmd": "where" })), None), json!({ "ok": true, "today": false, "page": "Inbox" }));
        let r = capture(&args(&v, json!({ "text": "Shared https://example.com/a" })), None);
        assert_eq!(r, json!({ "ok": true, "rel": "pages/Inbox (2).md" }));
        assert_eq!(std::fs::read_to_string(v.join("pages/inbox.md")).unwrap(), "title:: Mail\n- mail");
        assert_eq!(std::fs::read_to_string(v.join("pages/Inbox (2).md")).unwrap(), "title:: Inbox\n- [[quick capture]] **09:15**: Shared from https://example.com/a\n");
        // a picture without an extension of its own gets its type's; the media template
        let r = capture(&args(&v, json!({ "name": "1000012345", "typeExt": "JPG" })), Some(b"jpeg"));
        assert_eq!(r["ok"], true, "{r}");
        let pics: Vec<String> = std::fs::read_dir(v.join("assets")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(pics.len() == 1 && pics[0].starts_with("1000012345_") && pics[0].ends_with(".jpg"), "{pics:?}");
        assert_eq!(std::fs::read(v.join("assets").join(&pics[0])).unwrap(), b"jpeg");
        let text = std::fs::read_to_string(v.join("pages/Inbox (2).md")).unwrap();
        assert!(text.ends_with(&format!("- [[quick capture]] **09:15**: ![1000012345](../assets/{})\n", pics[0])), "{text}");
        // a picture copied by a try that then failed: added by its link, not copied again
        let r = capture(&args(&v, json!({ "link": "![x](../assets/x_1.png)" })), None);
        assert_eq!(r, json!({ "ok": true, "rel": "pages/Inbox (2).md" }));
        assert_eq!(std::fs::read_dir(v.join("assets")).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&v);
    }

    #[test]
    fn problems_are_said_and_nothing_is_guessed() {
        let r = capture(&json!({ "vault": "", "y": 2026, "m": 10, "d": 28, "text": "x" }), None);
        assert_eq!(r["ok"], false);
        assert!(r["error"].as_str().unwrap().contains("choose your notes folder"));
        // config.edn there but unreadable (a folder here): nothing written, no picture copied
        let v = vault("badcfg", "");
        std::fs::remove_file(v.join("logseq/config.edn")).unwrap();
        std::fs::create_dir(v.join("logseq/config.edn")).unwrap();
        let r = capture(&args(&v, json!({ "name": "a.png" })), Some(b"png"));
        assert_eq!(r["ok"], false, "{r}");
        assert!(!v.join("assets").exists());
        let r = capture(&args(&v, json!({ "text": "x" })), None);
        assert!(r["error"].as_str().unwrap().contains("config.edn"), "{r}");
        let _ = std::fs::remove_dir_all(&v);
        // today's journal (the app's file name and title formats)
        let v = vault("today", r#"{:quick-capture-options {:insert-today? true} :journal/page-title-format "MMMM do, yyyy" :quick-capture-templates {:text "{text}"}}"#);
        assert_eq!(capture(&args(&v, json!({ "cmd": "where" })), None)["page"], "October 28th, 2026");
        assert_eq!(capture(&args(&v, json!({ "text": "hi" })), None), json!({ "ok": true, "rel": "journals/2026_10_28.md" }));
        assert_eq!(capture(&args(&v, json!({ "text": "  " })), None)["ok"], false);
        let _ = std::fs::remove_dir_all(&v);
    }

    #[test]
    fn a_type_extension_only_when_the_name_has_none() {
        assert_eq!(with_type_ext("IMG_1.jpeg", "jpg"), "IMG_1.jpeg");
        assert_eq!(with_type_ext("photo", "jpg"), "photo.jpg");
        assert_eq!(with_type_ext("a.verylongextension", "png"), "a.verylongextension.png");
        assert_eq!(with_type_ext("", "png"), "image.png");
        assert_eq!(with_type_ext("photo", ""), "photo");
    }
}

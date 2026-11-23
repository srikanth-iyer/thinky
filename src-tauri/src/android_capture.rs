//! Android's "Add a note" pop-up (android/kotlin/QuickCaptureActivity.kt: the widgets' "+", the
//! share sheet's "Add to journal", the Quick Settings tile) adds through the core's own code, so a
//! note lands exactly where the app and the Windows box put it (the quick capture page found by
//! `title::`, alias or file name as everywhere; a new page's own file; the checked write). The
//! pop-up works while the app is closed: it loads this library itself (`LeanCore.load`) and calls
//! `LeanCore.capture(args, bytes)` on a helper thread.
//!
//! One call, JSON in and out, so the Java side has a single plain signature:
//! in  {cache, data, vault, y, m, d, time, text, plain?} for words (plain: words selected in another
//!     app, kept as plain words and lines, at most SELECTED_MAX characters; typed words that start with
//!     the workflow's to-do word, as the to-do button puts it, are added as a to-do: `todo_words`), or {…, name, typeExt} + the picture's
//!     bytes, or {…, link} for a picture copied by an earlier try (not copied twice), or
//!     {…, cmd: "where"} for where notes go, or {…, cmd: "kept", url} for the passages of that web
//!     page already in the notes;
//! out {ok: true, rel} ({ok: true, today, page, todo} for "where", todo: the workflow's to-do word,
//!     TODO or LATER; {ok: true, page, highlights:
//!     [{plain, link}]} for "kept") or {ok: false, error, link?}
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

/// The most characters one "Add to thinky" may add (words selected in another app; the Kotlin side,
/// Checks.SELECTED_MAX, refuses more first): a page can't fill the notes with one selection.
pub const SELECTED_MAX: usize = 20_000;

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
    // a Java exception left by a failed read (out of memory, a bad string) must be cleared first:
    // calling into Java with one pending is not allowed, and the answer would never arrive
    if env.exception_check().unwrap_or(true) {
        let _ = env.exception_clear();
    }
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
        return match outline_core::capture::read_config_to_add(&root) {
            Ok(cfg) => {
                let (journal, page) = outline_core::capture::default_place(&cfg, today);
                json!({ "ok": true, "today": journal, "page": page, "todo": cfg.todo_marker() })
            }
            Err(e) => json!({ "ok": false, "error": format!("Couldn't read logseq/config.edn ({e}).") }),
        };
    }
    if s("cmd") == "kept" {
        // a shared web page's passages already in the notes (Build 46): read only
        return match outline_core::app::App::open_read_only(&root) {
            Ok(app) => {
                let k = outline_core::clip::kept_highlights(&app, &s("url"));
                json!({ "ok": true, "page": k.page, "highlights": k.highlights })
            }
            Err(e) => json!({ "ok": false, "error": e }),
        };
    }
    let res = match bytes {
        // words selected in another app ("Add to thinky", Build 37): kept as plain words, and as
        // plain lines (the review's claim 11b: clip::guard, as the Edge extension's highlights): no
        // line of theirs can start a note, a to-do, a property, a code block, a drawer or a date
        None if s("link").is_empty() => {
            let mut todo = false; // whether the note is added as a to-do (the pop-up's to-do button)
            let text = if a.get("plain").and_then(Value::as_bool) == Some(true) {
                let words = s("text");
                if words.chars().count() > SELECTED_MAX {
                    return json!({ "ok": false, "error": format!("That's more than {SELECTED_MAX} characters, so nothing was added. Select less.") });
                }
                outline_core::clip::guard(&outline_core::clip::defuse(&words))
            } else {
                let words = s("text"); // typed in the pop-up
                match todo_words(&root, &words) {
                    // the to-do button's word was first: the words without it, added as a to-do
                    Ok(Some(rest)) => {
                        todo = true;
                        rest
                    }
                    // no to-do word first: the words as typed
                    Ok(None) => words,
                    // config.edn couldn't be read: nothing added (as when adding any note)
                    Err(e) => return json!({ "ok": false, "error": e }),
                }
            };
            outline_core::capture::capture_to_usual(&root, &text, "", todo, today, &time)
        }
        None => outline_core::capture::capture_media_to_usual(&root, &s("link"), today, &time),
        Some(bytes) => {
            // as the Windows box does: config.edn readable before anything is copied
            if let Err(e) = outline_core::capture::read_config_to_add(&root) {
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

/// Typed words that start with the to-do word the pop-up's to-do button puts first (the workflow's:
/// TODO, or LATER with `:preferred-workflow :now`, as "where" told the pop-up): the words after it, so
/// the core adds the note as a to-do with the word at the very start of the line, as the Windows box's
/// to-do flag does. Without this the quick capture template put the word after its time ("- [[quick
/// capture]] **09:15**: TODO buy milk"), which no to-do list or widget reads as a to-do (audit finding 4).
/// None when the words don't start with that word, or it is all there is (never an empty to-do).
/// Err when config.edn can't be read (it's read only for words that start like a to-do).
fn todo_words(root: &std::path::Path, words: &str) -> Result<Option<String>, String> {
    // most notes don't start with a to-do word: no need to read the settings for them
    if outline_core::task::marker(words.trim_start()).is_none() {
        return Ok(None);
    }
    // the workflow's to-do word, from the settings as they are now
    let cfg = outline_core::capture::read_config_to_add(root).map_err(|e| format!("Couldn't read logseq/config.edn ({e}), so nothing was added."))?;
    Ok(after_word(words, cfg.todo_marker()).map(str::to_string))
}

/// `words` after `word` and the spaces or tabs that follow it, when `words` (spaces before it allowed)
/// starts with that word on its own ("TODO buy", not "TODOS") and something comes after it.
fn after_word<'a>(words: &'a str, word: &str) -> Option<&'a str> {
    let rest = words.trim_start().strip_prefix(word)?; // what comes after the word, if it starts with it
    if !rest.starts_with([' ', '\t']) {
        return None; // the word must be followed by a space or a tab ("TODOS" isn't "TODO")
    }
    let rest = rest.trim_start_matches([' ', '\t']); // the spaces between the word and the words
    (!rest.trim().is_empty()).then_some(rest) // nothing but the word: not a to-do
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
        assert_eq!(capture(&args(&v, json!({ "cmd": "where" })), None), json!({ "ok": true, "today": false, "page": "Inbox", "todo": "TODO" }));
        let r = capture(&args(&v, json!({ "text": "Shared https://example.com/a" })), None);
        assert_eq!(r, json!({ "ok": true, "rel": "pages/Inbox (2).md" }));
        assert_eq!(std::fs::read_to_string(v.join("pages/inbox.md")).unwrap(), "title:: Mail\n- mail");
        assert_eq!(std::fs::read_to_string(v.join("pages/Inbox (2).md")).unwrap(), "title:: Inbox\n- [[quick capture]] **09:15**: Shared from [example.com](https://example.com/a)\n");
        // the pop-up's to-do button puts the to-do word before the words: the note is a to-do, the word at
        // the very start of the line, not after the template's time (audit finding 4)
        let r = capture(&args(&v, json!({ "text": "TODO buy milk" })), None);
        assert_eq!(r, json!({ "ok": true, "rel": "pages/Inbox (2).md" }));
        assert!(std::fs::read_to_string(v.join("pages/Inbox (2).md")).unwrap().ends_with("\n- TODO [[quick capture]] **09:15**: buy milk\n"));
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

    /// Build 37: words selected in another app ("Add to thinky") stay plain words: a page's text can't
    /// become a link, tag, property or block reference in the notes. Typed or shared words are as typed.
    #[test]
    fn selected_words_are_kept_as_plain_words() {
        let v = vault("plain", "{}");
        let words = "see [[Some Page]] and #tag, ((ref)) or key:: value";
        let r = capture(&args(&v, json!({ "text": words, "plain": true })), None);
        assert_eq!(r["ok"], true, "{r}");
        let rel = r["rel"].as_str().unwrap().to_string();
        let text = std::fs::read_to_string(v.join(&rel)).unwrap();
        assert!(!text.contains("[[Some Page]]") && !text.contains("#tag") && !text.contains("((ref))") && !text.contains("key::"), "{text}");
        assert!(text.replace('\u{200b}', "").contains(words), "the same words, made inert: {text}");
        // without "plain" (typed in the pop-up): as typed
        let r = capture(&args(&v, json!({ "text": "a [[Real Link]]" })), None);
        assert!(std::fs::read_to_string(v.join(r["rel"].as_str().unwrap())).unwrap().contains("[[Real Link]]"));
        let _ = std::fs::remove_dir_all(&v);
    }

    /// The review's claim 11b: selected words were made inert inline only (defuse), so their lines
    /// could still start notes, to-dos, properties, dates, drawers, blocks and code in the notes.
    /// Now each line is kept plain (clip::guard, as the Edge extension's highlights).
    #[test]
    fn selected_lines_stay_plain_lines() {
        let v = vault("guard", r#"{:quick-capture-options {:insert-today? true} :quick-capture-templates {:text "{text}"}}"#);
        let words = "TODO pay attacker\n- a new note\n\t- a child\n* star bullet\nkey:: value\nSCHEDULED: <2026-11-01 Sun>\nDEADLINE: <2026-11-02 Mon>\n:LOGBOOK:\nCLOCK: [2026-11-01]\n:END:\n#+BEGIN_QUOTE\n[:div {:class \"x\"}]\n```js\nalert(1)\n```\n\n\n\nlast words";
        let r = capture(&args(&v, json!({ "text": words, "plain": true })), None);
        assert_eq!(r, json!({ "ok": true, "rel": "journals/2026_10_28.md" }));
        let text = std::fs::read_to_string(v.join("journals/2026_10_28.md")).unwrap();
        let page = outline_core::parse_page(&text, &[]);
        assert_eq!(page.blocks.len(), 1, "one note, its lines kept inside it: {text:?}");
        let note = &page.blocks[0];
        assert!(outline_core::task::parse(&note.text).is_none(), "not a to-do: {:?}", note.text);
        assert!(note.props.is_empty() && page.props.is_empty(), "no properties: {:?} {:?}", note.props, page.props);
        for line in text.lines().skip(1) {
            let t = line.trim_start();
            for risky in ["- ", "* ", "key::", "SCHEDULED:", "DEADLINE:", ":LOGBOOK:", ":END:", "#+BEGIN", "[:div", "```"] {
                assert!(!t.starts_with(risky), "a line starts with {risky:?}: {line:?} in {text:?}");
            }
        }
        // the same words, one empty line at most between them
        assert!(text.replace('\u{200b}', "").contains("pay attacker") && text.contains("last words"), "{text:?}");
        assert!(!text.contains("\n\n\n"), "{text:?}");
        // typed words (not "plain") stay as typed: a to-do typed in the pop-up is a to-do
        let r = capture(&args(&v, json!({ "text": "TODO typed in the pop-up" })), None);
        assert_eq!(r["ok"], true, "{r}");
        assert!(std::fs::read_to_string(v.join("journals/2026_10_28.md")).unwrap().contains("\n- TODO typed in the pop-up"));
        let _ = std::fs::remove_dir_all(&v);
    }

    /// At most SELECTED_MAX characters in one selection (characters, not bytes: 20,000 "é" is fine).
    #[test]
    fn a_selection_has_a_length_cap() {
        let v = vault("cap", r#"{:quick-capture-options {:insert-today? true} :quick-capture-templates {:text "{text}"}}"#);
        let file = v.join("journals/2026_10_28.md");
        let r = capture(&args(&v, json!({ "text": "a".repeat(SELECTED_MAX + 1), "plain": true })), None);
        assert_eq!(r["ok"], false, "{r}");
        assert!(r["error"].as_str().unwrap().contains("20000"), "{r}");
        assert!(!file.exists(), "nothing written");
        let r = capture(&args(&v, json!({ "text": "é".repeat(SELECTED_MAX), "plain": true })), None);
        assert_eq!(r["ok"], true, "{r}");
        assert!(std::fs::read_to_string(&file).unwrap().contains(&"é".repeat(SELECTED_MAX)));
        // typed words have no such cap (he types them himself)
        let r = capture(&args(&v, json!({ "text": "b".repeat(SELECTED_MAX + 1) })), None);
        assert_eq!(r["ok"], true, "{r}");
        let _ = std::fs::remove_dir_all(&v);
    }

    /// "where" also says which word starts a to-do (the pop-up's to-do button): LATER with
    /// `:preferred-workflow :now`, else TODO.
    #[test]
    fn where_says_the_to_do_word() {
        let v = vault("todo-now", r#"{:preferred-workflow :now}"#);
        assert_eq!(capture(&args(&v, json!({ "cmd": "where" })), None)["todo"], "LATER");
        let _ = std::fs::remove_dir_all(&v);
        let v = vault("todo-todo", r#"{:preferred-workflow :todo}"#);
        assert_eq!(capture(&args(&v, json!({ "cmd": "where" })), None)["todo"], "TODO");
        let _ = std::fs::remove_dir_all(&v);
    }

    /// Audit finding 4: the to-do button's word, typed before the words, makes the note a to-do in
    /// any quick capture template (the word moved to the very start of the line, where a to-do needs it),
    /// as the Windows box's to-do flag does. Only the workflow's own word (TODO, or LATER with
    /// `:preferred-workflow :now`, the one "where" gives the pop-up) is moved; anything else is as typed.
    #[test]
    fn the_to_do_button_makes_a_to_do() {
        let journal = |v: &std::path::Path| std::fs::read_to_string(v.join("journals/2026_10_28.md")).unwrap();
        let v = vault("todo-button", r#"{:quick-capture-options {:insert-today? true}}"#);
        let add = |text: &str| capture(&args(&v, json!({ "text": text })), None);
        assert_eq!(add("TODO buy milk"), json!({ "ok": true, "rel": "journals/2026_10_28.md" }));
        assert_eq!(journal(&v), "- TODO [[quick capture]] **09:15**: buy milk\n");
        let parsed = outline_core::parse_page(&journal(&v), &[]);
        assert_eq!(outline_core::task::parse(&parsed.blocks[0].text).map(|t| t.marker), Some("TODO".to_string()), "a to-do the lists find");
        // spaces before or after the word, a tab after it; more lines stay the note's own
        add("  TODO \t water the plants");
        assert!(journal(&v).ends_with("- TODO [[quick capture]] **09:15**: water the plants\n"), "{}", journal(&v));
        add("TODO call Sam\nabout the trip");
        assert!(journal(&v).ends_with("- TODO [[quick capture]] **09:15**: call Sam\n  about the trip\n"), "{}", journal(&v));
        // not the to-do word: as typed (a word that only starts like it, lower case, another marker)
        add("TODOS for the week");
        assert!(journal(&v).ends_with("- [[quick capture]] **09:15**: TODOS for the week\n"), "{}", journal(&v));
        add("todo lower case");
        assert!(journal(&v).ends_with("- [[quick capture]] **09:15**: todo lower case\n"), "{}", journal(&v));
        add("DONE already done");
        assert!(journal(&v).ends_with("- [[quick capture]] **09:15**: DONE already done\n"), "{}", journal(&v));
        // the word alone (nothing after it): as typed, never an empty to-do
        add("TODO");
        assert!(journal(&v).ends_with("- [[quick capture]] **09:15**: TODO\n"), "{}", journal(&v));
        add("TODO   ");
        assert!(journal(&v).ends_with("- [[quick capture]] **09:15**: TODO\n"), "{}", journal(&v));
        // words selected in another app ("plain") are never made to-dos
        let r = capture(&args(&v, json!({ "text": "TODO from a web page", "plain": true })), None);
        assert_eq!(r["ok"], true, "{r}");
        let parsed = outline_core::parse_page(&journal(&v), &[]);
        assert!(outline_core::task::parse(&parsed.blocks.last().unwrap().text).is_none(), "{}", journal(&v));
        let _ = std::fs::remove_dir_all(&v);

        // :preferred-workflow :now: the button's word is LATER; TODO is then as typed
        let v = vault("todo-later", r#"{:preferred-workflow :now :quick-capture-options {:insert-today? true}}"#);
        let add = |text: &str| capture(&args(&v, json!({ "text": text })), None);
        add("LATER read the paper");
        assert_eq!(journal(&v), "- LATER [[quick capture]] **09:15**: read the paper\n");
        add("TODO not the workflow's word");
        assert!(journal(&v).ends_with("- [[quick capture]] **09:15**: TODO not the workflow's word\n"), "{}", journal(&v));
        let _ = std::fs::remove_dir_all(&v);

        // a "{text}" template: the same line as before (the word was already at the start)
        let v = vault("todo-bare", r#"{:quick-capture-options {:insert-today? true} :quick-capture-templates {:text "{text}"}}"#);
        capture(&args(&v, json!({ "text": "TODO just the words" })), None);
        assert_eq!(journal(&v), "- TODO just the words\n");
        let _ = std::fs::remove_dir_all(&v);

        // config.edn that can't be read: nothing added, as for any note
        let v = vault("todo-badcfg", "");
        std::fs::remove_file(v.join("logseq/config.edn")).unwrap();
        std::fs::create_dir(v.join("logseq/config.edn")).unwrap();
        let r = capture(&args(&v, json!({ "text": "TODO x" })), None);
        assert_eq!(r["ok"], false, "{r}");
        assert!(r["error"].as_str().unwrap().contains("config.edn"), "{r}");
        assert!(!v.join("journals/2026_10_28.md").exists());
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
    fn a_shared_page_s_kept_passages() {
        let v = vault("kept", "");
        std::fs::write(v.join("pages/Bread.md"), "source:: [Bread · KW](https://kw.org/bread)\n\n- [[October 28th, 2026]]\n\t- Dough **rises** slowly. [↗](https://kw.org/bread#:~:text=Dough)\n").unwrap();
        let r = capture(&args(&v, json!({ "cmd": "kept", "url": "https://www.kw.org/bread/?utm_source=x" })), None);
        assert_eq!(r, json!({ "ok": true, "page": "Bread", "highlights": [{ "plain": "Dough rises slowly.", "link": "https://kw.org/bread#:~:text=Dough" }] }));
        let r = capture(&args(&v, json!({ "cmd": "kept", "url": "https://kw.org/other" })), None);
        assert_eq!(r, json!({ "ok": true, "page": "", "highlights": [] }));
        let _ = std::fs::remove_dir_all(&v);
    }

    #[test]
    fn the_word_is_taken_off_only_when_it_stands_alone() {
        assert_eq!(after_word("TODO buy milk", "TODO"), Some("buy milk"));
        assert_eq!(after_word("  TODO\t \tbuy", "TODO"), Some("buy"));
        assert_eq!(after_word("TODO a\nb", "TODO"), Some("a\nb"));
        assert_eq!(after_word("LATER x", "LATER"), Some("x"));
        assert_eq!(after_word("LATER x", "TODO"), None);
        assert_eq!(after_word("TODOS x", "TODO"), None);
        assert_eq!(after_word("TODO", "TODO"), None);
        assert_eq!(after_word("TODO  \t ", "TODO"), None);
        assert_eq!(after_word("TODO\nnext line", "TODO"), None);
        assert_eq!(after_word("", "TODO"), None);
        assert_eq!(after_word("buy TODO milk", "TODO"), None);
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

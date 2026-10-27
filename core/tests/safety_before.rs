//! Safety copies keep a note's earlier text when it was changed or removed somewhere else
//! (core/src/app/safety.rs): at start-up from what the index cache still holds, and while open.
//! A test program of its own: the cache and data folders are set once per program.
use outline_core::app::{dispatch, set_cache_dir, set_data_dir, App};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

fn put(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

/// Make a file look last changed `days` ago (0: now).
fn age(root: &Path, rel: &str, days: f64) {
    let t = SystemTime::now() - Duration::from_secs_f64(days * 86_400.0);
    std::fs::File::options().write(true).open(root.join(rel)).unwrap().set_modified(t).unwrap();
}

/// The program's folder: its cache and data folders (emptied once: an earlier run with the same
/// process id may have left some for the same notes folders), and the notes folders of the tests.
fn base() -> &'static Path {
    static BASE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    BASE.get_or_init(|| {
        let b = std::env::temp_dir().join(format!("outline_before_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&b);
        b
    })
}

/// A fresh notes folder for one test.
fn setup(tag: &str) -> PathBuf {
    let base = base();
    set_cache_dir(base.join("cache"));
    set_data_dir(base.join("data"));
    let v = base.join(tag);
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}

fn open(v: &Path) -> Option<App> {
    let mut st = None;
    dispatch(&mut st, "open", json!({ "path": v.display().to_string() })).unwrap();
    st
}

fn call(st: &mut Option<App>, cmd: &str, args: Value) -> Value {
    dispatch(st, cmd, args).unwrap_or_else(|e| panic!("{cmd}: {e}"))
}

/// The copies, newest first, waiting for one made in the background.
fn copies(st: &mut Option<App>, at_least: usize) -> Vec<Value> {
    for _ in 0..100 {
        let c = call(st, "safety_copies", json!({}));
        if c.as_array().unwrap().len() >= at_least {
            return c.as_array().unwrap().clone();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("no safety copy made");
}

/// The index cache as the app last wrote it for this notes folder: each note's text.
fn cached(v: &Path) -> HashMap<String, String> {
    for e in std::fs::read_dir(base().join("cache")).unwrap().flatten() {
        let Ok(c) = serde_json::from_slice::<Value>(&std::fs::read(e.path()).unwrap_or_default()) else { continue };
        if c["root"] == json!(v.display().to_string()) {
            return c["files"].as_array().unwrap().iter().map(|f| (f[0].as_str().unwrap().to_string(), f[2].as_str().unwrap().to_string())).collect();
        }
    }
    HashMap::new()
}

/// This notes folder's safety copies folder (found by what its copies' lists say).
fn copies_folder(v: &Path) -> PathBuf {
    for e in std::fs::read_dir(base().join("data/safety-copies")).unwrap().flatten() {
        for c in std::fs::read_dir(e.path()).into_iter().flatten().flatten() {
            let list: Value = serde_json::from_slice(&std::fs::read(c.path().join("list.json")).unwrap_or_default()).unwrap_or_default();
            if list["root"] == json!(v.display().to_string()) {
                return e.path();
            }
        }
    }
    panic!("no copies for {}", v.display());
}

/// (path, an earlier text?, now) of each note in a copy.
fn notes(st: &mut Option<App>, id: &Value) -> Vec<(String, bool, String)> {
    let c = call(st, "safety_copy", json!({ "id": id }));
    c["notes"].as_array().unwrap().iter().map(|n| (n["path"].as_str().unwrap().into(), n["before"].as_u64().unwrap() > 0, n["now"].as_str().unwrap().into())).collect()
}

#[test]
fn a_note_changed_or_removed_while_the_app_was_closed_keeps_its_earlier_text() {
    let v = setup("closed");
    put(&v, "pages/Marta Pell.md", "- Notes on Wild Yeast\n");
    age(&v, "pages/Marta Pell.md", 30.0); // untouched for a month
    put(&v, "pages/Gone.md", "- removed elsewhere later\n");
    age(&v, "pages/Gone.md", 10.0);
    put(&v, "pages/Touched.md", "- same words\n");
    age(&v, "pages/Touched.md", 10.0);
    put(&v, "journals/2026_10_26.md", "- today\n");
    drop(App::open(&v).unwrap()); // the app runs once: the index cache holds every note's text
    // while the app is closed: a bad sync overwrites the old page, another goes, one is only touched
    put(&v, "pages/Marta Pell.md", "- oops\n");
    std::fs::remove_file(v.join("pages/Gone.md")).unwrap();
    age(&v, "pages/Touched.md", 0.0);
    let mut st = open(&v);
    // first, before "open" even returned: a copy of the two earlier texts alone; then, in the
    // background, the copy of the notes changed lately
    let early = call(&mut st, "safety_copies", json!({}));
    assert!(early.as_array().unwrap().iter().any(|c| c["notes"] == json!(0) && c["before"] == json!(2)), "{early:?}");
    let c = copies(&mut st, 2);
    assert_eq!(c.len(), 2, "{c:?}");
    assert_eq!((c[0]["notes"].as_u64(), c[0]["before"].as_u64(), c[1]["notes"].as_u64(), c[1]["before"].as_u64()), (Some(3), Some(0), Some(0), Some(2)), "{c:?}");
    let (id, earlier) = (c[0]["id"].clone(), c[1]["id"].clone());
    let row = |p: &str, b: bool, n: &str| (p.to_string(), b, n.to_string());
    let mut got = notes(&mut st, &id);
    got.sort();
    assert_eq!(got, vec![row("journals/2026_10_26.md", false, "same"), row("pages/Marta Pell.md", false, "same"), row("pages/Touched.md", false, "same")]);
    let mut got = notes(&mut st, &earlier);
    got.sort();
    assert_eq!(got, vec![row("pages/Gone.md", true, "gone"), row("pages/Marta Pell.md", true, "changed")]);
    // the text from before the overwrite (earlier texts are numbered in their copy), and the one after
    let view = call(&mut st, "safety_copy", json!({ "id": earlier }));
    let num = |p: &str| view["notes"].as_array().unwrap().iter().find(|n| n["path"] == json!(p) && n["before"].as_u64() > Some(0)).unwrap()["before"].as_u64().unwrap();
    let (hs, gone) = (num("pages/Marta Pell.md"), num("pages/Gone.md"));
    let n = call(&mut st, "safety_note", json!({ "id": earlier, "path": "pages/Marta Pell.md", "before": hs }));
    assert_eq!((n["text"].as_str(), n["before"].as_u64(), n["same"].as_bool()), (Some("- Notes on Wild Yeast\n"), Some(hs), Some(false)));
    let month_ago = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs() - 30 * 86_400;
    assert!(n["changed"].as_u64().unwrap().abs_diff(month_ago) < 60, "the earlier version's own time");
    assert_eq!(call(&mut st, "safety_note", json!({ "id": id, "path": "pages/Marta Pell.md" }))["text"], json!("- oops\n"));
    // putting it back: the overwritten text goes to logseq/bak first
    let r = call(&mut st, "safety_restore", json!({ "id": earlier, "path": "pages/Marta Pell.md", "before": hs }));
    assert_eq!(r["changed"], json!(true));
    assert_eq!(std::fs::read_to_string(v.join("pages/Marta Pell.md")).unwrap(), "- Notes on Wild Yeast\n");
    let bak: Vec<String> = std::fs::read_dir(v.join("logseq/bak/pages/Marta Pell")).unwrap().flatten().map(|e| std::fs::read_to_string(e.path()).unwrap()).collect();
    assert_eq!(bak, vec!["- oops\n"]);
    // the removed note is made again
    call(&mut st, "safety_restore", json!({ "id": earlier, "path": "pages/Gone.md", "before": gone }));
    assert_eq!(std::fs::read_to_string(v.join("pages/Gone.md")).unwrap(), "- removed elsewhere later\n");
    let mut got = notes(&mut st, &earlier);
    got.sort();
    assert_eq!((got[0].2.as_str(), got[1].2.as_str()), ("same", "same"), "both read like that again: {got:?}");
    // an earlier text is only what the list names, as before / not before
    assert!(dispatch(&mut st, "safety_note", json!({ "id": earlier, "path": "pages/Touched.md", "before": 1 })).is_err());
    assert!(dispatch(&mut st, "safety_note", json!({ "id": earlier, "path": "pages/Marta Pell.md", "before": gone })).is_err(), "another note's number");
    assert!(dispatch(&mut st, "safety_note", json!({ "id": earlier, "path": "pages/Gone.md" })).is_err());
    assert!(dispatch(&mut st, "safety_note", json!({ "id": id, "path": "pages/Gone.md", "before": gone })).is_err(), "not in the other copy");
    // put away and opened again: what the app wrote itself isn't "changed elsewhere"
    call(&mut st, "persist", json!({}));
    let mut st = open(&v);
    let c = copies(&mut st, 3);
    assert_eq!((c.len(), c[0]["notes"].as_u64(), c[0]["before"].as_u64()), (3, Some(4), Some(0)), "{c:?}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_note_changed_or_removed_elsewhere_while_the_app_is_open_keeps_its_earlier_text() {
    let v = setup("open");
    put(&v, "pages/Note.md", "- first version\n");
    age(&v, "pages/Note.md", 10.0);
    put(&v, "pages/Mine.md", "- written here\n");
    age(&v, "pages/Mine.md", 10.0);
    let mut st = open(&v);
    std::thread::sleep(Duration::from_millis(200));
    assert!(call(&mut st, "safety_copies", json!({})).as_array().unwrap().is_empty(), "nothing recent at start-up");
    // the phone changes the note; the app takes it in; put away, the app writes its index cache
    put(&v, "pages/Note.md", "- changed on the phone\n");
    call(&mut st, "rescan", json!({}));
    call(&mut st, "persist", json!({}));
    let c = copies(&mut st, 1);
    assert_eq!((c[0]["notes"].as_u64(), c[0]["before"].as_u64()), (Some(0), Some(1)));
    let n = call(&mut st, "safety_note", json!({ "id": c[0]["id"], "path": "pages/Note.md", "before": 1 }));
    assert_eq!(n["text"], json!("- first version\n"));
    // changed again (say at 9:00), then removed (at 15:00): each earlier text, in the next copy
    put(&v, "pages/Note.md", "- changed again\n");
    call(&mut st, "rescan", json!({}));
    std::fs::remove_file(v.join("pages/Note.md")).unwrap();
    call(&mut st, "rescan", json!({}));
    call(&mut st, "persist", json!({}));
    let c = copies(&mut st, 2);
    assert_eq!(c[0]["before"].as_u64(), Some(2));
    let mut texts: Vec<String> = (1..=2).map(|k| call(&mut st, "safety_note", json!({ "id": c[0]["id"], "path": "pages/Note.md", "before": k }))["text"].as_str().unwrap().to_string()).collect();
    texts.sort();
    assert_eq!(texts, vec!["- changed again\n", "- changed on the phone\n"]);
    assert_eq!(call(&mut st, "safety_note", json!({ "id": c[0]["id"], "path": "pages/Note.md", "before": 1 }))["exists"], json!(false));
    // the app's own saves are not "changed elsewhere": no copy for them
    let pv = call(&mut st, "page", json!({ "name": "Mine" }));
    let doc = json!({ "preamble": "", "blocks": [{ "depth": 0, "text": "edited here" }], "indent": "\t", "crlf": false });
    call(&mut st, "save", json!({ "name": "Mine", "doc": doc, "base_hash": pv["hash"], "base": pv["doc"] }));
    call(&mut st, "rescan", json!({}));
    call(&mut st, "persist", json!({}));
    assert_eq!(call(&mut st, "safety_copies", json!({})).as_array().unwrap().len(), 2);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_busy_day_keeps_every_earlier_text() {
    // twenty times in a day: a change made elsewhere (the laptop's edits reaching the phone, Claude…),
    // then the app is put away; each time a small copy of earlier texts: all of them stay
    let v = setup("busy");
    for i in 0..20 {
        put(&v, &format!("pages/P{i}.md"), &format!("- good text {i}\n"));
        age(&v, &format!("pages/P{i}.md"), 30.0);
    }
    let mut st = open(&v);
    for i in 0..20 {
        put(&v, &format!("pages/P{i}.md"), &format!("- changed elsewhere {i}\n"));
        call(&mut st, "rescan", json!({}));
        call(&mut st, "persist", json!({}));
    }
    let c = copies(&mut st, 20);
    assert_eq!(c.len(), 20);
    let mut kept = vec![];
    for x in &c {
        for (path, earlier, _) in notes(&mut st, &x["id"]) {
            if earlier {
                kept.push(path);
            }
        }
    }
    kept.sort();
    let mut want: Vec<String> = (0..20).map(|i| format!("pages/P{i}.md")).collect();
    want.sort();
    assert_eq!(kept, want);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn at_start_up_an_earlier_text_is_always_in_the_old_cache_or_in_a_copy() {
    let v = setup("order");
    put(&v, "pages/Note.md", "- the good text\n");
    age(&v, "pages/Note.md", 30.0);
    drop(App::open(&v).unwrap()); // the app ran once: its index cache holds the note's text
    assert_eq!(cached(&v)["pages/Note.md"], "- the good text\n");
    // while the app was closed, a sync overwrote it (keeping the other device's old file time)
    put(&v, "pages/Note.md", "- oops\n");
    age(&v, "pages/Note.md", 20.0);
    // reading the folder doesn't write the cache yet: until the earlier text is in a copy, the cache
    // is the only place that has it (stopped right here, nothing is lost)
    drop(App::open(&v).unwrap());
    assert_eq!(cached(&v)["pages/Note.md"], "- the good text\n");
    // the app's start: first the earlier text into a copy, before "open" returns; then the cache
    let mut st = open(&v);
    let c = call(&mut st, "safety_copies", json!({}));
    assert_eq!(c.as_array().unwrap().len(), 1, "nothing changed lately: only the earlier text's copy, {c:?}");
    assert_eq!((c[0]["notes"].as_u64(), c[0]["before"].as_u64()), (Some(0), Some(1)));
    assert_eq!(call(&mut st, "safety_note", json!({ "id": c[0]["id"], "path": "pages/Note.md", "before": 1 }))["text"], json!("- the good text\n"));
    assert_eq!(cached(&v)["pages/Note.md"], "- oops\n", "and then the cache");
    // changed elsewhere while open; the copy can't be made when the app is put away (here a file is
    // in the way of this folder's copies): the cache isn't written, so it still has the text that
    // change replaced; next time it works
    put(&v, "pages/Note.md", "- oops again\n");
    age(&v, "pages/Note.md", 10.0);
    call(&mut st, "rescan", json!({}));
    let folder = copies_folder(&v);
    let aside = folder.with_extension("aside");
    std::fs::rename(&folder, &aside).unwrap();
    std::fs::write(&folder, "in the way").unwrap();
    call(&mut st, "persist", json!({}));
    assert_eq!(cached(&v)["pages/Note.md"], "- oops\n");
    std::fs::remove_file(&folder).unwrap();
    std::fs::rename(&aside, &folder).unwrap();
    call(&mut st, "persist", json!({}));
    assert_eq!(cached(&v)["pages/Note.md"], "- oops again\n");
    let c = call(&mut st, "safety_copies", json!({}));
    assert_eq!(c.as_array().unwrap().len(), 2);
    assert_eq!(call(&mut st, "safety_note", json!({ "id": c[0]["id"], "path": "pages/Note.md", "before": 1 }))["text"], json!("- oops\n"));
    let _ = std::fs::remove_dir_all(&v);
}

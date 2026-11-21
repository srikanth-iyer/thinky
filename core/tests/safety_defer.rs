//! Review A2: saving never waits for a safety copy being made in the background. The earlier texts
//! that changes made elsewhere replaced are kept the next time instead (and the index cache, which
//! forgets them, isn't written until they are). A test program of its own: it holds the lock that
//! every safety copy in the program is made under.
use outline_core::app::safety::hold_safety_copies;
use outline_core::app::{dispatch, set_cache_dir, set_data_dir};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

fn put(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

fn age(root: &Path, rel: &str, days: f64) {
    let t = SystemTime::now() - Duration::from_secs_f64(days * 86_400.0);
    std::fs::File::options().write(true).open(root.join(rel)).unwrap().set_modified(t).unwrap();
}

fn base() -> PathBuf {
    std::env::temp_dir().join(format!("outline_defer_{}", std::process::id()))
}

fn cached(v: &Path) -> HashMap<String, String> {
    for e in std::fs::read_dir(base().join("cache")).unwrap().flatten() {
        let Ok(c) = serde_json::from_slice::<Value>(&std::fs::read(e.path()).unwrap_or_default()) else { continue };
        if c["root"] == json!(v.display().to_string()) {
            return c["files"].as_array().unwrap().iter().map(|f| (f[0].as_str().unwrap().to_string(), f[2].as_str().unwrap().to_string())).collect();
        }
    }
    HashMap::new()
}

fn call(st: &mut Option<outline_core::app::App>, cmd: &str, args: Value) -> Value {
    dispatch(st, cmd, args).unwrap_or_else(|e| panic!("{cmd}: {e}"))
}

fn before_copies(st: &mut Option<outline_core::app::App>) -> usize {
    call(st, "safety_copies", json!({})).as_array().unwrap().iter().filter(|c| c["before"].as_u64().unwrap_or(0) > 0).count()
}

#[test]
fn saving_never_waits_for_a_safety_copy_being_made() {
    let b = base();
    let _ = std::fs::remove_dir_all(&b);
    set_cache_dir(b.join("cache"));
    set_data_dir(b.join("data"));
    let v = b.join("notes");
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    put(&v, "pages/Note.md", "- first\n");
    age(&v, "pages/Note.md", 30.0);
    let mut st = None;
    call(&mut st, "open", json!({ "path": v.display().to_string() }));
    // (the copy made in the background when the folder opened is finished first)
    drop(hold_safety_copies());
    std::thread::sleep(Duration::from_millis(300));
    drop(hold_safety_copies());
    assert_eq!(cached(&v)["pages/Note.md"], "- first\n");
    let had = before_copies(&mut st);

    // changed elsewhere while open: its earlier text waits to go into a copy
    put(&v, "pages/Note.md", "- second, from the phone\n");
    age(&v, "pages/Note.md", 20.0);
    call(&mut st, "rescan", json!({}));
    // a long copy is being made in the background (the lock held): a save waits a second at most
    let held = hold_safety_copies();
    let t = Instant::now();
    call(&mut st, "persist", json!({}));
    assert!(t.elapsed() < Duration::from_millis(2500), "persist waited {:?}", t.elapsed());
    // nothing lost: the cache wasn't written, so it still has the earlier text, and no copy yet
    assert_eq!(cached(&v)["pages/Note.md"], "- first\n");
    // other commands go on meanwhile too
    let t = Instant::now();
    call(&mut st, "page", json!({ "name": "Note" }));
    call(&mut st, "persist", json!({}));
    assert!(t.elapsed() < Duration::from_millis(2500));
    drop(held);
    // the next time the cache is written, the earlier text goes into its copy first, then the cache
    call(&mut st, "persist", json!({}));
    assert_eq!(cached(&v)["pages/Note.md"], "- second, from the phone\n");
    assert_eq!(before_copies(&mut st), had + 1);
    let c = call(&mut st, "safety_copies", json!({}));
    let id = c.as_array().unwrap().iter().find(|c| c["before"].as_u64().unwrap_or(0) > 0).unwrap()["id"].clone();
    assert_eq!(call(&mut st, "safety_note", json!({ "id": id, "path": "pages/Note.md", "before": 1 }))["text"], json!("- first\n"));
    let _ = std::fs::remove_dir_all(&b);
}

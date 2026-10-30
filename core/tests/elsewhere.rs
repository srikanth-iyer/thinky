//! Changes made elsewhere at the worst moment (Logseq, Google Drive bringing the phone's version,
//! Claude's connector): every write of a note or of config.edn replaces exactly the bytes it read,
//! checked again right before it's written (`write_atomic_checked` with `Expect::Bytes`), so such a
//! change is never written over. And the settings (config.edn): never guessed when they can't be
//! read just now; read again when they change while the app is open.
use outline_core::app::{dispatch, set_write_hook, write_atomic_checked, App, Expect, CONFIG_REL};
use serde_json::{json, Value};
use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

fn vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_elsewhere_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}
fn put(v: &Path, rel: &str, text: &str) {
    std::fs::write(v.join(rel), text).unwrap();
}
fn get(v: &Path, rel: &str) -> String {
    std::fs::read_to_string(v.join(rel)).unwrap()
}

/// Another program saves `rel` (`text(n)`, n = 1, 2…) each time the app is about to replace it, the
/// first `times` times: right after the app read it and worked out its new text, before the write.
/// Returns how many times it did.
fn elsewhere(v: &Path, rel: &str, times: u32, text: impl Fn(u32) -> String + 'static) -> Rc<Cell<u32>> {
    let n = Rc::new(Cell::new(0));
    let (count, file) = (n.clone(), v.join(rel));
    set_write_hook(Some(Box::new(move |p: &Path| {
        if p == file && count.get() < times {
            count.set(count.get() + 1);
            std::fs::write(&file, text(count.get())).unwrap();
        }
    })));
    n
}
fn quiet() {
    set_write_hook(None);
}

fn save(app: App, name: &str, edit: impl FnOnce(&mut Value), force: bool) -> (App, Value) {
    let mut st = Some(app);
    let pv = dispatch(&mut st, "page", json!({ "name": name })).unwrap();
    let base = pv["doc"].clone();
    let mut doc = base.clone();
    edit(&mut doc);
    let res = dispatch(&mut st, "save", json!({ "name": name, "doc": doc, "base": base, "base_hash": pv["hash"], "path": pv["info"]["path"], "force": force })).unwrap();
    (st.unwrap(), res)
}
/// Note `k` says `text` (a new page's first note is made).
fn set_note(k: usize, text: &str) -> impl FnOnce(&mut Value) + '_ {
    move |d: &mut Value| {
        let blocks = d["blocks"].as_array_mut().unwrap();
        if blocks.len() <= k {
            blocks.push(json!({ "depth": 0, "text": "" }));
        }
        d["blocks"][k]["text"] = json!(text);
    }
}

#[test]
fn a_bare_check_matches_the_bytes_as_they_are_on_disk() {
    let v = vault("bytes");
    // a byte-order mark, CRLF, no final line break, an emoji in the name: compared byte for byte
    for (name, text) in [("Bom.md", "\u{feff}- one\r\n- two"), ("Ünïcode ✓ 🌱.md", "- a\n\t- b\n"), ("Empty.md", "")] {
        let p = v.join("pages").join(name);
        std::fs::write(&p, text).unwrap();
        assert!(write_atomic_checked(&p, "- new\n", Expect::Bytes(text.as_bytes())).unwrap(), "{name}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "- new\n");
        // what was read isn't there any more: nothing written
        assert!(!write_atomic_checked(&p, "- mine\n", Expect::Bytes(text.as_bytes())).unwrap() || text == "- new\n");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "- new\n", "{name}");
    }
    // no temp files left behind
    let left: Vec<String> = std::fs::read_dir(v.join("pages")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with('.')).collect();
    assert!(left.is_empty(), "{left:?}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn saves_of_every_file_shape_need_no_second_look() {
    // the check compares with exactly the bytes read: a file's byte-order mark, CRLF or missing
    // last line break must never look like a change made elsewhere (every save would clash)
    let v = vault("shapes");
    let files = [
        ("pages/Bom.md", "Bom", "\u{feff}- one\n- two", "\u{feff}- edited\n- two"),
        ("pages/Crlf.md", "Crlf", "- one\r\n\t- two\r\n", "- edited\r\n\t- two\r\n"),
        ("pages/Both.md", "Both", "\u{feff}title:: Both\r\n- one\r\n- two", "\u{feff}title:: Both\r\n- edited\r\n- two"),
        ("pages/Ünïcode ✓ 🌱.md", "Ünïcode ✓ 🌱", "- “curly” one\n- two\n", "- edited\n- two\n"),
        ("pages/Yaml.md", "Yaml", "---\ntags: x\n---\n- one\n- two", "---\ntags: x\n---\n- edited\n- two"),
        ("journals/2026_10_28.md", "Oct 28th, 2026", "- one\n- two\n", "- edited\n- two\n"),
    ];
    for (rel, _, text, _) in files {
        put(&v, rel, text);
    }
    let mut app = App::open(&v).unwrap();
    for (rel, name, _, want) in files {
        let (a, res) = save(app, name, set_note(0, "edited"), false);
        app = a;
        assert_eq!(res["ok"], json!(true), "{name}: {res}");
        assert_eq!(res["conflict"], json!(false), "{name}");
        assert_eq!(get(&v, rel), want, "{name}: every other byte as it was");
        // and again, from what the app read back
        let (a, res) = save(app, name, set_note(0, "edited twice"), false);
        app = a;
        assert_eq!(res["ok"], json!(true), "{name}: {res}");
        assert_eq!(get(&v, rel), want.replacen("edited", "edited twice", 1), "{name}");
    }
    // a new page (no file yet) and a new journal day
    let (app, res) = save(app, "Brand new ✓", set_note(0, "first words"), false);
    assert_eq!(res["ok"], json!(true), "{res}");
    assert_eq!(get(&v, "pages/Brand new ✓.md"), "- first words\n");
    let (_, res) = save(app, "Oct 29th, 2026", set_note(0, "tomorrow"), false);
    assert_eq!(res["ok"], json!(true), "{res}");
    assert_eq!(get(&v, "journals/2026_10_29.md"), "- tomorrow\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_save_never_writes_over_a_version_saved_meanwhile() {
    let v = vault("save");
    let orig = "\u{feff}- one\r\n- two\r\n- three";
    put(&v, "pages/Sync.md", orig);
    let app = App::open(&v).unwrap();

    // the phone's version arrives right between reading the file and writing it, changing another
    // note: read again and merged, both kept, the file's shape too
    let theirs = "\u{feff}- one\r\n- two (phone)\r\n- three";
    let n = elsewhere(&v, "pages/Sync.md", 1, move |_| theirs.into());
    let (app, res) = save(app, "Sync", set_note(0, "one (laptop)"), false);
    quiet();
    assert_eq!(n.get(), 1);
    assert_eq!(res["ok"], json!(true), "{res}");
    assert!(res["merged"].is_object(), "the editor is told what was merged in: {res}");
    assert_eq!(get(&v, "pages/Sync.md"), "\u{feff}- one (laptop)\r\n- two (phone)\r\n- three");
    // the app's index has the file as written
    assert!(app.vault.page_info("Sync").exists);

    // the same note changed there: a clash; the other version stays as it is
    put(&v, "pages/Sync.md", orig);
    let theirs = "\u{feff}- one (phone)\r\n- two\r\n- three";
    elsewhere(&v, "pages/Sync.md", 1, move |_| theirs.into());
    let (app, res) = save(app, "Sync", set_note(0, "one (laptop)"), false);
    quiet();
    assert_eq!(res["conflict"], json!(true), "{res}");
    assert_eq!(res["ok"], json!(false));
    assert_eq!(get(&v, "pages/Sync.md"), theirs, "not written over");
    assert_eq!(res["hash"], json!(outline_core::content_hash(theirs)), "the clash screen compares with that version");

    // saved elsewhere at every try: nothing written, a clash (the clash screen reads it again)
    put(&v, "pages/Sync.md", orig);
    let n = elsewhere(&v, "pages/Sync.md", 99, |k| format!("- one\n- two\n- three ({k})\n"));
    let (app, res) = save(app, "Sync", set_note(0, "one (laptop)"), false);
    quiet();
    assert_eq!(n.get(), 3, "three tries");
    assert_eq!(res["conflict"], json!(true), "{res}");
    assert_eq!(get(&v, "pages/Sync.md"), "- one\n- two\n- three (3)\n");

    // "Keep mine" (a forced save) still keeps every other version in logseq/bak first, the one that
    // arrived at the last moment too
    put(&v, "pages/Sync.md", orig);
    elsewhere(&v, "pages/Sync.md", 1, |_| "- the phone's, at the last moment\n".into());
    let (app, res) = save(app, "Sync", set_note(0, "mine"), true);
    quiet();
    assert_eq!(res["ok"], json!(true), "{res}");
    // (shaped like the file it replaced: that one had no byte-order mark and a last line break)
    assert_eq!(get(&v, "pages/Sync.md"), "- mine\r\n- two\r\n- three\r\n");
    let bak: Vec<String> = std::fs::read_dir(v.join("logseq/bak/pages/Sync")).unwrap().flatten().map(|e| std::fs::read_to_string(e.path()).unwrap()).collect();
    assert_eq!(bak, vec!["- the phone's, at the last moment\n".to_string()]);

    // Google Drive holds the file for a moment (here: it can't be read for 150 ms) and brings the
    // phone's version: waited for, then merged; never written over unseen
    put(&v, "pages/Sync.md", orig);
    let file = v.join("pages/Sync.md");
    set_write_hook(Some(Box::new(move |p: &Path| {
        if p == file && file.is_file() {
            std::fs::remove_file(&file).unwrap();
            std::fs::create_dir(&file).unwrap(); // (can't be read: not a file)
            let f = file.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                std::fs::remove_dir(&f).unwrap();
                std::fs::write(&f, "\u{feff}- one\r\n- two (phone)\r\n- three").unwrap();
            });
        }
    })));
    let (app, res) = save(app, "Sync", set_note(2, "three (laptop)"), false);
    quiet();
    assert_eq!(res["ok"], json!(true), "{res}");
    assert_eq!(get(&v, "pages/Sync.md"), "\u{feff}- one\r\n- two (phone)\r\n- three (laptop)");
    // ...and if it stays unreadable: nothing written, the save says why (it's tried again later)
    let file = v.join("pages/Sync.md");
    set_write_hook(Some(Box::new(move |p: &Path| {
        if p == file && file.is_file() {
            std::fs::remove_file(&file).unwrap();
            std::fs::create_dir(&file).unwrap();
        }
    })));
    let mut st = Some(app);
    let pv = dispatch(&mut st, "page", json!({ "name": "Sync" })).unwrap();
    let mut doc = pv["doc"].clone();
    doc["blocks"][0]["text"] = json!("lost?");
    let err = dispatch(&mut st, "save", json!({ "name": "Sync", "doc": doc, "base": pv["doc"], "base_hash": pv["hash"], "path": "pages/Sync.md" })).unwrap_err();
    quiet();
    assert!(err.contains("Couldn't read"), "{err}");
    assert!(v.join("pages/Sync.md").is_dir(), "not written over");
    std::fs::remove_dir(v.join("pages/Sync.md")).unwrap();
    let app = st.unwrap();

    // a new page whose file turns up meanwhile: a clash, as before (never written over)
    elsewhere(&v, "pages/Fresh.md", 1, |_| "- made on the phone\n".into());
    let (_, res) = save(app, "Fresh", set_note(0, "made here"), false);
    quiet();
    assert_eq!(res["conflict"], json!(true), "{res}");
    assert_eq!(get(&v, "pages/Fresh.md"), "- made on the phone\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn lists_and_quick_capture_change_the_version_saved_meanwhile() {
    let v = vault("block");
    put(&v, "pages/Todo.md", "- TODO a\r\n- TODO b\r\n- c");
    let mut app = App::open(&v).unwrap();
    // a to-do ticked in a list while the phone changes another note: both kept
    elsewhere(&v, "pages/Todo.md", 1, |_| "- TODO a\r\n- TODO b\r\n- c (phone)".into());
    let r = app.save_block("Todo", 0, "TODO a", "DONE a").unwrap();
    quiet();
    assert!(r.ok && !r.conflict);
    assert_eq!(get(&v, "pages/Todo.md"), "- DONE a\r\n- TODO b\r\n- c (phone)");
    // the note itself changed there: refused, theirs stays
    elsewhere(&v, "pages/Todo.md", 1, |_| "- DONE a\r\n- TODO b (phone)\r\n- c (phone)".into());
    let r = app.save_block("Todo", 1, "TODO b", "DONE b").unwrap();
    quiet();
    assert!(!r.ok && r.conflict);
    assert_eq!(get(&v, "pages/Todo.md"), "- DONE a\r\n- TODO b (phone)\r\n- c (phone)");
    // (adding to a journal: capture::append_note's checked write, tested in capture_box.rs)
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn renames_and_merges_change_links_in_the_version_saved_meanwhile() {
    let v = vault("rename");
    put(&v, "pages/Old.md", "- old page\n");
    put(&v, "pages/A.md", "- see [[Old]]\r\n- more");
    put(&v, "pages/B.md", "- also [[Old]]\n");
    let mut app = App::open(&v).unwrap();
    // A changes on the phone while its link is being renamed: the link renamed in that version
    elsewhere(&v, "pages/A.md", 1, |_| "- see [[Old]]\r\n- more\r\n- from the phone".into());
    let r = app.rename("Old", "New").unwrap();
    quiet();
    assert_eq!(get(&v, "pages/A.md"), "- see [[New]]\r\n- more\r\n- from the phone");
    assert_eq!(get(&v, "pages/B.md"), "- also [[New]]\n");
    assert_eq!((r.files_changed, r.skipped.len()), (2, 0));
    assert!(v.join("pages/New.md").exists());
    // B keeps changing while it's renamed again: left as it is and listed, the rest still done
    elsewhere(&v, "pages/B.md", 99, |k| format!("- also [[New]] ({k})\n"));
    let r = app.rename("New", "Newer").unwrap();
    quiet();
    assert_eq!(r.skipped, vec!["pages/B.md".to_string()]);
    assert_eq!(get(&v, "pages/B.md"), "- also [[New]] (3)\n");
    assert_eq!(get(&v, "pages/A.md"), "- see [[Newer]]\r\n- more\r\n- from the phone");
    assert!(v.join("pages/Newer.md").exists() && !v.join("pages/New.md").exists());
    // a page with the new name syncs in while the links change: never replaced by the renamed file
    let phone = v.join("pages/Newest.md");
    set_write_hook(Some(Box::new(move |p: &Path| {
        if p.ends_with("A.md") && !phone.exists() {
            std::fs::write(&phone, "- made on the phone\n").unwrap();
        }
    })));
    let err = app.rename("Newer", "Newest").err().expect("refused");
    quiet();
    assert!(err.contains("turned up"), "{err}");
    assert_eq!(get(&v, "pages/Newest.md"), "- made on the phone\n");
    assert_eq!(get(&v, "pages/Newer.md"), "- old page\n", "the page itself as it was");
    assert_eq!(get(&v, "pages/A.md"), "- see [[Newest]]\r\n- more\r\n- from the phone", "(the links did change: the message says so)");
    std::fs::remove_file(v.join("pages/Newest.md")).unwrap();
    put(&v, "pages/A.md", "- see [[Newer]]\r\n- more\r\n- from the phone");
    app.rescan();
    // the page's own file changes meanwhile: its title:: set in that version
    put(&v, "pages/Titled.md", "title:: Titled\n- x\n");
    app.rescan();
    elsewhere(&v, "pages/Titled.md", 1, |_| "title:: Titled\n- x\n- y (phone)\n".into());
    app.rename("Titled", "Titled two").unwrap();
    quiet();
    assert_eq!(get(&v, "pages/Titled two.md"), "title:: Titled two\n- x\n- y (phone)\n");

    // merge: A's link changes in the version saved meanwhile, and Undo puts back exactly that
    put(&v, "pages/Gone.md", "- gone's note\n");
    put(&v, "pages/C.md", "- [[Gone]] here\n");
    app.rescan();
    elsewhere(&v, "pages/C.md", 1, |_| "- [[Gone]] here\n- phone\n".into());
    let m = app.merge_pages("Gone", "Newer").unwrap();
    quiet();
    assert_eq!(get(&v, "pages/C.md"), "- [[Newer]] here\n- phone\n");
    assert_eq!((m.files_changed, m.skipped.len()), (1, 0));
    app.undo_merge(m.undo).unwrap();
    assert_eq!(get(&v, "pages/C.md"), "- [[Gone]] here\n- phone\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn settings_changes_take_turns_with_changes_made_elsewhere() {
    let v = vault("config");
    let cfg = ";; mine\r\n{:favorites [\"a\" \"b\"]\r\n :hidden []}\r\n";
    put(&v, CONFIG_REL, cfg);
    put(&v, "pages/a.md", "- a\n");
    put(&v, "pages/b.md", "- b\n");
    let mut app = App::open(&v).unwrap();
    // Logseq changes config.edn while a favourite is added: added to that version
    elsewhere(&v, CONFIG_REL, 1, |_| ";; mine\r\n{:favorites [\"a\" \"b\"]\r\n :hidden [\"x\"]}\r\n".into());
    assert_eq!(app.set_favorite("c", true).unwrap(), vec!["a", "b", "c"]);
    quiet();
    assert_eq!(get(&v, CONFIG_REL), ";; mine\r\n{:favorites [\"a\" \"b\" \"c\"]\r\n :hidden [\"x\"]}\r\n");
    // dragged into another order while it changes: the same
    elsewhere(&v, CONFIG_REL, 1, |_| ";; theirs\r\n{:favorites [\"a\" \"b\" \"c\"]\r\n :hidden [\"x\"]}\r\n".into());
    assert_eq!(app.reorder_favorites(&["c".into(), "a".into(), "b".into()]).unwrap(), vec!["c", "a", "b"]);
    quiet();
    assert_eq!(get(&v, CONFIG_REL), ";; theirs\r\n{:favorites [\"c\" \"a\" \"b\"]\r\n :hidden [\"x\"]}\r\n");
    // changing at every try: refused, and it says so; theirs stays
    elsewhere(&v, CONFIG_REL, 99, |k| format!("{{:favorites [\"c\"] :n {k}}}"));
    let err = app.set_capture("{text}", "{url}", true, "inbox").unwrap_err();
    quiet();
    assert!(err.contains("config.edn") && err.contains("Try again"), "{err}");
    assert_eq!(get(&v, CONFIG_REL), "{:favorites [\"c\"] :n 2}");
    // a favourite renamed with its page, while config.edn changes: in that version
    put(&v, CONFIG_REL, "{:favorites [\"a\" \"c\"]}\n");
    app.rescan();
    elsewhere(&v, CONFIG_REL, 1, |_| "{:favorites [\"a\" \"c\"] :hidden []}\n".into());
    app.rename("a", "aa").unwrap();
    quiet();
    assert_eq!(get(&v, CONFIG_REL), "{:favorites [\"aa\" \"c\"] :hidden []}\n");
    let _ = std::fs::remove_dir_all(&v);
}

// ---------------------------------------------------------------- the settings

const DAILY: &str = "{:journals-directory \"Diary\"\n :journal/page-title-format \"MMMM do, yyyy\"\n :favorites [\"Inbox\"]}\n";

fn daily_vault(tag: &str) -> PathBuf {
    let v = vault(tag);
    std::fs::create_dir_all(v.join("Diary")).unwrap();
    put(&v, "Diary/2026_10_27.md", "- yesterday's notes\n");
    put(&v, "Diary/2026_10_28.md", "- today's notes\n");
    put(&v, "pages/Inbox.md", "- inbox\n");
    v
}

#[test]
fn notes_never_open_with_guessed_settings() {
    let v = daily_vault("unreadable");
    // config.edn there but unreadable (here a folder; on Google Drive: not fetched just now)
    std::fs::create_dir_all(v.join(CONFIG_REL)).unwrap();
    let t = std::time::Instant::now();
    let err = App::open(&v).err().expect("refused");
    assert!(err.contains("logseq/config.edn") && err.contains("Try again"), "{err}");
    assert!(t.elapsed() >= std::time::Duration::from_millis(350), "tried again for about half a second first");
    assert!(App::open_read_only(&v).is_err());
    let mut st = None;
    assert!(dispatch(&mut st, "open", json!({ "path": v.display().to_string() })).is_err());
    assert!(st.is_none());
    assert!(!v.join("journals").read_dir().unwrap().any(|_| true), "nothing written");

    // readable again a moment later, while it's still trying: opened with the right settings
    let dir = v.join(CONFIG_REL);
    let fix = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        std::fs::remove_dir(&dir).unwrap();
        std::fs::write(&dir, DAILY).unwrap();
    });
    let app = App::open(&v).unwrap();
    fix.join().unwrap();
    assert_eq!(app.vault.config.journals_dir, "Diary");
    assert_eq!(app.journal_name((2026, 10, 28)), "October 28th, 2026");
    assert_eq!(app.journals((2026, 10, 28), 7, true).len(), 2);

    // half written (read while Logseq writes it): read again, never taken as Logseq's defaults
    put(&v, CONFIG_REL, "{:journals-directory \"Diary\"\n :journal/page-title-format \"MMMM do");
    let file = v.join(CONFIG_REL);
    let fix = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        std::fs::write(&file, DAILY).unwrap();
    });
    let app = App::open(&v).unwrap();
    fix.join().unwrap();
    assert_eq!(app.journal_name((2026, 10, 28)), "October 28th, 2026");
    // one that stays broken: Logseq's defaults, as before (a file that can't ever be read as EDN)
    put(&v, CONFIG_REL, "{:journals-directory \"Diary\"");
    assert_eq!(App::open(&v).unwrap().vault.config.journals_dir, "journals");
    // no config.edn at all: Logseq's defaults
    std::fs::remove_file(v.join(CONFIG_REL)).unwrap();
    assert_eq!(App::open(&v).unwrap().journal_name((2026, 10, 28)), "Oct 28th, 2026");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn settings_that_change_or_arrive_late_are_taken_in() {
    // Google Drive hadn't brought config.edn yet when the app opened: Logseq's defaults (journals/,
    // "Oct 28th, 2026"), so the Diary journals didn't show
    let v = daily_vault("late");
    let mut app = App::open(&v).unwrap();
    assert_eq!(app.journal_name((2026, 10, 28)), "Oct 28th, 2026");
    assert!(app.journals((2026, 10, 28), 7, false).is_empty());
    // it arrives: the next rescan takes it in, journals and all
    put(&v, CONFIG_REL, DAILY);
    let changed = app.rescan();
    assert!(changed.contains(&CONFIG_REL.to_string()), "{changed:?}");
    assert_eq!(app.journal_name((2026, 10, 28)), "October 28th, 2026");
    let days: Vec<String> = app.journals((2026, 10, 28), 7, true).into_iter().map(|d| d.name).collect();
    assert_eq!(days, vec!["October 28th, 2026", "October 27th, 2026"]);
    let today = app.vault.page_info("October 28th, 2026");
    assert!(today.exists && today.path.as_deref() == Some("Diary/2026_10_28.md"));
    // typing in today's journal now goes to its file in Diary
    let (mut app, res) = save(app, "October 28th, 2026", set_note(0, "today's notes, edited"), false);
    assert_eq!(res["ok"], json!(true), "{res}");
    assert_eq!(get(&v, "Diary/2026_10_28.md"), "- today's notes, edited\n");
    assert!(!v.join("journals/2026_10_28.md").exists());
    // nothing changed since: nothing reported
    assert!(app.rescan().is_empty());

    // changed in Logseq (a favourite added): taken in, no new reading of the notes needed
    put(&v, CONFIG_REL, &DAILY.replace("[\"Inbox\"]", "[\"Inbox\" \"Later\"]"));
    assert_eq!(app.rescan(), vec![CONFIG_REL.to_string()]);
    assert_eq!(app.vault.config.favorites, vec!["Inbox", "Later"]);
    // the app's own change of it: nothing new to take in
    app.set_favorite("Third", true).unwrap();
    assert!(app.rescan().is_empty());
    // half written, unreadable just now, or gone: the settings stay as they are...
    put(&v, CONFIG_REL, "{:journals-directory \"jour");
    assert!(app.rescan().is_empty());
    std::fs::remove_file(v.join(CONFIG_REL)).unwrap();
    std::fs::create_dir(v.join(CONFIG_REL)).unwrap();
    assert!(app.rescan().is_empty());
    std::fs::remove_dir(v.join(CONFIG_REL)).unwrap();
    assert!(app.rescan().is_empty());
    assert_eq!(app.journal_name((2026, 10, 28)), "October 28th, 2026");
    assert_eq!(app.vault.config.favorites, vec!["Inbox", "Later", "Third"]);
    // ...until it can be read whole
    put(&v, CONFIG_REL, &DAILY.replace("MMMM do, yyyy", "yyyy-MM-dd"));
    assert_eq!(app.rescan(), vec![CONFIG_REL.to_string()]);
    assert_eq!(app.journal_name((2026, 10, 28)), "2026-10-28");
    assert!(app.vault.page_info("2026-10-27").exists);
    let _ = std::fs::remove_dir_all(&v);
}

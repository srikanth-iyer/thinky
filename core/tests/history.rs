//! A page's earlier versions (core/src/app/history.rs): the backups in logseq/bak and the safety
//! copies, newest first, the current text and runs of the same text left out; putting one back
//! keeps the current text first, then the usual save (base_hash) merges or clashes.
//! A test program of its own: the data folder (safety copies) is set once per program.
use outline_core::app::{dispatch, set_data_dir, App, SaveReq};
use outline_core::split_doc;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// A fresh notes folder for one test, and the program's data folder (emptied once: an earlier run
/// with the same process id may have left copies).
fn setup(tag: &str) -> (PathBuf, PathBuf) {
    static BASE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    let base = BASE.get_or_init(|| {
        let b = std::env::temp_dir().join(format!("outline_history_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&b);
        b
    });
    set_data_dir(base.join("data"));
    let v = base.join(tag);
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    (v, base.join("data"))
}

fn put(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap()
}

/// Make a file look last changed at `secs` (seconds since 1970).
fn stamp(root: &Path, rel: &str, secs: u64) {
    std::fs::File::options().write(true).open(root.join(rel)).unwrap().set_modified(UNIX_EPOCH + Duration::from_secs(secs)).unwrap();
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

/// "2026-10-24T02_00_00" for a time (UTC), as both Logseq's and this app's backup names start.
fn utc(secs: u64, sep: char) -> String {
    let (y, m, d) = outline_core::date::civil_from_days((secs / 86_400) as i64);
    let t = secs % 86_400;
    format!("{y:04}-{m:02}-{d:02}{sep}{:02}_{:02}_{:02}", t / 3600, t / 60 % 60, t % 60)
}

/// A backup Logseq made at `secs` (dev: ".Desktop", ".android", ".ios" or "" for older Logseq).
fn logseq_bak(secs: u64, dev: &str) -> String {
    format!("{}.123Z{dev}.md", utc(secs, 'T'))
}

/// A backup this app made at `secs` (n > 1: the n-th within that second).
fn app_bak(secs: u64, n: u32) -> String {
    if n > 1 {
        format!("{}-{n}.md", utc(secs, '_'))
    } else {
        format!("{}.md", utc(secs, '_'))
    }
}

/// The list as (from, when, more, fewer, changed, props).
fn listed(app: &App, data: &Path, name: &str) -> Vec<(String, u64, usize, usize, usize, bool)> {
    app.history(Some(data), name, None).unwrap().into_iter().map(|v| (v.from.to_string(), v.when, v.more, v.fewer, v.changed, v.props)).collect()
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
    v.sort();
    v
}

#[test]
fn lists_backups_and_safety_copies_newest_first() {
    let (v, data) = setup("list");
    let t = now() - 60; // (a minute back: nothing is "in the future")
    let h = 3600;
    // the page as it was 5 hours ago (A), safety-copied 4 hours ago
    put(&v, "pages/Note.md", "- A\n");
    stamp(&v, "pages/Note.md", t - 5 * h);
    let mut app = App::open(&v).unwrap();
    let copy = app.safety_plan(t - 4 * h).run(&data).unwrap().expect("a copy");
    // then changed elsewhere twice (B, 3 hours ago; C, 2 hours ago): the texts they replaced go into a
    // copy of their own when the index is saved ("before" entries, dated by their own file times)
    put(&v, "pages/Note.md", "- B\n- second\n");
    stamp(&v, "pages/Note.md", t - 3 * h);
    app.rescan();
    let now_text = "- C\n- second\n- third\n";
    put(&v, "pages/Note.md", now_text);
    stamp(&v, "pages/Note.md", t - 2 * h);
    app.rescan();
    app.persist();
    // backups in logseq/bak/pages/Note
    let bak = "logseq/bak/pages/Note";
    put(&v, &format!("{bak}/{}", logseq_bak(t - 20 * 60, ".ios")), "tags:: x\n\n- C\n- second\n- third\n");
    put(&v, &format!("{bak}/{}", logseq_bak(t - 30 * 60, ".android")), "- C\n- second\n- third\n- from the phone\n");
    put(&v, &format!("{bak}/{}", logseq_bak(t - 40 * 60, ".Desktop")), "- C\n- second\n- third"); // no last line break
    put(&v, &format!("{bak}/{}", logseq_bak(t - 45 * 60, "")), now_text); // reads like the page now
    put(&v, &format!("{bak}/{}", app_bak(t - 90 * 60, 1)), "- B2\n- second\n");
    put(&v, &format!("{bak}/{}", app_bak(t - 90 * 60, 2)), "- B3\n- second\n"); // the same second, made after it
    put(&v, &format!("{bak}/notes.md"), "- old notes\n"); // another name: its file time
    stamp(&v, &format!("{bak}/notes.md"), t - 10 * h);
    // never read: a hidden file, a folder, something not .md, not UTF-8, another page's backups
    put(&v, &format!("{bak}/.{}.123-4.tmp", logseq_bak(t, "")), "- half written\n");
    put(&v, &format!("{bak}/sub/{}", app_bak(t, 1)), "- in a folder\n");
    put(&v, &format!("{bak}/{}.txt", utc(t, '_')), "- not a note\n");
    std::fs::write(v.join(bak).join(app_bak(t - 60, 1)), b"- \xff\n").unwrap();
    put(&v, &format!("logseq/bak/pages/Other/{}", app_bak(t - 60, 1)), "- another page\n");
    put(&v, &format!("logseq/bak/pages/Note.md/{}", app_bak(t - 60, 1)), "- a folder named like the file\n");

    let list = listed(&app, &data, "Note");
    let at = |s: u64| s; // (when, in seconds)
    let want: Vec<(&str, u64, usize, usize, usize, bool)> = vec![
        ("logseq-phone", at(t - 20 * 60), 0, 0, 0, true), // only the page properties differ
        ("logseq-phone", at(t - 30 * 60), 1, 0, 0, false), // one more note
        ("logseq-computer", at(t - 40 * 60), 0, 0, 0, false), // only spacing differs
        // (Logseq, 45 minutes ago: reads like the page now, not listed)
        ("app", at(t - 90 * 60), 0, 1, 1, false), // "-2": made after the other one in that second
        ("app", at(t - 90 * 60), 0, 1, 1, false),
        ("before", t - 3 * h, 0, 1, 1, false), // B, from before a change made elsewhere
        ("copy", t - 4 * h, 0, 2, 1, false), // A as copied; its earlier text (A, 5 hours ago) is the same: once
        ("bak", t - 10 * h, 0, 2, 1, false),
    ];
    let got: Vec<(&str, u64, usize, usize, usize, bool)> = list.iter().map(|x| (x.0.as_str(), x.1, x.2, x.3, x.4, x.5)).collect();
    assert_eq!(got, want);
    // the names say which is which; the two app backups of the same second, newest ("-2") first
    let ids: Vec<String> = app.history(Some(&data), "Note", None).unwrap().into_iter().map(|v| v.id).collect();
    assert_eq!(ids[3], format!("bak:{}", app_bak(t - 90 * 60, 2)));
    assert_eq!(ids[4], format!("bak:{}", app_bak(t - 90 * 60, 1)));
    assert_eq!(ids[6], format!("copy:{copy}:0"));
    assert!(ids[5].starts_with("copy:") && !ids[5].ends_with(":0"), "{ids:?}");
    // without the data folder (no safety copies kept here): the backups alone
    assert_eq!(app.history(None, "Note", None).unwrap().len(), 6);
    // a run of the same text shows once, the newest: two backups and a copy of A in a row
    put(&v, &format!("{bak}/{}", app_bak(t - 4 * h + 30, 1)), "- A\n");
    put(&v, &format!("{bak}/{}", logseq_bak(t - 4 * h - 30, ".Desktop")), "- A\n");
    let list = listed(&app, &data, "Note");
    assert_eq!(list.iter().filter(|x| (x.2, x.3, x.4) == (0, 2, 1) && x.1 != t - 10 * h).count(), 1, "{list:?}");
    assert!(list.iter().any(|x| x.0 == "app" && x.1 == t - 4 * h + 30), "{list:?}");
    // but the same text again after another one is listed again (the page went back to it)
    put(&v, &format!("{bak}/{}", app_bak(t - 100 * 60, 1)), "- C\n- second\n- third\n- from the phone\n");
    let list = listed(&app, &data, "Note");
    assert_eq!(list.iter().filter(|x| (x.2, x.3, x.4, x.5) == (1, 0, 0, false)).count(), 2, "{list:?}");
    // nothing in the notes folder changed
    assert_eq!(read(&v, "pages/Note.md"), now_text);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn one_version_drawn_like_a_page_and_bad_names_refused() {
    let (v, data) = setup("names");
    let t = now() - 60;
    put(&v, "pages/Note.md", "- now\n");
    put(&v, "pages/Other.md", "- other page\n");
    let base = v.parent().unwrap().to_path_buf();
    put(&base, "secret.md", "- outside the notes folder\n");
    let good = logseq_bak(t - 600, ".android");
    put(&v, &format!("logseq/bak/pages/Note/{good}"), "tags:: idea, [[Reading]]\n\n- then\n\t- a child\n");
    let other = app_bak(t - 600, 1);
    put(&v, &format!("logseq/bak/pages/Other/{other}"), "- other page, earlier\n");
    put(&v, &format!("logseq/bak/pages/Note/.{good}"), "- hidden\n");
    let mut state = Some(App::open(&v).unwrap());
    let app = state.as_ref().unwrap();
    let ok = app.history_version(None, "Note", Some("pages/Note.md"), &format!("bak:{good}")).unwrap();
    assert_eq!((ok.from, ok.when, ok.same), ("logseq-phone", t - 600, false));
    assert_eq!(ok.doc.blocks.iter().map(|b| (b.depth, b.text.as_str())).collect::<Vec<_>>(), vec![(0, "then"), (1, "a child")]);
    assert_eq!(ok.props, vec![("tags".to_string(), "idea, [[Reading]]".to_string())], "read as a page's are");
    // the page as it is now opened on another file: refused
    assert!(app.history(None, "Note", Some("pages/Other.md")).is_err());
    assert!(app.history_version(None, "Note", Some("pages/Other.md"), &format!("bak:{good}")).is_err());
    let copy = app.safety_plan(t).run(&data).unwrap().expect("a copy");
    let bad = [
        String::new(),
        "bak:".into(),
        "bak:../../secret.md".into(),
        "bak:../../../secret.md".into(),
        format!("bak:../Other/{other}"),
        format!("bak:{other}"), // another page's backup
        format!("bak:.{good}"),
        format!("bak:{good} "),
        format!("bak:sub/{good}"),
        format!("bak:{}", base.join("secret.md").display()),
        good.clone(),
        format!("copy:{copy}"),
        format!("copy:{copy}:1"), // no such earlier text
        format!("copy:{copy}/../..:0"),
        "copy:..:0".into(),
        format!("copy:{copy}:0 "),
    ];
    for id in &bad {
        for cmd in ["history_version", "history_keep"] {
            assert!(dispatch(&mut state, cmd, json!({ "name": "Note", "id": id })).is_err(), "{cmd} {id:?}");
        }
    }
    // the copy holds the page as it is now: not listed, but it can be named (it's in the copy's list)
    let r = dispatch(&mut state, "history_version", json!({ "name": "Note", "id": format!("copy:{copy}:0") })).unwrap();
    assert_eq!(r["same"], json!(true));
    // nothing was written anywhere
    assert_eq!(read(&v, "pages/Note.md"), "- now\n");
    assert_eq!(read(&base, "secret.md"), "- outside the notes folder\n");
    assert_eq!(files_in(&v.join("logseq/bak/pages/Note")), vec![format!(".{good}"), good.clone()]);
    // and the command that lists them
    let l = dispatch(&mut state, "history", json!({ "name": "Note", "path": "pages/Note.md" })).unwrap();
    assert_eq!(l.as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap().to_string()).collect::<Vec<_>>(), vec![format!("bak:{good}")]);
    assert_eq!(l[0]["from"], json!("logseq-phone"));
    assert_eq!((l[0]["more"].clone(), l[0]["fewer"].clone(), l[0]["changed"].clone(), l[0]["props"].clone()), (json!(1), json!(0), json!(1), json!(true)));
    let _ = std::fs::remove_dir_all(&v);
}

#[cfg(unix)]
#[test]
fn links_in_a_backup_folder_are_never_followed() {
    let (v, _) = setup("links");
    put(&v, "pages/Note.md", "- now\n");
    let base = v.parent().unwrap().to_path_buf();
    put(&base, "elsewhere.md", "- a file outside the notes folder\n");
    std::fs::create_dir_all(v.join("logseq/bak/pages/Note")).unwrap();
    let name = app_bak(now() - 600, 1);
    std::os::unix::fs::symlink(base.join("elsewhere.md"), v.join("logseq/bak/pages/Note").join(&name)).unwrap();
    // a page's whole backup folder a link to a folder outside the notes folder: not read
    let other = app_bak(now() - 900, 1);
    put(&base, &format!("other-bak/{other}"), "- in another folder\n");
    put(&v, "pages/Linked.md", "- now\n");
    std::os::unix::fs::symlink(base.join("other-bak"), v.join("logseq/bak/pages/Linked")).unwrap();
    // (one to a folder inside the notes folder is read like any)
    put(&v, &format!("logseq/bak/pages/Real/{other}"), "- a real backup\n");
    put(&v, "pages/Also.md", "- now\n");
    std::os::unix::fs::symlink(v.join("logseq/bak/pages/Real"), v.join("logseq/bak/pages/Also")).unwrap();
    let mut state = Some(App::open(&v).unwrap());
    let app = state.as_ref().unwrap();
    assert!(app.history(None, "Note", None).unwrap().is_empty(), "a link isn't a backup");
    assert!(app.history(None, "Linked", None).unwrap().is_empty(), "a folder outside the notes folder isn't read");
    assert_eq!(app.history(None, "Also", None).unwrap().len(), 1);
    for (page, id) in [("Note", format!("bak:{name}")), ("Linked", format!("bak:{other}"))] {
        for cmd in ["history_version", "history_keep"] {
            assert!(dispatch(&mut state, cmd, json!({ "name": page, "id": id })).is_err(), "{cmd} {page}");
        }
    }
    assert_eq!(read(&base, "elsewhere.md"), "- a file outside the notes folder\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn putting_back_keeps_the_current_text_first_then_saves_as_usual() {
    let (v, data) = setup("keep");
    let t = now() - 60;
    let rel = "pages/Note.md";
    let old = "- one\n- TWO, as it was\n- three\n";
    put(&v, rel, "- one\n- two\n- three\n");
    put(&v, &format!("logseq/bak/pages/Note/{}", logseq_bak(t - 3600, ".Desktop")), old);
    let mut app = App::open(&v).unwrap();
    let id = app.history(None, "Note", Some(rel)).unwrap()[0].id.clone();
    let bak_dir = v.join("logseq/bak/pages/Note");

    // what the editor shows: the page as read
    let read_page = |app: &App| {
        let pv = app.page("Note", None);
        (pv.hash, pv.doc)
    };
    let save = |app: &mut App, doc, hash: &str, base| app.save(SaveReq { name: "Note".into(), doc, base_hash: hash.into(), force: false, path: Some(rel.into()), base: Some(base) }).unwrap();

    // 1. nothing changed meanwhile: the current text is kept, then the version is written
    let (hash, base) = read_page(&app);
    let k = app.history_keep(None, "Note", Some(rel), &id).unwrap();
    let kept = k.bak.clone().expect("kept");
    assert!(!k.same && kept.starts_with("logseq/bak/pages/Note/") && kept.ends_with(".md"), "{kept}");
    assert_eq!(read(&v, &kept), "- one\n- two\n- three\n", "the page's text as it was, kept first");
    assert_eq!(read(&v, rel), "- one\n- two\n- three\n", "nothing written to the page yet");
    let r = save(&mut app, k.doc, &hash, base);
    assert!(r.ok && !r.conflict && r.merged.is_none());
    assert_eq!(read(&v, rel), old, "the version, exactly");
    // the kept text is listed now (this app's backup), the version itself isn't (it's the page now)
    let l = app.history(None, "Note", Some(rel)).unwrap();
    assert_eq!(l.iter().map(|x| (x.from, x.id == id)).collect::<Vec<_>>(), vec![("app", false)]);
    // again: it reads like that already, nothing kept
    let n = files_in(&bak_dir).len();
    let again = app.history_keep(None, "Note", Some(rel), &id).unwrap();
    assert!(again.same && again.bak.is_none());
    assert_eq!(files_in(&bak_dir).len(), n);

    // 2. changed elsewhere meanwhile, in another note: merged (the change elsewhere stays)
    put(&v, rel, "- one\n- two\n- three\n");
    app.rescan();
    let (hash, base) = read_page(&app);
    put(&v, rel, "- one\n- two\n- three\n- added on the phone\n"); // (not taken in yet)
    let k = app.history_keep(None, "Note", Some(rel), &id).unwrap();
    assert_eq!(read(&v, &k.bak.unwrap()), "- one\n- two\n- three\n- added on the phone\n", "the text on disk is what's kept");
    let r = save(&mut app, k.doc, &hash, base);
    assert!(r.ok && r.merged.is_some());
    assert_eq!(read(&v, rel), "- one\n- TWO, as it was\n- three\n- added on the phone\n");

    // 3. changed elsewhere meanwhile, in the same note: a clash (the clash screen asks); nothing written
    put(&v, rel, "- one\n- two\n- three\n");
    app.rescan();
    let (hash, base) = read_page(&app);
    put(&v, rel, "- one\n- two, changed on the phone\n- three\n");
    let k = app.history_keep(None, "Note", Some(rel), &id).unwrap();
    let r = save(&mut app, k.doc, &hash, base);
    assert!(!r.ok && r.conflict);
    assert_eq!(read(&v, rel), "- one\n- two, changed on the phone\n- three\n", "never written over silently");
    assert_eq!(read(&v, &k.bak.unwrap()), "- one\n- two, changed on the phone\n- three\n", "and that text was kept anyway");

    // 4. a file that isn't plain text: refused, nothing kept or changed
    std::fs::write(v.join(rel), b"- \xff\n").unwrap();
    let n = files_in(&bak_dir).len();
    let e = app.history_keep(None, "Note", Some(rel), &id).unwrap_err();
    assert!(e.contains("isn't plain UTF-8"), "{e}");
    assert_eq!(std::fs::read(v.join(rel)).unwrap(), b"- \xff\n");
    assert_eq!(files_in(&bak_dir).len(), n);
    // (it's still listed, compared with the file as read)
    assert_eq!(app.history(None, "Note", Some(rel)).unwrap().iter().filter(|x| x.id == id).count(), 1);

    // 5. a backup that can't be made: refused, nothing written (a version from a safety copy, so it's
    // still found while logseq/bak is a file)
    put(&v, rel, old);
    app.rescan();
    let copy = app.safety_plan(now()).run(&data).unwrap().expect("a copy");
    let from_copy = format!("copy:{copy}:0");
    put(&v, rel, "- changed again\n");
    app.rescan();
    let moved = v.join("logseq/bak-moved");
    std::fs::rename(v.join("logseq/bak"), &moved).unwrap();
    put(&v, "logseq/bak", "a file where the backup folder should be");
    let e = app.history_keep(Some(&data), "Note", Some(rel), &from_copy).unwrap_err();
    assert!(e.contains("Couldn't keep a backup copy"), "{e}");
    assert_eq!(read(&v, rel), "- changed again\n");
    std::fs::remove_file(v.join("logseq/bak")).unwrap();
    std::fs::rename(&moved, v.join("logseq/bak")).unwrap();

    // 6. the page's file is gone: nothing to keep; saving makes it again
    std::fs::remove_file(v.join(rel)).unwrap();
    app.rescan();
    let k = app.history_keep(None, "Note", Some(rel), &id).unwrap();
    assert!(k.bak.is_none() && !k.same);
    let r = save(&mut app, k.doc, "", split_doc(""));
    assert!(r.ok);
    assert_eq!(read(&v, rel), old);
    assert!(app.vault.page_info("Note").exists);
    // nothing was ever deleted from the backup folder
    assert!(files_in(&bak_dir).len() >= 4, "{:?}", files_in(&bak_dir));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_journal_day_and_a_page_in_a_folder() {
    let (v, _) = setup("folders");
    let t = now() - 60;
    put(&v, "journals/2026_10_24.md", "- today's notes\n");
    put(&v, &format!("logseq/bak/journals/2026_10_24/{}", logseq_bak(t - 600, ".android")), "- this morning\n");
    put(&v, "pages/sub.md", "- the page sub\n");
    put(&v, "pages/sub/Deep.md", "- a page in a folder\n");
    put(&v, &format!("logseq/bak/pages/sub/{}", app_bak(t - 600, 1)), "- sub, earlier\n");
    put(&v, &format!("logseq/bak/pages/sub/Deep/{}", app_bak(t - 900, 1)), "- deep, earlier\n");
    let app = App::open(&v).unwrap();
    let day = app.journal_name((2026, 10, 24));
    let l = app.history(None, &day, None).unwrap();
    assert_eq!(l.iter().map(|x| (x.from, x.when)).collect::<Vec<_>>(), vec![("logseq-phone", t - 600)]);
    let text = |name: &str, id: &str| app.history_version(None, name, None, id).unwrap().doc.blocks[0].text.clone();
    let sub = app.history(None, "sub", None).unwrap();
    assert_eq!(sub.len(), 1, "only the files right in its folder");
    assert_eq!(text("sub", &sub[0].id), "sub, earlier");
    let deep_name = app.vault.title_from_path("pages/sub/Deep.md").0;
    let deep = app.history(None, &deep_name, None).unwrap();
    assert_eq!(deep.len(), 1);
    assert_eq!(text(&deep_name, &deep[0].id), "deep, earlier");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn backup_names_say_when_and_who() {
    let (v, _) = setup("names2");
    put(&v, "pages/Note.md", "- now\n");
    let dir = "logseq/bak/pages/Note";
    let t = outline_core::date::days_from_civil((2025, 10, 26)) as u64 * 86_400 + 2 * 3600; // 02:00 UTC
    let cases = [
        ("2025-10-26T02_00_00.123Z.Desktop.md", "logseq-computer", t),
        ("2025-10-26T02_00_01.000Z.android.md", "logseq-phone", t + 1),
        ("2025-10-26T02_00_02.5Z.ios.md", "logseq-phone", t + 2),
        ("2025-10-26T02_00_03.000Z.md", "logseq", t + 3),
        ("2025-10-26T02_00_04Z.web.md", "logseq", t + 4),
        ("2025-10-26_02_00_05.md", "app", t + 5),
        ("2025-10-26_02_00_06-12.md", "app", t + 6),
    ];
    for (k, (name, _, _)) in cases.iter().enumerate() {
        put(&v, &format!("{dir}/{name}"), &format!("- version {k}\n"));
    }
    // names that only look like them: their own file time
    let odd = ["2025-13-26_02_00_07.md", "2025-10-26_25_00_08.md", "2025-10-26_02_00_09-1.md", "2025-10-26X02_00_10.md", "2025-10-26T02_00_11.000.Desktop.md"];
    for (k, name) in odd.iter().enumerate() {
        put(&v, &format!("{dir}/{name}"), &format!("- odd {k}\n"));
        stamp(&v, &format!("{dir}/{name}"), 1_000_000 + k as u64);
    }
    let app = App::open(&v).unwrap();
    let l = app.history(None, "Note", None).unwrap();
    for (name, from, when) in cases {
        let x = l.iter().find(|x| x.id == format!("bak:{name}")).unwrap_or_else(|| panic!("{name}"));
        assert_eq!((x.from, x.when), (from, when), "{name}");
    }
    for (k, name) in odd.iter().enumerate() {
        let x = l.iter().find(|x| x.id == format!("bak:{name}")).unwrap_or_else(|| panic!("{name}"));
        assert_eq!((x.from, x.when), ("bak", 1_000_000 + k as u64), "{name}");
    }
    // newest first
    let whens: Vec<u64> = l.iter().map(|x| x.when).collect();
    let mut sorted = whens.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(whens, sorted);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn the_command_names_are_the_only_way_in() {
    // the dispatch commands need a folder open, and say what's wrong in words
    let mut none = None;
    assert!(dispatch(&mut none, "history", json!({ "name": "Note" })).is_err());
    let (v, _) = setup("cmds");
    put(&v, "pages/Note.md", "- now\n");
    let mut state = Some(App::open(&v).unwrap());
    let l: Value = dispatch(&mut state, "history", json!({ "name": "Note" })).unwrap();
    assert_eq!(l, json!([]), "no versions yet");
    let e = dispatch(&mut state, "history_keep", json!({ "name": "Note", "id": "bak:nothing.md" })).unwrap_err();
    assert!(e.contains("isn’t in this page’s history"), "{e}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn many_versions_the_newest_hundred() {
    let (v, _) = setup("many");
    put(&v, "pages/Note.md", "- now\n");
    let t = now() - 60;
    for k in 0..130u64 {
        put(&v, &format!("logseq/bak/pages/Note/{}", app_bak(t - 1000 + k, 1)), &format!("- version {k}\n"));
    }
    let app = App::open(&v).unwrap();
    let l = app.history(None, "Note", None).unwrap();
    assert_eq!(l.len(), 100);
    assert_eq!((l[0].when, l[99].when), (t - 1000 + 129, t - 1000 + 30));
    // an older one isn't named by the list, so it can't be opened
    assert!(app.history_version(None, "Note", None, &format!("bak:{}", app_bak(t - 1000, 1))).is_err());
    let _ = std::fs::remove_dir_all(&v);
}

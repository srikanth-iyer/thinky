//! Safety copies of recently changed notes, and putting a note back (core/src/app/safety.rs).
//! They live in the notes folder, `logseq/.safety-<device>/<id>.copy` (one file per copy), each
//! device in its own folder; a notes folder that can't be written keeps them in the data folder.
use outline_core::app::{check_vault, data_dir, dispatch, set_data_dir, App};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn tmp(tag: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("outline_safety_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    for d in ["vault/pages", "vault/journals", "vault/logseq", "data"] {
        std::fs::create_dir_all(base.join(d)).unwrap();
    }
    base
}

fn put(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

/// Make a file look last changed `days` ago.
fn age(root: &Path, rel: &str, days: f64) {
    let t = SystemTime::now() - Duration::from_secs_f64(days * 86_400.0);
    std::fs::File::options().write(true).open(root.join(rel)).unwrap().set_modified(t).unwrap();
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

/// This device's (data folder's) name for its copies' folder.
fn device(data: &Path) -> String {
    std::fs::read_to_string(data.join("safety-device.txt")).unwrap().trim().to_string()
}

/// The copies' folder of the device whose data folder is `data`, in notes folder `v`.
fn copies_dir(v: &Path, data: &Path) -> PathBuf {
    v.join("logseq").join(format!(".safety-{}", device(data)))
}

/// A copy's file, from its id ("<device>/<stamp>").
fn copy_file(v: &Path, id: &str) -> PathBuf {
    let (dev, stamp) = id.split_once('/').unwrap();
    v.join("logseq").join(format!(".safety-{dev}")).join(format!("{stamp}.copy"))
}

/// Name the device of data folder `data` (before it makes any copy).
fn name_device(data: &Path, name: &str) {
    std::fs::create_dir_all(data).unwrap();
    std::fs::write(data.join("safety-device.txt"), name).unwrap();
}

/// The names in a folder, sorted.
fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}

fn ids(app: &App, data: &Path) -> Vec<String> {
    app.safety_copies(data).into_iter().map(|c| c.id).collect()
}

/// (notes, earlier texts) a copy holds.
fn shape(app: &App, data: &Path, id: &str) -> (usize, usize) {
    let v = app.safety_copy(data, id).unwrap();
    (v.notes.iter().filter(|n| n.before == 0).count(), v.notes.iter().filter(|n| n.before > 0).count())
}

/// The folder for an older version's copies of notes folder `v` (one folder per copy).
fn old_local(data: &Path, v: &Path) -> PathBuf {
    data.join("safety-copies").join(format!("vault-{}", outline_core::content_hash(&v.display().to_string())))
}

#[test]
fn copies_only_notes_changed_in_the_last_3_days() {
    let base = tmp("recent");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/Old.md", "- written last week\n");
    age(&v, "pages/Old.md", 5.0);
    put(&v, "pages/Edge.md", "- just over 3 days ago\n");
    age(&v, "pages/Edge.md", 3.05);
    put(&v, "journals/2026_10_24.md", "- two days ago\r\n- CRLF kept\r\n");
    age(&v, "journals/2026_10_24.md", 2.0);
    put(&v, "pages/New.md", "\u{feff}- an hour ago, with a BOM, no final newline");
    age(&v, "pages/New.md", 0.04);
    std::fs::write(v.join("pages/Bytes.md"), b"- not UTF-8 \xff\n").unwrap();
    put(&v, "assets/x.png.md", "- not in pages or journals: not a note the index reads\n");
    let app = App::open(&v).unwrap();
    let plan = app.safety_plan(now());
    assert_eq!(plan.paths(), vec!["pages/New.md", "journals/2026_10_24.md"], "most recently changed first");
    let id = plan.run(&data).unwrap().expect("a copy is made");
    // in the notes folder (Google Drive keeps it in the cloud): logseq/.safety-<this device>/<id>.copy,
    // one file for the whole copy
    let me = device(&data);
    assert!(me.starts_with("computer-") && me.len() == "computer-".len() + 8, "{me}");
    assert_eq!(id, format!("{me}/{}", id.split_once('/').unwrap().1));
    assert_eq!(names(&copies_dir(&v, &data)), vec![format!("{}.copy", id.split_once('/').unwrap().1)]);
    // the texts exactly as they are (from the index, no reading)
    assert_eq!(app.safety_note(&data, &id, "pages/New.md", 0).unwrap().text.as_bytes(), std::fs::read(v.join("pages/New.md")).unwrap());
    assert_eq!(app.safety_note(&data, &id, "journals/2026_10_24.md", 0).unwrap().text, "- two days ago\r\n- CRLF kept\r\n");
    assert!(app.safety_note(&data, &id, "pages/Old.md", 0).is_err() && app.safety_note(&data, &id, "pages/Edge.md", 0).is_err());
    // its first line is its list (JSON), then the texts, byte for byte
    let raw = std::fs::read(copy_file(&v, &id)).unwrap();
    let nl = raw.iter().position(|c| *c == b'\n').unwrap();
    let list: Value = serde_json::from_slice(&raw[..nl]).unwrap();
    let size = std::fs::metadata(v.join("pages/Bytes.md")).unwrap().len();
    assert_eq!(list["skipped"], json!([{ "path": "pages/Bytes.md", "mtime_ns": list["skipped"][0]["mtime_ns"], "size": size, "why": "not plain text" }]));
    let mut body = std::fs::read(v.join("pages/New.md")).unwrap();
    body.extend_from_slice(b"- two days ago\r\n- CRLF kept\r\n");
    assert_eq!(&raw[nl + 1..], &body[..]);
    // listed in Settings, made by this computer
    let c = app.safety_copies(&data);
    assert_eq!((c.len(), c[0].notes, c[0].skipped, c[0].kind.as_str(), c[0].mine), (1, 2, 1, "computer", true));
    let view = app.safety_copy(&data, &id).unwrap();
    let notes: Vec<(&str, &str, &str)> = view.notes.iter().map(|n| (n.path.as_str(), n.name.as_str(), n.now)).collect();
    assert_eq!(notes, vec![("pages/New.md", "New", "same"), ("journals/2026_10_24.md", "Oct 24th, 2026", "same")]);
    assert_eq!(view.skipped, vec![("pages/Bytes.md".to_string(), "not plain text".to_string())]);
    // nothing else in the notes folder changed, and the app's own index doesn't see the copy
    assert!(!v.join("logseq/bak").exists());
    assert_eq!(names(&v.join("logseq")), vec![format!(".safety-{me}")]);
    let again = App::open(&v).unwrap();
    assert_eq!(again.vault.page_count(), app.vault.page_count());
    // nothing in the app's data folder but this device's name
    assert_eq!(names(&data), vec!["safety-device.txt"]);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn no_copy_when_nothing_changed_since_the_newest() {
    let base = tmp("unchanged");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/A.md", "- a\n");
    put(&v, "pages/B.md", "- b\n");
    let mut app = App::open(&v).unwrap();
    let first = app.safety_plan(now()).run(&data).unwrap().unwrap();
    assert_eq!(app.safety_plan(now() + 60).run(&data).unwrap(), None, "same notes, same times: no copy");
    assert_eq!(App::open(&v).unwrap().safety_plan(now() + 120).run(&data).unwrap(), None, "the next start neither");
    // nothing changed in the last 3 days: nothing to copy
    for f in ["pages/A.md", "pages/B.md"] {
        age(&v, f, 4.0);
    }
    assert!(App::open(&v).unwrap().safety_plan(now()).is_empty());
    // a note changes: a new copy, newest first
    put(&v, "pages/B.md", "- b, changed\n");
    app.rescan();
    let second = app.safety_plan(now() + 180).run(&data).unwrap().expect("B changed");
    assert_eq!(ids(&app, &data), vec![second.clone(), first.clone()]);
    let view = app.safety_copy(&data, &first).unwrap();
    assert_eq!(view.notes.iter().find(|n| n.path == "pages/B.md").unwrap().now, "changed");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn keeps_the_newest_15() {
    let base = tmp("prune");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/A.md", "- a\n");
    let app = App::open(&v).unwrap();
    let t0 = now();
    let mut made = vec![];
    for i in 0..17u64 {
        // (each start reads the note anew: no earlier texts, whose copies are kept longer)
        put(&v, "pages/A.md", &format!("- a{}\n", "!".repeat(i as usize)));
        made.push(App::open(&v).unwrap().safety_plan(t0 + i * 60).run(&data).unwrap().expect("changed"));
        if i == 15 {
            // something that isn't a copy, and a link named like one: left alone
            put(&copies_dir(&v, &data), "not a copy.txt", "x");
            std::fs::create_dir_all(copies_dir(&v, &data).join("2020-01-01_00-00-00.copy")).unwrap();
        }
    }
    let mut want: Vec<String> = made[2..].to_vec();
    want.reverse();
    assert_eq!(ids(&app, &data), want, "the 15 newest, newest first");
    assert!(!copy_file(&v, &made[0]).exists() && !copy_file(&v, &made[1]).exists(), "older ones deleted");
    let dir = copies_dir(&v, &data);
    assert!(dir.join("not a copy.txt").exists() && dir.join("2020-01-01_00-00-00.copy").is_dir(), "anything else is left alone");
    assert_eq!(names(&dir).len(), 15 + 2, "one file per copy");
    // the notes folder is untouched
    assert_eq!(std::fs::read_to_string(v.join("pages/A.md")).unwrap(), format!("- a{}\n", "!".repeat(16)));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn keeps_the_newest_15_and_one_a_day_for_a_week() {
    let base = tmp("daily");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/A.md", "- a\n");
    let app = App::open(&v).unwrap();
    let today = now() / 86_400 * 86_400 + 43_200; // noon (UTC) today
    let mut made: Vec<(u64, String)> = vec![]; // (days ago, id)
    let mut n = 0;
    // three copies a day for the 9 days before today, then 20 today (a phone restarting the app)
    for (ago, count) in (1..=9u64).rev().map(|d| (d, 3)).chain([(0, 20)]) {
        for k in 0..count {
            n += 1;
            put(&v, "pages/A.md", &format!("- a{}\n", "!".repeat(n)));
            let when = today - ago * 86_400 + k * 60;
            made.push((ago, App::open(&v).unwrap().safety_plan(when).run(&data).unwrap().expect("changed")));
        }
    }
    let kept = ids(&app, &data);
    let mut want: Vec<String> = made.iter().filter(|(ago, _)| *ago == 0).map(|(_, id)| id.clone()).collect::<Vec<_>>()[5..].to_vec();
    want.reverse(); // the newest 15 (all from today)…
    for ago in 1..=6u64 {
        want.push(made.iter().rev().find(|(a, _)| *a == ago).unwrap().1.clone()); // …and the newest of each of the 6 days before
    }
    assert_eq!(kept, want);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn copies_with_earlier_texts_are_kept_for_a_week_however_many() {
    let base = tmp("earlier");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/A.md", "- a\n");
    let mut app = App::open(&v).unwrap();
    put(&v, "pages/A.md", "- a, changed elsewhere\n");
    app.rescan(); // A's earlier text now goes into every copy this app makes
    let today = now() / 86_400 * 86_400 + 43_200;
    let mut made: Vec<(u64, String)> = vec![];
    // three a day for the 9 days before today, then 25 today
    for (ago, count) in (1..=9u64).rev().map(|d| (d, 3)).chain([(0, 25)]) {
        for k in 0..count {
            made.push((ago, app.safety_plan(today - ago * 86_400 + k * 60).run(&data).unwrap().expect("made")));
        }
    }
    // all of the last 7 days' (today and the 6 before) stay, more than 15; older ones go
    let want: Vec<String> = made.iter().rev().filter(|(ago, _)| *ago < 7).map(|(_, id)| id.clone()).collect();
    assert_eq!(ids(&app, &data), want);
    assert_eq!(want.len(), 25 + 6 * 3);
    // the newest 15 and each day's newest also hold the notes as they were; the others, kept for
    // their earlier texts only, hold just those (the file rewritten smaller)
    let daily: Vec<&String> = (0..7u64).map(|ago| &made.iter().rev().find(|(a, _)| *a == ago).unwrap().1).collect();
    let infos = app.safety_copies(&data);
    for (k, c) in infos.iter().enumerate() {
        let whole = k < 15 || daily.contains(&&c.id);
        assert_eq!((c.notes, c.before), (whole as usize, 1), "{k}: {}", c.id);
        assert_eq!(shape(&app, &data, &c.id), (whole as usize, 1), "{k}: {}", c.id);
        let size = std::fs::metadata(copy_file(&v, &c.id)).unwrap().len();
        let body = if whole { 4 + 23 } else { 4 };
        assert!(size > body && size < body + 400, "{k}: {size}");
    }
    assert_eq!(infos.iter().filter(|c| c.notes == 0).count(), 10 + 6 * 2);
    // such a copy: its earlier text reads and can be put back; the note as it was isn't offered
    let trimmed = &infos.last().unwrap().id;
    let view = app.safety_copy(&data, trimmed).unwrap();
    assert_eq!(view.notes.iter().map(|n| (n.path.as_str(), n.before)).collect::<Vec<_>>(), vec![("pages/A.md", 1)]);
    assert!(view.skipped.is_empty());
    assert_eq!(app.safety_note(&data, trimmed, "pages/A.md", 1).unwrap().text, "- a\n");
    assert!(app.safety_note(&data, trimmed, "pages/A.md", 0).is_err());
    assert!(app.safety_restore(&data, trimmed, "pages/A.md", 0).is_err());
    assert!(app.safety_restore(&data, trimmed, "pages/A.md", 1).unwrap().changed);
    assert_eq!(std::fs::read_to_string(v.join("pages/A.md")).unwrap(), "- a\n");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn the_computer_and_the_phone_keep_their_own_copies_and_see_both() {
    let base = tmp("devices");
    let (v, laptop, phone) = (base.join("vault"), base.join("data"), base.join("phone-data"));
    put(&v, "pages/A.md", "- written on the laptop\n");
    let app = App::open(&v).unwrap();
    let mine = app.safety_plan(now()).run(&laptop).unwrap().unwrap();
    // the phone (its own data folder, so its own name; as if it were a phone)
    name_device(&phone, "phone-0badcafe");
    put(&v, "pages/A.md", "- changed on the phone\n");
    let on_phone = App::open(&v).unwrap();
    let theirs = on_phone.safety_plan(now() + 60).run(&phone).unwrap().unwrap();
    assert!(theirs.starts_with("phone-0badcafe/"), "{theirs}");
    assert_ne!(device(&laptop), "phone-0badcafe");
    // each in a folder of its own right in logseq/ (they never even make the same folder)
    assert_eq!(names(&v.join("logseq")), { let mut d = vec![format!(".safety-{}", device(&laptop)), ".safety-phone-0badcafe".to_string()]; d.sort(); d });
    // each lists both, newest first, saying who made each
    let app = App::open(&v).unwrap();
    let seen = |data: &Path| app.safety_copies(data).into_iter().map(|c| (c.id, c.kind, c.mine)).collect::<Vec<_>>();
    assert_eq!(seen(&laptop), vec![(theirs.clone(), "phone".into(), false), (mine.clone(), "computer".into(), true)]);
    assert_eq!(seen(&phone), vec![(theirs.clone(), "phone".into(), true), (mine.clone(), "computer".into(), false)]);
    // the laptop reads the phone's copy, and can put a version from it back
    assert_eq!(app.safety_note(&laptop, &theirs, "pages/A.md", 0).unwrap().text, "- changed on the phone\n");
    // many more copies on the laptop: it only ever prunes its own; the phone's stay as they are
    let phone_file = std::fs::read(copy_file(&v, &theirs)).unwrap();
    for k in 1..=20u64 {
        put(&v, "pages/A.md", &format!("- laptop {k}\n"));
        App::open(&v).unwrap().safety_plan(now() + 120 + k * 60).run_within(&laptop, 1_000).unwrap().unwrap();
    }
    assert_eq!(std::fs::read(copy_file(&v, &theirs)).unwrap(), phone_file);
    let kinds: Vec<(String, bool)> = app.safety_copies(&laptop).into_iter().map(|c| (c.kind, c.mine)).collect();
    assert!(kinds.contains(&("phone".into(), false)) && kinds.iter().filter(|k| k.1).count() >= 1, "{kinds:?}");
    // the History of a page shows the other device's copy too, saying so
    let hist = app.history(Some(&laptop), "A", None).unwrap();
    let theirs_v = hist.iter().find(|x| x.id == format!("copy:{theirs}:0")).expect("the phone's copy");
    let made = theirs_v.made.as_ref().unwrap();
    assert_eq!((theirs_v.from, made.kind.as_str(), made.mine), ("copy", "phone", false));
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn all_copies_together_stay_within_the_cap() {
    let base = tmp("cap");
    let (v, data, phone) = (base.join("vault"), base.join("data"), base.join("phone-data"));
    let note = |c: &str| format!("- {}\n", c.repeat(997)); // 1,000 bytes
    let today = now() / 86_400 * 86_400 + 43_200;
    // the phone made three copies two days ago
    name_device(&phone, "phone-12345678");
    let mut theirs = vec![];
    for k in 0..3u64 {
        put(&v, "pages/B.md", &note(&k.to_string()));
        theirs.push(App::open(&v).unwrap().safety_plan(today - 2 * 86_400 + k * 60).run(&phone).unwrap().expect("B changed"));
    }
    age(&v, "pages/B.md", 5.0);
    put(&v, "pages/A.md", &note("a"));
    let mut app = App::open(&v).unwrap();
    put(&v, "pages/A.md", &note("b"));
    app.rescan(); // every copy now holds A (1,000 bytes) and its earlier text (1,000 bytes)
    let cap = 10_000;
    let mut made = vec![];
    for k in 0..20u64 {
        made.push(app.safety_plan(today + k * 60).run_within(&data, cap).unwrap().expect("made"));
    }
    let infos = app.safety_copies(&data);
    let total: u64 = infos.iter().map(|c| c.bytes).sum();
    assert!(total <= cap, "{total}");
    // the phone's copies are never touched by the computer (3,000 bytes)
    let phone_ids: Vec<String> = infos.iter().filter(|c| !c.mine).map(|c| c.id.clone()).collect();
    assert_eq!(phone_ids, theirs.iter().rev().cloned().collect::<Vec<_>>());
    // this computer's oldest went: first the notes as they were, then the earlier texts too, oldest
    // first; the newest copy stays whole
    let kept: Vec<String> = infos.iter().filter(|c| c.mine).map(|c| c.id.clone()).collect();
    let mut want: Vec<String> = made[made.len() - kept.len()..].to_vec();
    want.reverse();
    assert_eq!(kept, want);
    assert_eq!(kept.len(), 6, "the newest, whole (2,000 bytes), and 5 with just the earlier text (1,000 each), with the phone's 3,000");
    let shapes: Vec<(usize, usize)> = kept.iter().map(|id| shape(&app, &data, id)).collect();
    assert_eq!(shapes[0], (1, 1));
    assert!(shapes[1..].iter().all(|s| *s == (0, 1)), "{shapes:?}");
    assert_eq!(app.safety_note(&data, &kept[5], "pages/A.md", 1).unwrap().text, note("a"));
    let _ = std::fs::remove_dir_all(&base);
}

/// A notes folder that can't be written (here a file sits where this device's folder for them,
/// `logseq/.safety-<device>`, would go; a folder with no write permission is the same) keeps the
/// copies on this device, as before; all notes folders' local copies together stay within the cap;
/// once it can be written, they move in.
#[test]
fn a_notes_folder_that_cant_be_written_keeps_them_here_until_it_can() {
    let base = tmp("readonly");
    let (v, w, data) = (base.join("vault"), base.join("other"), base.join("data"));
    name_device(&data, "computer-00c0ffee");
    for f in [&v, &w] {
        put(f, "logseq/.safety-computer-00c0ffee", "in the way");
    }
    let note = |c: &str| format!("- {}\n", c.repeat(997)); // 1,000 bytes
    let today = now() / 86_400 * 86_400 + 43_200;
    let mut theirs = vec![];
    for k in 0..3u64 {
        put(&w, "pages/B.md", &note(&k.to_string()));
        theirs.push(App::open(&w).unwrap().safety_plan(today - 2 * 86_400 + k * 60).run(&data).unwrap().expect("B changed"));
    }
    assert!(theirs.iter().all(|id| id.starts_with("local/")), "{theirs:?}");
    put(&v, "pages/A.md", &note("a"));
    let mut app = App::open(&v).unwrap();
    put(&v, "pages/A.md", &note("b"));
    app.rescan();
    let cap = 10_000;
    let mut made = vec![];
    for k in 0..20u64 {
        made.push(app.safety_plan(today + k * 60).run_within(&data, cap).unwrap().expect("made"));
    }
    assert!(outline_core::log::read().contains("so they’re kept on this device for now"), "the problems log says so once");
    let other = App::open(&w).unwrap();
    let infos = app.safety_copies(&data);
    let total: u64 = infos.iter().chain(&other.safety_copies(&data)).map(|c| c.bytes).sum();
    assert!(total <= cap, "{total}");
    assert!(infos.iter().all(|c| c.mine && c.kind == "computer"));
    // (here every notes folder's copies are this device's: the other folder's older ones went first)
    assert_eq!(ids(&other, &data), vec![theirs[2].clone()]);
    let kept = ids(&app, &data);
    assert_eq!(kept.len(), 8);
    assert_eq!(app.safety_note(&data, &kept[7], "pages/A.md", 1).unwrap().text, note("a"));
    assert_eq!(std::fs::read_to_string(v.join("logseq/.safety-computer-00c0ffee")).unwrap(), "in the way", "nothing written over it");
    // the notes folder can be written again: at the next start they move in, the same copies
    std::fs::remove_file(v.join("logseq/.safety-computer-00c0ffee")).unwrap();
    let before: Vec<(String, String)> = kept.iter().map(|id| (id.split_once('/').unwrap().1.to_string(), app.safety_note(&data, id, "pages/A.md", 1).unwrap().text)).collect();
    assert_eq!(app.move_local_copies(&data), 8);
    let now_ids = ids(&app, &data);
    let me = device(&data);
    let after: Vec<(String, String)> = now_ids.iter().map(|id| (id.split_once('/').unwrap().1.to_string(), app.safety_note(&data, id, "pages/A.md", 1).unwrap().text)).collect();
    assert_eq!(after, before);
    assert!(now_ids.iter().all(|id| id.starts_with(&format!("{me}/"))), "{now_ids:?}");
    assert!(!old_local(&data, &v).exists(), "this notes folder's folder here is gone");
    assert!(old_local(&data, &w).exists(), "the other's stays (its folder still can't be written)");
    // the next copy goes into the notes folder
    put(&v, "pages/A.md", &note("c"));
    app.rescan();
    let id = app.safety_plan(today + 3600).run(&data).unwrap().unwrap();
    assert!(id.starts_with(&format!("{me}/")));
    let _ = std::fs::remove_dir_all(&base);
}

/// The copies an older version kept in the app's data folder (a folder per copy) move into the notes
/// folder once: written there, read back and checked, then removed here. A damaged one stays.
#[test]
fn older_copies_move_into_the_notes_folder_once() {
    let base = tmp("move");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/Note.md", "- now\n");
    let old = old_local(&data, &v);
    let old_copy = |id: &str, when: u64, files: Value, texts: &[(&str, &str)]| {
        let dir = old.join(id);
        for (p, t) in texts {
            put(&dir, p, t);
        }
        put(&dir, "list.json", &serde_json::to_string(&json!({"v": 1, "root": v.display().to_string(), "when": when, "files": files, "skipped": []})).unwrap());
    };
    let t = now() - 3600;
    old_copy("2026-10-27_10-00-00", t, json!([{"path": "pages/Note.md", "mtime_ns": 5, "size": 9}, {"path": "pages/Note.md", "mtime_ns": 3, "size": 13, "before": 1}]),
        &[("pages/Note.md", "- as copied\n"), (".before/1/pages/Note.md", "- before that\r\n")]);
    old_copy("2026-10-27_11-00-00", t + 60, json!([{"path": "journals/2026_10_27.md", "mtime_ns": 7, "size": 6}]), &[("journals/2026_10_27.md", "\u{feff}- day")]);
    // one with a note missing: it can't be moved whole, so it stays where it is
    old_copy("2026-10-27_12-00-00", t + 120, json!([{"path": "pages/Gone.md", "mtime_ns": 1, "size": 4}]), &[]);
    // one left half-written by a crash: cleared away
    std::fs::create_dir_all(old.join(".2026-10-27_13-00-00.part/pages")).unwrap();
    let app = App::open(&v).unwrap();
    assert_eq!(app.move_local_copies(&data), 2);
    let me = device(&data);
    assert_eq!(names(&copies_dir(&v, &data)), vec!["2026-10-27_10-00-00.copy", "2026-10-27_11-00-00.copy"]);
    let a = format!("{me}/2026-10-27_10-00-00");
    assert_eq!(app.safety_note(&data, &a, "pages/Note.md", 0).unwrap().text, "- as copied\n");
    assert_eq!(app.safety_note(&data, &a, "pages/Note.md", 1).unwrap().text, "- before that\r\n");
    assert_eq!(app.safety_note(&data, &format!("{me}/2026-10-27_11-00-00"), "journals/2026_10_27.md", 0).unwrap().text, "\u{feff}- day");
    assert_eq!(names(&old), vec!["2026-10-27_12-00-00"], "the damaged one stays, the half-written one is gone");
    assert!(outline_core::log::read().contains("the copy 2026-10-27_12-00-00 couldn’t be moved"), "{}", outline_core::log::read());
    // the moved ones are listed, as this computer's; the one left behind too (it can't be read whole: not listed)
    assert_eq!(ids(&app, &data), vec![format!("{me}/2026-10-27_11-00-00"), a.clone()]);
    // once only: nothing more to move, nothing written twice
    assert_eq!(app.move_local_copies(&data), 0);
    assert_eq!(names(&copies_dir(&v, &data)).len(), 2);
    // a move that stopped before removing the old copy: done again without a second copy
    old_copy("2026-10-27_10-00-00", t, json!([{"path": "pages/Note.md", "mtime_ns": 5, "size": 9}, {"path": "pages/Note.md", "mtime_ns": 3, "size": 13, "before": 1}]),
        &[("pages/Note.md", "- as copied\n"), (".before/1/pages/Note.md", "- before that\r\n")]);
    assert_eq!(app.move_local_copies(&data), 1);
    assert_eq!(names(&copies_dir(&v, &data)).len(), 2);
    // opening the folder in the app moves them too (in the background)
    let _ = std::fs::remove_dir_all(&base);
}

/// A link (or junction) is never followed: not this device's `logseq/.safety-<device>` (then the copies
/// stay on this device), not another device-shaped folder there, not a copy-shaped file; the clean-up
/// only deletes the app's own copies, never anything a link points at.
#[cfg(unix)]
#[test]
fn links_are_never_followed() {
    let base = tmp("link");
    let (v, data, elsewhere) = (base.join("vault"), base.join("data"), base.join("elsewhere"));
    std::fs::create_dir_all(&elsewhere).unwrap();
    put(&elsewhere, "precious.txt", "must survive\n");
    // this device's folder is a link to elsewhere: nothing is written there
    name_device(&data, "computer-00c0ffee");
    std::os::unix::fs::symlink(&elsewhere, v.join("logseq/.safety-computer-00c0ffee")).unwrap();
    put(&v, "pages/A.md", "- a\n");
    let app = App::open(&v).unwrap();
    let id = app.safety_plan(now()).run_within(&data, 1_000).unwrap().unwrap();
    assert!(id.starts_with("local/"), "{id}");
    assert_eq!(names(&elsewhere), vec!["precious.txt"]);
    assert_eq!(app.move_local_copies(&data), 0, "nor moved through it");
    std::fs::remove_file(v.join("logseq/.safety-computer-00c0ffee")).unwrap();
    // another device-shaped link in logseq, and a copy-shaped link in this device's own folder
    let fake = |dir: &Path, stamp: &str, when: u64| {
        let list = json!({"v": 2, "root": "x", "when": when, "files": [{"path": "pages/Precious.md", "mtime_ns": 1, "size": 9_000_000, "at": [0, 4]}], "skipped": []});
        put(dir, &format!("{stamp}.copy"), &format!("{}\nkeep", serde_json::to_string(&list).unwrap()));
    };
    fake(&elsewhere, "2020-01-01_00-00-00", 1_577_836_800);
    fake(&elsewhere, "2020-01-02_00-00-00", 1_577_923_200);
    let mut app = App::open(&v).unwrap();
    assert_eq!(app.move_local_copies(&data), 1);
    let me = device(&data);
    std::os::unix::fs::symlink(&elsewhere, v.join("logseq/.safety-computer-0000beef")).unwrap();
    std::os::unix::fs::symlink(elsewhere.join("2020-01-01_00-00-00.copy"), copies_dir(&v, &data).join("2020-01-01_00-00-00.copy")).unwrap();
    put(&v, "pages/A.md", "- a, changed\n");
    app.rescan();
    app.safety_plan(now() + 60).run_within(&data, 1_000).unwrap().expect("made");
    assert_eq!(names(&elsewhere), vec!["2020-01-01_00-00-00.copy", "2020-01-02_00-00-00.copy", "precious.txt"]);
    assert!(!ids(&app, &data).iter().any(|i| i.contains("2020-01-0")), "nor listed or read");
    assert!(app.safety_copy(&data, "computer-0000beef/2020-01-01_00-00-00").is_err());
    assert!(app.safety_copy(&data, &format!("{me}/2020-01-01_00-00-00")).is_err());
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn at_most_500_notes_and_25_mb() {
    let base = tmp("limits");
    let (v, data) = (base.join("vault"), base.join("data"));
    for i in 0..501 {
        put(&v, &format!("pages/N{i:03}.md"), "- small\n");
        age(&v, &format!("pages/N{i:03}.md"), 1.0 + i as f64 / 1000.0); // N000 newest
    }
    put(&v, "pages/Huge.md", &"x".repeat(26 * 1024 * 1024)); // the newest, and too big
    let app = App::open(&v).unwrap();
    let plan = app.safety_plan(now());
    let paths = plan.paths();
    assert_eq!(paths.len(), 500);
    assert_eq!((paths[0], paths[499]), ("pages/N000.md", "pages/N499.md"));
    let id = plan.run(&data).unwrap().unwrap();
    let view = app.safety_copy(&data, &id).unwrap();
    assert_eq!(view.skipped, vec![("pages/Huge.md".into(), "the copy was full (25 MB)".into()), ("pages/N500.md".into(), "more than 500 notes had changed".into())]);
    assert_eq!(view.notes.len(), 500);
    assert!(app.safety_note(&data, &id, "pages/Huge.md", 0).is_err() && app.safety_note(&data, &id, "pages/N500.md", 0).is_err());
    assert_eq!(app.safety_note(&data, &id, "pages/N499.md", 0).unwrap().text, "- small\n");
    let c = &app.safety_copies(&data)[0];
    assert_eq!((c.notes, c.skipped, c.bytes), (500, 2, 500 * 8));
    assert_eq!(names(&copies_dir(&v, &data)).len(), 1, "one file, however many notes");
    // the same again next time: no new copy just because some were left out
    assert_eq!(App::open(&v).unwrap().safety_plan(now()).run(&data).unwrap(), None);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn a_damaged_or_half_synced_copy_is_left_out() {
    let base = tmp("damaged");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/A.md", "- a\n");
    let app = App::open(&v).unwrap();
    let id = app.safety_plan(now()).run(&data).unwrap().unwrap();
    let file = copy_file(&v, &id);
    let whole = std::fs::read(&file).unwrap();
    // cut short (Google Drive still bringing it): not listed, not read
    std::fs::write(&file, &whole[..whole.len() - 2]).unwrap();
    assert!(app.safety_copies(&data).is_empty());
    assert!(app.safety_note(&data, &id, "pages/A.md", 0).is_err());
    std::fs::write(&file, b"not a copy").unwrap();
    assert!(app.safety_copies(&data).is_empty());
    std::fs::write(&file, &whole).unwrap();
    assert_eq!(ids(&app, &data), vec![id]);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn putting_back_keeps_the_current_text_first() {
    let base = tmp("restore");
    let (v, data) = (base.join("vault"), base.join("data"));
    put(&v, "pages/Note.md", "- the good version\n\t- with a child\n");
    put(&v, "pages/Other.md", "- links [[Note]]\n");
    let mut app = App::open(&v).unwrap();
    let id = app.safety_plan(now()).run(&data).unwrap().unwrap();
    // the note gets damaged (by sync, another app…)
    put(&v, "pages/Note.md", "- oops\n");
    app.rescan();
    let n = app.safety_note(&data, &id, "pages/Note.md", 0).unwrap();
    assert_eq!((n.text.as_str(), n.name.as_str(), n.same, n.exists), ("- the good version\n\t- with a child\n", "Note", false, true));
    assert_eq!(app.safety_copy(&data, &id).unwrap().notes.iter().find(|x| x.path == "pages/Note.md").unwrap().now, "changed");
    let r = app.safety_restore(&data, &id, "pages/Note.md", 0).unwrap();
    assert!(r.changed && r.name == "Note");
    assert_eq!(std::fs::read_to_string(v.join("pages/Note.md")).unwrap(), "- the good version\n\t- with a child\n");
    let bak = v.join("logseq/bak/pages/Note");
    let backups: Vec<_> = std::fs::read_dir(&bak).unwrap().flatten().map(|e| std::fs::read_to_string(e.path()).unwrap()).collect();
    assert_eq!(backups, vec!["- oops\n"], "the damaged text was kept first");
    // the index knows (as after any save)
    assert_eq!(app.page("Note", None).doc.blocks[0].text, "the good version");
    assert!(app.search("good version").iter().any(|h| h.page == "Note"));
    assert!(app.safety_note(&data, &id, "pages/Note.md", 0).unwrap().same);
    let state = |app: &App| app.safety_copy(&data, &id).unwrap().notes.iter().find(|x| x.path == "pages/Note.md").unwrap().now;
    assert_eq!(state(&app), "same", "its file time changed, but the text is the copy's again");
    // again: nothing to do, no second backup
    assert!(!app.safety_restore(&data, &id, "pages/Note.md", 0).unwrap().changed);
    assert_eq!(std::fs::read_dir(&bak).unwrap().count(), 1);
    // the note was deleted: putting it back makes it again (nothing to back up)
    app.delete_pages(&["Note".to_string()]).unwrap();
    assert!(!app.safety_note(&data, &id, "pages/Note.md", 0).unwrap().exists);
    assert_eq!(app.safety_copy(&data, &id).unwrap().notes.iter().find(|x| x.path == "pages/Note.md").unwrap().now, "gone");
    assert!(app.safety_restore(&data, &id, "pages/Note.md", 0).unwrap().changed);
    assert_eq!(std::fs::read_to_string(v.join("pages/Note.md")).unwrap(), "- the good version\n\t- with a child\n");
    assert!(app.vault.page_info("Note").exists);
    assert_eq!(std::fs::read_dir(&bak).unwrap().count(), 1);
    // a backup that can't be made: nothing is written
    put(&v, "pages/Note.md", "- changed again\n");
    std::fs::remove_dir_all(v.join("logseq/bak")).unwrap();
    put(&v, "logseq/bak", "a file where the backup folder should be");
    let e = app.safety_restore(&data, &id, "pages/Note.md", 0).unwrap_err();
    assert!(e.contains("Couldn't keep a backup copy"), "{e}");
    assert_eq!(std::fs::read_to_string(v.join("pages/Note.md")).unwrap(), "- changed again\n");
    // a note that isn't plain text now is never written over from here
    std::fs::remove_file(v.join("logseq/bak")).unwrap();
    std::fs::write(v.join("pages/Note.md"), b"- \xff\n").unwrap();
    let e = app.safety_restore(&data, &id, "pages/Note.md", 0).unwrap_err();
    assert!(e.contains("isn't plain UTF-8"), "{e}");
    assert_eq!(std::fs::read(v.join("pages/Note.md")).unwrap(), b"- \xff\n");
    let _ = std::fs::remove_dir_all(&base);
}

/// The data folder for the dispatch commands (set once for this test program; emptied first: an
/// earlier run with the same process id may have left copies for the same notes folders).
fn global_data() -> PathBuf {
    static DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    let dir = DIR.get_or_init(|| {
        let d = std::env::temp_dir().join(format!("outline_safety_data_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    });
    set_data_dir(dir.clone());
    data_dir().unwrap()
}

#[test]
fn bad_names_and_paths_are_refused() {
    let base = tmp("paths");
    let v = base.join("vault");
    put(&v, "pages/Note.md", "- good\n");
    put(&base, "secret.md", "- outside the notes folder\n");
    let data = global_data();
    let mut state = Some(App::open(&v).unwrap());
    let id = state.as_ref().unwrap().safety_plan(now()).run(&data).unwrap().unwrap();
    let (dev, stamp) = id.split_once('/').unwrap();
    put(&v, "pages/Note.md", "- changed\n");
    let bad_ids = [
        "".to_string(),
        "..".into(),
        "../..".into(),
        "a/b".into(),
        stamp.into(),
        format!("{dev}/{stamp}/../.."),
        format!("{dev}/../{stamp}"),
        format!("../{stamp}"),
        format!("{dev}\\{stamp}"),
        format!("{dev}/{stamp} "),
        format!("{dev}/{stamp}/pages"),
        format!("{dev}/{stamp}.copy"),
        format!("computer-xyz/{stamp}"),
        format!("Computer-00000000/{stamp}"),
        format!("local/{stamp}"),
        "2026-10-26_09-15-02/../..".into(),
    ];
    for bad in &bad_ids {
        for cmd in ["safety_copy", "safety_note", "safety_restore"] {
            assert!(dispatch(&mut state, cmd, json!({ "id": bad, "path": "pages/Note.md" })).is_err(), "{cmd} {bad:?}");
        }
    }
    let bad_paths = [
        "",
        "../secret.md",
        "pages/../../secret.md",
        "pages/./Note.md",
        "/etc/passwd",
        "pages\\Note.md",
        "pages/Note.md\0",
        "pages/Other.md",
        "list.json",
        "logseq/config.edn",
        "logseq/bak/pages/Note.md",
        &format!("{}/vault/pages/Note.md", base.display()),
    ];
    for bad in bad_paths {
        for cmd in ["safety_note", "safety_restore"] {
            assert!(dispatch(&mut state, cmd, json!({ "id": id, "path": bad })).is_err(), "{cmd} {bad:?}");
        }
    }
    // nothing was written anywhere
    assert_eq!(std::fs::read_to_string(v.join("pages/Note.md")).unwrap(), "- changed\n");
    assert_eq!(std::fs::read_to_string(base.join("secret.md")).unwrap(), "- outside the notes folder\n");
    assert!(!v.join("logseq/bak").exists());
    // and the good one works
    let r = dispatch(&mut state, "safety_restore", json!({ "id": id, "path": "pages/Note.md" })).unwrap();
    assert_eq!(r["changed"], json!(true));
    assert_eq!(std::fs::read_to_string(v.join("pages/Note.md")).unwrap(), "- good\n");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn opening_makes_a_copy_in_the_background_but_check_does_not() {
    let base = tmp("open");
    let v = base.join("vault");
    put(&v, "pages/Note.md", "- hello\n");
    let data = global_data();
    let mine = |app: &App| app.safety_copies(&data).len();
    // the read-only check (also `lean-outliner --check`) makes no copies
    check_vault(&v).unwrap();
    let probe = App::open(&v).unwrap();
    assert_eq!(mine(&probe), 0);
    assert_eq!(names(&v.join("logseq")).len(), 0);
    // opening the folder in the app does, without waiting for it
    let mut state = None;
    dispatch(&mut state, "open", json!({ "path": v.display().to_string() })).unwrap();
    let mut n = 0;
    for _ in 0..100 {
        n = dispatch(&mut state, "safety_copies", json!({})).unwrap().as_array().unwrap().len();
        if n > 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(n, 1);
    // in this device's folder in logseq; nothing else was added to the notes folder
    assert_eq!(names(&v), vec!["journals", "logseq", "pages"]);
    assert_eq!(names(&v.join("logseq")), vec![format!(".safety-{}", device(&data))]);
    let _ = std::fs::remove_dir_all(&base);
}

/// The app's data folder inside the notes folder doesn't matter for copies in `logseq/.safety-…`; only
/// if the notes folder can't be written are none made (they'd be kept inside it anyway).
#[test]
fn a_data_folder_inside_the_notes_folder() {
    let base = tmp("inside");
    let v = base.join("vault");
    put(&v, "pages/Note.md", "- hello\n");
    let app = App::open(&v).unwrap();
    let data = v.join("logseq/appdata");
    assert!(app.safety_plan(now()).run(&data).unwrap().is_some());
    put(&v, "pages/Note.md", "- hello again\n");
    let mine = v.join("logseq").join(format!(".safety-{}", device(&data)));
    std::fs::remove_dir_all(&mine).unwrap();
    std::fs::write(&mine, "in the way").unwrap();
    let app = App::open(&v).unwrap();
    let e = app.safety_plan(now()).run(&data).unwrap_err();
    assert!(e.contains("inside it"), "{e}");
    assert!(!data.join("safety-copies").exists());
    let _ = std::fs::remove_dir_all(&base);
}

//! Smaller fixes from the outside review (Nov 2026), one test or more for each: the bad input the
//! review found (now refused or handled), the usual case (still works) and edge cases.
use outline_core::app::App;
use outline_core::*;
use std::path::{Path, PathBuf};

fn tmp_vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_review_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq", "assets"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}

fn put(v: &Path, rel: &str, text: &str) {
    let p = v.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

// ---------------------------------------------------------------- 9d: config.edn with a BOM

const BOM: &str = "\u{feff}";

#[test]
fn a_byte_order_mark_never_wipes_the_settings() {
    let t = "{:journals-directory \"Daily\" :pages-directory \"Notes\" :favorites [\"a\"]}";
    let with = format!("{BOM}{t}");
    let c = Config::from_edn(&with);
    assert_eq!((c.journals_dir.as_str(), c.pages_dir.as_str()), ("Daily", "Notes"));
    assert_eq!(c.favorites, vec!["a"]);
    let n = edn::parse(&with).unwrap();
    assert!(matches!(n.v, edn::Edn::Map(_)));
    assert_eq!(n.start, BOM.len(), "offsets are the text's own");
    assert_eq!(n.end, with.len());
    // a rewrite keeps the mark and everything else in place
    let out = edn::set_path(&with, &["favorites"], "[\"b\"]").unwrap();
    assert_eq!(out, with.replace("[\"a\"]", "[\"b\"]"));
    assert!(out.starts_with(BOM));
    let out = edn::set_path(&with, &["hidden"], "[]").unwrap();
    assert!(out.starts_with(BOM) && Config::from_edn(&out).journals_dir == "Daily", "{out}");
    // with comments and CRLF after the mark
    let crlf = format!("{BOM};; my settings\r\n{{:journals-directory \"Days\"\r\n}}\r\n");
    assert_eq!(Config::from_edn(&crlf).journals_dir, "Days");
    // only a mark at the very start is skipped; elsewhere it is still not whole EDN's map
    assert_eq!(Config::from_edn(&format!("{BOM}{BOM}{t}")).journals_dir, "journals");
    assert!(edn::parse(BOM).is_none());
    assert!(edn::parse("").is_none());
    // without a mark nothing changed
    assert_eq!(Config::from_edn(t).journals_dir, "Daily");
}

#[test]
fn a_notes_folder_whose_config_has_a_bom_opens_with_its_settings() {
    let v = tmp_vault("bom");
    std::fs::create_dir_all(v.join("Daily")).unwrap();
    put(&v, "logseq/config.edn", &format!("{BOM}{{:journals-directory \"Daily\"\n :favorites [\"Kept\"]}}\n"));
    put(&v, "Daily/2026_11_20.md", "- a day\n");
    put(&v, "pages/Kept.md", "- kept\n");
    put(&v, "pages/Other.md", "- other\n");
    let mut app = App::open(&v).unwrap();
    assert_eq!(app.vault.config.journals_dir, "Daily");
    assert_eq!(app.vault.config.favorites, vec!["Kept"]);
    // a favourite added keeps the file's mark and its settings
    app.set_favorite("Other", true).unwrap();
    let after = std::fs::read_to_string(v.join("logseq/config.edn")).unwrap();
    assert!(after.starts_with(BOM), "{after:?}");
    assert_eq!(Config::from_edn(&after).favorites, vec!["Kept", "Other"]);
    assert_eq!(Config::from_edn(&after).journals_dir, "Daily");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn adding_a_note_reads_the_settings_strictly() {
    // a config.edn that is there but isn't a file (a stand-in for one that can't be read): adding a
    // note stops rather than guessing the place; a missing one still means Logseq's defaults
    let v = tmp_vault("strict");
    std::fs::create_dir_all(v.join("logseq/config.edn")).unwrap();
    assert!(capture::read_config_to_add(&v).is_err());
    let e = capture::capture_to_usual(&v, "hello", "", false, (2026, 11, 21), "10:00").unwrap_err();
    assert!(e.contains("nothing was added"), "{e}");
    assert_eq!(std::fs::read_dir(v.join("journals")).unwrap().count(), 0, "nothing written");
    std::fs::remove_dir_all(v.join("logseq/config.edn")).unwrap();
    assert_eq!(capture::read_config_to_add(&v).unwrap().journals_dir, "journals");
    let rel = capture::capture_to_usual(&v, "hello", "", false, (2026, 11, 21), "10:00").unwrap();
    assert!(std::fs::read_to_string(v.join(&rel)).unwrap().contains("hello"));
    put(&v, "logseq/config.edn", &format!("{BOM}{{:journals-directory \"Days\"}}"));
    assert_eq!(capture::read_config_to_add(&v).unwrap().journals_dir, "Days");
    let _ = std::fs::remove_dir_all(&v);
}

// ---------------------------------------------------------------- 9a: a template starting with an emoji

#[test]
fn a_capture_template_may_start_with_any_character() {
    // before: `rest[1..]` cut inside the first character and panicked
    for (t, note, want) in [
        ("📌 {text}", "📌 hello https://a.org", Some("hello https://a.org")),
        ("📌{text}", "📌hello", Some("hello")),
        ("→ {text}", "→ moved", Some("moved")),
        ("é{text}", "éa", Some("a")),
        ("📌 {text}", "📍 other pin", None),
        ("{time}→{text}", "10:30→hello", Some("hello")),
        ("**{time}** [[quick capture]]: {text}", "**10:30** [[quick capture]]: hi", Some("hi")),
        ("日本 {time} {text}", "日本 10:30 words", Some("words")),
        ("✦", "✦", None), // (no {text}: not a capture template)
    ] {
        let got = std::panic::catch_unwind(|| clip::capture_rest(t, note).map(str::to_string)).unwrap_or_else(|_| panic!("{t:?} panicked"));
        assert_eq!(got.as_deref(), want, "{t:?} on {note:?}");
    }
    // every template of one to three mixed characters before {text}: never a panic
    let chars = ["a", "📌", "é", "{", "}", " ", "*", "日"];
    for a in chars {
        for b in chars {
            for c in chars {
                let t = format!("{a}{b}{c}{{text}}");
                let note = format!("{a}{b}{c}x");
                assert!(std::panic::catch_unwind(|| clip::capture_rest(&t, &note).is_some()).is_ok(), "{t:?}");
            }
        }
    }
}

// ---------------------------------------------------------------- 9c: dates that aren't days

#[test]
fn a_month_outside_1_to_12_never_panics() {
    for m in [0u32, 13, 99, u32::MAX] {
        for d in [0u32, 1, 31, u32::MAX] {
            assert!(std::panic::catch_unwind(|| date::weekday((2026, m, d))).is_ok(), "weekday month {m} day {d}");
            assert!(std::panic::catch_unwind(|| date::format("EEEE, MMM do, yyyy", (2026, m, d))).is_ok(), "format month {m} day {d}");
        }
    }
    for y in [i32::MIN, -1, 0, i32::MAX] {
        assert!(std::panic::catch_unwind(|| date::weekday((y, 2, 29))).is_ok(), "year {y}");
    }
    assert!(!date::valid((2026, 0, 1)) && !date::valid((2026, 13, 1)) && !date::valid((2026, 2, 29)) && !date::valid((2026, 4, 31)));
    assert!(date::valid((2024, 2, 29)) && date::valid((2026, 12, 31)));
    // real days are still right (Nov 21, 2026 is a Saturday; Jan 1, 2000 a Saturday; Mar 1, 1900 a Thursday)
    assert_eq!(date::weekday((2026, 11, 21)), 6);
    assert_eq!(date::weekday((2000, 1, 1)), 6);
    assert_eq!(date::weekday((1900, 3, 1)), 4);
    assert_eq!(date::weekday((2024, 2, 29)), 4);
    for days in 0..3000i64 {
        // one day after another, the weekday goes round
        let a = date::civil_from_days(days);
        let b = date::civil_from_days(days + 1);
        assert_eq!((date::weekday(a) + 1) % 7, date::weekday(b), "{a:?}");
    }
}

#[test]
fn commands_refuse_a_day_that_isnt_one() {
    let v = tmp_vault("dates");
    put(&v, "pages/A.md", "- a\n");
    let mut st = Some(App::open(&v).unwrap());
    use serde_json::json;
    for bad in [json!([2026, 13, 1]), json!([2026, 0, 1]), json!([2026, 2, 30]), json!([2026, 11, 0]), json!([0, 1, 1]), json!([10000, 1, 1]), json!([2026, 4294967295u32, 1])] {
        for (cmd, key) in [("task_done", "today"), ("journal_name", "date"), ("journals", "end"), ("template", "today"), ("start_notes", "today")] {
            let mut args = json!({"text": "TODO x", "name": "n", "page": "A", "count": 1, "path": v.join("new").to_str().unwrap()});
            args[key] = bad.clone();
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| app::dispatch(&mut st, cmd, args)));
            let r = r.unwrap_or_else(|_| panic!("{cmd} {bad} panicked"));
            assert!(r.as_ref().is_err_and(|e| e.contains("bad date")), "{cmd} {bad}: {r:?}");
        }
    }
    // a real day still works
    assert!(app::dispatch(&mut st, "journal_name", json!({"date": [2026, 11, 21]})).is_ok());
    assert!(app::dispatch(&mut st, "task_done", json!({"text": "TODO x", "today": [2024, 2, 29]})).is_ok());
    let _ = std::fs::remove_dir_all(&v);
}

// ---------------------------------------------------------------- 6: links named .md aren't notes

#[cfg(unix)]
#[test]
fn a_link_named_md_is_never_read_as_a_note() {
    let v = tmp_vault("symlink");
    let outside = std::env::temp_dir().join(format!("outline_review_outside_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&outside);
    std::fs::create_dir_all(outside.join("dir")).unwrap();
    std::fs::write(outside.join("secret.md"), "- outside secret words\n").unwrap();
    std::fs::write(outside.join("dir/inner.md"), "- outside folder words\n").unwrap();
    std::os::unix::fs::symlink(outside.join("secret.md"), v.join("pages/linked.md")).unwrap();
    std::os::unix::fs::symlink(outside.join("dir"), v.join("pages/linkdir")).unwrap();
    std::os::unix::fs::symlink(outside.join("secret.md"), v.join("journals/2026_11_21.md")).unwrap();
    put(&v, "pages/Real.md", "- real words\n");
    put(&v, "pages/sub/Deeper.md", "- deeper words\n");
    let app = App::open(&v).unwrap();
    assert!(!app.vault.page_info("linked").exists, "the link isn't a page");
    assert!(!app.vault.page_info("inner").exists && !app.vault.page_info("linkdir/inner").exists, "a linked folder isn't followed");
    assert!(app.vault.page_info("Real").exists);
    assert!(app.vault.all_pages().iter().any(|p| p.name.to_lowercase().contains("deeper")), "real sub-folders still are");
    assert!(app.search("secret").is_empty() && app.search("outside").is_empty(), "nothing from outside is searched");
    assert!(app.vault.search_blocks("outside", 12).is_empty());
    assert!(!app.vault.search_blocks("deeper", 12).is_empty());
    let _ = std::fs::remove_dir_all(&v);
    let _ = std::fs::remove_dir_all(&outside);
}

// ---------------------------------------------------------------- 5: only plain files right in the bin

#[test]
fn only_plain_files_right_in_the_bin_are_shown_or_put_back() {
    let v = tmp_vault("bin_entry");
    put(&v, "pages/Keep.md", "- keep\n");
    put(&v, "secret.md", "- not in the bin\n");
    put(&v, "logseq/.recycle/pages_Gone.md", "- gone\n");
    put(&v, "logseq/.recycle/sub/pages_Deep.md", "- in a folder in the bin\n");
    let mut app = App::open(&v).unwrap();
    for bad in [
        "C:secret.md",
        "c:..\\..\\secret.md",
        "pages_Gone.md:stream",
        "a:b.md",
        "../../secret.md",
        "..",
        ".",
        "",
        "sub/pages_Deep.md",
        "sub\\pages_Deep.md",
        "/etc/passwd",
        ".thinky-bin.json",
        ".hidden.md",
        "x\0.md",
        "assets%2Fx.png:alt",
    ] {
        assert!(app.recycled_page(bad).is_err(), "shown: {bad:?}");
        assert!(app.restore(bad).is_err(), "put back: {bad:?}");
    }
    assert!(app.restore("pages_Missing.md").unwrap_err().contains("gone"));
    assert!(v.join("secret.md").exists() && v.join("logseq/.recycle/sub/pages_Deep.md").exists(), "nothing moved");
    #[cfg(unix)]
    {
        // a link in the bin to a file elsewhere is no file in the bin
        std::os::unix::fs::symlink(v.join("secret.md"), v.join("logseq/.recycle/pages_Linked.md")).unwrap();
        assert!(app.recycled_page("pages_Linked.md").is_err());
        assert!(app.restore("pages_Linked.md").is_err());
        assert!(!v.join("pages/Linked.md").exists() && v.join("secret.md").exists());
    }
    // the usual: shown, then put back
    let shown = app.recycled_page("pages_Gone.md").unwrap();
    assert_eq!(shown["name"], "Gone");
    assert_eq!(app.restore("pages_Gone.md").unwrap(), "Gone");
    assert_eq!(std::fs::read_to_string(v.join("pages/Gone.md")).unwrap(), "- gone\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_page_goes_back_where_it_was_even_from_a_sub_folder_or_named_like_a_copy() {
    let v = tmp_vault("bin_index");
    put(&v, "pages/sub/a.md", "title:: sub/a\n- in a sub-folder\n");
    put(&v, "pages/sub_a.md", "title:: sub_a\n- not in a sub-folder\n");
    put(&v, "pages/Report (2).md", "- a page really called Report (2)\n");
    put(&v, "pages/Notes.md", "- first\n");
    let mut app = App::open(&v).unwrap();
    let (sub, flat) = ("sub/a".to_string(), "sub_a".to_string());
    assert_eq!(app.vault.page_info(&sub).path.as_deref(), Some("pages/sub/a.md"));
    assert_eq!(app.vault.page_info(&flat).path.as_deref(), Some("pages/sub_a.md"));
    assert_eq!(app.delete_pages(&[sub.clone(), flat.clone(), "Report (2)".into(), "Notes".into()]).unwrap(), 4);
    put(&v, "pages/Notes.md", "- second\n");
    app.rescan();
    app.delete_pages(&["Notes".into()]).unwrap();
    let bin: Vec<String> = std::fs::read_dir(v.join("logseq/.recycle")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.starts_with('.')).collect();
    assert_eq!(bin.len(), 5, "{bin:?}");
    assert!(v.join("logseq/.recycle/pages_sub_a.md").exists() && v.join("logseq/.recycle/pages_sub_a (2).md").exists());
    // the list shows each by its own name
    let listed: Vec<String> = app.recycled().into_iter().map(|r| r.name).collect();
    for want in ["Report (2)", "Notes"] {
        assert!(listed.iter().any(|n| n == want), "{want} in {listed:?}");
    }
    // each goes back to its own file
    for f in ["pages_sub_a.md", "pages_sub_a (2).md", "pages_Report (2).md", "pages_Notes (2).md"] {
        app.restore(f).unwrap_or_else(|e| panic!("{f}: {e}"));
    }
    assert_eq!(std::fs::read_to_string(v.join("pages/sub/a.md")).unwrap(), "title:: sub/a\n- in a sub-folder\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/sub_a.md")).unwrap(), "title:: sub_a\n- not in a sub-folder\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/Report (2).md")).unwrap(), "- a page really called Report (2)\n", "a real \" (2)\" kept");
    assert_eq!(std::fs::read_to_string(v.join("pages/Notes.md")).unwrap(), "- second\n");
    // the other "Notes" can't go back over it; once that one is gone again, it can
    assert!(app.restore("pages_Notes.md").unwrap_err().contains("already"));
    // the index only keeps names still in the bin
    let idx: std::collections::HashMap<String, String> = serde_json::from_str(&std::fs::read_to_string(v.join("logseq/.recycle/.thinky-bin.json")).unwrap()).unwrap();
    assert_eq!(idx.keys().cloned().collect::<Vec<_>>(), vec!["pages_Notes.md".to_string()]);
    // a file binned by Logseq or an older build (not in the index): worked out from its name, as before
    put(&v, "logseq/.recycle/pages_Old (3).md", "- from long ago\n");
    assert_eq!(app.restore("pages_Old (3).md").unwrap(), "Old");
    // an index entry that points out of the notes folder is never followed
    put(&v, "logseq/.recycle/pages_Evil.md", "- evil\n");
    std::fs::write(v.join("logseq/.recycle/.thinky-bin.json"), r#"{"pages_Evil.md": "pages/../../evil.md"}"#).unwrap();
    app.restore("pages_Evil.md").unwrap();
    assert!(v.join("pages/Evil.md").exists() && !v.parent().unwrap().join("evil.md").exists());
    // a broken index: still restores by name
    put(&v, "logseq/.recycle/pages_Broken.md", "- b\n");
    std::fs::write(v.join("logseq/.recycle/.thinky-bin.json"), "{ not json").unwrap();
    assert_eq!(app.restore("pages_Broken.md").unwrap(), "Broken");
    let _ = std::fs::remove_dir_all(&v);
}

// ---------------------------------------------------------------- thinky.json: hidden temp, never over a change

#[test]
fn folder_settings_are_written_like_a_note() {
    let v = tmp_vault("thinkyjson");
    put(&v, "pages/a.md", "- a\n");
    let app = App::open(&v).unwrap();
    // another device saves the file right before this one would: its change is read again and kept
    let n = std::rc::Rc::new(std::cell::Cell::new(0));
    let n2 = n.clone();
    app::set_write_hook(Some(Box::new(move |p: &Path| {
        if p.ends_with("thinky.json") && n2.get() == 0 {
            n2.set(1);
            std::fs::write(p, r#"{"fromPhone": 1}"#).unwrap();
        }
    })));
    let saved = app.set_folder_setting("mine", serde_json::json!(true)).unwrap();
    app::set_write_hook(None);
    assert_eq!(n.get(), 1);
    assert_eq!(saved, serde_json::json!({"fromPhone": 1, "mine": true}));
    let on_disk: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(v.join("logseq/thinky.json")).unwrap()).unwrap();
    assert_eq!(on_disk, saved);
    // no temporary file left, and none was ever a visible one
    let left: Vec<String> = std::fs::read_dir(v.join("logseq")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(left.iter().all(|n| !n.contains("tmp")), "{left:?}");
    // a file with a BOM is read; a broken one never overwritten
    std::fs::write(v.join("logseq/thinky.json"), "\u{feff}{\"a\": 1}").unwrap();
    assert_eq!(app.set_folder_setting("b", serde_json::json!(2)).unwrap(), serde_json::json!({"a": 1, "b": 2}));
    std::fs::write(v.join("logseq/thinky.json"), "[1, 2]").unwrap();
    assert!(app.set_folder_setting("c", serde_json::json!(3)).unwrap_err().contains("can't be read"));
    assert_eq!(std::fs::read_to_string(v.join("logseq/thinky.json")).unwrap(), "[1, 2]");
    // it keeps changing: not saved, said so
    std::fs::remove_file(v.join("logseq/thinky.json")).unwrap();
    let k = std::rc::Rc::new(std::cell::Cell::new(0));
    let k2 = k.clone();
    app::set_write_hook(Some(Box::new(move |p: &Path| {
        k2.set(k2.get() + 1);
        std::fs::write(p, format!("{{\"n\": {}}}", k2.get())).unwrap();
    })));
    let e = app.set_folder_setting("d", serde_json::json!(4)).unwrap_err();
    app::set_write_hook(None);
    assert!(e.contains("kept changing"), "{e}");
    assert_eq!(k.get(), 3);
    let _ = std::fs::remove_dir_all(&v);
}

// ---- text::unlink_unknown: links inside links ----

#[test]
fn a_link_inside_a_link_never_survives_unlinking() {
    use outline_core::text::unlink_unknown;
    let known = |n: &str| n == "Known";
    // bad input: an unknown name wrapped in extra brackets, at any depth
    for t in ["[[[[Invented]]]]", "[[[[[[Invented]]]]]]", "#[[[[Invented]]]]", "see [[[[Invented]]]] now"] {
        let (out, gone) = unlink_unknown(t, &known);
        assert!(!out.contains("[["), "{t:?} left a link: {out:?}");
        assert!(out.contains("Invented"), "{t:?} lost the words: {out:?}");
        assert_eq!(gone, vec!["Invented".to_string()], "{t:?}");
    }
    // normal case: one layer, known and unknown side by side
    let (out, gone) = unlink_unknown("[[Known]] and [[Other]] and #tag", &known);
    assert_eq!(out, "[[Known]] and Other and tag");
    assert_eq!(gone, vec!["Other".to_string(), "tag".to_string()]);
    // a known name in extra brackets keeps one live link, and nothing is reported gone
    let (out, gone) = unlink_unknown("[[[[Known]]]]", &known);
    assert_eq!(out, "[[Known]]");
    assert!(gone.is_empty(), "{gone:?}");
    // code and addresses stay as written; nothing to do gives the text back
    for t in ["`[[[[Invented]]]]`", "plain words", "", "https://x.org/[[a]]"] {
        assert_eq!(unlink_unknown(t, &known).0, t);
    }
    // the same unknown name twice is named once
    let (_, gone) = unlink_unknown("[[A]] [[A]]\n[[[[A]]]]", &known);
    assert_eq!(gone, vec!["A".to_string()]);
}

// ---- task::next_repeat: huge repeaters ----

#[test]
fn a_huge_repeat_never_overflows() {
    use outline_core::task::{complete, next_repeat, When};
    let w = |r: &str| When { date: (2026, 1, 31), time: None, repeat: Some(r.into()) };
    let today = (2026, 3, 1);
    // bad input: steps far past the calendar are not repeats (and never panic)
    for r in [
        "+9223372036854775807d", "+999999999999999y", "+3000000000000000w", "++9223372036854775807m",
        ".+9223372036854775807d", "+99999999999999999999d", "+3660001d", "+523001w", "+120001m", "+10001y",
        "+9000y", "++8000y", "+0d", "+-1d", "+d", "+1x", "+", "",
    ] {
        assert_eq!(next_repeat(&w(r), today), None, "{r:?}");
    }
    // normal cases stay as they were
    assert_eq!(next_repeat(&w("+1d"), today), Some((2026, 2, 1)));
    assert_eq!(next_repeat(&w("++1w"), today), Some((2026, 3, 7)));
    assert_eq!(next_repeat(&w(".+2d"), today), Some((2026, 3, 3)));
    assert_eq!(next_repeat(&w("+1m"), today), Some((2026, 2, 28)));
    assert_eq!(next_repeat(&w("+1y"), today), Some((2027, 1, 31)));
    assert_eq!(next_repeat(&w("+3h"), today), Some((2026, 1, 31)));
    // edges: the longest steps allowed still work while they stay within year 9999
    assert_eq!(next_repeat(&w("+7000y"), today), Some((9026, 1, 31)));
    assert_eq!(next_repeat(&w("++5000y"), today), Some((7026, 1, 31)));
    assert_eq!(next_repeat(&w("+10000y"), today), None);
    assert!(next_repeat(&w("+2000000d"), today).is_some());
    assert_eq!(next_repeat(&w("+3660000d"), today), None);
    // and a repeating task with a huge repeater is left as written instead of panicking
    let t = "TODO x\nSCHEDULED: <2026-01-31 Sat +9223372036854775807d>";
    assert_eq!(complete(t, today), t);
}

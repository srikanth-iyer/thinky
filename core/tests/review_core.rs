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

// ---- sizes checked before reading ----

#[test]
fn a_picture_over_the_ai_limit_is_refused_by_its_size() {
    use outline_core::app::{dispatch, App};
    use serde_json::json;
    let v = tmp_vault("bigpic");
    std::fs::create_dir_all(v.join("assets")).unwrap();
    let limit = outline_core::ai::MAX_PICTURE_BYTES;
    std::fs::write(v.join("assets/big.png"), vec![0u8; limit + 1]).unwrap();
    std::fs::write(v.join("assets/ok.png"), vec![0u8; limit]).unwrap();
    let mut st = Some(App::open(&v).unwrap());
    let setup = json!({ "provider": "ollama", "base": "http://localhost:11434", "model": "llava" });
    let err = dispatch(&mut st, "ai_picture_request", json!({ "setup": setup, "text": "![](../assets/big.png)" })).unwrap_err();
    assert!(err.contains("5.0 MB") && err.contains("at most 5 MB"), "{err}");
    // exactly at the limit is sent
    let ok = dispatch(&mut st, "ai_picture_request", json!({ "setup": setup, "text": "![](../assets/ok.png)" }));
    assert!(ok.is_ok(), "{ok:?}");
    // a missing picture still says so
    let err = dispatch(&mut st, "ai_picture_request", json!({ "setup": setup, "text": "![](../assets/none.png)" })).unwrap_err();
    assert!(err.contains("isn't in the assets folder"), "{err}");
}

#[test]
fn a_file_over_25_mb_is_refused_before_it_is_decoded() {
    use outline_core::app::App;
    let v = tmp_vault("bigasset");
    let mut app = App::open(&v).unwrap();
    let over = format!("data:application/octet-stream;base64,{}", "A".repeat(33_400_000));
    assert_eq!(app.save_asset("big.bin", &over).unwrap_err(), "That file is over 25 MB; pick a smaller one.");
    assert!(!v.join("assets").exists() || std::fs::read_dir(v.join("assets")).unwrap().count() == 0);
    // a small one is still saved
    assert!(app.save_asset("small.txt", "aGk=").unwrap().starts_with("../assets/small"));
}

// ---- app.rs medium rows: title:: on save, aliases on merge, rename order, properties in code ----

/// Save a new page `name` whose doc is `preamble` and one note `text`, through the editor's command.
fn save_new(v: &Path, name: &str, preamble: &str, text: &str) -> serde_json::Value {
    use outline_core::app::dispatch;
    use serde_json::json;
    let mut st = Some(App::open(v).unwrap());
    let pv = dispatch(&mut st, "page", json!({ "name": name })).unwrap();
    let mut doc = pv["doc"].clone();
    doc["preamble"] = json!(preamble);
    doc["blocks"] = json!([{ "depth": 0, "text": text }]);
    dispatch(&mut st, "save", json!({ "name": name, "doc": doc, "base": pv["doc"], "base_hash": pv["hash"], "path": pv["info"]["path"] })).unwrap()
}

#[test]
fn a_new_pages_title_goes_after_its_yaml_header() {
    // bad input: a YAML header (title:: used to go above its ---, so it was no header any more)
    let v = tmp_vault("title-yaml");
    let r = save_new(&v, "con", "---\nauthor: me\n---\n", "hi");
    assert_eq!(r["ok"], true, "{r}");
    let t = std::fs::read_to_string(v.join("pages/con___.md")).unwrap();
    assert_eq!(t, "---\nauthor: me\n---\ntitle:: con\n- hi\n");
    let app = App::open(&v).unwrap();
    assert!(app.vault.page_info("con").exists);
    // bad input: subtitle:: is not title::, so the page still gets its title
    let v = tmp_vault("title-subtitle");
    save_new(&v, "con", "subtitle:: Not the name\n", "hi");
    let t = std::fs::read_to_string(v.join("pages/con___.md")).unwrap();
    assert!(t.lines().any(|l| l == "title:: con"), "{t:?}");
    assert!(t.contains("subtitle:: Not the name"), "{t:?}");
    // a page that has its own title:: gets no second one
    let v = tmp_vault("title-own");
    save_new(&v, "con", "title:: con\n", "hi");
    let t = std::fs::read_to_string(v.join("pages/con___.md")).unwrap();
    assert_eq!(t.matches("title::").count(), 1, "{t:?}");
    // the usual case: a name the file holds gets no title::, a plain new page is as before
    let v = tmp_vault("title-plain");
    save_new(&v, "Plain", "", "hi");
    assert_eq!(std::fs::read_to_string(v.join("pages/Plain.md")).unwrap(), "- hi\n");
    let v = tmp_vault("title-none");
    save_new(&v, "con", "", "hi");
    assert_eq!(std::fs::read_to_string(v.join("pages/con___.md")).unwrap(), "title:: con\n- hi\n");
}

#[test]
fn a_merged_pages_aliases_lead_to_the_page_it_went_into() {
    let v = tmp_vault("merge-alias");
    put(&v, "pages/Old.md", "alias:: Former, [[Earlier]]\ntype:: idea\n\n- old note\n");
    put(&v, "pages/New.md", "alias:: Fresh\n\n- new note\n");
    put(&v, "pages/Uses.md", "- see [[Former]] and [[Earlier]] and [[Old]]\n");
    let mut app = App::open(&v).unwrap();
    app.merge_pages("Old", "New").unwrap();
    let t = std::fs::read_to_string(v.join("pages/New.md")).unwrap();
    assert!(t.starts_with("alias:: Fresh, Former, Earlier\n"), "{t:?}");
    assert!(t.contains("type:: idea") && t.contains("old note"), "other properties still come as a note: {t:?}");
    assert!(!t.contains("- alias::") && t.matches("alias::").count() == 1, "{t:?}");
    let app = App::open(&v).unwrap();
    for n in ["Former", "Earlier", "Fresh"] {
        assert_eq!(app.vault.resolve(n), key("New"), "{n}");
    }
    // a target with no aliases gets an alias:: line with its properties; Logseq's first-note
    // properties and YAML headers are found too
    let v = tmp_vault("merge-alias2");
    put(&v, "pages/A.md", "---\naliases: Ay\n---\n- a\n");
    put(&v, "pages/B.md", "- tags:: x\n- b\n");
    put(&v, "pages/C.md", "tags:: y\n\n- c\n");
    put(&v, "pages/D.md", "- d\n");
    let mut app = App::open(&v).unwrap();
    app.merge_pages("A", "B").unwrap();
    let b = std::fs::read_to_string(v.join("pages/B.md")).unwrap();
    assert!(b.starts_with("- tags:: x\n  alias:: Ay\n- b\n"), "in the first note with the page's properties: {b:?}");
    app.merge_pages("B", "C").unwrap();
    let c = std::fs::read_to_string(v.join("pages/C.md")).unwrap();
    assert!(c.starts_with("tags:: y\nalias:: Ay\n\n- c\n"), "after the page's properties: {c:?}");
    // edge: aliases the target has already, or its own name, aren't added twice
    put(&v, "pages/E.md", "alias:: Ay, C\n\n- e\n");
    let mut app = App::open(&v).unwrap();
    app.merge_pages("E", "C").unwrap();
    let c = std::fs::read_to_string(v.join("pages/C.md")).unwrap();
    assert!(c.starts_with("tags:: y\nalias:: Ay\n\n- c\n"), "after the page's properties: {c:?}");
    // a page without aliases merges as before
    app.merge_pages("C", "D").unwrap();
    let d = std::fs::read_to_string(v.join("pages/D.md")).unwrap();
    assert!(d.starts_with("alias:: Ay\n- d\n"), "{d:?}");
}

#[test]
fn a_page_changed_while_merging_is_not_put_in_the_bin() {
    use outline_core::app::set_write_hook;
    let v = tmp_vault("merge-race");
    put(&v, "pages/Old.md", "- old note\n");
    put(&v, "pages/New.md", "- new note\n");
    let mut app = App::open(&v).unwrap();
    // when New is written, Old gets new words from elsewhere
    let old = v.join("pages/Old.md");
    set_write_hook(Some(Box::new(move |p: &Path| {
        if p.ends_with("New.md") {
            std::fs::write(&old, "- old note\n- typed on the phone\n").unwrap();
        }
    })));
    let err = app.merge_pages("Old", "New");
    set_write_hook(None);
    let err = err.unwrap_err();
    assert!(err.contains("changed somewhere else") && err.contains("nothing was merged"), "{err}");
    assert_eq!(std::fs::read_to_string(v.join("pages/Old.md")).unwrap(), "- old note\n- typed on the phone\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/New.md")).unwrap(), "- new note\n", "put back as it was");
}

#[test]
fn a_rename_that_cant_rename_its_file_changes_no_links() {
    use outline_core::app::set_write_hook;
    let v = tmp_vault("rename-order");
    put(&v, "pages/Old.md", "- old, see [[Old]]\n");
    put(&v, "pages/Uses.md", "- see [[Old]]\n");
    let mut app = App::open(&v).unwrap();
    // the new file name turns up while the page's own file is being written
    let turned = v.join("pages/Fresh.md");
    set_write_hook(Some(Box::new(move |p: &Path| {
        if p.ends_with("Old.md") && !turned.exists() {
            std::fs::write(&turned, "- someone else's\n").unwrap();
        }
    })));
    let r = app.rename("Old", "Fresh");
    set_write_hook(None);
    let Err(err) = r else { panic!("renamed over another file") };
    assert!(err.contains("links to it weren't changed"), "{err}");
    assert_eq!(std::fs::read_to_string(v.join("pages/Uses.md")).unwrap(), "- see [[Old]]\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/Fresh.md")).unwrap(), "- someone else's\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/Old.md")).unwrap(), "- old, see [[Old]]\n", "its own words put back");
    // the usual case: the file is renamed and the links follow
    let v = tmp_vault("rename-ok");
    put(&v, "pages/Old.md", "- old [[Old]]\n");
    put(&v, "pages/Uses.md", "- see [[Old]]\n");
    let mut app = App::open(&v).unwrap();
    let r = app.rename("Old", "Fresh").unwrap();
    assert_eq!(r.files_changed, 1);
    assert_eq!(std::fs::read_to_string(v.join("pages/Fresh.md")).unwrap(), "- old [[Fresh]]\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/Uses.md")).unwrap(), "- see [[Fresh]]\n");
    assert!(!v.join("pages/Old.md").exists());
}

#[test]
fn renaming_a_property_leaves_code_alone() {
    let v = tmp_vault("prop-code");
    put(&v, "pages/P.md", "authors:: Ann\n\n- note\n  authors:: Bo\n  ```yaml\n  authors:: in code\n  ```\n  ```inline``` authors:: words\n- ```\n  authors:: code only\n  ```\n");
    let mut app = App::open(&v).unwrap();
    let r = app.rename_property("authors", "author").unwrap();
    assert_eq!(r.lines, 2, "{r:?}");
    let t = std::fs::read_to_string(v.join("pages/P.md")).unwrap();
    assert_eq!(t, "author:: Ann\n\n- note\n  author:: Bo\n  ```yaml\n  authors:: in code\n  ```\n  ```inline``` authors:: words\n- ```\n  authors:: code only\n  ```\n");
    // a property after a one-line ```code``` is a property again
    put(&v, "pages/Q.md", "- x\n  ```a```\n  authors:: Cy\n");
    let mut app = App::open(&v).unwrap();
    app.rename_property("authors", "writer").unwrap();
    assert_eq!(std::fs::read_to_string(v.join("pages/Q.md")).unwrap(), "- x\n  ```a```\n  writer:: Cy\n");
}

// ---- 17b: a rescan is only taken into the folder (and the opening of it) it was read from ----

#[test]
fn a_rescan_of_one_folder_never_lands_in_another() {
    use outline_core::app::collect_changes;
    let a = tmp_vault("rescan-a");
    let b = tmp_vault("rescan-b");
    put(&a, "pages/OnlyInA.md", "- a's note\n");
    put(&b, "pages/OnlyInB.md", "- b's note\n");
    let app_a = App::open(&a).unwrap();
    // a's rescan is being read when the folder is switched to b
    put(&a, "pages/New in A.md", "- new\n");
    std::fs::remove_file(a.join("pages/OnlyInA.md")).unwrap();
    let plan = app_a.scan_plan();
    drop(app_a);
    let ch = collect_changes(plan);
    assert_eq!(ch.root, a, "the changes say where they were read");
    let mut app_b = App::open(&b).unwrap();
    assert!(app_b.apply_changes(ch).is_empty(), "nothing of a's goes into b");
    assert!(!app_b.vault.page_info("New in A").exists);
    assert!(app_b.vault.page_info("OnlyInB").exists, "b's own pages stay");
    // the same folder opened again meanwhile: an earlier opening's rescan is ignored too
    let first = App::open(&b).unwrap();
    put(&b, "pages/Later.md", "- later\n");
    let ch = collect_changes(first.scan_plan());
    std::fs::remove_file(b.join("pages/Later.md")).unwrap();
    let mut again = App::open(&b).unwrap();
    assert!(again.apply_changes(ch).is_empty());
    assert!(!again.vault.page_info("Later").exists);
    // the usual case: a rescan of the open folder is taken in
    put(&b, "pages/Fresh.md", "- fresh\n");
    let ch = collect_changes(again.scan_plan());
    assert_eq!(again.apply_changes(ch), vec!["pages/Fresh.md".to_string()]);
    assert!(again.vault.page_info("Fresh").exists);
    assert!(again.rescan().is_empty(), "nothing more");
}

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

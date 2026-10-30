//! Starting from scratch (start.rs): "New folder" in the folder picker, and a new notes folder set up
//! in Logseq's layout with the tour's pages. The files must be ones Logseq reads as its own, and
//! nothing that's there may ever be written over.
use outline_core::app::{check_vault, dispatch, list_dir, set_cache_dir, App};
use outline_core::start::{folder_name_problem, new_folder, start_notes, START_PAGE};
use outline_core::{join_doc, split_doc, Config};
use serde_json::json;
use std::path::{Path, PathBuf};

fn tmp(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_start_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    std::fs::create_dir_all(&v).unwrap();
    v
}
fn cache() {
    set_cache_dir(std::env::temp_dir().join(format!("outline_start_cache_{}", std::process::id())));
}
fn get(v: &Path, rel: &str) -> String {
    std::fs::read_to_string(v.join(rel)).unwrap()
}
/// Every file under `dir` with its bytes, sorted (to check nothing changed).
fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = vec![];
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                out.push((p.strip_prefix(dir).unwrap().display().to_string() + "/", vec![]));
                stack.push(p);
            } else {
                out.push((p.strip_prefix(dir).unwrap().display().to_string(), std::fs::read(&p).unwrap()));
            }
        }
    }
    out.sort();
    out
}
const TODAY: (i32, u32, u32) = (2026, 10, 28);

#[test]
fn folder_names() {
    for bad in ["", "   ", ".", "..", "a/b", "a\\b", "what?", "x:y", "star*", "<x>", "pipe|", "quote\"", ".hidden", "dot.", "con", "NUL", "Com1", "lpt9.txt", "aux.notes"] {
        assert!(folder_name_problem(bad).is_some(), "{bad:?} should be refused");
    }
    for ok in ["Notes", "My notes", "Notes 2026", "  padded  ", "Ünïcødé 🗒", "consul", "v1.2", "con-notes"] {
        assert!(folder_name_problem(ok).is_none(), "{ok:?} should be fine: {:?}", folder_name_problem(ok));
    }
}

#[test]
fn new_folder_never_over_one_that_is_there() {
    let d = tmp("newfolder");
    let made = new_folder(&d, "  My notes ").unwrap();
    assert_eq!(made, d.join("My notes"));
    assert!(made.is_dir());
    std::fs::write(made.join("keep.txt"), "mine").unwrap();
    // the same name again, in any capitals: refused, and what's in it stays
    for again in ["My notes", "my NOTES"] {
        let e = new_folder(&d, again).unwrap_err();
        assert!(e.contains("already"), "{e}");
    }
    assert_eq!(get(&made, "keep.txt"), "mine");
    // a file of that name counts too
    std::fs::write(d.join("report.txt"), "x").unwrap();
    assert!(new_folder(&d, "report.txt").unwrap_err().contains("already"));
    // names that would escape the folder or that Windows can't hold
    for bad in ["..", "../out", "a/b", "con"] {
        assert!(new_folder(&d, bad).is_err(), "{bad}");
    }
    assert!(!d.parent().unwrap().join("out").exists());
    // a parent that isn't there
    assert!(new_folder(&d.join("missing"), "x").is_err());
    // through dispatch, as the picker asks
    let mut st = None;
    let v = dispatch(&mut st, "new_folder", json!({"path": d.display().to_string(), "name": "Second"})).unwrap();
    assert_eq!(v.as_str().unwrap(), d.join("Second").display().to_string());
    assert!(dispatch(&mut st, "new_folder", json!({"path": d.display().to_string(), "name": "second"})).is_err());
}

#[test]
fn a_new_notes_folder_is_logseqs_layout_with_the_tour() {
    cache();
    let d = tmp("tour");
    let s = start_notes(&d, Some(TODAY), true).unwrap();
    assert_eq!(s.start.as_deref(), Some(START_PAGE));
    for dir in ["pages", "journals", "logseq"] {
        assert!(d.join(dir).is_dir(), "{dir}");
    }
    let mut made = s.made.clone();
    made.sort();
    assert_eq!(made, ["journals/2026_10_28.md", "logseq/config.edn", "pages/Finding things.md", "pages/Journal and to-dos.md", "pages/Links and tags.md", "pages/Start here.md"]);
    // the settings: Logseq 0.10's default date formats and folders, read back as the app reads them
    let cfg = Config::from_edn(&get(&d, "logseq/config.edn"));
    assert_eq!((cfg.journal_title_format.as_str(), cfg.journal_file_format.as_str()), ("MMM do, yyyy", "yyyy_MM_dd"));
    assert_eq!((cfg.pages_dir.as_str(), cfg.journals_dir.as_str(), cfg.workflow.as_str()), ("pages", "journals", "todo"));
    assert_eq!(cfg.favorites, [START_PAGE]);
    let edn = get(&d, "logseq/config.edn");
    assert!(edn.starts_with("{:meta/version 1\n") && edn.contains(":preferred-format :markdown") && edn.trim_end().ends_with('}'), "{edn}");
    assert!(outline_core::edn::parse(&edn).is_some(), "config.edn is EDN");
    // Logseq's own shape: "- " bullets, tabs for sub-notes, \n line ends, a final line break, no BOM
    for rel in &made {
        let t = get(&d, rel);
        assert!(!t.contains('\r') && !t.starts_with('\u{feff}') && t.ends_with('\n'), "{rel}");
        if rel.ends_with(".md") {
            for line in t.lines() {
                let body = line.trim_start_matches('\t');
                assert!(body.starts_with("- "), "{rel}: {line:?}");
                assert!(!line.starts_with(' '), "{rel}: tabs, not spaces: {line:?}");
            }
            // and every file is written back exactly as it is (the editor's rule)
            let doc = split_doc(&t);
            assert_eq!(join_doc(&doc), t, "{rel}");
        }
    }
    // the app opens it: the tour's pages, today's note, links between them, a to-do to tick
    let app = App::open(&d).unwrap();
    let mut st = Some(app);
    let page = dispatch(&mut st, "page", json!({"name": START_PAGE})).unwrap();
    assert!(page["info"]["exists"].as_bool().unwrap());
    let refs: Vec<String> = page["refs"].as_array().unwrap().iter().map(|g| g["page"].as_str().unwrap_or("").to_string()).collect();
    assert!(refs.iter().any(|p| p == "Links and tags") && refs.iter().any(|p| p == "Oct 28th, 2026"), "{refs:?}");
    let tasks = dispatch(&mut st, "tasks", json!({"done": false})).unwrap();
    assert!(tasks.as_array().unwrap().iter().any(|t| t["text"].as_str().unwrap().starts_with("TODO Tick this box")), "{tasks}");
    let today = dispatch(&mut st, "page", json!({"name": "Oct 28th, 2026"})).unwrap();
    assert!(today["doc"]["blocks"][1]["text"].as_str().unwrap().contains("[[Start here]]"), "{}", today["doc"]);
    // the health check finds nothing to fix
    let r = check_vault(&d).unwrap();
    assert!(r.roundtrip_failures.is_empty() && r.non_utf8.is_empty() && r.duplicates.is_empty(), "{:?}", r.roundtrip_failures);
    assert_eq!(r.pages, 5, "the tour’s 4 pages and today");
}

#[test]
fn without_the_tour_only_the_folders_and_settings() {
    let d = tmp("plain");
    let s = start_notes(&d, Some(TODAY), false).unwrap();
    assert_eq!(s.made, ["logseq/config.edn"]);
    assert_eq!(s.start, None);
    assert!(d.join("pages").is_dir() && d.join("journals").is_dir());
    assert_eq!(std::fs::read_dir(d.join("pages")).unwrap().count(), 0);
    assert!(Config::from_edn(&get(&d, "logseq/config.edn")).favorites.is_empty());
    // through dispatch (the welcome screen's "Create"), today given as the app gives it
    let d2 = tmp("plain2");
    let mut st = None;
    let v = dispatch(&mut st, "start_notes", json!({"path": d2.display().to_string(), "today": [2026, 10, 28], "demo": true})).unwrap();
    assert_eq!(v["start"], "Start here");
    assert!(d2.join("journals/2026_10_28.md").is_file());
    let v = dispatch(&mut st, "start_notes", json!({"path": tmp("plain3").display().to_string()})).unwrap(); // (no day: no journal note)
    assert!(!v["made"].as_array().unwrap().iter().any(|m| m.as_str().unwrap().starts_with("journals/")));
}

#[test]
fn nothing_there_is_written_over() {
    let d = tmp("keep");
    // a folder with other things in it, a journals folder holding today already, a page by a tour name
    std::fs::write(d.join("letter.docx"), b"\x00\x01binary").unwrap();
    std::fs::create_dir_all(d.join("journals")).unwrap();
    std::fs::write(d.join("journals/2026_10_28.md"), "- my own day\r\n- no final line break").unwrap();
    std::fs::create_dir_all(d.join("Old stuff")).unwrap();
    std::fs::write(d.join("Old stuff/a.md"), "\u{feff}- kept\n").unwrap();
    let before = snapshot(&d);
    let s = start_notes(&d, Some(TODAY), true).unwrap();
    assert!(!s.made.iter().any(|m| m.starts_with("journals/")), "{:?}", s.made);
    let after = snapshot(&d);
    for (rel, bytes) in &before {
        let now = after.iter().find(|(r, _)| r == rel).unwrap_or_else(|| panic!("{rel} gone"));
        assert_eq!(&now.1, bytes, "{rel} changed");
    }
    // a second time: it's a notes folder now, so it's refused and nothing changes
    let again = snapshot(&d);
    let e = start_notes(&d, Some(TODAY), true).unwrap_err();
    assert!(e.contains("notes folder already"), "{e}");
    assert_eq!(snapshot(&d), again);
}

#[test]
fn refused_in_or_inside_a_notes_folder_and_when_something_is_in_the_way() {
    let v = tmp("vault");
    std::fs::create_dir_all(v.join("pages")).unwrap();
    std::fs::create_dir_all(v.join("assets/sub")).unwrap();
    std::fs::write(v.join("pages/a.md"), "- a\n").unwrap();
    let before = snapshot(&v);
    assert!(start_notes(&v, None, true).unwrap_err().contains("notes folder already"));
    let e = start_notes(&v.join("assets/sub"), None, true).unwrap_err();
    assert!(e.contains("inside the notes folder"), "{e}");
    // the same for a folder of Logseq's settings only
    let c = tmp("cfgonly");
    std::fs::create_dir_all(c.join("logseq/x")).unwrap();
    std::fs::write(c.join("logseq/config.edn"), "{}").unwrap();
    assert!(start_notes(&c.join("logseq/x"), None, true).unwrap_err().contains("inside the notes folder"));
    assert_eq!(snapshot(&v), before);
    // a file called "journals" where the folder would go: nothing at all is made
    let f = tmp("inway");
    std::fs::write(f.join("journals"), "not a folder").unwrap();
    let e = start_notes(&f, Some(TODAY), true).unwrap_err();
    assert!(e.contains("journals"), "{e}");
    assert!(!f.join("pages").exists() && !f.join("logseq").exists());
    assert!(start_notes(&f.join("missing"), None, true).is_err());
}

#[test]
fn the_picker_says_what_a_folder_holds() {
    let d = tmp("picker");
    std::fs::write(d.join("a.txt"), "").unwrap();
    std::fs::write(d.join("b.pdf"), "").unwrap();
    std::fs::write(d.join(".hidden"), "").unwrap();
    std::fs::create_dir_all(d.join("Notes/pages/deep")).unwrap();
    std::fs::create_dir_all(d.join("Empty")).unwrap();
    let l = list_dir(&d.display().to_string()).unwrap();
    assert_eq!((l.files, l.vault, l.inside.is_none()), (2, false, true));
    assert_eq!(l.dirs.iter().map(|x| (x.name.as_str(), x.vault)).collect::<Vec<_>>(), [("Empty", false), ("Notes", true)]);
    let e = list_dir(&d.join("Empty").display().to_string()).unwrap();
    assert_eq!((e.files, e.dirs.len(), e.vault), (0, 0, false));
    let n = list_dir(&d.join("Notes").display().to_string()).unwrap();
    assert!(n.vault && n.inside.is_none());
    let deep = list_dir(&d.join("Notes/pages/deep").display().to_string()).unwrap();
    assert_eq!(deep.inside.as_deref(), Some(d.join("Notes").display().to_string().as_str()));
}

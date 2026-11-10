//! Build 43: a sync app's conflict copy compared with its page (App::compare_copy): the notes both
//! have as they are, each stretch only one has (or both have differently) a choice; the page found
//! from the copy's name; only real conflict copies; the copy to the bin afterwards (bin_copy).
use outline_core::app::{set_cache_dir, App};
use outline_core::merge::Part;
use std::path::{Path, PathBuf};

fn tmp(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_ccopy_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    std::fs::create_dir_all(&v).unwrap();
    v
}
fn put(v: &Path, rel: &str, text: &str) {
    let p = v.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}
fn texts(b: &[outline_core::DocBlock]) -> Vec<&str> {
    b.iter().map(|x| x.text.as_str()).collect()
}

#[test]
fn a_conflict_copy_compared_with_its_page() {
    let v = tmp("notes");
    put(&v, "logseq/config.edn", "{:journal/page-title-format \"MMMM do, yyyy\" :journals-directory \"Daily\"}");
    put(&v, "Daily/2026_11_07.md", "- morning walk\n- read the paper\n- call Sam\n- dinner\n");
    put(&v, "Daily/November 7th, 2026 (conflict 2026-11-08-13-18-30).md", "- morning walk\n- wrote on the phone\n- call Sam\n- dinner\n- one more thing\n");
    put(&v, "pages/Same.md", "- a\n");
    put(&v, "pages/Same (1).md", "- a\n");
    put(&v, "pages/Lonely (conflict 2026-01-01).md", "- b\n");
    set_cache_dir(tmp("cache"));
    let mut app = App::open(&v).unwrap();

    // a journal day's copy named by the day's title (not its file's name): the page of that name
    let c = app.compare_copy("Daily/November 7th, 2026 (conflict 2026-11-08-13-18-30).md").unwrap();
    assert_eq!((c.path.as_str(), c.differ), ("Daily/2026_11_07.md", true));

    put(&v, "Daily/2026_11_07 (conflict 2026-11-09-07-19-54).md", "- morning walk\n- wrote on the phone\n- call Sam\n- dinner\n- one more thing\n");
    let mut app2 = App::open(&v).unwrap();
    let c = app2.compare_copy("Daily/2026_11_07 (conflict 2026-11-09-07-19-54).md").unwrap();
    assert_eq!((c.path.as_str(), c.name.as_str(), c.differ), ("Daily/2026_11_07.md", "November 7th, 2026", true));
    let parts = c.parts.unwrap();
    let kinds: Vec<String> = parts
        .iter()
        .map(|p| match p {
            Part::Same { blocks } => format!("same {:?}", texts(blocks)),
            Part::Clash { mine, theirs, .. } => format!("choose {:?} | {:?}", texts(mine), texts(theirs)),
        })
        .collect();
    assert_eq!(
        kinds,
        vec![
            r#"same ["morning walk"]"#,
            r#"choose ["read the paper"] | ["wrote on the phone"]"#,
            r#"same ["call Sam", "dinner"]"#,
            r#"choose [] | ["one more thing"]"#,
        ]
    );
    assert!(c.preamble.is_none());

    // spaces at line ends and the fold mark aren't differences: no choice for them
    put(&v, "pages/Spaces.md", "- one\n\t- two\n- three\n");
    put(&v, "pages/Spaces (conflict 2026-11-08).md", "- one \n  collapsed:: true\n\t- two\n- three changed\n");
    let app3 = App::open(&v).unwrap();
    let c = app3.compare_copy("pages/Spaces (conflict 2026-11-08).md").unwrap();
    let choices: Vec<_> = c.parts.unwrap().into_iter().filter_map(|p| match p { Part::Clash { mine, theirs, .. } => Some((texts(&mine).join("|"), texts(&theirs).join("|"))), _ => None }).collect();
    assert_eq!(choices, vec![("three".to_string(), "three changed".to_string())]);

    // the same words: nothing to choose, only the file can go
    let c = app2.compare_copy("pages/Same (1).md").unwrap();
    assert!(!c.differ);
    // not a conflict copy, or one whose page isn't there
    assert!(app2.compare_copy("pages/Same.md").is_err());
    assert!(app2.compare_copy("pages/Lonely (conflict 2026-01-01).md").unwrap_err().contains("isn't there"));
    assert!(app2.compare_copy("../x.md").is_err());

    // to the bin afterwards; the page itself untouched
    app2.bin_copy("pages/Same (1).md").unwrap();
    assert!(!v.join("pages/Same (1).md").exists() && v.join("pages/Same.md").exists());
    assert!(std::fs::read_dir(v.join("logseq/.recycle")).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains("Same (1)")));
    assert!(app2.bin_copy("pages/Same.md").is_err(), "never the page itself");
    let _ = app.bin_copy("pages/Lonely (conflict 2026-01-01).md").unwrap_err();
    let _ = std::fs::remove_dir_all(&v);
}

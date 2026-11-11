//! Actions that change many files in one go (a rename's and a merge's link files, a property renamed
//! everywhere, a merge's Undo) work on several files at the same time (`each_file` in app.rs, Build 44):
//! each file is still flushed before it replaces the old one, and the result must be exactly what
//! doing them one after another gave. These tests use enough files to take that path (8 or more).

use outline_core::app::{set_cache_dir, App};
use std::path::{Path, PathBuf};

fn vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_many_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}
fn put(v: &Path, rel: &str, text: &str) {
    std::fs::write(v.join(rel), text).unwrap();
}
fn get(v: &Path, rel: &str) -> Vec<u8> {
    std::fs::read(v.join(rel)).unwrap()
}
/// One cache folder for this test program (it can be set only once).
fn cache() {
    set_cache_dir(std::env::temp_dir().join(format!("outline_many_cache_{}", std::process::id())));
}

/// A linking page in one of the shapes real files have: tabs, CRLF, a byte-order mark, no last line
/// break. `link` is how the page is written in it.
fn shaped(i: usize, link: &str) -> String {
    match i % 4 {
        0 => format!("- note {i} with [[{link}]]\n\t- a child, #{link} too\n"),
        1 => format!("- note {i}\r\n  about:: [[{link}]]\r\n- more\r\n"),
        2 => format!("\u{feff}- [[{link}]] first in note {i}\n- unrelated\n"),
        _ => format!("- note {i} ends with [[{link}]]"),
    }
}

#[test]
fn a_rename_changes_every_link_file_exactly() {
    cache();
    let v = vault("rename");
    put(&v, "pages/Old.md", "- the page itself\n");
    const N: usize = 60;
    for i in 0..N {
        put(&v, &format!("pages/P{i:02}.md"), &shaped(i, "Old"));
    }
    put(&v, "pages/Bystander.md", "- nothing about it\n");
    let bystander = get(&v, "pages/Bystander.md");
    let mut app = App::open(&v).unwrap();
    // one of them saved by another program after the app read it: the rename works on what the file
    // holds now, never on what the app remembered
    put(&v, "pages/P07.md", "- changed elsewhere, still [[Old]]\n- and a new note\n");
    let r = app.rename("Old", "New").unwrap();
    assert_eq!((r.files_changed, r.skipped.len()), (N, 0), "{:?}", r.skipped);
    for i in 0..N {
        let want = if i == 7 { "- changed elsewhere, still [[New]]\n- and a new note\n".to_string() } else { shaped(i, "New") };
        assert_eq!(String::from_utf8(get(&v, &format!("pages/P{i:02}.md"))).unwrap(), want, "file {i}");
    }
    assert_eq!(get(&v, "pages/Bystander.md"), bystander, "a file without a link isn't touched");
    assert!(v.join("pages/New.md").exists() && !v.join("pages/Old.md").exists());
    // the app knows what it wrote: every page links to the new name, and looking at the folder again
    // finds nothing it didn't know (each file's stamp was noted right after its own write)
    assert_eq!(app.vault.linking_pages("New").len(), N);
    assert!(app.vault.linking_pages("Old").is_empty());
    assert_eq!(app.rescan(), Vec::<String>::new());
    // no temp file left behind
    let left: Vec<_> = std::fs::read_dir(v.join("pages")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".tmp")).collect();
    assert!(left.is_empty(), "{left:?}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_property_renamed_in_many_files() {
    cache();
    let v = vault("prop");
    const N: usize = 40;
    for i in 0..N {
        // (file i has i % 3 + 1 lines with the property)
        let mut t = format!("- note {i}\n  authors:: A{i}\n");
        for k in 0..i % 3 {
            t += &format!("- another {k}\n  authors:: B{k}\n");
        }
        put(&v, &format!("pages/Q{i:02}.md"), &t);
    }
    let mut app = App::open(&v).unwrap();
    let r = app.rename_property("authors", "author").unwrap();
    let lines: usize = (0..N).map(|i| i % 3 + 1).sum();
    assert_eq!((r.files_changed, r.lines, r.skipped.len()), (N, lines, 0));
    for i in 0..N {
        let t = String::from_utf8(get(&v, &format!("pages/Q{i:02}.md"))).unwrap();
        assert!(t.starts_with(&format!("- note {i}\n  author:: A{i}\n")) && !t.contains("authors::"), "file {i}: {t}");
        assert_eq!(t.matches("author::").count(), i % 3 + 1, "file {i}");
    }
    assert_eq!(app.rescan(), Vec::<String>::new());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_merge_and_its_undo_over_many_link_files() {
    cache();
    let v = vault("merge");
    put(&v, "pages/Foo.md", "- foo's note\n");
    put(&v, "pages/Bar.md", "- bar's note\n");
    const N: usize = 30;
    for i in 0..N {
        put(&v, &format!("pages/M{i:02}.md"), &shaped(i, "Foo"));
    }
    let before: Vec<Vec<u8>> = (0..N).map(|i| get(&v, &format!("pages/M{i:02}.md"))).collect();
    let mut app = App::open(&v).unwrap();
    let r = app.merge_pages("Foo", "Bar").unwrap();
    assert_eq!((r.files_changed, r.skipped.len()), (N, 0));
    for i in 0..N {
        assert_eq!(String::from_utf8(get(&v, &format!("pages/M{i:02}.md"))).unwrap(), shaped(i, "Bar"), "file {i}");
    }
    // Undo: every file back, byte for byte
    app.undo_merge(r.undo).unwrap();
    for (i, b) in before.iter().enumerate() {
        assert_eq!(&get(&v, &format!("pages/M{i:02}.md")), b, "file {i} after Undo");
    }
    assert_eq!(String::from_utf8(get(&v, "pages/Foo.md")).unwrap(), "- foo's note\n");
    assert_eq!(app.vault.linking_pages("Foo").len(), N);
    assert_eq!(app.rescan(), Vec::<String>::new());
    let _ = std::fs::remove_dir_all(&v);
}

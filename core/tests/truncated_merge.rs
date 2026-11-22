//! Review claim 2 ("dropped notes", Nov 22, 2026): a page file cut short on disk by another program
//! (a sync app caught mid-write) at the moment the app saves. The merge can't tell a file cut after a
//! note from notes deleted on another device, so the page as it was goes to logseq/bak first; a file
//! cut in the middle of a line is a clash. Before the fix, notes 3-5 were gone with no copy anywhere.
//! A test program of its own: the data folder (safety copies) is set once per program.
use outline_core::app::{set_data_dir, App, SaveReq};
use std::path::{Path, PathBuf};

fn setup(tag: &str) -> PathBuf {
    static BASE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    let base = BASE.get_or_init(|| {
        let b = std::env::temp_dir().join(format!("outline_trunc_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&b);
        b
    });
    set_data_dir(base.join("data"));
    let v = base.join(tag);
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq", "assets"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}

fn put(v: &Path, rel: &str, text: &str) {
    std::fs::write(v.join(rel), text).unwrap();
}

/// The copies in logseq/bak (the page's backups, listed by History).
fn bak_copies(v: &Path) -> Vec<String> {
    all_files(&v.join("logseq").join("bak")).into_iter().map(|(_, t)| t).collect()
}

/// Every file under `dir` (recursive) and its text, lossily.
fn all_files(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(all_files(&p));
        } else {
            out.push((p.clone(), String::from_utf8_lossy(&std::fs::read(&p).unwrap()).into_owned()));
        }
    }
    out
}

const FULL: &str = "- note one\n- note two\n- note three\n- note four\n- note five\n";
const REL: &str = "pages/Note.md";

/// Open, read the page, then `disk` replaces the file (cut short), optionally taken in by a rescan
/// first, then the app saves an edit to note 1. Returns (ok, conflict, file after, any kept copy
/// holding "note five").
fn run(tag: &str, disk: &str, rescan_first: bool) -> (bool, bool, String, Vec<PathBuf>) {
    let v = setup(tag);
    put(&v, REL, FULL);
    let mut app = App::open(&v).unwrap();
    let pv = app.page("Note", None);
    let (hash, base) = (pv.hash.clone(), pv.doc.clone());
    let mut mine = base.clone();
    mine.blocks[0].text = "note one, edited here".into();
    put(&v, REL, disk); // the half-written file
    if rescan_first {
        app.rescan();
    }
    let r = app
        .save(SaveReq { name: "Note".into(), doc: mine, base_hash: hash, force: false, path: Some(REL.into()), base: Some(base) })
        .unwrap();
    app.persist(); // index cache and any safety copy of replaced texts
    let after = std::fs::read_to_string(v.join(REL)).unwrap();
    let mut kept: Vec<PathBuf> = all_files(&v.join("logseq")).into_iter().filter(|(_, t)| t.contains("note five")).map(|(p, _)| p).collect();
    // the device-local safety copies too (only used when the notes folder can't be written)
    kept.extend(all_files(&std::env::temp_dir().join(format!("outline_trunc_{}", std::process::id())).join("data")).into_iter().filter(|(_, t)| t.contains("note five")).map(|(p, _)| p));
    println!("--- {tag}\nok={} conflict={}\nsaved file:\n{after}kept copies holding note five: {kept:?}", r.ok, r.conflict);
    (r.ok, r.conflict, after, kept)
}

#[test]
fn cut_at_a_note_boundary_keeps_a_copy_in_bak() {
    // saved like a deletion made elsewhere (it can't be told apart), but the full page is kept
    let (ok, conflict, after, kept) = run("boundary", "- note one\n- note two\n", false);
    assert!(ok && !conflict, "saved without a clash");
    assert_eq!(after, "- note one, edited here\n- note two\n");
    assert!(kept.iter().any(|p| p.to_string_lossy().contains("bak")), "a logseq/bak copy holds note five: {kept:?}");
}

#[test]
fn the_bak_copy_is_the_page_as_it_was() {
    let (_, _, _, _) = run("exact", "- note one\n- note two\n", false);
    let base = std::env::temp_dir().join(format!("outline_trunc_{}", std::process::id())).join("exact");
    assert_eq!(bak_copies(&base), vec![FULL.to_string()], "one copy, the exact bytes last read");
}

#[test]
fn cut_mid_line_is_a_clash() {
    let (ok, conflict, after, _) = run("midline", "- note one\n- note two\n- note th", false);
    assert!(!ok && conflict, "a file cut off in the middle of a line is never merged");
    assert_eq!(after, "- note one\n- note two\n- note th", "the file is left as it is");
}

#[test]
fn cut_short_taken_in_by_a_rescan_first() {
    // the file watcher saw the cut file before the save: still a copy in logseq/bak
    let (ok, conflict, after, kept) = run("rescan", "- note one\n- note two\n", true);
    assert!(ok && !conflict);
    assert_eq!(after, "- note one, edited here\n- note two\n");
    assert!(kept.iter().any(|p| p.to_string_lossy().contains("bak")), "{kept:?}");
}

#[test]
fn cut_to_empty_is_a_clash() {
    let (ok, conflict, after, _) = run("empty", "", false);
    assert!(!ok && conflict, "an empty file vs an edit is a clash");
    assert_eq!(after, "");
}

#[test]
fn edit_in_the_cut_tail_is_a_clash() {
    let v = setup("tailedit");
    put(&v, REL, FULL);
    let mut app = App::open(&v).unwrap();
    let pv = app.page("Note", None);
    let mut mine = pv.doc.clone();
    mine.blocks[4].text = "note five, edited here".into();
    put(&v, REL, "- note one\n- note two\n");
    let r = app.save(SaveReq { name: "Note".into(), doc: mine, base_hash: pv.hash, force: false, path: Some(REL.into()), base: Some(pv.doc) }).unwrap();
    assert!(!r.ok && r.conflict);
}

#[test]
fn a_merge_that_removes_nothing_keeps_no_copy() {
    // the usual case (a note added or edited elsewhere) stays quiet: no clutter in logseq/bak
    for (tag, disk) in [("added", "- note one\n- note two\n- note three\n- note four\n- note five\n- note six\n"), ("edited", "- note one\n- note two\n- note three\n- note four\n- note five, phone\n")] {
        let (ok, conflict, _, _) = run(tag, disk, false);
        assert!(ok && !conflict, "{tag}: merged");
        let base = std::env::temp_dir().join(format!("outline_trunc_{}", std::process::id())).join(tag);
        assert!(bak_copies(&base).is_empty(), "{tag}: no copy");
    }
}

#[test]
fn removed_on_my_side_only_keeps_no_copy() {
    // this device deleted note 5 and the other side edited note 1: nothing the other side removed
    let v = setup("minedel");
    put(&v, REL, FULL);
    let mut app = App::open(&v).unwrap();
    let pv = app.page("Note", None);
    let mut mine = pv.doc.clone();
    mine.blocks.pop();
    put(&v, REL, "- note one, phone\n- note two\n- note three\n- note four\n- note five\n");
    let r = app.save(SaveReq { name: "Note".into(), doc: mine, base_hash: pv.hash, force: false, path: Some(REL.into()), base: Some(pv.doc) }).unwrap();
    assert!(r.ok && !r.conflict);
    assert_eq!(std::fs::read_to_string(v.join(REL)).unwrap(), "- note one, phone\n- note two\n- note three\n- note four\n");
    assert!(bak_copies(&v).is_empty());
}

#[test]
fn an_edit_elsewhere_plus_a_cut_tail_still_keeps_a_copy() {
    // the other version changed note 2 and lost notes 4-5: more notes gone than new ones
    let (ok, conflict, after, kept) = run("editcut", "- note one\n- note two, phone\n- note three\n", false);
    assert!(ok && !conflict);
    assert_eq!(after, "- note one, edited here\n- note two, phone\n- note three\n");
    assert!(kept.iter().any(|p| p.to_string_lossy().contains("bak")), "{kept:?}");
}

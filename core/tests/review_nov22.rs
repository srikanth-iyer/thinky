//! The Nov 22 review's points that were checked and fixed on Nov 23 (one test each, failing before the fix).
use outline_core::app::{set_cache_dir, set_write_hook, App, SaveReq};
use outline_core::merge::{clash_parts, merge_blocks, Part};
use outline_core::{content_hash, page_name_from_stem, split_doc, Doc};
use std::path::{Path, PathBuf};

/// A new, empty notes folder for one test (its name says which test, so tests running at once don't meet).
fn folder(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_nov22_{tag}_{}", std::process::id())); // a folder only this test uses
    let _ = std::fs::remove_dir_all(&v); // left over from an earlier run: start clean
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap(); // the folders a notes folder has
    }
    set_cache_dir(v.join("cache")); // the app's own cache goes inside it too
    v
}

/// Write one file into the notes folder.
fn put(v: &Path, rel: &str, text: &str) {
    std::fs::write(v.join(rel), text).unwrap();
}

/// A save request as the app's page sends it (built through JSON, as the real one is).
fn save_req(name: &str, doc: &Doc, base_hash: String, base: &Doc, path: &str) -> SaveReq {
    let json = |d: &Doc| {
        serde_json::json!({ "preamble": d.preamble, "indent": d.indent, "crlf": d.crlf,
            "blocks": d.blocks.iter().map(|b| serde_json::json!({"depth": b.depth, "text": b.text, "raw": b.raw, "plain": b.plain})).collect::<Vec<_>>() })
    };
    serde_json::from_value(serde_json::json!({ "name": name, "doc": json(doc), "base_hash": base_hash, "path": path, "base": json(base) })).unwrap()
}

/// R5: a sync app's copy that says `title:: Foo` ("Foo (1).md", OneDrive's "Foo-LAPTOP.md") sorts
/// before "Foo.md", so at start it took the page's name and opened instead of the real page.
#[test]
fn the_file_named_for_a_page_keeps_its_name_over_a_copy() {
    let v = folder("r5");
    put(&v, "pages/Foo.md", "title:: Foo\n\n- the real page\n");
    put(&v, "pages/Foo (1).md", "title:: Foo\n\n- an older copy\n");
    put(&v, "pages/Bar.md", "title:: Bar\n\n- real\n");
    put(&v, "pages/Bar-LAPTOP.md", "title:: Bar\n\n- a OneDrive copy\n");
    let app = App::open(&v).unwrap();
    assert_eq!(app.vault.page_info("Foo").path.as_deref(), Some("pages/Foo.md")); // the real page opens
    assert_eq!(app.vault.page_info("Bar").path.as_deref(), Some("pages/Bar.md"));
    // Compare and merge on the copy now opens the right page to compare with
    let c = app.compare_copy("pages/Foo (1).md").unwrap();
    assert_eq!(app.vault.page_info(&c.name).path.as_deref(), Some(c.path.as_str()));
}

/// R8: saving words the file already holds (a letter typed and deleted again) wrote the file anyway.
#[test]
fn saving_the_same_words_writes_nothing() {
    let v = folder("r8");
    let text = "- one\n- two\n";
    put(&v, "pages/Same.md", text);
    let mut app = App::open(&v).unwrap();
    let doc = split_doc(text);
    let writes = std::rc::Rc::new(std::cell::Cell::new(0)); // how many files the save wrote
    let w = writes.clone();
    set_write_hook(Some(Box::new(move |_p: &Path| w.set(w.get() + 1))));
    let r = app.save(save_req("Same", &doc, content_hash(text), &doc, "pages/Same.md")).unwrap();
    set_write_hook(None);
    assert!(r.ok && !r.conflict); // the save still counts as done
    assert_eq!(writes.get(), 0); // but nothing was written
    assert_eq!(std::fs::read_to_string(v.join("pages/Same.md")).unwrap(), text);
}

/// R10: a note moved on both devices, to two different places, came out twice with no clash screen.
#[test]
fn a_note_moved_on_both_devices_is_a_clash_not_doubled() {
    let base = split_doc("- A\n- B\n- C\n- D\n- E\n");
    let mine = split_doc("- B\n- C\n- A\n- D\n- E\n"); // the laptop moved A after C
    let theirs = split_doc("- B\n- C\n- D\n- E\n- A\n"); // the phone moved A to the end
    assert!(merge_blocks(&base.blocks, &mine.blocks, &theirs.blocks).is_none()); // not merged blindly
    let parts = clash_parts(&base.blocks, &mine.blocks, &theirs.blocks).unwrap();
    assert!(parts.iter().any(|p| matches!(p, Part::Clash { .. }))); // the clash screen shows it
    // a move on one device only still merges with an edit on the other
    let theirs = split_doc("- A\n- B\n- C changed\n- D\n- E\n");
    let m = merge_blocks(&base.blocks, &mine.blocks, &theirs.blocks).unwrap();
    let texts: Vec<&str> = m.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(texts, ["B", "C changed", "A", "D", "E"]);
}

/// S5: renaming a page rewrote every plain-Markdown file that linked it as bullets.
#[test]
fn a_rename_keeps_plain_markdown_as_it_was() {
    let v = folder("s5");
    let other = "# Heading\n\nSome paragraph that links [[Foo]] here.\nA second line of it.\n\n```\ncode line\n  indented code\n```\n\n* star item\n* another\n";
    put(&v, "pages/Foo.md", "- foo page\n");
    put(&v, "pages/Other.md", other);
    let mut app = App::open(&v).unwrap();
    app.rename("Foo", "Bar").unwrap();
    let after = std::fs::read_to_string(v.join("pages/Other.md")).unwrap();
    assert_eq!(after, other.replace("[[Foo]]", "[[Bar]]")); // only the link changed
}

/// Found while checking S11c: "%+A" became a line break in a page name ("+A" read as the number 10).
#[test]
fn percent_codes_need_two_hex_digits() {
    assert_eq!(page_name_from_stem("x%+A"), "x%+A"); // not a code: kept as written
    assert_eq!(page_name_from_stem("Why%3F"), "Why?"); // a real code still works
    assert_eq!(page_name_from_stem("a%2Fb%3f"), "a/b?"); // small letters too
    assert_eq!(page_name_from_stem("100%"), "100%"); // a "%" at the end stays
}

/// S2: an AI suggestion holding a web picture loaded it from that server as soon as it was shown
/// (Polish note, Picture to text), before Keep. Now a new picture is only a link; the note's own stay.
#[test]
fn an_ai_answer_cannot_load_a_web_picture() {
    use outline_core::ai::{picture_answer, polish_answer};
    use outline_core::text::unpicture_new;
    let v = folder("s2");
    let app = App::open(&v).unwrap();
    // Polish note: the AI added a tracking picture
    let r = polish_answer(&app.vault, "call the bank", "- Call the bank today ![chart](https://outside.example/track.png)", false).unwrap();
    let notes: Vec<String> = serde_json::from_value(r["notes"].clone()).unwrap();
    assert_eq!(notes[0], "Call the bank today [chart](https://outside.example/track.png)"); // a link, never fetched
    // a picture the note already had is kept as a picture
    let own = "see ![plan](../assets/plan.png)";
    let r = polish_answer(&app.vault, own, "- See ![plan](../assets/plan.png)", false).unwrap();
    let notes: Vec<String> = serde_json::from_value(r["notes"].clone()).unwrap();
    assert_eq!(notes[0], "See ![plan](../assets/plan.png)");
    // Picture to text: the same
    let r = picture_answer(&app.vault, "![](../assets/a.png)", "- Total ![x](https://outside.example/t.gif)", false).unwrap();
    assert!(!r.to_string().contains("![x]"));
    // the helper on its own: broken pieces stay as written
    assert_eq!(unpicture_new("a ![b] c ![d](e", ""), "a ![b] c ![d](e");
    assert_eq!(unpicture_new("![a](https://x/y.png) and ![b](z.png)", "z.png"), "[a](https://x/y.png) and ![b](z.png)");
}

// ---------------------------------------------------------------- more cases (Nov 23: the maintainer asked
// for thorough tests of every fix: the main case above, edge cases here)

/// R5: when "Foo.md" itself goes away, the copy that waited takes the page name back; and a file
/// named for a page arriving later (a sync app bringing it) takes the name from a copy too.
#[test]
fn r5_the_name_moves_back_and_forth_as_files_come_and_go() {
    let v = folder("r5_more");
    put(&v, "pages/Foo.md", "title:: Foo\n\n- the real page\n");
    put(&v, "pages/Foo (1).md", "title:: Foo\n\n- an older copy\n");
    let mut app = App::open(&v).unwrap();
    assert_eq!(app.vault.page_info("Foo").path.as_deref(), Some("pages/Foo.md"));
    // the real file is deleted outside the app: the copy is all there is, so it holds the name
    std::fs::remove_file(v.join("pages/Foo.md")).unwrap();
    let plan = app.scan_plan();
    app.apply_changes(outline_core::app::collect_changes(plan));
    assert_eq!(app.vault.page_info("Foo").path.as_deref(), Some("pages/Foo (1).md"));
    // and the real file comes back (a sync app brings it): it takes the name again
    put(&v, "pages/Foo.md", "title:: Foo\n\n- the real page, back\n");
    let plan = app.scan_plan();
    app.apply_changes(outline_core::app::collect_changes(plan));
    assert_eq!(app.vault.page_info("Foo").path.as_deref(), Some("pages/Foo.md"));
}

/// R5: a page whose own file isn't named for it (a page renamed by its title:: line only) keeps its
/// file when no file is named for it; nothing is given back for nothing.
#[test]
fn r5_a_page_named_only_by_its_title_keeps_its_file() {
    let v = folder("r5_title");
    put(&v, "pages/notes-2024.md", "title:: Reading list\n\n- books\n");
    put(&v, "pages/Other.md", "- other\n");
    let app = App::open(&v).unwrap();
    assert_eq!(app.vault.page_info("Reading list").path.as_deref(), Some("pages/notes-2024.md"));
    assert!(app.vault.misowned().is_empty());
}

/// R8: a file with Windows line endings saved with the same words writes nothing either; changed
/// words are still written.
#[test]
fn r8_same_words_with_windows_line_ends_write_nothing_but_changes_do() {
    let v = folder("r8_more");
    let text = "- one\r\n- two\r\n";
    put(&v, "pages/Crlf.md", text);
    let mut app = App::open(&v).unwrap();
    let doc = split_doc(text);
    let writes = std::rc::Rc::new(std::cell::Cell::new(0)); // how many files a save wrote
    let w = writes.clone();
    set_write_hook(Some(Box::new(move |_p: &Path| w.set(w.get() + 1))));
    let r = app.save(save_req("Crlf", &doc, content_hash(text), &doc, "pages/Crlf.md")).unwrap();
    assert!(r.ok && !r.conflict);
    assert_eq!(writes.get(), 0); // the same words: nothing written
    let mut changed = doc.clone();
    changed.blocks[1].text = "two, changed".into(); // a real change
    let r = app.save(save_req("Crlf", &changed, content_hash(text), &doc, "pages/Crlf.md")).unwrap();
    set_write_hook(None);
    assert!(r.ok && !r.conflict);
    assert_eq!(writes.get(), 1); // written once
    assert_eq!(std::fs::read_to_string(v.join("pages/Crlf.md")).unwrap(), "- one\r\n- two, changed\r\n"); // its line ends kept
    // saving those same words again (the app's newest hash) writes nothing
    let set = std::rc::Rc::new(std::cell::Cell::new(0));
    let s2 = set.clone();
    set_write_hook(Some(Box::new(move |_p: &Path| s2.set(s2.get() + 1))));
    let r = app.save(save_req("Crlf", &changed, r.hash.clone(), &changed, "pages/Crlf.md")).unwrap();
    set_write_hook(None);
    assert!(r.ok);
    assert_eq!(set.get(), 0);
}

/// R10, more shapes: a note moved under two different parents; a moved note with its own child notes;
/// a note moved on one device while the other edits elsewhere still merges; nothing is ever doubled.
#[test]
fn r10_moves_on_both_devices_never_double_a_note() {
    let texts = |b: &[outline_core::DocBlock]| b.iter().map(|x| x.text.clone()).collect::<Vec<_>>();
    // moved under two different parents
    let base = split_doc("- A\n- P\n- Q\n- R\n");
    let mine = split_doc("- P\n\t- A\n- Q\n- R\n");
    let theirs = split_doc("- P\n- Q\n\t- A\n- R\n");
    assert!(merge_blocks(&base.blocks, &mine.blocks, &theirs.blocks).is_none(), "both moved A: a clash");
    let parts = clash_parts(&base.blocks, &mine.blocks, &theirs.blocks).unwrap();
    assert!(parts.iter().any(|p| matches!(p, Part::Clash { .. })));
    // a note with a child moved to two places
    let base = split_doc("- A\n\t- a1\n- B\n- C\n- D\n");
    let mine = split_doc("- B\n- A\n\t- a1\n- C\n- D\n");
    let theirs = split_doc("- B\n- C\n- D\n- A\n\t- a1\n");
    assert!(merge_blocks(&base.blocks, &mine.blocks, &theirs.blocks).is_none());
    // both devices made the very same move: merged as one, nothing doubled
    let base = split_doc("- A\n- B\n- C\n");
    let both = split_doc("- B\n- C\n- A\n");
    let m = merge_blocks(&base.blocks, &both.blocks, &both.blocks).unwrap();
    assert_eq!(texts(&m), ["B", "C", "A"]);
    // the same new note added on both devices under different parents stays a normal merge (not a clash)
    let base = split_doc("- P\n- Q\n");
    let mine = split_doc("- P\n\t- new\n- Q\n");
    let theirs = split_doc("- P\n- Q\n\t- new\n");
    assert!(merge_blocks(&base.blocks, &mine.blocks, &theirs.blocks).is_some(), "a note the base didn't have isn't a move");
    // a merge never holds a note the base had more times than either device has it
    let base = split_doc("- A\n- B\n- C\n- D\n- E\n- F\n");
    let mine = split_doc("- B\n- A\n- C\n- D\n- E\n- F changed\n");
    let theirs = split_doc("- A\n- B\n- C\n- E\n- D\n- F\n");
    if let Some(m) = merge_blocks(&base.blocks, &mine.blocks, &theirs.blocks) {
        for t in ["A", "B", "C", "D", "E"] {
            assert_eq!(m.iter().filter(|b| b.text == t).count(), 1, "{t} in {:?}", texts(&m));
        }
    }
}

/// S2, more shapes: a picture with a title, an empty address, a picture the note had as plain text,
/// and the page-name answer's description.
#[test]
fn s2_new_pictures_become_links_in_every_shape() {
    use outline_core::ai::names_answer;
    use outline_core::text::unpicture_new;
    // a title in the address part: still a new picture, made a link
    assert_eq!(unpicture_new("![a](https://x/y.png \"title\")", ""), "[a](https://x/y.png \"title\")");
    // an empty address loads nothing: kept
    assert_eq!(unpicture_new("![a]()", ""), "![a]()");
    // two pictures on one line, one the note had
    assert_eq!(unpicture_new("![x](mine.png) ![y](https://t.example/p.gif)", "see ![x](mine.png)"), "![x](mine.png) [y](https://t.example/p.gif)");
    // a picture spread over two lines isn't a picture: kept as written
    assert_eq!(unpicture_new("![a\n](https://x/y.png)", ""), "![a\n](https://x/y.png)");
    // the page-name helper's description: a picture never stays a picture
    let v = folder("s2_names");
    put(&v, "pages/Garden.md", "- tomatoes\n");
    let app = App::open(&v).unwrap();
    let r = names_answer(&app.vault, "Garden", "description: My garden ![p](https://outside.example/t.png)\naliases: veg patch").unwrap();
    let d = r["description"].as_str().unwrap_or_default();
    assert!(!d.contains("![") && d.contains("[p](https://outside.example/t.png)"), "{d}");
}

/// S4: when the page's file can't be replaced and can't be written in place, the save fails, names
/// the temporary copy, and that copy holds the whole new words (nothing is lost).
#[test]
fn s4_a_failed_save_keeps_the_new_words_in_a_copy() {
    use outline_core::app::{write_atomic_checked, Expect};
    let v = folder("s4_more");
    let target = v.join("pages/Blocked.md");
    std::fs::create_dir_all(&target).unwrap(); // a folder where the file should be: neither a rename nor a write can replace it
    std::fs::write(target.join("inside.txt"), "x").unwrap(); // (not empty, so a rename can't take its place)
    let err = write_atomic_checked(&target, "- the new words\n", Expect::Anything).unwrap_err();
    assert!(err.contains("kept in"), "{err}");
    // the temporary copy is there, beside the file, holding the whole new words
    let kept: Vec<_> = std::fs::read_dir(v.join("pages")).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "tmp")).collect();
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert_eq!(std::fs::read_to_string(&kept[0]).unwrap(), "- the new words\n");
    assert!(err.contains(&kept[0].display().to_string()), "the message names the copy: {err}");
}

/// S5, more shapes: a plain-Markdown page with several links, a link in a heading, one in a code block
/// (left alone), a tag, and a page that mixes bullets and plain text.
#[test]
fn s5_a_rename_changes_only_the_links_in_plain_markdown() {
    let v = folder("s5_more");
    put(&v, "pages/Foo.md", "- foo page\n");
    let plain = "# About [[Foo]]\n\nFirst [[Foo]], then #Foo and [[foo]] again.\n\n```\n[[Foo]] in code\n```\n\n> quoted [[Foo]]\n\n1. numbered [[Foo]]\n2. two\n";
    put(&v, "pages/Plain.md", plain);
    let mixed = "Intro line with [[Foo]].\n\n- a bullet with [[Foo]]\n\t- child\n";
    put(&v, "pages/Mixed.md", mixed);
    let mut app = App::open(&v).unwrap();
    app.rename("Foo", "Bar").unwrap();
    let after = std::fs::read_to_string(v.join("pages/Plain.md")).unwrap();
    let want = "# About [[Bar]]\n\nFirst [[Bar]], then #Bar and [[Bar]] again.\n\n```\n[[Foo]] in code\n```\n\n> quoted [[Bar]]\n\n1. numbered [[Bar]]\n2. two\n";
    assert_eq!(after, want);
    let after = std::fs::read_to_string(v.join("pages/Mixed.md")).unwrap();
    assert_eq!(after, mixed.replace("[[Foo]]", "[[Bar]]"));
}

/// The shared percent decoder: every odd shape kept or decoded the one right way.
#[test]
fn percent_decoding_edge_cases() {
    use outline_core::link::percent_bytes;
    assert_eq!(percent_bytes("%e2%82%ac", false), "€".as_bytes()); // a three-byte letter
    assert_eq!(percent_bytes("%E2%82%AC", false), "€".as_bytes()); // capitals too
    assert_eq!(percent_bytes("%2", false), b"%2"); // cut short: kept
    assert_eq!(percent_bytes("%zz%", false), b"%zz%"); // not hex: kept
    assert_eq!(percent_bytes("%-1%+1", false), b"%-1%+1"); // a sign isn't a digit
    assert_eq!(percent_bytes("a+b%20c", true), b"a b c"); // "+" is a space only in query values
    assert_eq!(percent_bytes("a+b%20c", false), b"a+b c");
    assert_eq!(percent_bytes("%252F", false), b"%2F"); // decoded once, never twice
    assert_eq!(page_name_from_stem("C%2B%2B"), "C++");
    assert_eq!(page_name_from_stem("%E2%82"), "%E2%82"); // codes that don't make a letter: the name kept as written, no crash
}

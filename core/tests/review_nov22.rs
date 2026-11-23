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

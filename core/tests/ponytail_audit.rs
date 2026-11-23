//! The Ponytail audit's core findings (Nov 23, 2026), fixed and tested: each test failed on the
//! code before its fix. Finding numbers are the audit's (the "thinky audit (Ponytail method)" doc).
use outline_core::app::{check_vault_at, set_cache_dir, App};
use outline_core::{join_doc, split_doc, Vault};
use std::path::{Path, PathBuf};

/// A new, empty notes folder for one test (its name says which test, so tests running at once don't meet).
fn folder(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_ponytail_{tag}_{}", std::process::id())); // a folder only this test uses
    let _ = std::fs::remove_dir_all(&v); // left over from an earlier run: start clean
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap(); // the folders a notes folder has
    }
    set_cache_dir(v.join("cache")); // the app's own cache goes inside it too
    v
}

/// Write one file into the notes folder (its folder made first).
fn put(v: &Path, rel: &str, text: &str) {
    let p = v.join(rel); // where the file goes
    std::fs::create_dir_all(p.parent().unwrap()).unwrap(); // its folder
    std::fs::write(p, text).unwrap(); // its words
}

/// The files Settings › Check this folder lists as sync conflict copies.
fn copies(v: &Path) -> Vec<String> {
    check_vault_at(v, 0).unwrap().conflict_copies
}

// ---------------------------------------------------------------- finding 1

/// Finding 1: any name holding the word "conflict", or any "X (2).md" next to "X.md", was a "copy",
/// and Compare and merge could move a real page to the bin.
#[test]
fn a_real_page_is_never_listed_as_a_conflict_copy() {
    let v = folder("f1_real");
    put(&v, "pages/Team.md", "- the team page\n");
    put(&v, "pages/Team conflict.md", "- how we settle disagreements\n"); // a real page with the word in its name
    put(&v, "pages/Conflict resolution.md", "- a page about it\n");
    put(&v, "pages/Merge-conflict notes.md", "- git notes\n");
    put(&v, "pages/Budget.md", "- money\n");
    put(&v, "pages/Budget (2027).md", "- next year's\n"); // a year in brackets: a name, not a copy number
    // the app's own "X (2).md": a new page "Foo" while Foo.md holds the page "Bar" by its title:: line
    put(&v, "pages/Foo.md", "title:: Bar\n\n- bar's notes\n");
    put(&v, "pages/Foo (2).md", "title:: Foo\n\n- foo's notes\n");
    assert_eq!(copies(&v), Vec::<String>::new()); // none of them is listed
    let mut app = App::open(&v).unwrap();
    for f in ["pages/Team conflict.md", "pages/Budget (2027).md", "pages/Foo (2).md"] {
        assert!(app.compare_copy(f).is_err(), "{f} offered for Compare and merge"); // not compared as a copy
        assert!(app.bin_copy(f).is_err(), "{f} could be binned"); // and never binned
        assert!(v.join(f).exists(), "{f} is gone"); // still on disk
    }
}

/// Finding 1, the other side: real sync copies are still found, each next to its page.
#[test]
fn real_sync_copies_are_still_listed() {
    let v = folder("f1_copies");
    put(&v, "pages/Plan.md", "- plan\n");
    put(&v, "pages/Plan (1).md", "- plan, older\n"); // Google Drive's numbered copy, no title::
    put(&v, "pages/Trip.md", "title:: Trip\n\n- trip\n");
    put(&v, "pages/Trip (1).md", "title:: Trip\n\n- trip, older\n"); // a numbered copy with the same title::
    put(&v, "pages/Ideas (conflict 2026-11-08-13-18-30).md", "- ideas\n"); // Google Drive
    put(&v, "pages/Ideas.md", "- ideas\n");
    put(&v, "pages/Books.sync-conflict-20261108-131830-ABCDEFG.md", "- books\n"); // Syncthing
    put(&v, "pages/Books.md", "- books\n");
    put(&v, "pages/Food (Sam's conflicted copy 2026-11-08).md", "- food\n"); // Dropbox
    put(&v, "pages/Food.md", "- food\n");
    put(&v, "pages/Music (conflicted copy 2026-11-08 093011).md", "- music\n"); // Nextcloud
    put(&v, "pages/Music.md", "- music\n");
    put(&v, "pages/Walks (CONFLICT 2026-11-08).md", "- walks\n"); // the mark in other capitals
    put(&v, "pages/Walks.md", "- walks\n");
    let mut want = vec![
        "pages/Books.sync-conflict-20261108-131830-ABCDEFG.md",
        "pages/Food (Sam's conflicted copy 2026-11-08).md",
        "pages/Ideas (conflict 2026-11-08-13-18-30).md",
        "pages/Music (conflicted copy 2026-11-08 093011).md",
        "pages/Plan (1).md",
        "pages/Trip (1).md",
        "pages/Walks (CONFLICT 2026-11-08).md",
    ];
    want.sort(); // in the order the check gives them
    assert_eq!(copies(&v), want);
    // each one is compared with the page it is a copy of
    let app = App::open(&v).unwrap();
    for (copy, page) in [
        ("pages/Food (Sam's conflicted copy 2026-11-08).md", "pages/Food.md"),
        ("pages/Books.sync-conflict-20261108-131830-ABCDEFG.md", "pages/Books.md"),
        ("pages/Plan (1).md", "pages/Plan.md"),
        ("pages/Trip (1).md", "pages/Trip.md"),
    ] {
        let c = app.compare_copy(copy).unwrap();
        assert_eq!(c.path, page, "{copy}");
    }
}

/// Finding 1: a numbered file with no page next to it ("X (1).md" without "X.md") isn't a copy.
#[test]
fn a_numbered_page_alone_is_not_a_copy() {
    let v = folder("f1_alone");
    put(&v, "pages/Chapter (1).md", "- the first chapter\n");
    put(&v, "pages/Chapter (2).md", "- the second\n");
    assert_eq!(copies(&v), Vec::<String>::new());
}

// ---------------------------------------------------------------- finding 2

/// Finding 2: renaming Foo to Bar skipped links inside {{ }}: embeds and queries kept the old name.
#[test]
fn a_rename_reaches_links_inside_embeds_and_queries() {
    let v = folder("f2_rename");
    put(&v, "pages/Foo.md", "- foo\n");
    let other = "- {{embed [[Foo]]}}\n- {{query [[Foo]]}}\n- {{query (and [[Foo]] [[Other]])}}\n- {{query #Foo}}\n- {{query (and #foo (todo now))}}\n- {{embed [[Foo Bar]]}} and {{embed ((6553a1b2-0000-4000-8000-000000000001))}}\n- {{video https://example.com/Foo}}\n- plain [[Foo]] too\n- `{{embed [[Foo]]}}` in code stays\n";
    put(&v, "pages/Other.md", other);
    let mut app = App::open(&v).unwrap();
    app.rename("Foo", "Bar").unwrap();
    let after = std::fs::read_to_string(v.join("pages/Other.md")).unwrap();
    let want = "- {{embed [[Bar]]}}\n- {{query [[Bar]]}}\n- {{query (and [[Bar]] [[Other]])}}\n- {{query #Bar}}\n- {{query (and #Bar (todo now))}}\n- {{embed [[Foo Bar]]}} and {{embed ((6553a1b2-0000-4000-8000-000000000001))}}\n- {{video https://example.com/Foo}}\n- plain [[Bar]] too\n- `{{embed [[Foo]]}}` in code stays\n";
    assert_eq!(after, want); // every link to Foo renamed, nothing else touched
    // no empty "Foo" page is left behind: nothing links it any more
    let app = App::open(&v).unwrap();
    assert!(app.vault.linked_refs("Foo").is_empty());
    assert_eq!(app.vault.linked_refs("Bar").len(), 1); // Other links Bar
}

/// Finding 2: a macro that never closes, or one with nested braces, is still safe to rename around.
#[test]
fn a_rename_around_broken_macros_changes_only_links() {
    let v = folder("f2_broken");
    put(&v, "pages/Foo.md", "- foo\n");
    put(&v, "pages/Other.md", "- {{embed [[Foo]]\n- {{ }} [[Foo]] {{\n- {{{{query [[Foo]]}}}}\n");
    let mut app = App::open(&v).unwrap();
    app.rename("Foo", "Bar").unwrap();
    let after = std::fs::read_to_string(v.join("pages/Other.md")).unwrap();
    assert_eq!(after, "- {{embed [[Bar]]\n- {{ }} [[Bar]] {{\n- {{{{query [[Bar]]}}}}\n");
}

// ---------------------------------------------------------------- finding 5

/// Finding 5: a template holding "<%>" crashed, and a new journal day using it couldn't open.
#[test]
fn a_template_with_odd_marks_fills_without_a_crash() {
    let v = folder("f5_template");
    put(&v, "logseq/config.edn", "{:default-templates {:journals \"Daily\"}}");
    put(&v, "pages/Templates.md", "- daily\n  template:: Daily\n\t- odd <%> mark\n\t- <%%> and <% today %>\n\t- open <% only\n\t- %> before <% time %>\n\t- <%today%><%>\n");
    let app = App::open(&v).unwrap();
    let blocks = app.template("daily", "November 23rd, 2026", (2026, 11, 23), "09:15").unwrap();
    let texts: Vec<&str> = blocks.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "daily",                              // the template's own note, as for any template
            "odd <%> mark",                       // no variable inside: kept as written
            "<%%> and [[Nov 23rd, 2026]]",        // "%" alone isn't a variable; today is filled
            "open <% only",                       // never closed: kept
            "%> before 09:15",                    // a lone closing mark: kept; time filled
            "[[Nov 23rd, 2026]]<%>",              // filled, then the odd mark kept
        ]
    );
    // a new journal day with that template opens
    let view = app.page("Nov 23rd, 2026", Some(((2026, 11, 23), "09:15".to_string())));
    assert!(view.from_template && view.doc.blocks.iter().any(|b| b.text == "odd <%> mark"), "the day opened with its template");
}

// ---------------------------------------------------------------- finding 8

/// Finding 8: text made harmless (an invisible space after each "#") still made tags, with the
/// invisible character at their front.
#[test]
fn harmless_text_makes_no_tags() {
    let mut vault = Vault::new();
    let harmless = outline_core::clip::defuse("Trending: #MeToo and #1 hits, (#inside) and,#after #");
    vault.upsert("pages/Shared.md", &format!("- {harmless}\n"));
    assert!(vault.all_tags().is_empty(), "tags made: {:?}", vault.all_tags());
    // a real tag right after the invisible space ends there, and a real tag still works
    vault.upsert("pages/Mine.md", "- #real and #word\u{200B}after\n");
    let tags: Vec<String> = vault.all_tags().into_iter().map(|t| t.0).collect();
    assert_eq!(tags.len(), 2, "{tags:?}");
    assert!(tags.iter().any(|t| t.eq_ignore_ascii_case("real")) && tags.iter().any(|t| t.eq_ignore_ascii_case("word")), "{tags:?}");
}

// ---------------------------------------------------------------- finding 10

/// Finding 10 (core): renaming a page to a name ending in "." or ":" wrote "#U.S.", which a tag reads
/// as "U.S"; the #[[ ]] form keeps the whole name.
#[test]
fn a_rename_to_a_name_ending_in_a_dot_keeps_the_whole_name() {
    let v = folder("f10_rename");
    put(&v, "pages/USA.md", "- the country\n");
    put(&v, "pages/Trip.md", "- visiting #USA soon\n- and #USA, then home\n");
    let mut app = App::open(&v).unwrap();
    app.rename("USA", "U.S.").unwrap();
    let after = std::fs::read_to_string(v.join("pages/Trip.md")).unwrap();
    assert_eq!(after, "- visiting #[[U.S.]] soon\n- and #[[U.S.]], then home\n");
    let app = App::open(&v).unwrap();
    assert_eq!(app.vault.linked_refs("U.S.").len(), 1); // the links reach the renamed page
    assert!(app.vault.linked_refs("U.S").is_empty()); // and not a page without the dot
    // a colon at the end too; a dot inside the name keeps the short form
    let mut app = App::open(&v).unwrap();
    app.rename("U.S.", "Note:").unwrap();
    assert_eq!(std::fs::read_to_string(v.join("pages/Trip.md")).unwrap(), "- visiting #[[Note:]] soon\n- and #[[Note:]], then home\n");
    put(&v, "pages/Ver.md", "- a version\n");
    put(&v, "pages/Log.md", "- shipped #Ver today\n");
    let mut app = App::open(&v).unwrap();
    app.rename("Ver", "v1.2").unwrap();
    assert_eq!(std::fs::read_to_string(v.join("pages/Log.md")).unwrap(), "- shipped #v1.2 today\n"); // a dot inside: the short form
}

// ---------------------------------------------------------------- finding 12

/// Finding 12: a note line `\ \- x` lost a backslash on every save.
#[test]
fn backslashes_before_a_space_survive_saving() {
    let lines = ["\\ \\- x", "\\ \\* x", "\\\t\\- x", "\\  \\+ y", "\\ - x", "\\- x", "\\\\- x", " \\ - x", "- x"];
    for line in lines {
        let mut d = split_doc("- a\n"); // a page with one note
        d.blocks[0].text = format!("a\n{line}"); // the note's second line is the odd one
        let mut text = d.blocks[0].text.clone(); // what the note should keep
        for _ in 0..3 {
            let file = join_doc(&d); // saved
            d = split_doc(&file); // and read again
            assert_eq!(d.blocks.len(), 1, "{line:?} became its own note: {file:?}");
            assert_eq!(d.blocks[0].text, text, "{line:?} changed on save: {file:?}");
            text = d.blocks[0].text.clone();
        }
    }
}

/// Finding 12: many random lines of backslashes, spaces, tabs and bullet marks come back as written
/// (the audit's own random check found 9 broken ones in 20,000).
#[test]
fn random_backslash_lines_survive_saving() {
    let parts = ["\\", " ", "\t", "-", "*", "+", "x", "1.", "#"]; // the pieces such lines are made of
    let mut seed: u64 = 0x5eed; // a fixed start, so a failure can be run again
    let mut next = || {
        seed ^= seed << 13; // xorshift: a quick random number
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for _ in 0..20_000 {
        let len = 1 + (next() % 7) as usize; // 1 to 7 pieces
        let line: String = (0..len).map(|_| parts[(next() % parts.len() as u64) as usize]).collect();
        if line.trim().is_empty() || line.trim_end() != line {
            continue; // blank lines and spaces at line ends aren't kept by design
        }
        let mut d = split_doc("- a\n");
        d.blocks[0].text = format!("a\n{line}");
        let back = split_doc(&join_doc(&d));
        if back.blocks.len() == 1 {
            assert_eq!(back.blocks[0].text, d.blocks[0].text, "{line:?}");
        }
    }
}

// He asked (Nov 23): a picture that is too big to show must say why, not just look broken.
#[test]
fn a_picture_over_the_limit_says_why_it_is_not_shown() {
    use outline_core::app::{too_big_picture, too_big_to_show, MAX_ASSET_BYTES};
    // the note: an SVG picture naming the limit in megabytes, as the editor says it
    let svg = too_big_picture();
    assert!(svg.starts_with("<svg ") && svg.ends_with("</svg>"), "{svg}");
    assert!(svg.contains("Picture not shown: it is over thinky's 25 MB limit"), "{svg}");
    // nothing in it can run or go anywhere: no script, no link, no outside picture or font
    for bad in ["<script", "href", "url(", "@import", "<foreignObject", "on"] {
        let hit = if bad == "on" { svg.contains(" onload") || svg.contains(" onclick") } else { svg.contains(bad) };
        assert!(!hit, "{bad} in {svg}");
    }
    // which files count as too big: only those over the limit (sparse files: no disk is used)
    let dir = std::env::temp_dir().join(format!("thinky-bigpic-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let sized = |name: &str, n: u64| {
        let p = dir.join(name);
        std::fs::File::create(&p).unwrap().set_len(n).unwrap();
        p
    };
    assert!(too_big_to_show(&sized("over.png", MAX_ASSET_BYTES as u64 + 1)), "one byte over: too big");
    assert!(!too_big_to_show(&sized("at.png", MAX_ASSET_BYTES as u64)), "exactly the limit: shown");
    assert!(!too_big_to_show(&sized("small.png", 10)), "a small picture: shown");
    assert!(!too_big_to_show(&dir.join("missing.png")), "a missing file is missing, not big");
    std::fs::remove_dir_all(&dir).unwrap();
}

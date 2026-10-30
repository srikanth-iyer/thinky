//! Pages (Build 30): leanoutliner:// links, when pages were changed and made (All pages' Changed and
//! Created), merging a page into another when it's renamed to that page's name (as Logseq does), and
//! a page's file (shown in Explorer).
use outline_core::app::{dispatch, set_cache_dir, App};
use outline_core::link::{self, Link};
use serde_json::json;
use std::path::{Path, PathBuf};

fn vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_pages_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}
fn put(v: &Path, rel: &str, text: &str) {
    std::fs::write(v.join(rel), text).unwrap();
}
fn get(v: &Path, rel: &str) -> String {
    std::fs::read_to_string(v.join(rel)).unwrap()
}
/// One cache folder for this test program (it can be set only once).
fn cache() -> PathBuf {
    let d = std::env::temp_dir().join(format!("outline_pages_cache_{}", std::process::id()));
    set_cache_dir(d.clone());
    d
}

// ---------------------------------------------------------------- links

#[test]
fn links_say_what_they_open() {
    assert_eq!(link::parse("leanoutliner://page/Marta%20Pell"), Some(Link::Page { name: "Marta Pell".into() }));
    // the scheme and the kind in any capitals; a raw "/" in a hand-typed name; a query or # after it
    assert_eq!(link::parse("LeanOutliner://PAGE/APRON/notes?x=1"), Some(Link::Page { name: "APRON/notes".into() }));
    assert_eq!(link::parse("leanoutliner://page/A%2BB+C#top"), Some(Link::Page { name: "A+B+C".into() }), "a + is a +");
    assert_eq!(link::parse("leanoutliner://note/6528AAAA-bbbb-4ccc-8ddd-eeeeffff6666"), Some(Link::Note { id: "6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666".into() }));
    // nothing usable: just the app
    for bad in ["leanoutliner://page/", "leanoutliner://page/%20%20", "leanoutliner://page/a%0Ab", "leanoutliner://page/%5B%5Bx%5D%5D", "leanoutliner://note/", "leanoutliner://note/not-an-id!", "leanoutliner://note/12"] {
        assert_eq!(link::parse(bad), Some(Link::App), "{bad}");
    }
    // the bookmarklet's capture links, as before
    assert_eq!(
        link::parse("leanoutliner://capture?url=https%3A%2F%2Fa.b%2F&title=A+page&text="),
        Some(Link::Capture { text: "".into(), url: "[A page · a.b](https://a.b/)".into(), boxed: false })
    );
    assert_eq!(link::parse("leanoutliner://capture?text=hi%20there&box=1"), Some(Link::Capture { text: "hi there".into(), url: "".into(), boxed: true }));
    assert_eq!(link::parse("leanoutliner:?text=x"), Some(Link::Capture { text: "x".into(), url: "".into(), boxed: false }));
    assert_eq!(link::parse("https://example.com"), None);
    assert_eq!(link::parse("lean"), None);
    assert_eq!(link::parse("leanoutliné://page/x"), None, "never a slice through a letter");
}

#[test]
fn links_round_trip_like_the_page_writes_them() {
    // the page writes them with encodeURIComponent (api.js pageLinkUrl; t15_pages checks the round trip)
    assert_eq!(link::parse("leanoutliner://page/APRON%2FSpice%20jars"), Some(Link::Page { name: "APRON/Spice jars".into() }));
    assert_eq!(link::parse("leanoutliner://page/it%E2%80%99s%20(a)%20test!*~'.-_"), Some(Link::Page { name: "it’s (a) test!*~'.-_".into() }));
    // the app asks the core what a link is (the phone, a link clicked inside the app)
    let mut st: Option<App> = None;
    assert_eq!(dispatch(&mut st, "link", json!({"link": "leanoutliner://page/Na%C3%AFve"})).unwrap(), json!({"kind": "page", "name": "Naïve"}));
    assert_eq!(dispatch(&mut st, "link", json!({"link": "leanoutliner://note/6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666"})).unwrap(), json!({"kind": "note", "id": "6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666"}));
    assert_eq!(dispatch(&mut st, "link", json!({"link": "leanoutliner://page/"})).unwrap(), json!({"kind": "app"}));
    assert_eq!(dispatch(&mut st, "link", json!({"link": "https://x.y"})).unwrap(), json!(null));
}

// ---------------------------------------------------------------- Changed and Created

fn entry(app: &App, name: &str) -> serde_json::Value {
    let all = serde_json::to_value(app.pages()).unwrap();
    all.as_array().unwrap().iter().find(|e| e["name"] == name).cloned().unwrap_or(json!(null))
}

fn set_mtime(p: &Path, secs: u64) {
    std::fs::File::options().write(true).open(p).unwrap().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs)).unwrap();
}

#[test]
fn pages_say_when_they_were_changed_and_made() {
    let _c = cache();
    let v = vault("times");
    put(&v, "pages/Old.md", "- written long ago\n");
    put(&v, "pages/Linker.md", "- see [[Ghost]] and [[Old]]\n");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    set_mtime(&v.join("pages/Old.md"), now - 86_400 * 30);
    let mut app = App::open(&v).unwrap();
    let old = entry(&app, "Old");
    assert_eq!(old["changed"], json!(now - 86_400 * 30));
    // made today on this disk, but changed 30 days ago: it was made by then (the earliest wins)
    assert_eq!(old["created"], json!(now - 86_400 * 30));
    let linker = entry(&app, "Linker");
    let made = linker["created"].as_u64().unwrap();
    assert!(made <= linker["changed"].as_u64().unwrap() && made + 60 > now, "{linker}");
    assert_eq!(entry(&app, "Ghost")["created"], json!(null), "a name with no file has no times");
    assert_eq!(entry(&app, "Ghost")["changed"], json!(null));

    // the app saves Linker (a new file replaces the old one): it stays as old as it was
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let pv = app.page("Linker", None);
    let mut doc = pv.doc.clone();
    doc.blocks[0].text.push_str(" (edited)");
    let r = app.save(serde_json::from_value(json!({"name": "Linker", "doc": doc, "base_hash": pv.hash, "path": "pages/Linker.md"})).unwrap()).unwrap();
    assert!(r.ok);
    let after = entry(&app, "Linker");
    assert_eq!(after["created"], json!(made), "saving doesn't make a page new");
    assert!(after["changed"].as_u64().unwrap() >= linker["changed"].as_u64().unwrap());

    // another app replaces it the same way (a new file under the old name), noticed by a rescan
    std::thread::sleep(std::time::Duration::from_millis(1100));
    put(&v, "pages/.tmp-other", "- see [[Ghost]] and [[Old]], from the phone\n");
    std::fs::rename(v.join("pages/.tmp-other"), v.join("pages/Linker.md")).unwrap();
    app.rescan();
    assert_eq!(entry(&app, "Linker")["created"], json!(made), "a change made elsewhere doesn't either");

    // a rename keeps it; and the next start remembers it (the index cache)
    app.rename("Linker", "Linked list").unwrap();
    assert_eq!(entry(&app, "Linked list")["created"], json!(made));
    app.persist();
    drop(app);
    let app = App::open(&v).unwrap();
    assert_eq!(entry(&app, "Linked list")["created"], json!(made));
    assert_eq!(entry(&app, "Old")["created"], json!(now - 86_400 * 30));
    // a page deleted and written again later is a new page
    let mut app = app;
    app.delete_pages(&["Old".into()]).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    put(&v, "pages/Old.md", "- written again\n");
    app.rescan();
    assert!(entry(&app, "Old")["created"].as_u64().unwrap() >= now, "{}", entry(&app, "Old"));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn linked_references_say_when_their_page_changed() {
    // (the "Last changed" order above a page's linked references: each page's file time, kept by the
    // app, so a save made here counts at once)
    let _c = cache();
    let v = vault("reftimes");
    put(&v, "pages/Old.md", "- about [[Person]]\n");
    put(&v, "pages/New.md", "- also [[Person]]\n");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    set_mtime(&v.join("pages/Old.md"), now - 86_400 * 9);
    set_mtime(&v.join("pages/New.md"), now - 3_600);
    let mut app = App::open(&v).unwrap();
    let times = |app: &App| -> Vec<(String, u64)> {
        let refs = serde_json::to_value(&app.page("Person", None).refs).unwrap();
        refs.as_array().unwrap().iter().map(|g| (g["page"].as_str().unwrap().to_string(), g["changed"].as_u64().unwrap())).collect()
    };
    let t = times(&app);
    assert_eq!(t.iter().find(|(p, _)| p == "Old").unwrap().1, now - 86_400 * 9, "{t:?}");
    assert_eq!(t.iter().find(|(p, _)| p == "New").unwrap().1, now - 3_600, "{t:?}");
    // the app saves Old: it's the newest now
    let pv = app.page("Old", None);
    let mut doc = pv.doc.clone();
    doc.blocks[0].text.push_str(" (edited)");
    assert!(app.save(serde_json::from_value(json!({"name": "Old", "doc": doc, "base_hash": pv.hash, "path": "pages/Old.md"})).unwrap()).unwrap().ok);
    let t = times(&app);
    assert!(t.iter().find(|(p, _)| p == "Old").unwrap().1 + 5 >= now, "{t:?}");
    // (no file time goes into the JSON of other lists)
    let un = serde_json::to_value(app.vault.unlinked_refs("person", 10).0).unwrap();
    assert!(un.as_array().unwrap().iter().all(|g| g.get("changed").is_none() && g.get("path").is_none()), "{un}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn an_older_cache_without_creation_times_still_opens() {
    let c = cache();
    let v = vault("oldcache");
    put(&v, "pages/A.md", "- a\n");
    drop(App::open(&v).unwrap());
    // the cache file as an older build wrote it: no "born"
    let file = c.join(format!("vault-{}.json", outline_core::content_hash(&v.display().to_string())));
    let mut j: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    j.as_object_mut().unwrap().remove("born");
    std::fs::write(&file, serde_json::to_vec(&j).unwrap()).unwrap();
    let app = App::open(&v).unwrap();
    assert!(entry(&app, "A")["created"].as_u64().unwrap() > 0);
    let j: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert!(j["born"]["pages/A.md"].as_u64().is_some(), "written once with them: {j}");
    let _ = std::fs::remove_dir_all(&v);
}

// ---------------------------------------------------------------- merging two pages

#[test]
fn rename_target_says_when_a_merge_is_needed() {
    let v = vault("target");
    put(&v, "pages/Foo.md", "alias:: F\n- foo\n");
    put(&v, "pages/Bar.md", "alias:: B, Bee\n- bar\n");
    put(&v, "journals/2026_10_25.md", "- a day\n");
    let app = App::open(&v).unwrap();
    assert_eq!(app.rename_target("Foo", "Baz").unwrap(), None, "a free name: a plain rename");
    assert_eq!(app.rename_target("Foo", "FOO").unwrap(), None, "only its capitals");
    assert_eq!(app.rename_target("Foo", "bar").unwrap(), Some("Bar".into()));
    assert_eq!(app.rename_target("Foo", " Bee ").unwrap(), Some("Bar".into()), "another page's alias: that page");
    assert!(app.rename_target("Foo", "f").unwrap_err().contains("already another name of this page"));
    assert!(app.rename_target("Foo", "").is_err());
    assert!(app.rename_target("Foo", "a [[b]]").is_err());
    let day = app.vault.journal_dates()[0];
    assert!(app.rename_target(&app.journal_name(day), "Anything").unwrap_err().contains("Journal"));
    assert!(app.rename_target("Foo", &app.journal_name(day)).unwrap_err().contains("journal date"));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn merging_appends_the_notes_and_moves_the_links() {
    let v = vault("merge");
    let bar = "tags:: work\n\n- Bar's first note\n\t- its child, see [[Elsewhere]]\n- Bar's last note\n";
    put(&v, "pages/Bar.md", bar);
    put(&v, "pages/Foo.md", "title:: Foo\ntags:: idea, [[reading]]\nalias:: F\n\n- Foo's note about [[Foo]] and [[Bar]]\n\t- deeper\n\t\t- deepest #Foo\n- second\n  with a second line\n");
    put(&v, "pages/Other.md", "related:: [[Foo]]\n\n- I link [[Foo]], #Foo and #[[foo]]\n- and [[F]] (its alias) and [[Foobar]]\n");
    put(&v, "journals/2026_10_25.md", "- unrelated\n");
    let mut app = App::open(&v).unwrap();
    let r = app.merge_pages("Foo", "Bar").unwrap();
    assert_eq!((r.name.as_str(), r.notes, r.props, r.files_changed), ("Bar", 5, true, 1));
    // Bar: every byte as it was, then Foo's notes with Bar's tabs (its properties first, no title::)
    let want = format!("{bar}- tags:: idea, [[reading]]\n  alias:: F\n- Foo's note about [[Bar]] and [[Bar]]\n\t- deeper\n\t\t- deepest #Bar\n- second\n  with a second line\n");
    assert_eq!(get(&v, "pages/Bar.md"), want);
    // Foo's file in the bin, as Logseq names it
    assert!(!v.join("pages/Foo.md").exists());
    assert!(get(&v, "logseq/.recycle/pages_Foo.md").starts_with("title:: Foo\n"));
    // links to Foo now point at Bar; its alias and other names stay as written
    assert_eq!(get(&v, "pages/Other.md"), "related:: [[Bar]]\n\n- I link [[Bar]], #Bar and #[[Bar]]\n- and [[F]] (its alias) and [[Foobar]]\n");
    assert_eq!(get(&v, "journals/2026_10_25.md"), "- unrelated\n");
    // the index follows
    assert!(!app.vault.page_info("Foo").exists);
    assert_eq!(app.vault.linked_refs("Bar").len(), 1);
    assert_eq!(app.vault.search("deepest", 5).iter().filter(|h| h.page == "Bar").count(), 1);
    assert!(app.recycled().iter().any(|x| x.name == "Foo"));

    // Undo: all of it back, byte for byte
    let name = app.undo_merge(r.undo).unwrap();
    assert_eq!(name, "Foo");
    assert_eq!(get(&v, "pages/Bar.md"), bar);
    assert!(get(&v, "pages/Foo.md").starts_with("title:: Foo\ntags:: idea"));
    assert!(get(&v, "pages/Other.md").starts_with("related:: [[Foo]]"));
    assert!(!v.join("logseq/.recycle/pages_Foo.md").exists());
    assert!(app.vault.page_info("Foo").exists);
    assert!(app.undo_merge(r.undo).is_err(), "once");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn merging_keeps_the_pages_file_shape() {
    let v = vault("shape");
    // CRLF, a byte-order mark, two-space indents, no line break at the end; a link to the old name
    let bar = "\u{feff}- Bar one\r\n  - Bar child\r\n- see [[Foo]] here\r\n- last";
    put(&v, "pages/Bar.md", bar);
    put(&v, "pages/Foo.md", "\u{feff}---\ntitle: Foo from Obsidian\ntags:\n  - a\n  - b\n---\nA plain paragraph\nwith two lines.\n\nAnother one.\n- a bullet\n\t- its child\n");
    let mut app = App::open(&v).unwrap();
    let r = app.merge_pages("Foo", "Bar").unwrap();
    assert_eq!((r.notes, r.props), (5, true));
    let out = get(&v, "pages/Bar.md");
    assert_eq!(
        out,
        "\u{feff}- Bar one\r\n  - Bar child\r\n- see [[Bar]] here\r\n- last\r\n- tags:: a, b\r\n- A plain paragraph\r\n  with two lines.\r\n- Another one.\r\n- a bullet\r\n  - its child"
    );
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn merging_into_a_page_with_no_notes_and_properties_written_as_a_first_note() {
    let v = vault("firstnote");
    put(&v, "pages/Bar.md", "");
    // Logseq's other place for page properties: a first note holding only them
    put(&v, "pages/Foo.md", "- title:: Foo\n  type:: book\n- the notes\n");
    let mut app = App::open(&v).unwrap();
    let r = app.merge_pages("Foo", "Bar").unwrap();
    assert_eq!((r.notes, r.props), (2, true));
    assert_eq!(get(&v, "pages/Bar.md"), "- type:: book\n- the notes\n");
    // (in a page with no notes, that first note is its properties now, as in Logseq)
    assert_eq!(app.vault.page_info("Bar").props, vec![("type".to_string(), "book".to_string())]);
    // a page with nothing but a title
    put(&v, "pages/Empty.md", "title:: Empty\n");
    app.rescan();
    let r = app.merge_pages("Empty", "Bar").unwrap();
    assert_eq!((r.notes, r.props), (0, false));
    assert_eq!(get(&v, "pages/Bar.md"), "- type:: book\n- the notes\n");
    assert!(!v.join("pages/Empty.md").exists() && v.join("logseq/.recycle/pages_Empty.md").exists());
    // a name that only links have (no file): its links move, nothing goes to the bin
    put(&v, "pages/L.md", "- [[Nofile]] and #nofile\n");
    app.rescan();
    let r = app.merge_pages("Nofile", "Bar").unwrap();
    assert_eq!((r.notes, r.files_changed), (0, 1));
    assert_eq!(get(&v, "pages/L.md"), "- [[Bar]] and #Bar\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn merging_refuses_what_it_cant_do_safely() {
    let v = vault("refuse");
    put(&v, "pages/Bar.md", "- bar\n");
    put(&v, "pages/Foo.md", "- foo\n");
    std::fs::write(v.join("pages/Latin.md"), b"- caf\xe9\n").unwrap();
    put(&v, "journals/2026_10_25.md", "- a day\n");
    let mut app = App::open(&v).unwrap();
    let day = app.journal_name(app.vault.journal_dates()[0]);
    let snapshot = || ["pages/Bar.md", "pages/Foo.md", "journals/2026_10_25.md"].map(|r| get(&v, r));
    let before = snapshot();
    assert!(app.merge_pages("Foo", "Latin").unwrap_err().contains("UTF-8"));
    assert!(app.merge_pages("Latin", "Bar").unwrap_err().contains("UTF-8"));
    assert!(app.merge_pages("Foo", &day).is_err());
    assert!(app.merge_pages(&day, "Bar").is_err());
    assert!(app.merge_pages("Foo", "foo").is_err(), "into itself");
    assert!(app.merge_pages("Foo", "Nowhere").is_err(), "into a page with no file");
    assert_eq!(snapshot(), before, "nothing changed");
    assert!(v.join("pages/Latin.md").exists() && !v.join("logseq/.recycle").exists());

    // Undo only while nothing changed since
    let r = app.merge_pages("Foo", "Bar").unwrap();
    put(&v, "pages/Bar.md", "- bar\n- foo\n- typed after the merge\n");
    app.rescan();
    let e = app.undo_merge(r.undo).unwrap_err();
    assert!(e.contains("changed since") && e.contains("bin"), "{e}");
    assert_eq!(get(&v, "pages/Bar.md"), "- bar\n- foo\n- typed after the merge\n");
    assert!(v.join("logseq/.recycle/pages_Foo.md").exists() && !v.join("pages/Foo.md").exists());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn merging_through_dispatch_and_the_page_file() {
    let v = vault("dispatch");
    put(&v, "pages/Bar.md", "- bar\n");
    put(&v, "pages/Foo.md", "- foo [[Ghost]]\n");
    let mut st = Some(App::open(&v).unwrap());
    assert_eq!(dispatch(&mut st, "rename_target", json!({"name": "Foo", "new_name": "BAR"})).unwrap(), json!("Bar"));
    assert_eq!(dispatch(&mut st, "rename_target", json!({"name": "Foo", "new_name": "Baz"})).unwrap(), json!(null));
    let p = dispatch(&mut st, "page_file", json!({"name": "foo"})).unwrap();
    assert_eq!(PathBuf::from(p.as_str().unwrap()), v.join("pages/Foo.md"));
    assert!(dispatch(&mut st, "page_file", json!({"name": "Ghost"})).is_err(), "no file yet");
    let r = dispatch(&mut st, "merge_pages", json!({"name": "Foo", "into": "Bar"})).unwrap();
    assert_eq!((r["name"].as_str(), r["notes"].as_u64()), (Some("Bar"), Some(1)));
    assert_eq!(get(&v, "pages/Bar.md"), "- bar\n- foo [[Ghost]]\n");
    assert!(dispatch(&mut st, "undo_merge", json!({"undo": r["undo"].as_u64().unwrap() + 1})).is_err(), "only that merge");
    assert_eq!(dispatch(&mut st, "undo_merge", json!({"undo": r["undo"]})).unwrap(), json!("Foo"));
    assert_eq!(get(&v, "pages/Bar.md"), "- bar\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn favourites_follow_a_rename_and_a_merge() {
    let v = vault("favs");
    put(&v, "pages/Foo.md", "- foo\n");
    put(&v, "pages/Bar.md", "- bar\n");
    put(&v, "pages/Baz.md", "- baz\n");
    let cfg = "{:meta/version 1\n ;; my favourites\n :favorites [\"bar\" ;; keep\n              \"FOO\", \"other\"]\n :hidden []}\n";
    put(&v, "logseq/config.edn", cfg);
    let mut app = App::open(&v).unwrap();
    // a rename: the favourite takes the new name in its place; nothing else in the file changes
    let r = app.rename("Foo", "Foo two").unwrap();
    assert_eq!(r.favorites, vec!["bar", "Foo two", "other"]);
    assert_eq!(get(&v, "logseq/config.edn"), cfg.replace("\"FOO\"", "\"Foo two\""));
    // a merge into a page that's a favourite already: the merged page's entry goes (the list stays readable)
    let after_rename = get(&v, "logseq/config.edn");
    let m = app.merge_pages("Foo two", "Bar").unwrap();
    assert_eq!(m.favorites, vec!["bar", "other"]);
    assert_eq!(get(&v, "logseq/config.edn"), after_rename.replace("\"Foo two\", ", ""));
    // its Undo puts the favourite back, byte for byte
    app.undo_merge(m.undo).unwrap();
    assert_eq!(get(&v, "logseq/config.edn"), after_rename);
    assert_eq!(app.vault.config.favorites, vec!["bar", "Foo two", "other"]);
    // a merge into a page that isn't a favourite: the entry names it now; the first item can go too,
    // and one after another on a line
    let m = app.merge_pages("Foo two", "Baz").unwrap();
    assert_eq!(m.favorites, vec!["bar", "Baz", "other"]);
    put(&v, "logseq/config.edn", "{:favorites [\"baz\" \"Bar\"]}");
    let mut app = App::open(&v).unwrap();
    let m = app.merge_pages("Baz", "Bar").unwrap();
    assert_eq!(m.favorites, vec!["Bar"]);
    assert_eq!(get(&v, "logseq/config.edn"), "{:favorites [\"Bar\"]}");
    put(&v, "pages/Baz.md", "- baz\n");
    put(&v, "logseq/config.edn", "{:favorites [\"Bar\" \"baz\"] ;; mine\n}");
    let mut app = App::open(&v).unwrap();
    let m = app.merge_pages("Baz", "Bar").unwrap();
    assert_eq!(m.favorites, vec!["Bar"]);
    assert_eq!(get(&v, "logseq/config.edn"), "{:favorites [\"Bar\"] ;; mine\n}");
    // not a favourite: config.edn untouched
    put(&v, "logseq/config.edn", "{:favorites [\"Bar\"]}\n");
    put(&v, "pages/Qux.md", "- qux\n");
    let mut app = App::open(&v).unwrap();
    app.rename("Qux", "Quux").unwrap();
    assert_eq!(get(&v, "logseq/config.edn"), "{:favorites [\"Bar\"]}\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn merging_refuses_duplicates_long_yaml_and_journal_aliases() {
    let v = vault("refuse2");
    put(&v, "pages/Bar.md", "- bar\n");
    put(&v, "pages/Foo.md", "- foo\n");
    put(&v, "pages/foo_dup.md", "title:: Foo\n\n- another file saying it is Foo\n");
    put(&v, "pages/Long.md", "---\ndescription: |\n  line one\n  line two\n---\n- long\n");
    put(&v, "pages/Nested.md", "---\nauthor:\n  name: X\n---\n- nested\n");
    put(&v, "pages/Simple.md", "---\ntags:\n  - a\n  - b\ntype: [x, y]\nsource: \"web\"\n---\n- simple\n");
    put(&v, "journals/2026_10_25.md", "alias:: Kickoff\n\n- a day\n");
    let mut app = App::open(&v).unwrap();
    let all = || ["pages/Bar.md", "pages/Foo.md", "pages/foo_dup.md", "pages/Long.md", "pages/Nested.md"].map(|r| get(&v, r));
    let before = all();
    // a name two files claim: merging would hand it to the other file
    assert!(app.rename_target("Foo", "Bar").unwrap_err().contains("Another file"));
    assert!(app.merge_pages("Foo", "Bar").unwrap_err().contains("Another file"));
    // a YAML header that can't all become properties
    assert!(app.merge_pages("Long", "Bar").unwrap_err().contains("YAML"));
    assert!(app.merge_pages("Nested", "Bar").unwrap_err().contains("YAML"));
    assert_eq!(all(), before, "nothing changed");
    assert!(!v.join("logseq/.recycle").exists());
    // a journal day's other name: no merge offered
    assert!(app.rename_target("Bar", "kickoff").unwrap_err().contains("journal day"));
    // a simple one merges, its lists as comma lists
    let r = app.merge_pages("Simple", "Bar").unwrap();
    assert!(r.props);
    assert_eq!(get(&v, "pages/Bar.md"), "- bar\n- tags:: a, b\n  type:: x, y\n  source:: web\n- simple\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[cfg(unix)]
#[test]
fn a_link_that_cant_be_rewritten_doesnt_stop_the_merge() {
    use std::os::unix::fs::PermissionsExt;
    let v = vault("stuck");
    std::fs::create_dir_all(v.join("pages/locked")).unwrap();
    put(&v, "pages/Bar.md", "- bar\n");
    put(&v, "pages/Foo.md", "- foo\n");
    put(&v, "pages/locked/Other.md", "- see [[Foo]]\n");
    put(&v, "pages/Free.md", "- and [[Foo]]\n");
    let mut app = App::open(&v).unwrap();
    std::fs::set_permissions(v.join("pages/locked"), std::fs::Permissions::from_mode(0o555)).unwrap();
    let r = app.merge_pages("Foo", "Bar");
    std::fs::set_permissions(v.join("pages/locked"), std::fs::Permissions::from_mode(0o755)).unwrap();
    let r = r.unwrap();
    if r.skipped.is_empty() {
        // (running as a user who can write anywhere: nothing to check)
        let _ = std::fs::remove_dir_all(&v);
        return;
    }
    assert_eq!(r.skipped, vec!["pages/locked/Other.md"]);
    assert_eq!(r.files_changed, 1);
    assert_eq!(get(&v, "pages/Free.md"), "- and [[Bar]]\n");
    // finished: Undo works
    app.undo_merge(r.undo).unwrap();
    assert_eq!(get(&v, "pages/Free.md"), "- and [[Foo]]\n");
    assert_eq!(get(&v, "pages/Bar.md"), "- bar\n");
    let _ = std::fs::remove_dir_all(&v);
}

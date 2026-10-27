use outline_core::*;

fn sample() -> Vault {
    let mut v = Vault::new();
    v.upsert(
        "pages/Sourdough Bread.md",
        "alias:: SB\ntags:: baking, [[home cooking]]\nstatus:: active\n\n- SBs are simple loaves\n\t- see [[Hartley]] and #loaf-42\n",
    );
    v.upsert(
        "journals/2026_10_25.md",
        "- Read about [[sourdough bread]] today #reading\n- Meeting with [[Rosa]]\n\tstatus:: done\n\tproject:: [[Pickles in brine]]\n- `[[not a link]]` and #notatag inside code? no: `#x`\n- ```python\n  [[fake]] inside fence\n  ```\n- url https://x.com/#anchor is not a tag\n",
    );
    v.upsert("journals/2026_10_24.md", "- Talked about [[SB]] recipes\n");
    v.upsert("pages/Pickles in brine.md", "- [[Sourdough Bread]] under brine\n- self link [[Pickles in brine]]\n");
    v.upsert("pages/namespace___child.md", "title:: Fancy Title\n- body\n");
    v.upsert("pages/plain.md", "No bullets here, mentions [[Hartley]].\nSecond line.\n");
    v
}

#[test]
fn journal_names() {
    let c = Config::default();
    assert_eq!(c.journal_title((2026, 10, 25)), "Oct 25th, 2026");
    assert_eq!(c.journal_title((2026, 10, 1)), "Oct 1st, 2026");
    assert_eq!(c.journal_title((2026, 10, 12)), "Oct 12th, 2026");
    assert_eq!(c.journal_title((2026, 10, 22)), "Oct 22nd, 2026");
    assert_eq!(c.journal_title((2026, 10, 23)), "Oct 23rd, 2026");
    assert_eq!(c.journal_rel_path((2026, 1, 5)), "journals/2026_01_05.md");
    let v = Vault::new();
    assert_eq!(v.title_from_path("pages/a___b.md").0, "a/b");
    assert_eq!(v.title_from_path("pages/a%2Fb.md").0, "a/b");
    assert_eq!(v.title_from_path("pages/hydration_%5F___x.md").0, "hydration__/x");
    assert_eq!(date::weekday((2026, 10, 25)), 0); // a Sunday
    assert_eq!(date::format("EEEE, yyyy-MM-dd", (2026, 10, 25)), "Sunday, 2026-10-25");
}

#[test]
fn user_style_config() {
    // a typical config: journals in "Diary", full month names in titles and files
    let edn = r#"{:meta/version 1
 ;; :pages-directory "your-directory"
 :journals-directory "Diary"
 :journal/page-title-format "MMMM do, yyyy"
 :journal/file-name-format "MMMM do, yyyy"
 :property/separated-by-commas #{:cooks :Topics}
 :scheduled/future-days 14
}"#;
    let c = Config::from_edn(edn);
    assert_eq!(c.future_days, 14);
    assert_eq!(Config::default().future_days, 7);
    assert_eq!(c.pages_dir, "pages");
    assert_eq!(c.journals_dir, "Diary");
    assert_eq!(c.comma_props, vec!["cooks", "topics"]);
    assert_eq!(c.journal_rel_path((2026, 10, 25)), "Diary/October 25th, 2026.md");
    let mut v = Vault::with_config(c);
    v.upsert("Diary/October 25th, 2026.md", "- about [[Recipe A]]\n");
    v.upsert("pages/Recipe A.md", "cooks:: Nell Pike, Omar Frost\nfile:: [x](file://C:/a.pdf)\n- body\n");
    assert_eq!(v.linked_refs("recipe a")[0].page, "October 25th, 2026");
    assert_eq!(v.linked_refs("recipe a")[0].journal, Some((2026, 10, 25)));
    assert_eq!(v.linked_refs("Omar Frost").len(), 1);
    // non-listed props with plain text do not make pages
    assert!(v.linked_refs("[x](file://C:/a.pdf)").is_empty());
    let i = v.page_info("October 26th, 2026");
    assert_eq!(i.path.as_deref(), Some("Diary/October 26th, 2026.md"));
    assert_eq!(i.journal, Some((2026, 10, 26)));
}

#[test]
fn backlinks_include_alias_and_journals_newest_first() {
    let v = sample();
    let g = v.linked_refs("Sourdough Bread");
    let pages: Vec<&str> = g.iter().map(|x| x.page.as_str()).collect();
    assert_eq!(pages, vec!["Oct 25th, 2026", "Oct 24th, 2026", "Pickles in brine"]);
    // alias resolves to the same page
    assert_eq!(v.linked_refs("sb").len(), 3);
}

#[test]
fn self_links_excluded_and_block_props_link() {
    let v = sample();
    let g = v.linked_refs("Pickles in brine");
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].page, "Oct 25th, 2026");
    assert_eq!(g[0].hits[0].text, "Meeting with [[Rosa]]\nstatus:: done\nproject:: [[Pickles in brine]]");
    assert_eq!(g[0].hits[0].props[0], ("status".into(), "done".into()));
}

/// (line, depth, text) of each note next to a reference.
fn notes(v: &[RefNote]) -> Vec<(usize, usize, &str)> {
    v.iter().map(|n| (n.line, n.depth, n.text.as_str())).collect()
}

#[test]
fn linked_refs_come_with_their_sub_notes_and_parents() {
    let mut v = Vault::new();
    v.upsert(
        "pages/Meeting notes.md",
        "- Kitchen\n\t- Monday\n\t  status:: busy\n\t\t- Talked to [[Tobias]] about brine\n\t\t\t- first point\n\t\t\t\t- a detail\n\t\t\t- second point\n\t\t\t  with a second line\n\t\t- not under it\n- Another [[Tobias]] note\n",
    );
    let g = v.linked_refs("tobias");
    assert_eq!(g.len(), 1);
    let h = &g[0].hits;
    assert_eq!(h.len(), 2);
    assert_eq!(h[0].text, "Talked to [[Tobias]] about brine");
    // the path above it: the notes it sits under, outermost first, first lines only
    assert_eq!(notes(&h[0].parents), vec![(0, 0, "Kitchen"), (1, 1, "Monday")]);
    // its sub-notes as in the page, whole texts; the note after them isn't one
    assert_eq!(notes(&h[0].kids), vec![(4, 3, "first point"), (5, 4, "a detail"), (6, 3, "second point\nwith a second line")]);
    assert_eq!(h[0].more, 0);
    // a top-level note without sub-notes: nothing around it
    assert!(h[1].parents.is_empty() && h[1].kids.is_empty() && h[1].more == 0);
    // a CRLF file: the path's first lines come without the line ending
    v.upsert("pages/Windows.md", "- Top\r\n\t- under [[Tobias]]\r\n");
    let g = v.linked_refs("tobias");
    let w = g.iter().find(|x| x.page == "Windows").unwrap();
    assert_eq!(notes(&w.hits[0].parents), vec![(0, 0, "Top")]);
}

#[test]
fn a_reference_inside_another_shows_once() {
    let mut v = Vault::new();
    v.upsert("journals/2026_10_25.md", "- Call with [[Tobias]]\n\t- agenda\n\t\t- ask [[Tobias]] about the jar\n- later, [[Tobias]] again\n");
    let g = v.linked_refs("Tobias");
    let h = &g[0].hits;
    // the inner mention is among the first one's sub-notes, so it isn't listed on its own
    assert_eq!(h.len(), 2);
    assert_eq!(notes(&h[0].kids), vec![(1, 1, "agenda"), (2, 2, "ask [[Tobias]] about the jar")]);
    assert_eq!(h[1].text, "later, [[Tobias]] again");
}

#[test]
fn many_sub_notes_are_capped_nearest_levels_first() {
    // a reference with 3 children, each with 30 children of its own: 93 sub-notes
    let mut t = String::from("- Planning [[Cookbook]]\n");
    for c in 0..3 {
        t.push_str(&format!("\t- chapter {c}\n"));
        for k in 0..30 {
            t.push_str(&format!("\t\t- note {c}.{k}{}\n", if c == 2 && k == 20 { " for [[Cookbook]]" } else { "" }));
        }
    }
    let mut v = Vault::new();
    v.upsert("pages/Plan.md", &t);
    let g = v.linked_refs("cookbook");
    let h = &g[0].hits;
    assert_eq!(h[0].kids.len(), REF_KIDS);
    assert_eq!(h[0].more, 93 - REF_KIDS);
    // every child (the level that starts open) is there, then grandchildren in page order
    let children: Vec<&str> = h[0].kids.iter().filter(|k| k.depth == 1).map(|k| k.text.as_str()).collect();
    assert_eq!(children, vec!["chapter 0", "chapter 1", "chapter 2"]);
    let lines: Vec<usize> = h[0].kids.iter().map(|k| k.line).collect();
    assert!(lines.windows(2).all(|w| w[0] < w[1]), "in page order: {lines:?}");
    assert_eq!(h[0].kids.iter().filter(|k| k.depth == 2).count(), REF_KIDS - 3);
    // 30 of chapter 0's, 17 of chapter 1's, none of chapter 2's
    assert_eq!(h[0].kids.iter().rev().find(|k| k.depth == 2).unwrap().text, "note 1.16");
    assert_eq!(h[0].kids.last().unwrap().text, "chapter 2");
    // the mention left out with the rest shows on its own, with its path
    assert_eq!(h.len(), 2);
    assert_eq!(h[1].text, "note 2.20 for [[Cookbook]]");
    assert_eq!(notes(&h[1].parents), vec![(0, 0, "Planning [[Cookbook]]"), (63, 1, "chapter 2")]);
}

#[test]
fn only_linked_references_carry_the_notes_around_them() {
    let mut v = Vault::new();
    v.upsert("pages/A.md", "- top\n\t- see [[B]], and Clara as text\n\t  kind:: x\n\t\t- child\n");
    let linked = serde_json::to_value(v.linked_refs("B")).unwrap();
    let hit = &linked[0]["hits"][0];
    assert_eq!(hit["parents"][0]["text"], "top");
    assert_eq!(hit["kids"][0]["text"], "child");
    assert!(hit.get("more").is_none());
    // unlinked references and property matches: one line each, as before
    let (un, _) = v.unlinked_refs("Clara", 10);
    let un = serde_json::to_value(un).unwrap();
    assert_eq!(un[0]["hits"][0]["text"], "see [[B]], and Clara as text\nkind:: x");
    let keys = |h: &serde_json::Value| h.as_object().unwrap().keys().cloned().collect::<Vec<_>>();
    assert_eq!(keys(&un[0]["hits"][0]), vec!["depth", "line", "props", "text"]);
    let p = serde_json::to_value(v.with_property("kind", None)).unwrap();
    assert_eq!(keys(&p[0]["hits"][0]), vec!["depth", "line", "props", "text"]);
}

#[test]
fn ref_open_level_setting() {
    assert_eq!(Config::default().ref_open_level, 2);
    assert_eq!(Config::from_edn("{:ref/default-open-blocks-level 3}").ref_open_level, 3);
    assert_eq!(Config::from_edn("{:ref/default-open-blocks-level 1 :meta/version 1}").ref_open_level, 1);
    assert_eq!(Config::from_edn("{:ref/default-open-blocks-level \"x\"}").ref_open_level, 2);
}

#[test]
fn code_and_urls_ignored() {
    let v = sample();
    assert!(v.linked_refs("not a link").is_empty());
    assert!(v.linked_refs("fake").is_empty());
    assert!(v.linked_refs("anchor").is_empty());
    assert!(v.linked_refs("x").is_empty());
    assert_eq!(v.linked_refs("reading").len(), 1);
    assert_eq!(v.linked_refs("loaf-42").len(), 1);
}

#[test]
fn tags_and_properties() {
    let v = sample();
    assert_eq!(v.pages_tagged("baking"), vec!["Sourdough Bread"]);
    assert_eq!(v.pages_tagged("Home Cooking"), vec!["Sourdough Bread"]);
    // page-level tag shows as page-level reference
    let g = v.linked_refs("home cooking");
    assert_eq!(g[0].hits[0].line, None);
    let s = v.with_property("status", None);
    assert_eq!(s.len(), 2);
    let d = v.with_property("status", Some("DONE"));
    assert_eq!(d.len(), 1);
    // plain property values do not become pages (Logseq 0.8.9+ default)
    assert!(v.linked_refs("active").is_empty());
    let info = v.page_info("SB");
    assert_eq!(info.name, "Sourdough Bread");
    assert_eq!(info.aliases, vec!["SB"]);
}

#[test]
fn title_property_and_plain_files() {
    let v = sample();
    assert!(v.page_info("Fancy Title").exists);
    let w = v.linked_refs("hartley");
    assert_eq!(w.len(), 2);
    let plain = w.iter().find(|g| g.page == "plain").unwrap();
    assert!(plain.hits[0].text.starts_with("No bullets here"));
    // referenced-only page
    let i = v.page_info("Rosa");
    assert!(!i.exists);
    assert_eq!(i.path.as_deref(), Some("pages/Rosa.md"));
}

#[test]
fn update_and_remove_reindex() {
    let mut v = sample();
    v.upsert("journals/2026_10_24.md", "- nothing now\n");
    assert_eq!(v.linked_refs("sourdough bread").len(), 2);
    v.remove("journals/2026_10_25.md");
    assert_eq!(v.linked_refs("sourdough bread").len(), 1);
    assert!(v.linked_refs("reading").is_empty());
}

#[test]
fn search_names_then_text() {
    let v = sample();
    let s = v.search("sourdough", 10);
    assert_eq!(s[0].page, "Sourdough Bread");
    assert!(s.iter().any(|h| h.line.is_some()));
}

#[test]
fn append_bullet_works() {
    assert_eq!(append_bullet("", "hi"), "- hi\n");
    assert_eq!(append_bullet("-\n", "hi"), "- hi\n");
    assert_eq!(append_bullet("- a\n\n", "b\nc"), "- a\n- b\n  c\n");
    // a file without a final line break keeps it that way (as the editor does)
    assert_eq!(append_bullet("- a", "b"), "- a\n- b");
    assert_eq!(append_bullet("- a\r\n- b", "c"), "- a\r\n- b\r\n- c");
}

#[test]
fn crlf_and_spaces_indent() {
    let p = parse_page("- a\r\n  - b [[X]]\r\n    k:: v\r\n", &[]);
    assert_eq!(p.blocks.len(), 2);
    assert_eq!(p.blocks[1].depth, 1);
    assert_eq!(p.blocks[1].props, vec![("k".into(), "v".into())]);
    assert_eq!(p.blocks[1].refs, vec!["X".to_string()]);
}

#[test]
fn nested_brackets() {
    let p = parse_page("- [[a [[b]]]] #[[c d]], end\n", &[]);
    assert_eq!(p.blocks[0].refs, vec!["a [[b]]".to_string(), "c d".to_string()]);
}

#[test]
fn two_files_one_page_name_never_crash() {
    let mut v = Vault::new();
    // a long page first, then a short file claiming the same name via title::
    v.upsert("pages/Plain.md", "- a\n- b\n- c\n- d [[X]]\n");
    v.upsert("pages/other.md", "title:: Plain\n- only one block [[Y]]\n");
    // must not index past the end of the shorter page
    for n in ["X", "Y", "Plain", "other"] {
        let _ = v.linked_refs(n);
    }
    // the first file keeps the name; the duplicate is reported, not merged
    assert_eq!(v.page_info("Plain").path.as_deref(), Some("pages/Plain.md"));
    assert_eq!(v.duplicates(), vec![("Plain".to_string(), vec!["pages/Plain.md".to_string(), "pages/other.md".to_string()])]);
    assert_eq!(v.linked_refs("X").len(), 1);
    // removing the winner lets the duplicate take over
    v.remove("pages/Plain.md");
    v.upsert("pages/other.md", "title:: Plain\n- only one block [[Y]]\n");
    assert_eq!(v.page_info("Plain").path.as_deref(), Some("pages/other.md"));
}

#[test]
fn block_refs_search_and_ids() {
    let mut v = sample();
    v.upsert(
        "pages/Refs.md",
        "- Rule one is salt first\n  id:: 6528AAAA-bbbb-4ccc-8ddd-eeeeffff0001\n- another rule note\n\t- rule of thumb\n\t  status:: rule\n- id only in a property\n  id:: 6528aaaa-bbbb-4ccc-8ddd-eeeeffff0002\n",
    );
    // notes holding every word, starting with them first, then shorter; property lines don't count
    let hits = v.search_blocks("rule", 12);
    let texts: Vec<&str> = hits.iter().map(|h| h.text.lines().next().unwrap()).collect();
    assert_eq!(texts[..3], ["rule of thumb", "Rule one is salt first", "another rule note"], "{texts:?}");
    assert!(!hits.iter().any(|h| h.text.starts_with("id only")));
    assert_eq!(v.search_blocks("thumb rule", 12).len(), 1); // every word, in any order
    assert!(v.search_blocks("  ", 12).is_empty());
    assert!(v.search_blocks("6528", 12).is_empty(), "an id:: line isn't the note's words");
    let h = &v.search_blocks("salt", 12)[0];
    assert_eq!((h.page.as_str(), h.line), ("Refs", 0));
    assert!(h.text.contains("id:: 6528AAAA"));
    // ids: in the order asked, any capitals; unknown ones are None; one asked twice comes twice
    let ids = ["6528aaaa-bbbb-4ccc-8ddd-eeeeffff0002", "nope", "6528aaaa-bbbb-4ccc-8ddd-eeeeffff0001", "6528AAAA-BBBB-4ccc-8ddd-eeeeffff0002"];
    let got = v.blocks_by_id(&ids.map(String::from));
    assert_eq!(got[0].as_ref().map(|h| h.line), Some(5));
    assert!(got[1].is_none());
    assert_eq!(got[2].as_ref().map(|h| (h.page.clone(), h.line)), Some(("Refs".into(), 0)));
    assert_eq!(got[3], got[0]);
    assert!(v.blocks_by_id(&[]).is_empty());
    // only "- " notes: not a plain paragraph before the bullets, nor a "* " or "+ " bullet (giving
    // one an id would rewrite it as "- "); a lone "-" and "- " under a paragraph are fine
    v.upsert("pages/Odd.md", "A paragraph about kiwi fruit.\n\nAnother kiwi paragraph.\n\n- a kiwi dash note\n* a kiwi star note\n+ a kiwi plus note\n\t- a deeper kiwi dash\n");
    v.upsert("pages/Obs.md", "* kiwi in obsidian\n    * deeper kiwi\n");
    let mut got: Vec<String> = v.search_blocks("kiwi", 12).into_iter().map(|h| h.text).collect();
    got.sort();
    assert_eq!(got, ["a deeper kiwi dash", "a kiwi dash note"]);
}

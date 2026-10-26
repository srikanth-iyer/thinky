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

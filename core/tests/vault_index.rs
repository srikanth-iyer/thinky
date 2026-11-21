//! Review A3: the index keeps an alias map turned round (page → its aliases), an index of note ids,
//! and each page's `#tags`, so the All pages list, block references and the Tags list no longer
//! read every alias or every note on each call. What they give is as before; these tests check
//! it through every change a file can make (added, edited, gone, its name taken over, shadowed).
use outline_core::*;

fn refs(v: &Vault, name: &str) -> usize {
    v.all_pages().into_iter().find(|p| p.name == name).map_or(0, |p| p.refs)
}

fn hits(v: &Vault, name: &str) -> usize {
    v.linked_refs(name).iter().map(|g| g.hits.len()).sum()
}

fn aliases(v: &Vault, name: &str) -> Vec<String> {
    let mut a = v.all_pages().into_iter().find(|p| p.name == name).map(|p| p.aliases).unwrap_or_default();
    a.sort();
    a
}

#[test]
fn a_pages_aliases_count_as_it_through_every_change() {
    let mut v = Vault::new();
    v.upsert("pages/Sourdough Bread.md", "alias:: SB, Levain\n\n- the page\n");
    v.upsert("pages/Uses.md", "- [[SB]] and [[Levain]]\n- [[Sourdough Bread]]\n- [[sb]] in small letters\n");
    assert_eq!(v.resolve("sb"), key("Sourdough Bread"));
    assert_eq!(refs(&v, "Sourdough Bread"), 3, "each note that links by any of its names, once");
    assert_eq!(hits(&v, "Sourdough Bread"), 3);
    assert_eq!(hits(&v, "SB"), 3, "asking by an alias is asking for the page");
    assert_eq!(aliases(&v, "Sourdough Bread"), vec!["Levain", "SB"]);
    assert!(v.all_pages().iter().all(|p| p.name != "SB" && p.name != "Levain"), "an alias is no page of its own");

    // another page says it is SB too: the file read last has the alias, as before
    v.upsert("pages/Starter.md", "alias:: SB\n\n- a jar\n");
    assert_eq!(v.resolve("SB"), key("Starter"));
    assert_eq!(hits(&v, "Starter"), 2, "[[SB]] and [[sb]]");
    assert_eq!(hits(&v, "Sourdough Bread"), 3, "its own alias:: still counts [[SB]] for it, as before");
    assert_eq!(aliases(&v, "Sourdough Bread"), vec!["Levain"]);

    // the page that took it goes: the alias goes with it (it isn't handed back)
    v.remove("pages/Starter.md");
    assert_eq!(v.resolve("SB"), key("SB"));
    assert_eq!(hits(&v, "Sourdough Bread"), 3);
    assert_eq!(refs(&v, "SB"), 2, "now also a name of its own, linked to by two notes");
    assert_eq!(aliases(&v, "Sourdough Bread"), vec!["Levain"]);

    // the page is edited: an alias dropped, another added
    v.upsert("pages/Sourdough Bread.md", "alias:: SB, Mother\n\n- the page\n");
    assert_eq!(aliases(&v, "Sourdough Bread"), vec!["Mother", "SB"]);
    assert_eq!(v.resolve("Levain"), key("Levain"));
    assert_eq!(v.resolve("Mother"), key("Sourdough Bread"));
    assert_eq!((hits(&v, "Sourdough Bread"), refs(&v, "Levain"), refs(&v, "SB")), (3, 1, 0));
    // and its file goes: none of its names lead anywhere
    v.remove("pages/Sourdough Bread.md");
    for n in ["SB", "Mother", "Sourdough Bread"] {
        assert_eq!(v.resolve(n), key(n), "{n}");
    }
    assert!(aliases(&v, "Sourdough Bread").is_empty());
    assert_eq!((hits(&v, "Sourdough Bread"), refs(&v, "SB")), (1, 2));
}

#[test]
fn an_alias_from_a_shadowed_file_comes_with_it_when_it_takes_the_name() {
    let mut v = Vault::new();
    v.upsert("pages/a.md", "title:: Same\nalias:: First\n\n- a\n");
    v.upsert("pages/b.md", "title:: Same\nalias:: Second\n\n- b\n");
    assert_eq!(v.resolve("First"), key("Same"));
    assert_eq!(v.resolve("Second"), key("Second"), "a file waiting for its name isn't indexed");
    v.remove("pages/a.md");
    assert_eq!(v.resolve("Second"), key("Same"));
    assert_eq!(v.resolve("First"), key("First"));
    assert_eq!(aliases(&v, "Same"), vec!["Second"]);
}

#[test]
fn notes_are_found_by_their_ids_through_every_change() {
    let mut v = Vault::new();
    v.upsert("pages/A.md", "- one\n  id:: 6650aaaa-0000-0000-0000-000000000001\n- two\n  ID:: 6650AAAA-0000-0000-0000-000000000002\n");
    v.upsert("pages/B.md", "- three\n  id:: 6650aaaa-0000-0000-0000-000000000003\n");
    let ask = |v: &Vault, ids: &[&str]| -> Vec<Option<(String, String)>> {
        v.blocks_by_id(&ids.iter().map(|s| s.to_string()).collect::<Vec<_>>()).into_iter().map(|h| h.map(|h| (h.page, h.text.lines().next().unwrap().to_string()))).collect()
    };
    let some = |p: &str, t: &str| Some((p.to_string(), t.to_string()));
    // any capitals, spaces around, asked twice, one that no note has
    assert_eq!(
        ask(&v, &["6650aaaa-0000-0000-0000-000000000002", " 6650AAAA-0000-0000-0000-000000000001 ", "6650aaaa-0000-0000-0000-000000000003", "nope", "6650aaaa-0000-0000-0000-000000000003"]),
        vec![some("A", "two"), some("A", "one"), some("B", "three"), None, some("B", "three")]
    );
    assert!(ask(&v, &[]).is_empty());
    let line = v.blocks_by_id(&["6650aaaa-0000-0000-0000-000000000002".into()])[0].clone().unwrap().line;
    assert_eq!(line, 2, "the note's line in its file");
    // an id moved to another page, one removed, one added
    v.upsert("pages/A.md", "- one\n- new\n  id:: 6650aaaa-0000-0000-0000-000000000009\n");
    v.upsert("pages/B.md", "- three\n  id:: 6650aaaa-0000-0000-0000-000000000003\n- two, moved here\n  id:: 6650aaaa-0000-0000-0000-000000000002\n");
    assert_eq!(
        ask(&v, &["6650aaaa-0000-0000-0000-000000000001", "6650aaaa-0000-0000-0000-000000000002", "6650aaaa-0000-0000-0000-000000000009"]),
        vec![None, some("B", "two, moved here"), some("A", "new")]
    );
    // two notes with one id (a copied note): the one in the first file by its path, every time
    v.upsert("pages/C.md", "- copy\n  id:: 6650aaaa-0000-0000-0000-000000000003\n");
    for _ in 0..3 {
        assert_eq!(ask(&v, &["6650aaaa-0000-0000-0000-000000000003"]), vec![some("B", "three")]);
    }
    v.remove("pages/B.md");
    assert_eq!(ask(&v, &["6650aaaa-0000-0000-0000-000000000003", "6650aaaa-0000-0000-0000-000000000002"]), vec![some("C", "copy"), None]);
    // a file waiting for a name another file has isn't searched, as before; it is once it takes it
    v.upsert("pages/d.md", "title:: C\n\n- waiting\n  id:: 6650aaaa-0000-0000-0000-00000000000d\n");
    assert_eq!(ask(&v, &["6650aaaa-0000-0000-0000-00000000000d"]), vec![None]);
    v.remove("pages/C.md");
    assert_eq!(ask(&v, &["6650aaaa-0000-0000-0000-00000000000d", "6650aaaa-0000-0000-0000-000000000003"]), vec![some("C", "waiting"), None]);
}

#[test]
fn the_tags_list_follows_every_edit() {
    let mut v = Vault::new();
    v.upsert("pages/Authors.md", "alias:: author\n\n- a page\n");
    v.upsert("pages/One.md", "tags:: reading\n\n- #author and #Authors in one note\n- #reading here\n- ```\n  #code isn't a tag\n  ```\n");
    let tags = |v: &Vault| {
        let mut t = v.all_tags();
        t.sort();
        t
    };
    assert_eq!(tags(&v), vec![("Authors".to_string(), 0, 1), ("reading".to_string(), 1, 1)]);
    // asked again: the same (each page's tags kept from the first time)
    assert_eq!(tags(&v), tags(&v));
    // the note edited: the list follows
    v.upsert("pages/One.md", "- #new only\n");
    assert_eq!(tags(&v), vec![("new".to_string(), 0, 1)]);
    // an alias added later joins a tag to its page
    v.upsert("pages/Two.md", "- #writer\n- #new\n");
    v.upsert("pages/Authors.md", "alias:: author, writer\n\n- a page\n");
    assert_eq!(tags(&v), vec![("Authors".to_string(), 0, 1), ("new".to_string(), 0, 2)]);
    v.remove("pages/Two.md");
    assert_eq!(tags(&v), vec![("new".to_string(), 0, 1)]);
}

#[test]
fn many_pages_with_aliases_list_quickly_and_right() {
    // (the list used to look through every alias for every page: 3,000 × 3,000 here)
    let mut v = Vault::new();
    for i in 0..3000 {
        v.upsert(&format!("pages/P{i}.md"), &format!("alias:: Q{i}\n\n- links [[Q{}]] and [[P{}]]\n  id:: 00000000-0000-0000-0000-{i:012}\n", (i + 1) % 3000, (i + 2) % 3000));
    }
    let t = std::time::Instant::now();
    let all = v.all_pages();
    let ids: Vec<String> = (0..3000).map(|i| format!("00000000-0000-0000-0000-{i:012}")).collect();
    let found = v.blocks_by_id(&ids);
    let took = t.elapsed();
    assert_eq!(all.len(), 3000);
    assert!(all.iter().all(|p| p.refs == 2 && p.aliases.len() == 1), "each linked once by its name and once by its alias");
    assert!(found.iter().enumerate().all(|(i, h)| h.as_ref().is_some_and(|h| h.page == format!("P{i}"))));
    assert!(took < std::time::Duration::from_secs(20), "{took:?}");
}

//! Search rules (the Ctrl+K box): words in any order, accents and capitals ignored, small typos in
//! page names forgiven, pages before notes, the best first.
use outline_core::search::*;
use outline_core::*;

fn words(q: &str) -> (Vec<String>, String) {
    let w = query_words(q);
    let p = w.join(" ");
    (w, p)
}
fn name(n: &str, q: &str) -> Option<(NameRank, Vec<(usize, usize)>)> {
    let (w, p) = words(q);
    match_name(n, &w, &p)
}
fn pages(v: &Vault, q: &str) -> Vec<String> {
    v.search(q, 40).into_iter().filter(|h| h.line.is_none()).map(|h| h.page).collect()
}

#[test]
fn folding_drops_capitals_and_accents() {
    assert_eq!(fold("Crémerie LIMÃO Łódź Straße naïve Ñandú"), "cremerie limao lodz straße naive nandu");
    assert_eq!(fold("İstanbul"), "istanbul"); // (a capital İ is two chars in small letters: the dot goes)
    assert_eq!(fold("e\u{301}cole"), "ecole"); // an accent written as a separate mark
    assert_eq!(fold("日本 📚 œuvre ĳ"), "日本 📚 œuvre ĳ"); // nothing else changes
    for (c, b) in [('ł', 'l'), ('ń', 'n'), ('ő', 'o'), ('ŕ', 'r'), ('š', 's'), ('ť', 't'), ('ű', 'u'), ('ŵ', 'w'), ('ŷ', 'y'), ('ž', 'z'), ('ſ', 's'), ('ķ', 'k'), ('ĸ', 'k'), ('ĵ', 'j'), ('ø', 'o'), ('ÿ', 'y')] {
        assert_eq!(fold(&c.to_string()), b.to_string(), "{c}");
    }
    let (chars, from) = fold_map("Aé İx");
    assert_eq!(chars.iter().collect::<String>(), "ae ix");
    assert_eq!(from, vec![0, 1, 2, 3, 4]);
    assert_eq!(&*fold_note("Hello\n  id:: 6528aaaa\ncollapsed:: true\nWorld"), "hello\nworld");
}

#[test]
fn query_words_once_each() {
    assert_eq!(query_words("  Model  dumplings MODEL "), vec!["model", "dumplings"]);
    assert!(query_words("   ").is_empty());
}

#[test]
fn typo_distance() {
    let c = |s: &str| s.chars().collect::<Vec<char>>();
    assert_eq!(prefix_distance(&c("dumpl"), &c("dumplings"), 1), Some((0, 5)));
    assert_eq!(prefix_distance(&c("dmupl"), &c("dumplings"), 1), Some((1, 5))); // two letters swapped
    assert_eq!(prefix_distance(&c("dmplings"), &c("dumplings"), 2), Some((1, 9))); // one missing
    assert_eq!(prefix_distance(&c("dumplingss"), &c("dumplings"), 2), Some((1, 9))); // one too many
    assert_eq!(prefix_distance(&c("recpie"), &c("recipe"), 1), Some((1, 6)));
    assert_eq!(prefix_distance(&c("xyzzy"), &c("model"), 1), None);
    assert_eq!(prefix_distance(&c("models"), &c("mod"), 1), None); // the word is too short
    assert_eq!(allowed_typos(4), 0);
    assert_eq!(allowed_typos(5), 1);
    assert_eq!(allowed_typos(8), 2);
}

#[test]
fn names_any_order_with_marks() {
    // as typed, together: best
    let (r, m) = name("Dumplings recipe", "dumplings recipe").unwrap();
    assert_eq!((r.tier, m), (0, vec![(0, 16)]));
    let (r, m) = name("Dumplings recipe", "Dumplings rec").unwrap();
    assert_eq!((r.tier, m), (1, vec![(0, 13)]));
    let (r, m) = name("The Dumplings recipe", "dumplings recipe").unwrap();
    assert_eq!((r.tier, r.inside, m), (2, 0, vec![(4, 20)]));
    // any order: each word marked where it is
    let (r, m) = name("Dumplings recipe", "recipe dumplings").unwrap();
    assert_eq!((r.tier, r.typos, m), (3, 0, vec![(0, 9), (10, 16)]));
    // a word inside another word still counts, but after words at a word's start
    let (r, _) = name("Nonrecipes of Dumplings", "recipe dumplings").unwrap();
    assert_eq!((r.tier, r.inside), (3, 1));
    // every word is needed
    assert!(name("Dumplings recipe", "dumplings steamers").is_none());
    // accents and capitals don't count; marks are places in the name as written
    let (_, m) = name("Bistro Crémerie Centrale", "cremerie").unwrap();
    assert_eq!(m, vec![(7, 15)]);
    let (_, m) = name("İstanbul notes", "notes istanbul").unwrap();
    assert_eq!(m, vec![(0, 8), (9, 14)]);
}

#[test]
fn names_forgive_small_typos() {
    // one letter off from 5 letters, two from 8; at the start of a word of the name
    let (r, m) = name("Dumplings recipe", "dmplings").unwrap();
    assert_eq!((r.tier, r.typos, m), (4, 1, vec![(0, 9)]));
    let (r, m) = name("Dumplings recipe", "recpie dumplnsg").unwrap(); // (1 swap; 1 missing + 1 swap)
    assert_eq!((r.tier, r.typos, m), (4, 3, vec![(0, 9), (10, 16)]));
    let (r, _) = name("Crumb texture chart", "crunb textre").unwrap();
    assert_eq!((r.tier, r.typos), (4, 2));
    // a word still being typed: the start of a longer word
    assert!(name("Dumplings recipe", "dmupl").is_some());
    // short words must be right
    assert!(name("Dumplings recipe", "rcip").is_none());
    assert!(name("Cats", "dogs").is_none());
    // too many letters off
    assert!(name("Dumplings recipe", "dmplnsg").is_none());
}

fn sample() -> Vault {
    let mut v = Vault::new();
    v.upsert("pages/Dumplings recipe.md", "alias:: Fermentation model\n\n- Step-by-step guide to fermentation\n\t- cooked in bamboo steamers\n");
    v.upsert("pages/Model kitchen.md", "- tins in squares\n");
    v.upsert("pages/Modal logic.md", "- possible worlds\n");
    v.upsert("pages/Shells.md", "- sea shells\n");
    v.upsert("pages/Sourdough Bread.md", "- loaf 42\n\tid:: 6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666\n- see [[Dumplings recipe]] for steamers\n");
    v.upsert("journals/2026_10_24.md", "- older: the recipe of dumplings, steamers going\n");
    v.upsert("journals/2026_10_25.md", "- newer: dumplings's recipe again\n- a note about the Dumplings recipe with bamboo steamers\n");
    v.upsert("pages/Notes.md", "- links to [[Unwritten idea]] and [[Model zoo]]\n");
    v
}

#[test]
fn pages_best_first_then_notes() {
    let v = sample();
    // the name as typed first, then the name starting with it, then with it inside, then typos
    assert_eq!(pages(&v, "model"), vec!["Model kitchen", "Model zoo", "Dumplings recipe", "Modal logic"]);
    // any order
    assert_eq!(pages(&v, "recipe dumplings")[0], "Dumplings recipe");
    // with typos
    assert_eq!(pages(&v, "dmplings recpie"), vec!["Dumplings recipe"]);
    // a page that is only linked to so far is found too, after a file with the same rank
    assert!(pages(&v, "unwritten").contains(&"Unwritten idea".to_string()));
    // pages come before notes, at most SEARCH_PAGES of them
    let hits = v.search("model", 40);
    let first_note = hits.iter().position(|h| h.line.is_some()).unwrap();
    assert!(hits[..first_note].iter().all(|h| h.line.is_none()) && hits[first_note..].iter().all(|h| h.line.is_some()));
    assert!(first_note <= SEARCH_PAGES);
    assert!(v.search("model", 3).len() == 3);
}

#[test]
fn alias_finds_its_page() {
    let v = sample();
    let hits = v.search("fermentation mod", 40);
    let h = &hits[0];
    assert_eq!((h.page.as_str(), h.alias.as_deref(), h.line), ("Dumplings recipe", Some("Fermentation model"), None));
    assert_eq!(h.marks, vec![(0, 16)]);
    // the page's own name still wins when it matches as well
    let h = &v.search("dumplings recipe", 40)[0];
    assert_eq!((h.page.as_str(), h.alias.as_deref()), ("Dumplings recipe", None));
    // one result per page
    assert_eq!(v.search("model", 40).iter().filter(|h| h.line.is_none() && h.page == "Dumplings recipe").count(), 1);
}

/// The `[[`/`#` list asks for pages only (`search_pages`), by the same rules: "[[cremerie" finds
/// "Crémerie…", "[[recipe dumplings" the Dumplings recipe; an alias that's a page of its own isn't
/// offered as another page's.
#[test]
fn page_list_finds_pages_as_the_search_box() {
    let mut v = sample();
    v.upsert("pages/Bistro Crémerie Centrale.md", "- BCC\n");
    v.upsert("pages/Hartley.md", "alias:: Edith Hartley, Sourdough Bread\n- pastry chef\n");
    let names = |q: &str| v.search_pages(q, 8).into_iter().map(|h| (h.page, h.alias)).collect::<Vec<_>>();
    assert_eq!(names("cremerie"), [("Bistro Crémerie Centrale".to_string(), None)]);
    assert_eq!(names("recipe dumplings")[0], ("Dumplings recipe".to_string(), None));
    assert_eq!(names("edith"), [("Hartley".to_string(), Some("Edith Hartley".to_string()))]);
    assert_eq!(names("sourdough bread"), [("Sourdough Bread".to_string(), None)], "its own page, not “→ Hartley”");
    assert!(v.search_pages("model", 2).len() == 2 && v.search_pages("  ", 8).is_empty());
    assert!(v.search_pages("model", 8).iter().all(|h| h.line.is_none()), "pages only");
}

#[test]
fn notes_any_order_together_first() {
    let v = sample();
    let notes: Vec<(String, String)> = v.search("dumplings recipe", 40).into_iter().filter(|h| h.line.is_some()).map(|h| (h.page, h.text)).collect();
    // the words together (as typed) first; then newer journal days before older ones, then pages
    assert_eq!(notes[0].1, "a note about the Dumplings recipe with bamboo steamers");
    assert_eq!(notes[1].0, "Sourdough Bread"); // "[[Dumplings recipe]]": together
    let rest: Vec<&str> = notes[2..].iter().map(|n| n.1.as_str()).collect();
    assert_eq!(rest, vec!["newer: dumplings's recipe again", "older: the recipe of dumplings, steamers going"]);
    // any order, accents and capitals ignored
    assert_eq!(v.search("fÉRMÉNTÁTION GUIDE", 40).iter().filter(|h| h.line.is_some()).count(), 1);
    // notes aren't forgiven typos; page names (and aliases) are
    let hits = v.search("fermnetation", 40);
    assert_eq!(hits.len(), 1);
    assert_eq!((hits[0].page.as_str(), hits[0].alias.as_deref()), ("Dumplings recipe", Some("Fermentation model")));
    // hidden lines (id::) aren't searched
    assert!(v.search("6528aaaa", 40).is_empty());
}

#[test]
fn search_follows_changes() {
    let mut v = sample();
    assert_eq!(v.search("squares", 40).len(), 1);
    v.upsert("pages/Model kitchen.md", "- round tins\n");
    assert!(v.search("squares", 40).is_empty());
    assert_eq!(v.search("round", 40).len(), 1);
    v.remove("pages/Model kitchen.md");
    assert!(v.search("round", 40).is_empty());
}

#[test]
fn long_notes_give_the_part_with_the_words() {
    let long: String = (0..60).map(|i| format!("line {i} with some filler words to make it long")).collect::<Vec<_>>().join("\n");
    let text = format!("{long}\nthe [[needle]] is here\nand after it");
    let w = query_words("needle");
    let ex = note_excerpt(&text, &w);
    assert!(ex.starts_with("line 59 with") && ex.contains("[[needle]] is here") && ex.len() <= 600, "{ex}");
    // one very long line: cut around the word, char-safe
    let line = format!("{} the needle {}", "é".repeat(800), "ü".repeat(800));
    let ex = note_excerpt(&line, &w);
    assert!(ex.starts_with('…') && ex.ends_with('…') && ex.contains("the needle"), "{ex}");
    assert_eq!(note_excerpt("short [[note]]", &w), "short [[note]]");
}

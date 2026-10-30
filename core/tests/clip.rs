//! Neat web links in quick captures, and highlights from the browser extension filed on the
//! article's own page (`clip.rs`).
use outline_core::app::{set_cache_dir, App};
use outline_core::capture::{self, as_link, clean_title, host, md_link, split_url};
use outline_core::clip::{file_clip, guard, highlight_note, normalize_url, source_url, Clip, Highlight};
use outline_core::Config;
use std::path::{Path, PathBuf};

const TODAY: (i32, u32, u32) = (2026, 10, 29);

fn vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_clip_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "Diary", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    // a typical config: journals in Diary, titles like "October 29th, 2026"
    std::fs::write(
        v.join("logseq/config.edn"),
        "{:journal/page-title-format \"MMMM do, yyyy\"\n :journal/file-name-format \"MMMM do, yyyy\"\n :journals-directory \"Diary\"}\n",
    )
    .unwrap();
    v
}
fn put(v: &Path, rel: &str, text: &str) {
    std::fs::write(v.join(rel), text).unwrap();
}
fn get(v: &Path, rel: &str) -> String {
    std::fs::read_to_string(v.join(rel)).unwrap()
}
fn open(v: &Path) -> App {
    set_cache_dir(std::env::temp_dir().join(format!("outline_clip_cache_{}", std::process::id())));
    App::open(v).unwrap()
}
fn hl(text: &str, link: &str) -> Highlight {
    Highlight { text: text.into(), link: link.into() }
}
fn weekly(hs: Vec<Highlight>) -> Clip {
    Clip { url: "https://www.kitchenweekly.org/how-bread-rises-20261020/".into(), title: "How Bread Rises | Kitchen Weekly".into(), site: "Kitchen Weekly".into(), highlights: hs }
}

// ---------------------------------------------------------------- neat links

#[test]
fn links_get_a_neat_name() {
    let u = "https://www.kitchenweekly.org/x/";
    assert_eq!(md_link(u, "How Bread Rises | Kitchen Weekly", "Kitchen Weekly"), "[How Bread Rises · Kitchen Weekly](https://www.kitchenweekly.org/x/)");
    assert_eq!(md_link(u, "How Bread Rises", ""), "[How Bread Rises · kitchenweekly.org](https://www.kitchenweekly.org/x/)", "no site name: its address");
    assert_eq!(md_link(u, "", ""), "[kitchenweekly.org](https://www.kitchenweekly.org/x/)", "no title: just the site");
    assert_eq!(md_link(u, "Kitchen Weekly", "Kitchen Weekly"), "[Kitchen Weekly](https://www.kitchenweekly.org/x/)", "a home page");
    assert_eq!(md_link("https://a.b/p (1)", "[Draft] notes", ""), "[(Draft) notes · a.b](https://a.b/p%20%281%29)", "brackets can't break the link");
    assert_eq!(md_link("", "x", "y"), "");
    assert_eq!(host("https://user@www.Example.com:8080/a?b#c"), "example.com");
    assert_eq!(clean_title("How Bread Rises - kitchenweekly.org", "", "https://kitchenweekly.org/"), "How Bread Rises");
    assert_eq!(clean_title("Rust | Rust Lang", "", "https://rustlang.org/"), "Rust", "the site's address spelled as words");
    assert_eq!(clean_title("A | B", "Kitchen", "https://q.org/"), "A | B", "another ending stays");
}

#[test]
fn quick_captures_link_neatly() {
    let cfg = Config::default();
    let day = (2026, 10, 29);
    // a bare address in typed words becomes a neat link
    let b = capture::bullet(&cfg, "great read https://www.kitchenweekly.org/x", "", false, day, "14:05");
    assert!(b.contains("great read from [kitchenweekly.org](https://www.kitchenweekly.org/x)"), "{b}");
    // the bookmarklet's link carries the title already: kept as it is
    let b = capture::bullet(&cfg, "a passage", "[How Bread Rises · Kitchen Weekly](https://q.org/x)", false, day, "14:05");
    assert!(b.contains("a passage from [How Bread Rises · Kitchen Weekly](https://q.org/x)"), "{b}");
    // no words: the link is the note, without a dangling "from"
    let b = capture::bullet(&cfg, "", "[How Bread Rises · Kitchen Weekly](https://q.org/x)", false, day, "14:05");
    assert!(b.ends_with("**14:05**: [How Bread Rises · Kitchen Weekly](https://q.org/x)"), "{b}");
    // the capture box's text: words then the link, as the link prefills it
    let b = capture::bullet(&cfg, "a passage [T · S](https://q.org/x?a=(1))", "", false, day, "14:05");
    assert!(b.contains("a passage from [T · S](https://q.org/x?a=(1))"), "{b}");
    assert_eq!(split_url("see [T](https://a.b/c) and https://d.e"), ("see  and https://d.e".to_string(), "[T](https://a.b/c)".to_string()));
    assert_eq!(as_link("[T](https://a.b)"), "[T](https://a.b)");
    assert_eq!(as_link("https://a.b"), "[a.b](https://a.b)");
}

// ---------------------------------------------------------------- the extension's highlights

#[test]
fn addresses_compare_however_written() {
    let a = normalize_url("https://www.kitchenweekly.org/how-bread-rises/?utm_source=twitter&fbclid=1#comments");
    assert_eq!(a, "https://kitchenweekly.org/how-bread-rises");
    assert_eq!(normalize_url("http://KitchenWeekly.org:443/how-bread-rises"), a);
    assert_eq!(normalize_url("https://a.b/x?id=3&utm_medium=e"), "https://a.b/x?id=3", "real parameters stay");
    assert_eq!(source_url("[T · S](https://a.b/x%28y%29)").as_deref(), Some("https://a.b/x(y)"));
    assert_eq!(source_url("https://a.b/x").as_deref(), Some("https://a.b/x"));
    assert_eq!(source_url("[[Some page]]"), None);
}

#[test]
fn passages_cant_change_the_page_shape() {
    let g = guard("first line\n- looks like a note\n\n\n  key:: value\n```code\n#+BEGIN_QUOTE\nlast   \n\n");
    assert_eq!(g, "first line\n\u{200b}- looks like a note\n\n\u{200b}key:: value\n\u{200b}```code\n\u{200b}#+BEGIN_QUOTE\nlast");
    assert_eq!(highlight_note(&hl("words", "https://a.b/x#:~:text=words")), "words [↗](https://a.b/x#:~:text=words)");
    assert_eq!(highlight_note(&hl("words", "javascript:alert(1)")), "words", "only web links");
}

#[test]
fn a_new_article_gets_its_own_page() {
    let v = vault("new");
    let mut app = open(&v);
    let f = file_clip(&mut app, &weekly(vec![hl("Dough needs warmth.", "https://q.org/x#:~:text=Dough"), hl("Then they commit.\nFor good.", "")]), TODAY).unwrap();
    assert!(f.new_page && f.added == 2 && f.skipped == 0, "{f:?}");
    assert_eq!(f.page, "How Bread Rises");
    let text = get(&v, &f.rel);
    assert_eq!(
        text,
        "tags:: [[quick capture]]\nsource:: [How Bread Rises · Kitchen Weekly](https://www.kitchenweekly.org/how-bread-rises-20261020/)\n\n- [[October 29th, 2026]]\n\t- Dough needs warmth. [↗](https://q.org/x#:~:text=Dough)\n\t- Then they commit.\n\t  For good.\n"
    );
    // the journal day lists it under its linked references
    let refs = app.vault.linked_refs("October 29th, 2026");
    assert!(refs.iter().any(|g| g.page == "How Bread Rises"), "{refs:?}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn later_batches_join_the_day_or_start_a_new_one() {
    let v = vault("join");
    let mut app = open(&v);
    let f = file_clip(&mut app, &weekly(vec![hl("One.", "")]), TODAY).unwrap();
    // the same day, another address for the same article (tracking, no www): its day bullet
    let mut c = weekly(vec![hl("Two.", ""), hl("one.", "")]);
    c.url = "https://kitchenweekly.org/how-bread-rises-20261020?utm_source=rss".into();
    c.title = "A retitled headline".into();
    let g = file_clip(&mut app, &c, TODAY).unwrap();
    assert_eq!((g.rel.as_str(), g.added, g.skipped, g.new_page), (f.rel.as_str(), 1, 1, false), "found by its source::, the repeat left out");
    // another day: a new date bullet at the end
    file_clip(&mut app, &weekly(vec![hl("Three.", "")]), (2026, 11, 2)).unwrap();
    let text = get(&v, &f.rel);
    assert!(text.ends_with("- [[October 29th, 2026]]\n\t- One.\n\t- Two.\n- [[November 2nd, 2026]]\n\t- Three.\n"), "{text}");
    // sending it all again changes nothing
    let h = file_clip(&mut app, &weekly(vec![hl("Three.", ""), hl("Two.", "")]), (2026, 11, 2)).unwrap();
    assert_eq!((h.added, h.skipped), (0, 2));
    assert_eq!(get(&v, &f.rel), text);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn his_own_notes_on_the_page_stay_byte_for_byte() {
    let v = vault("keep");
    // a page he made by hand: CRLF, spaces for indents, a BOM, his own notes, no final line break
    let mine = "\u{feff}tags:: reading\r\n\r\n- my thoughts\r\n  - nested  thought   \r\n- [[October 29th, 2026]]\r\n  - earlier highlight\r\n- after";
    put(&v, "pages/How Bread Rises.md", mine);
    let mut app = open(&v);
    let f = file_clip(&mut app, &weekly(vec![hl("New one.", "")]), TODAY).unwrap();
    assert_eq!((f.rel.as_str(), f.new_page), ("pages/How Bread Rises.md", false), "the page named like the article (no other source::)");
    let text = get(&v, &f.rel);
    assert_eq!(text, "\u{feff}tags:: reading\r\n\r\n- my thoughts\r\n  - nested  thought   \r\n- [[October 29th, 2026]]\r\n  - earlier highlight\r\n  - New one.\r\n- after");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn another_article_with_the_same_title_gets_its_own_page() {
    let v = vault("other");
    put(&v, "pages/How Bread Rises.md", "source:: [How Bread Rises · Other](https://other.site/a)\n\n- old\n");
    let mut app = open(&v);
    let f = file_clip(&mut app, &weekly(vec![hl("Mine.", "")]), TODAY).unwrap();
    assert_eq!(f.page, "How Bread Rises (Kitchen Weekly)");
    assert!(f.new_page);
    assert_eq!(get(&v, "pages/How Bread Rises.md"), "source:: [How Bread Rises · Other](https://other.site/a)\n\n- old\n", "the other article's page untouched");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn nothing_to_add_or_not_a_web_page() {
    let v = vault("none");
    let mut app = open(&v);
    assert!(file_clip(&mut app, &weekly(vec![hl("  \n ", "")]), TODAY).is_err());
    let mut c = weekly(vec![hl("x", "")]);
    c.url = "file:///C:/secret.html".into();
    assert!(file_clip(&mut app, &c, TODAY).is_err());
    let _ = std::fs::remove_dir_all(&v);
}

// ---------------------------------------------------------------- the extension's messages

#[test]
fn messages_round_trip_and_get_answers() {
    use outline_core::clip::{answer, message_bytes, read_message, host_manifest, EXTENSION_ID};
    use serde_json::json;
    let v = vault("msg");
    open(&v); // sets the cache folder
    let msg = json!({"cmd": "clip", "url": "https://q.org/a", "title": "A thing - q.org", "highlights": [{"text": "Hi there.", "link": "https://q.org/a#:~:text=Hi"}]});
    let framed = message_bytes(&msg);
    assert_eq!(read_message(&mut framed.as_slice()), Some(msg.clone()));
    let mut too_big = (u32::MAX).to_ne_bytes().to_vec();
    too_big.extend(b"{}");
    assert_eq!(read_message(&mut too_big.as_slice()), None);
    let a = answer(&msg, Ok(v.clone()), TODAY, "10:00");
    assert_eq!(a["ok"], true, "{a}");
    assert_eq!(a["page"], "A thing");
    assert!(get(&v, a["rel"].as_str().unwrap()).contains("- Hi there. [↗](https://q.org/a#:~:text=Hi)"));
    // the usual quick capture, with a neat link to the passage
    let j = answer(&json!({"cmd": "journal", "text": "one line", "url": "https://q.org/a#:~:text=one", "title": "A thing", "site": "Q"}), Ok(v.clone()), TODAY, "10:01");
    assert_eq!(j["ok"], true, "{j}");
    // (Logseq's default place: the "quick capture" page)
    assert!(get(&v, "pages/quick capture.md").contains("one line from [A thing · Q](https://q.org/a#:~:text=one)"), "{}", get(&v, "pages/quick capture.md"));
    assert_eq!(answer(&json!({"cmd": "hello"}), Ok(v.clone()), TODAY, "")["ok"], true);
    let e = answer(&json!({"cmd": "hello"}), Err("Open thinky once first.".into()), TODAY, "");
    assert_eq!((e["ok"].clone(), e["error"].clone()), (json!(false), json!("Open thinky once first.")));
    assert!(host_manifest("C:\\x\\lean-outliner.exe").contains(&format!("chrome-extension://{EXTENSION_ID}/")));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn copied_words_keep_their_page() {
    use outline_core::capture::{html_source_url, text_fragment, with_source};
    let html = "Version:0.9\r\nStartHTML:000000105\r\nEndHTML:000000300\r\nSourceURL:https://www.kitchenweekly.org/how-bread-rises-20261029/\r\n<html><body>SourceURL:https://evil.example</body></html>";
    assert_eq!(html_source_url(html).as_deref(), Some("https://www.kitchenweekly.org/how-bread-rises-20261029/"));
    assert_eq!(html_source_url("Version:0.9\r\nSourceURL:about:blank\r\n<html>"), None);
    assert_eq!(html_source_url("Version:0.9\r\nStartHTML:1\r\n<html>"), None);
    // a short passage whole; a long one by its first and last four words; "-" written as %2D
    assert_eq!(text_fragment("https://x.org/a#top", "bread needs time"), "https://x.org/a#:~:text=bread%20needs%20time");
    assert_eq!(text_fragment("https://x.org/a", "one two three four five six seven eight nine"), "https://x.org/a#:~:text=one%20two%20three%20four,six%20seven%20eight%20nine");
    assert_eq!(text_fragment("https://x.org/a", "a well-known fact"), "https://x.org/a#:~:text=a%20well%2Dknown%20fact");
    let u = Some("https://www.kitchenweekly.org/how-bread-rises/");
    assert_eq!(with_source("Bread rises slowly.", u), "Bread rises slowly. [kitchenweekly.org](https://www.kitchenweekly.org/how-bread-rises/#:~:text=Bread%20rises%20slowly.)");
    assert_eq!(with_source("see https://www.kitchenweekly.org/how-bread-rises/", u), "see https://www.kitchenweekly.org/how-bread-rises/");
    assert_eq!(with_source("words", None), "words");
    assert_eq!(with_source("  ", u), "  ");
}

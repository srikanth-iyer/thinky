//! The "Add to journal" box's rules (core/src/capture_box.rs) and what it writes: notes to another
//! page or as a to-do (App::capture_to_page), the page list, and pictures or files in assets/.
use outline_core::app::{asset_file_name, asset_markdown, is_picture, save_asset_file, save_asset_file_at, write_atomic_checked, App, Expect};
use outline_core::capture::{self, append_note, append_note_with, capture_to_usual};
use outline_core::capture_box::*;
use serde_json::json;
use std::path::PathBuf;

fn tmp(tag: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("outline_box_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    base
}

fn vault(tag: &str, config: &str) -> PathBuf {
    let v = tmp(tag);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    std::fs::write(v.join("logseq/config.edn"), config).unwrap();
    v
}

const NOW: &str = r#"{:preferred-workflow :now
 :journal/page-title-format "MMMM do, yyyy"
 :quick-capture-templates {:text "**{time}** {text}"}
 :quick-capture-options {:insert-today? true}}"#;
const TODO: &str = r#"{:preferred-workflow :todo
 :quick-capture-templates {:text "[[quick capture]] **{time}**: {text} from {url}"}
 :quick-capture-options {:insert-today? true}}"#;

#[test]
fn the_looks_colours_are_kept_for_the_box() {
    let dir = tmp("look");
    assert_eq!(load_colors(Some(&dir)), BoxColors::default(), "no file yet: Calm");
    assert!(!load_colors(None).dark());
    let night = json!({"surface": "#2a2f38", "surface-2": "#242830", "ink": "#E6E9EE", "ink-soft": "#b9bfc9", "ink-faint": "#8e95a0",
        "accent": "#86c4b3", "accent-ink": "#12141a", "line": "#454c58", "line-soft": "#3a404b", "danger": "#eba394"});
    assert_eq!(save_look(Some(&dir), "night", &night), Ok(true));
    let c = load_colors(Some(&dir));
    assert_eq!((c.surface, c.ink, c.accent, c.danger), (0x2A2F38, 0xE6E9EE, 0x86C4B3, 0xEBA394));
    assert!(c.dark());
    let text = std::fs::read_to_string(dir.join(LOOK_FILE)).unwrap();
    assert!(text.contains("look=night\nsurface=#2A2F38\nsurface-2=#242830\n"), "{text}");
    // the same colours again (every start of the app): the file isn't written again
    let before = std::fs::metadata(dir.join(LOOK_FILE)).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    assert_eq!(save_look(Some(&dir), "night", &night), Ok(true));
    assert_eq!(std::fs::metadata(dir.join(LOOK_FILE)).unwrap().modified().unwrap(), before);
    // a colour that isn't one is refused; no cache folder (the dev server): nothing to do
    assert!(save_look(Some(&dir), "x", &json!({"surface": "red"})).is_err());
    assert_eq!(save_look(None, "night", &night), Ok(false));
    // an unreadable or partial file keeps Calm's colours for what's missing
    let p = BoxColors::parse("ink=#123456\naccent=nonsense\nsurface = #abc\n# a note\njunk");
    assert_eq!((p.ink, p.accent, p.surface, p.line), (0x123456, BoxColors::default().accent, 0xAABBCC, BoxColors::default().line));
    assert_eq!(BoxColors::parse(&c.to_text("night")), c);
    assert_eq!(parse_hex("#0B7B66"), Some(0x0B7B66));
    assert_eq!(parse_hex("0B7B66"), None);
    assert_eq!(parse_hex("#0B7B6"), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn what_the_box_starts_with() {
    let never = || -> String { panic!("the clipboard isn't read when a link gives the words") };
    assert_eq!(prefill(Some(("From a web page", "https://example.com")), never), ("From a web page https://example.com".to_string(), false));
    assert_eq!(prefill(Some(("  ", "https://example.com")), never), ("https://example.com".to_string(), false));
    assert_eq!(prefill(Some(("two\r\nlines", "")), never), ("two\nlines".to_string(), false));
    assert_eq!(prefill(None, || "copied\r\nearlier".into()), ("copied\nearlier".to_string(), true));
    assert_eq!(prefill(None, || " \r\n ".into()), (String::new(), true));
    assert_eq!(to_crlf("a\nb\r\nc\rd"), "a\r\nb\r\nc\r\nd");
    assert_eq!(from_crlf("a\r\nb\rc"), "a\nb\nc");
}

#[test]
fn ctrl_backspace_and_ctrl_delete_take_whole_words() {
    let w = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
    let t = w("buy oat milk, now");
    assert_eq!(word_before(&t, 12), 8, "the word before the comma");
    assert_eq!(word_before(&t, 13), 12, "punctuation goes on its own");
    assert_eq!(word_before(&t, 14), 12, "a space and the comma before it");
    assert_eq!(word_before(&t, 4), 0);
    assert_eq!(word_before(&t, 0), 0);
    assert_eq!(word_after(&t, 0), 4, "the word and its space");
    assert_eq!(word_after(&t, 8), 12);
    assert_eq!(word_after(&t, 17), 17);
    // emoji and accents count by UTF-16 units, as the Windows text box does
    let e = w("café 🙂 ok");
    assert_eq!(word_before(&e, e.len()), 8);
    assert_eq!(word_before(&e, 7), 5, "the emoji (two units) goes whole");
    assert_eq!(word_after(&e, 0), 5);
    // a line break isn't swallowed with the spaces after a word
    let l = w("one  \ntwo");
    assert_eq!(word_after(&l, 0), 5);
}

#[test]
fn enter_adds_once_and_never_right_as_it_appears() {
    let mut r = Rules::new("", false);
    assert_eq!(r.enter(10, "early"), Enter::Ignore, "not ready yet");
    r.ready(1000);
    assert_eq!(r.enter(1200, "an Enter meant for another window"), Enter::Ignore);
    assert_eq!(r.enter(1499, "still too soon"), Enter::Ignore);
    assert_eq!(r.enter(1500, "   "), Enter::Close, "nothing typed: Enter closes");
    assert_eq!(r.enter(1600, "  a note \n"), Enter::Add("a note".into()));
    assert!(r.busy() && !r.may_close(), "Esc and × wait while it's being added");
    assert_eq!(r.enter(1700, "a note"), Enter::Ignore, "a second Enter while adding does nothing");
    r.failed();
    assert!(!r.busy() && r.may_close(), "after a failure the text can be changed and the box closed");
    assert_eq!(r.enter(1800, "a note"), Enter::Add("a note".into()), "Enter tries again");
    r.added();
    assert!(r.is_added() && r.busy() && !r.may_close(), "added: it closes by itself");
}

#[test]
fn clicking_elsewhere_closes_only_a_box_with_nothing_new() {
    // typed into an empty box
    let mut r = Rules::new("", false);
    assert!(!r.close_on_blur(""), "not before it's ready");
    r.ready(0);
    assert!(!r.close_on_blur(""), "not before it had the keyboard");
    r.focused();
    assert!(r.close_on_blur("  \n"), "empty: it goes");
    assert!(!r.close_on_blur("half a thought"), "typing stays");
    // the clipboard's text, untouched
    let mut c = Rules::new("copied earlier", true);
    c.ready(0);
    c.focused();
    assert!(c.close_on_blur("copied earlier"), "untouched: it goes (it's still on the clipboard)");
    assert!(!c.close_on_blur("copied earlier and my thoughts"));
    // words from a web page always stay
    let mut l = Rules::new("From a web page", false);
    l.ready(0);
    l.focused();
    assert!(!l.close_on_blur("From a web page"));
    // never while a note is being added
    assert!(matches!(c.enter(600, "copied earlier"), Enter::Add(_)));
    assert!(!c.close_on_blur("copied earlier"));
}

#[test]
fn a_second_press_brings_its_words_to_the_open_box() {
    // the clipboard's untouched text, or nothing: the words take its place, all selected
    let mut c = Rules::new("copied earlier", true);
    c.ready(0);
    c.focused();
    assert_eq!(c.more_words("copied earlier", "From a page\r\nhttps://example.com"), Some(("From a page\nhttps://example.com".into(), true)));
    assert!(!c.close_on_blur("From a page\nhttps://example.com"), "words from a web page stay when clicking elsewhere");
    let mut e = Rules::new("", false);
    assert_eq!(e.more_words("  ", "new words"), Some(("new words".into(), true)));
    // something typed stays: the words go on a line of their own at the end
    let mut t = Rules::new("", false);
    assert_eq!(t.more_words("my thought \n", "From a page"), Some(("my thought\nFrom a page".into(), false)));
    // no words (the shortcut pressed again): nothing changes; nor while a note is being added
    assert_eq!(t.more_words("my thought", "  "), None);
    t.ready(0);
    assert!(matches!(t.enter(600, "my thought"), Enter::Add(_)));
    assert_eq!(t.more_words("my thought", "late words"), None);
}

#[test]
fn links_to_saved_files_are_swapped_in_one_go() {
    let pairs = vec![("../assets/a_1.png".to_string(), "../assets/a_2.png".to_string()), ("../assets/a_2.png".to_string(), "../assets/a_3.png".to_string())];
    // a planned name taken meanwhile: each link gets its own file, never the other's
    assert_eq!(swap_all("![a](../assets/a_1.png) ![b](../assets/a_2.png)", &pairs), "![a](../assets/a_2.png) ![b](../assets/a_3.png)");
    assert_eq!(swap_all("ünï ![😀](../assets/a_1.png)!", &pairs), "ünï ![😀](../assets/a_2.png)!");
    assert_eq!(swap_all("nothing to swap", &pairs), "nothing to swap");
    assert_eq!(swap_all("x ../assets/a_1.png", &[("../assets/a_1.png".into(), "../assets/a_1.png".into())]), "x ../assets/a_1.png");
}

#[test]
fn the_box_is_sized_like_the_web_box() {
    let m = Metrics { scale: 1.0, line_h: 27, lines: 1, pill_w: 0, rows: 0, list_line_h: 19, foot_h: 17, tool_w: [0; 3] };
    let l = layout(&m);
    assert_eq!((l.w, l.h), (640, 98), "one line: 640 × 98");
    assert_eq!(l.tile, Rect::new(16, 15, 48, 47));
    assert_eq!((l.note.l, l.note.r), (61, 622), "the text starts 13 px after the + button");
    assert!(l.note.t > l.tile.t && l.note.b < l.tile.b, "the first line sits level with the + button");
    assert_eq!((l.foot.t, l.foot.b), (59, 98));
    assert_eq!(l.close, Rect::new(606, 66, 632, 92), "the × button at the right of the bottom strip");
    assert!(l.search.is_empty() && l.pill.is_empty());
    // it grows with the text, up to six lines, then the text scrolls
    let three = layout(&Metrics { lines: 3, ..m });
    assert_eq!(three.h, 18 + 3 * 27 + 12 + 39, "three lines of 27 px under the top padding");
    assert_eq!(layout(&Metrics { lines: 40, ..m }).h, layout(&Metrics { lines: MAX_LINES, ..m }).h);
    // a to-do mark moves the text over
    let todo = layout(&Metrics { pill_w: 50, ..m });
    assert_eq!((todo.pill.l, todo.pill.w(), todo.note.l), (61, 50, 119));
    assert!(todo.pill.t >= todo.tile.t && todo.pill.b <= todo.tile.b);
    // the page list opens between the text and the bottom strip
    let list = layout(&Metrics { rows: 7, ..m });
    assert!(list.search.t >= l.foot.t && list.rows.t > list.search.b && list.foot.t > list.rows.b);
    assert_eq!(list.rows.h(), 7 * list.row_h);
    assert!(list.search_text.t > list.search.t && list.search_text.b < list.search.b);
    // an error over two lines makes the bottom strip taller, the × stays in its middle
    let err = layout(&Metrics { foot_h: 40, ..m });
    assert_eq!(err.h - l.h, 40 - 26);
    assert_eq!(err.close.t - err.foot.t - 1 - 6, (40 - 26) / 2);
    // scaled screens: everything grows with the scale
    let big = layout(&Metrics { scale: 1.5, line_h: 40, foot_h: 25, list_line_h: 28, ..m });
    assert_eq!(big.w, 960);
    assert_eq!(big.tile.w(), 48);
    assert!((big.h as f32 - 98.0 * 1.5).abs() <= 3.0, "{}", big.h);
}

#[test]
fn the_page_list_puts_the_best_match_first() {
    let pages: Vec<(String, u64)> = [
        ("Project ideas", 50),
        ("Old projects", 10),
        ("projector manual", 20),
        ("Reading list", 90),
        ("Ideas/Projects", 30),
        ("Project", 5),
        ("Café notes", 70),
    ]
    .iter()
    .map(|(n, t)| (n.to_string(), *t))
    .collect();
    let names = |q: &str, n: usize| rank_pages(&pages, q, n).into_iter().map(|i| pages[i].0.as_str()).collect::<Vec<_>>();
    assert_eq!(names("", 3), ["Reading list", "Café notes", "Project ideas"], "nothing typed: the pages changed last");
    assert_eq!(names("project", 10), ["Project", "Project ideas", "projector manual", "Old projects", "Ideas/Projects"]);
    assert_eq!(names("PROJ IDE", 10), ["Project ideas", "Ideas/Projects"], "every word, any case");
    assert_eq!(names("café", 10), ["Café notes"]);
    // as the Ctrl+K search finds pages: accents, word order, a typo
    assert_eq!(names("cafe", 10), ["Café notes"], "without the accent");
    assert_eq!(names("list reading", 10), ["Reading list"], "words in any order");
    assert_eq!(names("readng", 10), ["Reading list"], "a letter off");
    assert_eq!(names("zzz", 10), Vec::<&str>::new());
    assert_eq!(names("o", 2).len(), 2, "no more than asked");
}

#[test]
fn smooth_shapes_paint_inside_and_blend_at_the_edge() {
    let mut px = vec![0xFFFFFFu32; 20 * 20];
    let mut c = Canvas { px: &mut px, w: 20, h: 20 };
    c.round_rect(2.0, 2.0, 18.0, 18.0, 5.0, 0x000000);
    assert_eq!(px[10 * 20 + 10], 0x000000, "the middle is filled");
    assert_eq!(px[0], 0xFFFFFF, "outside stays");
    assert_eq!(px[2 * 20 + 2], 0xFFFFFF, "a rounded corner leaves the very corner");
    let edge = px[10 * 20 + 2];
    assert_eq!(edge, 0x000000, "a straight edge on a pixel edge is sharp");
    let mut px = vec![0xFFFFFFu32; 20 * 20];
    let mut c = Canvas { px: &mut px, w: 20, h: 20 };
    c.line(4.0, 10.0, 16.0, 10.0, 2.0, 0x000000);
    assert_eq!(px[9 * 20 + 10], 0x000000);
    assert_eq!(px[5 * 20 + 10], 0xFFFFFF);
    let mut c = Canvas { px: &mut px, w: 20, h: 20 };
    c.line(3.0, 3.0, 17.0, 17.0, 1.3, 0x000000);
    let soft = px[3 * 20 + 4];
    assert!(soft != 0x000000 && soft != 0xFFFFFF, "a slanted line has soft edges: {soft:06X}");
    let mut c = Canvas { px: &mut px, w: 20, h: 20 };
    c.fill(Rect::new(-5, -5, 3, 3), 0x123456);
    assert_eq!(px[0], 0x123456);
    assert_eq!(mix(0x000000, 0xFFFFFF, 0.5), 0x808080);
    assert_eq!(colorref(0x112233), 0x332211);
}

#[test]
fn png_pictures_are_measured_through_their_end() {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    for (kind, data) in [(&b"IHDR"[..], &[0u8; 13][..]), (b"IDAT", b"xyz"), (b"IEND", b"")] {
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(kind);
        png.extend_from_slice(data);
        png.extend_from_slice(&[0, 0, 0, 0]);
    }
    let n = png.len();
    png.extend_from_slice(&[0; 100]); // room to spare after it
    assert_eq!(png_len(&png), Some(n));
    assert_eq!(png_len(&png[..n - 1]), None, "cut short");
    assert_eq!(png_len(b"GIF89a"), None);
}

/// Where the app itself puts a note for `name` (what the box must match).
fn app_file(v: &std::path::Path, name: &str) -> Option<String> {
    App::open_read_only(v).unwrap().vault.page_info(name).path
}

#[test]
fn notes_go_to_another_page_as_written_by_logseq() {
    let v = vault("page", TODO);
    std::fs::write(v.join("pages/Project ideas.md"), "\u{feff}- first idea\r\n- second\r\n").unwrap();
    let mut app = App::open_read_only(&v).unwrap();
    // an existing page, whatever the case it's typed in: added at its end, keeping its BOM and CRLF
    let rel = app.capture_to_page("project IDEAS", "a third", "", false, (2026, 10, 26), "09:15").unwrap();
    assert_eq!(rel, "pages/Project ideas.md");
    assert_eq!(std::fs::read_to_string(v.join(&rel)).unwrap(), "\u{feff}- first idea\r\n- second\r\n- [[quick capture]] **09:15**: a third\r\n");
    // a to-do: the workflow's marker at the very start of the note
    app.capture_to_page("Project ideas", "call Ana", "https://x.org", true, (2026, 10, 26), "09:16").unwrap();
    assert!(std::fs::read_to_string(v.join(&rel)).unwrap().ends_with("- TODO [[quick capture]] **09:16**: call Ana from [x.org](https://x.org)\r\n"));
    // a page that doesn't exist yet gets a Logseq-style file; a name a file can't hold gets title::
    assert_eq!(app.capture_to_page("Books/2026", "Dune", "", false, (2026, 10, 26), "10:00").unwrap(), "pages/Books___2026.md");
    assert_eq!(std::fs::read_to_string(v.join("pages/Books___2026.md")).unwrap(), "- [[quick capture]] **10:00**: Dune\n");
    assert_eq!(app.capture_to_page("Why?", "because", "", false, (2026, 10, 26), "10:01").unwrap(), "pages/Why%3F.md");
    assert_eq!(app.capture_to_page("Trailing.", "dot", "", false, (2026, 10, 26), "10:02").unwrap(), "pages/Trailing.___.md");
    assert_eq!(std::fs::read_to_string(v.join("pages/Trailing.___.md")).unwrap(), "title:: Trailing.\n- [[quick capture]] **10:02**: dot\n");
    // reserved Windows names, in any case, as Logseq names them
    assert_eq!(app.capture_to_page("con", "c", "", false, (2026, 10, 26), "10:03").unwrap(), "pages/con___.md");
    assert_eq!(std::fs::read_to_string(v.join("pages/con___.md")).unwrap(), "title:: con\n- [[quick capture]] **10:03**: c\n");
    // a journal title means that day's journal
    let t = app.page_target("Oct 20th, 2026").unwrap();
    assert!(t.journal && t.rel == "journals/2026_10_20.md", "{t:?}");
    assert_eq!(app.capture_to_page("Oct 20th, 2026", "back then", "", false, (2026, 10, 26), "11:00").unwrap(), "journals/2026_10_20.md");
    // names that can't be a page say why
    for bad in ["/", "  ", "[[x]]", "two\nlines"] {
        assert!(app.page_target(bad).is_err(), "{bad:?}");
        assert!(app.capture_to_page(bad, "x", "", false, (2026, 10, 26), "11:01").is_err(), "{bad:?}");
    }
    assert!(app.page_target("/").unwrap_err().contains("can't be the name of a page"));
    assert!(!v.join("pages/.md").exists());
    // the usual place (no index): today's journal, as before, now also as a to-do
    assert_eq!(capture_to_usual(&v, "today", "", true, (2026, 10, 26), "11:02").unwrap(), "journals/2026_10_26.md");
    assert_eq!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap(), "- TODO [[quick capture]] **11:02**: today\n");
    // a page file that can't be read right now is never written over
    std::fs::create_dir_all(v.join("pages/Locked.md")).unwrap();
    let mut app = App::open_read_only(&v).unwrap();
    let err = app.capture_to_page("Locked", "x", "", false, (2026, 10, 26), "12:00").unwrap_err();
    assert!(err.contains("Couldn't read"), "{err}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn pages_named_by_title_are_found_as_the_app_finds_them() {
    // the reviewer's cases: names that come from title:: (older namespace files, names a file
    // can't hold) and a name two files claim
    let v = vault("titles", TODO);
    std::fs::write(v.join("pages/bar.md"), "title:: Foo\n- years of notes\n").unwrap();
    std::fs::write(v.join("pages/proj.ideas.md"), "title:: proj/ideas\n- legacy namespace page\n").unwrap();
    std::fs::write(v.join("pages/A.md"), "title:: Twin\n- the real page\n").unwrap();
    std::fs::write(v.join("pages/Twin.md"), "- an old stray copy\n").unwrap();
    let mut app = App::open_read_only(&v).unwrap();
    let names: Vec<String> = app.page_list().into_iter().map(|(n, _)| n).collect();
    assert!(names.contains(&"Foo".to_string()) && !names.contains(&"bar".to_string()), "{names:?}");
    assert!(names.contains(&"proj/ideas".to_string()) && !names.contains(&"proj.ideas".to_string()), "{names:?}");
    for (name, want) in [("Foo", "pages/bar.md"), ("proj/ideas", "pages/proj.ideas.md")] {
        let t = app.page_target(name).unwrap();
        assert!(t.exists && t.rel == want, "{name}: {t:?}");
        assert_eq!(app.capture_to_page(name, "from the box", "", false, (2026, 10, 26), "09:00").unwrap(), want);
        assert!(std::fs::read_to_string(v.join(want)).unwrap().ends_with("- [[quick capture]] **09:00**: from the box\n"));
    }
    // a name two files claim goes to the file the app shows for it
    let shown = app_file(&v, "Twin").unwrap();
    assert_eq!(app.capture_to_page("Twin", "twin note", "", false, (2026, 10, 26), "09:01").unwrap(), shown);
    // no new files were made for any of them
    let mut files: Vec<String> = std::fs::read_dir(v.join("pages")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    files.sort();
    assert_eq!(files, ["A.md", "Twin.md", "bar.md", "proj.ideas.md"]);
    // a page made in the app after the box opened is found too (changes are taken in first)
    std::fs::write(v.join("pages/Later.md"), "title:: Made later\n- x\n").unwrap();
    assert_eq!(app.capture_to_page("Made later", "y", "", false, (2026, 10, 26), "09:02").unwrap(), "pages/Later.md");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn opening_to_read_never_writes_the_index_cache() {
    let cache = tmp("cache-ro");
    outline_core::app::set_cache_dir(cache.clone());
    let v = vault("cache-ro-vault", TODO);
    std::fs::write(v.join("pages/A.md"), "- a\n").unwrap();
    let count = || std::fs::read_dir(&cache).map(|r| r.count()).unwrap_or(0);
    let before = count();
    let mut app = App::open_read_only(&v).unwrap();
    for i in 0..25 {
        std::fs::write(v.join(format!("pages/N{i}.md")), "- n\n").unwrap();
    }
    app.rescan(); // 25 outside changes: the app would write its cache now; read-only never does
    app.capture_to_page("A", "x", "", false, (2026, 10, 26), "09:00").unwrap();
    assert_eq!(count(), before, "no cache file written");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn to_dos_follow_the_workflow() {
    let v = vault("now", NOW);
    capture_to_usual(&v, "water the plants", "", true, (2026, 10, 26), "08:00").unwrap();
    assert_eq!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap(), "- LATER **08:00** water the plants\n");
    capture_to_usual(&v, "multi\nline", "", true, (2026, 10, 26), "08:01").unwrap();
    assert!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap().ends_with("- LATER **08:01** multi\n  line\n"));
    // a note that already starts with a marker isn't marked twice (a "{text}" template)
    std::fs::write(v.join("logseq/config.edn"), "{:quick-capture-templates {:text \"{text}\"} :quick-capture-options {:insert-today? true}}").unwrap();
    capture_to_usual(&v, "DOING write the report", "", true, (2026, 10, 26), "11:02").unwrap();
    assert!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap().ends_with("- DOING write the report\n"));
    assert_eq!(capture::as_todo("TODO x", "LATER"), "TODO x");
    assert_eq!(capture::as_todo("TODOx", "LATER"), "LATER TODOx");
    std::fs::write(v.join("logseq/config.edn"), NOW).unwrap();
    let cfg = capture::read_config(&v).unwrap();
    assert_eq!(cfg.todo_marker(), "LATER");
    let bare = outline_core::Config { capture_text: "{text}".into(), ..outline_core::Config::default() };
    assert_eq!(capture::note_line(&bare, "  ", "", true, (2026, 10, 26), "08:00").unwrap_err(), "Nothing to add.");
    assert_eq!(capture::default_place(&cfg, (2026, 10, 26)), (true, "October 26th, 2026".to_string()));
    assert_eq!(capture::place_label(true, "October 26th, 2026"), "today’s journal (October 26th, 2026)");
    assert_eq!(capture::place_label(false, "Inbox"), "Inbox");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn the_page_list_is_the_apps() {
    let v = vault("names", TODO);
    for f in ["Project ideas.md", "Books___2026.md", "Why%3F.md", "project IDEAS.md", ".hidden.md", "notes.txt"] {
        std::fs::write(v.join("pages").join(f), "- x\n").unwrap();
    }
    std::fs::create_dir_all(v.join("pages/sub")).unwrap();
    std::fs::write(v.join("pages/sub/Nested.md"), "- x [[Linked only]]\n").unwrap();
    // hidden sub-folders are skipped, as in the app
    std::fs::create_dir_all(v.join("pages/.trash")).unwrap();
    std::fs::write(v.join("pages/.trash/Old.md"), "- x\n").unwrap();
    std::fs::write(v.join("journals/2026_10_26.md"), "- a day\n").unwrap();
    let app = App::open_read_only(&v).unwrap();
    let names: Vec<String> = app.page_list().into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, ["Books/2026", "Linked only", "Nested", "Project ideas", "Why?"], "one per name, no hidden files or folders, no journal days");
    let times: Vec<u64> = app.page_list().into_iter().map(|(_, t)| t).collect();
    assert!(times[1] == 0 && times[0] > 0, "a page with only links has no file time: {times:?}");
    assert_eq!(outline_core::page_name_from_stem("a___b%3Fc"), "a/b?c");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_save_made_meanwhile_is_kept() {
    let v = vault("race", TODO);
    let p = v.join("pages/Busy.md");
    std::fs::write(&p, "- mine\n").unwrap();
    // another program saves the page while the note is being added: the note goes on top of
    // their version, nothing of theirs is lost
    append_note_with(&p, "pages/Busy.md", "", "- new note".trim_start_matches("- "), &mut |attempt| {
        if attempt == 0 {
            std::fs::write(&p, "- mine\n- theirs, saved meanwhile\n").unwrap();
        }
    })
    .unwrap();
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "- mine\n- theirs, saved meanwhile\n- new note\n");
    // it keeps changing: after 3 tries it says so and writes nothing
    let mut n = 0;
    let err = append_note_with(&p, "pages/Busy.md", "", "never", &mut |_| {
        n += 1;
        std::fs::write(&p, format!("- version {n}\n")).unwrap();
    })
    .unwrap_err();
    assert!(err.contains("kept changing"), "{err}");
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "- version 3\n");
    // a page made meanwhile isn't written over either
    let fresh = v.join("pages/Fresh.md");
    append_note_with(&fresh, "pages/Fresh.md", "", "note", &mut |attempt| {
        if attempt == 0 {
            std::fs::write(&fresh, "- made elsewhere\n").unwrap();
        }
    })
    .unwrap();
    assert_eq!(std::fs::read_to_string(&fresh).unwrap(), "- made elsewhere\n- note\n");
    // the checked write: only over what's expected; no temp files left behind
    assert!(!write_atomic_checked(&p, "x", Expect::Bytes(b"something else")).unwrap());
    assert!(!write_atomic_checked(&p, "x", Expect::Missing).unwrap());
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "- version 3\n");
    assert!(write_atomic_checked(&p, "- y\n", Expect::Bytes(b"- version 3\n")).unwrap());
    // two writers at once, each with its own temp file: both finish, the page holds one whole text
    let handles: Vec<_> = (0..4)
        .map(|w| {
            let p = p.clone();
            std::thread::spawn(move || {
                for i in 0..30 {
                    outline_core::app::write_atomic(&p, &format!("- writer {w} round {i}\n")).unwrap();
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert!(std::fs::read_to_string(&p).unwrap().starts_with("- writer "));
    let leftovers: Vec<String> = std::fs::read_dir(v.join("pages")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".tmp")).collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    let _ = append_note; // (the plain form is append_note_with without the hook)
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_missing_final_line_break_stays_missing() {
    use outline_core::append_bullet;
    assert_eq!(append_bullet("", "hi"), "- hi\n", "a new file gets one");
    assert_eq!(append_bullet("- a\n- b", "c"), "- a\n- b\n- c");
    assert_eq!(append_bullet("- a\r\n- b", "c\nd"), "- a\r\n- b\r\n- c\r\n  d");
    assert_eq!(append_bullet("\u{feff}- a\n", "c"), "\u{feff}- a\n- c\n");
    assert_eq!(append_bullet("-", "hi"), "- hi", "a fresh Logseq journal's lone dash is replaced");
    assert_eq!(append_bullet("title:: x\n", "c"), "title:: x\n- c\n");
    assert_eq!(append_bullet("- a\n\t- child\n\n\n", "c"), "- a\n\t- child\n- c\n");
    // through the capture, too
    let v = vault("shape", TODO);
    std::fs::write(v.join("journals/2026_10_26.md"), "- a\n- b").unwrap();
    capture_to_usual(&v, "c", "", false, (2026, 10, 26), "09:00").unwrap();
    assert_eq!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap(), "- a\n- b\n- [[quick capture]] **09:00**: c");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn pictures_and_files_are_copied_into_assets_never_over_another() {
    let v = tmp("assets");
    let a = save_asset_file(&v, "C:\\Users\\me\\Screenshot 2026-10-26.png", b"one").unwrap();
    assert!(a.starts_with("../assets/Screenshot_2026-10-26_") && a.ends_with(".png"), "{a}");
    // the same name in the same millisecond: the next free one, the first file untouched
    let names: Vec<String> = (0..5).map(|_| save_asset_file(&v, "same.pdf", b"two").unwrap()).collect();
    let set: std::collections::HashSet<_> = names.iter().collect();
    assert_eq!(set.len(), 5, "{names:?}");
    assert_eq!(std::fs::read(v.join(a.trim_start_matches("../"))).unwrap(), b"one");
    // a name worked out earlier (the capture box names a file when it's added to the note) is used
    // when it's free, else the next one
    assert_eq!(save_asset_file_at(&v, "plan.png", b"p", 1000).unwrap(), "../assets/plan_1000.png");
    assert_eq!(save_asset_file_at(&v, "plan.png", b"q", 1000).unwrap(), "../assets/plan_1001.png");
    assert_eq!(std::fs::read(v.join("assets/plan_1000.png")).unwrap(), b"p");
    assert!(save_asset_file(&v, "empty.txt", b"").is_err());
    assert!(save_asset_file(&v, "huge.bin", &vec![0u8; 25_000_001]).unwrap_err().contains("25 MB"));
    assert_eq!(std::fs::read_dir(v.join("assets")).unwrap().count(), 8, "nothing else written");
    // a file keeps its own extension, or none; a very long "extension" is part of the name
    for (name, want) in [
        ("README", "README_7"),
        ("Makefile", "Makefile_7"),
        ("photo.JPG", "photo_7.jpg"),
        (".bashrc", "bashrc_7"),
        ("a.b.c.tar.gz", "a_b_c_tar_7.gz"),
        ("😀.png", "image_7.png"),
        ("x.verylongextension", "x_verylongextension_7"),
        ("no extension", "no_extension_7"),
    ] {
        assert_eq!(asset_file_name(name, 7), want, "{name}");
    }
    // pictures show in the note, other files are links
    assert_eq!(asset_markdown("Screenshot 2026.PNG", "../assets/x.png"), "![Screenshot 2026](../assets/x.png)");
    assert_eq!(asset_markdown("C:\\docs\\Quarterly report.pdf", "../assets/q.pdf"), "[Quarterly report.pdf](../assets/q.pdf)");
    assert_eq!(asset_markdown("odd [name].txt", "../assets/o.txt"), "[odd name.txt](../assets/o.txt)");
    assert!(is_picture("a.JPeG") && is_picture("x.svg") && !is_picture("a.pdf") && !is_picture("png"));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_second_press_starts_the_enter_guard_again() {
    let mut r = Rules::new("", false);
    assert!(r.too_soon(0), "not ready yet");
    r.ready(1000);
    assert!(r.too_soon(1499) && !r.too_soon(1500));
    // open a while, then brought forward by a second press: an Enter right after is ignored
    r.ready(60_000);
    assert_eq!(r.enter(60_100, "my note and the link's words"), Enter::Ignore, "an Enter meant for the browser's prompt");
    assert_eq!(r.enter(60_500, "my note and the link's words"), Enter::Add("my note and the link's words".into()));
}

#[test]
fn words_from_a_second_press_are_dropped_once_it_stopped_waiting() {
    let b = pack_words(5_000, "From a page ✓");
    assert_eq!(unpack_words(&b, 5_000), Some("From a page ✓".into()));
    assert_eq!(unpack_words(&b, 6_600), Some("From a page ✓".into()), "in time");
    assert_eq!(unpack_words(&b, 5_000 + HANDOVER_MS as u64), None, "the sender already opened its own box");
    assert_eq!(unpack_words(&pack_words(5_000, ""), 5_001), Some(String::new()), "the shortcut alone: no words");
    assert_eq!(unpack_words(&b[..7], 5_000), None, "damaged");
    assert_eq!(unpack_words(&b[..b.len() - 1], 5_000), None, "damaged");
}

#[test]
fn a_new_page_never_goes_into_another_pages_file() {
    // the reviewer's case: pages/bar.md holds the page "Foo" (its title::); "bar" is a new page
    let v = vault("newpage", TODO);
    std::fs::write(v.join("pages/bar.md"), "title:: Foo\n- years of notes\n").unwrap();
    std::fs::write(v.join("pages/BAZ.md"), "title:: Other\n- more notes\n").unwrap();
    let mut app = App::open_read_only(&v).unwrap();
    let t = app.page_target("bar").unwrap();
    assert!(!t.exists && t.rel == "pages/bar (2).md" && t.title.as_deref() == Some("bar"), "{t:?}");
    assert_eq!(app.capture_to_page("bar", "meant for bar", "", false, (2026, 10, 26), "09:01").unwrap(), "pages/bar (2).md");
    assert_eq!(std::fs::read_to_string(v.join("pages/bar.md")).unwrap(), "title:: Foo\n- years of notes\n", "Foo's file untouched");
    assert_eq!(std::fs::read_to_string(v.join("pages/bar (2).md")).unwrap(), "title:: bar\n- [[quick capture]] **09:01**: meant for bar\n");
    // and the next note for "bar" goes to that page (found again by its title::)
    assert_eq!(app.capture_to_page("bar", "again", "", false, (2026, 10, 26), "09:02").unwrap(), "pages/bar (2).md");
    // file names that differ only in capitals are the same file on Windows and Android
    assert_eq!(app.page_target("baz").unwrap().rel, "pages/baz (2).md");
    // a file that turns up where a new page would go, after the folder was read: never written into
    let mut app = App::open_read_only(&v).unwrap();
    std::fs::write(v.join("pages/Late.md"), "title:: Someone else\n- theirs\n").unwrap();
    assert_eq!(app.capture_to_page("Late", "mine", "", false, (2026, 10, 26), "09:03").unwrap(), "pages/Late (2).md");
    assert_eq!(std::fs::read_to_string(v.join("pages/Late.md")).unwrap(), "title:: Someone else\n- theirs\n");
    // a journal day still goes to that day's file, even when it appeared meanwhile
    std::fs::write(v.join("journals/2026_10_20.md"), "- made meanwhile\n").unwrap();
    assert_eq!(app.capture_to_page("Oct 20th, 2026", "that day", "", false, (2026, 10, 26), "09:04").unwrap(), "journals/2026_10_20.md");
    assert_eq!(std::fs::read_to_string(v.join("journals/2026_10_20.md")).unwrap(), "- made meanwhile\n- [[quick capture]] **09:04**: that day\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn an_unreadable_config_is_never_guessed() {
    // config.edn there but unreadable (here a folder; on Google Drive: not fetched right now)
    let v = vault("cfg", NOW);
    std::fs::remove_file(v.join("logseq/config.edn")).unwrap();
    std::fs::create_dir_all(v.join("logseq/config.edn")).unwrap();
    let err = App::open_read_only(&v).err().expect("refused");
    assert!(err.contains("config.edn"), "{err}");
    assert!(capture_to_usual(&v, "x", "", false, (2026, 10, 26), "09:00").is_err());
    // nor does the app itself open with guessed settings (core/tests/elsewhere.rs)
    assert!(App::open(&v).is_err());
    assert!(!v.join("pages/October 20th, 2026.md").exists() && std::fs::read_dir(v.join("journals")).unwrap().count() == 0);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn renaming_to_a_name_a_file_cant_hold_keeps_the_name() {
    let v = vault("rename", TODO);
    let files = [
        ("Thing.md", "- a thing\n", "aux", "pages/aux___.md", "title:: aux\n- a thing\n"),
        ("Crlf.md", "\u{feff}- one\r\n- two", "Nul", "pages/Nul___.md", "\u{feff}title:: Nul\r\n- one\r\n- two"),
        ("Yaml.md", "---\ntags: x\n---\n- body\n", "com1", "pages/com1___.md", "---\ntags: x\n---\ntitle:: com1\n- body\n"),
        ("Props.md", "tags:: y\n\n- body\n", "Trailing.", "pages/Trailing.___.md", "title:: Trailing.\ntags:: y\n\n- body\n"),
        ("First block.md", "- tags:: z\n- body\n", "lpt1", "pages/lpt1___.md", "- title:: lpt1\n  tags:: z\n- body\n"),
        ("Plain.md", "Just words.", "prn", "pages/prn___.md", "title:: prn\nJust words."),
    ];
    for (file, text, _, _, _) in &files {
        std::fs::write(v.join("pages").join(file), text).unwrap();
    }
    let mut app = App::open(&v).unwrap();
    for (file, _, new, rel, want) in &files {
        let old = file.trim_end_matches(".md");
        assert_eq!(app.rename(old, new).unwrap().name, *new);
        assert_eq!(std::fs::read_to_string(v.join(rel)).unwrap(), *want, "{old} → {new}");
    }
    let app = App::open_read_only(&v).unwrap();
    for (_, _, new, rel, _) in &files {
        let i = app.vault.page_info(new);
        assert!(i.exists && i.path.as_deref() == Some(*rel), "{new}: {i:?}");
    }
    // a name the file name holds as it is needs no title::
    let mut app = App::open(&v).unwrap();
    app.rename("aux", "Auxiliary").unwrap();
    assert_eq!(std::fs::read_to_string(v.join("pages/Auxiliary.md")).unwrap(), "title:: Auxiliary\n- a thing\n", "its title:: follows the new name");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn old_temp_files_of_this_app_are_cleared_once_a_day_old() {
    use outline_core::app::{is_own_tmp, write_atomic};
    assert!(is_own_tmp(".Project ideas.md.4242-7.tmp") && is_own_tmp(".config.edn.1-0.tmp"));
    for other in [".Project ideas.md.tmp", ".capture-123.tmp", ".rename-99.tmp", "x.md.1-2.tmp", "..md.1-2.tmp", ".a.md.1-x.tmp", ".a.md.-2.tmp", ".a.md.12-3.tmp.bak"] {
        assert!(!is_own_tmp(other), "{other}");
    }
    let v = tmp("sweep");
    let old_time = std::time::SystemTime::now() - std::time::Duration::from_secs(3 * 24 * 3600);
    let make = |name: &str, old: bool| {
        let p = v.join(name);
        std::fs::write(&p, "x").unwrap();
        if old {
            std::fs::File::options().write(true).open(&p).unwrap().set_modified(old_time).unwrap();
        }
    };
    make(".a.md.11-2.tmp", true);
    make(".b.md.11-3.tmp", false);
    make(".c.md.tmp", true);
    make("notes.md", true);
    write_atomic(&v.join("new.md"), "- hi\n").unwrap();
    let mut left: Vec<String> = std::fs::read_dir(&v).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    left.sort();
    assert_eq!(left, [".b.md.11-3.tmp", ".c.md.tmp", "new.md", "notes.md"], "only its own old temp file went");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn the_usual_capture_page_is_found_as_the_app_finds_it() {
    // :insert-today? false: notes go to the quick capture page "Inbox"
    const INBOX: &str = r#"{:quick-capture-options {:insert-today? false :default-page "Inbox"}
 :quick-capture-templates {:text "{text}"}}"#;
    let at = (2026, 10, 26);
    // the reviewer's case: pages/inbox.md holds the page "Mail" (its title::)
    let v = vault("usual-page", INBOX);
    std::fs::write(v.join("pages/inbox.md"), "title:: Mail\n- mail\n").unwrap();
    assert_eq!(capture_to_usual(&v, "via the box", "", false, at, "09:00").unwrap(), "pages/Inbox (2).md");
    assert_eq!(std::fs::read_to_string(v.join("pages/inbox.md")).unwrap(), "title:: Mail\n- mail\n", "Mail's file untouched");
    assert_eq!(std::fs::read_to_string(v.join("pages/Inbox (2).md")).unwrap(), "title:: Inbox\n- via the box\n");
    // adding to the page by name (the box's other-page path), and the next note from the box, go to that same page
    let mut app = App::open(&v).unwrap();
    assert_eq!(app.capture_to_page("Inbox", "from the app", "", false, at, "09:01").unwrap(), "pages/Inbox (2).md");
    assert_eq!(capture_to_usual(&v, "again", "", true, at, "09:02").unwrap(), "pages/Inbox (2).md");
    assert_eq!(std::fs::read_to_string(v.join("pages/Inbox (2).md")).unwrap(), "title:: Inbox\n- via the box\n- from the app\n- TODO again\n");
    let _ = std::fs::remove_dir_all(&v);
    // the page wherever its file is (named by title::)
    let v = vault("usual-page2", INBOX);
    std::fs::write(v.join("pages/Collected.md"), "title:: Inbox\n- earlier\n").unwrap();
    assert_eq!(capture_to_usual(&v, "x", "", false, at, "09:03").unwrap(), "pages/Collected.md");
    // a file named like it in other capitals is that page, as before
    let _ = std::fs::remove_dir_all(&v);
    let v = vault("usual-page3", INBOX);
    std::fs::write(v.join("pages/inbox.md"), "- earlier\n").unwrap();
    assert_eq!(capture_to_usual(&v, "y", "", false, at, "09:04").unwrap(), "pages/inbox.md");
    assert_eq!(std::fs::read_to_string(v.join("pages/inbox.md")).unwrap(), "- earlier\n- y\n");
    // a new capture page: its own file, named as Logseq names it
    std::fs::remove_file(v.join("pages/inbox.md")).unwrap();
    assert_eq!(capture_to_usual(&v, "z", "", false, at, "09:05").unwrap(), "pages/Inbox.md");
    assert_eq!(std::fs::read_to_string(v.join("pages/Inbox.md")).unwrap(), "- z\n");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn shared_pictures_go_where_notes_go_in_the_media_template() {
    // Android's "Add to journal" for a picture: copied into assets/, then its Markdown added with
    // the media template, to the place found exactly as for notes (the same code, through JNI)
    const INBOX: &str = r#"{:quick-capture-options {:insert-today? false :default-page "Inbox"}
 :quick-capture-templates {:text "{text}" :media "**{time}** {url}"}}"#;
    let at = (2026, 10, 26);
    let v = vault("media-page", INBOX);
    std::fs::write(v.join("pages/inbox.md"), "title:: Mail\r\n- mail").unwrap();
    let rel = save_asset_file_at(&v, "IMG 1.jpg", b"jpeg", 1761487200000).unwrap();
    let md = asset_markdown("IMG 1.jpg", &rel);
    assert_eq!(md, "![IMG 1](../assets/IMG_1_1761487200000.jpg)");
    assert_eq!(capture::capture_media_to_usual(&v, &md, at, "09:00").unwrap(), "pages/Inbox (2).md");
    assert_eq!(std::fs::read_to_string(v.join("pages/inbox.md")).unwrap(), "title:: Mail\r\n- mail", "Mail's file untouched");
    assert_eq!(std::fs::read_to_string(v.join("pages/Inbox (2).md")).unwrap(), "title:: Inbox\n- **09:00** ![IMG 1](../assets/IMG_1_1761487200000.jpg)\n");
    // a page with the alias Inbox is the capture page
    std::fs::remove_file(v.join("pages/Inbox (2).md")).unwrap();
    std::fs::write(v.join("pages/Collected.md"), "alias:: Inbox\n\n- earlier").unwrap();
    assert_eq!(capture::capture_media_to_usual(&v, "[a.pdf](../assets/a.pdf)", at, "09:01").unwrap(), "pages/Collected.md");
    assert_eq!(std::fs::read_to_string(v.join("pages/Collected.md")).unwrap(), "alias:: Inbox\n\n- earlier\n- **09:01** [a.pdf](../assets/a.pdf)");
    let _ = std::fs::remove_dir_all(&v);
    // today's journal, Logseq's default media template
    let v = vault("media-today", r#"{:quick-capture-options {:insert-today? true} :journal/page-title-format "MMMM do, yyyy"}"#);
    assert_eq!(capture::capture_media_to_usual(&v, "![p](../assets/p_1.png)", at, "09:02").unwrap(), "journals/2026_10_26.md");
    assert_eq!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap(), "- [[quick capture]] **09:02**: ![p](../assets/p_1.png)\n");
    let _ = std::fs::remove_dir_all(&v);
}

/// The app's icon in the capture box's strip (Canvas::logo): the cream tile, the ink scribble and
/// the red spark where the SVG has them, nothing outside its square, at the sizes the box uses.
#[test]
fn the_logo_is_drawn_in_its_square() {
    let (w, h) = (84, 84);
    let mut px = vec![0x777777u32; (w * h) as usize];
    let mut c = Canvas { px: &mut px, w, h };
    c.logo(10.0, 10.0, 64.0);
    let at = |x: i32, y: i32| px[(y * w + x) as usize];
    for y in 0..h {
        for x in 0..w {
            if !(10..74).contains(&x) || !(10..74).contains(&y) {
                assert_eq!(at(x, y), 0x777777, "nothing outside the square: ({x}, {y})");
            }
        }
    }
    assert_eq!(at(10 + 6, 10 + 32), LOGO_TILE, "the tile's left edge is cream");
    assert_eq!(at(10 + 50, 10 + 58), LOGO_TILE, "and its lower right");
    assert_eq!(at(10 + 50, 10 + 15), LOGO_SPARK, "the spark's middle is red");
    assert_ne!(at(10 + 50 + 7, 10 + 15 + 7), LOGO_SPARK, "between its points it isn't (four points, not a disc)");
    assert_ne!(at(10 + 50 + 11, 10 + 15), 0x777777, "its right point reaches out");
    let ink = px.iter().filter(|&&p| p == LOGO_INK).count();
    assert!(ink > 120, "the scribble is drawn in the ink: {ink} pixels");
    // the sizes the box uses (16 px at 100%, up to 40 at 250%): no panic, some of each colour
    for size in [16.0f32, 20.0, 40.0] {
        let n = size.ceil() as i32 + 2;
        let mut px = vec![0xFFFFFFu32; (n * n) as usize];
        Canvas { px: &mut px, w: n, h: n }.logo(1.0, 1.0, size);
        assert!(px.contains(&LOGO_TILE), "{size}: the tile");
        assert!(px.iter().any(|&p| (p >> 16) > 0xE0 && (p & 0xFF) < 0x90), "{size}: the spark (red, maybe softened at its edges)");
    }
}

/// The small buttons on the box ([[ ]], #, To-do; Build 34): at the right of the first line, level
/// with the + button, in that order, and the text stops before them.
#[test]
fn small_buttons_sit_right_of_the_text() {
    let m = Metrics { scale: 1.0, line_h: 27, lines: 1, pill_w: 0, rows: 0, list_line_h: 19, foot_h: 17, tool_w: [34, 22, 52] };
    let l = layout(&m);
    let [a, b, c] = l.tools;
    assert_eq!(c.r, 640 - 18, "the last ends where the text used to");
    assert!(a.r < b.l && b.r < c.l, "in order, with a gap: {a:?} {b:?} {c:?}");
    assert_eq!((a.w(), b.w(), c.w()), (34, 22, 52));
    assert!(l.note.r < a.l, "the text stops before them");
    for t in l.tools {
        assert_eq!(t.h(), 22);
        assert_eq!((t.t + t.b) / 2, (l.tile.t + l.tile.b) / 2, "level with the + button");
    }
    assert_eq!((l.w, l.h), (640, 98), "the box is no bigger");
    // none: the text reaches the edge, as before
    let none = layout(&Metrics { tool_w: [0; 3], ..m });
    assert_eq!(none.note.r, 640 - 18);
    assert!(none.tools.iter().all(|t| t.is_empty()));
    // scaled
    let big = layout(&Metrics { scale: 1.5, line_h: 40, foot_h: 25, list_line_h: 28, tool_w: [51, 33, 78], ..m });
    assert_eq!(big.tools[2].r, 960 - 27);
    assert_eq!(big.tools[0].h(), 33);
}

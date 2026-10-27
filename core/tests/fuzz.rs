//! Randomised "never panic, never reformat" tests. Real vaults contain every kind of text
//! (emoji, curly quotes, stray brackets, CRLF, tabs), and one panic crashes the app.

use outline_core::app::{dispatch, App};
use outline_core::*;
use serde_json::json;

/// Small deterministic PRNG (xorshift), so failures are reproducible.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[(self.next() % xs.len() as u64) as usize]
    }
}

const PIECES: &[&str] = &[
    "- ", "\t- ", "  - ", "* ", "\t* ", "+ ", "-", "\n", "\n", "\n", "\r\n", "\t", "  ", " ", "a", "word ",
    "[[", "]]", "[[Page]]", "[[Héla Barton]]", "#tag", "#[[two words]]", "#", "`", "```", "```py\n", "::",
    "key:: value", "tags:: a, [[b c]]", "alias:: X", "title:: T", "collapsed:: true", "id:: 6517b6e2-b42a-53a3-0e8e-6aae12345678",
    "📚", "‘Life’", "é", "日本語", "🧪x", "%2F", "%", "___", "TODO ", "DONE ", "# Heading", "**b**", "==m==",
    "https://x.org/#a", "---\n", "---", "alias: a, b\n", "  - item\n", "((6517b6e2-b42a-53a3-0e8e-6aae12345678))", "{{query x}}", "<div>", "\\", "\"", "'",
];

fn random_text(r: &mut Rng, n: usize) -> String {
    (0..n).map(|_| r.pick(PIECES)).collect()
}

#[test]
fn split_join_is_identity_on_random_text() {
    let mut r = Rng(0x9E3779B97F4A7C15);
    for case in 0..4000 {
        let len = (r.next() % 60) as usize;
        let s = random_text(&mut r, len);
        let d = split_doc(&s);
        let out = join_doc(&d);
        let expected = s.strip_prefix('\u{feff}').unwrap_or(&s);
        assert_eq!(out, expected, "case {case}: {s:?}");
    }
}

#[test]
fn parser_and_dates_never_panic() {
    let mut r = Rng(42);
    let fmts = ["MMMM do, yyyy", "MMM do, yyyy", "yyyy_MM_dd", "yyyy-MM-dd", "EEEE, MMMM d, yyyy", "dd.MM.yy", "'Week' M"];
    for _ in 0..3000 {
        let n = (r.next() % 30) as usize;
        let s = random_text(&mut r, n);
        let _ = parse_page(&s, &["authors".to_string()]);
        for f in fmts {
            let _ = date::parse(f, &s);
            let _ = date::parse(&s, "October 25th, 2026");
        }
    }
}

#[test]
fn every_command_survives_a_messy_vault() {
    let dir = std::env::temp_dir().join(format!("outline_fuzz_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("pages")).unwrap();
    std::fs::create_dir_all(dir.join("Diary")).unwrap();
    std::fs::create_dir_all(dir.join("logseq")).unwrap();
    std::fs::write(dir.join("logseq/config.edn"), r#"{:journals-directory "Diary" :journal/page-title-format "MMMM do, yyyy" :journal/file-name-format "MMMM do, yyyy"}"#).unwrap();
    let mut r = Rng(7);
    let names = ["📚 Pantry", "‘Soup waits for no one’", "Héla Barton", "日本語", "a___b", "a%2Fb", "Plain", "dup", "Dup"];
    for (i, n) in names.iter().enumerate() {
        let body = format!("- links [[{}]] #{}\n{}", names[(i + 1) % names.len()], names[(i + 3) % names.len()].replace(' ', ""), random_text(&mut r, 40));
        let _ = std::fs::write(dir.join("pages").join(format!("{n}.md")), body);
    }
    // two files that resolve to one page name (title:: collides with another file's name)
    std::fs::write(dir.join("pages/other.md"), "title:: Plain\n- I claim to be Plain\n- [[📚 Pantry]]\n- x\n- y\n- z\n").unwrap();
    std::fs::write(dir.join("Diary/October 25th, 2026.md"), "- today [[Plain]] [[📚 Pantry]]\n").unwrap();
    std::fs::write(dir.join("Diary/October 24th, 2026.md"), "no bullets at all, mentions [[Plain]]").unwrap();

    let mut st: Option<App> = None;
    dispatch(&mut st, "open", json!({ "path": dir.to_string_lossy() })).unwrap();
    for cmd in ["summary", "pages", "tags", "props", "rescan"] {
        dispatch(&mut st, cmd, json!({})).unwrap();
    }
    dispatch(&mut st, "journals", json!({ "end": [2026, 10, 25], "count": 7 })).unwrap();
    for n in names.iter().chain(["Plain", "other", "October 25th, 2026", "missing page", "‘", "📚"].iter()) {
        dispatch(&mut st, "page", json!({ "name": n })).unwrap();
        dispatch(&mut st, "search", json!({ "q": n })).unwrap();
        dispatch(&mut st, "with_property", json!({ "key": "title", "value": n })).unwrap();
    }
    for q in ["é", "日", "📚", "‘", "i̇", "İ", "ß", ""] {
        dispatch(&mut st, "search", json!({ "q": q })).unwrap();
    }
    let report = dispatch(&mut st, "check", json!({})).unwrap();
    assert_eq!(report["roundtrip_failures"].as_array().unwrap().len(), 0, "{report}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn config_reader_never_panics() {
    const EDN: &[&str] = &[
        "{", "}", "[", "]", "(", ")", "#{", "#_", "#\"", "\"", "\\", ":k", ":journals-directory", " ", "\n", ";", "é", "📚",
        "\"Diary\"", "#}", "#é}", ":property/separated-by-commas", "true", "nil", "-1", "#inst", ",", "\\u", "\\u12", ":favorites",
    ];
    let mut r = Rng(7);
    for _ in 0..5000 {
        let n = (r.next() % 24) as usize;
        let s: String = (0..n).map(|_| r.pick(EDN)).collect();
        let _ = Config::from_edn(&s);
        if let Some(out) = edn::set_path(&s, &["favorites"], "[\"x\"]") {
            assert!(edn::parse(&out).is_some(), "{s:?} -> {out:?}");
        }
        // favourites put in another order (reversed): the file still reads, with as many of them
        let n = edn::parse(&s).and_then(|root| root.get("favorites").map(|f| f.items().len())).unwrap_or(0);
        if let Some(out) = edn::reorder_items(&s, "favorites", &(0..n).rev().collect::<Vec<_>>()) {
            let again = edn::parse(&out).and_then(|root| root.get("favorites").map(|f| f.items().len()));
            assert_eq!(again, Some(n), "{s:?} -> {out:?}");
        }
    }
}

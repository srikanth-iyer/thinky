//! Speed check on a large made-up vault (930 pages + 600 journals, ~3.6 MB):
//! `cargo run --release -p outline_core --example bench [dir]`. Prints readable timings and a
//! last line `BENCH {json}` that CI compares with ci/baseline.json.
use outline_core::app::{set_cache_dir, set_data_dir, App};
use std::time::Instant;

fn ms(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 1e5).round() / 100.0
}

fn main() {
    let base = std::env::temp_dir().join("outline_bench");
    let generated = std::env::args().nth(1).is_none();
    let root = match std::env::args().nth(1) {
        Some(d) => std::path::PathBuf::from(d),
        None => {
            let root = base.join("vault");
            let _ = std::fs::remove_dir_all(&base);
            std::fs::create_dir_all(root.join("pages")).unwrap();
            std::fs::create_dir_all(root.join("journals")).unwrap();
            for i in 0..930 {
                let mut s = format!("tags:: topic{}, area{}\nstatus:: s{}\n\n", i % 50, i % 7, i % 3);
                let blocks = if i % 100 == 0 { 400 } else { 18 }; // a few long pages
                for j in 0..blocks {
                    s.push_str(&format!("- note {j} about [[Page {}]] and #tag{} with some more words here\n\t- child line, Page {} mentioned in passing\n", (i * 7 + j) % 930, j % 30, (i + j) % 930));
                    if j % 9 == 0 {
                        s.push_str(&format!("- TODO follow up {j}\n  SCHEDULED: <2026-10-{:02} Mon>\n", 1 + j % 28));
                    }
                }
                std::fs::write(root.join("pages").join(format!("Page {i}.md")), s).unwrap();
            }
            for d in 0..600 {
                let (y, m, day) = (2025 + d / 336, 1 + (d % 336) / 28, 1 + d % 28);
                let mut s = String::new();
                for j in 0..10 {
                    s.push_str(&format!("- journal entry {j} [[Page {}]] with a few words of text\n", (d * 13 + j) % 930));
                }
                std::fs::write(root.join("journals").join(format!("{y}_{m:02}_{day:02}.md")), s).unwrap();
            }
            root
        }
    };
    set_cache_dir(base.join("cache"));
    let _ = std::fs::remove_dir_all(base.join("cache"));

    let t = Instant::now();
    let app = App::open(&root).unwrap();
    let open_cold = ms(t);
    drop(app);
    let t = Instant::now();
    let mut app = App::open(&root).unwrap();
    let open_warm = ms(t);
    let t = Instant::now();
    let pages = app.pages().len(); // (All pages: with each file's times, as the app asks for it)
    let list = ms(t);
    let t = Instant::now();
    let refs = app.vault.linked_refs("Page 42").len();
    let linked = ms(t);
    let t = Instant::now();
    let pv = app.page("Page 0", None);
    let long_page = ms(t);
    // the app sends answers to its window as JSON: a long page and the page list
    let t = Instant::now();
    let json_bytes = serde_json::to_string(&pv).map(|j| j.len()).unwrap_or(0) + serde_json::to_string(&app.pages()).map(|j| j.len()).unwrap_or(0);
    let json = ms(t);
    // search (each keystroke in the Ctrl+K box): the first one also makes the notes' searchable copy
    let t = Instant::now();
    app.search("words");
    let search_first = ms(t);
    let t = Instant::now();
    let hits = app.search("words").len();
    let search = ms(t);
    // several words in any order, matching thousands of notes (all ranked)
    let t = Instant::now();
    let many = app.search("here words some").len();
    let search_words = ms(t);
    // a typo: no name has "pagge", so every name is checked letter by letter
    let t = Instant::now();
    let typo = app.search("pagge 42").len();
    let search_typo = ms(t);
    let t = Instant::now();
    let (un, _) = app.vault.unlinked_refs("Page 42", 300);
    let unlinked = ms(t);
    // the journals list: do 5 days have any unlinked references? (one pass; none here, so all of it)
    let days: Vec<String> = (1..=5).map(|d| app.journal_name((2025, 1, d))).collect();
    let t = Instant::now();
    let any = app.vault.has_unlinked(&days).iter().filter(|x| **x).count();
    let day_unlinked = ms(t);
    // the journals list's next 5 days (days other pages link to count too)
    let t = Instant::now();
    let shown = app.journals((2026, 10, 26), 5, true).len();
    let journals = ms(t);
    let t = Instant::now();
    let tasks = app.vault.tasks(false).len();
    let todos = ms(t);
    // the editor's save of a note added to a journal day
    let day = app.journal_name((2026, 10, 26));
    let mut pv = app.page(&day, None);
    pv.doc.blocks.push(outline_core::DocBlock { depth: 0, text: "bench note".into(), raw: None, plain: false });
    let req = serde_json::json!({"name": day, "doc": pv.doc, "base_hash": pv.hash});
    let t = Instant::now();
    app.save(serde_json::from_value(req).unwrap()).unwrap();
    let save = ms(t);
    let t = Instant::now();
    app.rescan();
    let rescan = ms(t);
    // "Check this folder": which of 1,000 pictures no note uses (half are used, so every note is read
    // to the end); then the safety copy made when the folder opens (every note here is new: 500 copied)
    if generated {
        std::fs::create_dir_all(root.join("assets")).unwrap();
        let mut s = String::new();
        for i in 0..1000 {
            std::fs::write(root.join("assets").join(format!("image_{i}.png")), [0u8; 64]).unwrap();
            if i % 2 == 0 {
                s.push_str(&format!("- ![a picture](../assets/image_{i}.png)\n"));
            }
        }
        std::fs::write(root.join("pages").join("Pictures.md"), s).unwrap();
        app.rescan();
    }
    // as from 4 days later: pictures from the last 3 days are left out, and these are all new
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let t = Instant::now();
    let pics = app.picture_check_at(now + 4 * 86_400);
    let pictures = ms(t);
    let _ = std::fs::remove_dir_all(base.join("data"));
    let t = Instant::now();
    let plan = app.safety_plan(now);
    let copied = plan.paths().len();
    let _ = plan.run(&base.join("data"));
    let safety = ms(t);
    // a start after 20 notes were changed elsewhere while the app was closed: their earlier texts go
    // into a safety copy first, then the index cache is written (what start_safety_copy does before
    // the background copy). Only on the sample vault: it changes notes.
    let mut open_changed = 0.0;
    if generated {
        set_data_dir(base.join("data"));
        app.persist();
        drop(app);
        for i in 0..20 {
            let p = root.join("pages").join(format!("Page {i}.md"));
            let text = std::fs::read_to_string(&p).unwrap();
            std::fs::write(&p, format!("{text}- changed elsewhere\n")).unwrap();
        }
        let t = Instant::now();
        let mut app = App::open(&root).unwrap();
        app.persist();
        open_changed = ms(t);
    }
    println!("{pages} pages; open {open_cold} ms (first time) / {open_warm} ms (with cache) / {open_changed} ms (20 notes changed elsewhere: their earlier texts kept first)");
    println!("all pages {list} ms · linked refs ({refs} pages) {linked} ms · long page ({} blocks) {long_page} ms", pv.doc.blocks.len());
    println!("search: first {search_first} ms (makes the notes' searchable copy) · then ({hits} hits) {search} ms · 3 words in any order ({many} hits) {search_words} ms · with a typo ({typo} hits) {search_typo} ms");
    println!("unlinked refs ({} pages) {unlinked} ms · to-dos ({tasks}) {todos} ms", un.len());
    println!("journals: the next {shown} days {journals} ms");
    println!("journals: any unlinked references for 5 days ({any} have some) {day_unlinked} ms");
    println!("save {save} ms · rescan {rescan} ms · JSON for the window ({json_bytes} bytes) {json} ms");
    println!("pictures nothing uses ({} of {}) {pictures} ms · safety copy ({copied} notes, in the background) {safety} ms", pics.unused.len(), pics.pictures);
    println!(
        "BENCH {{\"open_cold_ms\":{open_cold},\"open_warm_ms\":{open_warm},\"pages_ms\":{list},\"linked_ms\":{linked},\"page_ms\":{long_page},\"search_ms\":{search},\"search_first_ms\":{search_first},\"search_words_ms\":{search_words},\"search_typo_ms\":{search_typo},\"unlinked_ms\":{unlinked},\"todos_ms\":{todos},\"day_unlinked_ms\":{day_unlinked},\"journals_ms\":{journals},\"save_ms\":{save},\"rescan_ms\":{rescan},\"json_ms\":{json},\"pictures_ms\":{pictures},\"safety_copy_ms\":{safety},\"open_changed_ms\":{open_changed}}}"
    );
}

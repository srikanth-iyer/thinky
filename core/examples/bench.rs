//! Speed check on a large made-up vault (930 pages + 600 journals, ~3.6 MB):
//! `cargo run --release -p outline_core --example bench [dir]`. Prints readable timings and a
//! last line `BENCH {json}` that CI compares with ci/baseline.json.
use outline_core::app::{set_cache_dir, App};
use std::time::Instant;

fn ms(t: Instant) -> f64 {
    (t.elapsed().as_secs_f64() * 1e5).round() / 100.0
}

fn main() {
    let base = std::env::temp_dir().join("outline_bench");
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
    let pages = app.vault.all_pages().len();
    let list = ms(t);
    let t = Instant::now();
    let refs = app.vault.linked_refs("Page 42").len();
    let linked = ms(t);
    let t = Instant::now();
    let pv = app.page("Page 0", None);
    let long_page = ms(t);
    // the app sends answers to its window as JSON: a long page and the page list
    let t = Instant::now();
    let json_bytes = serde_json::to_string(&pv).map(|j| j.len()).unwrap_or(0) + serde_json::to_string(&app.vault.all_pages()).map(|j| j.len()).unwrap_or(0);
    let json = ms(t);
    let t = Instant::now();
    let hits = app.search("words").len();
    let search = ms(t);
    let t = Instant::now();
    let (un, _) = app.vault.unlinked_refs("Page 42", 300);
    let unlinked = ms(t);
    // the journals list: do 5 days have any unlinked references? (one pass; none here, so all of it)
    let days: Vec<String> = (1..=5).map(|d| app.journal_name((2025, 1, d))).collect();
    let t = Instant::now();
    let any = app.vault.has_unlinked(&days).iter().filter(|x| **x).count();
    let day_unlinked = ms(t);
    let t = Instant::now();
    let tasks = app.vault.tasks(false).len();
    let todos = ms(t);
    let t = Instant::now();
    app.append_journal((2026, 10, 26), "bench note").unwrap();
    let save = ms(t);
    let t = Instant::now();
    app.rescan();
    let rescan = ms(t);
    println!("{pages} pages; open {open_cold} ms (first time) / {open_warm} ms (with cache)");
    println!("all pages {list} ms · linked refs ({refs} pages) {linked} ms · long page ({} blocks) {long_page} ms", pv.doc.blocks.len());
    println!("search ({hits} hits) {search} ms · unlinked refs ({} pages) {unlinked} ms · to-dos ({tasks}) {todos} ms", un.len());
    println!("journals: any unlinked references for 5 days ({any} have some) {day_unlinked} ms");
    println!("save {save} ms · rescan {rescan} ms · JSON for the window ({json_bytes} bytes) {json} ms");
    println!(
        "BENCH {{\"open_cold_ms\":{open_cold},\"open_warm_ms\":{open_warm},\"pages_ms\":{list},\"linked_ms\":{linked},\"page_ms\":{long_page},\"search_ms\":{search},\"unlinked_ms\":{unlinked},\"todos_ms\":{todos},\"day_unlinked_ms\":{day_unlinked},\"save_ms\":{save},\"rescan_ms\":{rescan},\"json_ms\":{json}}}"
    );
}

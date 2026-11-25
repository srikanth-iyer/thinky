//! Big notes folders (review L5/L8, Nov 25, 2026): opening a folder reads its files' notes on several
//! threads at once, and the app keeps its page list in a small file for quick capture. These tests
//! check that the folder opened that way is exactly the one read file by file, and how the page list
//! file is kept and read.

use outline_core::app::{saved_page_list, set_cache_dir, App};
use outline_core::{content_hash, Config, Vault};
use std::path::{Path, PathBuf};

/// One cache folder for this test program (it can be set only once).
fn cache() -> PathBuf {
    let d = std::env::temp_dir().join(format!("outline_big_cache_{}", std::process::id()));
    set_cache_dir(d.clone());
    d
}

/// An empty notes folder for one test.
fn vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_big_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}

/// The quick capture list file of the folder `v` (beside its index cache).
fn names_file(cache: &Path, v: &Path) -> PathBuf {
    cache.join(format!("pages-{}.json", content_hash(&v.display().to_string())))
}

/// A folder with enough files to take the several-threads path (200 or more), in the shapes that
/// make order matter: two files claiming one name with title::, aliases, tags, page properties,
/// links between pages, journal days linking pages, and names that differ only in capitals.
fn big(v: &Path) {
    for i in 0..400 {
        let mut t = String::new();
        if i % 50 == 7 {
            t.push_str("title:: Shared name\n"); // several files want the same page name: the first in order keeps it
        }
        if i % 40 == 3 {
            t.push_str(&format!("alias:: Other {i}, Also {i}\n"));
        }
        if i % 30 == 5 {
            t.push_str("tags:: project, [[Area 2]]\n");
        }
        for b in 0..(3 + i % 7) {
            let ind = if b % 3 == 2 { "\t" } else { "" };
            t.push_str(&format!("{ind}- note {b} of page {i} links [[Page {}]] and #topic{}\n", (i * 7 + b) % 400, b % 5));
        }
        if i % 25 == 0 {
            t.push_str("- id:: 6543a1b2-0000-4000-8000-0000000000aa\n");
        }
        std::fs::write(v.join(format!("pages/Page {i}.md")), t).unwrap();
    }
    std::fs::write(v.join("pages/page 9.md"), "- small letters, another file\n").unwrap();
    for d in 1..=28 {
        std::fs::write(v.join(format!("journals/2026_02_{d:02}.md")), format!("- day {d} [[Page {d}]] [[Shared name]]\n")).unwrap();
    }
}

/// Everything a page shows that comes from the index, as text (to compare two indexes).
fn shown(v: &Vault) -> String {
    let mut out = serde_json::to_string(&v.all_pages()).unwrap();
    for p in v.all_pages() {
        out.push_str(&serde_json::to_string(&v.page_info(&p.name)).unwrap());
        out.push_str(&serde_json::to_string(&v.linked_refs(&p.name)).unwrap());
    }
    for q in ["note 3", "Shared", "topic2", "Other 43"] {
        out.push_str(&serde_json::to_string(&v.search(q, 40)).unwrap());
    }
    out
}

#[test]
fn opened_on_several_threads_is_the_same_as_file_by_file() {
    cache();
    let v = vault("same");
    big(&v);
    // file by file, in the order the app indexes them (sorted paths), as before the change
    let mut rels: Vec<String> = Vec::new();
    for d in ["journals", "pages"] {
        for e in std::fs::read_dir(v.join(d)).unwrap() {
            rels.push(format!("{d}/{}", e.unwrap().file_name().to_string_lossy()));
        }
    }
    rels.sort();
    let mut one_by_one = Vault::with_config(Config::default());
    for r in &rels {
        one_by_one.upsert(r, &std::fs::read_to_string(v.join(r)).unwrap());
    }
    // the app's open (no cache yet), then again from the cache: both the same as file by file
    let app = App::open(&v).unwrap();
    assert_eq!(shown(&app.vault), shown(&one_by_one));
    drop(app);
    let app = App::open(&v).unwrap();
    assert_eq!(shown(&app.vault), shown(&one_by_one));
    // and the first file in order kept the shared name (Page 107 sorts before Page 157, Page 207…)
    assert_eq!(app.vault.page_info("Shared name").path.as_deref(), Some("pages/Page 107.md"));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn the_app_keeps_its_page_list_for_quick_capture() {
    let cache = cache();
    let v = vault("names");
    std::fs::write(v.join("pages/Alpha.md"), "- links [[Beta]]\n").unwrap();
    std::fs::write(v.join("journals/2026_02_03.md"), "- a day\n").unwrap();
    // no list before the app has opened the folder
    assert_eq!(saved_page_list(&v), None);
    // opened only to read (quick capture, the check): nothing is written
    drop(App::open_read_only(&v).unwrap());
    assert!(!names_file(&cache, &v).exists());
    assert_eq!(saved_page_list(&v), None);
    // the app itself keeps it: the same list the open folder gives (journal days left out)
    let mut app = App::open(&v).unwrap();
    let mut kept = saved_page_list(&v).unwrap();
    let mut now = app.page_list();
    kept.sort();
    now.sort();
    assert_eq!(kept, now);
    assert!(kept.iter().any(|(n, _)| n == "Alpha") && kept.iter().any(|(n, _)| n == "Beta"));
    assert!(!kept.iter().any(|(n, _)| n.contains("2026")));
    // a page made outside the app: in the list once the app has taken it in and kept its cache
    std::fs::write(v.join("pages/Gamma.md"), "- new\n").unwrap();
    app.rescan();
    app.persist();
    assert!(saved_page_list(&v).unwrap().iter().any(|(n, _)| n == "Gamma"));
    drop(app);
    // a list that can't be read, or is another folder's, is never shown
    let f = names_file(&cache, &v);
    let good = std::fs::read(&f).unwrap();
    std::fs::write(&f, b"{not json").unwrap();
    assert_eq!(saved_page_list(&v), None);
    let other = String::from_utf8(good.clone()).unwrap().replace(&serde_json::to_string(&v.display().to_string()).unwrap(), "\"C:\\\\elsewhere\"");
    std::fs::write(&f, other).unwrap();
    assert_eq!(saved_page_list(&v), None);
    // a missing list is written again at the app's next start, even with nothing else to write
    std::fs::remove_file(&f).unwrap();
    drop(App::open(&v).unwrap());
    assert!(saved_page_list(&v).unwrap().iter().any(|(n, _)| n == "Gamma"));
    let _ = std::fs::remove_file(&f);
    let _ = std::fs::remove_dir_all(&v);
}

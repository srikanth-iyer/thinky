//! The index cache: a second start reuses unchanged files and notices changed ones.
use outline_core::app::{set_cache_dir, App};
use outline_core::content_hash;

/// One cache folder for this whole test program: the cache folder can be set only once (whichever test
/// comes first), so every test sets the same one, and no test deletes it (only its own files in it).
fn shared_cache() -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("outline_cache_shared_{}", std::process::id()));
    set_cache_dir(d.clone());
    d
}

#[test]
fn cache_reuses_and_refreshes() {
    let base = std::env::temp_dir().join(format!("outline_cache_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let vault = base.join("vault");
    std::fs::create_dir_all(vault.join("pages")).unwrap();
    std::fs::create_dir_all(vault.join("journals")).unwrap();
    std::fs::write(vault.join("pages/A.md"), "- links [[B]]\n").unwrap();
    std::fs::write(vault.join("pages/B.md"), "- plain\n").unwrap();
    let cache = shared_cache();

    let app = App::open(&vault).unwrap();
    assert_eq!(app.vault.linked_refs("B").len(), 1);
    // this vault's own cache file (other tests in this binary share the cache folder)
    let mine = cache.join(format!("vault-{}.json", content_hash(&vault.display().to_string())));
    assert!(mine.exists(), "the vault's cache file is written");
    drop(app);

    // change A outside the app (different size, so the stamp differs even on coarse clocks)
    std::fs::write(vault.join("pages/A.md"), "- now links [[C]] instead\n").unwrap();
    std::fs::remove_file(vault.join("pages/B.md")).unwrap();
    let app = App::open(&vault).unwrap();
    assert!(app.vault.linked_refs("B").is_empty());
    assert_eq!(app.vault.linked_refs("C").len(), 1);
    assert_eq!(app.vault.page_count(), 1);

    // a corrupt cache is ignored, not fatal
    std::fs::write(&mine, b"{not json").unwrap();
    let app = App::open(&vault).unwrap();
    assert_eq!(app.vault.linked_refs("C").len(), 1);
    drop(app);
    let _ = std::fs::remove_file(&mine);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn empty_past_journals_are_skipped() {
    let base = std::env::temp_dir().join(format!("outline_empty_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(base.join("journals")).unwrap();
    std::fs::create_dir_all(base.join("pages")).unwrap();
    std::fs::write(base.join("journals/2026_10_22.md"), "\n").unwrap();
    std::fs::write(base.join("journals/2026_10_23.md"), "- real note\n").unwrap();
    std::fs::write(base.join("journals/2026_10_24.md"), "-\n").unwrap();
    let app = App::open(&base).unwrap();
    let days: Vec<_> = app.journals((2026, 10, 25), 10, true).into_iter().map(|d| d.date).collect();
    assert_eq!(days, vec![(2026, 10, 25), (2026, 10, 23)]);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn the_check_never_writes_the_cache() {
    // "Check this folder" opens the folder a second time: it must leave the index cache alone, or the
    // next start couldn't tell which notes were changed elsewhere (their earlier texts would be lost)
    let base = std::env::temp_dir().join(format!("outline_cache_check_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let vault = base.join("vault");
    std::fs::create_dir_all(vault.join("pages")).unwrap();
    std::fs::create_dir_all(vault.join("journals")).unwrap();
    std::fs::write(vault.join("pages/A.md"), "- the text from before\n").unwrap();
    let cache = shared_cache();
    drop(App::open(&vault).unwrap());
    assert_eq!(outline_core::app::cache_dir(), Some(cache.clone()));
    let mine = cache.join(format!("vault-{}.json", content_hash(&vault.display().to_string())));
    let before = std::fs::read(&mine).unwrap();
    std::fs::write(vault.join("pages/A.md"), "- changed elsewhere, a longer text\n").unwrap();
    let r = outline_core::app::check_vault(&vault).unwrap();
    assert_eq!(r.files, 1);
    assert_eq!(std::fs::read(&mine).unwrap(), before, "the cache still holds the text from before");
    let _ = std::fs::remove_file(&mine);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn journals_show_days_other_pages_link_to() {
    shared_cache();
    let base = std::env::temp_dir().join(format!("outline_linkeddays_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(base.join("journals")).unwrap();
    std::fs::create_dir_all(base.join("pages")).unwrap();
    std::fs::write(base.join("journals/2026_10_22.md"), "\n").unwrap(); // empty, but linked to
    std::fs::write(base.join("journals/2026_10_24.md"), "-\n").unwrap(); // empty, not linked
    std::fs::write(base.join("journals/2026_10_21.md"), "- links to itself [[Oct 21st, 2026]]\n").unwrap();
    std::fs::write(base.join("journals/2026_10_15.md"), "-\n").unwrap();
    std::fs::write(base.join("journals/2026_10_14.md"), "- self only [[Oct 14th, 2026]]\n- \n").unwrap();
    // a page tags a day with no file, one with an empty file, and a day after the end
    std::fs::write(base.join("pages/Trip.md"), "- left on [[Oct 20th, 2026]], back [[Oct 22nd, 2026]]\n- next [[Oct 30th, 2026]]\n").unwrap();
    let app = App::open(&base).unwrap();
    let days: Vec<_> = app.journals((2026, 10, 25), 10, true).into_iter().map(|d| d.date).collect();
    assert_eq!(days, vec![(2026, 10, 25), (2026, 10, 22), (2026, 10, 21), (2026, 10, 20), (2026, 10, 14)]);
    // one with no file says so (the page opens empty, its references below)
    let d20 = app.journals((2026, 10, 20), 1, false);
    assert_eq!((d20[0].date, d20[0].exists), ((2026, 10, 20), false));
    let _ = std::fs::remove_dir_all(&base);
}

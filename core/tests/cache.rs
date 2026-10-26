//! The index cache: a second start reuses unchanged files and notices changed ones.
use outline_core::app::{set_cache_dir, App};
use outline_core::content_hash;

#[test]
fn cache_reuses_and_refreshes() {
    let base = std::env::temp_dir().join(format!("outline_cache_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let vault = base.join("vault");
    std::fs::create_dir_all(vault.join("pages")).unwrap();
    std::fs::create_dir_all(vault.join("journals")).unwrap();
    std::fs::write(vault.join("pages/A.md"), "- links [[B]]\n").unwrap();
    std::fs::write(vault.join("pages/B.md"), "- plain\n").unwrap();
    set_cache_dir(base.join("cache"));

    let app = App::open(&vault).unwrap();
    assert_eq!(app.vault.linked_refs("B").len(), 1);
    // this vault's own cache file (other tests in this binary share the cache folder)
    let mine = base.join("cache").join(format!("vault-{}.json", content_hash(&vault.display().to_string())));
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

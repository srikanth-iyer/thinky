//! Where quick capture adds notes from outside the app: the folder last opened in it, or in words
//! why it can't (never chosen; chosen but out of reach, e.g. Google Drive not running).
use outline_core::app::{dispatch, last_vault_or_why, set_cache_dir};

#[test]
fn the_last_folder_or_why_not() {
    let base = std::env::temp_dir().join(format!("outline_last_vault_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    set_cache_dir(base.join("cache"));
    let never = last_vault_or_why().unwrap_err();
    assert!(never.contains("choose your notes folder"), "{never}");

    let vault = base.join("vault");
    std::fs::create_dir_all(vault.join("pages")).unwrap();
    std::fs::create_dir_all(vault.join("journals")).unwrap();
    std::fs::write(vault.join("pages/A.md"), "- a\n").unwrap();
    let mut state = None;
    dispatch(&mut state, "open", serde_json::json!({ "path": vault })).unwrap();
    let root = state.as_ref().unwrap().root.clone();
    assert_eq!(last_vault_or_why().unwrap(), root, "opening it remembers it");

    drop(state);
    std::fs::rename(&vault, base.join("elsewhere")).unwrap();
    let away = last_vault_or_why().unwrap_err();
    assert!(away.contains("can’t be reached") && away.contains(&root.display().to_string()), "{away}");
    let _ = std::fs::remove_dir_all(&base);
}

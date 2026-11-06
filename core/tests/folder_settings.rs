//! Build 37: settings kept in the notes folder (logseq/thinky.json, `App::folder_settings`), shared by
//! every device through the folder's sync; and Logseq's `:block-hidden-properties` read from config.edn.
use outline_core::app::{dispatch, set_cache_dir, App};
use outline_core::Config;
use serde_json::json;
use std::path::{Path, PathBuf};

fn vault(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_fs_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(v.join(d)).unwrap();
    }
    v
}
fn cache() -> PathBuf {
    let d = std::env::temp_dir().join(format!("outline_fs_cache_{}", std::process::id()));
    set_cache_dir(d.clone());
    d
}
fn get(v: &Path, rel: &str) -> String {
    std::fs::read_to_string(v.join(rel)).unwrap()
}

#[test]
fn folder_settings_are_saved_in_the_notes_folder() {
    let _c = cache();
    let v = vault("save");
    std::fs::write(v.join("pages/a.md"), "- a\n").unwrap();
    let app = App::open(&v).unwrap();
    assert_eq!(app.folder_settings(), json!({}), "none yet: empty");
    let rules = json!({ "by": { "show": "icon", "icon": "✦", "mark": "purple" } });
    app.set_folder_setting("propertyDisplay", rules.clone()).unwrap();
    let saved: serde_json::Value = serde_json::from_str(&get(&v, "logseq/thinky.json")).unwrap();
    assert_eq!(saved, json!({ "propertyDisplay": rules }), "written as plain JSON in logseq/");
    assert!(!v.join("logseq/thinky.json.tmp").exists(), "no temporary file left");
    // another device changed the file meanwhile (a sync): that change is kept when this one saves
    std::fs::write(v.join("logseq/thinky.json"), r#"{"propertyDisplay": {"by": {"show": "quiet"}}, "fromPhone": 1}"#).unwrap();
    app.set_folder_setting("other", json!(true)).unwrap();
    let saved: serde_json::Value = serde_json::from_str(&get(&v, "logseq/thinky.json")).unwrap();
    assert_eq!(saved["fromPhone"], json!(1));
    assert_eq!(saved["propertyDisplay"]["by"]["show"], json!("quiet"));
    assert_eq!(saved["other"], json!(true));
    // null removes a setting
    app.set_folder_setting("other", serde_json::Value::Null).unwrap();
    assert!(app.folder_settings().get("other").is_none());
    // a broken file is never overwritten (it might be half-synced): an error instead
    std::fs::write(v.join("logseq/thinky.json"), "{ not json").unwrap();
    assert_eq!(app.folder_settings(), json!({}), "reads as none");
    assert!(app.set_folder_setting("x", json!(1)).is_err());
    assert_eq!(get(&v, "logseq/thinky.json"), "{ not json", "left as it was");
    // no name: refused
    std::fs::remove_file(v.join("logseq/thinky.json")).unwrap();
    assert!(app.set_folder_setting("  ", json!(1)).is_err());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn folder_settings_through_dispatch() {
    let _c = cache();
    let v = vault("dispatch");
    std::fs::write(v.join("pages/a.md"), "- a\n").unwrap();
    let mut state = Some(App::open(&v).unwrap());
    let r = dispatch(&mut state, "set_folder_setting", json!({ "key": "propertyDisplay", "value": { "by": { "show": "hidden" } } })).unwrap();
    assert_eq!(r["propertyDisplay"]["by"]["show"], json!("hidden"));
    let r = dispatch(&mut state, "folder_settings", json!({})).unwrap();
    assert_eq!(r["propertyDisplay"]["by"]["show"], json!("hidden"));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn block_hidden_properties_from_config() {
    let c = Config::from_edn("{:block-hidden-properties #{:public :Source \"by\"}\n :preferred-workflow :todo}");
    let mut h = c.hidden_props.clone();
    h.sort();
    assert_eq!(h, vec!["by", "public", "source"]);
    assert!(Config::from_edn("{}").hidden_props.is_empty());
}

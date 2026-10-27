//! Settings file, to-dos, renames, unlinked references, templates, the bin, capture, images.
use outline_core::app::{dispatch, App};
use outline_core::*;
use serde_json::json;
use std::path::PathBuf;

fn tmp_vault(tag: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("outline_feat_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    for d in ["pages", "journals", "logseq"] {
        std::fs::create_dir_all(base.join(d)).unwrap();
    }
    base
}

const CONFIG: &str = r#";; my settings
{:meta/version 1
 :preferred-workflow :todo
 :journals-directory "journals"
 :favorites ["writing notebook" "to read"]
 ;; :favorites ["commented out"]
 :default-templates {:journals ""}
 :quick-capture-templates {:text "**{time}** [[quick capture]]: #inbox {text} {url}"
                           :media "**{time}** [[quick capture]]: #inbox {url}"}
 :quick-capture-options {:insert-today? true :redirect-page? false :default-page "quick capture"}
 :shortcuts {:editor/move-block-up "shift+ctrl+up"
             :go/journals ["g j" "mod+shift+j"]
             :editor/highlight false}
 :macros {"log" "[:span \"x\"]"}
 :property/separated-by-commas #{:authors}
 :hidden []
}
"#;

#[test]
fn edn_reads_and_rewrites_config() {
    let c = Config::from_edn(CONFIG);
    assert_eq!(c.favorites, vec!["writing notebook", "to read"]);
    assert_eq!(c.workflow, "todo");
    assert!(c.capture_today);
    assert_eq!(c.capture_page, "quick capture");
    assert_eq!(c.capture_text, "**{time}** [[quick capture]]: #inbox {text} {url}");
    assert_eq!(c.comma_props, vec!["authors"]);
    assert_eq!(c.shortcuts[0], ("editor/move-block-up".to_string(), vec!["shift+ctrl+up".to_string()]));
    assert_eq!(c.shortcuts[1].1, vec!["g j", "mod+shift+j"]);
    assert!(c.shortcuts[2].1.is_empty()); // turned off

    // replace a value in place: everything else (comments, spacing) stays byte-for-byte
    let out = edn::set_path(CONFIG, &["favorites"], "[\"a\" \"b \\\"q\\\"\"]").unwrap();
    assert_eq!(out, CONFIG.replace("[\"writing notebook\" \"to read\"]", "[\"a\" \"b \\\"q\\\"\"]"));
    assert_eq!(Config::from_edn(&out).favorites, vec!["a", "b \"q\""]);
    // nested value
    let out = edn::set_path(CONFIG, &["quick-capture-options", "default-page"], "\"inbox\"").unwrap();
    assert_eq!(Config::from_edn(&out).capture_page, "inbox");
    // missing key: added before the closing brace
    let out = edn::set_path("{:a 1\n :b 2\n}\n", &["favorites"], "[\"x\"]").unwrap();
    assert_eq!(out, "{:a 1\n :b 2\n :favorites [\"x\"]\n}\n");
    let out = edn::set_path("{}", &["quick-capture-templates", "text"], "\"t\"").unwrap();
    assert_eq!(Config::from_edn(&out).capture_text, "t");
    // garbage never panics and gives defaults
    for bad in ["", "{", "{:a", "#_", "#{", "\"open", "{:a #inst}", "]", "{:a \\", ":k", "{:x \"\\u12\"}"] {
        let _ = Config::from_edn(bad);
        let _ = edn::set_path(bad, &["favorites"], "[]");
    }
}

#[test]
fn favourites_reorder_in_place() {
    // only the items move: the spaces, commas, comments and #_ forms between them stay where they were
    let text = "{:a 1\r\n :favorites [\"one\" ;; first\r\n   \"two \\\"q\\\"\",  #_\"old\" \"three\"]\r\n :b [\"x\" \"y\"]}";
    let out = edn::reorder_items(text, "favorites", &[2, 0, 1]).unwrap();
    assert_eq!(out, "{:a 1\r\n :favorites [\"three\" ;; first\r\n   \"one\",  #_\"old\" \"two \\\"q\\\"\"]\r\n :b [\"x\" \"y\"]}");
    assert_eq!(Config::from_edn(&out).favorites, vec!["three", "one", "two \"q\""]);
    // not a reordering of all of them, or not a sequence: nothing
    for bad in [&[0, 1][..], &[0, 0, 1], &[0, 1, 3], &[]] {
        assert!(edn::reorder_items(text, "favorites", bad).is_none(), "{bad:?}");
    }
    assert!(edn::reorder_items(text, "a", &[]).is_none());
    assert!(edn::reorder_items(text, "missing", &[]).is_none());
    assert_eq!(edn::reorder_items("{:favorites []}", "favorites", &[]).unwrap(), "{:favorites []}");

    let v = tmp_vault("favorder");
    let cfg = ";; mine\r\n{:meta/version 1\r\n :favorites [\"Writing notebook\"\r\n             \"to read\" ; later\r\n             \"Ünïcode ✓\"]\r\n :hidden []}\r\n";
    std::fs::write(v.join("logseq/config.edn"), cfg).unwrap();
    let mut app = App::open(&v).unwrap();
    let order = |n: &[&str]| n.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    // names in any capitals, as the sidebar shows them
    let favs = app.reorder_favorites(&order(&["ünïcode ✓", "writing notebook", "TO READ"])).unwrap();
    assert_eq!(favs, vec!["Ünïcode ✓", "Writing notebook", "to read"]);
    assert_eq!(
        std::fs::read_to_string(v.join("logseq/config.edn")).unwrap(),
        ";; mine\r\n{:meta/version 1\r\n :favorites [\"Ünïcode ✓\"\r\n             \"Writing notebook\" ; later\r\n             \"to read\"]\r\n :hidden []}\r\n"
    );
    // the same order again: the file isn't written
    let before = std::fs::metadata(v.join("logseq/config.edn")).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    assert_eq!(app.reorder_favorites(&favs).unwrap(), favs);
    assert_eq!(std::fs::metadata(v.join("logseq/config.edn")).unwrap().modified().unwrap(), before);
    // changed elsewhere meanwhile (one added, one removed): those named take their places in the order
    // asked, the new one keeps its own
    std::fs::write(v.join("logseq/config.edn"), "{:favorites [\"Writing notebook\" \"new\" \"Ünïcode ✓\"]}").unwrap();
    let favs = app.reorder_favorites(&order(&["to read", "Ünïcode ✓", "Writing notebook"])).unwrap();
    assert_eq!(favs, vec!["Ünïcode ✓", "new", "Writing notebook"]);
    assert_eq!(app.vault.config.favorites, favs);
    // no config.edn, or none of them in it: nothing written, nothing breaks
    std::fs::write(v.join("logseq/config.edn"), "{:a 1}").unwrap();
    assert!(app.reorder_favorites(&order(&["x"])).unwrap().is_empty());
    assert_eq!(std::fs::read_to_string(v.join("logseq/config.edn")).unwrap(), "{:a 1}");
    std::fs::remove_file(v.join("logseq/config.edn")).unwrap();
    assert!(app.reorder_favorites(&order(&["x"])).unwrap().is_empty());
    assert!(!v.join("logseq/config.edn").exists());
    std::fs::write(v.join("logseq/config.edn"), "{:favorites [\"a\" \"b\"").unwrap(); // unreadable: left alone
    assert!(app.reorder_favorites(&order(&["b", "a"])).is_err());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn todos_parse_and_repeat() {
    let t = task::parse("TODO [#A] write the paper\nSCHEDULED: <2026-10-26 Mon 10:00 .+1d>\nDEADLINE: <2026-11-01 Sun>").unwrap();
    assert_eq!(t.marker, "TODO");
    assert_eq!(t.priority, Some('A'));
    let s = t.scheduled.as_ref().unwrap();
    assert_eq!((s.date, s.time.as_deref(), s.repeat.as_deref()), ((2026, 10, 26), Some("10:00"), Some(".+1d")));
    assert_eq!(t.deadline.as_ref().unwrap().date, (2026, 11, 1));
    assert!(task::parse("TODOS are fun").is_none());
    assert!(task::parse("todo lower case").is_none());
    assert_eq!(task::parse("DONE").unwrap().marker, "DONE");
    assert!(!task::parse("CANCELED x").unwrap().is_open());

    // finishing a repeating task moves its date on instead of marking it done
    let today = (2026, 10, 28);
    assert_eq!(task::complete("TODO water plants\nSCHEDULED: <2026-10-26 Mon .+2d>", today), "TODO water plants\nSCHEDULED: <2026-10-30 Fri .+2d>");
    assert_eq!(task::complete("LATER pay rent\nDEADLINE: <2026-01-31 Sat ++1m>", today), "LATER pay rent\nDEADLINE: <2026-10-31 Sat ++1m>");
    assert_eq!(task::complete("NOW call\nSCHEDULED: <2026-10-26 Mon +1w>", today), "LATER call\nSCHEDULED: <2026-11-02 Mon +1w>");
    assert_eq!(task::complete("DOING plain", today), "DONE plain");
    assert_eq!(date::add_months((2026, 1, 31), 1), (2026, 2, 28));
    assert_eq!(date::civil_from_days(date::days_from_civil((2024, 2, 29))), (2024, 2, 29));
    assert!(date::parse("MMMM do, yyyy", "February 31st, 2026").is_none());
}

#[test]
fn rename_rewrites_links_only() {
    let olds = vec!["old name".to_string()];
    let r = |s: &str| text::rename_refs(s, &olds, "New Name", &["authors".to_string()]);
    assert_eq!(r("see [[Old Name]] and [[old name]]").unwrap(), "see [[New Name]] and [[New Name]]");
    assert_eq!(r("#[[old name]] and #Old").as_deref(), Some("#[[New Name]] and #Old"));
    assert_eq!(text::rename_refs("#old", &["old".to_string()], "brand new", &[]).unwrap(), "#[[brand new]]");
    assert_eq!(text::rename_refs("#old.", &["old".to_string()], "new", &[]).unwrap(), "#new.");
    // code, URLs, plain mentions and other names stay as they are
    assert_eq!(r("`[[Old Name]]` https://x.org/[[Old Name]] Old Name [[Old Names]]"), None);
    assert_eq!(r("```\n[[Old Name]]\n```"), None);
    // property values: links always, plain names for list properties
    assert_eq!(r("tags:: Old Name, other\nauthors:: old name\nnote:: Old Name").unwrap(), "tags:: New Name, other\nauthors:: New Name\nnote:: Old Name");
    assert_eq!(r("type:: [[Old Name]]").unwrap(), "type:: [[New Name]]");
}

#[test]
fn mentions_skip_links_code_and_props() {
    let names = vec!["sourdough bread".to_string(), "sb".to_string()];
    let t = "Sourdough bread are neat. [[sourdough bread]] `sourdough bread` #SB\nhusband: SB rules\nsource:: SB";
    let m = text::mentions(t, &names);
    let words: Vec<&str> = m.iter().map(|&(s, e)| &t[s..e]).collect();
    assert_eq!(words, vec!["Sourdough bread", "SB"]);
    assert_eq!(text::link_first_mention("I like Sourdough Bread!", &names).unwrap(), "I like [[Sourdough Bread]]!");
    // case-folding that changes length must not misplace the match
    let names = vec!["i̇stanbul".to_string()];
    let t = "İstanbul trip";
    let m = text::mentions(t, &names);
    assert_eq!(m.len(), 1);
    assert_eq!(&t[m[0].0..m[0].1], "İstanbul");
    // a picture's size ({:height …, :width …}, as Logseq writes it) is part of the picture, not words
    let names = vec!["width".to_string(), "height".to_string()];
    let t = "a chart ![c](../assets/c.png){:height 95, :width 190} of the width";
    let m = text::mentions(t, &names);
    let words: Vec<&str> = m.iter().map(|&(s, e)| &t[s..e]).collect();
    assert_eq!(words, vec!["width"]);
    assert_eq!(text::link_first_mention(t, &names).unwrap(), "a chart ![c](../assets/c.png){:height 95, :width 190} of the [[width]]");
}

fn sample_vault(tag: &str) -> (PathBuf, App) {
    let v = tmp_vault(tag);
    std::fs::write(v.join("logseq/config.edn"), CONFIG).unwrap();
    std::fs::write(v.join("pages/Sourdough Bread.md"), "alias:: SB\n- SBs are loaves\n").unwrap();
    std::fs::write(v.join("pages/Notes.md"), "- I bake sourdough bread daily\n- linked [[Sourdough Bread]] here, sourdough bread too\n- TODO read about SB recipes\n\tSCHEDULED: <2026-10-20 Tue>\n- DONE old thing\n").unwrap();
    std::fs::write(v.join("journals/2026_10_25.md"), "- meeting about [[sourdough bread]]\r\n- #[[Sourdough Bread]] tag\r\n").unwrap();
    std::fs::write(v.join("pages/Templates.md"), "- daily\n  template:: Daily\n\t- ## Plan for <% today %>\n\t- logged at <% time %> on <% current page %>\n").unwrap();
    let app = App::open(&v).unwrap();
    (v, app)
}

#[test]
fn unlinked_tasks_templates_and_props() {
    let (v, mut app) = sample_vault("unlinked");
    let (groups, more) = app.vault.unlinked_refs("Sourdough Bread", 100);
    assert!(!more);
    assert_eq!(groups.len(), 1);
    // the block that already links is left out; the other two mention it in plain text
    let texts: Vec<&str> = groups[0].hits.iter().map(|h| h.text.as_str()).collect();
    assert_eq!(texts, vec!["I bake sourdough bread daily", "TODO read about SB recipes\nSCHEDULED: <2026-10-20 Tue>"]);

    // link one of them: the block becomes a linked reference
    let hit = &groups[0].hits[0];
    let r = app.link_mention("Notes", hit.line.unwrap(), &hit.text, "Sourdough Bread").unwrap();
    assert!(r.ok);
    assert!(std::fs::read_to_string(v.join("pages/Notes.md")).unwrap().starts_with("- I bake [[sourdough bread]] daily\n"));
    assert_eq!(app.vault.unlinked_refs("Sourdough Bread", 100).0[0].hits.len(), 1);
    // a stale base is refused, not written
    let r = app.link_mention("Notes", hit.line.unwrap(), &hit.text, "Sourdough Bread");
    assert!(r.is_err() || !r.unwrap().ok);

    // the journals list asks "any unlinked references?" for several days at once
    assert_eq!(app.vault.has_unlinked(&["Sourdough Bread".into(), "Notes".into(), "nothing like this".into()]), vec![true, false, false]);
    assert_eq!(app.vault.has_unlinked(&["SB".into()]), vec![true]); // by an alias too
    assert!(app.vault.has_unlinked(&[]).is_empty());

    let open = app.vault.tasks(false);
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].task.scheduled.as_ref().unwrap().date, (2026, 10, 20));
    assert_eq!(app.vault.tasks(true).len(), 2);

    // tick it from the to-do list
    let t = &open[0];
    let done = task::complete(&t.text, (2026, 10, 26));
    assert!(app.save_block(&t.page, t.line, &t.text, &done).unwrap().ok);
    assert!(app.vault.tasks(false).is_empty());

    let tpls = app.vault.templates();
    assert_eq!(tpls.len(), 1);
    assert_eq!(tpls[0].name, "Daily");
    let blocks = app.template("daily", "October 26th, 2026", (2026, 10, 26), "09:15").unwrap();
    let texts: Vec<(usize, &str)> = blocks.iter().map(|b| (b.depth, b.text.as_str())).collect();
    assert_eq!(texts, vec![(0, "daily"), (1, "## Plan for [[Oct 26th, 2026]]"), (1, "logged at 09:15 on [[October 26th, 2026]]")]);

    assert_eq!(app.vault.prop_values("alias"), vec![("SB".to_string(), 1)]);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn names_nobody_links_to_disappear() {
    let mut vlt = Vault::new();
    vlt.upsert("pages/A.md", "- links [[Ghost]] and [[B]]\n");
    vlt.upsert("pages/B.md", "- b\n");
    let names = |v: &Vault| v.all_pages().into_iter().map(|p| (p.name, p.exists, p.refs)).collect::<Vec<_>>();
    assert_eq!(names(&vlt), vec![("A".into(), true, 0), ("B".into(), true, 1), ("Ghost".into(), false, 1)]);
    vlt.upsert("pages/A.md", "- no links now\n");
    assert_eq!(names(&vlt), vec![("A".into(), true, 0), ("B".into(), true, 0)]);
    assert!(vlt.search("ghost", 10).is_empty());
}

#[test]
fn rename_page_and_links() {
    let (v, mut app) = sample_vault("rename");
    let res = app.rename("sourdough bread", "Sourdough Loaf").unwrap();
    assert_eq!(res.files_changed, 2);
    assert!(v.join("pages/Sourdough Loaf.md").exists());
    assert!(!v.join("pages/Sourdough Bread.md").exists());
    // CRLF file stays CRLF; tag form kept
    assert_eq!(std::fs::read_to_string(v.join("journals/2026_10_25.md")).unwrap(), "- meeting about [[Sourdough Loaf]]\r\n- #[[Sourdough Loaf]] tag\r\n");
    assert_eq!(app.vault.linked_refs("sourdough loaf").len(), 2);
    assert!(app.vault.linked_refs("SB").len() == 2, "alias still works");
    // clash with an existing page is refused
    assert!(app.rename("Notes", "sourdough loaf").is_err());
    assert!(app.rename("Notes", "sb").is_err(), "alias names are taken too");
    // only the capitals change
    app.rename("Sourdough Loaf", "sourdough loaf").unwrap();
    let names: Vec<String> = std::fs::read_dir(v.join("pages")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(names.contains(&"sourdough loaf.md".to_string()), "{names:?}");
    assert!(std::fs::read_to_string(v.join("pages/Notes.md")).unwrap().contains("[[sourdough loaf]]"));
    // journals can't be renamed
    assert!(app.rename("Oct 25th, 2026", "x").is_err());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn delete_to_bin_and_restore() {
    let (v, mut app) = sample_vault("bin");
    assert_eq!(app.delete_pages(&["Notes".into(), "Templates".into(), "nonexistent".into()]).unwrap(), 2);
    assert!(!v.join("pages/Notes.md").exists());
    assert!(v.join("logseq/.recycle/pages_Notes.md").exists());
    assert!(!app.vault.page_info("Notes").exists);
    // deleting a page with the same name again keeps both copies in the bin
    std::fs::write(v.join("pages/Notes.md"), "- second\n").unwrap();
    app.rescan();
    app.delete_pages(&["Notes".into()]).unwrap();
    assert!(v.join("logseq/.recycle/pages_Notes (2).md").exists());
    let bin = app.recycled();
    assert_eq!(bin.len(), 3);
    assert!(bin.iter().any(|r| r.name == "Notes"));
    assert_eq!(app.restore("pages_Notes.md").unwrap(), "Notes");
    assert!(app.vault.page_info("Notes").exists);
    assert!(app.restore("pages_Notes (2).md").is_err(), "name taken");
    assert!(app.restore("../config.edn").is_err());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn capture_without_a_web_address_drops_the_joining_word() {
    use outline_core::capture::fill;
    let t = "[[quick capture]] **{time}**: {text} from {url}";
    assert_eq!(fill(t, "Shared text", "", "02:09", ""), "[[quick capture]] **02:09**: Shared text");
    assert_eq!(fill(t, "Shared text", "https://x.org", "02:09", ""), "[[quick capture]] **02:09**: Shared text from https://x.org");
    assert_eq!(fill("{text} via {url} at {time}", "a", "", "", ""), "a");
    assert_eq!(fill("{text} - {url}", "a", "", "", ""), "a");
    // only a whole word right before the empty value goes
    assert_eq!(fill("from {text}", "a", "", "", ""), "from a");
    assert_eq!(fill("{text} ceiling{url}", "a", "", "", ""), "a ceiling");
}

#[test]
fn capture_never_overwrites_a_file_it_could_not_read() {
    let (v, _app) = sample_vault("capture-unreadable");
    // today's journal exists but can't be read (here: a folder in its place, like a
    // cloud file that can't be fetched): nothing may be written over it
    let journal = v.join("journals/2026_10_27.md");
    std::fs::create_dir_all(&journal).unwrap();
    std::fs::write(journal.join("keep.md"), "- precious\n").unwrap();
    let err = capture::capture_to_vault(&v, "a capture", "", (2026, 10, 27), "09:00").unwrap_err();
    assert!(err.contains("Couldn't read"), "{err}");
    assert_eq!(std::fs::read_to_string(journal.join("keep.md")).unwrap(), "- precious\n");
    // an unreadable config.edn stops the capture too (instead of guessing the target)
    let cfg = v.join("logseq/config.edn");
    let saved = std::fs::read(&cfg).unwrap();
    std::fs::remove_file(&cfg).unwrap();
    std::fs::create_dir_all(&cfg).unwrap();
    let err = capture::capture_to_vault(&v, "a capture", "", (2026, 10, 28), "09:00").unwrap_err();
    assert!(err.contains("config.edn"), "{err}");
    assert!(!v.join("journals/2026_10_28.md").exists());
    std::fs::remove_dir_all(&cfg).unwrap();
    std::fs::write(&cfg, saved).unwrap();
}

#[test]
fn capture_follows_the_template() {
    let (v, mut app) = sample_vault("capture");
    let page = app.capture("Great article https://example.org/a?b=1 ", "", false, (2026, 10, 26), "14:05").unwrap();
    assert_eq!(page, "Oct 26th, 2026");
    assert_eq!(
        std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap(),
        "- **14:05** [[quick capture]]: #inbox Great article https://example.org/a?b=1\n"
    );
    app.capture("just text", "", false, (2026, 10, 26), "14:06").unwrap();
    assert!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap().ends_with("- **14:06** [[quick capture]]: #inbox just text\n"));
    // the Windows command does the same without loading the index
    capture::capture_to_vault(&v, "from the browser", "https://x.org", (2026, 10, 26), "15:00").unwrap();
    assert!(std::fs::read_to_string(v.join("journals/2026_10_26.md")).unwrap().ends_with("#inbox from the browser https://x.org\n"));
    // CRLF journals stay CRLF
    app.capture("crlf", "", false, (2026, 10, 25), "16:00").unwrap();
    assert!(std::fs::read_to_string(v.join("journals/2026_10_25.md")).unwrap().ends_with("tag\r\n- **16:00** [[quick capture]]: #inbox crlf\r\n"));
    // settings are written back to config.edn without disturbing the rest
    app.set_capture("{text} ({time})", "{url}", false, "Inbox").unwrap();
    let cfg = std::fs::read_to_string(v.join("logseq/config.edn")).unwrap();
    assert!(cfg.starts_with(";; my settings\n{:meta/version 1\n :preferred-workflow :todo"));
    assert!(cfg.contains(":quick-capture-templates {:text \"{text} ({time})\" :media \"{url}\"}"));
    // "Inbox" is already known as "inbox" (from the #inbox tags): names ignore case
    assert_eq!(app.capture("to the inbox page", "", false, (2026, 10, 26), "17:00").unwrap(), "inbox");
    assert_eq!(std::fs::read_to_string(v.join("pages/inbox.md")).unwrap(), "- to the inbox page (17:00)\n");
    let favs = app.set_favorite("Notes", true).unwrap();
    assert_eq!(favs, vec!["writing notebook", "to read", "Notes"]);
    assert_eq!(app.set_favorite("notes", false).unwrap(), vec!["writing notebook", "to read"]);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn assets_and_saves_keep_file_shape() {
    let (v, mut app) = sample_vault("assets");
    let link = app.save_asset("My Photo (1).PNG", "data:image/png;base64,iVBORw0KGgo=").unwrap();
    assert!(link.starts_with("../assets/My_Photo__1_") && link.ends_with(".png"), "{link}");
    let file = v.join(link.trim_start_matches("../"));
    assert_eq!(std::fs::read(&file).unwrap(), b"\x89PNG\r\n\x1a\n");
    assert!(app.asset_file(&link).is_some());
    assert!(app.asset_file("../../etc/passwd").is_none());
    assert!(app.asset_file("assets/../../x").is_none());

    // a file without a final line break, with a byte-order mark, keeps both when edited
    std::fs::write(v.join("pages/Bom.md"), "\u{feff}- one\n- two").unwrap();
    app.rescan();
    let pv = app.page("Bom", None);
    let mut doc = pv.doc;
    doc.blocks[1].text = "two edited".into();
    let res = dispatch(&mut Some(App::open(&v).unwrap()), "save", json!({"name": "Bom", "doc": doc, "base_hash": pv.hash})).unwrap();
    assert_eq!(res["ok"], json!(true));
    assert_eq!(std::fs::read_to_string(v.join("pages/Bom.md")).unwrap(), "\u{feff}- one\n- two edited");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn rescan_ignores_files_the_app_saved_meanwhile() {
    let (v, mut app) = sample_vault("race");
    let plan = app.scan_plan();
    // another program changes Notes; the app saves Templates in the meantime
    std::fs::write(v.join("pages/Notes.md"), "- changed outside\n").unwrap();
    let changes = app::collect_changes(plan);
    app.append_to("pages/Notes.md", "added by the app").unwrap();
    let changed = app.apply_changes(changes);
    assert!(!changed.contains(&"pages/Notes.md".to_string()), "the app's newer state wins");
    assert_eq!(app.vault.page_info("Notes").exists, true);
    assert_eq!(app.vault.search("added by the app", 5).len(), 1);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn every_new_command_survives_bad_input() {
    let (v, app) = sample_vault("cmds");
    let mut st = Some(app);
    let cmds = [
        "save_block", "tasks", "task_done", "unlinked", "link_mention", "rename", "delete", "recycled", "restore", "templates",
        "template", "save_asset", "set_favorite", "set_capture", "capture", "prop_values", "journal_dates", "errors", "page",
        "unlinked_any", "clash", "save_look", "reorder_favorites", "rename_target", "merge_pages", "undo_merge", "page_file", "link",
        "pages",
    ];
    for c in cmds {
        for args in [json!({}), json!({"name": 5, "line": "x", "names": "notalist", "data": "!!", "today": [2026, 13, 40]}), json!(null)] {
            let _ = dispatch(&mut st, c, args);
        }
    }
    assert!(!log::read().is_empty(), "errors are logged");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn edits_elsewhere_are_merged_not_lost() {
    let (v, mut app) = sample_vault("merge");
    std::fs::write(v.join("pages/Day.md"), "- one\n- two\n- three\n").unwrap();
    app.rescan();
    let pv = app.page("Day", None);
    let base = pv.doc.clone();
    // the phone adds a bullet at the end while the laptop edits the first one
    std::fs::write(v.join("pages/Day.md"), "- one\n- two\n- three\n- from the phone\n").unwrap();
    let mut mine = pv.doc.clone();
    mine.blocks[0].text = "one, edited".into();
    let req = json!({"name": "Day", "doc": mine, "base_hash": pv.hash, "base": base, "path": "pages/Day.md"});
    let mut st = Some(app);
    let res = dispatch(&mut st, "save", req).unwrap();
    assert_eq!(res["ok"], json!(true), "{res}");
    assert!(res["merged"].is_object());
    assert_eq!(std::fs::read_to_string(v.join("pages/Day.md")).unwrap(), "- one, edited\n- two\n- three\n- from the phone\n");

    // both change the same block: no guessing, the user decides
    let app = st.as_mut().unwrap();
    let pv = app.page("Day", None);
    std::fs::write(v.join("pages/Day.md"), "- one, from the phone\n- two\n- three\n- from the phone\n").unwrap();
    let mut mine = pv.doc.clone();
    mine.blocks[0].text = "one, from the laptop".into();
    let req = json!({"name": "Day", "doc": mine.clone(), "base_hash": pv.hash, "base": pv.doc});
    let res = dispatch(&mut st, "save", req).unwrap();
    assert_eq!(res["conflict"], json!(true));
    // "Keep mine" keeps a copy of the other version in logseq/bak
    let req = json!({"name": "Day", "doc": mine, "base_hash": pv.hash, "force": true});
    dispatch(&mut st, "save", req).unwrap();
    assert!(std::fs::read_to_string(v.join("pages/Day.md")).unwrap().starts_with("- one, from the laptop\n"));
    let bak: Vec<_> = std::fs::read_dir(v.join("logseq/bak/pages/Day")).unwrap().flatten().collect();
    assert_eq!(bak.len(), 1);
    assert!(std::fs::read_to_string(bak[0].path()).unwrap().starts_with("- one, from the phone\n"));
    // a save never goes to another file than the one opened
    let pv = st.as_ref().unwrap().page("Day", None);
    let res = dispatch(&mut st, "save", json!({"name": "Day", "doc": pv.doc, "base_hash": pv.hash, "path": "pages/Other.md"}));
    assert!(res.is_err());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn duplicate_names_never_swap_files() {
    let mut vlt = Vault::new();
    vlt.upsert("pages/Dup.md", "- I am pages/Dup.md\n");
    vlt.upsert("pages/zzz-dup.md", "title:: Dup\n- I am the other one\n");
    for _ in 0..3 {
        vlt.upsert("pages/Dup.md", "- I am pages/Dup.md, edited\n");
        assert_eq!(vlt.page_info("Dup").path.as_deref(), Some("pages/Dup.md"));
    }
    // the owner changes its title: the waiting file gets the name
    vlt.upsert("pages/Dup.md", "title:: Something else\n- now different\n");
    assert_eq!(vlt.page_info("Dup").path.as_deref(), Some("pages/zzz-dup.md"));
    assert_eq!(vlt.page_info("Something else").path.as_deref(), Some("pages/Dup.md"));
}

#[test]
fn unreadable_files_are_never_overwritten() {
    let (v, app) = sample_vault("unreadable");
    // a folder where a page file should be: reading fails with something other than "missing"
    std::fs::create_dir_all(v.join("pages/Blocked.md")).unwrap();
    let mut st = Some(app);
    let pv = dispatch(&mut st, "page", json!({"name": "Blocked"})).unwrap();
    assert_eq!(pv["readonly"], json!(true), "{pv}");
    assert!(pv["error"].is_string());
    let doc = json!({"preamble": "", "blocks": [{"depth": 0, "text": "a quick note"}], "indent": "\t", "crlf": false});
    assert!(dispatch(&mut st, "save", json!({"name": "Blocked", "doc": doc, "base_hash": ""})).is_err());
    assert!(st.as_mut().unwrap().append_to("pages/Blocked.md", "x").is_err());
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn new_pages_with_special_names() {
    let (v, app) = sample_vault("special");
    let mut st = Some(app);
    let doc = json!({"preamble": "", "blocks": [{"depth": 0, "text": "why not"}], "indent": "\t", "crlf": false});
    dispatch(&mut st, "save", json!({"name": "Why?", "doc": doc, "base_hash": ""})).unwrap();
    assert_eq!(std::fs::read_to_string(v.join("pages/Why%3F.md")).unwrap(), "- why not\n");
    assert!(st.as_ref().unwrap().vault.page_info("why?").exists);
    dispatch(&mut st, "save", json!({"name": "CON", "doc": doc, "base_hash": ""})).unwrap();
    assert_eq!(std::fs::read_to_string(v.join("pages/CON___.md")).unwrap(), "title:: CON\n- why not\n");
    assert!(st.as_ref().unwrap().vault.page_info("con").exists);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn edit_next_to_an_addition_is_merged() {
    use outline_core::merge::merge_docs;
    let base = split_doc("- one\n- two\n");
    let mut mine = base.clone();
    mine.blocks[1].text = "two, edited".into();
    let theirs = split_doc("- one\n- two\n- three from the phone\n");
    let m = merge_docs(&base, &mine, &theirs).expect("merges");
    assert_eq!(join_doc(&m), "- one\n- two, edited\n- three from the phone\n");
    // and the other way round
    let m = merge_docs(&base, &theirs, &mine).expect("merges");
    assert_eq!(join_doc(&m), "- one\n- two, edited\n- three from the phone\n");
    // both edit the same block: no merge
    let mut other = base.clone();
    other.blocks[1].text = "two, elsewhere".into();
    assert!(merge_docs(&base, &mine, &other).is_none());
}

#[test]
fn clashes_come_in_parts_to_choose_from() {
    use outline_core::merge::{clash_parts, Part};
    let base = split_doc("- one\n- two\n- three\n- four\n- five\n");
    // here: "two" and "four" edited; there: "two" and "four" edited differently, "five" removed, one added
    let mut mine = base.clone();
    mine.blocks[1].text = "two, here".into();
    mine.blocks[3].text = "four, here".into();
    let theirs = split_doc("- one\n- two, there\n- three\n- four, there\n- added there\n");
    let parts = clash_parts(&base.blocks, &mine.blocks, &theirs.blocks).expect("small enough");
    let texts = |v: &[DocBlock]| v.iter().map(|b| b.text.clone()).collect::<Vec<_>>().join("|");
    let shape: Vec<String> = parts.iter().map(|p| match p {
        Part::Same { blocks } => format!("same {}", texts(blocks)),
        Part::Clash { base, mine, theirs } => format!("clash {} / {} / {}", texts(base), texts(mine), texts(theirs)),
    }).collect();
    // "four" + "five" is one stretch (between notes nobody changed) where both changed "four": shown
    // whole, so the other copy's "added there" isn't paired with this device's untouched "five"
    assert_eq!(shape, [
        "same one",
        "clash two / two, here / two, there",
        "same three",
        "clash four|five / four, here|five / four, there|added there",
    ]);
    // choosing a side for each clash and joining the parts gives a page; untouched notes keep their lines
    let pick = |mine_side: bool| -> String { join_doc(&Doc { blocks: pick_parts(&parts, |_, _| mine_side), ..theirs.clone() }) };
    assert_eq!(pick(false), "- one\n- two, there\n- three\n- four, there\n- added there\n");
    assert_eq!(pick(true), "- one\n- two, here\n- three\n- four, here\n- five\n");
    // nothing clashing (next to each other, but different notes): one part, and saving merges it
    let mut other = base.clone();
    other.blocks[4].text = "five, edited".into();
    let parts = clash_parts(&base.blocks, &mine.blocks, &other.blocks).unwrap();
    assert!(matches!(&parts[..], [Part::Same { .. }]));
    let m = outline_core::merge::merge_docs(&base, &mine, &other).expect("merges");
    assert_eq!(join_doc(&m), "- one\n- two, here\n- three\n- four, here\n- five, edited\n");
}

/// The page from clash parts, picking this device's side of a clash when `mine(mine, theirs)` says so.
fn pick_parts(parts: &[outline_core::merge::Part], mine: impl Fn(&[DocBlock], &[DocBlock]) -> bool) -> Vec<DocBlock> {
    use outline_core::merge::Part;
    let mut out = vec![];
    for p in parts {
        match p {
            Part::Same { blocks } => out.extend(blocks.iter().cloned()),
            Part::Clash { mine: m, theirs: t, .. } => out.extend(if mine(m, t) { m } else { t }.iter().cloned()),
        }
    }
    out
}

#[test]
fn a_removed_note_next_to_an_added_one_is_never_paired_with_an_edit() {
    use outline_core::merge::{clash_parts, merge_docs, Part};
    // here "bravo" was edited; there "alpha" was removed and "november" added after "bravo"
    let base = split_doc("- alpha\n- bravo\n- charlie\n");
    let mine = split_doc("- alpha\n- bravo mine\n- charlie\n");
    let theirs = split_doc("- bravo\n- november\n- charlie\n");
    assert!(merge_docs(&base, &mine, &theirs).is_none());
    let parts = clash_parts(&base.blocks, &mine.blocks, &theirs.blocks).unwrap();
    let texts = |v: &[DocBlock]| v.iter().map(|b| b.text.as_str()).collect::<Vec<_>>().join("|");
    match &parts[0] {
        Part::Clash { base, mine, theirs } => assert_eq!((texts(base), texts(mine), texts(theirs)), ("alpha|bravo".into(), "alpha|bravo mine".into(), "bravo|november".into())),
        p => panic!("{p:?}"),
    }
    // either choice gives a page with each note once
    for side in [true, false] {
        let page = join_doc(&Doc { blocks: pick_parts(&parts, |_, _| side), ..theirs.clone() });
        assert_eq!(page, if side { "- alpha\n- bravo mine\n- charlie\n" } else { "- bravo\n- november\n- charlie\n" });
    }
}

#[test]
fn notes_added_at_the_same_place_on_both_sides_are_both_kept() {
    use outline_core::merge::{clash_parts, merge_docs, Part};
    let merged = |b: &str, m: &str, t: &str| merge_docs(&split_doc(b), &split_doc(m), &split_doc(t)).map(|d| join_doc(&d));
    // the end of today's journal: typed here while the phone's widget (or Claude) added one
    assert_eq!(
        merged("- morning\n", "- morning\n- typed on the laptop\n", "- morning\n- added from the phone widget\n").as_deref(),
        Some("- morning\n- typed on the laptop\n- added from the phone widget\n")
    );
    // a note under the last one here, a top-level one there: each keeps its parent, either way round
    assert_eq!(merged("- a\n", "- a\n\t- child here\n", "- a\n- top there\n").as_deref(), Some("- a\n\t- child here\n- top there\n"));
    assert_eq!(merged("- a\n", "- a\n- top here\n", "- a\n\t- child there\n").as_deref(), Some("- a\n\t- child there\n- top here\n"));
    assert_eq!(merged("- a\n- b\n", "- a\n\t- under a, here\n- b\n", "- a\n- new top there\n\t- its child\n- b\n").as_deref(), Some("- a\n\t- under a, here\n- new top there\n\t- its child\n- b\n"));
    // the same note on both sides is kept once
    assert_eq!(merged("- a\n", "- a\n- same\n", "- a\n- same\n- more there\n").as_deref(), Some("- a\n- same\n- more there\n"));
    assert_eq!(merged("- a\n", "- a\n- same\n- more here\n", "- a\n- same\n").as_deref(), Some("- a\n- same\n- more here\n"));
    // an empty page made on both sides (a journal template here, a note from the phone there)
    assert_eq!(merged("", "- ## Morning\n- typed\n", "- added from the phone widget\n").as_deref(), Some("- ## Morning\n- typed\n- added from the phone widget\n"));
    // no order keeps every parent: he chooses (shown with nothing before both changes)
    let (b, m, t) = (split_doc("- a\n"), split_doc("- a\n\t- child here\n- top here\n"), split_doc("- a\n\t- child there\n- top there\n"));
    assert!(merge_docs(&b, &m, &t).is_none());
    let parts = clash_parts(&b.blocks, &m.blocks, &t.blocks).unwrap();
    assert!(matches!(&parts[..], [Part::Same { .. }, Part::Clash { base, .. }] if base.is_empty()), "{parts:?}");
    // a note moved to the end here (not added) while one was added there: he chooses, so a note
    // moved on both sides can never come out twice
    assert!(merged("- a\n- x\n- b\n", "- a\n- b\n- x\n", "- a\n- x\n- b\n- y\n").is_none());
    // both moved the same note to the same place, one also edited it: never kept twice
    assert!(merged("- x\n- a\n", "- a\n- x\n", "- a\n- x, edited\n").is_none());
    assert!(merged("- x\n- a\n", "- a\n- x, here\n", "- a\n- x, there\n").is_none());
    // the notes after the place keep their parents: an added note shallower than the next note both
    // still have would take it (and its children) under itself, so he chooses
    assert_eq!(merged("- a\n\t- b\n", "- a\n\t- here\n\t- b\n", "- a\n\t- there\n\t- b\n").as_deref(), Some("- a\n\t- here\n\t- there\n\t- b\n"));
    assert!(merged("- a\n\t- b\n", "- a\n- here\n\t- b\n", "- a\n\t- there\n\t- b\n").is_none());
    assert!(merged("- a\n\t- b\n", "- a\n- here\n\t- b\n", "- a\n- there\n\t- b\n").is_none());
    // at the end of the page nothing follows: any depth
    assert_eq!(merged("- a\n\t- b\n", "- a\n\t- b\n- here\n", "- a\n\t- b\n\t- there\n").as_deref(), Some("- a\n\t- b\n\t- there\n- here\n"));
    // a note with the words of one the page already had, added on both sides: maybe two notes, maybe
    // one moved, so he chooses (even when both sides' look the same)
    assert!(merged("- TODO water plants\n- b\n", "- TODO water plants\n- b\n- TODO water plants\n", "- TODO water plants\n- b\n- TODO water plants\n- c\n").is_none());
}

#[test]
fn the_clash_command_reads_the_file_and_backups_never_overwrite() {
    let (v, mut app) = sample_vault("clash");
    std::fs::write(v.join("pages/Day.md"), "tags:: a\n\n- one\n- two\n").unwrap();
    app.rescan();
    let pv = app.page("Day", None);
    std::fs::write(v.join("pages/Day.md"), "tags:: b\n\n- one, there\n- two\n").unwrap();
    let mut mine = pv.doc.clone();
    mine.preamble = "tags:: c\n\n".into();
    mine.blocks[0].text = "one, here".into();
    let mut st = Some(app);
    let c = dispatch(&mut st, "clash", json!({"name": "Day", "doc": mine, "base": pv.doc})).unwrap();
    assert_eq!(c["hash"], json!(content_hash("tags:: b\n\n- one, there\n- two\n")));
    assert_eq!(c["preamble"], json!(["tags:: a\n\n", "tags:: c\n\n", "tags:: b\n\n"]));
    assert_eq!(c["parts"][0]["kind"], json!("clash"));
    assert_eq!(c["parts"][0]["theirs"][0]["text"], json!("one, there"));
    assert_eq!(c["parts"][1], json!({"kind": "same", "blocks": [{"depth": 0, "text": "two", "raw": "- two\n", "plain": false}]}));
    assert_eq!(c["theirs"]["blocks"][0]["text"], json!("one, there"));
    // like a save: never another file's version (the page was renamed, or the name moved on)
    let ok = dispatch(&mut st, "clash", json!({"name": "Day", "doc": mine, "base": pv.doc, "path": "pages/Day.md"}));
    assert!(ok.is_ok());
    let moved = dispatch(&mut st, "clash", json!({"name": "Day", "doc": mine, "base": pv.doc, "path": "pages/Other.md"}));
    assert!(moved.unwrap_err().contains("renamed or moved"));
    // two backups within the same second both stay
    for _ in 0..2 {
        dispatch(&mut st, "backup", json!({"name": "Day", "doc": mine})).unwrap();
    }
    let bak: Vec<_> = std::fs::read_dir(v.join("logseq/bak/pages/Day")).unwrap().flatten().collect();
    assert_eq!(bak.len(), 2);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn journal_days_are_the_days_with_something_written() {
    let v = tmp_vault("jdays");
    std::fs::write(v.join("journals/2026_10_20.md"), "- wrote something\n").unwrap();
    std::fs::write(v.join("journals/2026_10_21.md"), "-\n").unwrap();
    std::fs::write(v.join("journals/2026_10_22.md"), "").unwrap();
    std::fs::write(v.join("journals/2026_10_23.md"), "\t- a child\n").unwrap();
    let mut app = Some(App::open(&v).unwrap());
    let days = dispatch(&mut app, "journal_days", json!({})).unwrap();
    assert_eq!(days, json!([[2026, 10, 20], [2026, 10, 23]]));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_new_page_never_opens_or_saves_into_another_pages_file() {
    // pages/bar.md holds the page "Foo" (its title::); following [[bar]] makes the new page "bar"
    let (v, app) = sample_vault("newname");
    std::fs::write(v.join("pages/bar.md"), "title:: Foo\n- notes of Foo\n").unwrap();
    std::fs::write(v.join("pages/Links.md"), "- see [[bar]] and [[Qux]]\n").unwrap();
    std::fs::write(v.join("pages/QUX.md"), "title:: Other\n- other notes\n").unwrap();
    drop(app);
    let mut st = Some(App::open(&v).unwrap());
    let app = st.as_ref().unwrap();
    // opening it shows an empty new page, not Foo's notes
    let pv = app.page("bar", None);
    assert!(!pv.info.exists && pv.info.path.as_deref() == Some("pages/bar (2).md"), "{:?}", pv.info);
    assert!(pv.doc.blocks.is_empty() && pv.hash.is_empty(), "{:?}", pv.doc.blocks);
    // names that differ only in capitals are the same file on Windows and Android (the new page
    // is named as linked, "Qux")
    assert_eq!(app.vault.page_info("qux").path.as_deref(), Some("pages/Qux (2).md"));
    // its first save makes a file of its own, with title::; Foo stays as it was
    let mut doc = pv.doc.clone();
    doc.blocks.push(DocBlock { depth: 0, text: "first words of bar".into(), raw: None, plain: false });
    let path = pv.info.path.clone();
    let res = dispatch(&mut st, "save", json!({"name": "bar", "doc": doc, "base_hash": pv.hash, "path": path})).unwrap();
    assert_eq!(res["ok"], json!(true), "{res}");
    assert_eq!(std::fs::read_to_string(v.join("pages/bar (2).md")).unwrap(), "title:: bar\n- first words of bar\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/bar.md")).unwrap(), "title:: Foo\n- notes of Foo\n");
    let app = st.as_mut().unwrap();
    assert_eq!(app.vault.page_info("bar").path.as_deref(), Some("pages/bar (2).md"));
    assert_eq!(app.vault.page_info("Foo").path.as_deref(), Some("pages/bar.md"));
    // and it stays that page: the next save goes to the same file
    let pv = app.page("bar", None);
    let mut doc = pv.doc.clone();
    doc.blocks[0].text = "first words of bar, edited".into();
    let res = dispatch(&mut st, "save", json!({"name": "bar", "doc": doc, "base_hash": pv.hash, "path": pv.info.path})).unwrap();
    assert_eq!(res["ok"], json!(true), "{res}");
    assert_eq!(std::fs::read_to_string(v.join("pages/bar (2).md")).unwrap(), "title:: bar\n- first words of bar, edited\n");
    // a file that turns up at the new page's place before its first save: a clash, never overwritten
    let app = st.as_mut().unwrap();
    let pv = app.page("Fresh", None);
    std::fs::write(v.join("pages/Fresh.md"), "- written elsewhere meanwhile\n").unwrap();
    let mut doc = pv.doc.clone();
    doc.blocks.push(DocBlock { depth: 0, text: "mine".into(), raw: None, plain: false });
    let res = dispatch(&mut st, "save", json!({"name": "Fresh", "doc": doc, "base_hash": pv.hash, "path": pv.info.path})).unwrap();
    assert_eq!((res["ok"].clone(), res["conflict"].clone()), (json!(false), json!(true)), "{res}");
    assert_eq!(std::fs::read_to_string(v.join("pages/Fresh.md")).unwrap(), "- written elsewhere meanwhile\n");
    // renaming a page onto such a name: the next free file name, with title::
    std::fs::write(v.join("pages/baz.md"), "title:: Qux2\n- qux notes\n").unwrap();
    std::fs::write(v.join("pages/Thing.md"), "- a thing\n").unwrap();
    let app = st.as_mut().unwrap();
    app.rescan();
    assert_eq!(app.rename("Thing", "baz").unwrap().name, "baz");
    assert!(!v.join("pages/Thing.md").exists());
    assert_eq!(std::fs::read_to_string(v.join("pages/baz (2).md")).unwrap(), "title:: baz\n- a thing\n");
    assert_eq!(std::fs::read_to_string(v.join("pages/baz.md")).unwrap(), "title:: Qux2\n- qux notes\n");
    assert_eq!(app.vault.page_info("baz").path.as_deref(), Some("pages/baz (2).md"));
    // a rename that only changes capitals keeps its own file name
    assert_eq!(app.rename("baz", "Baz").unwrap().name, "Baz");
    assert!(app.vault.page_info("Baz").path.as_deref() == Some("pages/baz (2).md") || app.vault.page_info("Baz").path.as_deref() == Some("pages/Baz (2).md"), "{:?}", app.vault.page_info("Baz").path);
    // duplicate names keep their rule: the first file owns the name
    std::fs::write(v.join("pages/zz-bar.md"), "title:: bar\n- a stray copy\n").unwrap();
    app.rescan();
    assert_eq!(app.vault.page_info("bar").path.as_deref(), Some("pages/bar (2).md"));
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn the_file_name_check_follows_files_coming_and_going() {
    let mut vlt = Vault::new();
    vlt.upsert("pages/Note.md", "title:: Something else\n- x\n");
    assert_eq!(vlt.page_info("note").path.as_deref(), Some("pages/note (2).md"));
    vlt.upsert("pages/note (2).md", "title:: Third\n- y\n");
    assert_eq!(vlt.page_info("note").path.as_deref(), Some("pages/note (3).md"));
    vlt.remove("pages/Note.md");
    assert_eq!(vlt.page_info("note").path.as_deref(), Some("pages/note.md"), "the name's own file name is free again");
    // a file waiting for a taken name (a duplicate) still holds its file name
    vlt.upsert("pages/a.md", "title:: Dup\n- first\n");
    vlt.upsert("pages/b.md", "title:: Dup\n- second\n");
    assert_eq!(vlt.page_info("b").path.as_deref(), Some("pages/b (2).md"));
    vlt.remove("pages/a.md");
    assert_eq!(vlt.page_info("Dup").path.as_deref(), Some("pages/b.md"), "promoted");
    assert_eq!(vlt.page_info("b").path.as_deref(), Some("pages/b (2).md"));
    vlt.remove("pages/b.md");
    assert_eq!(vlt.page_info("b").path.as_deref(), Some("pages/b.md"));
}

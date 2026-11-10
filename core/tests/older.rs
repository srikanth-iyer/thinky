//! Build 43: where a picture nothing uses now was used before (app/older.rs): found in logseq/bak,
//! in a snapshot zip and in a git backup's history, with the note's words, the notes above it and
//! its page; the same note found twice shows once (the newest); nothing written anywhere.
use outline_core::app::backup::{backup_git, backup_zip};
use outline_core::app::{set_cache_dir, App};
use std::path::{Path, PathBuf};

fn tmp(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_older_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    std::fs::create_dir_all(&v).unwrap();
    v
}
fn put(v: &Path, rel: &str, text: &str) {
    let p = v.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}
fn git(dir: &Path, args: &[&str]) -> bool {
    std::process::Command::new("git").arg("-C").arg(dir).args(args).output().is_ok_and(|o| o.status.success())
}

#[test]
fn a_picture_found_in_older_copies() {
    let v = tmp("notes");
    put(&v, "logseq/config.edn", "{}");
    put(&v, "assets/image_1715295468768_0.png", "png");
    put(&v, "assets/My Photo.png", "png");
    put(&v, "pages/Trip.md", "- day one\n  - the beach\n");
    put(&v, "journals/2026_11_01.md", "- nothing here\n");
    // Logseq's backup of the page, from before the picture was taken out
    put(&v, "logseq/bak/pages/Trip/2026-05-31T10_00_00.000Z.Desktop.md", "- day one\n  - the beach\n    - ![shot](../assets/image_1715295468768_0.png)\n");
    // a page that's gone now, backed up by the app, mentioning the other picture URL-encoded
    put(&v, "logseq/bak/pages/Old ideas/2026-06-01_09_00_00.md", "tags:: idea\n\n- photo ![x](../assets/My%20Photo.png)\n");
    set_cache_dir(tmp("cache"));
    let app = App::open(&v).unwrap();

    let hits = app.picture_in_older(None, "assets/image_1715295468768_0.png", None).unwrap();
    assert_eq!(hits.len(), 1, "{hits:?}");
    let h = &hits[0];
    assert_eq!((h.from, h.which.as_str(), h.page.as_str(), h.rel.as_str(), h.exists), ("bak", "Logseq on a computer", "Trip", "pages/Trip.md", true));
    assert_eq!(h.path, vec!["day one", "the beach"]);
    assert!(h.note.contains("image_1715295468768_0.png"));
    assert_eq!(h.when, 1_780_221_600, "the time in Logseq's backup name");

    let hits = app.picture_in_older(None, "assets/My Photo.png", None).unwrap();
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!((hits[0].page.as_str(), hits[0].exists, hits[0].which.as_str()), ("Old ideas", false, "thinky"));

    // a picture no copy mentions: nothing
    assert!(app.picture_in_older(None, "assets/never.png", None).unwrap().is_empty());

    // a snapshot zip holding the page as it was then
    put(&v, "pages/Trip.md", "- day one\n  - ![shot](../assets/image_1715295468768_0.png)\n");
    let dest = tmp("zips");
    assert_eq!(backup_zip(&v, &dest, 3, "2026-11-06-2130").status, "saved");
    put(&v, "pages/Trip.md", "- day one\n");
    let hits = app.picture_in_older(None, "assets/image_1715295468768_0.png", Some(("zip", dest.to_str().unwrap()))).unwrap();
    assert_eq!(hits.len(), 1, "the same note in the old backup and the zip shows once: {hits:?}");
    assert_eq!((hits[0].from, hits[0].path.clone()), ("zip", vec!["day one".to_string()]), "the newest copy's (the zip's)");
    assert!(hits[0].which.starts_with("thinky-backup-"));

    // a git backup: the commit that took the picture out still has it in its parent
    if git(&std::env::temp_dir(), &["--version"]) {
        let remote = tmp("remote");
        let repo = tmp("repo");
        assert!(git(&remote, &["init", "-q", "--bare", "-b", "main"]));
        let _ = std::fs::remove_dir_all(&repo);
        assert!(git(&std::env::temp_dir(), &["clone", "-q", remote.to_str().unwrap(), repo.to_str().unwrap()]));
        for (k, val) in [("user.name", "Test"), ("user.email", "test@example.com"), ("commit.gpgsign", "false")] {
            git(&repo, &["config", k, val]);
        }
        put(&v, "journals/2026_11_01.md", "- a [[Trip]] note\n  - ![s](../assets/image_1715295468768_0.png)\n");
        assert_eq!(backup_git(&v, &repo, false, "one").status, "saved");
        put(&v, "journals/2026_11_01.md", "- a [[Trip]] note\n");
        assert_eq!(backup_git(&v, &repo, false, "two").status, "saved");
        let hits = app.picture_in_older(None, "assets/image_1715295468768_0.png", Some(("git", repo.to_str().unwrap()))).unwrap();
        let g: Vec<_> = hits.iter().filter(|h| h.from == "git").collect();
        assert_eq!(g.len(), 1, "{hits:?}");
        assert_eq!((g[0].rel.as_str(), g[0].path.clone()), ("journals/2026_11_01.md", vec!["a [[Trip]] note".to_string()]));
        assert_eq!(g[0].which.len(), 7, "a short commit name");
        for d in [&remote, &repo] {
            let _ = std::fs::remove_dir_all(d);
        }
    }
    // read only: the bak files are as they were
    assert!(v.join("logseq/bak/pages/Trip/2026-05-31T10_00_00.000Z.Desktop.md").is_file());
    for d in [&v, &dest] {
        let _ = std::fs::remove_dir_all(d);
    }
}

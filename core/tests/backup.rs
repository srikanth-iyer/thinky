//! Build 37: backups (app/backup.rs): a snapshot zip, or a git repository; only when something
//! changed; never from a folder that doesn't look like the notes, never into it; a warning when many
//! files vanished; a missing file found in the backups and put back, never over a file.
use outline_core::app::backup::{backup_files, backup_git, backup_zip, find_in_backup, read_from_zip};
use outline_core::app::{set_cache_dir, App};
use std::path::{Path, PathBuf};

fn tmp(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("outline_backup_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    std::fs::create_dir_all(&v).unwrap();
    v
}
fn put(v: &Path, rel: &str, bytes: &[u8]) {
    let p = v.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}
fn notes(tag: &str) -> PathBuf {
    let v = tmp(tag);
    put(&v, "pages/a.md", b"- a\n");
    put(&v, "journals/2026_11_06.md", b"- today\n");
    put(&v, "assets/pic (1).png", b"\x89PNG fake");
    put(&v, "logseq/config.edn", b"{}");
    put(&v, "logseq/bak/pages/a/old.md", b"- an old copy");
    put(&v, "logseq/.recycle/pages_gone.md", b"- binned");
    put(&v, ".git/HEAD", b"ref: refs/heads/main");
    put(&v, "desktop.ini", b"[.ShellClassInfo]");
    put(&v, "pages/x.tmp", b"temp");
    v
}

#[test]
fn what_a_backup_holds() {
    let v = notes("holds");
    let files: Vec<String> = backup_files(&v).into_keys().collect();
    assert_eq!(files, vec!["assets/pic (1).png", "journals/2026_11_06.md", "logseq/config.edn", "pages/a.md"]);
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn snapshot_zips() {
    let v = notes("zip");
    let dest = tmp("zip_dest");
    let r = backup_zip(&v, &dest, 2, "2026-11-06-2130");
    assert_eq!(r.status, "saved", "{r:?}");
    assert_eq!(r.made.as_deref(), Some("thinky-backup-2026-11-06-2130.zip"));
    let zip = dest.join("thinky-backup-2026-11-06-2130.zip");
    assert_eq!(read_from_zip(&zip, "pages/a.md").as_deref(), Some(&b"- a\n"[..]));
    assert_eq!(read_from_zip(&zip, "assets/pic (1).png").as_deref(), Some(&b"\x89PNG fake"[..]));
    assert!(read_from_zip(&zip, "logseq/bak/pages/a/old.md").is_none() && read_from_zip(&zip, ".git/HEAD").is_none());
    // nothing changed: no new zip
    let r = backup_zip(&v, &dest, 2, "2026-11-06-2131");
    assert_eq!(r.status, "nochange", "{r:?}");
    // a change: a new zip; only the last two kept
    put(&v, "pages/b.md", b"- b\n");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    assert_eq!(backup_zip(&v, &dest, 2, "2026-11-07-0900").status, "saved");
    put(&v, "pages/c.md", b"- c\n");
    assert_eq!(backup_zip(&v, &dest, 2, "2026-11-08-0900").status, "saved");
    let mut zips: Vec<String> = std::fs::read_dir(&dest).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".zip")).collect();
    zips.sort();
    assert_eq!(zips, vec!["thinky-backup-2026-11-07-0900.zip", "thinky-backup-2026-11-08-0900.zip"]);
    // the same minute twice: a second name, never over the first
    put(&v, "pages/d.md", b"- d\n");
    assert_eq!(backup_zip(&v, &dest, 5, "2026-11-08-0900").made.as_deref(), Some("thinky-backup-2026-11-08-0900-2.zip"));
    // finding a file: the newest zip that has it
    assert_eq!(find_in_backup("zip", &dest, "pages/c.md").as_deref(), Some("thinky-backup-2026-11-08-0900-2.zip"));
    assert_eq!(find_in_backup("zip", &dest, "pages/never.md"), None);
    // many files gone: a warning (they're in the earlier zips)
    for k in 0..25 {
        put(&v, &format!("pages/p{k}.md"), b"- p\n");
    }
    backup_zip(&v, &dest, 5, "2026-11-09-0900");
    for k in 0..25 {
        std::fs::remove_file(v.join(format!("pages/p{k}.md"))).unwrap();
    }
    let r = backup_zip(&v, &dest, 5, "2026-11-10-0900");
    assert_eq!((r.status.as_str(), r.deleted), ("saved", 25));
    assert!(r.warning.is_some_and(|w| w.contains("25 files are gone")));
    let _ = std::fs::remove_dir_all(&v);
    let _ = std::fs::remove_dir_all(&dest);
}

#[test]
fn never_from_an_empty_folder_nor_into_the_notes() {
    let v = notes("safe");
    let r = backup_zip(&v, &v.join("backups"), 3, "x");
    assert!(r.status == "failed" && r.message.contains("outside your notes folder"), "{r:?}");
    let r = backup_zip(&v, Path::new("relative/dir"), 3, "x");
    assert_eq!(r.status, "failed");
    let r = backup_zip(&v, Path::new(""), 3, "x");
    assert_eq!(r.status, "failed");
    // the folder has no notes just now (Drive not running): nothing written
    let empty = tmp("safe_empty");
    let dest = tmp("safe_dest");
    let r = backup_zip(&empty, &dest, 3, "x");
    assert!(r.status == "failed" && r.message.contains("no notes"), "{r:?}");
    assert_eq!(std::fs::read_dir(&dest).unwrap().count(), 0);
    for d in [&v, &empty, &dest] {
        let _ = std::fs::remove_dir_all(d);
    }
}

fn git(dir: &Path, args: &[&str]) -> bool {
    std::process::Command::new("git").arg("-C").arg(dir).args(args).output().map(|o| o.status.success()).unwrap_or(false)
}

#[test]
fn git_backups() {
    if !git(&std::env::temp_dir(), &["--version"]) {
        eprintln!("no git here: skipped");
        return;
    }
    let v = notes("git");
    let remote = tmp("git_remote");
    let repo = tmp("git_repo");
    assert!(git(&remote, &["init", "-q", "--bare", "-b", "main"]));
    let _ = std::fs::remove_dir_all(&repo);
    assert!(git(&std::env::temp_dir(), &["clone", "-q", remote.to_str().unwrap(), repo.to_str().unwrap()]));
    for (k, val) in [("user.name", "Test"), ("user.email", "test@example.com"), ("commit.gpgsign", "false")] {
        git(&repo, &["config", k, val]);
    }
    // not a repository: said plainly
    let plain = tmp("git_plain");
    assert!(backup_git(&v, &plain, true, "s").message.contains("isn't a git repository"));
    let r = backup_git(&v, &repo, true, "2026-11-06 21:30");
    assert_eq!(r.status, "saved", "{r:?}");
    assert!(r.message.starts_with("Backup 2026-11-06 21:30 (4 changed, 0 deleted)"), "{r:?}");
    assert!(git(&remote, &["cat-file", "-e", "main:pages/a.md"]), "pushed");
    assert!(!repo.join("logseq/bak").exists());
    assert_eq!(backup_git(&v, &repo, true, "again").status, "nochange");
    // a file removed: the snapshot says so; it can be found and put back
    std::fs::remove_file(v.join("assets/pic (1).png")).unwrap();
    let r = backup_git(&v, &repo, true, "later");
    assert_eq!((r.status.as_str(), r.deleted), ("saved", 1), "{r:?}");
    assert!(find_in_backup("git", &repo, "assets/pic (1).png").is_some());
    set_cache_dir(tmp("git_cache"));
    let app = App::open(&v).unwrap();
    let from = app.restore_from_backup("git", repo.to_str().unwrap(), "assets/pic (1).png").unwrap();
    assert!(!from.is_empty());
    assert_eq!(std::fs::read(v.join("assets/pic (1).png")).unwrap(), b"\x89PNG fake");
    // never over a file that is there, never outside the folder
    assert!(app.restore_from_backup("git", repo.to_str().unwrap(), "assets/pic (1).png").unwrap_err().contains("there already"));
    assert!(app.restore_from_backup("git", repo.to_str().unwrap(), "../x").is_err());
    for d in [&v, &remote, &repo, &plain] {
        let _ = std::fs::remove_dir_all(d);
    }
}

#[test]
fn restore_from_a_zip() {
    let v = notes("rzip");
    let dest = tmp("rzip_dest");
    assert_eq!(backup_zip(&v, &dest, 3, "2026-11-06-2130").status, "saved");
    std::fs::remove_file(v.join("assets/pic (1).png")).unwrap();
    set_cache_dir(tmp("rzip_cache"));
    let app = App::open(&v).unwrap();
    assert_eq!(app.restore_from_backup("zip", dest.to_str().unwrap(), "assets/pic (1).png").unwrap(), "thinky-backup-2026-11-06-2130.zip");
    assert_eq!(std::fs::read(v.join("assets/pic (1).png")).unwrap(), b"\x89PNG fake");
    assert!(app.restore_from_backup("zip", dest.to_str().unwrap(), "pages/never.md").unwrap_err().contains("isn't in your backups"));
    let _ = std::fs::remove_dir_all(&v);
    let _ = std::fs::remove_dir_all(&dest);
}

#[test]
#[ignore] // (run by hand: leaves a zip to check with another program)
fn leave_a_zip_to_check() {
    let v = notes("check");
    let dest = std::env::temp_dir().join("outline_backup_check_dest");
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::create_dir_all(&dest).unwrap();
    put(&v, "pages/ünïcödé ✦.md", "- words\n".as_bytes());
    assert_eq!(backup_zip(&v, &dest, 3, "2026-11-06-2130").status, "saved");
}

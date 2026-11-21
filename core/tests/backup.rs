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

// ---------------------------------------------------------------- the outside review (Nov 2026)

use outline_core::app::backup::{backup_zip_of, holds, mirror, real_path, repo_own, write_zip, zip_files};
use std::collections::BTreeMap;

#[test]
fn safety_copies_are_left_out() {
    let v = notes("safety");
    put(&v, "logseq/.safety-laptop-1234/abc.copy", b"a big safety copy");
    put(&v, "logseq/.safety-phone/def.copy", b"another");
    put(&v, "logseq/.safetynet/keep.md", b"- not ours, kept");
    put(&v, "pages/.safety-x/keep.md", b"- only logseq/.safety-* is left out");
    put(&v, "LOGSEQ/.SAFETY-old/x.copy", b"capitals too (Windows)");
    let files: Vec<String> = backup_files(&v).into_keys().collect();
    assert!(!files.iter().any(|f| f.to_ascii_lowercase().starts_with("logseq/.safety-")), "{files:?}");
    assert!(files.contains(&"logseq/.safetynet/keep.md".to_string()) && files.contains(&"pages/.safety-x/keep.md".to_string()), "{files:?}");
    let _ = std::fs::remove_dir_all(&v);
}

#[test]
fn a_backup_folder_inside_the_notes_is_refused_however_it_is_written() {
    // the notes folder reached through a link, the backup folder not made yet: before, one side was
    // the real path and the other not, so it looked "outside"
    let real = notes("place_real");
    let link = std::env::temp_dir().join(format!("outline_backup_place_link_{}", std::process::id()));
    let _ = std::fs::remove_file(&link);
    #[cfg(unix)]
    std::os::unix::fs::symlink(&real, &link).unwrap();
    #[cfg(unix)]
    for (root, dest) in [(&link, real.join("backups/new")), (&real, link.join("backups/new")), (&link, link.join("a/b/c")), (&real, real.clone())] {
        let r = backup_zip(root, &dest, 3, "x");
        assert!(r.status == "failed" && r.message.contains("outside your notes folder"), "{root:?} {dest:?}: {r:?}");
        assert!(!dest.exists() || dest == real, "nothing made: {dest:?}");
    }
    // the notes folder inside the backup folder
    let parent = real.parent().unwrap().to_path_buf();
    assert!(backup_zip(&real, &parent, 3, "x").status == "failed");
    // a folder next to it whose name only starts the same is fine
    let next = PathBuf::from(format!("{}-backups", real.display()));
    let _ = std::fs::remove_dir_all(&next);
    assert_eq!(backup_zip(&real, &next, 3, "x").status, "saved");
    for d in [&real, &next] {
        let _ = std::fs::remove_dir_all(d);
    }
    let _ = std::fs::remove_file(&link);
}

#[test]
fn holds_compares_part_by_part_and_in_any_capitals_on_windows() {
    let p = |s: &str| PathBuf::from(s);
    assert!(holds(&p("/vault"), &p("/vault"), false));
    assert!(holds(&p("/vault"), &p("/vault/backups"), false));
    assert!(holds(&p("/vault/"), &p("/vault/./backups/x"), false));
    assert!(!holds(&p("/vault"), &p("/vault-backups"), false), "a name that only starts the same");
    assert!(!holds(&p("/vault/backups"), &p("/vault"), false));
    assert!(!holds(&p("/Vault"), &p("/vault/backups"), false), "Linux: capitals matter");
    assert!(holds(&p("/Users/Me/Notes"), &p("/users/me/notes/Backups"), true), "Windows: they don't");
    assert!(!holds(&p("/Users/Me/Notes"), &p("/users/me/notes2"), true));
    // real_path: the part that is there made real, the rest kept
    let t = tmp("realpath");
    let made = real_path(&t.join("not/made/yet"));
    assert_eq!(made, t.canonicalize().unwrap().join("not/made/yet"));
    assert_eq!(real_path(&t), t.canonicalize().unwrap());
    let _ = std::fs::remove_dir_all(&t);
}

#[test]
fn a_file_that_cant_be_read_isnt_counted_as_backed_up() {
    let v = notes("unread");
    let dest = tmp("unread_dest");
    let mut files = backup_files(&v);
    // a file listed, then gone (or held by another program) when the zip is written
    files.insert("pages/held.md".into(), (v.join("pages/held.md"), 10, 1_700_000_000));
    let r = backup_zip_of(&v, &dest, 5, "2026-11-20-1000", files.clone());
    assert_eq!(r.status, "saved", "{r:?}");
    assert!(r.message.contains("pages/held.md") && r.message.contains("tries it again"), "{r:?}");
    let zip = dest.join(r.made.unwrap());
    assert!(read_from_zip(&zip, "pages/held.md").is_none());
    assert_eq!(read_from_zip(&zip, "pages/a.md").as_deref(), Some(&b"- a\n"[..]));
    // the same list again: not "nothing changed" (that file isn't in any backup yet)
    let r = backup_zip_of(&v, &dest, 5, "2026-11-20-1001", files.clone());
    assert_eq!(r.status, "saved", "{r:?}");
    // once it can be read, it goes in, and after that nothing changed
    put(&v, "pages/held.md", b"- held\n");
    let r = backup_zip(&v, &dest, 5, "2026-11-20-1002");
    assert_eq!(r.status, "saved", "{r:?}");
    assert_eq!(read_from_zip(&dest.join(r.made.unwrap()), "pages/held.md").as_deref(), Some(&b"- held\n"[..]));
    assert_eq!(backup_zip(&v, &dest, 5, "2026-11-20-1003").status, "nochange");
    // several at once are counted
    let mut files = backup_files(&v);
    for k in 0..3 {
        files.insert(format!("pages/gone{k}.md"), (v.join(format!("pages/gone{k}.md")), 1, 1));
    }
    let r = backup_zip_of(&v, &dest, 5, "2026-11-20-1004", files);
    assert!(r.message.contains("3 files couldn't be read"), "{r:?}");
    // write_zip itself names them
    let z = dest.join("direct.zip");
    let mut files = BTreeMap::new();
    files.insert("a.md".to_string(), (v.join("pages/a.md"), 4, 0));
    files.insert("b.md".to_string(), (v.join("nope.md"), 4, 0));
    assert_eq!(write_zip(&z, &files).unwrap(), vec!["b.md".to_string()]);
    assert_eq!(zip_files(&z, |_| true).len(), 1);
    let _ = std::fs::remove_dir_all(&v);
    let _ = std::fs::remove_dir_all(&dest);
}

/// A good zip of three files, as bytes.
fn good_zip(tag: &str) -> Vec<u8> {
    let v = tmp(tag);
    put(&v, "a.md", b"- alpha\n");
    put(&v, "b.md", b"- bravo bravo\n");
    put(&v, "sub/c.png", b"\x89PNG data");
    let z = tmp(&format!("{tag}_z")).join("t.zip");
    write_zip(&z, &backup_files(&v)).unwrap();
    let bytes = std::fs::read(&z).unwrap();
    let _ = std::fs::remove_dir_all(&v);
    let _ = std::fs::remove_dir_all(z.parent().unwrap());
    bytes
}

fn read_bytes(tag: &str, bytes: &[u8]) -> std::thread::Result<Vec<(String, Vec<u8>)>> {
    let d = tmp(tag);
    let z = d.join("x.zip");
    std::fs::write(&z, bytes).unwrap();
    let r = std::panic::catch_unwind(|| zip_files(&z, |_| true));
    let _ = std::fs::remove_dir_all(&d);
    r
}

#[test]
fn a_damaged_or_made_up_zip_never_panics_or_reads_past_its_end() {
    let good = good_zip("zgood");
    let all = read_bytes("zall", &good).unwrap();
    assert_eq!(all.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(), vec!["a.md", "b.md", "sub/c.png"]);
    // the review's case: an end-record signature within the last 19 bytes
    let mut v = vec![b'x'; 100];
    v.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0]);
    assert!(read_bytes("zshort", &v).unwrap().is_empty());
    for k in 0..22 {
        let mut v = vec![b'x'; 50];
        v.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06]);
        v.extend(std::iter::repeat_n(0u8, k));
        assert!(read_bytes("zshort2", &v).is_ok(), "{k} bytes after the signature");
    }
    // the end record pointing past the file: a list 4 GB long, or far away
    let eocd = good.len() - 22;
    for (at, val) in [(12usize, u32::MAX), (16, u32::MAX), (16, good.len() as u32), (12, good.len() as u32)] {
        let mut v = good.clone();
        v[eocd + at..eocd + at + 4].copy_from_slice(&val.to_le_bytes());
        assert!(read_bytes("zeocd", &v).unwrap().is_empty(), "end record field {at} = {val}");
    }
    // an entry claiming 4 GB of bytes, or bytes past the end, or a header elsewhere: what was read before stays
    let cd_off = u32::from_le_bytes(good[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
    for (at, val) in [(20usize, u32::MAX), (42, u32::MAX), (42, good.len() as u32 - 10), (42, 1)] {
        let mut v = good.clone();
        v[cd_off + at..cd_off + at + 4].copy_from_slice(&val.to_le_bytes());
        let got = read_bytes("zentry", &v).unwrap();
        assert!(got.is_empty(), "first entry field {at} = {val}: {got:?}");
    }
    // every shorter copy, and every single byte changed: never a panic
    for n in 0..good.len() {
        assert!(read_bytes("ztrunc", &good[..n]).is_ok(), "cut at {n}");
    }
    let d = tmp("zflip");
    let z = d.join("x.zip");
    for i in 0..good.len() {
        for val in [0u8, 0xff] {
            let mut v = good.clone();
            v[i] = val;
            std::fs::write(&z, &v).unwrap();
            let r = std::panic::catch_unwind(|| zip_files(&z, |_| true));
            assert!(r.is_ok(), "byte {i} = {val}");
        }
    }
    let _ = std::fs::remove_dir_all(&d);
    // not a zip at all, or empty
    assert!(read_bytes("zempty", b"").unwrap().is_empty());
    assert!(read_bytes("zjunk", b"PK\x05\x06").unwrap().is_empty());
}

#[test]
fn a_bad_zip_in_the_backup_folder_doesnt_stop_the_search() {
    let v = notes("badzip");
    put(&v, "pages/Trip.md", b"- ![p](../assets/pic (1).png)\n");
    let dest = tmp("badzip_dest");
    assert_eq!(backup_zip(&v, &dest, 5, "2026-11-01-0900").status, "saved");
    // a newer "backup" that is damaged (half copied by a sync program)
    let mut v2 = vec![b'x'; 40];
    v2.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0xff, 0xff]);
    std::fs::write(dest.join("thinky-backup-2026-11-02-0900.zip"), &v2).unwrap();
    put(&v, "pages/Trip.md", b"- nothing now\n");
    set_cache_dir(tmp("badzip_cache"));
    let app = App::open(&v).unwrap();
    let hits = app.picture_in_older(None, "assets/pic (1).png", Some(("zip", dest.to_str().unwrap()))).unwrap();
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0].which, "thinky-backup-2026-11-01-0900.zip");
    assert_eq!(find_in_backup("zip", &dest, "pages/a.md").as_deref(), Some("thinky-backup-2026-11-01-0900.zip"));
    let _ = std::fs::remove_dir_all(&v);
    let _ = std::fs::remove_dir_all(&dest);
}

#[test]
fn the_backup_repository_keeps_its_own_files() {
    let v = notes("mirror");
    let repo = tmp("mirror_repo");
    put(&repo, ".git/HEAD", b"ref: refs/heads/main");
    put(&repo, ".gitignore", b"*.tmp\n");
    put(&repo, ".gitattributes", b"* -text\n");
    put(&repo, "README.md", b"# my notes backup\n");
    put(&repo, "readme.txt", b"also kept\n");
    put(&repo, ".github/workflows/x.yml", b"on: push\n");
    put(&repo, "pages/old.md", b"- gone from the notes\n");
    put(&repo, "pages/README.md", b"- a page called README, gone from the notes\n");
    let files = backup_files(&v);
    let (copied, unread) = mirror(&files, &repo).unwrap();
    assert_eq!((copied, unread.len()), (files.len(), 0));
    for kept in [".gitignore", ".gitattributes", "README.md", "readme.txt", ".github/workflows/x.yml"] {
        assert!(repo.join(kept).is_file(), "{kept} kept");
    }
    assert!(!repo.join("pages/old.md").exists() && !repo.join("pages/README.md").exists(), "notes gone are removed");
    for rel in files.keys() {
        assert_eq!(std::fs::read(v.join(rel)).unwrap(), std::fs::read(repo.join(rel)).unwrap(), "{rel}");
    }
    assert!(repo_own("README") && repo_own("Readme.MD") && repo_own(".github/x") && repo_own(".gitignore"));
    assert!(!repo_own("pages/readme.md") && !repo_own("pages/.gitignore") && !repo_own("github/x") && !repo_own("notes.md"));
    // nothing changed: nothing copied (same size and time); a changed file is copied, even at the same size
    assert_eq!(mirror(&backup_files(&v), &repo).unwrap().0, 0);
    std::thread::sleep(std::time::Duration::from_millis(20));
    put(&v, "pages/a.md", b"- A\n");
    assert_eq!(mirror(&backup_files(&v), &repo).unwrap().0, 1);
    assert_eq!(std::fs::read(repo.join("pages/a.md")).unwrap(), b"- A\n");
    // a copy with another time but the same bytes: compared, not copied again
    let f = std::fs::File::options().write(true).open(repo.join("pages/a.md")).unwrap();
    f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(5000)).unwrap();
    drop(f);
    assert_eq!(mirror(&backup_files(&v), &repo).unwrap().0, 0);
    // a file that can't be read just now: its earlier copy stays (never "the same" as a missing file)
    let mut files = backup_files(&v);
    files.insert("pages/held.md".into(), (v.join("pages/held.md"), 3, 1));
    put(&repo, "pages/held.md", b"- the copy from last time\n");
    let (_, unread) = mirror(&files, &repo).unwrap();
    assert_eq!(unread, vec!["pages/held.md".to_string()]);
    assert_eq!(std::fs::read(repo.join("pages/held.md")).unwrap(), b"- the copy from last time\n");
    let _ = std::fs::remove_dir_all(&v);
    let _ = std::fs::remove_dir_all(&repo);
}

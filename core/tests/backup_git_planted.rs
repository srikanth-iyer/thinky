//! Review claim 3 (Nov 22, 2026): files planted in the synced notes folder must never make the git
//! backup run a command, stop it, or take over the backup repository. Before the fix, a `sub/.git`
//! FILE ("gitdir: ../gd") pointing at a git folder with `core.fsmonitor` or a clean filter ran its
//! command during the backup; a `.git` file at the top made every backup fail; a `.gitignore` of `*`
//! silently kept new notes out. Each case has its own notes folder, backup repo and marker file.
use outline_core::app::backup::backup_git;
use std::path::{Path, PathBuf};

fn tmp(tag: &str) -> PathBuf {
    let v = std::env::temp_dir().join(format!("planted_git_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&v);
    std::fs::create_dir_all(&v).unwrap();
    v
}
fn put(v: &Path, rel: &str, bytes: &[u8]) {
    let p = v.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}
fn git(dir: &Path, args: &[&str]) -> bool {
    std::process::Command::new("git").arg("-C").arg(dir).args(args).output().map(|o| o.status.success()).unwrap_or(false)
}
fn ident(r: &Path) {
    for (k, val) in [("user.name", "T"), ("user.email", "t@example.com"), ("commit.gpgsign", "false")] {
        git(r, &["config", k, val]);
    }
}
/// The user's backup repo (a clone with one commit), outside the notes folder.
fn backup_repo(tag: &str) -> PathBuf {
    let repo = tmp(&format!("{tag}_repo"));
    assert!(git(&repo, &["init", "-q", "-b", "main"]));
    ident(&repo);
    put(&repo, "README.md", b"backup\n");
    assert!(git(&repo, &["add", "-A"]) && git(&repo, &["commit", "-q", "-m", "init"]));
    repo
}
/// An attacker's git dir (plain files, as sync would deliver them) at `notes/<at>`, with one commit
/// of `f.md` (also put in the work tree `notes/<wt>`), and `extra` config lines.
fn attacker_gitdir(notes: &Path, at: &str, wt: &str, extra: &str) {
    let src = tmp(&format!("src_{}_{}", notes.file_name().unwrap().to_string_lossy(), at.replace('/', "_")));
    assert!(git(&src, &["init", "-q", "-b", "main"]));
    ident(&src);
    put(&src, "f.md", b"- x\n");
    assert!(git(&src, &["add", "-A"]) && git(&src, &["commit", "-q", "-m", "c"]));
    // copy src/.git/* as plain files into notes/<at>
    let gd = src.join(".git");
    let mut stack = vec![gd.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                let rel = p.strip_prefix(&gd).unwrap().to_string_lossy().replace('\\', "/");
                put(notes, &format!("{at}/{rel}"), &std::fs::read(&p).unwrap());
            }
        }
    }
    let cfg = std::fs::read_to_string(notes.join(at).join("config")).unwrap();
    put(notes, &format!("{at}/config"), format!("{cfg}{extra}").as_bytes());
    put(notes, &format!("{wt}/f.md"), b"- x\n");
    let _ = std::fs::remove_dir_all(&src);
}
fn base_notes(tag: &str) -> PathBuf {
    let v = tmp(tag);
    put(&v, "pages/a.md", b"- a\n");
    v
}
fn run(tag: &str, v: &Path, marker: &Path) -> (String, bool) {
    let repo = backup_repo(tag);
    let r = backup_git(v, &repo, false, "s");
    let hit = marker.exists();
    let _ = std::fs::remove_dir_all(&repo);
    (r.status, hit)
}


fn has_git() -> bool {
    std::process::Command::new("git").arg("--version").output().is_ok_and(|o| o.status.success())
}
fn marker(tag: &str) -> PathBuf {
    let m = std::env::temp_dir().join(format!("planted_git_marker_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_file(&m);
    m
}
fn fsmon(m: &Path) -> String {
    format!("[core]\n\tfsmonitor = \"touch {}\"\n", m.display())
}
/// A backup that ran and either saved or found nothing new (not "failed"), and no command ran.
fn safe(tag: &str, (status, hit): (String, bool)) {
    assert!(!hit, "{tag}: the planted command ran");
    assert_ne!(status, "failed", "{tag}: the backup failed");
}

#[test]
fn a_sub_gitfile_with_fsmonitor_runs_nothing() {
    if !has_git() { return; }
    let m = marker("B");
    let v = base_notes("B");
    attacker_gitdir(&v, "gd", "sub", &fsmon(&m));
    put(&v, "sub/.git", b"gitdir: ../gd\n");
    safe("B", run("B", &v, &m));
}

#[test]
fn a_sub_gitfile_with_a_clean_filter_runs_nothing() {
    if !has_git() { return; }
    let m = marker("G");
    let v = base_notes("G");
    attacker_gitdir(&v, "gd", "sub", &format!("[filter \"evil\"]\n\tclean = \"touch {} ; cat\"\n", m.display()));
    put(&v, "sub/.gitattributes", b"* filter=evil\n");
    put(&v, "sub/.git", b"gitdir: ../gd\n");
    safe("G", run("G", &v, &m));
}

#[test]
fn a_gitfile_at_the_top_or_in_capitals_does_not_stop_backups() {
    if !has_git() { return; }
    let m = marker("A");
    let v = base_notes("A");
    attacker_gitdir(&v, "gd", "", &fsmon(&m));
    put(&v, ".git", b"gitdir: gd\n");
    safe("A", run("A", &v, &m));
    let m = marker("D");
    let v = base_notes("D");
    attacker_gitdir(&v, "gd", "sub", &fsmon(&m));
    put(&v, "sub/.GIT", b"gitdir: ../gd\n");
    safe("D", run("D", &v, &m));
}

#[test]
fn a_planted_gitignore_does_not_hide_notes_from_the_backup() {
    if !has_git() { return; }
    let v = base_notes("L");
    put(&v, ".gitignore", b"*\n");
    let repo = backup_repo("L");
    let r = backup_git(&v, &repo, false, "s");
    assert_eq!(r.status, "saved", "{}", r.message);
    assert!(git(&repo, &["cat-file", "-e", "HEAD:pages/a.md"]), "pages/a.md is in the backup");
}

/// The backup repo itself uses a `.git` FILE (git init --separate-git-dir / git worktree).
fn gitfile_repo(tag: &str) -> PathBuf {
    let repo = tmp(&format!("{tag}_repo"));
    let real = tmp(&format!("{tag}_realgitdir"));
    let _ = std::fs::remove_dir_all(&real);
    assert!(git(&repo, &["init", "-q", "-b", "main", "--separate-git-dir", real.to_str().unwrap()]));
    ident(&repo);
    put(&repo, "README.md", b"backup\n");
    assert!(git(&repo, &["add", "-A"]) && git(&repo, &["commit", "-q", "-m", "init"]));
    assert!(repo.join(".git").is_file());
    repo
}

#[test]
fn a_backup_repo_with_a_gitfile_keeps_it_and_cant_be_taken_over() {
    if !has_git() { return; }
    // its own .git file stays (it was taken for a stray file and deleted before)
    let v = base_notes("J");
    let repo = gitfile_repo("J");
    let r = backup_git(&v, &repo, false, "s");
    assert_eq!(r.status, "saved", "{}", r.message);
    assert!(repo.join(".git").is_file(), "the repo's own .git file is still there");
    // and a planted top-level .git file can't replace it
    let m = marker("K");
    let v = base_notes("K");
    attacker_gitdir(&v, "gd", "", &fsmon(&m));
    put(&v, ".git", b"gitdir: gd\n");
    let repo = gitfile_repo("K");
    let before = std::fs::read_to_string(repo.join(".git")).unwrap();
    let r = backup_git(&v, &repo, false, "s");
    assert!(!m.exists(), "K: the planted command ran");
    assert_ne!(r.status, "failed", "{}", r.message);
    assert_eq!(std::fs::read_to_string(repo.join(".git")).unwrap(), before, "the repo still points at its own git folder");
}

#[test]
fn gitfiles_an_older_backup_copied_into_the_repo_are_removed() {
    if !has_git() { return; }
    let m = marker("old");
    let v = base_notes("old");
    attacker_gitdir(&v, "gd", "sub", &fsmon(&m));
    let repo = backup_repo("old");
    // what a backup before the fix left in the repo
    put(&repo, "sub/.git", b"gitdir: ../gd\n");
    put(&repo, "sub/.gitattributes", b"* filter=evil\n");
    put(&repo, ".gitmodules", b"[submodule \"x\"]\n\tpath = x\n\turl = ./x\n");
    let r = backup_git(&v, &repo, false, "s");
    assert_ne!(r.status, "failed", "{}", r.message);
    assert!(!m.exists(), "the planted command ran");
    for f in ["sub/.git", "sub/.gitattributes", ".gitmodules"] {
        assert!(!repo.join(f).exists(), "{f} is gone from the backup repo");
    }
    assert!(repo.join(".git").is_dir(), "the repo's own .git folder stays");
}

#[test]
fn git_special_names() {
    use outline_core::app::backup::git_special;
    for n in [".git", ".GIT", ".git.", ".git ", ".gitmodules", ".gitattributes", ".gitignore", "GIT~1", ".g\u{200C}it"] {
        assert!(git_special(n), "{n:?}");
    }
    for n in ["git.md", "notes.git.md", "digit", "pages", "a.gitx.md"] {
        assert!(!git_special(n), "{n:?}");
    }
}

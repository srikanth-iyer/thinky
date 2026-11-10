//! Backups (Build 37, he asked Nov 6): optional, off unless turned on in Settings, laptop only. Two kinds:
//! - **Snapshot folder**: a dated zip of the notes folder in a folder he picks (outside the notes
//!   folder), keeping the last few. Files are stored as they are (no compression: pictures and PDFs
//!   are already compressed, and it keeps this small and fast); a zip any computer opens.
//! - **GitHub** (or any git repository): the notes folder copied into a separate folder that is a git
//!   repository, then a snapshot ("commit") and an upload ("push") with the `git` program, as his own
//!   weekly script does. Every earlier snapshot stays in the repository's history.
//! Either way a backup is made only when something changed since the last one, never from a folder
//! that doesn't look like the notes folder (so an empty or half-synced folder can't look like
//! "everything was deleted"), and it says when an unusual number of files vanished.
//! A missing file can be looked for in the backups and put back (`find_in_backup`,
//! `restore_from_backup`), never over a file that is there.
//! What is left out: git's own folder, Logseq's backups (logseq/bak), the bin (logseq/.recycle),
//! Drive's temporary upload folder, Windows' desktop.ini and temporary files.

use super::App;
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// What a backup did, for the app to say.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct BackupReport {
    /// "saved", "nochange" or "failed"
    pub status: String,
    /// Words to show.
    pub message: String,
    /// Files new or changed since the last backup, and files gone since then.
    pub changed: usize,
    pub deleted: usize,
    /// Many files vanished since the last backup (they are still in the earlier backups).
    pub warning: Option<String>,
    /// The zip written (snapshot folder) or the commit (git), if any.
    pub made: Option<String>,
}

/// More than this many files gone since the last backup (or a tenth of them) gets a warning.
const MANY_GONE: usize = 20;
const STATE: &str = "thinky-backups.json";
const PREFIX: &str = "thinky-backup-";

fn skip_dir(rel: &str) -> bool {
    let low = rel.to_ascii_lowercase();
    let name = low.rsplit('/').next().unwrap_or(&low);
    name == ".git" || name == ".tmp.driveupload" || low == "logseq/bak" || low == "logseq/.recycle"
}
fn skip_file(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    low == "desktop.ini" || low.ends_with(".tmp") || low.starts_with("~$") || low == ".ds_store" || low == "thumbs.db"
}

/// Every file to back up: vault-relative path ("/" separators) → (full path, size, modified secs).
pub fn backup_files(root: &Path) -> BTreeMap<String, (PathBuf, u64, u64)> {
    let mut out = BTreeMap::new();
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue; // (never follow a link out of the folder)
            }
            if ft.is_dir() {
                if !skip_dir(&r) {
                    stack.push((e.path(), r));
                }
            } else if ft.is_file() && !skip_file(&name) {
                let md = e.metadata().ok();
                let size = md.as_ref().map_or(0, |m| m.len());
                let mt = md.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
                out.insert(r, (e.path(), size, mt));
            }
        }
    }
    out
}

/// The notes folder looks like one: a pages or journals folder with notes in it. A folder that
/// doesn't (Drive not running, half synced) is never backed up.
fn looks_like_notes(root: &Path, files: &BTreeMap<String, (PathBuf, u64, u64)>) -> Result<(), String> {
    let notes = files.keys().filter(|k| k.ends_with(".md") || k.ends_with(".org")).count();
    if !root.is_dir() || notes == 0 {
        return Err("The notes folder isn't there or has no notes just now (is it still syncing?), so no backup was made.".into());
    }
    Ok(())
}

/// The backup folder must be outside the notes folder (and not hold it).
fn check_place(root: &Path, dest: &Path) -> Result<PathBuf, String> {
    if dest.as_os_str().is_empty() {
        return Err("Choose where backups go first.".into());
    }
    if !dest.is_absolute() {
        return Err("The backup folder needs its full path (like C:\\Users\\you\\notes-backups).".into());
    }
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let (r, d) = (canon(root), canon(dest));
    if d.starts_with(&r) || r.starts_with(&d) {
        return Err("Backups must go in a folder outside your notes folder (a backup inside it would be synced and backed up again).".into());
    }
    Ok(d)
}

/// One number for "what the folder holds now" (paths, sizes and times): equal means nothing changed.
fn fingerprint(files: &BTreeMap<String, (PathBuf, u64, u64)>) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for (k, (_, size, mt)) in files {
        for b in k.as_bytes().iter().chain(&size.to_le_bytes()).chain(&mt.to_le_bytes()) {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")
}

fn gone_warning(deleted: usize, before: usize) -> Option<String> {
    (deleted >= MANY_GONE || (before >= 20 && deleted * 10 >= before)).then(|| {
        format!("{deleted} files are gone since the last backup. If you didn't remove them, they are still in the earlier backups.")
    })
}

// ------------------------------------------------------------------ zip (stored, no compression)

fn crc32(data: &[u8], mut crc: u32) -> u32 {
    crc = !crc;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}
fn dos_time(secs: u64) -> (u16, u16) {
    // (days from 1970 → a civil date, as zip wants; UTC)
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    let y = y.clamp(1980, 2107);
    let time = ((h as u16) << 11) | ((m as u16) << 5) | ((s / 2) as u16);
    let date = (((y - 1980) as u16) << 9) | ((mo as u16) << 5) | (d as u16);
    (time, date)
}

/// Write `files` into a new zip at `dest` (stored). Up to 4 GB in all (no ZIP64): a bigger folder
/// is refused with a clear reason rather than written wrong.
pub fn write_zip(dest: &Path, files: &BTreeMap<String, (PathBuf, u64, u64)>) -> Result<(), String> {
    let total: u64 = files.values().map(|(_, s, _)| *s).sum();
    if total > 3_900_000_000 || files.len() > 65_000 {
        return Err("The notes folder is too big for a snapshot zip (over 4 GB or 65,000 files). Use the GitHub kind instead.".into());
    }
    let tmp = dest.with_extension("zip.part");
    let res = (|| -> std::io::Result<()> {
        let mut out = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        let mut central: Vec<u8> = vec![];
        let mut offset: u64 = 0;
        let mut count = 0u16;
        for (rel, (path, _, mt)) in files {
            let mut data = vec![];
            if std::fs::File::open(path).and_then(|mut f| f.read_to_end(&mut data)).is_err() {
                continue; // (a file that vanished or can't be read just now: the next backup has it)
            }
            let crc = crc32(&data, 0);
            let (t, d) = dos_time(*mt);
            let name = rel.as_bytes();
            let size = data.len() as u32;
            let mut h = vec![];
            h.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            h.extend_from_slice(&20u16.to_le_bytes()); // version needed
            h.extend_from_slice(&0x0800u16.to_le_bytes()); // names in UTF-8
            h.extend_from_slice(&0u16.to_le_bytes()); // stored
            h.extend_from_slice(&t.to_le_bytes());
            h.extend_from_slice(&d.to_le_bytes());
            h.extend_from_slice(&crc.to_le_bytes());
            h.extend_from_slice(&size.to_le_bytes());
            h.extend_from_slice(&size.to_le_bytes());
            h.extend_from_slice(&(name.len() as u16).to_le_bytes());
            h.extend_from_slice(&0u16.to_le_bytes());
            h.extend_from_slice(name);
            out.write_all(&h)?;
            out.write_all(&data)?;
            let mut c = vec![];
            c.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            c.extend_from_slice(&20u16.to_le_bytes()); // made by
            c.extend_from_slice(&20u16.to_le_bytes());
            c.extend_from_slice(&0x0800u16.to_le_bytes());
            c.extend_from_slice(&0u16.to_le_bytes());
            c.extend_from_slice(&t.to_le_bytes());
            c.extend_from_slice(&d.to_le_bytes());
            c.extend_from_slice(&crc.to_le_bytes());
            c.extend_from_slice(&size.to_le_bytes());
            c.extend_from_slice(&size.to_le_bytes());
            c.extend_from_slice(&(name.len() as u16).to_le_bytes());
            c.extend_from_slice(&[0u8; 8]); // extra, comment, disk, internal attributes
            c.extend_from_slice(&0u32.to_le_bytes()); // external attributes
            c.extend_from_slice(&(offset as u32).to_le_bytes());
            c.extend_from_slice(name);
            central.extend_from_slice(&c);
            offset += h.len() as u64 + data.len() as u64;
            count += 1;
        }
        let mut e = vec![];
        e.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        e.extend_from_slice(&[0u8; 4]);
        e.extend_from_slice(&count.to_le_bytes());
        e.extend_from_slice(&count.to_le_bytes());
        e.extend_from_slice(&(central.len() as u32).to_le_bytes());
        e.extend_from_slice(&(offset as u32).to_le_bytes());
        e.extend_from_slice(&0u16.to_le_bytes());
        out.write_all(&central)?;
        out.write_all(&e)?;
        out.flush()?;
        Ok(())
    })();
    match res.and_then(|_| std::fs::rename(&tmp, dest)) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(format!("Couldn't write the backup ({e})."))
        }
    }
}

/// One file's bytes from one of our zips (stored entries), by its vault-relative path.
pub fn read_from_zip(zip: &Path, want: &str) -> Option<Vec<u8>> {
    zip_files(zip, |name| name == want).pop().map(|(_, b)| b)
}

/// The stored files of one of our zips whose names `keep` says yes to: (name, bytes), in the zip's
/// order. A damaged zip gives what was read before the damage.
pub fn zip_files(zip: &Path, mut keep: impl FnMut(&str) -> bool) -> Vec<(String, Vec<u8>)> {
    let mut out = vec![];
    let _ = zip_walk(zip, &mut keep, &mut out);
    out
}

fn zip_walk(zip: &Path, keep: &mut impl FnMut(&str) -> bool, out: &mut Vec<(String, Vec<u8>)>) -> Option<()> {
    let mut f = std::fs::File::open(zip).ok()?;
    let len = f.metadata().ok()?.len();
    let tail = len.min(66_000);
    f.seek(SeekFrom::Start(len - tail)).ok()?;
    let mut buf = vec![0u8; tail as usize];
    f.read_exact(&mut buf).ok()?;
    let at = buf.windows(4).rposition(|w| w == [0x50, 0x4b, 0x05, 0x06])?;
    let u16_ = |b: &[u8], i: usize| u16::from_le_bytes([b[i], b[i + 1]]) as usize;
    let u32_ = |b: &[u8], i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as u64;
    let (n, cd_size, cd_off) = (u16_(&buf, at + 10), u32_(&buf, at + 12), u32_(&buf, at + 16));
    f.seek(SeekFrom::Start(cd_off)).ok()?;
    let mut cd = vec![0u8; cd_size as usize];
    f.read_exact(&mut cd).ok()?;
    let mut i = 0;
    for _ in 0..n {
        if i + 46 > cd.len() || cd[i..i + 4] != [0x50, 0x4b, 0x01, 0x02] {
            return None;
        }
        let (method, size, name_len, extra, comment, off) = (u16_(&cd, i + 10), u32_(&cd, i + 20), u16_(&cd, i + 28), u16_(&cd, i + 30), u16_(&cd, i + 32), u32_(&cd, i + 42));
        let name = std::str::from_utf8(cd.get(i + 46..i + 46 + name_len)?).ok()?;
        if method == 0 && keep(name) {
            let mut lh = [0u8; 30];
            f.seek(SeekFrom::Start(off)).ok()?;
            f.read_exact(&mut lh).ok()?;
            let skip = 30 + u16_(&lh, 26) + u16_(&lh, 28);
            f.seek(SeekFrom::Start(off + skip as u64)).ok()?;
            let mut data = vec![0u8; size as usize];
            f.read_exact(&mut data).ok()?;
            out.push((name.to_string(), data));
        }
        i += 46 + name_len + extra + comment;
    }
    Some(())
}

/// Our zips in a backup folder, newest first.
pub(super) fn our_zips(dest: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dest)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(PREFIX) && n.to_string_lossy().ends_with(".zip"))).collect())
        .unwrap_or_default();
    // newest first: by when each was written (a second one in the same minute is "…-2.zip")
    let when = |p: &PathBuf| p.metadata().and_then(|m| m.modified()).ok();
    v.sort_by(|a, b| when(b).cmp(&when(a)).then_with(|| b.cmp(a)));
    v
}

#[derive(serde::Deserialize, Serialize, Default)]
struct State {
    fingerprint: String,
    files: Vec<String>,
}
fn read_state(dest: &Path) -> State {
    std::fs::read_to_string(dest.join(STATE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// A snapshot zip, if anything changed since the last one; then only the newest `keep` zips are kept.
pub fn backup_zip(root: &Path, dest: &Path, keep: usize, stamp: &str) -> BackupReport {
    let fail = |m: String| BackupReport { status: "failed".into(), message: m, changed: 0, deleted: 0, warning: None, made: None };
    let dest = match check_place(root, dest) {
        Ok(d) => d,
        Err(e) => return fail(e),
    };
    let files = backup_files(root);
    if let Err(e) = looks_like_notes(root, &files) {
        return fail(e);
    }
    if let Err(e) = std::fs::create_dir_all(&dest) {
        return fail(format!("Couldn't make the backup folder ({e})."));
    }
    let st = read_state(&dest);
    let fp = fingerprint(&files);
    if st.fingerprint == fp && !our_zips(&dest).is_empty() {
        return BackupReport { status: "nochange".into(), message: "Nothing changed since the last backup.".into(), changed: 0, deleted: 0, warning: None, made: None };
    }
    let before: std::collections::HashSet<&String> = st.files.iter().collect();
    let deleted = st.files.iter().filter(|f| !files.contains_key(*f)).count();
    let changed = files.keys().filter(|k| !before.contains(k)).count().max(usize::from(!st.fingerprint.is_empty() && st.fingerprint != fp));
    // (the app's local date and time, "2026-11-06-2130": only digits and dashes in a file name)
    let stamp: String = stamp.chars().filter(|c| c.is_ascii_digit() || *c == '-').take(20).collect();
    let stamp = if stamp.is_empty() { fp[..8].to_string() } else { stamp };
    let mut name = format!("{PREFIX}{stamp}.zip");
    let mut k = 2;
    while dest.join(&name).exists() {
        name = format!("{PREFIX}{stamp}-{k}.zip");
        k += 1;
    }
    let zip = dest.join(&name);
    if let Err(e) = write_zip(&zip, &files) {
        return fail(e);
    }
    let state = State { fingerprint: fp.clone(), files: files.keys().cloned().collect() };
    let _ = std::fs::write(dest.join(STATE), serde_json::to_string(&state).unwrap_or_default());
    for old in our_zips(&dest).into_iter().skip(keep.max(1)) {
        let _ = std::fs::remove_file(old);
    }
    let warning = if st.files.is_empty() { None } else { gone_warning(deleted, st.files.len()) };
    BackupReport { status: "saved".into(), message: format!("Backed up to {name}."), changed, deleted, warning, made: Some(name) }
}

// ------------------------------------------------------------------ git

pub(super) fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let mut c = std::process::Command::new("git");
    c.arg("-C").arg(repo).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // (no console window flashing up)
    }
    let out = c.output().map_err(|e| format!("Couldn't run git ({e}). Is git installed?"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("git failed").to_string())
    }
}

/// Make `repo` (but its .git) hold exactly the backed-up files: copy new and changed ones, remove
/// ones gone from the notes folder. Returns how many were copied.
fn mirror(files: &BTreeMap<String, (PathBuf, u64, u64)>, repo: &Path) -> Result<usize, String> {
    let there = backup_files(repo);
    let mut copied = 0;
    for (rel, (src, size, _)) in files {
        let dst = repo.join(rel);
        let same = there.get(rel).is_some_and(|(_, s, _)| s == size) && std::fs::read(src).ok() == std::fs::read(&dst).ok();
        if same {
            continue;
        }
        if let Some(p) = dst.parent() {
            std::fs::create_dir_all(p).map_err(|e| format!("Couldn't copy {rel} ({e})."))?;
        }
        std::fs::copy(src, &dst).map_err(|e| format!("Couldn't copy {rel} ({e})."))?;
        copied += 1;
    }
    for rel in there.keys() {
        if !files.contains_key(rel) {
            let _ = std::fs::remove_file(repo.join(rel));
        }
    }
    Ok(copied)
}

/// The notes folder into a git repository folder, a commit if anything changed, then a push (also of
/// an earlier commit a failed push left behind).
pub fn backup_git(root: &Path, repo: &Path, push: bool, stamp: &str) -> BackupReport {
    let fail = |m: String| BackupReport { status: "failed".into(), message: m, changed: 0, deleted: 0, warning: None, made: None };
    let repo = match check_place(root, repo) {
        Ok(d) => d,
        Err(e) => return fail(e),
    };
    if !repo.join(".git").exists() {
        return fail(format!("{} isn't a git repository. Clone your backup repository there first (git clone …).", repo.display()));
    }
    let files = backup_files(root);
    if let Err(e) = looks_like_notes(root, &files) {
        return fail(e);
    }
    let before = backup_files(&repo).len();
    if let Err(e) = mirror(&files, &repo) {
        return fail(e);
    }
    if let Err(e) = git(&repo, &["add", "-A"]) {
        return fail(format!("git couldn't take the changes ({e})."));
    }
    let status = match git(&repo, &["status", "--porcelain"]) {
        Ok(s) => s,
        Err(e) => return fail(format!("git couldn't list the changes ({e}).")),
    };
    let lines: Vec<&str> = status.lines().filter(|l| !l.trim().is_empty()).collect();
    let deleted = lines.iter().filter(|l| l.starts_with("D ")).count();
    let changed = lines.len() - deleted;
    let pushed = |r: BackupReport| -> BackupReport {
        if !push {
            return r;
        }
        match git(&repo, &["push", "-q", "origin", "HEAD"]) {
            Ok(_) => r,
            Err(e) => BackupReport { message: format!("{} It couldn't be uploaded just now ({e}); it will be with the next backup.", r.message), ..r },
        }
    };
    if lines.is_empty() {
        let waiting = git(&repo, &["rev-list", "--count", "@{u}..HEAD"]).ok().and_then(|s| s.trim().parse::<u32>().ok()).unwrap_or(0);
        let r = BackupReport { status: "nochange".into(), message: "Nothing changed since the last backup.".into(), changed: 0, deleted: 0, warning: None, made: None };
        return if waiting > 0 { pushed(BackupReport { message: format!("Nothing changed; an earlier backup was uploaded ({waiting})."), ..r }) } else { r };
    }
    let msg = format!("Backup {stamp} ({changed} changed, {deleted} deleted)");
    if let Err(e) = git(&repo, &["commit", "-q", "-m", &msg]) {
        return fail(format!("git couldn't save the snapshot ({e})."));
    }
    let made = git(&repo, &["rev-parse", "--short", "HEAD"]).ok().map(|s| s.trim().to_string());
    pushed(BackupReport { status: "saved".into(), message: format!("{msg}."), changed, deleted, warning: gone_warning(deleted, before), made })
}

// ------------------------------------------------------------------ finding a file in the backups

/// Which backup holds this file (vault-relative, e.g. "assets/x.png"): the newest zip's name, or the
/// git commit that last had it. None: in no backup.
pub fn find_in_backup(kind: &str, dest: &Path, rel: &str) -> Option<String> {
    if kind == "git" {
        let rev = git(dest, &["log", "-1", "--format=%h", "--all", "--", rel]).ok()?;
        let rev = rev.trim();
        if rev.is_empty() {
            return None;
        }
        // the commit that removed it doesn't hold it: its parent does
        let has = git(dest, &["cat-file", "-e", &format!("{rev}:{rel}")]).is_ok();
        return Some(if has { rev.to_string() } else { format!("{rev}^") });
    }
    our_zips(dest).into_iter().find(|z| read_from_zip(z, rel).is_some()).and_then(|z| z.file_name().map(|n| n.to_string_lossy().into_owned()))
}

impl App {
    /// "Back up now" (Settings → Backups, or the app's weekly check): kind "zip" or "git".
    pub fn backup_now(&self, kind: &str, dest: &str, keep: usize, push: bool, stamp: &str) -> BackupReport {
        let dest = Path::new(dest.trim());
        if kind == "git" {
            backup_git(&self.root, dest, push, stamp)
        } else {
            backup_zip(&self.root, dest, keep, stamp)
        }
    }

    /// Put a missing file back from the backups (only when it isn't there: never over a file).
    pub fn restore_from_backup(&self, kind: &str, dest: &str, rel: &str) -> Result<String, String> {
        let rel = rel.trim_start_matches('/');
        if rel.is_empty() || rel.split('/').any(|p| p == ".." || p.is_empty()) || rel.contains('\\') || rel.contains(':') {
            return Err("That isn't a file in the notes folder.".into());
        }
        let target = self.root.join(rel);
        if target.exists() {
            return Err(format!("{rel} is there already, so nothing was changed."));
        }
        let dest = Path::new(dest.trim());
        let found = find_in_backup(kind, dest, rel).ok_or_else(|| format!("{rel} isn't in your backups."))?;
        let bytes = if kind == "git" {
            let mut c = std::process::Command::new("git");
            c.arg("-C").arg(dest).args(["show", &format!("{found}:{rel}")]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x0800_0000);
            }
            let out = c.output().map_err(|e| format!("Couldn't run git ({e})."))?;
            if !out.status.success() {
                return Err(format!("git couldn't read {rel} from the backup."));
            }
            out.stdout
        } else {
            read_from_zip(&dest.join(&found), rel).ok_or_else(|| format!("Couldn't read {rel} from {found}."))?
        };
        if let Some(p) = target.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        // written as new only (create_new): never over a file that appeared meanwhile
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| format!("Couldn't put {rel} back ({e})."))?;
        f.write_all(&bytes).map_err(|e| format!("Couldn't put {rel} back ({e})."))?;
        Ok(found)
    }
}

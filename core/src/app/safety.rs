//! Safety copies of recently changed notes, and putting a note's earlier version back from one.
//!
//! Each time a notes folder opens (the `open` command: start-up or switching folders; never
//! `--check`), the notes whose files changed in the last 3 days are copied, in the background, into
//! the notes folder itself, so Google Drive keeps them in the cloud (he asked, Oct 28):
//! `logseq/.safety-<device>/<id>.copy`. Hidden folders: Logseq (0.10, desktop and phone) skips every
//! path with a part starting with "." (and reads no `.copy` files), and so do this app's index, file
//! watcher and picture check. `<device>` names this device ("computer-1a2b3c4d", "phone-…": its kind
//! and a random name made once, kept in the app's data folder, `device`): each device has a folder of
//! its own right in `logseq/`, so the computer and the phone never make, write, trim or delete the same
//! folder or file (two devices making one folder at once would leave Google Drive with two folders of
//! that name); each lists and reads both.
//! The id is the UTC date and time ("2026-10-26_09-15-02", "-2"… for a second one that second).
//! A copy is ONE file (Google Drive syncs a few files much faster than many): its list as one line
//! of JSON (each note's path, file time and size, where its text is, and the notes left out, with
//! why), then the texts one after another, byte for byte. Written to a temp file, then renamed.
//! A copy also keeps the earlier texts of notes changed (or removed) somewhere else, numbered 1, 2…
//! in the copy ("before" entries): at start-up, what the index cache still holds of a file that
//! changed while the app was closed (kept right away, before the cache is written over:
//! `start_safety_copy`); while it's open, each text a change made elsewhere replaced
//! (`App::replaced`, every one, not just the first per note; written into a copy of its own
//! whenever the index cache is written, so an old text is always kept somewhere: in the cache, or in
//! a copy). That covers a note untouched for months that gets overwritten: its file is new, so the
//! copy of recent notes only has the new text.
//! No copy when nothing changed since this device's newest one. This device keeps of its own: the
//! newest 15, the newest of each of the last 7 days, and, for their earlier texts only, every other
//! copy from the last 7 days that holds some, however many: such a copy keeps just those (rewritten
//! whole, then renamed over the old file), their earlier texts together at most 25 MB, newest first.
//! All the copies in the notes folder together (both devices') stay within about 100 MB: over it,
//! this device's oldest go first, their notes as they were before the last 7 days' earlier texts;
//! never its newest copy, nor its newest copy of notes. Another device's copies are never touched.
//! Deleting its own old copies is the one thing the app ever deletes in the notes folder (never
//! through a link or junction: `real_chain`, `real_dir`). Each copy holds at most 500 notes / 25 MB,
//! earlier texts first, then the most recently changed. The texts come from the index (in memory).
//! A notes folder that can't be written (read-only, or `logseq/.safety-<device>` isn't a real folder) keeps
//! them on this device, `<data>/safety-copies/vault-<hash>/` (ids "local/<id>"), within the same
//! rules (all notes folders' local copies together ≤ ~100 MB); at the next start that can write
//! there they move in (`move_local`, also for the copies older versions kept there, a folder each).
//! Settings → Safety copies lists them, shows a note's text and puts that version back: the note as
//! it is now goes to `logseq/bak` first (like "Use the other version"), then the old text is written
//! the usual way (temp file, then rename) and the index updated.

use super::{now_secs, read_text, App, Expect, Stamp};
use crate::date::Date;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const DAYS: u64 = 3;
const KEEP: usize = 15;
/// Besides the newest 15: the newest copy of each of this many days (today and the days before).
const DAILY: u64 = 7;
const MAX_FILES: usize = 500;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
/// All the copies together (in a notes folder: both devices'): at most about this much of texts.
const MAX_ALL: u64 = 100 * 1024 * 1024;
/// A copy's file: "<id>.copy" (a type no notes app opens).
const EXT: &str = ".copy";
/// Where the copies live in the notes folder: `logseq/.safety-<device>/`, a folder per device right in
/// `logseq/`, so the two devices never even make the same folder (Google Drive keeps two folders
/// made at once under one name as two, and a sync app may then see only one).
const PREFIX: &str = ".safety-";

/// This device's name for its folder there, kept in the app's data folder.
const DEVICE_FILE: &str = "safety-device.txt";
/// The copies kept on this device (the notes folder couldn't be written): ids "local/<id>".
const LOCAL: &str = "local";
/// A copy's first line (its list) is never longer than this.
const MAX_HEAD: u64 = 16 * 1024 * 1024;

/// A device's folder for its copies in the notes folder: `logseq/.safety-<device>` (made if `make`).
fn vault_folder(root: &Path, dev: &str, make: bool) -> Result<PathBuf, String> {
    real_chain(root, &["logseq", &format!("{PREFIX}{dev}")], make)
}

/// The device a folder in `logseq/` belongs to (".safety-computer-1a2b3c4d" → "computer-1a2b3c4d").
fn device_of(folder: &str) -> Option<&str> {
    folder.strip_prefix(PREFIX).filter(|d| device_ok(d))
}

/// One note in a copy's list.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct Entry {
    path: String,
    mtime_ns: u64,
    size: u64,
    /// Why it was left out of the copy (empty for the ones in it).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    why: String,
    /// 0: the note as it was when copied. 1, 2…: one of its texts from before a change made elsewhere
    /// (the time and size are that earlier version's).
    #[serde(default, skip_serializing_if = "is_zero")]
    before: u32,
    /// Where its text is in the copy's file: [bytes after the first line, length]. None: left out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    at: Option<[u64; 2]>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// A copy's list: the first line of its file.
#[derive(Serialize, Deserialize, Clone)]
struct List {
    v: u32,
    /// The notes folder it was made from (as that device saw it).
    root: String,
    /// When it was made (seconds since 1970).
    when: u64,
    files: Vec<Entry>,
    skipped: Vec<Entry>,
}

/// A copy as read: its id, its file, its list, and where its texts start (after the first line).
struct Copy {
    id: String,
    file: PathBuf,
    list: List,
    body: u64,
}

/// A safety copy about to be made: worked out from the index (quick), written by `run`.
pub struct SafetyPlan {
    root: PathBuf,
    when: u64,
    files: Vec<(Entry, String)>,
    skipped: Vec<Entry>,
    /// The texts' total size so far.
    bytes: u64,
    /// Earlier texts numbered so far.
    earlier: u32,
}

#[derive(Serialize, Debug)]
pub struct CopyInfo {
    /// "<device>/<id>" ("computer-1a2b3c4d/2026-10-26_09-15-02"), or "local/<id>".
    pub id: String,
    /// When it was made (seconds since 1970).
    pub when: u64,
    pub notes: usize,
    /// Earlier texts of notes changed somewhere else.
    pub before: usize,
    /// Notes left out (over the limits, or not plain text).
    pub skipped: usize,
    pub bytes: u64,
    /// Which device made it: "computer" or "phone", and whether it's this one.
    pub kind: String,
    pub mine: bool,
}

#[derive(Serialize, Debug)]
pub struct CopyNote {
    pub path: String,
    pub name: String,
    pub journal: Option<Date>,
    pub bytes: u64,
    /// When its file had last changed, as copied (seconds since 1970).
    pub changed: u64,
    /// The note now: "same" (not changed since), "changed", or "gone" (no file now).
    pub now: &'static str,
    /// 0, or which of its texts from before a change made elsewhere (1, 2…).
    pub before: u32,
}

#[derive(Serialize, Debug)]
pub struct CopyView {
    pub id: String,
    pub when: u64,
    pub kind: String,
    pub mine: bool,
    /// Most recently changed first.
    pub notes: Vec<CopyNote>,
    /// (path, why) for the notes left out.
    pub skipped: Vec<(String, String)>,
}

#[derive(Serialize, Debug)]
pub struct CopyText {
    pub path: String,
    pub name: String,
    /// When the copy was made, and when this version of the note had been saved (seconds since 1970).
    pub when: u64,
    pub changed: u64,
    /// 0, or which of its texts from before a change made elsewhere (1, 2…).
    pub before: u32,
    pub text: String,
    /// The note reads exactly like this now.
    pub same: bool,
    /// The note has a file now (if not, putting it back makes it again).
    pub exists: bool,
}

#[derive(Serialize, Debug)]
pub struct Restored {
    pub name: String,
    pub path: String,
    /// false: the note already read like this, so nothing was written.
    pub changed: bool,
}

/// Which device made a copy (for a page's History, history.rs).
#[derive(Serialize, Debug, Clone)]
pub struct Made {
    /// "computer" or "phone"
    pub kind: String,
    /// this device
    pub mine: bool,
}

/// One text of a note in a copy, for its History (history.rs `sources`).
pub(super) struct CopyHit {
    /// "<device>/<id>"
    pub id: String,
    pub before: u32,
    /// The copy's time for the note as copied, an earlier text's own file time (seconds).
    pub when: u64,
    pub file: PathBuf,
    /// [where it starts in the file, length]
    pub span: [u64; 2],
    pub made: Made,
}

/// One copy being written (or moved) at a time (two folders opened quickly).
static BUSY: Mutex<()> = Mutex::new(());

/// The app's data folder, for the commands that read copies.
pub fn folder() -> Result<PathBuf, String> {
    super::data_dir().ok_or_else(|| "Safety copies aren’t kept here.".to_string())
}

/// This kind of device: "phone" (Android) or "computer".
fn kind() -> &'static str {
    if cfg!(target_os = "android") {
        "phone"
    } else {
        "computer"
    }
}

/// A device's folder name: its kind, "-" and 8 hex digits ("computer-1a2b3c4d").
fn device_ok(name: &str) -> bool {
    let Some((k, x)) = name.rsplit_once('-') else { return false };
    (1..=12).contains(&k.len()) && k.bytes().all(|c| c.is_ascii_lowercase()) && x.len() == 8 && x.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// The kind of device a folder name says ("local": this one).
fn kind_of(dev: &str) -> &str {
    if dev == LOCAL {
        kind()
    } else {
        dev.rsplit_once('-').map_or(dev, |(k, _)| k)
    }
}

/// This device's name for its copies' folder (`logseq/.safety-<name>`): made once (its kind and 8 random hex digits) and
/// kept in the app's data folder, so the computer's and the phone's copies never share a file.
pub fn device(data: &Path) -> Result<String, String> {
    static ONE: Mutex<()> = Mutex::new(());
    let _one = ONE.lock().unwrap_or_else(|p| p.into_inner());
    let p = data.join(DEVICE_FILE);
    if let Ok(t) = std::fs::read_to_string(&p) {
        if device_ok(t.trim()) {
            return Ok(t.trim().to_string());
        }
    }
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    h.write_u32(std::process::id());
    let name = format!("{}-{:08x}", kind(), h.finish() as u32);
    super::write_atomic(&p, &name).map_err(|e| format!("couldn’t name this device’s safety copies: {e}"))?;
    Ok(name)
}

/// `root` and then `parts`, each one a real folder: never a link or (on Windows) a junction, so
/// nothing is written or deleted through one. Missing ones are made when `make`.
fn real_chain(root: &Path, parts: &[&str], make: bool) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    let real = |p: &Path| std::fs::symlink_metadata(p).map(|m| m.file_type().is_dir());
    for part in parts {
        p.push(part);
        match real(&p) {
            Ok(true) => {}
            Ok(false) => return Err(format!("{} isn’t a folder of its own (a file, or a link)", p.display())),
            Err(e) if make && e.kind() == std::io::ErrorKind::NotFound => {
                if let Err(e) = std::fs::create_dir(&p).or_else(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { Ok(()) } else { Err(e) }) {
                    return Err(format!("couldn’t make {}: {e}", p.display()));
                }
                if !real(&p).unwrap_or(false) {
                    return Err(format!("{} isn’t a folder of its own", p.display()));
                }
            }
            Err(e) => return Err(format!("{}: {e}", p.display())),
        }
    }
    Ok(p)
}

/// This device's folder for one notes folder's copies in the app's data folder (the notes folder
/// couldn't be written), named like its index cache file.
fn local_folder(data: &Path, root: &Path, make: bool) -> Result<PathBuf, String> {
    let name = format!("vault-{}", crate::content_hash(&root.display().to_string()));
    real_chain(data, &["safety-copies", &name], make)
}

/// "2026-10-26_09-15-02" (UTC) for a time in seconds.
fn stamp_id(secs: u64) -> String {
    let (y, m, d) = crate::date::civil_from_days((secs / 86_400) as i64);
    let t = secs % 86_400;
    format!("{y:04}-{m:02}-{d:02}_{:02}-{:02}-{:02}", t / 3600, t / 60 % 60, t % 60)
}

/// A copy's name: a stamp, maybe "-2" after it. Nothing that could lead out of the folder.
fn id_ok(id: &str) -> bool {
    let b = id.as_bytes();
    (19..=24).contains(&b.len()) && b[10] == b'_' && b.iter().all(|c| c.is_ascii_digit() || *c == b'-' || *c == b'_')
}

/// "<device>/<id>" → (device, id), each checked.
fn split_ref(full: &str) -> Option<(&str, &str)> {
    let (dev, id) = full.split_once('/')?;
    ((dev == LOCAL || device_ok(dev)) && id_ok(id)).then_some((dev, id))
}

/// A note's path in the notes folder (or a copy): relative, "/"-separated, no "..", a `.md` file,
/// not in `logseq/` (settings, backups, the bin). (Also a page's History: history.rs.)
pub(super) fn rel_ok(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    rel.ends_with(".md")
        && !parts[0].eq_ignore_ascii_case("logseq")
        && parts.iter().all(|p| !p.is_empty() && *p != "." && *p != ".." && !p.contains(['\\', '\0']) && !(cfg!(windows) && p.contains(':')))
}

/// A folder itself, not a link or (on Windows) a junction to one.
fn real_dir(e: &std::fs::DirEntry) -> bool {
    e.file_type().is_ok_and(|t| t.is_dir())
}

/// A copy's file: its list as one line of JSON, then the texts (`texts[i]` is `list.files[i]`'s)
/// one after another, byte for byte. Returns it with the list as written (where each text is).
fn bundle(mut list: List, texts: &[&str]) -> Result<(String, List), String> {
    let mut at = 0u64;
    for (e, t) in list.files.iter_mut().zip(texts) {
        e.at = Some([at, t.len() as u64]);
        at += t.len() as u64;
    }
    for e in &mut list.skipped {
        e.at = None;
    }
    let head = serde_json::to_string(&list).map_err(|e| e.to_string())?; // (one line: JSON escapes line breaks)
    let mut s = String::with_capacity(head.len() + 1 + at as usize);
    s.push_str(&head);
    s.push('\n');
    for t in texts {
        s.push_str(t);
    }
    Ok((s, list))
}

/// A copy's file, read as far as its list. None when it's damaged or not all there (half-synced):
/// every text must lie inside the file.
fn read_copy(id: &str, file: &Path) -> Option<Copy> {
    let f = std::fs::File::open(file).ok()?;
    let len = f.metadata().ok()?.len();
    let mut head = vec![];
    std::io::BufReader::new(f).take(MAX_HEAD).read_until(b'\n', &mut head).ok()?;
    head.pop().filter(|c| *c == b'\n')?;
    let list: List = serde_json::from_slice(&head).ok()?;
    let body = head.len() as u64 + 1;
    let inside = |e: &Entry| e.at.is_some_and(|[a, n]| body.checked_add(a).and_then(|x| x.checked_add(n)).is_some_and(|end| end <= len));
    list.files.iter().all(inside).then(|| Copy { id: id.into(), file: file.into(), list, body })
}

/// Bytes `[start, length]` of a file as UTF-8 text (a text in a copy).
pub(super) fn read_span(file: &Path, [start, n]: [u64; 2]) -> Option<String> {
    let mut f = std::fs::File::open(file).ok()?;
    if f.metadata().ok()?.len() < start.checked_add(n)? {
        return None;
    }
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = vec![0; usize::try_from(n).ok()?];
    f.read_exact(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

impl Copy {
    /// Where an entry's text is in the file: [start, length].
    fn span(&self, e: &Entry) -> Option<[u64; 2]> {
        e.at.map(|[a, n]| [self.body + a, n])
    }
    fn text(&self, e: &Entry) -> Option<String> {
        read_span(&self.file, self.span(e)?)
    }
    /// Every text, in the list's order (None if one can't be read).
    fn texts(&self) -> Option<Vec<String>> {
        self.list.files.iter().map(|e| self.text(e)).collect()
    }
}

/// A folder's copies (real files named "<id>.copy"), newest first. Damaged or half-synced ones are
/// left out.
fn copies_in(dir: &Path) -> Vec<Copy> {
    let mut v = vec![];
    let Ok(rd) = std::fs::read_dir(dir) else { return v };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(EXT).filter(|id| id_ok(id)) else { continue };
        if !e.file_type().is_ok_and(|t| t.is_file()) {
            continue; // (a link isn't one)
        }
        if let Some(c) = read_copy(id, &e.path()) {
            v.push(c);
        }
    }
    v.sort_by(|a, b| (b.list.when, b.id.len(), &b.id).cmp(&(a.list.when, a.id.len(), &a.id)));
    v
}

/// The size of the texts a copy holds (as its list says), and of its earlier texts alone.
fn bytes(l: &List) -> u64 {
    l.files.iter().map(|e| e.size).sum()
}
fn earlier_bytes(l: &List) -> u64 {
    l.files.iter().filter(|e| e.before > 0).map(|e| e.size).sum()
}
/// It holds notes as they were (not only earlier texts).
fn has_notes(l: &List) -> bool {
    l.files.iter().chain(&l.skipped).any(|e| e.before == 0)
}

/// Write a copy's file into `dir` under `id`, or `id-2`… when that's taken: only where no file is
/// (`Expect::Missing`). Returns the id it got.
fn put(dir: &Path, id: &str, text: &str) -> Result<String, String> {
    for k in 1..1000 {
        let id = if k == 1 { id.to_string() } else { format!("{id}-{k}") };
        if !id_ok(&id) {
            break;
        }
        let file = dir.join(format!("{id}{EXT}"));
        if std::fs::symlink_metadata(&file).is_ok() {
            continue;
        }
        if super::write_atomic_checked(&file, text, Expect::Missing)? {
            return Ok(id);
        }
    }
    Err("no free name for it".into())
}

/// This device's copies in `dir` (`mine`: its name, `dir` = `logseq/.safety-<name>`; None: in the app's data
/// folder): keep the newest 15, the newest of each of the last 7 days (UTC days, `now` in seconds),
/// so a phone that restarts the app often doesn't push a week's copies out within a day, and, for
/// their earlier texts only, the other copies from those days that hold some (those texts together
/// at most 25 MB, newest first): such a copy keeps just its earlier texts (`trim`). Then all the
/// copies together within `cap` (`cap_all`), unless `quick` (it reads the other device's copies,
/// which Google Drive may first have to bring: not while the app waits).
fn prune(dir: &Path, now: u64, cap: u64, mine: Option<&str>, quick: bool) {
    let today = now / 86_400;
    let mut days = HashSet::new();
    let mut room = MAX_BYTES; // for copies kept for their earlier texts
    for (k, c) in copies_in(dir).into_iter().enumerate() {
        let day = c.list.when / 86_400;
        let recent = today.saturating_sub(day) < DAILY;
        // newest first: the first copy seen of a recent day is that day's newest
        let daily = recent && days.insert(day);
        if k < KEEP || daily {
            continue;
        }
        let earlier = earlier_bytes(&c.list);
        if recent && earlier > 0 && earlier <= room {
            room -= earlier;
            let _ = trim(&c);
            continue;
        }
        let _ = std::fs::remove_file(&c.file);
    }
    if quick {
        return;
    }
    if let Some(all) = dir.parent() {
        match mine {
            Some(me) => cap_all(all, today, cap, |n| device_of(n).is_some(), |n| device_of(n) == Some(me)),
            None => cap_all(all, today, cap, |n| n.starts_with("vault-"), |_| true),
        }
    }
}

/// Make a copy hold just its earlier texts (it's kept for those alone): written whole, then renamed
/// over the old file, so it's never half one and half the other. Returns its list as it is now.
fn trim(c: &Copy) -> Result<List, String> {
    let keep: Vec<&Entry> = c.list.files.iter().filter(|e| e.before > 0).collect();
    let skipped: Vec<Entry> = c.list.skipped.iter().filter(|e| e.before > 0).cloned().collect();
    if keep.len() == c.list.files.len() && skipped.len() == c.list.skipped.len() {
        return Ok(c.list.clone());
    }
    let texts: Vec<String> = keep.iter().map(|e| c.text(e)).collect::<Option<_>>().ok_or("a text in it can’t be read")?;
    let list = List { v: 2, root: c.list.root.clone(), when: c.list.when, files: keep.into_iter().cloned().collect(), skipped };
    let (text, list) = bundle(list, &texts.iter().map(String::as_str).collect::<Vec<_>>())?;
    super::write_atomic(&c.file, &text)?;
    Ok(list)
}

/// The copies in every folder of `all` that `group` names (`logseq`: each device's `.safety-<device>`;
/// the data folder's `safety-copies`: each notes folder's) together at most `cap` bytes of texts, as
/// their lists say. Only copies in folders that are `mine` are ever trimmed or deleted: the oldest
/// first, first the notes as they were (a copy holding earlier texts from the last 7 days keeps just
/// those, any other goes whole); then, only if still over, those earlier texts too, oldest first.
/// Never a folder's newest copy, nor its newest copy of notes as they were.
fn cap_all(all: &Path, today: u64, cap: u64, group: impl Fn(&str) -> bool, mine: impl Fn(&str) -> bool) {
    let Ok(rd) = std::fs::read_dir(all) else { return };
    let mut total = 0;
    let mut old: Vec<Copy> = vec![]; // the copies that may go
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !group(&name) || !real_dir(&e) {
            continue;
        }
        let own = mine(&name);
        let mut notes_seen = false;
        for (k, c) in copies_in(&e.path()).into_iter().enumerate() {
            total += bytes(&c.list);
            let notes = has_notes(&c.list);
            let newest_notes = notes && !notes_seen;
            notes_seen |= notes;
            if own && k > 0 && !newest_notes {
                old.push(c);
            }
        }
    }
    if total <= cap {
        return;
    }
    old.sort_by_key(|c| c.list.when);
    for c in old.iter_mut() {
        if total <= cap {
            return;
        }
        let had = bytes(&c.list);
        if today.saturating_sub(c.list.when / 86_400) < DAILY && earlier_bytes(&c.list) > 0 {
            if let Ok(t) = trim(c) {
                total = total.saturating_sub(had - bytes(&t));
                c.list = t;
            }
        } else if std::fs::remove_file(&c.file).is_ok() {
            total = total.saturating_sub(had);
        }
    }
    for c in &old {
        if total <= cap {
            return;
        }
        if c.file.exists() && std::fs::remove_file(&c.file).is_ok() {
            total = total.saturating_sub(bytes(&c.list));
        }
    }
}

/// The app's data folder is inside the notes folder: then no copies are kept there (they'd be in
/// the notes folder, but not where they belong).
fn inside(data: &Path, root: &Path) -> bool {
    let abs = |p: &Path| std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    abs(data).starts_with(abs(root))
}

/// An older version's copy (a folder of its own in the data folder: `list.json`, the notes at their
/// paths, earlier texts in `.before/<n>/<path>`): its list and texts, if every one is there.
fn read_old(dir: &Path) -> Option<(List, Vec<String>)> {
    let list: List = serde_json::from_slice(&std::fs::read(dir.join("list.json")).ok()?).ok()?;
    let mut texts = vec![];
    for e in &list.files {
        if !rel_ok(&e.path) {
            return None;
        }
        let f = if e.before > 0 { dir.join(".before").join(e.before.to_string()).join(&e.path) } else { dir.join(&e.path) };
        texts.push(read_text(&f).ok().flatten()?);
    }
    Some((list, texts))
}

/// Put a copy (its list and texts) into `dest` and read it back: Ok when it reads exactly the same
/// (else the file just written goes again). One that's there already, the same, counts as done (a
/// move that stopped before removing the old one).
fn move_into(dest: &Path, id: &str, mut list: List, texts: &[String]) -> Result<(), String> {
    list.v = 2;
    let same = |c: &Copy| {
        c.list.when == list.when
            && c.list.files.len() == list.files.len()
            && c.list.files.iter().zip(&list.files).all(|(a, b)| (&a.path, a.before, a.mtime_ns, a.size) == (&b.path, b.before, b.mtime_ns, b.size))
            && c.texts().is_some_and(|t| t == texts)
    };
    let there = dest.join(format!("{id}{EXT}"));
    if std::fs::symlink_metadata(&there).is_ok_and(|m| m.file_type().is_file()) && read_copy(id, &there).is_some_and(|c| same(&c)) {
        return Ok(());
    }
    let (text, _) = bundle(list.clone(), &texts.iter().map(String::as_str).collect::<Vec<_>>())?;
    let got = put(dest, id, &text)?;
    let file = dest.join(format!("{got}{EXT}"));
    if read_copy(&got, &file).is_some_and(|c| same(&c)) {
        return Ok(());
    }
    let _ = std::fs::remove_file(&file);
    Err("it didn’t read back the same".into())
}

/// The copies this device kept in its data folder for notes folder `root` (all of them, in versions
/// before Build 32, a folder each; and any made while the notes folder couldn't be written) move
/// into the notes folder: each written there, read back and compared, and only then removed here.
/// One that can't be moved stays where it was, and the problems log says why. While the notes folder
/// can't be written, the older ones become one file each, where they are. Returns how many moved.
fn move_local(data: &Path, root: &Path) -> usize {
    let Ok(local) = local_folder(data, root, false) else { return 0 };
    let me = match device(data) {
        Ok(m) => m,
        Err(e) => {
            crate::log::record(&format!("safety copies: {e}"));
            return 0;
        }
    };
    let vault = vault_folder(root, &me, true).ok();
    let dest = vault.clone().unwrap_or_else(|| local.clone());
    let mut moved = 0;
    for e in std::fs::read_dir(&local).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() && name.strip_prefix('.').and_then(|x| x.strip_suffix(".part")).is_some_and(id_ok) {
            let _ = std::fs::remove_dir_all(e.path()); // an older version's copy left half-written
            continue;
        }
        let (id, got) = if ft.is_dir() && id_ok(&name) {
            (name.clone(), read_old(&e.path()))
        } else if ft.is_file() && vault.is_some() {
            let Some(id) = name.strip_suffix(EXT).filter(|i| id_ok(i)) else { continue };
            (id.to_string(), read_copy(id, &e.path()).and_then(|c| Some((c.texts()?, c.list))).map(|(t, l)| (l, t)))
        } else {
            continue;
        };
        let res = match got {
            Some((list, texts)) => move_into(&dest, &id, list, &texts),
            None => Err("a note in it is missing or damaged".into()),
        };
        match res {
            Ok(()) => {
                let gone = if ft.is_dir() { std::fs::remove_dir_all(e.path()) } else { std::fs::remove_file(e.path()) };
                if gone.is_ok() {
                    moved += 1;
                }
            }
            Err(why) => crate::log::record(&format!("safety copies: the copy {id} couldn’t be moved into {} ({why}), so it stays at {}", dest.display(), e.path().display())),
        }
    }
    if vault.is_some() {
        // (only when empty)
        if std::fs::remove_dir(&local).is_ok() {
            if let Some(p) = local.parent() {
                let _ = std::fs::remove_dir(p);
            }
        }
        if moved > 0 {
            prune(&dest, now_secs(), MAX_ALL, Some(&me), false);
        }
    }
    moved
}

impl SafetyPlan {
    /// Put one note in (its text, or None when it isn't plain text), or on the list of the ones left
    /// out, with why.
    fn add(&mut self, rel: &str, st: Stamp, text: Option<&str>, earlier: bool) {
        let before = if earlier {
            self.earlier += 1;
            self.earlier
        } else {
            0
        };
        let entry = |why: &str| Entry { path: rel.into(), mtime_ns: st.mtime_ns, size: st.size, why: why.into(), before, at: None };
        match text {
            None => self.skipped.push(entry("not plain text")),
            Some(_) if !rel_ok(rel) => self.skipped.push(entry("an unusual file name")),
            Some(_) if self.files.len() >= MAX_FILES => self.skipped.push(entry("more than 500 notes had changed")),
            Some(t) if self.bytes + t.len() as u64 > MAX_BYTES => self.skipped.push(entry("the copy was full (25 MB)")),
            Some(t) => {
                self.bytes += t.len() as u64;
                self.files.push((entry(""), t.to_string()));
            }
        }
    }

    /// No note changed in the last 3 days, and no earlier text to keep?
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.skipped.is_empty()
    }

    /// The notes it would copy as they are (paths, most recently changed first).
    pub fn paths(&self) -> Vec<&str> {
        self.files.iter().filter(|(e, _)| e.before == 0).map(|(e, _)| e.path.as_str()).collect()
    }

    /// Write the copy (into the notes folder: `logseq/.safety-<this device>/`; when that can't be
    /// written, into the app's data folder `data`), then prune the old ones. Returns the new copy's
    /// id ("<device>/<id>", or "local/<id>"); None when no note changed in the last 3 days, or none
    /// since this device's newest copy (and there's no earlier text to keep).
    pub fn run(self, data: &Path) -> Result<Option<String>, String> {
        self.run_within(data, MAX_ALL)
    }

    /// `run`, keeping all the copies together within `cap` bytes of texts (tests use a small one).
    pub fn run_within(self, data: &Path, cap: u64) -> Result<Option<String>, String> {
        self.write(data, cap, false)
    }

    /// `run`; `quick`: without the clean-up over both devices' copies (`prune`), for the earlier
    /// texts kept while the app waits (`keep_replaced`); the next copy made in the background does it.
    fn write(self, data: &Path, cap: u64, quick: bool) -> Result<Option<String>, String> {
        let _one = BUSY.lock().unwrap_or_else(|p| p.into_inner());
        if self.is_empty() {
            return Ok(None);
        }
        let me = device(data)?;
        let why = match vault_folder(&self.root, &me, true).and_then(|dir| self.write_into(&dir, cap, Some(&me), quick)) {
            Ok(id) => return Ok(id.map(|id| format!("{me}/{id}"))),
            Err(why) => why,
        };
        // the notes folder can't be written: on this device for now (moved in at a later start)
        if inside(data, &self.root) {
            return Err(format!("the notes folder can’t be written ({why}), and the app’s data folder is inside it, so no safety copy was made"));
        }
        static SAID: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !SAID.swap(true, std::sync::atomic::Ordering::Relaxed) {
            crate::log::record(&format!("safety copies: the notes folder can’t be written ({why}), so they’re kept on this device for now"));
        }
        let dir = local_folder(data, &self.root, true)?;
        Ok(self.write_into(&dir, cap, None, quick)?.map(|id| format!("{LOCAL}/{id}")))
    }

    /// Write the copy into `dir` (this device's folder: `mine` its name, `logseq/.safety-<mine>`; None in
    /// the data folder), unless nothing changed since the newest there; then prune.
    fn write_into(&self, dir: &Path, cap: u64, mine: Option<&str>, quick: bool) -> Result<Option<String>, String> {
        // (compared with the newest copy of notes as they were, not one of only earlier texts)
        let earlier = self.files.iter().any(|(e, _)| e.before > 0) || self.skipped.iter().any(|e| e.before > 0);
        if !earlier {
            if let Some(newest) = copies_in(dir).into_iter().find(|c| has_notes(&c.list)) {
                let had: HashSet<(&str, u64, u64)> = newest.list.files.iter().chain(&newest.list.skipped).filter(|e| e.before == 0).map(|e| (e.path.as_str(), e.mtime_ns, e.size)).collect();
                if self.files.iter().map(|(e, _)| e).chain(&self.skipped).all(|e| had.contains(&(e.path.as_str(), e.mtime_ns, e.size))) {
                    return Ok(None); // nothing changed since
                }
            }
        }
        let list = List {
            v: 2,
            root: self.root.display().to_string(),
            when: self.when,
            files: self.files.iter().map(|(e, _)| e.clone()).collect(),
            skipped: self.skipped.clone(),
        };
        let (text, _) = bundle(list, &self.files.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>())?;
        let id = put(dir, &stamp_id(self.when), &text).map_err(|e| format!("couldn’t write a safety copy: {e}"))?;
        prune(dir, self.when, cap, mine, quick);
        Ok(Some(id))
    }
}

impl App {
    /// The safety copy to make at `now` (seconds since 1970): the earlier texts of notes changed
    /// somewhere else (`replaced`, most recent first), then every note the index reads whose file
    /// changed in the last 3 days (by file time), most recent first; up to 500 notes / 25 MB.
    pub fn safety_plan(&self, now: u64) -> SafetyPlan {
        let mut plan = self.before_plan(now);
        let since = now.saturating_sub(DAYS * 86_400).saturating_mul(1_000_000_000);
        let mut recent: Vec<(&String, &Stamp)> = self.files.iter().filter(|(_, st)| st.mtime_ns >= since).collect();
        recent.sort_by(|a, b| b.1.mtime_ns.cmp(&a.1.mtime_ns).then(a.0.cmp(b.0)));
        for (rel, st) in recent {
            let text = self.contents.get(rel).map(String::as_str);
            plan.add(rel, *st, text, false);
        }
        plan
    }

    /// A copy of only the earlier texts that changes made elsewhere replaced (see `replaced`).
    fn before_plan(&self, now: u64) -> SafetyPlan {
        let mut plan = SafetyPlan { root: self.root.clone(), when: now, files: vec![], skipped: vec![], bytes: 0, earlier: 0 };
        let mut earlier: Vec<&(String, Stamp, String)> = self.replaced.iter().collect();
        earlier.sort_by(|a, b| b.1.mtime_ns.cmp(&a.1.mtime_ns).then(a.0.cmp(&b.0)));
        for (rel, st, text) in earlier {
            plan.add(rel, *st, Some(text), true);
        }
        plan
    }

    /// Each time a notes folder opens (not for `--check`). First, right away, the earlier texts found
    /// at start-up (what the index cache held of files changed while the app was closed) go into a
    /// copy of their own, and only then is the index cache written (`write_cache`; `load` left it as
    /// it was, the one place that still had them): a crash at any point leaves each earlier text in
    /// the old cache or in a copy. Then, in the background, so opening isn't slower: copies kept on
    /// this device move into the notes folder (`move_local`), and the copy of the notes changed lately
    /// is made. Problems go to the problems log.
    pub fn start_safety_copy(&mut self) {
        if !self.replaced.is_empty() {
            self.write_cache();
        }
        let Some(data) = super::data_dir() else { return };
        let plan = self.safety_plan(now_secs()); // (with the earlier texts too, if they couldn't be kept)
        let root = self.root.clone();
        std::thread::spawn(move || {
            {
                let _one = BUSY.lock().unwrap_or_else(|p| p.into_inner());
                move_local(&data, &root);
            }
            if !plan.is_empty() {
                if let Err(e) = plan.run(&data) {
                    crate::log::record(&format!("safety copy: {e}"));
                }
            }
        });
    }

    /// `move_local` for this notes folder, now (tests; the app does it when the folder opens).
    pub fn move_local_copies(&self, data: &Path) -> usize {
        let _one = BUSY.lock().unwrap_or_else(|p| p.into_inner());
        move_local(data, &self.root)
    }

    /// The earlier texts that changes made elsewhere replaced (`replaced`) into a copy of their own,
    /// right away (they're small): called before the index cache, which forgets them, is written.
    /// False when the copy couldn't be made: they stay here, the cache isn't written (the one on disk
    /// still has them), and it's tried again the next time. (Where no copies are kept, there's
    /// nothing to wait for.)
    pub(super) fn keep_replaced(&mut self) -> bool {
        if self.replaced.is_empty() {
            return true;
        }
        let Some(data) = super::data_dir() else {
            self.replaced.clear();
            return true;
        };
        match self.before_plan(now_secs()).write(&data, MAX_ALL, true) {
            Ok(_) => {
                self.replaced.clear();
                true
            }
            Err(e) => {
                crate::log::record(&format!("safety copy (earlier texts): {e}"));
                false
            }
        }
    }

    /// Where this notes folder's copies are: (device, folder) for each device's folder in
    /// `logseq/.safety-<device>` (real folders only), then this device's folder in the app's data folder.
    fn places(&self, data: &Path) -> Vec<(String, PathBuf)> {
        let mut v = vec![];
        if let Ok(all) = real_chain(&self.root, &["logseq"], false) {
            for e in std::fs::read_dir(all).into_iter().flatten().flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if let Some(dev) = device_of(&name).filter(|_| real_dir(&e)) {
                    v.push((dev.to_string(), e.path()));
                }
            }
        }
        if let Ok(d) = local_folder(data, &self.root, false) {
            v.push((LOCAL.to_string(), d));
        }
        v
    }

    /// Every copy of this notes folder, newest first: (device, which device made it, copy). One kept
    /// on this device that's in the notes folder too (being moved there) shows once.
    fn all_copies(&self, data: &Path) -> Vec<(String, Made, Copy)> {
        let me = device(data).ok();
        let mut v = vec![];
        let mut mine_ids = HashSet::new();
        for (dev, dir) in self.places(data) {
            let mine = dev == LOCAL || me.as_deref() == Some(dev.as_str());
            for c in copies_in(&dir) {
                if dev == LOCAL && mine_ids.contains(&(c.id.clone(), c.list.when)) {
                    continue;
                }
                if mine {
                    mine_ids.insert((c.id.clone(), c.list.when));
                }
                v.push((dev.clone(), Made { kind: kind_of(&dev).to_string(), mine }, c));
            }
        }
        v.sort_by(|a, b| (b.2.list.when, &b.2.id, &b.0).cmp(&(a.2.list.when, &a.2.id, &a.0)));
        v
    }

    /// This notes folder's safety copies (both devices', and any kept on this device), newest first.
    pub fn safety_copies(&self, data: &Path) -> Vec<CopyInfo> {
        self.all_copies(data)
            .into_iter()
            .map(|(dev, made, c)| {
                let l = &c.list;
                let before = l.files.iter().filter(|e| e.before > 0).count();
                CopyInfo { id: format!("{dev}/{}", c.id), when: l.when, notes: l.files.len() - before, before, skipped: l.skipped.len(), bytes: bytes(l), kind: made.kind, mine: made.mine }
            })
            .collect()
    }

    /// The copies' texts of note `rel`, for its History (history.rs), newest copy first. When: the
    /// copy's time for the note as copied, an earlier text's own file time. Only entries a copy's list
    /// names, read from inside that copy's file.
    pub(super) fn copies_of(&self, data: &Path, rel: &str) -> Vec<CopyHit> {
        if !rel_ok(rel) {
            return vec![];
        }
        let mut v = vec![];
        for (dev, made, c) in self.all_copies(data) {
            for e in c.list.files.iter().filter(|e| e.path == rel) {
                let Some(span) = c.span(e) else { continue };
                let when = if e.before > 0 { e.mtime_ns / 1_000_000_000 } else { c.list.when };
                v.push(CopyHit { id: format!("{dev}/{}", c.id), before: e.before, when, file: c.file.clone(), span, made: made.clone() });
            }
        }
        v
    }

    /// One of this folder's copies, by its id ("<device>/<id>").
    fn open_copy(&self, data: &Path, full: &str) -> Result<(Made, Copy), String> {
        let (dev, id) = split_ref(full).ok_or("There’s no safety copy by that name.")?;
        let gone = || "That safety copy is gone (only the newest ones are kept).".to_string();
        let dir = if dev == LOCAL { local_folder(data, &self.root, false) } else { vault_folder(&self.root, dev, false) }.map_err(|_| gone())?;
        let file = dir.join(format!("{id}{EXT}"));
        if !std::fs::symlink_metadata(&file).is_ok_and(|m| m.file_type().is_file()) {
            return Err(gone());
        }
        let mine = dev == LOCAL || device(data).is_ok_and(|me| me == dev);
        Ok((Made { kind: kind_of(dev).to_string(), mine }, read_copy(id, &file).ok_or_else(gone)?))
    }

    /// The notes in one copy, and how each is now.
    pub fn safety_copy(&self, data: &Path, id: &str) -> Result<CopyView, String> {
        let (made, c) = self.open_copy(data, id)?;
        let notes = c
            .list
            .files
            .iter()
            .map(|e| {
                let (name, journal) = self.vault.title_from_path(&e.path);
                // same time and size: unchanged; otherwise compare the texts (e.g. after putting it
                // back; always for an earlier text, whose time is the earlier version's)
                let same_text = || rel_ok(&e.path) && self.contents.get(&e.path).is_some_and(|t| c.text(e).as_ref() == Some(t));
                let now = match self.files.get(&e.path) {
                    None => "gone",
                    Some(st) if e.before == 0 && st.mtime_ns == e.mtime_ns && st.size == e.size => "same",
                    Some(_) if same_text() => "same",
                    Some(_) => "changed",
                };
                CopyNote { path: e.path.clone(), name, journal, bytes: e.size, changed: e.mtime_ns / 1_000_000_000, now, before: e.before }
            })
            .collect();
        let skipped = c.list.skipped.iter().map(|e| (e.path.clone(), e.why.clone())).collect();
        Ok(CopyView { id: id.into(), when: c.list.when, kind: made.kind, mine: made.mine, notes, skipped })
    }

    /// A note's text in a copy (`before` > 0: one of its earlier texts): only an entry the copy's list
    /// names, read from inside that copy. Also the copy's time and that entry's file time (seconds).
    fn copy_text(&self, data: &Path, id: &str, path: &str, before: u32) -> Result<(u64, u64, String), String> {
        let (_, c) = self.open_copy(data, id)?;
        let Some(e) = c.list.files.iter().find(|e| e.path == path && e.before == before).filter(|_| rel_ok(path)) else {
            return Err("That note isn’t in this safety copy.".into());
        };
        let text = c.text(e).ok_or("That note’s copy is missing or damaged.")?;
        Ok((c.list.when, e.mtime_ns / 1_000_000_000, text))
    }

    /// A note as a copy has it (read-only), compared with the note now.
    pub fn safety_note(&self, data: &Path, id: &str, path: &str, before: u32) -> Result<CopyText, String> {
        let (when, changed, text) = self.copy_text(data, id, path, before)?;
        Ok(CopyText {
            path: path.into(),
            name: self.vault.title_from_path(path).0,
            when,
            changed,
            before,
            same: self.contents.get(path) == Some(&text),
            exists: self.files.contains_key(path),
            text,
        })
    }

    /// Put a note's version from a copy back. Never silently over what's there: the note as it is
    /// now is kept in `logseq/bak` first, then the old text is written (temp file, then rename) and
    /// the index updated. A note whose file is gone is made again.
    pub fn safety_restore(&mut self, data: &Path, id: &str, path: &str, before: u32) -> Result<Restored, String> {
        let (_, _, text) = self.copy_text(data, id, path, before)?;
        let name = self.vault.title_from_path(path).0;
        let cur = read_text(&self.root.join(path)).map_err(|e| e.say("the note’s file"))?;
        if cur.as_deref() == Some(text.as_str()) {
            return Ok(Restored { name, path: path.into(), changed: false });
        }
        if let Some(c) = &cur {
            self.backup(path, c)?;
        }
        // only over exactly what was read (and backed up) a moment ago: a change that arrives meanwhile
        // (Drive bringing in the phone's version) is never written over
        let expect = cur.as_deref().map_or(Expect::Missing, |c| Expect::Bytes(c.as_bytes()));
        if !super::write_atomic_checked(&self.root.join(path), &text, expect)? {
            return Err("The note was changed somewhere else just now, so its old version wasn't put back. Try again.".into());
        }
        self.record_write(path, &text);
        Ok(Restored { name, path: path.into(), changed: true })
    }
}

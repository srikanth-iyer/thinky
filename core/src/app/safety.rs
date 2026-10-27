//! Safety copies of recently changed notes, and putting a note's earlier version back from one.
//!
//! Each time a notes folder opens (the `open` command: start-up or switching folders; never
//! `--check`), the notes whose files changed in the last 3 days are copied, in the background, into
//! the app's own data folder: outside the notes folder (Google Drive syncs that) and not in the cache
//! (Android may clear it). Layout: `<data>/safety-copies/vault-<hash of the folder path>/<id>/`, the
//! id being the UTC date and time ("2026-10-26_09-15-02"), holding the note files at their usual
//! paths plus `list.json` (each file's time and size, and the notes left out, with why).
//! A copy also keeps the earlier texts of notes changed (or removed) somewhere else, numbered 1, 2…
//! in the copy ("before" entries in the list, files in `.before/<n>/<path>`): at start-up, what the
//! index cache still holds of a file that changed while the app was closed (kept right away, before
//! the cache is written over: `start_safety_copy`); while it's open, each text
//! a change made elsewhere replaced (`App::replaced`, every one, not just the first per note; written
//! into a copy of its own whenever the index cache is written, so an old text is always kept
//! somewhere: in the cache, or in a copy). That covers a note untouched for months that gets
//! overwritten: its file is new, so the copy of recent notes only has the new text.
//! No copy when nothing changed since the newest one. Kept: the newest 15, the newest of each of the
//! last 7 days, and, for their earlier texts only, every other copy from the last 7 days that holds
//! some, however many: such a copy keeps just those (its list is rewritten first, so it never names a
//! file that isn't there; then its notes as they were are deleted), their earlier texts together at
//! most 25 MB, newest first. All the copies together (every notes folder's) stay within about 100 MB:
//! over it, the oldest go first, their notes as they were before the last 7 days' earlier texts;
//! never a folder's newest copy. Others are deleted: they are the app's own files; nothing in the
//! notes folder is ever deleted. Each holds at most 500 notes / 25 MB, earlier texts first, then the
//! most recently changed. The texts come from the index (in memory), so nothing is read.
//! Settings → Safety copies lists them, shows a note's text and puts that version back: the note as
//! it is now goes to `logseq/bak` first (like "Use the other version"), then the old text is written
//! the usual way (temp file, then rename) and the index updated.

use super::{read_text, App, Stamp};
use crate::date::Date;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const DAYS: u64 = 3;
const KEEP: usize = 15;
/// Besides the newest 15: the newest copy of each of this many days (today and the days before).
const DAILY: u64 = 7;
const MAX_FILES: usize = 500;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
/// All the copies together (every notes folder's): at most about this much of texts (`cap_all`).
const MAX_ALL: u64 = 100 * 1024 * 1024;
const LIST: &str = "list.json";
/// Where a copy keeps earlier texts (hidden: no note's path can start with it, see `scan`).
const BEFORE: &str = ".before";

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
    /// (kept in `.before/<n>/<path>`; the time and size are that earlier version's).
    #[serde(default, skip_serializing_if = "is_zero")]
    before: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// Where an entry's text is kept inside its copy.
fn file_in(dir: &Path, path: &str, before: u32) -> PathBuf {
    if before > 0 {
        dir.join(BEFORE).join(before.to_string()).join(path)
    } else {
        dir.join(path)
    }
}

/// A copy's `list.json`.
#[derive(Serialize, Deserialize)]
struct List {
    v: u32,
    /// The notes folder it was made from.
    root: String,
    /// When it was made (seconds since 1970).
    when: u64,
    files: Vec<Entry>,
    skipped: Vec<Entry>,
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
    pub id: String,
    /// When it was made (seconds since 1970).
    pub when: u64,
    pub notes: usize,
    /// Earlier texts of notes changed somewhere else.
    pub before: usize,
    /// Notes left out (over the limits, or not plain text).
    pub skipped: usize,
    pub bytes: u64,
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

/// One copy being written at a time (two folders opened quickly).
static BUSY: Mutex<()> = Mutex::new(());

/// The app's data folder, for the commands that read copies.
pub fn folder() -> Result<PathBuf, String> {
    super::data_dir().ok_or_else(|| "Safety copies aren’t kept here.".to_string())
}

/// Where one notes folder's copies live (named like its index cache file).
fn vault_folder(data: &Path, root: &Path) -> PathBuf {
    data.join("safety-copies").join(format!("vault-{}", crate::content_hash(&root.display().to_string())))
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

/// A note's path in the notes folder (or a copy): relative, "/"-separated, no "..", a `.md` file,
/// not in `logseq/` (settings, backups, the bin). (Also a page's History: history.rs.)
pub(super) fn rel_ok(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    rel.ends_with(".md")
        && !parts[0].eq_ignore_ascii_case("logseq")
        && parts.iter().all(|p| !p.is_empty() && *p != "." && *p != ".." && !p.contains(['\\', '\0']) && !(cfg!(windows) && p.contains(':')))
}

/// A folder itself, not a link or (on Windows) a junction to one: what the copies' own folders always
/// are, so nothing that deletes copies ever reaches through a link to another place.
fn real_dir(e: &std::fs::DirEntry) -> bool {
    e.file_type().is_ok_and(|t| t.is_dir())
}

/// A folder's copies, newest first: (id, list). Half-written or damaged ones are left out.
fn copies_in(dir: &Path) -> Vec<(String, List)> {
    let mut v = vec![];
    let Ok(rd) = std::fs::read_dir(dir) else { return v };
    for e in rd.flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        if !id_ok(&id) || !real_dir(&e) {
            continue;
        }
        if let Some(l) = std::fs::read(e.path().join(LIST)).ok().and_then(|b| serde_json::from_slice::<List>(&b).ok()) {
            v.push((id, l));
        }
    }
    v.sort_by(|a, b| (b.1.when, b.0.len(), &b.0).cmp(&(a.1.when, a.0.len(), &a.0)));
    v
}

/// The size of the texts a copy holds (as its list says), and of its earlier texts alone.
fn bytes(l: &List) -> u64 {
    l.files.iter().map(|e| e.size).sum()
}
fn earlier_bytes(l: &List) -> u64 {
    l.files.iter().filter(|e| e.before > 0).map(|e| e.size).sum()
}

/// Keep the newest 15 copies, the newest of each of the last 7 days (UTC days, `now` in seconds), so
/// a phone that restarts the app often doesn't push a week's copies out within a day, and, for their
/// earlier texts only, the other copies from those days that hold some (those texts together at most
/// 25 MB, newest first): such a copy keeps just its earlier texts (`trim`). Clear away one left
/// half-written (the app was stopped). Then all the copies together within `cap` (`cap_all`).
fn prune(dir: &Path, now: u64, cap: u64) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if let Some(id) = n.strip_prefix('.').and_then(|x| x.strip_suffix(".part")) {
                if id_ok(id) {
                    let _ = std::fs::remove_dir_all(e.path());
                }
            }
        }
    }
    let today = now / 86_400;
    let mut days = HashSet::new();
    let mut room = MAX_BYTES; // for copies kept for their earlier texts
    for (k, (id, l)) in copies_in(dir).into_iter().enumerate() {
        let day = l.when / 86_400;
        let recent = today.saturating_sub(day) < DAILY;
        // newest first: the first copy seen of a recent day is that day's newest
        let daily = recent && days.insert(day);
        if k < KEEP || daily {
            continue;
        }
        let earlier = earlier_bytes(&l);
        if recent && earlier > 0 && earlier <= room {
            room -= earlier;
            let _ = trim(&dir.join(&id), &l);
            continue;
        }
        let _ = std::fs::remove_dir_all(dir.join(id));
    }
    if let Some(all) = dir.parent() {
        cap_all(all, today, cap);
    }
}

/// Make a copy hold just its earlier texts (it's kept for those alone): first its list (written
/// whole, then renamed over the old one), so the list never names a file that isn't there; then
/// everything else in it goes (the notes as they were). Returns the list as it is now.
fn trim(dir: &Path, l: &List) -> std::io::Result<List> {
    let t = List {
        v: l.v,
        root: l.root.clone(),
        when: l.when,
        files: l.files.iter().filter(|e| e.before > 0).cloned().collect(),
        skipped: l.skipped.iter().filter(|e| e.before > 0).cloned().collect(),
    };
    if t.files.len() < l.files.len() || t.skipped.len() < l.skipped.len() {
        let tmp = dir.join(".list.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&t).map_err(std::io::Error::other)?)?;
        std::fs::rename(&tmp, dir.join(LIST))?;
    }
    for e in std::fs::read_dir(dir)?.flatten() {
        let name = e.file_name();
        if name == LIST || name == BEFORE {
            continue;
        }
        if e.file_type()?.is_dir() {
            std::fs::remove_dir_all(e.path())?;
        } else {
            std::fs::remove_file(e.path())?;
        }
    }
    Ok(t)
}

/// All notes folders' copies together (`all`: the safety-copies folder) at most `cap` bytes of
/// texts, as their lists say. Over it, the oldest copies go first: first the notes as they were (a
/// copy holding earlier texts from the last 7 days keeps just those, any other goes whole); then, only
/// if still over, those earlier texts too, oldest first. Never a folder's newest copy, nor its newest
/// copy of notes as they were.
fn cap_all(all: &Path, today: u64, cap: u64) {
    let Ok(rd) = std::fs::read_dir(all) else { return };
    let mut total = 0;
    let mut old: Vec<(PathBuf, List)> = vec![]; // the copies that may go
    for e in rd.flatten() {
        if !e.file_name().to_string_lossy().starts_with("vault-") || !real_dir(&e) {
            continue;
        }
        let mut notes_seen = false;
        for (k, (id, l)) in copies_in(&e.path()).into_iter().enumerate() {
            total += bytes(&l);
            let notes = l.files.iter().chain(&l.skipped).any(|x| x.before == 0);
            let newest_notes = notes && !notes_seen;
            notes_seen |= notes;
            if k > 0 && !newest_notes {
                old.push((e.path().join(id), l));
            }
        }
    }
    if total <= cap {
        return;
    }
    old.sort_by_key(|(_, l)| l.when);
    for (d, l) in old.iter_mut() {
        if total <= cap {
            return;
        }
        let had = bytes(l);
        if today.saturating_sub(l.when / 86_400) < DAILY && earlier_bytes(l) > 0 {
            if let Ok(t) = trim(d, l) {
                total = total.saturating_sub(had - bytes(&t));
                *l = t;
            }
        } else if std::fs::remove_dir_all(&*d).is_ok() {
            total = total.saturating_sub(had);
        }
    }
    for (d, l) in &old {
        if total <= cap {
            return;
        }
        if d.exists() && std::fs::remove_dir_all(d).is_ok() {
            total = total.saturating_sub(bytes(l));
        }
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// The app's data folder is inside the notes folder: then no copies are made (Drive would sync them).
fn inside(data: &Path, root: &Path) -> bool {
    let abs = |p: &Path| std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    abs(data).starts_with(abs(root))
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
        let entry = |why: &str| Entry { path: rel.into(), mtime_ns: st.mtime_ns, size: st.size, why: why.into(), before };
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

    /// The notes whose earlier texts it would keep (from before changes made elsewhere), one per text.
    pub fn before_paths(&self) -> Vec<&str> {
        self.files.iter().filter(|(e, _)| e.before > 0).map(|(e, _)| e.path.as_str()).collect()
    }

    /// Write the copy into the data folder `data`, then prune the old ones. Returns the new copy's
    /// id; None when no note changed in the last 3 days, or none since the newest copy (and there's
    /// no earlier text to keep).
    pub fn run(self, data: &Path) -> Result<Option<String>, String> {
        self.run_within(data, MAX_ALL)
    }

    /// `run`, keeping all the copies together within `cap` bytes of texts (tests use a small one).
    pub fn run_within(self, data: &Path, cap: u64) -> Result<Option<String>, String> {
        let _one = BUSY.lock().unwrap_or_else(|p| p.into_inner());
        if self.is_empty() {
            return Ok(None);
        }
        if inside(data, &self.root) {
            return Err("the app’s data folder is inside the notes folder, so no copies are made".into());
        }
        let dir = vault_folder(data, &self.root);
        std::fs::create_dir_all(&dir).map_err(|e| format!("couldn’t make {}: {e}", dir.display()))?;
        // (compared with the newest copy of notes as they were, not one of only earlier texts)
        let earlier = self.files.iter().any(|(e, _)| e.before > 0) || self.skipped.iter().any(|e| e.before > 0);
        let all = copies_in(&dir);
        if let Some((_, newest)) = all.iter().find(|(_, l)| l.files.iter().chain(&l.skipped).any(|e| e.before == 0)).filter(|_| !earlier) {
            let had: HashSet<(&str, u64, u64)> = newest.files.iter().chain(&newest.skipped).filter(|e| e.before == 0).map(|e| (e.path.as_str(), e.mtime_ns, e.size)).collect();
            if self.files.iter().map(|(e, _)| e).chain(&self.skipped).all(|e| had.contains(&(e.path.as_str(), e.mtime_ns, e.size))) {
                return Ok(None); // nothing changed since
            }
        }
        let base = stamp_id(self.when);
        let mut id = base.clone();
        let mut k = 2;
        while dir.join(&id).exists() {
            id = format!("{base}-{k}");
            k += 1;
        }
        // written under a hidden name, renamed when complete: a copy is never seen half-made
        let part = dir.join(format!(".{id}.part"));
        let _ = std::fs::remove_dir_all(&part);
        let write = || -> std::io::Result<()> {
            for (e, text) in &self.files {
                let p = file_in(&part, &e.path, e.before);
                if let Some(d) = p.parent() {
                    std::fs::create_dir_all(d)?;
                }
                std::fs::write(&p, text)?;
            }
            let list = List {
                v: 1,
                root: self.root.display().to_string(),
                when: self.when,
                files: self.files.iter().map(|(e, _)| e.clone()).collect(),
                skipped: self.skipped.clone(),
            };
            std::fs::write(part.join(LIST), serde_json::to_vec_pretty(&list).map_err(std::io::Error::other)?)?;
            std::fs::rename(&part, dir.join(&id))
        };
        if let Err(e) = write() {
            let _ = std::fs::remove_dir_all(&part);
            return Err(format!("couldn’t write a safety copy: {e}"));
        }
        prune(&dir, self.when, cap);
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
    /// the old cache or in a copy. Then the copy of the notes changed lately, in the background, so
    /// opening isn't slower. With no earlier texts, only that. Problems go to the problems log.
    pub fn start_safety_copy(&mut self) {
        if !self.replaced.is_empty() {
            self.write_cache();
        }
        let Some(data) = super::data_dir() else { return };
        let plan = self.safety_plan(now_secs()); // (with the earlier texts too, if they couldn't be kept)
        if plan.is_empty() {
            return;
        }
        std::thread::spawn(move || {
            if let Err(e) = plan.run(&data) {
                crate::log::record(&format!("safety copy: {e}"));
            }
        });
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
        let Some(data) = super::data_dir().filter(|d| !inside(d, &self.root)) else {
            self.replaced.clear();
            return true;
        };
        match self.before_plan(now_secs()).run(&data) {
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

    /// This notes folder's safety copies, newest first.
    pub fn safety_copies(&self, data: &Path) -> Vec<CopyInfo> {
        copies_in(&vault_folder(data, &self.root))
            .into_iter()
            .map(|(id, l)| {
                let before = l.files.iter().filter(|e| e.before > 0).count();
                CopyInfo { id, when: l.when, notes: l.files.len() - before, before, skipped: l.skipped.len(), bytes: l.files.iter().map(|e| e.size).sum() }
            })
            .collect()
    }

    /// The copies' texts of note `rel`, for its History (history.rs): (copy id, `before`, when, the
    /// file holding it), newest copy first. When: the copy's time for the note as copied, an earlier
    /// text's own file time. Only entries a copy's list names, read from inside that copy.
    pub(super) fn copies_of(&self, data: &Path, rel: &str) -> Vec<(String, u32, u64, PathBuf)> {
        if !rel_ok(rel) {
            return vec![];
        }
        let dir = vault_folder(data, &self.root);
        let mut v = vec![];
        for (id, l) in copies_in(&dir) {
            for e in l.files.iter().filter(|e| e.path == rel) {
                let when = if e.before > 0 { e.mtime_ns / 1_000_000_000 } else { l.when };
                v.push((id.clone(), e.before, when, file_in(&dir.join(&id), rel, e.before)));
            }
        }
        v
    }

    /// One of this folder's copies, by its id.
    fn open_copy(&self, data: &Path, id: &str) -> Result<(PathBuf, List), String> {
        if !id_ok(id) {
            return Err("There’s no safety copy by that name.".into());
        }
        let dir = vault_folder(data, &self.root).join(id);
        let list = std::fs::read(dir.join(LIST)).ok().and_then(|b| serde_json::from_slice::<List>(&b).ok());
        Ok((dir, list.ok_or("That safety copy is gone (only the newest ones are kept).")?))
    }

    /// The notes in one copy, and how each is now.
    pub fn safety_copy(&self, data: &Path, id: &str) -> Result<CopyView, String> {
        let (dir, l) = self.open_copy(data, id)?;
        let notes = l
            .files
            .iter()
            .map(|e| {
                let (name, journal) = self.vault.title_from_path(&e.path);
                // same time and size: unchanged; otherwise compare the texts (e.g. after putting it
                // back; always for an earlier text, whose time is the earlier version's)
                let same_text = || rel_ok(&e.path) && self.contents.get(&e.path).is_some_and(|t| read_text(&file_in(&dir, &e.path, e.before)).ok().flatten().as_ref() == Some(t));
                let now = match self.files.get(&e.path) {
                    None => "gone",
                    Some(st) if e.before == 0 && st.mtime_ns == e.mtime_ns && st.size == e.size => "same",
                    Some(_) if same_text() => "same",
                    Some(_) => "changed",
                };
                CopyNote { path: e.path.clone(), name, journal, bytes: e.size, changed: e.mtime_ns / 1_000_000_000, now, before: e.before }
            })
            .collect();
        Ok(CopyView { id: id.into(), when: l.when, notes, skipped: l.skipped.iter().map(|e| (e.path.clone(), e.why.clone())).collect() })
    }

    /// A note's text in a copy (`before` > 0: one of its earlier texts): only an entry the copy's list
    /// names, read from inside that copy. Also that entry's file time (seconds).
    fn copy_text(&self, data: &Path, id: &str, path: &str, before: u32) -> Result<(List, u64, String), String> {
        let (dir, l) = self.open_copy(data, id)?;
        let Some(e) = l.files.iter().find(|e| e.path == path && e.before == before).filter(|_| rel_ok(path)) else {
            return Err("That note isn’t in this safety copy.".into());
        };
        let changed = e.mtime_ns / 1_000_000_000;
        match read_text(&file_in(&dir, path, before)) {
            Ok(Some(t)) => Ok((l, changed, t)),
            _ => Err("That note’s copy is missing or damaged.".into()),
        }
    }

    /// A note as a copy has it (read-only), compared with the note now.
    pub fn safety_note(&self, data: &Path, id: &str, path: &str, before: u32) -> Result<CopyText, String> {
        let (l, changed, text) = self.copy_text(data, id, path, before)?;
        Ok(CopyText {
            path: path.into(),
            name: self.vault.title_from_path(path).0,
            when: l.when,
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
        self.write_page(path, &text)?;
        Ok(Restored { name, path: path.into(), changed: true })
    }
}

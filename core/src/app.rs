//! App-level operations shared by the Tauri app and the dev server.
//! Everything the UI can ask for lives here, as plain functions over `App`.

use crate::{content_hash, join_doc, split_doc, Config, Doc, DocBlock, PageInfo, RefGroup, SearchHit, Vault};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

pub type Date = (i32, u32, u32);

/// Where the app may keep its index cache and problems log (set once by the Tauri shell).
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();
pub fn set_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}
pub fn cache_dir() -> Option<PathBuf> {
    CACHE_DIR.get().cloned()
}

/// Where the app keeps files that must last (the safety copies): not the cache, which Android may
/// clear, and never inside the notes folder (set once by the Tauri shell / the dev server).
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
pub fn set_data_dir(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}
pub fn data_dir() -> Option<PathBuf> {
    DATA_DIR.get().cloned()
}

pub mod pictures;
pub mod safety;

/// The notes folder last opened in the app (used by quick capture outside the app), or what's wrong
/// in words for him: never chosen, or chosen but out of reach right now (Google Drive not running).
pub fn last_vault_or_why() -> Result<PathBuf, String> {
    let never = || "Open Lean Outliner once and choose your notes folder first.".to_string();
    let file = CACHE_DIR.get().ok_or_else(never)?.join("last-vault.txt");
    let t = std::fs::read_to_string(file).map_err(|_| never())?;
    if t.trim().is_empty() {
        return Err(never());
    }
    let p = PathBuf::from(t.trim());
    if p.is_dir() {
        Ok(p)
    } else {
        Err(format!("Your notes folder ({}) can’t be reached right now. If it’s on Google Drive, check that Drive is running.", p.display()))
    }
}

fn remember_vault(root: &Path) {
    if let Some(d) = CACHE_DIR.get() {
        let _ = std::fs::create_dir_all(d);
        let _ = std::fs::write(d.join("last-vault.txt"), root.display().to_string());
    }
}
const CACHE_VERSION: u32 = 2;

/// What we know about a file without reading it: change time and size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamp {
    pub mtime_ns: u64,
    pub size: u64,
}

pub struct App {
    pub root: PathBuf,
    pub vault: Vault,
    /// Stamp of every indexed file, as last read.
    files: HashMap<String, Stamp>,
    /// Text of every readable file (feeds the cache, so the next start needs no reading).
    contents: HashMap<String, String>,
    /// Files that are not valid UTF-8: shown, never saved over.
    non_utf8: HashSet<String>,
    cache_dirty: bool,
    /// Earlier texts (path, its stamp then, text) that changes made elsewhere replaced or removed,
    /// not yet in a safety copy (safety.rs): found at start-up from the index cache, or while open.
    replaced: Vec<(String, Stamp, String)>,
    /// false: opened only to read (the health check, the capture box): the index cache is never
    /// written, so the app's own cache stays as the app left it
    keep_cache: bool,
}

#[derive(Serialize)]
pub struct VaultSummary {
    pub root: String,
    pub pages: usize,
    pub config: Config,
}

#[derive(Serialize)]
pub struct PageView {
    pub info: PageInfo,
    pub doc: Doc,
    /// Hash of the file as read (empty when the file doesn't exist yet).
    pub hash: String,
    pub refs: Vec<RefGroup>,
    pub tagged: Vec<String>,
    /// The file isn't UTF-8 text; it can be read but not saved from the app.
    pub readonly: bool,
    /// The doc was pre-filled from the journal template (nothing is saved until edited).
    pub from_template: bool,
    /// Why the page is read-only, when its file couldn't be read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// See `App::clash`.
#[derive(Serialize)]
pub struct Clash {
    pub hash: String,
    pub theirs: Doc,
    pub parts: Option<Vec<crate::merge::Part>>,
    pub preamble: Option<[String; 3]>,
}

#[derive(Deserialize)]
pub struct SaveReq {
    pub name: String,
    pub doc: Doc,
    pub base_hash: String,
    #[serde(default)]
    pub force: bool,
    /// The file the editor opened: a save never goes to a different file.
    #[serde(default)]
    pub path: Option<String>,
    /// The page as it was opened, so changes made elsewhere meanwhile can be merged in.
    #[serde(default)]
    pub base: Option<Doc>,
}

#[derive(Serialize)]
pub struct SaveRes {
    pub ok: bool,
    pub hash: String,
    /// true when the file changed on disk since it was opened (nothing written).
    pub conflict: bool,
    /// The file had changed elsewhere, in other places than this edit: both were kept, and
    /// this is the page as now saved (the editor continues from it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged: Option<Doc>,
}

#[derive(Serialize)]
pub struct JournalDay {
    pub name: String,
    pub date: Date,
    pub exists: bool,
}

/// Where a note for a page goes (`App::page_target`).
#[derive(Debug, Clone, PartialEq)]
pub struct PageTarget {
    /// the page's name as the app shows it
    pub name: String,
    /// its file, vault-relative
    pub rel: String,
    /// the file is there
    pub exists: bool,
    /// a journal day
    pub journal: bool,
    /// a new page whose file name can't hold its name: its first line is `title:: <name>`
    pub title: Option<String>,
}

#[derive(Serialize)]
pub struct RenameRes {
    pub name: String,
    /// Other files whose links were updated.
    pub files_changed: usize,
    /// Files that link to the page but couldn't be updated (not UTF-8 text).
    pub skipped: Vec<String>,
}

#[derive(Serialize)]
pub struct Recycled {
    /// File name inside `logseq/.recycle`.
    pub file: String,
    /// Page name it had (a picture: its file name).
    pub name: String,
    /// Seconds since 1970 when it was deleted (file time).
    pub when: u64,
    /// A picture moved there from assets: where "Put back" puts it (its path in the notes folder).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
}

#[derive(Debug)]
enum ReadErr {
    /// Exists but isn't UTF-8 text.
    NotText,
    /// Exists (or might) but couldn't be read: offline cloud file, locked, no permission…
    Io(String),
}

impl ReadErr {
    fn say(&self, what: &str) -> String {
        match self {
            ReadErr::NotText => format!("{what} isn't plain UTF-8 text, so it isn't changed from here (to keep it safe)."),
            ReadErr::Io(e) => format!("Couldn't read {what} ({e}), so nothing was changed. If it's in Google Drive, check it's available offline."),
        }
    }
}

/// File text: Ok(None) only if the file really doesn't exist. Any other read problem is an
/// error, so a file that can't be read is never mistaken for an empty one and overwritten.
fn read_text(p: &Path) -> Result<Option<String>, ReadErr> {
    match std::fs::read(p) {
        Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| ReadErr::NotText),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(ReadErr::Io(e.to_string())),
    }
}

fn stamp_of(md: &std::fs::Metadata) -> Stamp {
    let mtime_ns = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64);
    Stamp { mtime_ns, size: md.len() }
}

/// Write a file safely: to a hidden temp file next to it, then rename over it, so a crash
/// never leaves half a page. Falls back to a direct write where renaming over isn't allowed.
pub fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    write_atomic_checked(path, text, Expect::Anything).map(|_| ())
}

/// What a file must still hold right before `write_atomic_checked` replaces it.
pub enum Expect<'a> {
    /// no check
    Anything,
    /// the file isn't there
    Missing,
    /// exactly these bytes
    Bytes(&'a [u8]),
}

/// `write_atomic`, but only if the file still holds what's `expect`ed when the new text is ready to
/// replace it (checked again just before the rename): Ok(false) when someone else saved it
/// meanwhile (nothing written; read it again and redo the change). The temp file has a name of
/// its own (process and a counter), so two programs writing the same page never swap texts; a
/// rename that fails (Google Drive or a virus checker holding the file for a moment) is tried
/// again for about half a second before the direct write that some synced drives need.
pub fn write_atomic_checked(path: &Path, text: &str, expect: Expect) -> Result<bool, String> {
    static N: AtomicUsize = AtomicUsize::new(0);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let _ = std::panic::catch_unwind(|| sweep_tmp(dir));
    }
    let fname = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    // hidden (a leading dot), so other apps and the app's own scan ignore it
    let tmp = path.with_file_name(format!(".{fname}.{}-{}.tmp", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    std::fs::write(&tmp, text).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Couldn't write the page: {e}")
    })?;
    let still = || match (&expect, std::fs::read(path)) {
        (Expect::Anything, _) => true,
        (Expect::Missing, Err(e)) => e.kind() == std::io::ErrorKind::NotFound,
        (Expect::Bytes(b), Ok(now)) => now == *b,
        _ => false,
    };
    if !still() {
        let _ = std::fs::remove_file(&tmp);
        return Ok(false);
    }
    let mut last = None;
    for i in 0..6 {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if !still() {
                let _ = std::fs::remove_file(&tmp);
                return Ok(false);
            }
        }
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(true),
            Err(e) => last = Some(e),
        }
    }
    // some synced drives refuse to replace a file by renaming: write it in place
    let _ = std::fs::remove_file(&tmp);
    if !still() {
        return Ok(false);
    }
    let e = last.map(|e| e.to_string()).unwrap_or_default();
    std::fs::write(path, text).map_err(|e2| format!("Couldn't save the page: {e} / {e2}"))?;
    Ok(true)
}

/// Is `name` one of this app's temp files (`.<file>.<process>-<n>.tmp`, `write_atomic_checked`)?
pub fn is_own_tmp(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.').and_then(|r| r.strip_suffix(".tmp")) else { return false };
    let Some((file, tag)) = rest.rsplit_once('.') else { return false };
    let Some((pid, n)) = tag.split_once('-') else { return false };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    !file.is_empty() && !file.starts_with('.') && digits(pid) && digits(n)
}

/// Remove this app's own temp files older than a day in `dir` (left by a crash or a power cut
/// between writing and renaming): only names exactly like `is_own_tmp`, once per folder per run.
fn sweep_tmp(dir: &Path) {
    static DONE: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
    if !DONE.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert_with(HashSet::new).insert(dir.to_path_buf()) {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let day = std::time::Duration::from_secs(24 * 3600);
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !is_own_tmp(&name) {
            continue;
        }
        let old = e.metadata().ok().filter(|m| m.is_file()).and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age > day);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Keep how the original file ended: with a final line break or without one,
/// and with its byte-order mark if it had one.
fn keep_shape(orig: Option<&str>, mut text: String, crlf: bool) -> String {
    let nl = if crlf { "\r\n" } else { "\n" };
    match orig {
        Some(o) if !o.is_empty() && !o.ends_with('\n') => {
            if text.ends_with('\n') {
                text.truncate(text.len() - if text.ends_with("\r\n") { 2 } else { 1 });
            }
        }
        _ => {
            if !text.is_empty() && !text.ends_with('\n') {
                text.push_str(nl);
            }
        }
    }
    if orig.is_some_and(|o| o.starts_with('\u{feff}')) && !text.starts_with('\u{feff}') {
        text.insert(0, '\u{feff}');
    }
    text
}

/// Every `.md` file in the pages and journals folders, with stamps. Uses the directory
/// listing only (no per-file calls on Windows), which matters on Google Drive's virtual drive.
fn scan(root: &Path, cfg: &Config) -> HashMap<String, Stamp> {
    let mut m = HashMap::new();
    for sub in [&cfg.pages_dir, &cfg.journals_dir] {
        let mut stack = vec![root.join(sub)];
        while let Some(d) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&d) else { continue };
            for e in rd.flatten() {
                let name = e.file_name();
                let name = name.to_string_lossy();
                if name.starts_with('.') {
                    continue; // hidden: our temp files, .DS_Store, …
                }
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_dir() {
                    stack.push(e.path());
                } else if name.ends_with(".md") {
                    let Ok(md) = e.metadata() else { continue };
                    if let Ok(rel) = e.path().strip_prefix(root) {
                        m.insert(rel.to_string_lossy().replace('\\', "/"), stamp_of(&md));
                    }
                }
            }
        }
    }
    m
}

/// Read many files at once (Drive's virtual drive answers in parallel much faster).
/// Returns (rel, text, is_utf8); unreadable files are left out.
fn read_parallel(root: &Path, rels: &[String]) -> Vec<(String, String, bool)> {
    let n = rels.len();
    let next = AtomicUsize::new(0);
    let out = Mutex::new(Vec::with_capacity(n));
    std::thread::scope(|s| {
        for _ in 0..n.clamp(1, 8) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                if i >= n {
                    break;
                }
                if let Ok(bytes) = std::fs::read(root.join(&rels[i])) {
                    let item = match String::from_utf8(bytes) {
                        Ok(t) => (rels[i].clone(), t, true),
                        Err(e) => (rels[i].clone(), String::from_utf8_lossy(e.as_bytes()).into_owned(), false),
                    };
                    out.lock().unwrap_or_else(|p| p.into_inner()).push(item);
                }
            });
        }
    });
    out.into_inner().unwrap_or_else(|p| p.into_inner())
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    v: u32,
    root: String,
    files: Vec<(String, Stamp, String)>,
}

fn cache_path(root: &Path) -> Option<PathBuf> {
    Some(CACHE_DIR.get()?.join(format!("vault-{}.json", content_hash(&root.display().to_string()))))
}

fn load_cache(root: &Path) -> HashMap<String, (Stamp, String)> {
    let Some(p) = cache_path(root) else { return HashMap::new() };
    let Ok(bytes) = std::fs::read(&p) else { return HashMap::new() };
    match serde_json::from_slice::<CacheFile>(&bytes) {
        Ok(c) if c.v == CACHE_VERSION && c.root == root.display().to_string() => {
            c.files.into_iter().map(|(r, st, t)| (r, (st, t))).collect()
        }
        _ => HashMap::new(),
    }
}

/// What a rescan needs, copied out so the slow part can run without holding the app.
pub struct ScanPlan {
    root: PathBuf,
    cfg: Config,
    files: HashMap<String, Stamp>,
}

/// Files that changed on disk, already read.
pub struct Changes {
    now: HashMap<String, Stamp>,
    read: Vec<(String, String, bool)>,
    removed: Vec<String>,
    base: HashMap<String, Stamp>,
}

/// Scan the folders and read changed files (no app lock needed).
pub fn collect_changes(plan: ScanPlan) -> Changes {
    let now = scan(&plan.root, &plan.cfg);
    let to_read: Vec<String> = now.iter().filter(|(r, st)| plan.files.get(*r) != Some(st)).map(|(r, _)| r.clone()).collect();
    let removed: Vec<String> = plan.files.keys().filter(|r| !now.contains_key(*r)).cloned().collect();
    let read = read_parallel(&plan.root, &to_read);
    Changes { now, read, removed, base: plan.files }
}

/// A name the user typed for a page: trimmed, one line, not empty.
fn clean_name(s: &str) -> Result<String, String> {
    let n = s.trim();
    if n.is_empty() {
        return Err("The name is empty.".into());
    }
    if n.contains(['\n', '\r']) {
        return Err("A page name has to fit on one line.".into());
    }
    if n.contains("[[") || n.contains("]]") {
        return Err("A page name can't contain [[ or ]].".into());
    }
    Ok(n.to_string())
}

/// Minimal base64 decoder (standard alphabet, padding optional, whitespace ignored).
fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    let s = s.split_once("base64,").map_or(s, |(_, d)| d); // accept data: URLs
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return Err("The file data is damaged.".into()),
        } as u32;
        buf = buf << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

/// Apply a page rename to one file's text. None when nothing changed.
fn rename_in_text(text: &str, olds: &[String], new: &str, comma: &[String]) -> Option<String> {
    let mut doc = split_doc(text);
    let mut changed = false;
    if let Some(p) = crate::text::rename_refs(&doc.preamble, olds, new, comma) {
        doc.preamble = p;
        changed = true;
    }
    for b in &mut doc.blocks {
        if let Some(t) = crate::text::rename_refs(&b.text, olds, new, comma) {
            b.text = t;
            changed = true;
        }
    }
    changed.then(|| keep_shape(Some(text), join_doc(&doc), doc.crlf))
}

/// Set an existing `title::` property (preamble or a properties-only first block) to `new`.
fn set_title_prop(text: &str, new: &str) -> String {
    let mut doc = split_doc(text);
    let fix = |s: &str| -> Option<String> {
        let mut changed = false;
        let lines: Vec<String> = s
            .split('\n')
            .map(|l| {
                let t = l.trim_start();
                if t.to_lowercase().starts_with("title::") {
                    changed = true;
                    let lead = &l[..l.len() - t.len()];
                    let cr = if l.ends_with('\r') { "\r" } else { "" };
                    format!("{lead}title:: {new}{cr}")
                } else {
                    l.to_string()
                }
            })
            .collect();
        changed.then(|| lines.join("\n"))
    };
    if let Some(p) = fix(&doc.preamble) {
        doc.preamble = p;
    } else if let Some(b) = doc.blocks.first_mut() {
        if let Some(t) = fix(&b.text) {
            b.text = t;
        }
    }
    keep_shape(Some(text), join_doc(&doc), doc.crlf)
}

/// Give a page's text the `title::` property it lacks: with its page properties at the top (after
/// a YAML header), or in Logseq's properties-only first block, else as a new first line. Nothing
/// else in the file changes.
fn add_title_prop(text: &str, new: &str) -> String {
    let mut doc = split_doc(text);
    let nl = if doc.crlf { "\r\n" } else { "\n" };
    let pre: Vec<&str> = doc.preamble.split_inclusive('\n').collect();
    let fm = crate::doc::front_matter_len(&pre).unwrap_or(0);
    let props_on_top = pre[fm..].iter().any(|l| crate::parse::property(l.trim_end_matches(['\n', '\r'])).is_some());
    let props_block = |b: &DocBlock| {
        let lines: Vec<&str> = b.text.split('\n').map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
        b.depth == 0 && !b.plain && !lines.is_empty() && lines.iter().all(|l| crate::parse::property(l).is_some())
    };
    match doc.blocks.first_mut() {
        Some(b) if fm == 0 && !props_on_top && props_block(b) => b.text = format!("title:: {new}\n{}", b.text),
        _ => {
            let mut p: String = pre[..fm].concat();
            if !p.is_empty() && !p.ends_with('\n') {
                p.push_str(nl);
            }
            p.push_str(&format!("title:: {new}{nl}"));
            p.push_str(&pre[fm..].concat());
            doc.preamble = p;
        }
    }
    keep_shape(Some(text), join_doc(&doc), doc.crlf)
}

impl App {
    pub fn open(root: &Path) -> Result<App, String> {
        Self::load(root, true)
    }

    /// Open a notes folder only to read it (the health check, the Windows capture box): the index
    /// cache is used, so only files changed since are read, but never written (nor a safety copy
    /// made). A `logseq/config.edn` that is there but can't be read stops it (as
    /// `capture::read_config` does): pages and journal days are never placed by guessed settings.
    pub fn open_read_only(root: &Path) -> Result<App, String> {
        Self::load(root, false)
    }

    /// Open a notes folder; `keep_cache`: write the index cache (the app itself; it still opens with
    /// Logseq's defaults when config.edn can't be read). Not for the read-only opens, which would
    /// otherwise make the cache forget texts that changes made elsewhere replaced, before the app
    /// has put them in a safety copy.
    fn load(root: &Path, keep_cache: bool) -> Result<App, String> {
        if !root.is_dir() {
            return Err(format!("Folder not found: {}", root.display()));
        }
        let cfg = if keep_cache {
            read_config(root)
        } else {
            crate::capture::read_config(root).map_err(|e| format!("Couldn't read logseq/config.edn ({e}). If it's on Google Drive, check it's available offline."))?
        };
        let stamps = scan(root, &cfg);
        let mut cache = load_cache(root);
        let cache_had = cache.len();
        let mut contents = HashMap::new();
        let mut to_read = vec![];
        // what the cache held of files that changed while the app was closed (for the safety copy)
        let mut earlier: HashMap<String, (Stamp, String)> = HashMap::new();
        for (rel, st) in &stamps {
            match cache.remove(rel) {
                Some((cst, text)) if cst == *st => {
                    contents.insert(rel.clone(), text);
                }
                Some(old) => {
                    earlier.insert(rel.clone(), old);
                    to_read.push(rel.clone());
                }
                None => to_read.push(rel.clone()),
            }
        }
        // the rest of the cache: files gone since (removed, renamed or moved elsewhere)
        let mut replaced: Vec<(String, Stamp, String)> = cache.into_iter().map(|(r, (st, t))| (r, st, t)).collect();
        let mut non_utf8 = HashSet::new();
        let mut files = HashMap::new();
        for (rel, text, utf8) in read_parallel(root, &to_read) {
            if !utf8 {
                non_utf8.insert(rel.clone());
            }
            if let Some((st, old)) = earlier.remove(&rel) {
                if !utf8 || old != text {
                    replaced.push((rel.clone(), st, old));
                }
            }
            contents.insert(rel, text);
        }
        replaced.extend(earlier.into_iter().map(|(r, (st, t))| (r, st, t))); // changed, and unreadable now
        // index in a fixed order, so which file wins a duplicated page name is stable
        let mut rels: Vec<&String> = contents.keys().collect();
        rels.sort();
        let mut vault = Vault::with_config(cfg);
        for rel in rels {
            vault.upsert(rel, &contents[rel]);
            files.insert(rel.clone(), stamps[rel]);
        }
        for rel in &non_utf8 {
            contents.remove(rel); // never cache text we couldn't read exactly
        }
        let cache_dirty = !to_read.is_empty() || cache_had != contents.len();
        let mut app = App { root: root.to_path_buf(), vault, files, contents, non_utf8, cache_dirty, replaced: vec![], keep_cache };
        app.write_cache(); // (not when opened only to read: see write_cache)
        app.replaced = replaced; // for the safety copy made next (start_safety_copy)
        Ok(app)
    }

    /// Persist file texts so the next start only reads files that changed. The cache forgets the
    /// earlier texts that changes made elsewhere replaced, so those go into a safety copy first.
    fn write_cache(&mut self) {
        if !self.keep_cache {
            return; // opened only to read: nothing is written, not the cache, not a safety copy
        }
        self.keep_replaced();
        if !self.cache_dirty {
            return;
        }
        let Some(p) = cache_path(&self.root) else { return };
        let mut files: Vec<(String, Stamp, String)> = self
            .contents
            .iter()
            .filter_map(|(r, t)| Some((r.clone(), *self.files.get(r)?, t.clone())))
            .collect();
        files.sort_by(|a, b| a.0.cmp(&b.0));
        let c = CacheFile { v: CACHE_VERSION, root: self.root.display().to_string(), files };
        if let Ok(bytes) = serde_json::to_vec(&c) {
            let _ = std::fs::create_dir_all(p.parent().unwrap_or(Path::new(".")));
            let tmp = p.with_extension("tmp");
            if std::fs::write(&tmp, bytes).is_ok() && std::fs::rename(&tmp, &p).is_ok() {
                self.cache_dirty = false;
            }
        }
    }

    pub fn summary(&self) -> VaultSummary {
        VaultSummary { root: self.root.display().to_string(), pages: self.vault.page_count(), config: self.vault.config.clone() }
    }

    /// Snapshot for a rescan (cheap): see `collect_changes` and `apply_changes`.
    pub fn scan_plan(&self) -> ScanPlan {
        ScanPlan { root: self.root.clone(), cfg: self.vault.config.clone(), files: self.files.clone() }
    }

    /// Take in files that changed on disk. Files the app itself wrote since the snapshot are
    /// left alone (their newer state is already indexed). Returns the changed paths.
    pub fn apply_changes(&mut self, ch: Changes) -> Vec<String> {
        let mut changed = vec![];
        for (rel, text, utf8) in ch.read {
            if self.files.get(&rel) != ch.base.get(&rel) {
                continue; // saved by us meanwhile
            }
            if !utf8 || self.contents.get(&rel).is_some_and(|old| *old != text) {
                self.note_replaced(&rel);
            }
            self.vault.upsert(&rel, &text);
            self.files.insert(rel.clone(), ch.now[&rel]);
            if utf8 {
                self.non_utf8.remove(&rel);
                self.contents.insert(rel.clone(), text);
            } else {
                self.non_utf8.insert(rel.clone());
                self.contents.remove(&rel);
            }
            changed.push(rel);
        }
        for rel in ch.removed {
            if self.files.get(&rel) != ch.base.get(&rel) {
                continue;
            }
            self.note_replaced(&rel);
            self.vault.remove(&rel);
            self.files.remove(&rel);
            self.contents.remove(&rel);
            self.non_utf8.remove(&rel);
            changed.push(rel);
        }
        if !changed.is_empty() {
            self.cache_dirty = true;
        }
        // small changes are re-read cheaply at the next start; only big syncs are worth
        // rewriting the whole cache now (saves flash writes on the phone)
        if changed.len() >= 20 {
            self.write_cache();
        }
        changed
    }

    /// A change made elsewhere is about to replace (or remove) this file's text: keep the text as it
    /// was for the next safety copy (every one, also several of the same note; within the copies'
    /// limits: 500 texts, 25 MB).
    fn note_replaced(&mut self, rel: &str) {
        let (Some(st), Some(text)) = (self.files.get(rel), self.contents.get(rel)) else { return };
        let bytes: usize = self.replaced.iter().map(|(_, _, t)| t.len()).sum();
        if self.replaced.len() < 500 && bytes + text.len() <= 25 << 20 {
            self.replaced.push((rel.to_string(), *st, text.clone()));
        }
    }

    /// Save the index cache if anything changed (the app calls this when it's put away).
    pub fn persist(&mut self) {
        self.write_cache();
    }

    /// Pick up files changed by sync, Claude or other apps. Returns the changed paths.
    pub fn rescan(&mut self) -> Vec<String> {
        let ch = collect_changes(self.scan_plan());
        self.apply_changes(ch)
    }

    /// A page as the editor needs it. A journal day without a file starts from the
    /// journal template (`:default-templates`), when one is set; `now` fills its variables.
    pub fn page(&self, name: &str, now: Option<(Date, String)>) -> PageView {
        let info = self.vault.page_info(name);
        let path = info.path.as_ref().map(|p| self.root.join(p));
        let mut error = None;
        let (text, readonly) = match path.as_deref().map(read_text) {
            Some(Ok(t)) => (t, false),
            Some(Err(ReadErr::NotText)) => (path.as_deref().and_then(|p| std::fs::read(p).ok()).map(|b| String::from_utf8_lossy(&b).into_owned()), true),
            Some(Err(e)) => {
                error = Some(e.say("this page's file"));
                (None, true)
            }
            None => (None, false),
        };
        let hash = text.as_deref().map(content_hash).unwrap_or_default();
        let mut doc = split_doc(text.as_deref().unwrap_or(""));
        let mut from_template = false;
        if text.is_none() && info.journal.is_some() && !self.vault.config.journal_template.is_empty() {
            let (today, time) = now.unwrap_or(((1970, 1, 1), String::new()));
            if let Some(blocks) = self.template(&self.vault.config.journal_template.clone(), &info.name, today, &time) {
                doc.blocks = blocks;
                from_template = !doc.blocks.is_empty();
            }
        }
        PageView { refs: self.vault.linked_refs(name), tagged: self.vault.pages_tagged(name), info, doc, hash, readonly, from_template, error }
    }

    fn record_write(&mut self, rel: &str, text: &str) {
        self.vault.upsert(rel, text);
        if let Ok(md) = std::fs::metadata(self.root.join(rel)) {
            self.files.insert(rel.to_string(), stamp_of(&md));
        }
        self.contents.insert(rel.to_string(), text.to_string());
        self.non_utf8.remove(rel);
        self.cache_dirty = true;
    }

    fn forget(&mut self, rel: &str) {
        self.vault.remove(rel);
        self.files.remove(rel);
        self.contents.remove(rel);
        self.non_utf8.remove(rel);
        self.cache_dirty = true;
    }

    /// Write a page file safely and update the index.
    fn write_page(&mut self, rel: &str, text: &str) -> Result<(), String> {
        write_atomic(&self.root.join(rel), text)?;
        self.record_write(rel, text);
        Ok(())
    }

    pub fn save(&mut self, req: SaveReq) -> Result<SaveRes, String> {
        let info = self.vault.page_info(&req.name);
        let rel = info.path.ok_or("page has no path")?;
        if req.path.as_ref().is_some_and(|p| *p != rel) {
            // the name now belongs to another file (renamed, or a duplicate name took over)
            return Err("This page's file changed (it was renamed or moved), so nothing was saved. Open the page again.".into());
        }
        let path = self.root.join(&rel);
        let current = read_text(&path).map_err(|e| e.say("this page's file"))?;
        let cur_hash = current.as_deref().map(content_hash).unwrap_or_default();
        let mut doc = req.doc;
        let mut merged = None;
        if cur_hash != req.base_hash {
            if req.force {
                // "Keep mine": the other version goes to logseq/bak first, so nothing is lost
                if let Some(c) = &current {
                    self.backup(&rel, c)?;
                }
            } else {
                let theirs = split_doc(current.as_deref().unwrap_or(""));
                match req.base.as_ref().and_then(|b| crate::merge::merge_docs(b, &doc, &theirs)) {
                    Some(m) => {
                        doc = m;
                        merged = Some(());
                    }
                    None => return Ok(SaveRes { ok: false, hash: cur_hash, conflict: true, merged: None }),
                }
            }
        }
        let text = join_doc(&doc);
        // a brand-new page with only an empty bullet is not worth a file
        if current.is_none() && text.trim().trim_start_matches('-').trim().is_empty() {
            return Ok(SaveRes { ok: true, hash: String::new(), conflict: false, merged: None });
        }
        let mut text = keep_shape(current.as_deref(), text, doc.crlf);
        if current.is_none() && info.journal.is_none() && !doc.preamble.to_lowercase().contains("title::") {
            // like Logseq: a name the file name can't hold exactly gets a title:: property
            let stem = rel.rsplit('/').next().unwrap_or(&rel).trim_end_matches(".md");
            if self.vault.title_from_path(&format!("{}/{stem}.md", self.vault.config.pages_dir)).0 != info.name {
                text = format!("title:: {}\n{}", info.name, text);
            }
        }
        if current.is_none() {
            // a new page: its own file (Vault::free_rel), written only where no file is yet; one
            // that turned up meanwhile is a clash like any change made elsewhere
            if !write_atomic_checked(&path, &text, Expect::Missing)? {
                let now = read_text(&path).ok().flatten();
                return Ok(SaveRes { ok: false, hash: now.as_deref().map(content_hash).unwrap_or_default(), conflict: true, merged: None });
            }
            self.record_write(&rel, &text);
        } else {
            self.write_page(&rel, &text)?;
        }
        let merged = merged.map(|_| split_doc(&text));
        Ok(SaveRes { ok: true, hash: content_hash(&text), conflict: false, merged })
    }

    /// Keep a copy of a page's text in `logseq/bak/<file>/<time>.md` (Logseq's backup place); a
    /// second copy within the same second gets "-2", "-3"… (never overwrites one).
    fn backup(&self, rel: &str, text: &str) -> Result<(), String> {
        let stem = rel.trim_end_matches(".md");
        let stamp = crate::log::now_utc().replace([' ', ':'], "_").replace("_UTC", "");
        let dir = self.root.join("logseq").join("bak").join(stem);
        let mut p = dir.join(format!("{stamp}.md"));
        let mut n = 2;
        while p.exists() {
            p = dir.join(format!("{stamp}-{n}.md"));
            n += 1;
        }
        write_atomic(&p, text).map_err(|e| format!("Couldn't keep a backup copy, so nothing was saved: {e}"))
    }

    /// A page changed here (`mine`) and in its file (by another app) since `base`, in the same
    /// places: the file's version and the page in parts, for choosing note by note (the clash
    /// screen). `parts` is None when the page is too big to compare; `preamble` is set when both
    /// changed the page properties differently (base, mine, theirs). `path`: the file the editor
    /// opened (as for `save`: never another file's version).
    pub fn clash(&self, name: &str, mine: &Doc, base: &Doc, path: Option<&str>) -> Result<Clash, String> {
        let rel = self.vault.page_info(name).path.ok_or("page has no path")?;
        if path.is_some_and(|p| p != rel) {
            return Err("This page's file changed (it was renamed or moved), so the two versions can't be compared.".into());
        }
        let current = read_text(&self.root.join(&rel)).map_err(|e| e.say("this page's file"))?.unwrap_or_default();
        let theirs = split_doc(&current);
        let parts = crate::merge::clash_parts(&base.blocks, &mine.blocks, &theirs.blocks);
        let (b, m, t) = (&base.preamble, &mine.preamble, &theirs.preamble);
        let preamble = (m != b && t != b && m != t).then(|| [b.clone(), m.clone(), t.clone()]);
        Ok(Clash { hash: content_hash(&current), theirs, parts, preamble })
    }

    /// Keep a copy of the editor's version before it's thrown away ("Load the new version").
    pub fn backup_doc(&self, name: &str, doc: &Doc) -> Result<(), String> {
        let rel = self.vault.page_info(name).path.ok_or("page has no path")?;
        self.backup(&rel, &join_doc(doc))
    }

    /// Replace one block's text, found by its line, if it still reads `base` on disk.
    /// Used by lists that edit pages which aren't open (to-dos, unlinked references).
    pub fn save_block(&mut self, name: &str, line: usize, base: &str, text: &str) -> Result<SaveRes, String> {
        let info = self.vault.page_info(name);
        let rel = info.path.filter(|_| info.exists).ok_or("That page has no file.")?;
        let path = self.root.join(&rel);
        let cur = read_text(&path).map_err(|e| e.say("that page's file"))?.ok_or("That page's file is gone.")?;
        let mut doc = split_doc(&cur);
        let lines = crate::block_lines(&doc);
        let Some(i) = lines.iter().position(|&l| l == line).filter(|&i| doc.blocks[i].text == base) else {
            return Ok(SaveRes { ok: false, hash: content_hash(&cur), conflict: true, merged: None });
        };
        doc.blocks[i].text = text.to_string();
        let out = keep_shape(Some(&cur), join_doc(&doc), doc.crlf);
        self.write_page(&rel, &out)?;
        Ok(SaveRes { ok: true, hash: content_hash(&out), conflict: false, merged: None })
    }

    /// Turn the first plain mention of `target` (or an alias) in a block into a `[[link]]`.
    pub fn link_mention(&mut self, page: &str, line: usize, base: &str, target: &str) -> Result<SaveRes, String> {
        let names = self.vault.mention_names(target);
        let new = crate::text::link_first_mention(base, &names).ok_or("That mention is no longer there.")?;
        self.save_block(page, line, base, &new)
    }

    /// Whether a journal day has something written in it (an empty file, or one holding just
    /// "-", doesn't count). A day whose text isn't loaded counts as written.
    fn journal_has_text(&self, d: Date) -> bool {
        let rel = self.vault.config.journal_rel_path(d);
        self.contents.get(&rel).map_or(true, |t| !t.trim().trim_start_matches('-').trim().is_empty())
    }

    /// Journal days with something written in them, oldest first (the dots in "Go to date").
    pub fn journal_days(&self) -> Vec<Date> {
        self.vault.journal_dates().into_iter().filter(|d| self.journal_has_text(*d)).collect()
    }

    pub fn journal_name(&self, d: Date) -> String {
        self.vault.config.journal_title(d)
    }

    /// The `count` journal days ending at `end` (inclusive), newest first. Today is always
    /// included even without a file; other days only when they have a file.
    pub fn journals(&self, end: Date, count: usize, include_end: bool) -> Vec<JournalDay> {
        // like Logseq: past days whose file is empty (auto-created, or just "-") are skipped
        let mut days: Vec<Date> = self.vault.journal_dates().into_iter().filter(|d| *d <= end).filter(|d| *d == end || self.journal_has_text(*d)).collect();
        if include_end && !days.contains(&end) {
            days.push(end);
        }
        days.sort();
        days.dedup();
        days.reverse();
        days.truncate(count);
        days.into_iter()
            .map(|d| {
                let name = self.journal_name(d);
                let exists = self.vault.page_info(&name).exists;
                JournalDay { name, date: d, exists }
            })
            .collect()
    }

    /// Add a bullet to the end of a page (creating the file if needed).
    pub fn append_to(&mut self, rel: &str, text: &str) -> Result<(), String> {
        let path = self.root.join(rel);
        let cur = read_text(&path).map_err(|e| e.say("that page's file"))?.unwrap_or_default();
        let out = crate::append_bullet(&cur, text);
        self.write_page(rel, &out)
    }

    /// Quick capture: add a bullet to a day's journal.
    pub fn append_journal(&mut self, d: Date, text: &str) -> Result<(), String> {
        let rel = self.vault.config.journal_rel_path(d);
        self.append_to(&rel, text)
    }

    /// Shared content → a bullet made from the quick capture template, added where
    /// `:quick-capture-options` says. Returns the page name it went to.
    pub fn capture(&mut self, text: &str, url: &str, media: bool, today: Date, time: &str) -> Result<String, String> {
        let cfg = self.vault.config.clone();
        let line = crate::capture::bullet(&cfg, text, url, media, today, time);
        if line.is_empty() {
            return Err("Nothing to add.".into());
        }
        if cfg.capture_today {
            self.append_to(&cfg.journal_rel_path(today), &line)?;
            return Ok(cfg.journal_title(today));
        }
        let t = self.page_target(&cfg.capture_page)?;
        if t.exists || t.journal {
            self.append_to(&t.rel, &line)?;
        } else {
            let text = self.create_page(&t, &line)?.ok_or_else(|| format!("Another file turned up at {} just now, so nothing was added. Try again.", t.rel))?;
            self.record_write(&t.rel, &text);
        }
        Ok(t.name)
    }

    /// The pages a note can be added to (the capture box's list): every page with a file or with
    /// links to it, not journal days, with its file's change time in seconds (0: no file yet).
    pub fn page_list(&self) -> Vec<(String, u64)> {
        self.vault
            .all_pages()
            .into_iter()
            .filter(|p| p.journal.is_none())
            .map(|p| {
                let secs = self.vault.page_info(&p.name).path.and_then(|r| self.files.get(&r).map(|s| s.mtime_ns / 1_000_000_000)).unwrap_or(0);
                (p.name, secs)
            })
            .collect()
    }

    /// Where a note for the page named `name` would go, as everywhere in the app (its file, read
    /// from `title::` too; an alias's page; the first file of a name two files share; a journal
    /// day for a journal title), or why a new page can't have that name. A new page gets a file of
    /// its own, as in the editor (`Vault::free_rel`: when its file name already holds another page,
    /// one named by its `title::`, the next free one, `<name> (2).md`…, with `title::`).
    pub fn page_target(&self, name: &str) -> Result<PageTarget, String> {
        let name = clean_name(name)?;
        let info = self.vault.page_info(&name);
        let rel = info.path.ok_or("That page has no file name.")?;
        let file = rel.rsplit('/').next().unwrap_or(&rel);
        if !info.exists && (file == ".md" || file.starts_with('.') || !file.ends_with(".md")) {
            return Err(format!("“{name}” can't be the name of a page (its file name would be empty or hidden)."));
        }
        // like a new page saved by the editor: a name the file name can't hold exactly gets title::
        let title = (!info.exists && info.journal.is_none() && self.vault.title_from_path(&rel).0 != info.name).then(|| info.name.clone());
        Ok(PageTarget { name: info.name, rel, exists: info.exists, journal: info.journal.is_some(), title })
    }

    /// A new page's first note (`t` from `page_target`): a file of its own, starting with
    /// `title::` when its file name can't hold its name, written only where no file is yet.
    /// Some(text written); None: a file turned up there meanwhile (look again).
    fn create_page(&self, t: &PageTarget, line: &str) -> Result<Option<String>, String> {
        let start = t.title.as_ref().map(|n| format!("title:: {n}\n")).unwrap_or_default();
        let text = crate::append_bullet(&start, line);
        let path = self.root.join(&t.rel);
        if write_atomic_checked(&path, &text, Expect::Missing)? {
            return Ok(Some(text));
        }
        // something is there now: a file saved meanwhile, or one that can't be read
        if let Err(e) = std::fs::read(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("Couldn't read {} ({e}), so nothing was added. If it's on Google Drive, check it's available offline.", t.rel));
            }
        }
        Ok(None)
    }

    /// The capture box: add a note to the page named `page`. Changes made elsewhere are taken in
    /// first, then the page is found as everywhere in the app (`page_target`); the note is added at
    /// its end, safely (`capture::append_note`), in the quick capture template, as a to-do if asked.
    /// A page that doesn't exist yet gets a new file, only if no file appeared there meanwhile
    /// (then it looks again: it may be this page now, or another page's file). Done as soon as the
    /// note is written: nothing after it can turn that into a failure. Returns the path written.
    #[allow(clippy::too_many_arguments)]
    pub fn capture_to_page(&mut self, page: &str, text: &str, url: &str, todo: bool, today: Date, time: &str) -> Result<String, String> {
        for _ in 0..3 {
            self.rescan();
            let t = self.page_target(page)?;
            let line = crate::capture::note_line(&self.vault.config, text, url, todo, today, time)?;
            if t.exists || t.journal {
                // its own file (a journal day's file that appears meanwhile is still that day)
                crate::capture::append_note(&self.root.join(&t.rel), &t.rel, "", &line)?;
                return Ok(t.rel);
            }
            if self.create_page(&t, &line)?.is_some() {
                return Ok(t.rel);
            }
        }
        Err(format!("Files named like “{page}” kept appearing while the note was being added, so nothing was added. Try again in a moment."))
    }

    pub fn search(&self, q: &str) -> Vec<SearchHit> {
        self.vault.search(q, 40)
    }

    /// Template blocks with `<% today %>`, `<% yesterday %>`, `<% tomorrow %>`,
    /// `<% time %>` and `<% current page %>` filled in.
    pub fn template(&self, name: &str, page: &str, today: Date, time: &str) -> Option<Vec<DocBlock>> {
        let blocks = self.vault.template_blocks(name)?;
        let cfg = &self.vault.config;
        let link = |d: Date| format!("[[{}]]", cfg.journal_title(d));
        let fill = |t: &str| -> String {
            let mut out = String::new();
            let mut rest = t;
            while let Some(i) = rest.find("<%") {
                out.push_str(&rest[..i]);
                let Some(j) = rest[i..].find("%>") else {
                    out.push_str(&rest[i..]);
                    rest = "";
                    break;
                };
                let var = rest[i + 2..i + j].trim().to_lowercase();
                let val = match var.as_str() {
                    "today" => Some(link(today)),
                    "yesterday" => Some(link(crate::date::add_days(today, -1))),
                    "tomorrow" => Some(link(crate::date::add_days(today, 1))),
                    "time" if !time.is_empty() => Some(time.to_string()),
                    "current page" => Some(format!("[[{page}]]")),
                    _ => None,
                };
                match val {
                    Some(v) => out.push_str(&v),
                    None => out.push_str(&rest[i..i + j + 2]),
                }
                rest = &rest[i + j + 2..];
            }
            out.push_str(rest);
            out
        };
        Some(blocks.into_iter().map(|(depth, text)| DocBlock { depth, text: fill(&text), raw: None, plain: false }).collect())
    }

    /// Rename a page: its file, its `title::` (if any) and every link to it in other files.
    pub fn rename(&mut self, old: &str, new: &str) -> Result<RenameRes, String> {
        let new = clean_name(new)?;
        let info = self.vault.page_info(old);
        if info.journal.is_some() {
            return Err("Journal pages are named after their date, so they can't be renamed.".into());
        }
        if self.vault.config.journal_from_title(&new).is_some() {
            return Err("That name looks like a journal date. Pick another name.".into());
        }
        let old_key = crate::key(&info.name);
        let new_key = crate::key(&new);
        if new_key != old_key {
            let other = self.vault.page_info(&new);
            if other.exists || self.vault.resolve(&new) != new_key {
                return Err(format!("There's already a page called “{}”. Pick another name.", other.name));
            }
        }
        let olds = vec![old_key.clone()];
        let comma = self.vault.config.comma_props.clone();
        let own_rel = info.path.clone().filter(|_| info.exists);
        // the new file name, next to the old one
        // (a file of its own, as for a new page: never another page's, `Vault::free_rel`)
        let new_rel = own_rel.as_ref().map(|rel| {
            let dir = rel.rsplit_once('/').map_or(self.vault.config.pages_dir.as_str(), |(d, _)| d).to_string();
            self.vault.free_rel(&format!("{dir}/{}.md", crate::file_stem_for(&new)), Some(rel))
        });
        if let (Some(r), Some(n)) = (&own_rel, &new_rel) {
            if r != n && crate::key(r) != crate::key(n) && self.root.join(n).exists() {
                return Err(format!("A file named “{}” already exists in your notes folder.", n));
            }
        }
        // 1. links in other files
        let mut changed = 0;
        let mut skipped = vec![];
        for src in self.vault.linking_pages(&info.name) {
            let Some(rel) = self.vault.path_of_key(&src) else { continue };
            if Some(&rel) == own_rel.as_ref() {
                continue;
            }
            match read_text(&self.root.join(&rel)) {
                Ok(Some(cur)) => {
                    if let Some(t) = rename_in_text(&cur, &olds, &new, &comma) {
                        self.write_page(&rel, &t)?;
                        changed += 1;
                    }
                }
                Ok(None) => {}
                Err(_) => skipped.push(rel),
            }
        }
        // 2. the page's own file: its self-links and title::, then the file name
        if let (Some(rel), Some(nrel)) = (own_rel, new_rel) {
            let path = self.root.join(&rel);
            let cur = read_text(&path).map_err(|e| e.say("this page's file"))?.unwrap_or_default();
            let text = rename_in_text(&cur, &olds, &new, &comma).unwrap_or_else(|| cur.clone());
            let text = if crate::parse::parse_page(&text, &comma).title.is_some() {
                set_title_prop(&text, &new)
            } else if self.vault.title_from_path(&nrel).0 != new {
                // like a new page: a name the file name can't hold exactly (con, a trailing dot…)
                add_title_prop(&text, &new)
            } else {
                text
            };
            if text != cur {
                write_atomic(&path, &text)?;
            }
            if nrel != rel {
                let to = self.root.join(&nrel);
                if crate::key(&nrel) == crate::key(&rel) {
                    // only the capitals change: go through a temporary name, which also works
                    // where file names ignore case (Windows, Android)
                    let tmp = path.with_file_name(format!(".rename-{}.tmp", std::process::id()));
                    std::fs::rename(&path, &tmp).map_err(|e| format!("Couldn't rename the file: {e}"))?;
                    if let Err(e) = std::fs::rename(&tmp, &to) {
                        let _ = std::fs::rename(&tmp, &path);
                        return Err(format!("Couldn't rename the file: {e}"));
                    }
                } else {
                    std::fs::rename(&path, &to).map_err(|e| format!("Couldn't rename the file: {e}"))?;
                }
                self.forget(&rel);
            }
            self.record_write(&nrel, &text);
        }
        self.write_cache();
        Ok(RenameRes { name: new, files_changed: changed, skipped })
    }

    fn recycle_dir(&self) -> PathBuf {
        self.root.join("logseq").join(".recycle")
    }

    /// Move pages' files to `logseq/.recycle` (Logseq's bin). Returns how many were moved.
    pub fn delete_pages(&mut self, names: &[String]) -> Result<usize, String> {
        let bin = self.recycle_dir();
        std::fs::create_dir_all(&bin).map_err(|e| format!("Couldn't make the bin folder: {e}"))?;
        let mut n = 0;
        let mut errors = vec![];
        for name in names {
            let info = self.vault.page_info(name);
            let Some(rel) = info.path.filter(|_| info.exists) else { continue };
            let flat = rel.replace('/', "_");
            let stem = flat.strip_suffix(".md").unwrap_or(&flat).to_string();
            let mut dest = bin.join(&flat);
            let mut k = 2;
            while dest.exists() {
                dest = bin.join(format!("{stem} ({k}).md"));
                k += 1;
            }
            let src = self.root.join(&rel);
            let moved = std::fs::rename(&src, &dest).is_ok()
                || (std::fs::copy(&src, &dest).is_ok() && std::fs::remove_file(&src).is_ok());
            if moved {
                self.forget(&rel);
                n += 1;
            } else {
                errors.push(info.name);
            }
        }
        self.write_cache();
        if !errors.is_empty() {
            return Err(format!("Couldn't delete: {}", errors.join(", ")));
        }
        Ok(n)
    }

    /// Pages and pictures in the bin, newest first.
    pub fn recycled(&self) -> Vec<Recycled> {
        let mut v = vec![];
        let Ok(rd) = std::fs::read_dir(self.recycle_dir()) else { return v };
        for e in rd.flatten() {
            let file = e.file_name().to_string_lossy().into_owned();
            if file.starts_with('.') {
                continue;
            }
            let when = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
            if file.ends_with(".md") {
                let rel = self.restore_rel(&file);
                let name = self.vault.title_from_path(&rel).0;
                v.push(Recycled { file, name, when, picture: None });
            } else if let Some(rel) = self.picture_home(&file) {
                let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
                v.push(Recycled { file, name, when, picture: Some(rel) });
            }
        }
        v.sort_by(|a, b| b.when.cmp(&a.when));
        v
    }

    /// Where a file from the bin goes back to.
    fn restore_rel(&self, file: &str) -> String {
        let cfg = &self.vault.config;
        // drop a " (2)"-style suffix added when the bin already had that name
        let stem = file.strip_suffix(".md").unwrap_or(file);
        let stem = match stem.rsplit_once(" (") {
            Some((s, n)) if n.strip_suffix(')').is_some_and(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit())) => s,
            _ => stem,
        };
        for dir in [&cfg.journals_dir, &cfg.pages_dir] {
            if let Some(rest) = stem.strip_prefix(&format!("{}_", dir.replace('/', "_"))) {
                return format!("{dir}/{rest}.md");
            }
        }
        format!("{}/{stem}.md", cfg.pages_dir)
    }

    /// Put a page (or a picture) from the bin back. Returns its name (a picture: where it went in the
    /// notes folder, "assets/sub/x.png").
    pub fn restore(&mut self, file: &str) -> Result<String, String> {
        if file.contains(['/', '\\']) || file.starts_with('.') {
            return Err("Not a file in the bin.".into());
        }
        if pictures::is_picture(file) {
            return self.restore_picture(file);
        }
        let src = self.recycle_dir().join(file);
        let rel = self.restore_rel(file);
        let (name, _) = self.vault.title_from_path(&rel);
        let to = self.root.join(&rel);
        if to.exists() || self.vault.page_info(&name).exists {
            return Err(format!("There's already a page called “{name}”. Rename or delete it first."));
        }
        let text = read_text(&src).ok().flatten().ok_or("That file is gone or isn't plain text.")?;
        if let Some(dir) = to.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&src, &to).map_err(|e| format!("Couldn't restore: {e}"))?;
        self.record_write(&rel, &text);
        self.write_cache();
        Ok(self.vault.page_info(&name).name)
    }

    /// Save an image or file into `assets/` and return the link path Logseq uses
    /// from a page (`../assets/name_123.png`).
    pub fn save_asset(&mut self, name: &str, data: &str) -> Result<String, String> {
        save_asset_file(&self.root, name, &b64_decode(data)?)
    }

    /// Change `:favorites` in config.edn (add or remove one page).
    pub fn set_favorite(&mut self, name: &str, on: bool) -> Result<Vec<String>, String> {
        let mut favs = self.vault.config.favorites.clone();
        favs.retain(|f| crate::key(f) != crate::key(name));
        if on {
            favs.push(name.trim().to_string());
        }
        let value = format!("[{}]", favs.iter().map(|f| crate::edn::quote(f)).collect::<Vec<_>>().join(" "));
        self.edit_config(&[("favorites", value)])?;
        Ok(self.vault.config.favorites.clone())
    }

    /// Change the quick capture templates and options in config.edn.
    pub fn set_capture(&mut self, text: &str, media: &str, today: bool, page: &str) -> Result<(), String> {
        let page = if page.trim().is_empty() { "quick capture" } else { page.trim() };
        self.edit_config(&[
            ("quick-capture-templates", format!("{{:text {} :media {}}}", crate::edn::quote(text), crate::edn::quote(media))),
            ("quick-capture-options", format!("{{:insert-today? {today} :redirect-page? {} :default-page {}}}", self.vault.config.capture_redirect, crate::edn::quote(page))),
        ])
    }

    /// Rewrite top-level config.edn keys in place, then re-read the settings that don't
    /// change how files are indexed.
    fn edit_config(&mut self, edits: &[(&str, String)]) -> Result<(), String> {
        let path = self.root.join("logseq").join("config.edn");
        let mut text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) if !path.exists() => "{}\n".to_string(),
            Err(e) => return Err(format!("Couldn't read config.edn: {e}")),
        };
        for (k, v) in edits {
            text = crate::edn::set_path(&text, &[*k], v).ok_or("Couldn't understand logseq/config.edn, so it wasn't changed.")?;
        }
        if crate::edn::parse(&text).is_none() {
            return Err("The change would break config.edn, so it wasn't saved.".into());
        }
        write_atomic(&path, &text)?;
        let fresh = Config::from_edn(&text);
        let c = &mut self.vault.config;
        c.favorites = fresh.favorites;
        c.capture_text = fresh.capture_text;
        c.capture_media = fresh.capture_media;
        c.capture_today = fresh.capture_today;
        c.capture_redirect = fresh.capture_redirect;
        c.capture_page = fresh.capture_page;
        Ok(())
    }

    /// Is `p` (relative to the vault, e.g. "assets/x.png") a file inside the vault?
    pub fn asset_file(&self, p: &str) -> Option<PathBuf> {
        asset_file(&self.root, p)
    }
}

/// The largest picture or file added to `assets/` (the app's editor says so before reading one).
pub const MAX_ASSET_BYTES: usize = 25_000_000;

/// Pictures the app shows in a note (by file name).
pub fn is_picture(name: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif")
}

/// The name a file gets in `assets/`, the way Logseq names them: `<name, only letters, digits, -
/// and _>_<milliseconds>.<ext>` (e.g. `My_Photo__1_1761487200000.png`). Its own extension
/// (lower case, at most 10 letters or digits; a longer "extension" is part of the name), or none.
pub fn asset_file_name(name: &str, ms: u128) -> String {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let clean = |s: &str| -> String {
        s.chars().map(|c| if c.is_alphanumeric() || "-_".contains(c) { c } else { '_' }).collect::<String>().trim_matches('_').to_string()
    };
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() && e.chars().count() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()) => (s, e.to_ascii_lowercase()),
        _ => (name, String::new()),
    };
    let mut stem = clean(stem);
    if stem.is_empty() {
        stem = "image".into();
    }
    let stem: String = stem.chars().take(60).collect();
    if ext.is_empty() {
        format!("{stem}_{ms}")
    } else {
        format!("{stem}_{ms}.{ext}")
    }
}

/// Copy a picture or file into the notes folder's `assets/` folder (named by `asset_file_name`).
/// Never over another file: a name already taken moves to the next millisecond. Shared by the
/// app's editor and the Windows capture box. Returns the link target, "../assets/<file>".
pub fn save_asset_file(root: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    save_asset_file_at(root, name, bytes, std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis()))
}

/// `save_asset_file` with the name worked out for millisecond `ms` (the capture box names a file
/// when it's added to the note and copies it when the note is added): that name if it's free.
pub fn save_asset_file_at(root: &Path, name: &str, bytes: &[u8], ms: u128) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("The file is empty.".into());
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("That file is over 25 MB; pick a smaller one.".into());
    }
    let dir = root.join("assets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make the assets folder: {e}"))?;
    let mut ms = ms;
    for _ in 0..1000 {
        let file = asset_file_name(name, ms);
        let path = dir.join(&file);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                use std::io::Write;
                if let Err(e) = f.write_all(bytes).and_then(|_| f.flush()) {
                    drop(f);
                    let _ = std::fs::remove_file(&path); // never leave half a file behind
                    return Err(format!("Couldn't save the file: {e}"));
                }
                return Ok(format!("../assets/{file}"));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => ms += 1,
            Err(e) => return Err(format!("Couldn't save the file: {e}")),
        }
    }
    Err("Couldn't find a free file name in assets.".into())
}

/// The Markdown for a file added to a note: a picture shows in the note (`![name](…)`, the name
/// without its extension, as the app's editor writes it), anything else is a link (`[name.ext](…)`).
pub fn asset_markdown(name: &str, rel: &str) -> String {
    let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let label: String = name.chars().filter(|c| !matches!(c, '[' | ']' | '\n' | '\r')).collect();
    if is_picture(name) {
        let alt = label.rsplit_once('.').map_or(label.as_str(), |(s, _)| s);
        format!("![{alt}]({rel})")
    } else {
        format!("[{label}]({rel})")
    }
}

/// Resolve a vault-relative path for showing a file (images), refusing anything outside the vault.
pub fn asset_file(root: &Path, p: &str) -> Option<PathBuf> {
    let p = p.trim_start_matches('/');
    let p = p.strip_prefix("../").unwrap_or(p);
    if p.split(['/', '\\']).any(|c| c == "..") {
        return None;
    }
    let full = root.join(p).canonicalize().ok()?;
    let base = root.canonicalize().ok()?;
    (full.starts_with(&base) && full.is_file()).then_some(full)
}

fn read_config(root: &Path) -> Config {
    std::fs::read_to_string(root.join("logseq").join("config.edn")).map(|t| Config::from_edn(&t)).unwrap_or_default()
}

/// One entry point for every UI request: `cmd` + JSON args → JSON result.
/// Both the Tauri app and the dev server call this, so features are added in one place.
pub fn dispatch(state: &mut Option<App>, cmd: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let r = run(state, cmd, &args);
    if let Err(e) = &r {
        if cmd != "log" {
            crate::log::record(&format!("{cmd}: {e}"));
        }
    }
    r
}

fn run(state: &mut Option<App>, cmd: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
    use serde_json::{json, to_value, Value};
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let b = |k: &str| args.get(k).and_then(Value::as_bool).unwrap_or(false);
    let n = |k: &str| args.get(k).and_then(Value::as_u64).unwrap_or(0) as usize;
    let date = |k: &str| -> Result<Date, String> {
        serde_json::from_value(args.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| format!("bad date: {e}"))
    };
    // commands that work without an open vault
    match cmd {
        "roots" => return Ok(json!(roots())),
        "list_dir" => return to_value(list_dir(&s("path"))?).map_err(|e| e.to_string()),
        "check" => {
            let p = s("path");
            let root = if p.is_empty() { state.as_ref().map(|a| a.root.clone()).ok_or("no vault open")? } else { p.into() };
            return to_value(check_vault(&root)?).map_err(|e| e.to_string());
        }
        "log" => {
            crate::log::record(&s("msg"));
            return Ok(json!(true));
        }
        "errors" => return Ok(json!(crate::log::read())),
        "clear_errors" => {
            crate::log::clear();
            return Ok(json!(true));
        }
        "task_done" => return Ok(json!(crate::task::complete(&s("text"), date("today")?))),
        // the look's colours for the Windows capture box (it draws itself without the web page)
        "save_look" => return Ok(json!(crate::capture_box::save_look(cache_dir().as_deref(), &s("look"), args.get("colors").unwrap_or(&Value::Null))?)),
        // saving the index when the app hides: nothing to do before a folder is open
        "persist" if state.is_none() => return Ok(json!(false)),
        _ => {}
    }
    if cmd == "open" {
        if let Some(old) = state.as_mut() {
            old.persist(); // its index cache, and earlier texts not yet in a safety copy
        }
        let mut app = App::open(Path::new(&s("path")))?;
        remember_vault(&app.root);
        app.start_safety_copy(); // in the background (see safety.rs)
        let sum = to_value(app.summary()).unwrap();
        *state = Some(app);
        return Ok(sum);
    }
    let app = state.as_mut().ok_or("no vault open")?;
    let v = match cmd {
        "summary" => to_value(app.summary()),
        "page" => {
            let now = date("today").ok().map(|d| (d, s("time")));
            to_value(app.page(&s("name"), now))
        }
        "save" => {
            let req: SaveReq = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
            to_value(app.save(req)?)
        }
        "save_block" => to_value(app.save_block(&s("name"), n("line"), &s("base"), &s("text"))?),
        "journals" => {
            let count = args.get("count").and_then(Value::as_u64).unwrap_or(7) as usize;
            let inc = args.get("include_end").and_then(Value::as_bool).unwrap_or(true);
            to_value(app.journals(date("end")?, count, inc))
        }
        "journal_dates" => to_value(app.vault.journal_dates()),
        "journal_days" => to_value(app.journal_days()),
        "journal_name" => Ok(json!(app.journal_name(date("date")?))),
        "append_journal" => {
            app.append_journal(date("date")?, &s("text"))?;
            Ok(json!(true))
        }
        "capture" => Ok(json!(app.capture(&s("text"), &s("url"), b("media"), date("today")?, &s("time"))?)),
        "search" => to_value(app.search(&s("q"))),
        "pages" => to_value(app.vault.all_pages()),
        "tags" => to_value(app.vault.all_tags()),
        "props" => to_value(app.vault.all_property_keys()),
        "prop_values" => to_value(app.vault.prop_values(&s("key"))),
        "with_property" => {
            let val = s("value");
            to_value(app.vault.with_property(&s("key"), (!val.is_empty()).then_some(val.as_str())))
        }
        "tasks" => to_value(app.vault.tasks(b("done"))),
        "unlinked" => {
            let (groups, more) = app.vault.unlinked_refs(&s("name"), 300);
            Ok(json!({ "groups": groups, "more": more }))
        }
        "unlinked_any" => {
            let names: Vec<String> = serde_json::from_value(args.get("names").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            to_value(app.vault.has_unlinked(&names))
        }
        "link_mention" => to_value(app.link_mention(&s("page"), n("line"), &s("base"), &s("target"))?),
        "rename" => to_value(app.rename(&s("name"), &s("new_name"))?),
        "delete" => {
            let names: Vec<String> = serde_json::from_value(args.get("names").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            Ok(json!(app.delete_pages(&names)?))
        }
        "recycled" => to_value(app.recycled()),
        "restore" => Ok(json!(app.restore(&s("file"))?)),
        "templates" => to_value(app.vault.templates()),
        "template" => {
            let blocks = app.template(&s("name"), &s("page"), date("today")?, &s("time")).ok_or("No template with that name.")?;
            to_value(blocks)
        }
        "save_asset" => Ok(json!(app.save_asset(&s("name"), &s("data"))?)),
        "set_favorite" => to_value(app.set_favorite(&s("name"), b("on"))?),
        "set_capture" => {
            app.set_capture(&s("text"), &s("media"), b("today"), &s("page"))?;
            to_value(app.summary())
        }
        "rescan" => to_value(app.rescan()),
        "persist" => {
            app.persist();
            Ok(json!(true))
        }
        "backup" => {
            let doc: Doc = serde_json::from_value(args.get("doc").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            app.backup_doc(&s("name"), &doc)?;
            Ok(json!(true))
        }
        "clash" => {
            let doc = |k: &str| serde_json::from_value::<Doc>(args.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string());
            to_value(app.clash(&s("name"), &doc("doc")?, &doc("base")?, args.get("path").and_then(Value::as_str))?)
        }
        // pictures nothing uses → the bin (pictures.rs); safety copies (safety.rs)
        "bin_pictures" => {
            let paths: Vec<String> = serde_json::from_value(args.get("paths").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            to_value(app.bin_pictures(&paths)?)
        }
        "safety_copies" => to_value(data_dir().map(|d| app.safety_copies(&d)).unwrap_or_default()),
        "safety_copy" => to_value(app.safety_copy(&safety::folder()?, &s("id"))?),
        // "before": 0 (or none) the note as copied, 1, 2… one of its earlier texts
        "safety_note" => to_value(app.safety_note(&safety::folder()?, &s("id"), &s("path"), n("before") as u32)?),
        "safety_restore" => to_value(app.safety_restore(&safety::folder()?, &s("id"), &s("path"), n("before") as u32)?),
        _ => return Err(format!("unknown command: {cmd}")),
    };
    v.map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    /// Looks like a Logseq vault (has logseq/config.edn or a pages folder).
    pub vault: bool,
}

#[derive(Serialize)]
pub struct DirList {
    pub path: String,
    pub parent: Option<String>,
    pub dirs: Vec<DirEntry>,
    pub vault: bool,
}

fn is_vault(p: &Path) -> bool {
    p.join("logseq").join("config.edn").is_file() || p.join("pages").is_dir()
}

/// Where the folder picker starts: shared storage on Android, home + drives on Windows.
pub fn roots() -> Vec<String> {
    if cfg!(target_os = "android") {
        return vec!["/storage/emulated/0".into()];
    }
    let mut v = vec![];
    if let Ok(h) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        v.push(h);
    }
    if cfg!(windows) {
        v.extend((b'C'..=b'Z').map(|c| format!("{}:\\", c as char)).filter(|p| Path::new(p).exists()));
    }
    v
}

pub fn list_dir(path: &str) -> Result<DirList, String> {
    let p = Path::new(path);
    let rd = std::fs::read_dir(p).map_err(|e| format!("Can't open {path}: {e}"))?;
    let mut dirs: Vec<DirEntry> = rd
        .flatten()
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| {
            let pp = e.path();
            DirEntry { name: e.file_name().to_string_lossy().into(), vault: is_vault(&pp), path: pp.display().to_string() }
        })
        .collect();
    dirs.sort_by_key(|d| d.name.to_lowercase());
    Ok(DirList { path: p.display().to_string(), parent: p.parent().map(|x| x.display().to_string()), dirs, vault: is_vault(p) })
}

#[derive(Serialize)]
pub struct CheckReport {
    pub files: usize,
    pub pages: usize,
    pub load_ms: u128,
    /// Files that would not be written back byte-for-byte if opened and saved untouched.
    pub roundtrip_failures: Vec<String>,
    /// Page names claimed by more than one file (the first file is the one shown).
    pub duplicates: Vec<(String, Vec<String>)>,
    /// Files that aren't UTF-8 text (shown, never saved over).
    pub non_utf8: Vec<String>,
    /// Copies made by a sync conflict, e.g. "Page (1).md" next to "Page.md".
    pub conflict_copies: Vec<String>,
    /// Pages with the most blocks: (name, blocks).
    pub biggest: Vec<(String, usize)>,
    /// Pages with the most linked references: (name, references).
    pub most_linked: Vec<(String, usize)>,
    /// How many pictures `assets/` holds.
    pub pictures: usize,
    /// Pictures in `assets/` that nothing in the folder mentions: (path, bytes). See pictures.rs.
    pub unused_pictures: Vec<(String, u64)>,
    pub unused_pictures_bytes: u64,
    /// Text files that couldn't be read: while there are any, no picture is called unused.
    pub pictures_unreadable: Vec<String>,
    /// Pictures changed in the last 3 days, left out (a note using one may still be on its way).
    pub pictures_recent: usize,
}

/// "Page (1).md", "Page (conflict 2026-…).md", "Page [Conflict].md": a sync copy of "Page.md"?
fn conflict_copy_of(rel: &str, all: &HashMap<String, Stamp>) -> bool {
    let Some(stem) = rel.strip_suffix(".md") else { return false };
    let lower = stem.to_lowercase();
    if lower.contains("conflict") || lower.contains("sync-conflict") {
        return true;
    }
    if let Some((base, tail)) = stem.rsplit_once(" (") {
        if tail.strip_suffix(')').is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())) {
            return all.contains_key(&format!("{base}.md"));
        }
    }
    false
}

/// Read-only health check of a vault: load time and round-trip safety of every file.
pub fn check_vault(root: &Path) -> Result<CheckReport, String> {
    check_vault_at(root, std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()))
}

/// `check_vault` with pictures judged as at `now` (seconds since 1970): for tests (the dev server's
/// too), whose pictures are all new. Reads only: not even the index cache is written.
pub fn check_vault_at(root: &Path, now: u64) -> Result<CheckReport, String> {
    let t = std::time::Instant::now();
    let app = App::open_read_only(root)?;
    let load_ms = t.elapsed().as_millis();
    let mut fails = vec![];
    for (rel, text) in &app.contents {
        let d = split_doc(text);
        if keep_shape(Some(text), join_doc(&d), d.crlf) != *text {
            fails.push(rel.clone());
        }
    }
    fails.sort();
    let mut non_utf8: Vec<String> = app.non_utf8.iter().cloned().collect();
    non_utf8.sort();
    let mut conflict_copies: Vec<String> = app.files.keys().filter(|r| conflict_copy_of(r, &app.files)).cloned().collect();
    conflict_copies.sort();
    let mut biggest: Vec<(String, usize)> = app
        .contents
        .iter()
        .map(|(rel, text)| (app.vault.title_from_path(rel).0, split_doc(text).blocks.len()))
        .collect();
    biggest.sort_by(|a, b| b.1.cmp(&a.1));
    biggest.truncate(5);
    let mut most_linked: Vec<(String, usize)> = app.vault.all_pages().into_iter().map(|p| (p.name, p.refs)).collect();
    most_linked.sort_by(|a, b| b.1.cmp(&a.1));
    most_linked.truncate(5);
    let pics = app.picture_check_at(now);
    Ok(CheckReport {
        pictures: pics.pictures,
        unused_pictures: pics.unused,
        unused_pictures_bytes: pics.bytes,
        pictures_unreadable: pics.unreadable,
        pictures_recent: pics.recent,
        files: app.files.len(),
        pages: app.vault.page_count(),
        load_ms,
        roundtrip_failures: fails,
        duplicates: app.vault.duplicates(),
        non_utf8,
        conflict_copies,
        biggest,
        most_linked,
    })
}

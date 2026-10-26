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
    /// Page name it had.
    pub name: String,
    /// Seconds since 1970 when it was deleted (file time).
    pub when: u64,
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
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let fname = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{fname}.tmp")); // hidden, so other apps ignore it
    std::fs::write(&tmp, text).map_err(|e| format!("Couldn't write the page: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        // some synced drives refuse to replace a file by renaming
        let _ = std::fs::remove_file(&tmp);
        std::fs::write(path, text).map_err(|e2| format!("Couldn't save the page: {e} / {e2}"))?;
    }
    Ok(())
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

impl App {
    pub fn open(root: &Path) -> Result<App, String> {
        if !root.is_dir() {
            return Err(format!("Folder not found: {}", root.display()));
        }
        let cfg = read_config(root);
        let stamps = scan(root, &cfg);
        let mut cache = load_cache(root);
        let cache_had = cache.len();
        let mut contents = HashMap::new();
        let mut to_read = vec![];
        for (rel, st) in &stamps {
            match cache.remove(rel) {
                Some((cst, text)) if cst == *st => {
                    contents.insert(rel.clone(), text);
                }
                _ => to_read.push(rel.clone()),
            }
        }
        let mut non_utf8 = HashSet::new();
        let mut files = HashMap::new();
        for (rel, text, utf8) in read_parallel(root, &to_read) {
            if !utf8 {
                non_utf8.insert(rel.clone());
            }
            contents.insert(rel, text);
        }
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
        let mut app = App { root: root.to_path_buf(), vault, files, contents, non_utf8, cache_dirty };
        app.write_cache();
        Ok(app)
    }

    /// Persist file texts so the next start only reads files that changed.
    fn write_cache(&mut self) {
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
        self.write_page(&rel, &text)?;
        let merged = merged.map(|_| split_doc(&text));
        Ok(SaveRes { ok: true, hash: content_hash(&text), conflict: false, merged })
    }

    /// Keep a copy of a page's text in `logseq/bak/<file>/<time>.md` (Logseq's backup place).
    fn backup(&self, rel: &str, text: &str) -> Result<(), String> {
        let stem = rel.trim_end_matches(".md");
        let stamp = crate::log::now_utc().replace([' ', ':'], "_").replace("_UTC", "");
        let p = self.root.join("logseq").join("bak").join(stem).join(format!("{stamp}.md"));
        write_atomic(&p, text).map_err(|e| format!("Couldn't keep a backup copy, so nothing was saved: {e}"))
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
        let (rel, name) = if cfg.capture_today {
            (cfg.journal_rel_path(today), cfg.journal_title(today))
        } else {
            let info = self.vault.page_info(&cfg.capture_page);
            (info.path.unwrap_or_else(|| crate::capture::target(&cfg, today)), info.name)
        };
        self.append_to(&rel, &line)?;
        Ok(name)
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
        let new_rel = own_rel.as_ref().map(|rel| {
            let dir = rel.rsplit_once('/').map_or(self.vault.config.pages_dir.as_str(), |(d, _)| d).to_string();
            format!("{dir}/{}.md", crate::file_stem_for(&new))
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
            let text = if self.vault.page_info(&info.name).props.iter().any(|(k, _)| k == "title") { set_title_prop(&text, &new) } else { text };
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

    /// Pages in the bin, newest first.
    pub fn recycled(&self) -> Vec<Recycled> {
        let mut v = vec![];
        let Ok(rd) = std::fs::read_dir(self.recycle_dir()) else { return v };
        for e in rd.flatten() {
            let file = e.file_name().to_string_lossy().into_owned();
            if !file.ends_with(".md") || file.starts_with('.') {
                continue;
            }
            let when = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
            let rel = self.restore_rel(&file);
            let name = self.vault.title_from_path(&rel).0;
            v.push(Recycled { file, name, when });
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

    /// Put a page from the bin back. Returns its name.
    pub fn restore(&mut self, file: &str) -> Result<String, String> {
        if file.contains(['/', '\\']) || file.starts_with('.') {
            return Err("Not a file in the bin.".into());
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
        let bytes = b64_decode(data)?;
        if bytes.is_empty() {
            return Err("The file is empty.".into());
        }
        let name = name.rsplit(['/', '\\']).next().unwrap_or(name);
        let (stem, ext) = name.rsplit_once('.').unwrap_or((name, "png"));
        let clean = |s: &str| -> String {
            s.chars().map(|c| if c.is_alphanumeric() || "-_".contains(c) { c } else { '_' }).collect::<String>().trim_matches('_').to_string()
        };
        let mut stem = clean(stem);
        if stem.is_empty() {
            stem = "image".into();
        }
        let stem: String = stem.chars().take(60).collect();
        let ext = clean(ext).to_lowercase();
        let ms = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
        let file = format!("{stem}_{ms}.{}", if ext.is_empty() { "bin" } else { &ext });
        let path = self.root.join("assets").join(&file);
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| format!("Couldn't save the file: {e}"))?;
        Ok(format!("../assets/{file}"))
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
        // saving the index when the app hides: nothing to do before a folder is open
        "persist" if state.is_none() => return Ok(json!(false)),
        _ => {}
    }
    if cmd == "open" {
        let app = App::open(Path::new(&s("path")))?;
        remember_vault(&app.root);
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
    let t = std::time::Instant::now();
    let app = App::open(root)?;
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
    Ok(CheckReport {
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

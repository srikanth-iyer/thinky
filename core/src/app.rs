//! App-level operations shared by the Tauri app and the dev server.
//! Everything the UI can ask for lives here, as plain functions over `App`.

use crate::{content_hash, join_doc, split_doc, Config, Doc, PageInfo, RefGroup, SearchHit, Vault};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

pub type Date = (i32, u32, u32);

/// Where the app may keep its index cache (set once by the Tauri shell at startup).
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();
pub fn set_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}
const CACHE_VERSION: u32 = 1;

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
}

#[derive(Deserialize)]
pub struct SaveReq {
    pub name: String,
    pub doc: Doc,
    pub base_hash: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Serialize)]
pub struct SaveRes {
    pub ok: bool,
    pub hash: String,
    /// true when the file changed on disk since it was opened (nothing written).
    pub conflict: bool,
}

#[derive(Serialize)]
pub struct JournalDay {
    pub name: String,
    pub date: Date,
    pub exists: bool,
}

/// File text: Ok(None) if missing, Err if it exists but isn't UTF-8.
fn read_text(p: &Path) -> Result<Option<String>, ()> {
    match std::fs::read(p) {
        Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| ()),
        Err(_) => Ok(None),
    }
}

fn stamp_of(md: &std::fs::Metadata) -> Stamp {
    let mtime_ns = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64);
    Stamp { mtime_ns, size: md.len() }
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

impl App {
    pub fn open(root: &Path) -> Result<App, String> {
        if !root.is_dir() {
            return Err(format!("Folder not found: {}", root.display()));
        }
        let cfg = std::fs::read_to_string(root.join("logseq").join("config.edn"))
            .map(|t| Config::from_edn(&t))
            .unwrap_or_default();
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

    /// Pick up files changed by sync, Claude or other apps. Returns the changed paths.
    pub fn rescan(&mut self) -> Vec<String> {
        let now = scan(&self.root, &self.vault.config);
        let to_read: Vec<String> = now.iter().filter(|(r, st)| self.files.get(*r) != Some(st)).map(|(r, _)| r.clone()).collect();
        let removed: Vec<String> = self.files.keys().filter(|r| !now.contains_key(*r)).cloned().collect();
        let mut changed = vec![];
        for (rel, text, utf8) in read_parallel(&self.root, &to_read) {
            self.vault.upsert(&rel, &text);
            self.files.insert(rel.clone(), now[&rel]);
            if utf8 {
                self.non_utf8.remove(&rel);
                self.contents.insert(rel.clone(), text);
            } else {
                self.non_utf8.insert(rel.clone());
                self.contents.remove(&rel);
            }
            changed.push(rel);
        }
        for rel in removed {
            self.vault.remove(&rel);
            self.files.remove(&rel);
            self.contents.remove(&rel);
            self.non_utf8.remove(&rel);
            changed.push(rel);
        }
        if !changed.is_empty() {
            self.cache_dirty = true;
        }
        self.write_cache();
        changed
    }

    pub fn page(&self, name: &str) -> PageView {
        let info = self.vault.page_info(name);
        let path = info.path.as_ref().map(|p| self.root.join(p));
        let (text, readonly) = match path.as_deref().map(read_text) {
            Some(Ok(t)) => (t, false),
            Some(Err(())) => (path.as_deref().and_then(|p| std::fs::read(p).ok()).map(|b| String::from_utf8_lossy(&b).into_owned()), true),
            None => (None, false),
        };
        let hash = text.as_deref().map(content_hash).unwrap_or_default();
        let doc = split_doc(text.as_deref().unwrap_or(""));
        PageView { refs: self.vault.linked_refs(name), tagged: self.vault.pages_tagged(name), info, doc, hash, readonly }
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

    pub fn save(&mut self, req: SaveReq) -> Result<SaveRes, String> {
        let info = self.vault.page_info(&req.name);
        let rel = info.path.ok_or("page has no path")?;
        let path = self.root.join(&rel);
        let current = read_text(&path).map_err(|_| "This page's file isn't plain UTF-8 text, so it isn't saved from here (to keep it safe).".to_string())?;
        let cur_hash = current.as_deref().map(content_hash).unwrap_or_default();
        if !req.force && cur_hash != req.base_hash {
            return Ok(SaveRes { ok: false, hash: cur_hash, conflict: true });
        }
        let mut text = join_doc(&req.doc);
        // a brand-new page with only an empty bullet is not worth a file
        if current.is_none() && text.trim().trim_start_matches('-').trim().is_empty() {
            return Ok(SaveRes { ok: true, hash: String::new(), conflict: false });
        }
        // keep the file's own ending: only add a final line break if it had one (or is new)
        if current.as_deref().map_or(true, |c| c.ends_with('\n')) && !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // write to a temp file then rename, so a crash never leaves half a page
        let fname = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        let tmp = path.with_file_name(format!(".{fname}.tmp")); // hidden, so other apps ignore it
        std::fs::write(&tmp, &text).map_err(|e| format!("Couldn't write the page: {e}"))?;
        if let Err(e) = std::fs::rename(&tmp, &path) {
            // some synced drives refuse to replace a file by renaming; fall back to a direct write
            let _ = std::fs::remove_file(&tmp);
            std::fs::write(&path, &text).map_err(|e2| format!("Couldn't save the page: {e} / {e2}"))?;
        }
        self.record_write(&rel, &text);
        Ok(SaveRes { ok: true, hash: content_hash(&text), conflict: false })
    }

    pub fn journal_name(&self, d: Date) -> String {
        self.vault.config.journal_title(d)
    }

    /// The `count` journal days ending at `end` (inclusive), newest first. Today is always
    /// included even without a file; other days only when they have a file.
    pub fn journals(&self, end: Date, count: usize, include_end: bool) -> Vec<JournalDay> {
        // like Logseq: past days whose file is empty (auto-created, or just "-") are skipped
        let has_text = |d: Date| {
            let rel = self.vault.config.journal_rel_path(d);
            self.contents.get(&rel).map_or(true, |t| !t.trim().trim_start_matches('-').trim().is_empty())
        };
        let mut days: Vec<Date> = self
            .vault
            .all_pages()
            .into_iter()
            .filter(|(_, j, exists)| *exists && j.is_some_and(|d| d <= end))
            .filter_map(|(_, j, _)| j)
            .filter(|d| *d == end || has_text(*d))
            .collect();
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

    /// Quick capture: add a bullet to a day's journal (creating the file if needed).
    pub fn append_journal(&mut self, d: Date, text: &str) -> Result<(), String> {
        let rel = self.vault.config.journal_rel_path(d);
        let path = self.root.join(&rel);
        let cur = read_text(&path).map_err(|_| "Today's journal file isn't plain UTF-8 text.".to_string())?.unwrap_or_default();
        let out = crate::append_bullet(&cur, text);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, &out).map_err(|e| e.to_string())?;
        self.record_write(&rel, &out);
        Ok(())
    }

    pub fn search(&self, q: &str) -> Vec<SearchHit> {
        self.vault.search(q, 40)
    }
}

/// One entry point for every UI request: `cmd` + JSON args → JSON result.
/// Both the Tauri app and the dev server call this, so features are added in one place.
pub fn dispatch(state: &mut Option<App>, cmd: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    use serde_json::{json, to_value, Value};
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").to_string();
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
        _ => {}
    }
    if cmd == "open" {
        let app = App::open(Path::new(&s("path")))?;
        let sum = to_value(app.summary()).unwrap();
        *state = Some(app);
        return Ok(sum);
    }
    let app = state.as_mut().ok_or("no vault open")?;
    let v = match cmd {
        "summary" => to_value(app.summary()),
        "page" => to_value(app.page(&s("name"))),
        "save" => {
            let req: SaveReq = serde_json::from_value(args.clone()).map_err(|e| e.to_string())?;
            to_value(app.save(req)?)
        }
        "journals" => {
            let count = args.get("count").and_then(Value::as_u64).unwrap_or(7) as usize;
            let inc = args.get("include_end").and_then(Value::as_bool).unwrap_or(true);
            to_value(app.journals(date("end")?, count, inc))
        }
        "journal_name" => Ok(json!(app.journal_name(date("date")?))),
        "append_journal" => {
            app.append_journal(date("date")?, &s("text"))?;
            Ok(json!(true))
        }
        "search" => to_value(app.search(&s("q"))),
        "pages" => to_value(app.vault.all_pages()),
        "tags" => to_value(app.vault.all_tags()),
        "props" => to_value(app.vault.all_property_keys()),
        "with_property" => {
            let val = s("value");
            to_value(app.vault.with_property(&s("key"), (!val.is_empty()).then_some(val.as_str())))
        }
        "rescan" => to_value(app.rescan()),
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
}

/// Read-only health check of a vault: load time and round-trip safety of every file.
pub fn check_vault(root: &Path) -> Result<CheckReport, String> {
    let t = std::time::Instant::now();
    let app = App::open(root)?;
    let load_ms = t.elapsed().as_millis();
    let mut fails = vec![];
    for (rel, text) in &app.contents {
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        if join_doc(&split_doc(text)) != text {
            fails.push(rel.clone());
        }
    }
    fails.sort();
    let mut non_utf8: Vec<String> = app.non_utf8.iter().cloned().collect();
    non_utf8.sort();
    Ok(CheckReport { files: app.files.len(), pages: app.vault.page_count(), load_ms, roundtrip_failures: fails, duplicates: app.vault.duplicates(), non_utf8 })
}

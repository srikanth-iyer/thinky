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

/// Where the app keeps files that must last: not the cache, which Android may clear (set once by the
/// Tauri shell / the dev server). The safety copies' name for this device, and the copies themselves
/// only while the notes folder can't be written (they live in its `logseq/.safety-<device>`: safety.rs).
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
pub fn set_data_dir(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}
pub fn data_dir() -> Option<PathBuf> {
    DATA_DIR.get().cloned()
}

pub mod history;
pub mod pictures;
pub mod safety;

/// The notes folder last opened in the app (used by quick capture outside the app), or what's wrong
/// in words for him: never chosen, or chosen but out of reach right now (Google Drive not running).
pub fn last_vault_or_why() -> Result<PathBuf, String> {
    let never = || "Open thinky once and choose your notes folder first.".to_string();
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
    /// When each file was made (seconds since 1970), All pages' "Created": the earliest of what the
    /// system says (its creation time, where it keeps one: Windows does, Android doesn't), the file's
    /// change time, and what the app noted before (kept in the index cache). So a save that replaces
    /// the file (a new file under the old name) never makes a page look new.
    born: HashMap<String, u64>,
    /// The last merge of two pages (`merge_pages`), for its Undo.
    last_merge: Option<MergeUndo>,
    /// `logseq/config.edn`'s stamp when the settings were read (None: no file): a rescan reads it
    /// again when it changed (`collect_changes`).
    config_stamp: Option<Stamp>,
}

/// What `undo_merge` needs: every file the merge changed (path, text before, text after) and the
/// merged page's file, now in the bin (where it was, where it is, its text).
struct MergeUndo {
    id: u64,
    from: String,
    files: Vec<(String, String, String)>,
    binned: Option<(String, PathBuf, String)>,
    /// config.edn before and after a favourite was renamed by the merge.
    config: Option<(String, String)>,
}

#[derive(Debug, Serialize)]
pub struct MergeRes {
    /// The page the notes went into.
    pub name: String,
    /// How many notes were added at its end.
    pub notes: usize,
    /// The merged page's properties came along, as the first of those notes.
    pub props: bool,
    /// Other files whose links now point at the page.
    pub files_changed: usize,
    /// Files that link to the old name but couldn't be changed (not UTF-8 text, unreadable, or
    /// saved elsewhere at every try).
    pub skipped: Vec<String>,
    /// For `undo_merge`.
    pub undo: u64,
    /// `:favorites` afterwards (a favourite of the merged page now names the page it went into).
    pub favorites: Vec<String>,
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
    /// `:favorites` afterwards (a favourite of the page follows its new name).
    pub favorites: Vec<String>,
    /// Other files whose links were updated.
    pub files_changed: usize,
    /// Files that link to the page but couldn't be updated (not UTF-8 text, unreadable, or saved
    /// elsewhere at every try).
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

/// Now, in seconds since 1970 (UTC).
pub(crate) fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn stamp_of(md: &std::fs::Metadata) -> Stamp {
    let mtime_ns = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64);
    Stamp { mtime_ns, size: md.len() }
}

/// The file's creation time in seconds, where the system keeps one (Windows, from the folder
/// listing; Linux with most disks); Android doesn't.
fn made_of(md: &std::fs::Metadata) -> Option<u64> {
    md.created().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs()).filter(|&s| s > 0)
}

/// When a file was made, from what's known: what the app noted before, the system's creation time,
/// its change time (a file isn't made after it was last changed). The earliest wins.
fn born_from(noted: Option<u64>, made: Option<u64>, st: Stamp) -> u64 {
    let changed = st.mtime_ns / 1_000_000_000;
    [noted, made, (changed > 0).then_some(changed)].into_iter().flatten().min().unwrap_or(0)
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

/// Tests only: see `set_write_hook`.
type WriteHook = Box<dyn FnMut(&Path)>;
thread_local! {
    static WRITE_HOOK: std::cell::RefCell<Option<WriteHook>> = const { std::cell::RefCell::new(None) };
}

/// Tests only: `f(path)` runs inside each `write_atomic_checked` on this thread once the new text
/// is ready in its temp file, right before the file is checked and replaced: another program saving
/// the file at the worst moment. None: no more.
#[doc(hidden)]
pub fn set_write_hook(f: Option<WriteHook>) {
    WRITE_HOOK.with(|h| *h.borrow_mut() = f);
}

/// `write_atomic`, but only if the file still holds what's `expect`ed when the new text is ready to
/// replace it (checked again just before the rename): Ok(false) when someone else saved it
/// meanwhile (nothing written; read it again and redo the change). The temp file has a name of
/// its own (process and a counter), so two programs writing the same page never swap texts; a
/// rename that fails (Google Drive or a virus checker holding the file for a moment) is tried
/// again for about half a second before the direct write that some synced drives need, each try
/// checked first too; a file that can't be read just then is waited for within that half second,
/// and never written over unseen (Ok(false)).
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
    if let Some(mut f) = WRITE_HOOK.with(|h| h.borrow_mut().take()) {
        f(path);
        WRITE_HOOK.with(|h| {
            h.borrow_mut().get_or_insert(f);
        });
    }
    // Some(true): as expected; Some(false): it changed (nothing may be written); None: it can't be
    // read just now (Google Drive holding it, perhaps while it brings a newer version): wait and see
    let still = || match (&expect, std::fs::read(path)) {
        (Expect::Anything, _) => Some(true),
        (Expect::Bytes(b), Ok(now)) => Some(now == *b),
        (Expect::Missing, Ok(_)) => Some(false),
        (_, Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Some(matches!(expect, Expect::Missing)),
        (_, Err(_)) => None,
    };
    let mut last = None;
    for i in 0..6 {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        match still() {
            Some(true) => {}
            Some(false) => {
                let _ = std::fs::remove_file(&tmp);
                return Ok(false);
            }
            None => continue,
        }
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(true),
            Err(e) => last = Some(e),
        }
    }
    // some synced drives refuse to replace a file by renaming: write it in place (checked first too;
    // one that still can't be read is never written over blindly)
    let _ = std::fs::remove_file(&tmp);
    if still() != Some(true) {
        return Ok(false);
    }
    let e = last.map(|e| e.to_string()).unwrap_or_default();
    std::fs::write(path, text).map_err(|e2| format!("Couldn't save the page: {e} / {e2}"))?;
    Ok(true)
}

/// What `rewrite` did.
enum Rewrite {
    /// written: (the text it replaced, "" for no file; the new text)
    Done(String, String),
    /// nothing to change (`edit` gave None): the text as read (None: no file)
    Left(Option<String>),
    /// saved elsewhere between reading and writing, at every try: nothing written
    Busy,
}

/// Change the text file at `path` while other programs may save it too (Logseq, Google Drive sync,
/// Claude's connector): `edit` gets its text as it is now (None: no file) and gives the new text
/// (None: nothing to change). That replaces the file only if it still holds exactly the bytes read
/// (`Expect::Bytes`, or `Expect::Missing`; checked again right before it's written), so a change
/// made elsewhere meanwhile is never written over: the file is read again and the change made on
/// that version, `tries` times in all. A file that can't be read, or isn't UTF-8 text, is an error
/// (`what` names it), never taken for empty.
fn rewrite(path: &Path, what: &str, tries: u32, mut edit: impl FnMut(Option<&str>) -> Result<Option<String>, String>) -> Result<Rewrite, String> {
    for _ in 0..tries {
        // (read_text keeps every byte: a byte-order mark, CRLF, no final line break)
        let cur = read_text(path).map_err(|e| e.say(what))?;
        let Some(new) = edit(cur.as_deref())? else { return Ok(Rewrite::Left(cur)) };
        let expect = cur.as_deref().map_or(Expect::Missing, |c| Expect::Bytes(c.as_bytes()));
        if write_atomic_checked(path, &new, expect)? {
            return Ok(Rewrite::Done(cur.unwrap_or_default(), new));
        }
    }
    Ok(Rewrite::Busy)
}

/// A settings change that met config.edn being saved elsewhere at each try.
const CONFIG_BUSY: &str = "Your notes settings (logseq/config.edn) were being changed somewhere else just then, so this wasn't saved. Try again in a moment.";

/// The hash of a file's text as it is now ("" when it isn't there or can't be read).
fn hash_now(path: &Path) -> String {
    read_text(path).ok().flatten().as_deref().map(content_hash).unwrap_or_default()
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

/// Every `.md` file in the pages and journals folders, with stamps, and the creation times the
/// system gives (`made_of`). Uses the directory listing only (no per-file calls on Windows, where
/// the listing has the creation time too), which matters on Google Drive's virtual drive.
fn scan(root: &Path, cfg: &Config) -> (HashMap<String, Stamp>, HashMap<String, u64>) {
    let mut m = HashMap::new();
    let mut made = HashMap::new();
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
                        let rel = rel.to_string_lossy().replace('\\', "/");
                        if let Some(t) = made_of(&md) {
                            made.insert(rel.clone(), t);
                        }
                        m.insert(rel, stamp_of(&md));
                    }
                }
            }
        }
    }
    (m, made)
}

/// Read many files at once (Drive's virtual drive answers in parallel much faster).
/// Returns (rel, text, is_utf8); unreadable files are left out.
fn read_parallel<T: Clone + AsRef<Path> + Sync + Send>(root: &Path, rels: &[T]) -> Vec<(T, String, bool)> {
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
    /// When each file was made, as the app knows it (`App::born`). (Older caches have none.)
    #[serde(default)]
    born: HashMap<String, u64>,
}

fn cache_path(root: &Path) -> Option<PathBuf> {
    Some(CACHE_DIR.get()?.join(format!("vault-{}.json", content_hash(&root.display().to_string()))))
}

type Cached = (HashMap<String, (Stamp, String)>, HashMap<String, u64>);

fn load_cache(root: &Path) -> Cached {
    let Some(p) = cache_path(root) else { return Default::default() };
    let Ok(bytes) = std::fs::read(&p) else { return Default::default() };
    match serde_json::from_slice::<CacheFile>(&bytes) {
        Ok(c) if c.v == CACHE_VERSION && c.root == root.display().to_string() => {
            (c.files.into_iter().map(|(r, st, t)| (r, (st, t))).collect(), c.born)
        }
        _ => Default::default(),
    }
}

/// What a rescan needs, copied out so the slow part can run without holding the app.
pub struct ScanPlan {
    root: PathBuf,
    cfg: Config,
    files: HashMap<String, Stamp>,
    config_stamp: Option<Stamp>,
}

/// Files that changed on disk, already read.
pub struct Changes {
    now: HashMap<String, Stamp>,
    /// creation times the system gives (`made_of`)
    made: HashMap<String, u64>,
    read: Vec<(String, String, bool)>,
    removed: Vec<String>,
    base: HashMap<String, Stamp>,
    /// config.edn changed and read again (its stamp, its settings); its stamp before
    config: Option<(Option<Stamp>, Config)>,
    config_base: Option<Stamp>,
}

/// Where the settings are (a rescan reports a change to them by this path).
pub const CONFIG_REL: &str = "logseq/config.edn";

/// config.edn's stamp (None: no file, or it can't be looked at).
fn config_stamp(root: &Path) -> Option<Stamp> {
    std::fs::metadata(root.join(CONFIG_REL)).ok().filter(|m| m.is_file()).map(|m| stamp_of(&m))
}

/// Scan the folders and read changed files (no app lock needed). A changed config.edn is read too:
/// only a whole file counts (one that can't be read just now, is gone, or is half written stays
/// unread, and the settings as they are, until a later rescan finds it readable).
pub fn collect_changes(plan: ScanPlan) -> Changes {
    let (now, made) = scan(&plan.root, &plan.cfg);
    let to_read: Vec<String> = now.iter().filter(|(r, st)| plan.files.get(*r) != Some(st)).map(|(r, _)| r.clone()).collect();
    let removed: Vec<String> = plan.files.keys().filter(|r| !now.contains_key(*r)).cloned().collect();
    let read = read_parallel(&plan.root, &to_read);
    let cs = config_stamp(&plan.root);
    let config = (cs.is_some() && cs != plan.config_stamp)
        .then(|| std::fs::read_to_string(plan.root.join(CONFIG_REL)).ok().filter(|t| crate::edn::parse(t).is_some()))
        .flatten()
        .map(|t| (cs, Config::from_edn(&t)));
    Changes { now, made, read, removed, base: plan.files, config, config_base: plan.config_stamp }
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

/// A renamed (or merged) page's links in another file, made safely (`rewrite`: a version saved
/// elsewhere meanwhile is read again and changed instead). Done: changed; Left: no link to change;
/// None: it couldn't be read or written, or kept changing (the caller lists it as skipped).
fn link_rewrite(path: &Path, olds: &[String], new: &str, comma: &[String]) -> Option<Rewrite> {
    rewrite(path, "", 3, |cur| Ok(cur.and_then(|c| rename_in_text(c, olds, new, comma)))).ok().filter(|r| !matches!(r, Rewrite::Busy))
}

/// `rename_in_text` on a page already split: links to `olds` in its properties and notes now point
/// at `new` (only the notes that change are touched).
fn rename_doc(doc: &mut Doc, olds: &[String], new: &str, comma: &[String]) {
    if let Some(p) = crate::text::rename_refs(&doc.preamble, olds, new, comma) {
        doc.preamble = p;
    }
    for b in &mut doc.blocks {
        if let Some(t) = crate::text::rename_refs(&b.text, olds, new, comma) {
            b.text = t;
        }
    }
}

/// Can a page's YAML header (if it has one) all become `key:: value` properties (`parse::yaml_props`):
/// one-line values, `[a, b]` lists and `- item` lists? Not: a value over several lines (`|`, `>`,
/// an indented continuation) or nested keys, which a merge would lose.
fn yaml_header_simple(text: &str) -> bool {
    let d = split_doc(text);
    let pre: Vec<&str> = d.preamble.split_inclusive('\n').collect();
    let fm = crate::doc::front_matter_len(&pre).unwrap_or(0);
    let mut list = false; // (after a key with no value: its "- item" lines)
    for l in pre.iter().take(fm).skip(1) {
        let t = l.trim_end_matches(['\n', '\r']);
        if t.trim_end() == "---" || t.trim_end() == "..." {
            break;
        }
        if t.trim().is_empty() || t.starts_with('#') {
            continue;
        }
        if t.starts_with(' ') || t.starts_with('\t') || t.starts_with("- ") || t == "-" {
            if !list || !t.trim_start().starts_with("- ") || crate::doc::yaml_key(t.trim_start().trim_start_matches("- ")).is_some() {
                return false;
            }
            continue;
        }
        match crate::doc::yaml_key(t) {
            Some((_, v)) => {
                let v = v.trim();
                if v.starts_with('|') || v.starts_with('>') {
                    return false;
                }
                list = v.is_empty();
            }
            None => return false,
        }
    }
    true
}

/// The notes of a page being merged into another (`App::merge_pages`), as new notes for the end of
/// that page: its properties first, as a note of their own (Logseq lines as written, a YAML
/// header's as `key:: value`; `title::` left out: the name goes away), then its notes (paragraphs
/// before its first bullet become bullets; a note never steps in more than one level below the one
/// before it), links to `olds` pointing at `new`. Also: did its properties come along?
fn moved_notes(text: &str, olds: &[String], new: &str, comma: &[String]) -> (Vec<DocBlock>, bool) {
    let d = split_doc(text);
    let is_title = |l: &str| crate::parse::property(l.trim()).is_some_and(|(k, _)| k == "title");
    let pre: Vec<&str> = d.preamble.split_inclusive('\n').collect();
    let fm = crate::doc::front_matter_len(&pre).unwrap_or(0);
    let mut props: Vec<String> = crate::parse::yaml_props(&pre[..fm]).into_iter().filter(|(k, _)| k != "title").map(|(k, v)| format!("{k}:: {v}")).collect();
    let mut on_top = fm > 0; // (the page has properties at the top of its file)
    for l in &pre[fm..] {
        let l = l.trim_end_matches(['\n', '\r']).trim();
        if crate::parse::property(l).is_some() {
            on_top = true;
            if !is_title(l) {
                props.push(l.to_string());
            }
        }
    }
    let mut came = !props.is_empty();
    let mut out = vec![];
    let mut prev: Option<usize> = None;
    let mut push = |text: String, depth: usize, out: &mut Vec<DocBlock>| {
        let text = crate::text::rename_refs(&text, olds, new, comma).unwrap_or(text);
        let depth = prev.map_or(0, |p| depth.min(p + 1));
        prev = Some(depth);
        out.push(DocBlock { depth, text, raw: None, plain: false });
    };
    if came {
        push(props.join("\n"), 0, &mut out);
    }
    for (n, b) in d.blocks.iter().enumerate() {
        let mut t = b.text.clone();
        // Logseq's other place for page properties: a first note holding only them
        let lines = || t.split('\n').filter(|l| !l.trim().is_empty());
        if n == 0 && !on_top && !b.plain && b.depth == 0 && lines().count() > 0 && lines().all(|l| crate::parse::property(l.trim()).is_some()) {
            t = lines().filter(|l| !is_title(l)).collect::<Vec<_>>().join("\n");
            if t.is_empty() {
                continue;
            }
            came = true;
        }
        push(t, b.depth, &mut out);
    }
    (out, came)
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
    /// Open a notes folder (the app). A `logseq/config.edn` that is there but can't be read just now
    /// stops it (`capture::read_config`): the notes are never shown, nor journal days placed, by
    /// guessed settings; the app says so and offers Try again.
    pub fn open(root: &Path) -> Result<App, String> {
        Self::load(root, true)
    }

    /// Open a notes folder only to read it (the health check, the Windows capture box): the index
    /// cache is used, so only files changed since are read, but never written (nor a safety copy
    /// made). Its settings as for `open`.
    pub fn open_read_only(root: &Path) -> Result<App, String> {
        Self::load(root, false)
    }

    /// Open a notes folder; `keep_cache`: write the index cache (the app itself). Not for the
    /// read-only opens, which would otherwise make the cache forget texts that changes made
    /// elsewhere replaced, before the app has put them in a safety copy.
    fn load(root: &Path, keep_cache: bool) -> Result<App, String> {
        if !root.is_dir() {
            return Err(format!("Folder not found: {}", root.display()));
        }
        // (its stamp first: a change while it's read is seen by the next rescan)
        let config_stamp = config_stamp(root);
        let cfg = crate::capture::read_config(root).map_err(|e| format!("Couldn't read your notes settings (logseq/config.edn) just now, so your notes weren't opened: with the wrong settings, journals would show and be saved in the wrong place. Try again in a moment. If the folder is on Google Drive, check that Drive is running. ({e})"))?;
        let (stamps, made) = scan(root, &cfg);
        let (mut cache, noted) = load_cache(root);
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
        // when each file was made (All pages' "Created"); a cache from before kept none: written once
        let born: HashMap<String, u64> = files.iter().map(|(r, st)| (r.clone(), born_from(noted.get(r).copied(), made.get(r).copied(), *st))).collect();
        let cache_dirty = !to_read.is_empty() || cache_had != contents.len() || born.keys().any(|r| !noted.contains_key(r));
        // `replaced`: for the safety copy made next (start_safety_copy). Until they're in a copy, the
        // index cache on disk is the only place that has those earlier texts: it's written now only
        // when there are none (else by start_safety_copy once they're kept, or the next persist).
        // Opened only to read (the capture box, the check), it's never written: see write_cache.
        let mut app = App { root: root.to_path_buf(), vault, files, contents, non_utf8, cache_dirty, replaced, keep_cache, born, last_merge: None, config_stamp };
        if keep_cache && app.replaced.is_empty() {
            app.write_cache();
        }
        Ok(app)
    }

    /// Persist file texts so the next start only reads files that changed. The cache forgets the
    /// earlier texts that changes made elsewhere replaced, so those go into a safety copy first; if
    /// that copy can't be made, the cache isn't written (the one on disk still has them).
    fn write_cache(&mut self) {
        if !self.keep_cache {
            return; // opened only to read: nothing is written, not the cache, not a safety copy
        }
        if !self.keep_replaced() {
            return;
        }
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
        let born = self.born.iter().filter(|(r, _)| self.contents.contains_key(*r)).map(|(r, t)| (r.clone(), *t)).collect();
        let c = CacheFile { v: CACHE_VERSION, root: self.root.display().to_string(), files, born };
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
        ScanPlan { root: self.root.clone(), cfg: self.vault.config.clone(), files: self.files.clone(), config_stamp: self.config_stamp }
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
            let b = born_from(self.born.get(&rel).copied(), ch.made.get(&rel).copied(), ch.now[&rel]);
            self.born.insert(rel.clone(), b);
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
            self.born.remove(&rel);
            changed.push(rel);
        }
        // the settings, changed elsewhere (Logseq, the phone) or arrived late (Google Drive); not when
        // the app itself changed them meanwhile (read again next time)
        if let Some((st, cfg)) = ch.config.filter(|_| self.config_stamp == ch.config_base) {
            if self.take_config(st, cfg) {
                changed.push(CONFIG_REL.into());
            }
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

    /// Settings read again because config.edn changed on disk (`collect_changes`). Those that decide
    /// which files are notes and how journal days are named and found (the folders, the date
    /// formats, comma properties) mean the index is made again, as when the folder opens (`load`:
    /// from the index cache, written first, so only files new to it are read); the others are simply
    /// taken. True when any changed.
    fn take_config(&mut self, stamp: Option<Stamp>, cfg: Config) -> bool {
        let c = &self.vault.config;
        if *c == cfg {
            self.config_stamp = stamp;
            return false;
        }
        let index = (&c.pages_dir, &c.journals_dir, &c.journal_title_format, &c.journal_file_format, &c.comma_props);
        if index == (&cfg.pages_dir, &cfg.journals_dir, &cfg.journal_title_format, &cfg.journal_file_format, &cfg.comma_props) {
            self.vault.config = cfg;
            self.config_stamp = stamp;
            return true;
        }
        self.write_cache(); // (the texts as they are now; earlier texts into a safety copy first)
        match Self::load(&self.root, self.keep_cache) {
            Ok(fresh) => {
                *self = fresh;
                true
            }
            Err(e) => {
                crate::log::record(&format!("The notes settings changed, but couldn't be taken in yet: {e}"));
                false
            }
        }
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
        let mut refs = self.vault.linked_refs(name);
        for g in &mut refs {
            // (the times the app keeps for every file: no extra reading)
            g.changed = g.path.as_deref().and_then(|r| self.files.get(r)).map(|s| s.mtime_ns / 1_000_000_000);
            g.created = g.path.as_deref().and_then(|r| self.born.get(r)).copied();
        }
        PageView { refs, tagged: self.vault.pages_tagged(name), info, doc, hash, readonly, from_template, error }
    }

    fn record_write(&mut self, rel: &str, text: &str) {
        self.vault.upsert(rel, text);
        if let Ok(md) = std::fs::metadata(self.root.join(rel)) {
            let st = stamp_of(&md);
            self.files.insert(rel.to_string(), st);
            // (a save writes a new file under the old name: its creation time is now, the page's isn't)
            let b = born_from(self.born.get(rel).copied(), made_of(&md), st);
            self.born.insert(rel.to_string(), b);
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
        self.born.remove(rel);
        self.cache_dirty = true;
    }

    pub fn save(&mut self, req: SaveReq) -> Result<SaveRes, String> {
        let info = self.vault.page_info(&req.name);
        let rel = info.path.ok_or("page has no path")?;
        if req.path.as_ref().is_some_and(|p| *p != rel) {
            // the name now belongs to another file (renamed, or a duplicate name took over)
            return Err("This page's file changed (it was renamed or moved), so nothing was saved. Open the page again.".into());
        }
        let path = self.root.join(&rel);
        // The new text replaces exactly the bytes read (`Expect::Bytes`, checked again right before
        // it's written): a version saved elsewhere in between (Google Drive bringing the phone's, at
        // the very moment) is never written over; it's read again and merged like any other.
        for _ in 0..3 {
            let current = read_text(&path).map_err(|e| e.say("this page's file"))?;
            let cur_hash = current.as_deref().map(content_hash).unwrap_or_default();
            let mut merged = None;
            if cur_hash != req.base_hash {
                if req.force {
                    // "Keep mine": the other version goes to logseq/bak first, so nothing is lost
                    if let Some(c) = &current {
                        self.backup(&rel, c)?;
                    }
                } else {
                    let theirs = split_doc(current.as_deref().unwrap_or(""));
                    match req.base.as_ref().and_then(|b| crate::merge::merge_docs(b, &req.doc, &theirs)) {
                        Some(m) => merged = Some(m),
                        None => return Ok(SaveRes { ok: false, hash: cur_hash, conflict: true, merged: None }),
                    }
                }
            }
            let doc = merged.as_ref().unwrap_or(&req.doc);
            let text = join_doc(doc);
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
            match &current {
                // a new page: its own file (Vault::free_rel), written only where no file is yet; one
                // that turned up meanwhile is a clash like any change made elsewhere
                None if !write_atomic_checked(&path, &text, Expect::Missing)? => {
                    return Ok(SaveRes { ok: false, hash: hash_now(&path), conflict: true, merged: None });
                }
                Some(c) if !write_atomic_checked(&path, &text, Expect::Bytes(c.as_bytes()))? => continue,
                _ => {}
            }
            self.record_write(&rel, &text);
            let merged = merged.map(|_| split_doc(&text));
            return Ok(SaveRes { ok: true, hash: content_hash(&text), conflict: false, merged });
        }
        // saved elsewhere at every try: the clash screen (it reads the file again)
        Ok(SaveRes { ok: false, hash: hash_now(&path), conflict: true, merged: None })
    }

    /// A page's backup folder, `logseq/bak/<its file without .md>` (Logseq's place for its backups).
    fn bak_dir(&self, rel: &str) -> PathBuf {
        self.root.join("logseq").join("bak").join(rel.trim_end_matches(".md"))
    }

    /// Keep a copy of a page's text in `logseq/bak/<file>/<UTC time>.md` (Logseq's backup place); a
    /// second copy within the same second gets "-2", "-3"… (never overwrites one). Returns where it
    /// went ("logseq/bak/pages/Note/2026-10-27_01_32_00.md").
    fn backup(&self, rel: &str, text: &str) -> Result<String, String> {
        let stamp = crate::log::now_utc().replace([' ', ':'], "_").replace("_UTC", "");
        let dir = self.bak_dir(rel);
        let mut name = format!("{stamp}.md");
        let mut n = 2;
        while dir.join(&name).exists() {
            name = format!("{stamp}-{n}.md");
            n += 1;
        }
        write_atomic(&dir.join(&name), text).map_err(|e| format!("Couldn't keep a backup copy, so nothing was saved: {e}"))?;
        Ok(format!("logseq/bak/{}/{name}", rel.trim_end_matches(".md")))
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
        self.backup(&rel, &join_doc(doc)).map(|_| ())
    }

    /// Replace one block's text, found by its line, if it still reads `base` on disk.
    /// Used by lists that edit pages which aren't open (to-dos, unlinked references).
    pub fn save_block(&mut self, name: &str, line: usize, base: &str, text: &str) -> Result<SaveRes, String> {
        let info = self.vault.page_info(name);
        let rel = info.path.filter(|_| info.exists).ok_or("That page has no file.")?;
        let path = self.root.join(&rel);
        // (a version saved elsewhere meanwhile: read again, and changed there if the note is still there)
        let r = rewrite(&path, "that page's file", 3, |cur| {
            let cur = cur.ok_or("That page's file is gone.")?;
            let mut doc = split_doc(cur);
            let lines = crate::block_lines(&doc);
            let Some(i) = lines.iter().position(|&l| l == line).filter(|&i| doc.blocks[i].text == base) else { return Ok(None) };
            doc.blocks[i].text = text.to_string();
            Ok(Some(keep_shape(Some(cur), join_doc(&doc), doc.crlf)))
        })?;
        match r {
            Rewrite::Done(_, out) => {
                self.record_write(&rel, &out);
                Ok(SaveRes { ok: true, hash: content_hash(&out), conflict: false, merged: None })
            }
            Rewrite::Left(cur) => Ok(SaveRes { ok: false, hash: cur.as_deref().map(content_hash).unwrap_or_default(), conflict: true, merged: None }),
            Rewrite::Busy => Ok(SaveRes { ok: false, hash: hash_now(&path), conflict: true, merged: None }),
        }
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
    /// included even without a file; other days when they have notes, or when other pages link to
    /// them (linked references), as in Logseq.
    pub fn journals(&self, end: Date, count: usize, include_end: bool) -> Vec<JournalDay> {
        // like Logseq: past days whose file is empty (auto-created, or just "-") are skipped, unless linked to
        let linked = self.vault.linked_journal_dates();
        let mut days: Vec<Date> = self.vault.journal_dates().into_iter().filter(|d| *d <= end).filter(|d| *d == end || self.journal_has_text(*d)).collect();
        days.extend(linked.into_iter().filter(|d| *d <= end));
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
        self.capture_line_to_page(page, &|cfg| crate::capture::note_line(cfg, text, url, todo, today, time))
    }

    /// `capture_to_page` with the note's text made by `line` from the settings as they are when
    /// it's added (the quick capture template; Android's shared pictures use the media one).
    pub fn capture_line_to_page(&mut self, page: &str, line: &dyn Fn(&crate::config::Config) -> Result<String, String>) -> Result<String, String> {
        for _ in 0..3 {
            self.rescan();
            let t = self.page_target(page)?;
            let line = line(&self.vault.config)?;
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
            match link_rewrite(&self.root.join(&rel), &olds, &new, &comma) {
                Some(Rewrite::Done(_, t)) => {
                    self.record_write(&rel, &t);
                    changed += 1;
                }
                Some(Rewrite::Left(_)) => {}
                _ => skipped.push(rel),
            }
        }
        // 2. the page's own file: its self-links and title::, then the file name
        if let (Some(rel), Some(nrel)) = (own_rel, new_rel) {
            let path = self.root.join(&rel);
            // (looked at again: a file synced in while the links changed is never replaced)
            if crate::key(&nrel) != crate::key(&rel) && self.root.join(&nrel).exists() {
                return Err(format!("A file named “{nrel}” turned up in your notes folder just now, so “{}” wasn't renamed, though links to it now say “{new}”. Rename that file, then rename this page again.", info.name));
            }
            let own = |cur: Option<&str>| {
                let cur = cur.unwrap_or("");
                let text = rename_in_text(cur, &olds, &new, &comma).unwrap_or_else(|| cur.to_string());
                let text = if crate::parse::parse_page(&text, &comma).title.is_some() {
                    set_title_prop(&text, &new)
                } else if self.vault.title_from_path(&nrel).0 != new {
                    // like a new page: a name the file name can't hold exactly (con, a trailing dot…)
                    add_title_prop(&text, &new)
                } else {
                    text
                };
                Ok((text != cur).then_some(text))
            };
            let text = match rewrite(&path, "this page's file", 3, own)? {
                Rewrite::Done(_, t) => t,
                Rewrite::Left(cur) => cur.unwrap_or_default(),
                Rewrite::Busy => return Err(format!("“{}” kept being saved somewhere else just now, so it wasn't renamed. Try again in a moment.", info.name)),
            };
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
                let was = self.born.get(&rel).copied(); // (when the page was made: it's the same page)
                self.forget(&rel);
                self.record_write(&nrel, &text);
                if let Some(w) = was {
                    let b = self.born.get(&nrel).map_or(w, |&n| n.min(w));
                    self.born.insert(nrel.clone(), b);
                }
            } else {
                self.record_write(&nrel, &text);
            }
        }
        self.write_cache();
        self.rename_favorite(&info.name, &new);
        Ok(RenameRes { favorites: self.vault.config.favorites.clone(), name: new, files_changed: changed, skipped })
    }

    /// Before renaming page `old` to `new`: Ok(None) when `new` is free (a plain rename), Ok(Some(its
    /// name)) when another page already has that name (or alias: then that page): the two can be
    /// merged (`merge_pages`); Err when the name can't be used (says why).
    pub fn rename_target(&self, old: &str, new: &str) -> Result<Option<String>, String> {
        let new = clean_name(new)?;
        let info = self.vault.page_info(old);
        if info.journal.is_some() {
            return Err("Journal pages are named after their date, so they can't be renamed.".into());
        }
        if self.vault.config.journal_from_title(&new).is_some() {
            return Err("That name looks like a journal date. Pick another name.".into());
        }
        let old_key = crate::key(&info.name);
        if crate::key(&new) == old_key {
            return Ok(None); // only its capitals change
        }
        if self.vault.resolve(&new) == old_key {
            return Err(format!("“{new}” is already another name of this page (its alias)."));
        }
        let other = self.vault.page_info(&new);
        if other.exists && other.journal.is_some() {
            return Err(format!("“{new}” is another name of the journal day “{}”, and a page can't be merged into a journal day. Pick another name.", other.name));
        }
        if other.exists && self.vault.has_duplicate(&info.name) {
            return Err(format!("Another file also says it is “{}” (Settings → Notes → Check this folder), so it can't be merged safely. Rename or remove that file first.", info.name));
        }
        Ok(other.exists.then_some(other.name))
    }

    /// Merge page `old` into the page `into` (renaming a page to the name of one that exists), as
    /// Logseq does: `old`'s notes are added at the end of `into` (its properties, except `title::`,
    /// as the first of them: nothing is lost, and the notes `into` has keep their place), links to
    /// `old` everywhere point at `into` (in `into`'s own notes too), and `old`'s file goes to the bin
    /// (`logseq/.recycle`). `into`'s file is changed only by those: every other byte stays, its line
    /// endings, byte-order mark, indentation and missing last line break too; it's written only if
    /// nobody saved it meanwhile. `undo_merge(res.undo)` puts it all back while nothing changed since.
    pub fn merge_pages(&mut self, old: &str, into: &str) -> Result<MergeRes, String> {
        let info = self.vault.page_info(old);
        if info.journal.is_some() {
            return Err("Journal pages are named after their date, so they can't be merged into another page.".into());
        }
        let target = self.vault.page_info(&clean_name(into)?);
        if !target.exists {
            return Err(format!("There's no page called “{}” now, so nothing was merged.", target.name));
        }
        if target.journal.is_some() {
            return Err("A page can't be merged into a journal day.".into());
        }
        if crate::key(&target.name) == crate::key(&info.name) {
            return Err("That's this page.".into());
        }
        if self.vault.has_duplicate(&info.name) {
            // (its file going to the bin would hand the name to the other file, links already moved)
            return Err(format!("Another file also says it is “{}” (Settings → Notes → Check this folder), so it can't be merged safely. Rename or remove that file first.", info.name));
        }
        let (name, t_rel) = (target.name.clone(), target.path.clone().unwrap_or_default());
        let t_path = self.root.join(&t_rel);
        let olds = vec![crate::key(&info.name)];
        let comma = self.vault.config.comma_props.clone();
        let from_rel = info.path.clone().filter(|_| info.exists);
        let from_text = match &from_rel {
            Some(r) => Some(read_text(&self.root.join(r)).map_err(|e| e.say(&format!("the file of “{}”", info.name)))?.ok_or_else(|| format!("The file of “{}” is gone.", info.name))?),
            None => None,
        };
        if from_text.as_deref().is_some_and(|t| !yaml_header_simple(t)) {
            return Err(format!("“{}” starts with a YAML header that can't all become properties (a value over several lines, or nested ones), so the pages weren't merged and nothing was changed. Move those lines into a note first.", info.name));
        }
        let before = read_text(&t_path).map_err(|e| e.say(&format!("the file of “{name}”")))?.ok_or_else(|| format!("The file of “{name}” is gone."))?;
        // the page's own links to the old name, then the notes that come over
        let mut doc = split_doc(&before);
        rename_doc(&mut doc, &olds, &name, &comma);
        let (moved, props) = from_text.as_deref().map(|t| moved_notes(t, &olds, &name, &comma)).unwrap_or_default();
        let notes = moved.len();
        doc.blocks.extend(moved);
        let after = keep_shape(Some(&before), join_doc(&doc), doc.crlf);
        let mut files = vec![];
        if after != before {
            if !write_atomic_checked(&t_path, &after, Expect::Bytes(before.as_bytes()))? {
                return Err(format!("“{name}” was saved somewhere else just now, so nothing was merged. Try again."));
            }
            self.record_write(&t_rel, &after);
            files.push((t_rel.clone(), before.clone(), after.clone()));
        }
        // the old page's file to the bin; if it can't go, the other page is put back as it was
        let mut binned = None;
        if let (Some(rel), Some(text)) = (from_rel, from_text) {
            match self.bin_file(&rel) {
                Ok(dest) => {
                    self.forget(&rel);
                    binned = Some((rel, dest, text));
                }
                Err(e) => {
                    if after != before && write_atomic_checked(&t_path, &before, Expect::Bytes(after.as_bytes())).unwrap_or(false) {
                        self.record_write(&t_rel, &before);
                    }
                    return Err(format!("Couldn't move “{}” to the bin ({e}), so nothing was merged.", info.name));
                }
            }
        }
        // links in other files
        let mut skipped = vec![];
        let mut changed = 0;
        for src in self.vault.linking_pages(&info.name) {
            let Some(rel) = self.vault.path_of_key(&src).filter(|r| *r != t_rel) else { continue };
            // (one that can't be read or written, or keeps changing elsewhere, is listed, and the
            // merge still finishes: its Undo, favourites and the index stay right)
            match link_rewrite(&self.root.join(&rel), &olds, &name, &comma) {
                Some(Rewrite::Done(cur, t)) => {
                    self.record_write(&rel, &t);
                    files.push((rel, cur, t));
                    changed += 1;
                }
                Some(Rewrite::Left(_)) => {}
                _ => skipped.push(rel),
            }
        }
        self.write_cache();
        static N: AtomicUsize = AtomicUsize::new(1);
        let id = N.fetch_add(1, Ordering::Relaxed) as u64;
        let config = self.rename_favorite(&info.name, &name);
        self.last_merge = Some(MergeUndo { id, from: info.name, files, binned, config });
        Ok(MergeRes { favorites: self.vault.config.favorites.clone(), name, notes, props, files_changed: changed, skipped, undo: id })
    }

    /// Undo merge `id` (the last one): the merged page back from the bin, every file the merge
    /// changed back as it was. Only while nothing changed since (else it says so, and nothing is
    /// done: the old page is still in the bin). Returns the merged page's name.
    pub fn undo_merge(&mut self, id: u64) -> Result<String, String> {
        if self.last_merge.as_ref().map(|u| u.id) != Some(id) {
            return Err("That merge can't be undone any more.".into());
        }
        let Some(u) = self.last_merge.take() else { return Err("That merge can't be undone any more.".into()) };
        let later = |what: &str| format!("{what} changed since the merge, so it can't be undone from here. “{}” is in the bin (Settings → Notes → Deleted pages).", u.from);
        for (rel, _, after) in &u.files {
            if !matches!(read_text(&self.root.join(rel)), Ok(Some(t)) if t == *after) {
                return Err(later(&format!("“{}”", self.vault.title_from_path(rel).0)));
            }
        }
        if let Some((rel, dest, text)) = &u.binned {
            if !matches!(read_text(dest), Ok(Some(t)) if t == *text) {
                return Err(later("The file in the bin"));
            }
            if self.root.join(rel).exists() || self.vault.page_info(&u.from).exists {
                return Err(format!("There's a page called “{}” again, so the merge can't be undone from here.", u.from));
            }
            std::fs::rename(dest, self.root.join(rel)).map_err(|e| format!("Couldn't take “{}” out of the bin: {e}", u.from))?;
            self.record_write(rel, text);
        }
        let mut failed = vec![];
        for (rel, before, after) in &u.files {
            match write_atomic_checked(&self.root.join(rel), before, Expect::Bytes(after.as_bytes())) {
                Ok(true) => self.record_write(rel, before),
                _ => failed.push(self.vault.title_from_path(rel).0),
            }
        }
        self.write_cache();
        // the favourite back too (unless config.edn was changed since: then it's left as it is)
        if let Some((before, after)) = &u.config {
            let path = self.root.join("logseq").join("config.edn");
            if let Ok(true) = write_atomic_checked(&path, before, Expect::Bytes(after.as_bytes())) {
                self.vault.config.favorites = Config::from_edn(before).favorites;
                self.config_stamp = config_stamp(&self.root);
            }
        }
        if !failed.is_empty() {
            return Err(format!("“{}” is back, but these pages changed meanwhile and were left as they are: {}", u.from, failed.join(", ")));
        }
        Ok(self.vault.page_info(&u.from).name)
    }

    /// A page's file (to show it in Explorer).
    pub fn page_file(&self, name: &str) -> Result<PathBuf, String> {
        let info = self.vault.page_info(name);
        let rel = info.path.filter(|_| info.exists).ok_or("This page has no file yet: it gets one when something is written in it.")?;
        let p = self.root.join(rel);
        if !p.is_file() {
            return Err("This page's file isn't there any more.".into());
        }
        Ok(p)
    }

    /// The to-dos (`Vault::tasks`), each with its page file's change time (the list sorts by it).
    pub fn tasks(&self, done: bool) -> Vec<crate::vault::TaskHit> {
        let mut v = self.vault.tasks(done);
        for t in &mut v {
            t.changed = self.files.get(&t.path).map(|s| s.mtime_ns / 1_000_000_000);
        }
        v
    }

    /// All pages (and names only linked to), each with its file's change time and when it was made
    /// (seconds; none without a file).
    pub fn pages(&self) -> Vec<crate::vault::PageEntry> {
        let mut v = self.vault.all_pages();
        for e in &mut v {
            if let Some(rel) = e.path.as_deref().filter(|_| e.exists) {
                e.changed = self.files.get(rel).map(|s| s.mtime_ns / 1_000_000_000);
                e.created = self.born.get(rel).copied();
            }
        }
        v
    }

    fn recycle_dir(&self) -> PathBuf {
        self.root.join("logseq").join(".recycle")
    }

    /// Move a page's file to `logseq/.recycle` (Logseq's bin), named by its path ("/" → "_", as
    /// Logseq names them; " (2)"… when the bin has that name). Returns where it went.
    fn bin_file(&self, rel: &str) -> Result<PathBuf, String> {
        let bin = self.recycle_dir();
        std::fs::create_dir_all(&bin).map_err(|e| format!("Couldn't make the bin folder: {e}"))?;
        let flat = rel.replace('/', "_");
        let stem = flat.strip_suffix(".md").unwrap_or(&flat).to_string();
        let mut dest = bin.join(&flat);
        let mut k = 2;
        while dest.exists() {
            dest = bin.join(format!("{stem} ({k}).md"));
            k += 1;
        }
        let src = self.root.join(rel);
        let moved = std::fs::rename(&src, &dest).is_ok() || (std::fs::copy(&src, &dest).is_ok() && std::fs::remove_file(&src).is_ok());
        if moved {
            Ok(dest)
        } else {
            Err("the file couldn't be moved".into())
        }
    }

    /// Move pages' files to `logseq/.recycle` (Logseq's bin). Returns how many were moved.
    pub fn delete_pages(&mut self, names: &[String]) -> Result<usize, String> {
        let mut n = 0;
        let mut errors = vec![];
        for name in names {
            let info = self.vault.page_info(name);
            let Some(rel) = info.path.filter(|_| info.exists) else { continue };
            if self.bin_file(&rel).is_ok() {
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

    /// After a rename or merge: a favourite naming `old` (any capitals) now names `new`, in the same
    /// place; when `new` is a favourite already (or `old` is listed twice), the extra entry goes, with
    /// the spaces before it. Only those entries' own texts change in config.edn: every other byte, the
    /// comments and the rest of the list too, stays. A config that can't be read or changed is left as
    /// it is (the rename itself is done; the problems log says why). Returns the file's text before
    /// and after, when it was changed (for `undo_merge`).
    fn rename_favorite(&mut self, old: &str, new: &str) -> Option<(String, String)> {
        let (ko, kn) = (crate::key(old), crate::key(new));
        if !self.vault.config.favorites.iter().any(|f| crate::key(f) == ko) {
            return None;
        }
        let path = self.root.join("logseq").join("config.edn");
        // (`rewrite`: a version saved elsewhere meanwhile is read again and changed instead)
        let edit = |text: Option<&str>| -> Result<Option<String>, String> {
            let Some(text) = text else { return Ok(None) };
            let Some(root) = crate::edn::parse(text) else { return Ok(None) };
            let items = root.get("favorites").map(|n| n.items()).unwrap_or_default();
            let is = |n: &crate::edn::Node, k: &str| n.as_str().is_some_and(|s| crate::key(s) == k);
            let mut keep = kn == ko || !items.iter().any(|i| is(i, &kn)); // (one entry may take the new name)
            let mut out = String::with_capacity(text.len());
            let mut at = 0;
            for item in items.iter().filter(|i| is(i, &ko)) {
                if keep {
                    out.push_str(&text[at..item.start]);
                    out.push_str(&crate::edn::quote(new));
                    at = item.end;
                    keep = false;
                } else {
                    // dropped, with the spaces (and commas) before it on its line; first on its line or in
                    // the list: the ones after it instead (line breaks stay: a ;; comment ends at one)
                    let b = text.as_bytes();
                    let gap = |c: u8| c == b' ' || c == b'\t' || c == b',';
                    let mut cut = item.start;
                    while cut > at && gap(b[cut - 1]) {
                        cut -= 1;
                    }
                    if cut == 0 || matches!(b[cut - 1], b'\n' | b'\r' | b'[' | b'(' | b'{') {
                        out.push_str(&text[at..item.start]);
                        at = item.end;
                        while at < b.len() && gap(b[at]) {
                            at += 1;
                        }
                    } else {
                        out.push_str(&text[at..cut]);
                        at = item.end;
                    }
                }
            }
            out.push_str(&text[at..]);
            if out == text {
                return Ok(None);
            }
            if crate::edn::parse(&out).is_none() {
                return Err("Renaming a favourite would break config.edn, so it wasn't changed.".into());
            }
            Ok(Some(out))
        };
        match rewrite(&path, "logseq/config.edn", 2, edit) {
            Ok(Rewrite::Done(text, out)) => {
                self.vault.config.favorites = Config::from_edn(&out).favorites;
                self.config_stamp = config_stamp(&self.root); // (its own change: nothing for a rescan)
                Some((text, out))
            }
            Ok(Rewrite::Left(_)) => None,
            Ok(Rewrite::Busy) => {
                crate::log::record("config.edn kept changing elsewhere just then, so a renamed favourite wasn't renamed there.");
                None
            }
            Err(e) => {
                crate::log::record(&e);
                None
            }
        }
    }

    /// Put `:favorites` in config.edn in the order of `names` (the sidebar's, after dragging one):
    /// only the favourites' own texts move (`edn::reorder_items`), so everything else in the file,
    /// the spaces and comments between them too, stays byte for byte. Favourites added or removed
    /// elsewhere meanwhile stay as the file has them: the ones named take the places they hold, in
    /// the order asked; any other keeps its own place. Returns the favourites as the file has them.
    pub fn reorder_favorites(&mut self, names: &[String]) -> Result<Vec<String>, String> {
        let path = self.root.join("logseq").join("config.edn");
        const BAD: &str = "Couldn't understand logseq/config.edn, so it wasn't changed.";
        let wanted: Vec<String> = names.iter().map(|n| crate::key(n)).collect();
        // (`rewrite`: a version saved elsewhere meanwhile is read again and changed instead)
        let edit = |text: Option<&str>| -> Result<Option<String>, String> {
            let Some(text) = text else { return Ok(None) };
            let root = crate::edn::parse(text).ok_or(BAD)?;
            let items = root.get("favorites").map(|n| n.items()).unwrap_or_default();
            let rank = |i: usize| items[i].as_str().and_then(|s| wanted.iter().position(|w| *w == crate::key(s)));
            let slots: Vec<usize> = (0..items.len()).filter(|&i| rank(i).is_some()).collect();
            let mut moved = slots.clone();
            moved.sort_by_key(|&i| rank(i)); // (stable: a name written twice keeps its two in order)
            let mut order: Vec<usize> = (0..items.len()).collect();
            for (&s, &m) in slots.iter().zip(&moved) {
                order[s] = m;
            }
            if !order.iter().enumerate().any(|(k, &m)| k != m) {
                return Ok(None);
            }
            let out = crate::edn::reorder_items(text, "favorites", &order).ok_or(BAD)?;
            if crate::edn::parse(&out).is_none() {
                return Err("The change would break config.edn, so it wasn't saved.".into());
            }
            Ok(Some(out))
        };
        let text = match rewrite(&path, "logseq/config.edn", 2, edit)? {
            Rewrite::Done(_, out) => {
                self.config_stamp = config_stamp(&self.root); // (its own change: nothing for a rescan)
                out
            }
            Rewrite::Left(Some(out)) => out,
            Rewrite::Left(None) => return Ok(vec![]),
            Rewrite::Busy => return Err(CONFIG_BUSY.into()),
        };
        self.vault.config.favorites = Config::from_edn(&text).favorites;
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
        // (`rewrite`: a version saved elsewhere meanwhile is read again and changed instead)
        let edit = |cur: Option<&str>| -> Result<Option<String>, String> {
            let mut text = cur.unwrap_or("{}\n").to_string();
            for (k, v) in edits {
                text = crate::edn::set_path(&text, &[*k], v).ok_or("Couldn't understand logseq/config.edn, so it wasn't changed.")?;
            }
            if crate::edn::parse(&text).is_none() {
                return Err("The change would break config.edn, so it wasn't saved.".into());
            }
            Ok(Some(text))
        };
        let Rewrite::Done(_, text) = rewrite(&path, "logseq/config.edn", 2, edit)? else { return Err(CONFIG_BUSY.into()) };
        self.config_stamp = config_stamp(&self.root); // (its own change: nothing for a rescan)
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

/// A file dropped on the app's window (its full path on this computer, from Explorer; ui/filedrop.js):
/// copied into `assets/` (`save_asset_file`, Logseq's name), or, when it's in `assets/` already, linked
/// where it is (no second copy). Returns (the link target "../assets/…", its Markdown,
/// `asset_markdown`). Folders, empty files and files over 25 MB are refused (the size is checked
/// before reading it).
pub fn save_dropped_file(root: &Path, path: &Path) -> Result<(String, String), String> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| !n.is_empty()).ok_or("that isn't a file")?;
    let md = std::fs::metadata(path).map_err(|e| format!("couldn't read it ({e})"))?;
    if md.is_dir() {
        return Err("it's a folder: drop the files in it instead".into());
    }
    if !md.is_file() {
        return Err("that isn't a file".into());
    }
    if let (Ok(full), Ok(assets)) = (path.canonicalize(), root.join("assets").canonicalize()) {
        if let Ok(rest) = full.strip_prefix(&assets) {
            // (a name with spaces or brackets, given by another app: written so the link still reads)
            let parts: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().replace('%', "%25").replace(' ', "%20").replace('(', "%28").replace(')', "%29")).collect();
            let rel = format!("../assets/{}", parts.join("/"));
            return Ok((rel.clone(), asset_markdown(&name, &rel)));
        }
    }
    if md.len() > MAX_ASSET_BYTES as u64 {
        return Err("it's over 25 MB; pick a smaller one".into());
    }
    // (at most the limit and one byte: a file growing meanwhile is caught by save_asset_file's check)
    let mut bytes = vec![];
    std::io::Read::read_to_end(&mut std::io::Read::take(std::fs::File::open(path).map_err(|e| format!("couldn't read it ({e})"))?, MAX_ASSET_BYTES as u64 + 1), &mut bytes)
        .map_err(|e| format!("couldn't read it ({e})"))?;
    let rel = save_asset_file(root, &name, &bytes)?;
    Ok((rel.clone(), asset_markdown(&name, &rel)))
}

/// Resolve a vault-relative path for showing a file (images), refusing anything outside the vault.
pub fn asset_file(root: &Path, p: &str) -> Option<PathBuf> {
    let p = p.trim_start_matches('/');
    let p = p.strip_prefix("../").unwrap_or(p);
    // Only plain names, joined one by one, so the path can never leave the notes folder before
    // the disk is touched: no "..", no drive ("C:"), no \\server\share address (on Windows, opening
    // one connects to that computer and offers the user's sign-in), no folder separator inside a part.
    if p.starts_with('\\') || p.contains(':') {
        return None;
    }
    let mut rel = PathBuf::new();
    for part in p.split(['/', '\\']).filter(|c| !c.is_empty() && *c != ".") {
        if part == ".." || part.contains('\0') {
            return None;
        }
        match Path::new(part).components().collect::<Vec<_>>().as_slice() {
            [std::path::Component::Normal(_)] => rel.push(part),
            _ => return None,
        }
    }
    if rel.as_os_str().is_empty() {
        return None;
    }
    let full = root.join(rel).canonicalize().ok()?;
    let base = root.canonicalize().ok()?;
    (full.starts_with(&base) && full.is_file()).then_some(full)
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
        // starting from scratch (start.rs): a new folder in the picker, a new notes folder set up
        "new_folder" => return Ok(json!(crate::start::new_folder(Path::new(&s("path")), &s("name"))?.display().to_string())),
        "start_notes" => {
            let today = if args.get("today").is_some_and(|v| !v.is_null()) { Some(date("today")?) } else { None };
            let demo = args.get("demo").and_then(Value::as_bool).unwrap_or(true);
            return to_value(crate::start::start_notes(Path::new(&s("path")), today, demo)?).map_err(|e| e.to_string());
        }
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
        // what a leanoutliner:// link asks for (link.rs): {kind: page|note|capture|app, …}, or null
        "link" => return to_value(crate::link::parse(&s("link"))).map_err(|e| e.to_string()),
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
        app.start_safety_copy(); // earlier texts right away, then the cache; the rest in the background (safety.rs)
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
        "journal_days" => to_value(app.journal_days()),
        "journal_name" => Ok(json!(app.journal_name(date("date")?))),
        "search" => to_value(app.search(&s("q"))),
        // pages only, for the [[ and # list (the same rules as the search box's pages)
        "search_pages" => to_value(app.vault.search_pages(&s("q"), n("limit").clamp(1, crate::vault::SEARCH_PAGES))),
        // block references: notes to pick one from (the editor's "((" and / menu), and the notes named by ids
        "search_blocks" => to_value(app.vault.search_blocks(&s("q"), 12)),
        "blocks_by_id" => {
            let ids: Vec<String> = serde_json::from_value(args.get("ids").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            to_value(app.vault.blocks_by_id(&ids))
        }
        // with each file's change time and when it was made (All pages' Changed and Created)
        "pages" => to_value(app.pages()),
        "tags" => to_value(app.vault.all_tags()),
        "props" => to_value(app.vault.all_property_keys()),
        "prop_values" => to_value(app.vault.prop_values(&s("key"))),
        "with_property" => {
            let val = s("value");
            to_value(app.vault.with_property(&s("key"), (!val.is_empty()).then_some(val.as_str())))
        }
        "tasks" => to_value(app.tasks(b("done"))),
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
        // renaming to a name a page already has: merge the two (as Logseq does), with an Undo
        "rename_target" => to_value(app.rename_target(&s("name"), &s("new_name"))?),
        "merge_pages" => to_value(app.merge_pages(&s("name"), &s("into"))?),
        "undo_merge" => Ok(json!(app.undo_merge(args.get("undo").and_then(Value::as_u64).unwrap_or(0))?)),
        // a page's file (the Windows app shows it in Explorer)
        "page_file" => Ok(json!(app.page_file(&s("name"))?.display().to_string())),
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
        "reorder_favorites" => {
            let names: Vec<String> = serde_json::from_value(args.get("names").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
            to_value(app.reorder_favorites(&names)?)
        }
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
        // a page's earlier versions (history.rs); "path": the file the editor opened, as for save
        "history" => to_value(app.history(data_dir().as_deref(), &s("name"), args.get("path").and_then(Value::as_str))?),
        "history_version" => to_value(app.history_version(data_dir().as_deref(), &s("name"), args.get("path").and_then(Value::as_str), &s("id"))?),
        "history_keep" => to_value(app.history_keep(data_dir().as_deref(), &s("name"), args.get("path").and_then(Value::as_str), &s("id"))?),
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
    /// How many files are right in it (not hidden ones): a folder of other things gets a warning
    /// before a notes folder is started there (start.rs).
    pub files: usize,
    /// The notes folder it is inside, if any (not itself: `vault` says that).
    pub inside: Option<String>,
}

/// A notes folder: Logseq's settings file, or a pages folder.
pub fn is_vault(p: &Path) -> bool {
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
    let mut dirs: Vec<DirEntry> = vec![];
    let mut files = 0;
    for e in rd.flatten() {
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let pp = e.path();
        if pp.is_dir() {
            dirs.push(DirEntry { name: e.file_name().to_string_lossy().into(), vault: is_vault(&pp), path: pp.display().to_string() });
        } else {
            files += 1;
        }
    }
    dirs.sort_by_key(|d| d.name.to_lowercase());
    let inside = p.parent().and_then(crate::start::notes_folder_of).map(|v| v.display().to_string());
    Ok(DirList { path: p.display().to_string(), parent: p.parent().map(|x| x.display().to_string()), dirs, vault: is_vault(p), files, inside })
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
    check_vault_at(root, now_secs())
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

//! A page's earlier versions: "History…" in a page's ⋯ menu (ui/history.js) lists them, shows one
//! drawn like the page and puts one back. They come from
//! - the backups in its backup folder, `logseq/bak/<its file without .md>/` (the folder really
//!   inside the notes folder; the files right in it, not links): Logseq's own
//!   ("2026-10-24T02_00_00.123Z.Desktop.md"; ".android.md" or ".ios.md" made on a phone; no device in
//!   older Logseq) and this app's ("2026-10-24_02_00_00.md", "…-2.md": `App::backup`, made when a
//!   clash shows or is settled, or a version is put back), dated by their names (UTC), another name
//!   by its file time;
//! - the safety copies holding its text, this device's and the other one's (safety.rs `copies_of`,
//!   in `logseq/.safety-<device>`): the page as copied, dated by the copy, and its texts from before changes
//!   made elsewhere, dated by their own file times; each says which device made it (`made`).
//!
//! Newest first. A version that reads exactly like the page now isn't listed, and one that reads
//! exactly like the one listed just before it neither (a run of the same text shows once: the
//! newest). Each says how it differs from the page now (notes more, fewer, changed; properties).
//! A version is named by where the listing found it ("bak:<file name>", "copy:<device>/<copy id>:<n>") and
//! only one the listing names is ever read (`version`: listed again, then found by that name), so a
//! name can't lead anywhere else ("..", another folder, another page's backups).
//!
//! Putting one back: `history_keep` keeps the page's text as it is now in `logseq/bak` (as Settings →
//! Safety copies does; never for a file that isn't UTF-8 text), then the editor saves the version
//! the usual way, against the version it read (base_hash): a change made elsewhere meanwhile is
//! merged, or the clash screen asks. Nothing in the notes folder is deleted or written over here.

use super::{read_text, safety, App, ReadErr};
use crate::{split_doc, Doc};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// At most this many versions are read (the newest).
const MAX_VERSIONS: usize = 100;
/// A backup bigger than this isn't read.
const MAX_BYTES: u64 = 25 * 1024 * 1024;

/// One earlier version in the list.
#[derive(Serialize, Debug)]
pub struct Version {
    /// Where the listing found it: "bak:<file name>" or "copy:<device>/<copy id>:<n>" (n: 0 the page
    /// as copied, 1, 2… a text from before a change made elsewhere).
    pub id: String,
    /// When (seconds since 1970): the backup's or copy's time; an earlier text's own file time.
    pub when: u64,
    /// Who kept it: "logseq-computer", "logseq-phone", "logseq" (no device in its name), "app" (this
    /// app's backup), "bak" (another file in the backup folder), "copy" (a safety copy), "before" (a
    /// text from before a change made elsewhere, in a safety copy).
    pub from: &'static str,
    /// Compared with the page now: notes only in this version, notes only in the page now, and notes
    /// in both but changed (paired up where the two differ); `props`: the page properties differ.
    /// All 0 and false: only spacing or line breaks differ.
    pub more: usize,
    pub fewer: usize,
    pub changed: usize,
    pub props: bool,
    /// A safety copy's: which device made it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub made: Option<safety::Made>,
}

/// One version, to show it drawn like a page.
#[derive(Serialize, Debug)]
pub struct VersionText {
    pub id: String,
    pub when: u64,
    pub from: &'static str,
    /// As the editor reads a page.
    pub doc: Doc,
    /// Its page properties, read as a page's are (`PageInfo.props`), for under its title.
    pub props: Vec<(String, String)>,
    /// The page reads exactly like this now: nothing to put back.
    pub same: bool,
}

/// `history_keep`'s answer.
#[derive(Serialize, Debug)]
pub struct Kept {
    /// The version, for the editor to save.
    pub doc: Doc,
    /// Where the page's text as it was went ("logseq/bak/pages/Note/2026-10-27_01_32_00.md"). None:
    /// the page had no file, or it already reads like this version.
    pub bak: Option<String>,
    /// The page already reads exactly like this version: nothing kept, nothing to save.
    pub same: bool,
}

/// Where one version is, before it's read.
struct Source {
    id: String,
    /// When, in milliseconds (the newest first); `n`: the app's "-2"… for two in the same second.
    ms: u64,
    n: u32,
    from: &'static str,
    file: PathBuf,
    /// In a safety copy's file: [where its text starts, length]; None: the whole file (a backup).
    span: Option<[u64; 2]>,
    made: Option<safety::Made>,
}

impl Source {
    /// Its text (None: gone, or not UTF-8 text).
    fn read(&self) -> Option<String> {
        match self.span {
            Some(sp) => safety::read_span(&self.file, sp),
            None => read_text(&self.file).ok().flatten(),
        }
    }
}

/// Every source's text at once (a backup or copy synced from the phone may first have to come
/// from Google Drive, which answers many requests at once much faster), in the same order.
fn read_all(sources: &[Source]) -> Vec<Option<String>> {
    let next = std::sync::atomic::AtomicUsize::new(0);
    let out = std::sync::Mutex::new(vec![None; sources.len()]);
    std::thread::scope(|s| {
        for _ in 0..sources.len().clamp(1, 8) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(src) = sources.get(i) else { break };
                let t = src.read();
                out.lock().unwrap_or_else(|p| p.into_inner())[i] = t;
            });
        }
    });
    out.into_inner().unwrap_or_else(|p| p.into_inner())
}

/// A file in a backup folder that can be a version: a ".md" file by a name of its own (not a hidden
/// one, such as a temp file being written).
fn bak_file_ok(name: &str) -> bool {
    name.len() > 3 && name.ends_with(".md") && !name.starts_with('.') && !name.contains(['/', '\\', '\0'])
}

/// What a backup's file name says: when (milliseconds since 1970), "-2"… (the app's second backup
/// within a second), and who made it. Logseq: "2026-10-24T02_00_00.123Z.Desktop.md" (UTC; ".android"
/// or ".ios" on a phone; none in older versions). This app: "2026-10-24_02_00_00.md" or
/// "2026-10-24_02_00_00-2.md" (UTC, `App::backup`). None: another name.
fn bak_name(name: &str) -> Option<(u64, u32, &'static str)> {
    let b = name.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<u64> { b.get(r.clone()).filter(|d| d.iter().all(u8::is_ascii_digit))?; name[r].parse().ok() };
    let (y, mo, d, h, mi, s) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let date = (y as i32, mo as u32, d as u32);
    if b[4] != b'-' || b[7] != b'-' || b[13] != b'_' || b[16] != b'_' || !crate::date::valid(date) || h > 23 || mi > 59 || s > 60 {
        return None;
    }
    let secs = u64::try_from(crate::date::days_from_civil(date)).ok()? * 86_400 + h * 3600 + mi * 60 + s;
    let rest = name.get(19..)?;
    match b[10] {
        b'T' => {
            // Logseq: [.123]Z[.<device>].md
            let (ms, rest) = match rest.strip_prefix('.') {
                Some(r) => {
                    let k = r.find(|c: char| !c.is_ascii_digit()).unwrap_or(r.len());
                    (format!("{:0<3}", &r[..k.min(3)]).parse().unwrap_or(0), &r[k..])
                }
                None => (0, rest),
            };
            let dev = rest.strip_prefix('Z')?.strip_suffix(".md")?;
            let from = match dev.strip_prefix('.').map(str::to_ascii_lowercase).as_deref() {
                Some("desktop") => "logseq-computer",
                Some("android" | "ios") => "logseq-phone",
                _ => "logseq",
            };
            Some((secs * 1000 + ms, 0, from))
        }
        b'_' => {
            // this app: [-2].md
            let n = match rest.strip_suffix(".md")? {
                "" => 1,
                more => more.strip_prefix('-')?.parse().ok().filter(|n| *n >= 2)?,
            };
            Some((secs * 1000, n, "app"))
        }
        _ => None,
    }
}

fn mtime_ms(md: &std::fs::Metadata) -> u64 {
    md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

/// Page properties as compared: line endings and blank lines at the end don't count.
fn norm(preamble: &str) -> String {
    preamble.replace('\r', "").trim_end().to_string()
}

/// How a version differs from the page now, notes compared by level and words: (more, fewer,
/// changed). The notes both have, in order, are the same; between two of those, notes paired up
/// count as changed, the rest as more (only in the version) or fewer (only in the page now).
fn differ(v: &Doc, now: &Doc) -> (usize, usize, usize) {
    let (a, b) = (crate::merge::keys(&v.blocks), crate::merge::keys(&now.blocks));
    // (too long to compare note by note: all of it as one stretch)
    let same = crate::merge::lcs(&a, &b).unwrap_or_default();
    let (mut more, mut fewer, mut changed, mut i, mut j) = (0, 0, 0, 0, 0);
    for (x, y) in same.into_iter().chain([(a.len(), b.len())]) {
        let (gv, gn) = (x - i, y - j);
        changed += gv.min(gn);
        more += gv.saturating_sub(gn);
        fewer += gn.saturating_sub(gv);
        (i, j) = (x + 1, y + 1);
    }
    (more, fewer, changed)
}

impl App {
    /// The page's file, as `save` finds it (and checked against the file the editor opened), when
    /// its earlier versions can be looked up (safety.rs `rel_ok`: a ".md" file, no "..", not in logseq/).
    fn history_rel(&self, name: &str, path: Option<&str>) -> Result<String, String> {
        let rel = self.vault.page_info(name).path.ok_or("This page has no file name.")?;
        if path.is_some_and(|p| p != rel) {
            return Err("This page’s file changed (it was renamed or moved). Open the page again.".into());
        }
        if !safety::rel_ok(&rel) {
            return Err("This page’s file has an unusual name, so its earlier versions can’t be looked up.".into());
        }
        Ok(rel)
    }

    /// The page's text now, read from its file ("" without one); a file that isn't UTF-8 text as read
    /// with its odd bytes replaced (only compared with, never written).
    fn text_now(&self, rel: &str) -> Result<String, String> {
        let p = self.root.join(rel);
        match read_text(&p) {
            Ok(t) => Ok(t.unwrap_or_default()),
            Err(ReadErr::NotText) => Ok(std::fs::read(&p).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default()),
            Err(e) => Err(e.say("This page's file")),
        }
    }

    /// Where the page's earlier versions are (`data`: the app's data folder, with the safety copies),
    /// newest first, at most 100. Nothing is read yet.
    fn sources(&self, data: Option<&Path>, rel: &str) -> Vec<Source> {
        let mut v = vec![];
        let dir = self.bak_dir(rel);
        // the folder as it really is, links followed: inside the notes folder, else not read
        let inside = dir.canonicalize().ok().zip(self.root.canonicalize().ok()).is_some_and(|(d, r)| d.starts_with(r));
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten().filter(|_| inside) {
            // only files right in the folder (a link isn't one: the entry's own metadata), by their own names
            let (Ok(name), Ok(md)) = (e.file_name().into_string(), e.metadata()) else { continue };
            if !bak_file_ok(&name) || !md.is_file() || md.len() > MAX_BYTES {
                continue;
            }
            let (ms, n, from) = bak_name(&name).unwrap_or_else(|| (mtime_ms(&md), 0, "bak"));
            v.push(Source { id: format!("bak:{name}"), ms, n, from, file: dir.join(&name), span: None, made: None });
        }
        if let Some(data) = data {
            for c in self.copies_of(data, rel) {
                let from = if c.before > 0 { "before" } else { "copy" };
                v.push(Source { id: format!("copy:{}:{}", c.id, c.before), ms: c.when.saturating_mul(1000), n: 0, from, file: c.file, span: Some(c.span), made: Some(c.made) });
            }
        }
        v.sort_by(|a, b| (b.ms, b.n, &b.id).cmp(&(a.ms, a.n, &a.id)));
        v.truncate(MAX_VERSIONS);
        v
    }

    /// One version by its name: only one the listing names, read from where it found it.
    fn version(&self, data: Option<&Path>, rel: &str, id: &str) -> Result<(Source, String), String> {
        let s = self.sources(data, rel).into_iter().find(|s| s.id == id).ok_or("That version isn’t in this page’s history (any more).")?;
        let text = s.read().ok_or("That version is gone, or isn’t plain text.")?;
        Ok((s, text))
    }

    /// The page's earlier versions, newest first: each one that reads differently from the page now
    /// and from the one listed just before it, with how it differs from the page now.
    pub fn history(&self, data: Option<&Path>, name: &str, path: Option<&str>) -> Result<Vec<Version>, String> {
        let rel = self.history_rel(name, path)?;
        let now = self.text_now(&rel)?;
        let now_doc = split_doc(&now);
        let sources = self.sources(data, &rel);
        let texts = read_all(&sources);
        let mut out = vec![];
        let mut last: Option<&String> = None; // the text listed just before
        for (s, text) in sources.into_iter().zip(&texts) {
            let Some(text) = text else { continue }; // gone meanwhile, or not plain text
            if *text == now || last == Some(text) {
                continue;
            }
            let doc = split_doc(text);
            let (more, fewer, changed) = differ(&doc, &now_doc);
            let props = norm(&doc.preamble) != norm(&now_doc.preamble);
            out.push(Version { id: s.id, when: s.ms / 1000, from: s.from, more, fewer, changed, props, made: s.made });
            last = Some(text);
        }
        Ok(out)
    }

    /// One version, to show it drawn like a page (read-only).
    pub fn history_version(&self, data: Option<&Path>, name: &str, path: Option<&str>, id: &str) -> Result<VersionText, String> {
        let rel = self.history_rel(name, path)?;
        let (s, text) = self.version(data, &rel, id)?;
        let same = text == self.text_now(&rel)?;
        let props = crate::parse_page(&text, &self.vault.config.comma_props).props;
        Ok(VersionText { id: s.id, when: s.ms / 1000, from: s.from, doc: split_doc(&text), props, same })
    }

    /// Before version `id` is put back: the page's text as it is now goes to `logseq/bak` (a new
    /// file there, never over one), unless it already reads like the version (`same`). Refused for a
    /// file that isn't UTF-8 text or can't be read just now: nothing is kept or changed then. The
    /// editor then saves the version the usual way (base_hash: merged with a change made elsewhere
    /// meanwhile, or the clash screen asks); nothing is written to the page's file here.
    pub fn history_keep(&self, data: Option<&Path>, name: &str, path: Option<&str>, id: &str) -> Result<Kept, String> {
        let rel = self.history_rel(name, path)?;
        let (_, text) = self.version(data, &rel, id)?;
        let cur = read_text(&self.root.join(&rel)).map_err(|e| e.say("This page's file"))?;
        if cur.as_deref() == Some(text.as_str()) {
            return Ok(Kept { doc: split_doc(&text), bak: None, same: true });
        }
        let bak = match &cur {
            Some(c) => Some(self.backup(&rel, c)?),
            None => None,
        };
        Ok(Kept { doc: split_doc(&text), bak, same: false })
    }
}

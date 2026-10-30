//! "Check this folder": pictures in `assets/` that nothing in the notes folder uses, and moving
//! them to the bin (`logseq/.recycle`, where deleted pages go).
//!
//! Generous about what counts as used, on purpose (offering a picture he needs is worse than
//! missing one nobody needs): a picture is used when ANY text file in the folder mentions its file
//! name, in any case, URL-encoded or not, whatever the shape (`../assets/x.png`, `assets/x.png`,
//! `My%20pic.png`, `![[x.png]]`, `cover:: x.png`, `<img src=…>`, `url(…)` in custom.css).
//! The texts: the notes the index holds (in memory, nothing read), and, read from disk, every other
//! text file: whiteboards, `logseq/config.edn`, `custom.css`, `custom.js`, pages in the bin (they
//! can be restored), notes outside pages/journals (Obsidian), text files inside assets/. Not
//! counted: `logseq/bak` (old copies) and hidden folders (.git, .obsidian…). If one of those texts
//! can't be read (say a Drive file that isn't available offline), no picture is called unused.
//! Logseq's PDF highlight pictures (`assets/<pdf>/3_<note id>_<stamp>.png`) are linked through the
//! note's id, so they also count as used while that id is written anywhere.
//! Pictures changed in the last 3 days are never offered (nor moved): a picture can arrive before the
//! note that uses it (Drive syncs file by file; the phone's pop-up saves the picture first). Their
//! time: the newer of the file's change time and its creation time on this disk, where the system
//! knows it (copying a file, or a sync app, can keep an old change time).
//! In the bin (`logseq/.recycle`, where deleted pages go) a picture's name says exactly where it came
//! from (`bin_name`), so "Put back" never guesses; its file time is set to when it was moved there.
//!
//! Speed: one pass over each text (and its URL-decoded form) finds all the names at once: at each
//! ".png" (".jpg"…) the text just before it is looked up among the names of each length.

use super::{collect_changes, now_secs, read_parallel, App, Changes};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Pictures changed this recently (seconds) are left alone: a note using one may still be on its way.
const RECENT: u64 = 3 * 86_400;

/// File types that count as pictures. Other files in assets/ (PDFs…) are left alone.
const PICTURES: [&str; 13] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "heif", "tif", "tiff", "ico"];
/// Text files that may mention a picture: notes, whiteboards, Obsidian canvases, styles, web pages.
const TEXTS: [&str; 8] = ["md", "markdown", "org", "edn", "canvas", "css", "html", "htm"];

/// Lowercased extension of a file name ("x.PNG" → "png"); none for ".png" or "x".
fn ext_of(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then(|| ext.to_ascii_lowercase())
}

/// Does a file with this name count as a picture?
pub fn is_picture(name: &str) -> bool {
    ext_of(name).is_some_and(|e| PICTURES.contains(&e.as_str()))
}

fn is_text(name: &str) -> bool {
    ext_of(name).is_some_and(|e| TEXTS.contains(&e.as_str()))
}

fn file_name(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

#[derive(Serialize, Default, Debug)]
pub struct PictureCheck {
    /// How many pictures assets/ holds.
    pub pictures: usize,
    /// The ones nothing mentions: (path, bytes), by path.
    pub unused: Vec<(String, u64)>,
    pub bytes: u64,
    /// Text files that couldn't be read (then nothing is called unused).
    pub unreadable: Vec<String>,
    /// Pictures changed in the last 3 days: not checked, never listed.
    pub recent: usize,
}

#[derive(Serialize, Debug)]
pub struct Binned {
    /// Moved to `logseq/.recycle`.
    pub moved: Vec<String>,
    /// Left where they are: (path, why, in plain words).
    pub skipped: Vec<(String, String)>,
}

/// What one walk through the notes folder finds.
struct Found {
    /// Pictures in assets/ and its subfolders: (path, bytes, when it last changed in seconds), by path.
    pictures: Vec<(String, u64, u64)>,
    /// Text files that may mention a picture.
    texts: Vec<String>,
}

/// When a file last changed (seconds since 1970): the newer of its change time and its creation time
/// on this disk (copying a file, or a sync app, can keep an old change time), where the system
/// knows the creation time.
fn changed_secs(md: &std::fs::Metadata) -> u64 {
    let secs = |t: std::io::Result<std::time::SystemTime>| t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    secs(md.modified()).max(secs(md.created()))
}

/// Walk the notes folder once. Hidden files and folders (.git, .obsidian, our temp files) and links
/// are skipped; from `logseq/` only the settings and the pages in the bin count.
fn walk(root: &Path) -> Found {
    let mut f = Found { pictures: vec![], texts: vec![] };
    for name in ["config.edn", "custom.css", "custom.js"] {
        if root.join("logseq").join(name).is_file() {
            f.texts.push(format!("logseq/{name}"));
        }
    }
    if let Ok(rd) = std::fs::read_dir(root.join("logseq").join(".recycle")) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && is_text(&name) && e.file_type().is_ok_and(|t| t.is_file()) {
                f.texts.push(format!("logseq/.recycle/{name}"));
            }
        }
    }
    // (folder, its path in the notes folder, inside assets/?)
    let mut stack = vec![(root.to_path_buf(), String::new(), false)];
    while let Some((dir, rel, in_assets)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue }; // a link is neither a folder nor a file here
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if ft.is_dir() {
                if rel.is_empty() && name.eq_ignore_ascii_case("logseq") {
                    continue; // done above
                }
                let assets = in_assets || (rel.is_empty() && name.eq_ignore_ascii_case("assets"));
                stack.push((e.path(), path, assets));
            } else if ft.is_file() {
                if in_assets && is_picture(&name) {
                    let md = e.metadata();
                    f.pictures.push((path, md.as_ref().map_or(0, |m| m.len()), md.as_ref().map_or(u64::MAX, changed_secs)));
                } else if is_text(&name) {
                    f.texts.push(path);
                }
            }
        }
    }
    f.pictures.sort();
    f
}

impl App {
    /// The text files the index doesn't hold (or holds an older version of), read now, and the
    /// ones that couldn't be read. `fresh`: notes changed on disk since indexed, already read.
    fn read_others(&self, texts: &[String], fresh: Option<&Changes>) -> (Vec<String>, Vec<String>) {
        let fresh: HashSet<&str> = fresh.map(|c| c.read.iter().map(|(r, _, _)| r.as_str()).collect()).unwrap_or_default();
        let need: Vec<String> = texts.iter().filter(|r| !self.contents.contains_key(*r) && !fresh.contains(r.as_str())).cloned().collect();
        let got = read_parallel(&self.root, &need); // not UTF-8: read as well as it can be
        let read: HashSet<&str> = got.iter().map(|(r, _, _)| r.as_str()).collect();
        let unreadable = need
            .iter()
            .filter(|r| !read.contains(r.as_str()))
            .filter(|r| !matches!(self.root.join(r).try_exists(), Ok(false))) // gone meanwhile
            .cloned()
            .collect();
        (got.into_iter().map(|(_, t, _)| t).collect(), unreadable)
    }

    /// Pictures in assets/ that nothing in the notes folder mentions ("Check this folder"), as at
    /// `now` (seconds since 1970): pictures changed since 3 days before are only counted.
    pub fn picture_check_at(&self, now: u64) -> PictureCheck {
        let found = walk(&self.root);
        let mut out = PictureCheck { pictures: found.pictures.len(), ..Default::default() };
        let since = now.saturating_sub(RECENT);
        let older: Vec<(String, u64)> = found.pictures.into_iter().filter(|(_, _, t)| *t < since).map(|(p, b, _)| (p, b)).collect();
        out.recent = out.pictures - older.len();
        if older.is_empty() {
            return out;
        }
        let (others, unreadable) = self.read_others(&found.texts, None);
        if !unreadable.is_empty() {
            out.unreadable = unreadable;
            return out;
        }
        let names: Vec<&str> = older.iter().map(|(p, _)| file_name(p)).collect();
        let texts = self.contents.values().chain(&others).map(String::as_str);
        let used = mentioned(texts, &names);
        out.unused = older.into_iter().zip(used).filter(|(_, u)| !u).map(|(p, _)| p).collect();
        out.bytes = out.unused.iter().map(|(_, b)| b).sum();
        out
    }

    /// Move pictures to the bin. Each is checked again right before: a picture in assets/, still
    /// there, not changed in the last 3 days, and still unused, by the notes as they are on disk now
    /// (one may have started using it since the check). Nothing is deleted: each file is moved into
    /// `logseq/.recycle`.
    pub fn bin_pictures(&self, paths: &[String]) -> Result<Binned, String> {
        self.bin_pictures_at(paths, now_secs())
    }

    /// `bin_pictures` as at `now` (seconds since 1970).
    pub fn bin_pictures_at(&self, paths: &[String], now: u64) -> Result<Binned, String> {
        let mut out = Binned { moved: vec![], skipped: vec![] };
        let found = walk(&self.root);
        let there: HashMap<&str, u64> = found.pictures.iter().map(|(p, _, t)| (p.as_str(), *t)).collect();
        let since = now.saturating_sub(RECENT);
        let mut todo: Vec<&str> = vec![];
        for p in paths {
            if !movable(p) {
                out.skipped.push((p.clone(), "it isn’t a picture in assets".into()));
            } else if !there.contains_key(p.as_str()) {
                out.skipped.push((p.clone(), "it isn’t there any more".into()));
            } else if there[p.as_str()] >= since {
                out.skipped.push((p.clone(), "it’s from the last 3 days (a note using it may still be on its way)".into()));
            } else if !todo.contains(&p.as_str()) {
                todo.push(p);
            }
        }
        if todo.is_empty() {
            return Ok(out);
        }
        let fresh = collect_changes(self.scan_plan());
        let (others, unreadable) = self.read_others(&found.texts, Some(&fresh));
        if let Some(f) = unreadable.first() {
            let why = format!("“{f}” couldn’t be read, so it isn’t certain nothing uses it");
            out.skipped.extend(todo.into_iter().map(|p| (p.to_string(), why.clone())));
            return Ok(out);
        }
        let changed: HashSet<&str> = fresh.read.iter().map(|(r, _, _)| r.as_str()).collect();
        let texts = self
            .contents
            .iter()
            .filter(|(r, _)| !changed.contains(r.as_str()))
            .map(|(_, t)| t.as_str())
            .chain(fresh.read.iter().map(|(_, t, _)| t.as_str()))
            .chain(others.iter().map(String::as_str));
        let names: Vec<&str> = todo.iter().map(|p| file_name(p)).collect();
        let used = mentioned(texts, &names);
        let bin = self.recycle_dir();
        for (p, u) in todo.into_iter().zip(used) {
            if u {
                out.skipped.push((p.into(), "a note uses it now".into()));
                continue;
            }
            match move_to_bin(&self.root.join(p), &bin, p) {
                Ok(()) => out.moved.push(p.into()),
                Err(e) => out.skipped.push((p.into(), e)),
            }
        }
        Ok(out)
    }
}

/// A path the bin may take: inside assets/, a picture, written plainly (no "..", nothing hidden).
fn movable(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    parts.len() >= 2
        && parts[0].eq_ignore_ascii_case("assets")
        && parts.iter().all(|p| !p.is_empty() && !p.starts_with('.') && !p.contains(['\\', ':', '\0']))
        && is_picture(parts[parts.len() - 1])
}

/// A picture's name in the bin: its path in the notes folder with "%" written "%25" and "/" written
/// "%2F" (`assets/sub/x (2).png` → `assets%2Fsub%2Fx (2).png`), so it says exactly where it goes back
/// to. `k` ≥ 2 when the bin already has that name: "%~2", "%~3"… goes before the extension (the
/// encoding never writes a "%" followed by "~", so this can't be mistaken for part of a real name).
fn bin_name(rel: &str, k: usize) -> String {
    let enc = rel.replace('%', "%25").replace('/', "%2F");
    match enc.rsplit_once('.') {
        Some((stem, ext)) if k >= 2 => format!("{stem}%~{k}.{ext}"),
        _ => enc,
    }
}

/// The path in the notes folder that a bin name says (see `bin_name`): only a picture in assets;
/// None for any other name (a deleted page, a file put there by hand).
fn from_bin_name(file: &str) -> Option<String> {
    let (stem, ext) = file.rsplit_once('.')?;
    let stem = match stem.rsplit_once("%~") {
        Some((s, k)) if !k.is_empty() && k.bytes().all(|b| b.is_ascii_digit()) => s,
        Some(_) => return None,
        None => stem,
    };
    let mut out = String::with_capacity(stem.len());
    let mut rest = stem;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        match rest.get(i + 1..i + 3)? {
            "25" => out.push('%'),
            "2F" | "2f" => out.push('/'),
            _ => return None,
        }
        rest = &rest[i + 3..];
    }
    out.push_str(rest);
    let rel = format!("{out}.{ext}");
    movable(&rel).then_some(rel)
}

/// Move one picture into the bin under its `bin_name`, and set its file time to now: the bin lists
/// pictures by when they were moved there (a picture keeps its own old time otherwise).
fn move_to_bin(src: &Path, bin: &Path, rel: &str) -> Result<(), String> {
    if !std::fs::symlink_metadata(src).is_ok_and(|m| m.is_file()) {
        return Err("it isn’t there any more".into());
    }
    std::fs::create_dir_all(bin).map_err(|e| format!("couldn’t make the bin folder: {e}"))?;
    let mut k = 1;
    let mut dest = bin.join(bin_name(rel, k));
    while dest.symlink_metadata().is_ok() {
        k += 1;
        dest = bin.join(bin_name(rel, k));
    }
    move_file(src, &dest, "the bin", "assets")?;
    if let Ok(f) = std::fs::File::options().write(true).open(&dest) {
        let _ = f.set_modified(std::time::SystemTime::now());
    }
    Ok(())
}

/// Move a file (`dest` not there yet). Renames; where that isn't allowed, copies and removes the
/// original only once the whole copy is there. `to`/`from` name the two places in an error.
fn move_file(src: &Path, dest: &Path, to: &str, from: &str) -> Result<(), String> {
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    let size = std::fs::metadata(src).map_err(|e| format!("couldn’t move it: {e}"))?.len();
    match std::fs::copy(src, dest) {
        Ok(n) if n == size => std::fs::remove_file(src).map_err(|e| format!("it was copied to {to} but couldn’t be taken out of {from}: {e}")),
        Ok(_) => {
            let _ = std::fs::remove_file(dest);
            Err("couldn’t move it (the copy came out short)".into())
        }
        Err(e) => Err(format!("couldn’t move it: {e}")),
    }
}

impl App {
    /// Where a picture in the bin goes back to: the path its bin name says (see `bin_name`).
    pub(super) fn picture_home(&self, file: &str) -> Option<String> {
        if file.starts_with('.') || file.contains(['/', '\\', '\0']) || !is_picture(file) {
            return None;
        }
        from_bin_name(file)
    }

    /// Put a picture from the bin back into assets (see `picture_home`), never over one that's
    /// there: then it says so. Returns its path in the notes folder.
    pub(super) fn restore_picture(&self, file: &str) -> Result<String, String> {
        let rel = self.picture_home(file).ok_or("That isn’t a picture from assets.")?;
        let src = self.recycle_dir().join(file);
        if !std::fs::symlink_metadata(&src).is_ok_and(|m| m.is_file()) {
            return Err("That picture isn’t in the bin any more.".into());
        }
        let to = self.root.join(&rel);
        if to.symlink_metadata().is_ok() {
            let (dir, name) = rel.rsplit_once('/').unwrap_or(("assets", &rel));
            return Err(format!("There’s already a picture called “{name}” in {dir}, so this one stayed in the bin. Rename or move that one first."));
        }
        if let Some(d) = to.parent() {
            std::fs::create_dir_all(d).map_err(|e| format!("Couldn’t put it back: {e}"))?;
        }
        move_file(&src, &to, "assets", "the bin").map_err(|e| format!("Couldn’t put it back: {e}"))?;
        Ok(rel)
    }
}

/// For each file name: does any of the texts mention it? Case-insensitive, URL-decoded on both
/// sides; a picture with a note id in its name also counts when that id is written anywhere.
pub fn mentioned<'a>(texts: impl IntoIterator<Item = &'a str>, names: &[&str]) -> Vec<bool> {
    let mut keys: HashMap<String, Vec<usize>> = HashMap::new();
    let mut ids: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, n) in names.iter().enumerate() {
        for k in [n.to_lowercase(), decode(n).to_lowercase()] {
            if let Some(id) = note_id(&k) {
                add(&mut ids, id.to_string(), i);
            }
            add(&mut keys, k, i);
        }
    }
    // the names' lengths, per extension: at ".png" in a text, look up the 9, 14… bytes ending there
    let mut lens: Vec<(String, Vec<usize>)> = vec![];
    for k in keys.keys() {
        let Some(e) = ext_of(k) else { continue };
        match lens.iter_mut().find(|(x, _)| *x == e) {
            Some((_, v)) if v.contains(&k.len()) => {}
            Some((_, v)) => v.push(k.len()),
            None => lens.push((e, vec![k.len()])),
        }
    }
    let mut used = vec![false; names.len()];
    let mut left = names.len();
    for t in texts {
        if left == 0 {
            break;
        }
        let lower = t.to_lowercase();
        find_names(&lower, &keys, &lens, &mut used, &mut left);
        if !ids.is_empty() {
            find_ids(&lower, &ids, &mut used, &mut left);
        }
        if t.contains('%') {
            find_names(&decode(t).to_lowercase(), &keys, &lens, &mut used, &mut left);
        }
    }
    used
}

fn add(m: &mut HashMap<String, Vec<usize>>, k: String, i: usize) {
    let v = m.entry(k).or_default();
    if !v.contains(&i) {
        v.push(i);
    }
}

fn mark(found: &[usize], used: &mut [bool], left: &mut usize) {
    for &i in found {
        if !used[i] {
            used[i] = true;
            *left -= 1;
        }
    }
}

/// At every dot followed by a picture extension: is the text ending there one of the names?
fn find_names(lower: &str, keys: &HashMap<String, Vec<usize>>, lens: &[(String, Vec<usize>)], used: &mut [bool], left: &mut usize) {
    let b = lower.as_bytes();
    for (dot, _) in lower.match_indices('.') {
        for (ext, ls) in lens {
            if !b[dot + 1..].starts_with(ext.as_bytes()) {
                continue;
            }
            let end = dot + 1 + ext.len();
            for &l in ls {
                if l <= end && lower.is_char_boundary(end - l) {
                    if let Some(found) = keys.get(&lower[end - l..end]) {
                        mark(found, used, left);
                    }
                }
            }
        }
    }
}

/// A Logseq note id ("6528aaaa-bbbb-4ccc-8ddd-eeeeffff6666") at the start of `b`?
fn is_id(b: &[u8]) -> bool {
    b.len() >= 36 && b[..36].iter().enumerate().all(|(i, c)| if matches!(i, 8 | 13 | 18 | 23) { *c == b'-' } else { c.is_ascii_hexdigit() })
}

/// The note id in a (lowercased) picture name, e.g. Logseq's PDF highlights `3_<id>_<stamp>.png`.
fn note_id(lower: &str) -> Option<&str> {
    let b = lower.as_bytes();
    (0..b.len().saturating_sub(35)).find(|&i| is_id(&b[i..])).map(|i| &lower[i..i + 36])
}

/// Note ids written anywhere in a text (`id:: …`, `((…))`).
fn find_ids(lower: &str, ids: &HashMap<String, Vec<usize>>, used: &mut [bool], left: &mut usize) {
    let b = lower.as_bytes();
    let mut i = 0;
    while i + 36 <= b.len() {
        if b[i + 8] == b'-' && is_id(&b[i..]) {
            if let Some(found) = ids.get(&lower[i..i + 36]) {
                mark(found, used, left);
            }
            i += 36;
        } else {
            i += 1;
        }
    }
}

/// `%20`-style escapes decoded (bytes that don't make valid text become "�").
fn decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let b = s.as_bytes();
    let hex = |c: u8| (c as char).to_digit(16);
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

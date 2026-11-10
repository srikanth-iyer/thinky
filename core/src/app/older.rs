//! Where a picture was used before (Build 43, he asked Nov 10): "Pictures nothing uses" lists pictures
//! no note mentions now, so there's no note to go to; this looks for the notes that mentioned one in
//! the older copies of the pages: the backups in `logseq/bak` (Logseq's and this app's), the safety
//! copies (both devices'), and, when backups are on, thinky's own backups (the snapshot zips, or a git
//! backup's history). Read only: nothing is written anywhere.
//!
//! A note "mentions" the picture as "Check this folder" decides it (`pictures::mentioned`: its file
//! name in any case, URL-decoded). Each hit gives the note's words with the first lines of the notes
//! above it, its page, where it was found and when; the same note of the same page found in several
//! copies shows once, the newest.

use super::history::{bak_file_ok, bak_name, mtime_ms, MAX_BYTES};
use super::{backup, pictures, read_text, App};
use crate::split_doc;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

/// At most this many notes are listed (the newest).
const MAX_HITS: usize = 30;
/// At most this many commits of a git backup are read.
const MAX_COMMITS: usize = 20;

#[derive(Serialize, Debug, Clone)]
pub struct OlderHit {
    /// "bak" (logseq/bak), "copy" (a safety copy), "zip" (a snapshot backup) or "git" (a git backup).
    pub from: &'static str,
    /// Which one, in words: "this computer", "your phone", the zip's name, the commit.
    pub which: String,
    /// When that copy was made (seconds since 1970).
    pub when: u64,
    /// The page's name and file (as the notes folder names it now).
    pub page: String,
    pub rel: String,
    /// The page has a file now (else it's gone: deleted, renamed or merged).
    pub exists: bool,
    /// The first lines of the notes above it, outermost first.
    pub path: Vec<String>,
    /// The note's own text, as it was.
    pub note: String,
}

/// Each note in `text` that mentions `name`: (its parents' first lines, its text).
fn notes_mentioning(text: &str, name: &str) -> Vec<(Vec<String>, String)> {
    if !pictures::mentioned([text], &[name])[0] {
        return vec![];
    }
    let doc = split_doc(text);
    let mut out = vec![];
    for (i, b) in doc.blocks.iter().enumerate() {
        if !pictures::mentioned([b.text.as_str()], &[name])[0] {
            continue;
        }
        let mut path = vec![];
        let mut depth = b.depth;
        for p in doc.blocks[..i].iter().rev() {
            if p.depth < depth {
                path.push(p.text.lines().next().unwrap_or("").to_string());
                depth = p.depth;
            }
        }
        path.reverse();
        out.push((path, b.text.clone()));
    }
    // a picture written in the page's properties (before any note): the properties themselves
    if out.is_empty() && pictures::mentioned([doc.preamble.as_str()], &[name])[0] {
        out.push((vec![], doc.preamble.trim().to_string()));
    }
    out
}

/// A page's file in the notes folder ("pages/x.md", "journals/2026_11_10.md"): a ".md" file, no
/// "..", nothing in logseq/ (backups, the bin, settings).
fn page_rel_ok(rel: &str) -> bool {
    rel.ends_with(".md") && !rel.starts_with("logseq/") && !rel.split('/').any(|p| p.is_empty() || p == "..") && !rel.contains(['\\', ':', '\0'])
}

impl App {
    /// Where picture `picture` ("assets/x.png") was used in older copies of the pages, newest first.
    /// `data`: the app's data folder (safety copies kept on this device); `backup`: thinky's backups
    /// when they're on ("zip"/"git", their folder).
    pub fn picture_in_older(&self, data: Option<&Path>, picture: &str, backup: Option<(&str, &str)>) -> Result<Vec<OlderHit>, String> {
        let name = picture.rsplit('/').next().unwrap_or(picture);
        if name.is_empty() || picture.contains(['\\', '\0']) {
            return Err("That isn't a picture's name.".into());
        }
        let mut hits: Vec<OlderHit> = vec![];
        let add = |hits: &mut Vec<OlderHit>, from, which: String, when, rel: &str, text: &str| {
            if !page_rel_ok(rel) {
                return;
            }
            for (path, note) in notes_mentioning(text, name) {
                let page = self.vault.title_from_path(rel).0;
                hits.push(OlderHit { from, which: which.clone(), when, page, rel: rel.to_string(), exists: self.root.join(rel).is_file(), path, note });
            }
        };
        // 1. logseq/bak/<page's file without .md>/<backup>.md, any depth (only inside the notes folder)
        let bak = self.root.join("logseq").join("bak");
        let inside = bak.canonicalize().ok().zip(self.root.canonicalize().ok()).is_some_and(|(d, r)| d.starts_with(r));
        let mut stack = if inside { vec![bak.clone()] } else { vec![] };
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let (Ok(fname), Ok(ft)) = (e.file_name().into_string(), e.file_type()) else { continue };
                if ft.is_dir() && !fname.starts_with('.') {
                    stack.push(e.path());
                    continue;
                }
                let Ok(md) = e.metadata() else { continue };
                if !ft.is_file() || !bak_file_ok(&fname) || md.len() > MAX_BYTES {
                    continue;
                }
                let Ok(folder) = dir.strip_prefix(&bak) else { continue };
                let rel = format!("{}.md", folder.to_string_lossy().replace('\\', "/"));
                let Some(text) = read_text(&e.path()).ok().flatten() else { continue };
                let (ms, _, made) = bak_name(&fname).unwrap_or_else(|| (mtime_ms(&md), 0, "bak"));
                let which = match made {
                    "logseq-computer" => "Logseq on a computer",
                    "logseq-phone" => "Logseq on a phone",
                    "logseq" => "Logseq",
                    "app" => "thinky",
                    _ => "a backup",
                };
                add(&mut hits, "bak", which.to_string(), ms / 1000, &rel, &text);
            }
        }
        // 2. the safety copies, both devices'
        if let Some(data) = data {
            for (rel, when, made, text) in self.copy_texts(data) {
                let which = if made.mine { format!("this {}", made.kind) } else { format!("your {}", made.kind) };
                add(&mut hits, "copy", which, when, &rel, &text);
            }
        }
        // 3. thinky's own backups
        match backup {
            Some(("zip", dest)) if !dest.trim().is_empty() => {
                for z in backup::our_zips(Path::new(dest.trim())) {
                    let zname = z.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    let when = z.metadata().ok().map_or(0, |m| mtime_ms(&m) / 1000);
                    for (rel, bytes) in backup::zip_files(&z, page_rel_ok) {
                        if let Ok(text) = String::from_utf8(bytes) {
                            add(&mut hits, "zip", zname.clone(), when, &rel, &text);
                        }
                    }
                }
            }
            Some(("git", dest)) if !dest.trim().is_empty() => {
                let repo = Path::new(dest.trim());
                let mut needles = vec![name.to_string()];
                let enc = name.replace('%', "%25").replace(' ', "%20");
                if enc != name {
                    needles.push(enc);
                }
                let mut seen = HashSet::new();
                for needle in needles {
                    let Ok(log) = backup::git(repo, &["log", "--all", &format!("-n{MAX_COMMITS}"), "--format=@%H %ct", "--name-only", &format!("-S{needle}"), "--", "."]) else { continue };
                    let mut commit = String::new();
                    let mut when = 0;
                    for line in log.lines() {
                        if let Some(c) = line.strip_prefix('@') {
                            let (h, t) = c.split_once(' ').unwrap_or((c, "0"));
                            commit = h.to_string();
                            when = t.trim().parse().unwrap_or(0);
                            continue;
                        }
                        let rel = line.trim();
                        if rel.is_empty() || !page_rel_ok(rel) || !seen.insert((commit.clone(), rel.to_string())) {
                            continue;
                        }
                        // the change added it (the commit has it) or removed it (its parent had it)
                        for rev in [commit.clone(), format!("{commit}^")] {
                            if let Ok(text) = backup::git(repo, &["show", &format!("{rev}:{rel}")]) {
                                if pictures::mentioned([text.as_str()], &[name])[0] {
                                    add(&mut hits, "git", commit.chars().take(7).collect(), when, rel, &text);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        // newest first; the same note of the same page once (its newest copy)
        hits.sort_by(|a, b| b.when.cmp(&a.when));
        let mut seen = HashSet::new();
        hits.retain(|h| seen.insert((h.rel.clone(), h.note.clone())));
        hits.truncate(MAX_HITS);
        Ok(hits)
    }
}

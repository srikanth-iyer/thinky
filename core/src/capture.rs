//! Quick capture, the Logseq way: fill `:quick-capture-templates` ({time} {date} {text} {url})
//! and add the result as a new bullet to today's journal or the default page.
//! Used by the app, by `lean-outliner --capture` and the "Add to journal" box on Windows (which can
//! also add to another page, or a to-do); the Android widget mirrors it.

use crate::config::Config;
use crate::date::Date;
use std::path::Path;

/// First web address in `s`, and the rest of the text without it.
pub fn split_url(s: &str) -> (String, String) {
    let start = ["https://", "http://"].iter().filter_map(|p| s.find(p)).min();
    match start {
        None => (s.trim().to_string(), String::new()),
        Some(i) => {
            let end = s[i..].find(char::is_whitespace).map_or(s.len(), |e| i + e);
            let url = s[i..end].trim_end_matches(['.', ',', ';', ')', '"', '\'']).to_string();
            let rest = format!("{}{}", &s[..i], &s[i + url.len()..]);
            let rest = rest.trim().trim_end_matches([':', '-', '—', '|']).trim().to_string();
            (rest, url)
        }
    }
}

/// Words that only join a value to the text before it ("… from {url}"): they go when the
/// value is empty, so a note without a web address doesn't end in "from".
const JOINERS: [&str; 9] = ["from", "via", "at", "on", "-", "–", "—", "|", "·"];

/// Fill a capture template. Empty values take one neighbouring space with them (and a
/// joining word in front, see JOINERS).
pub fn fill(template: &str, text: &str, url: &str, time: &str, date: &str) -> String {
    let mut out = template.to_string();
    for (k, v) in [("{time}", time), ("{date}", date), ("{text}", text.trim()), ("{url}", url.trim())] {
        if v.is_empty() {
            for j in JOINERS {
                out = out.replace(&format!(" {j} {k}"), "");
            }
            out = out.replace(&format!(" {k}"), "").replace(&format!("{k} "), "").replace(k, "");
        }
    }
    // values go in last, so text that happens to contain "{url}" stays as typed
    let mut res = String::with_capacity(out.len() + text.len() + url.len());
    let mut rest = out.as_str();
    while let Some(i) = rest.find('{') {
        res.push_str(&rest[..i]);
        let tail = &rest[i..];
        let hit = [("{time}", time), ("{date}", date), ("{text}", text.trim()), ("{url}", url.trim())]
            .into_iter()
            .find(|(k, _)| tail.starts_with(k));
        match hit {
            Some((k, v)) => {
                res.push_str(v);
                rest = &tail[k.len()..];
            }
            None => {
                res.push('{');
                rest = &tail[1..];
            }
        }
    }
    res.push_str(rest);
    res.trim().to_string()
}

/// "14:05" from hours and minutes.
pub fn hhmm(h: u32, m: u32) -> String {
    format!("{h:02}:{m:02}")
}

/// The bullet text for shared content.
pub fn bullet(cfg: &Config, text: &str, url: &str, media: bool, today: Date, time: &str) -> String {
    let (t, u) = if url.is_empty() && !media { split_url(text) } else { (text.trim().to_string(), url.to_string()) };
    let tpl = if media { &cfg.capture_media } else { &cfg.capture_text };
    fill(tpl, &t, &u, time, &cfg.journal_title(today))
}

/// A note's text as a to-do: the workflow's marker (TODO, or LATER with `:preferred-workflow :now`)
/// at the very start, unless it already starts with one.
pub fn as_todo(line: &str, marker: &str) -> String {
    if crate::task::marker(line).is_some() {
        line.to_string()
    } else {
        format!("{marker} {line}")
    }
}

/// `logseq/config.edn` of a notes folder. Only a missing file means Logseq's defaults: any other
/// read problem is an error, so a note never goes to a guessed place.
pub fn read_config(root: &Path) -> std::io::Result<Config> {
    match std::fs::read_to_string(root.join("logseq").join("config.edn")) {
        Ok(t) => Ok(Config::from_edn(&t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(e),
    }
}

/// Where a note goes when no other page is picked: (today's journal?, its page name).
pub fn default_place(cfg: &Config, today: Date) -> (bool, String) {
    if cfg.capture_today {
        (true, cfg.journal_title(today))
    } else {
        (false, cfg.capture_page.clone())
    }
}

/// The capture box's words for a place: "today’s journal (October 26th, 2026)" or the page name.
pub fn place_label(today: bool, page: &str) -> String {
    if today {
        format!("today’s journal ({page})")
    } else {
        page.to_string()
    }
}

/// The bullet for a note from the capture box or `--capture`: the quick capture template filled
/// in, as a to-do if asked (the workflow's marker at the very start).
pub fn note_line(cfg: &Config, text: &str, url: &str, todo: bool, today: Date, time: &str) -> Result<String, String> {
    let line = bullet(cfg, text, url, false, today, time);
    if line.is_empty() {
        return Err("Nothing to add.".into());
    }
    Ok(if todo { as_todo(&line, cfg.todo_marker()) } else { line })
}

/// Add `line` as the last bullet of the file at `path` (`rel` names it in messages), keeping the
/// file's shape (line breaks, byte-order mark, a missing final line break). Only a file that isn't
/// there starts new (from `start`, e.g. a `title::` line); any other read problem, or a file that
/// isn't plain UTF-8, stops it. The new text replaces the file only if nobody saved it meanwhile
/// (checked again just before, `write_atomic_checked`); if someone did, the note is added to their
/// version instead, up to 3 times, then it says so (nothing lost: the caller keeps the note).
pub fn append_note(path: &Path, rel: &str, start: &str, line: &str) -> Result<(), String> {
    append_note_with(path, rel, start, line, &mut |_| {})
}

/// `append_note`, calling `between(try)` after each try is worked out and before it's written
/// (tests use it to save the file "elsewhere" at the worst moment).
#[doc(hidden)]
pub fn append_note_with(path: &Path, rel: &str, start: &str, line: &str, between: &mut dyn FnMut(u32)) -> Result<(), String> {
    use crate::app::{write_atomic_checked, Expect};
    for attempt in 0..3 {
        // Only a file that isn't there yet starts empty. Any other read problem (e.g. Google Drive
        // can't fetch the file right now) must never turn into "write just this one line over it".
        let before = match std::fs::read(path) {
            Ok(b) => Some(b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("Couldn't read {rel} ({e}), so nothing was added. Try again in a moment.")),
        };
        let cur = match &before {
            Some(b) => std::str::from_utf8(b).map_err(|_| "That file isn't plain UTF-8 text, so nothing was added.".to_string())?.to_string(),
            None => start.to_string(),
        };
        let out = crate::append_bullet(&cur, line);
        between(attempt);
        let expect = match &before {
            Some(b) => Expect::Bytes(b),
            None => Expect::Missing,
        };
        if write_atomic_checked(path, &out, expect)? {
            return Ok(());
        }
    }
    Err(format!("{rel} kept changing while the note was being added (another program is saving it), so nothing was added. Try again in a moment."))
}

/// Add a note to the usual place: `--capture`, the browser button, and the capture box when no
/// other page is picked. In the quick capture template, as a to-do if asked; safely
/// (`append_note`). Today's journal needs only the settings; the quick capture page is found as
/// everywhere in the app (`App::capture_to_page`: the page wherever its file is, by `title::` or
/// alias, else a new page with a file of its own), from the notes folder opened read-only (its
/// index cache makes that quick). Returns the vault-relative path written.
pub fn capture_to_usual(root: &Path, text: &str, url: &str, todo: bool, today: Date, time: &str) -> Result<String, String> {
    let cfg = read_config(root).map_err(|e| format!("Couldn't read logseq/config.edn ({e}), so nothing was added."))?;
    if !cfg.capture_today {
        let mut app = crate::app::App::open_read_only(root).map_err(|e| format!("{e} So nothing was added."))?;
        return app.capture_to_page(&cfg.capture_page, text, url, todo, today, time);
    }
    let rel = cfg.journal_rel_path(today);
    let line = note_line(&cfg, text, url, todo, today, time)?;
    append_note(&root.join(&rel), &rel, "", &line)?;
    Ok(rel)
}

/// Add a capture to today's journal (or the quick capture page) without loading the index.
pub fn capture_to_vault(root: &Path, text: &str, url: &str, today: Date, time: &str) -> Result<String, String> {
    capture_to_usual(root, text, url, false, today, time)
}

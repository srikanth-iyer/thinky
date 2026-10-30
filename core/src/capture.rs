//! Quick capture, the Logseq way: fill `:quick-capture-templates` ({time} {date} {text} {url})
//! and add the result as a new bullet to today's journal or the default page.
//! Used by the app, by `lean-outliner --capture` and the "Add to journal" box on Windows (which can
//! also add to another page, or a to-do); Android's "Add a note" pop-up calls it through JNI
//! (src-tauri/src/android_capture.rs).

use crate::config::Config;
use crate::date::Date;
use std::path::Path;

/// First web address in `s` (a bare one, or a Markdown link to one, `[name](https://…)`), and the
/// rest of the text without it.
pub fn split_url(s: &str) -> (String, String) {
    let bare = ["https://", "http://"].iter().filter_map(|p| s.find(p)).min();
    // a Markdown link that starts before the bare address it holds is taken whole
    if let Some((a, b)) = md_link_at(s) {
        if bare.map_or(true, |i| a < i) {
            let rest = format!("{}{}", &s[..a], &s[b..]);
            return (tidy_rest(&rest), s[a..b].to_string());
        }
    }
    match bare {
        None => (s.trim().to_string(), String::new()),
        Some(i) => {
            let end = s[i..].find(char::is_whitespace).map_or(s.len(), |e| i + e);
            let url = s[i..end].trim_end_matches(['.', ',', ';', ')', '"', '\'']).to_string();
            let rest = format!("{}{}", &s[..i], &s[i + url.len()..]);
            (tidy_rest(&rest), url)
        }
    }
}

fn tidy_rest(rest: &str) -> String {
    rest.trim().trim_end_matches([':', '-', '—', '|']).trim().to_string()
}

/// Where the first `[name](http…)` link in `s` is (byte range), if any.
fn md_link_at(s: &str) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(o) = s[from..].find('[') {
        let a = from + o;
        let close = s[a..].find("](").map(|c| a + c);
        if let Some(c) = close {
            let label = &s[a + 1..c];
            let tail = &s[c + 2..];
            if !label.contains(['[', ']', '\n']) && (tail.starts_with("https://") || tail.starts_with("http://")) {
                // the address ends at its closing ")" (brackets inside it balanced)
                let mut depth = 0i32;
                for (i, ch) in tail.char_indices() {
                    match ch {
                        '(' => depth += 1,
                        ')' if depth == 0 => return Some((a, c + 2 + i + 1)),
                        ')' => depth -= 1,
                        c if c.is_whitespace() => break,
                        _ => {}
                    }
                }
            }
        }
        from = a + 1;
    }
    None
}

/// The site's address without `https://`, `www.`, a port or a path: "kitchenweekly.org".
pub fn host(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let h = rest.split(['/', '?', '#']).next().unwrap_or("");
    let h = h.rsplit('@').next().unwrap_or(h);
    let h = h.split(':').next().unwrap_or(h);
    h.strip_prefix("www.").unwrap_or(h).to_lowercase()
}

/// A page's title without the site's name at its end ("How Bread Rises | Kitchen Weekly" →
/// "How Bread Rises"), when that name is `site` or the site's address.
pub fn clean_title(title: &str, site: &str, url: &str) -> String {
    let t = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let names: Vec<String> = [site.trim().to_lowercase(), host(url)].into_iter().filter(|n| !n.is_empty()).collect();
    for sep in [" | ", " - ", " – ", " — ", " · ", " : ", " :: ", " / "] {
        if let Some(i) = t.rfind(sep) {
            let tail = t[i + sep.len()..].trim().to_lowercase();
            if !t[..i].trim().is_empty() && names.iter().any(|n| tail == *n || tail.replace(' ', "") == n.split('.').next().unwrap_or("")) {
                return t[..i].trim().to_string();
            }
        }
    }
    t
}

/// A neat Markdown link for a web address: "[Title · Site](url)"; the site's address when its
/// name isn't known ("[Title · kitchenweekly.org](url)"), and only that when there's no title
/// ("[kitchenweekly.org](url)"). Square brackets in the name become round ones (they would end
/// the link), and spaces and round brackets in the address are written as %20, %28, %29.
pub fn md_link(url: &str, title: &str, site: &str) -> String {
    let url = url.trim();
    if url.is_empty() {
        return String::new();
    }
    let site = site.split_whitespace().collect::<Vec<_>>().join(" ");
    let place = if site.is_empty() { host(url) } else { site };
    let title = clean_title(title, &place, url);
    let name = if title.is_empty() || title.eq_ignore_ascii_case(&place) {
        place
    } else if place.is_empty() {
        title
    } else {
        format!("{title} · {place}")
    };
    let name = if name.is_empty() { url.to_string() } else { name };
    let name = name.replace('[', "(").replace(']', ")").replace('\n', " ");
    let addr = url.replace(' ', "%20").replace('(', "%28").replace(')', "%29");
    format!("[{name}]({addr})")
}

/// A web address as a neat link (`md_link` with no title), or the link as given when it is one.
pub fn as_link(url: &str) -> String {
    let u = url.trim();
    if u.is_empty() || md_link_at(u) == Some((0, u.len())) {
        u.to_string()
    } else {
        md_link(u, "", "")
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

/// The bullet text for shared content.
pub fn bullet(cfg: &Config, text: &str, url: &str, media: bool, today: Date, time: &str) -> String {
    let (t, u) = if url.is_empty() && !media { split_url(text) } else { (text.trim().to_string(), url.to_string()) };
    // the address as a neat link; with no other words, the link is the note's words
    let u = if media { u } else { as_link(&u) };
    let (t, u) = if t.is_empty() && !media { (u, String::new()) } else { (t, u) };
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

/// `logseq/config.edn` of a notes folder, for opening it (the app, the capture box, `--check`) and
/// for adding a note. Only a missing file means Logseq's defaults; on Android also one the app may
/// not read (without "all files access" the folder opens with no notes, ui `App.noAccess`, and is
/// opened again once allowed). Any other problem (Google Drive busy fetching it, a disk error), or
/// a text that isn't whole EDN (read while another program was writing it), is tried again for
/// about half a second; a read problem is then an error, so notes are never opened, nor a note
/// added, with guessed settings (journals from and into the wrong folder, under the wrong names).
/// (A file that stays unreadable EDN still gives Logseq's defaults, as Logseq would.)
pub fn read_config(root: &Path) -> std::io::Result<Config> {
    use std::io::ErrorKind;
    let path = root.join("logseq").join("config.edn");
    for left in (0..5).rev() {
        match std::fs::read_to_string(&path) {
            Ok(t) if left == 0 || crate::edn::parse(&t).is_some() => return Ok(Config::from_edn(&t)),
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Config::default()),
            Err(e) if cfg!(target_os = "android") && e.kind() == ErrorKind::PermissionDenied => return Ok(Config::default()),
            Err(e) if left == 0 => return Err(e),
            _ => std::thread::sleep(std::time::Duration::from_millis(100)),
        }
    }
    unreachable!()
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
    line_to_usual(root, today, &|cfg| note_line(cfg, text, url, todo, today, time))
}

/// The bullet for a shared picture or file (`link`: its Markdown, `app::asset_markdown`): the
/// quick capture media template (`{url}`), as Logseq's own share does.
pub fn media_line(cfg: &Config, link: &str, today: Date, time: &str) -> Result<String, String> {
    let line = bullet(cfg, "", link, true, today, time);
    if line.is_empty() {
        return Err("Nothing to add.".into());
    }
    Ok(line)
}

/// A shared picture or file (already copied into assets/) added to the usual place, exactly as
/// `capture_to_usual` adds a note, in the media template (`media_line`). Android's "Add a note"
/// pop-up (the share sheet's "Add to journal") calls it through src-tauri's android_capture.rs.
pub fn capture_media_to_usual(root: &Path, link: &str, today: Date, time: &str) -> Result<String, String> {
    line_to_usual(root, today, &|cfg| media_line(cfg, link, today, time))
}

fn line_to_usual(root: &Path, today: Date, line: &dyn Fn(&Config) -> Result<String, String>) -> Result<String, String> {
    let cfg = read_config(root).map_err(|e| format!("Couldn't read logseq/config.edn ({e}), so nothing was added."))?;
    if !cfg.capture_today {
        let mut app = crate::app::App::open_read_only(root).map_err(|e| format!("{e} So nothing was added."))?;
        return app.capture_line_to_page(&cfg.capture_page, line);
    }
    let rel = cfg.journal_rel_path(today);
    let line = line(&cfg)?;
    append_note(&root.join(&rel), &rel, "", &line)?;
    Ok(rel)
}

// ----- copied words and the page they came from (the Windows capture box, Build 33) -----

/// The page a copy was made on: the `SourceURL:` line in the header of the clipboard's "HTML Format"
/// (browsers write it; the header is the `Key:value` lines before the HTML), http(s) only.
pub fn html_source_url(html: &str) -> Option<String> {
    let head = &html[..html.find('<').unwrap_or(html.len())];
    let url = head.lines().find_map(|l| l.trim().strip_prefix("SourceURL:"))?.trim();
    (url.starts_with("https://") || url.starts_with("http://")).then(|| url.to_string())
}

/// encodeURIComponent, with "-" as %2D too (a text fragment's own sign), as the bookmarklet does.
fn fragment_part(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// An address that opens `url` at `words` (a text fragment, `#:~:text=…`): up to 8 words whole,
/// else the first 4 and the last 4 (the browser finds what lies between); the address's own `#…`
/// goes. As the bookmarklet and the Edge extension make them.
pub fn text_fragment(url: &str, words: &str) -> String {
    let base = url.split('#').next().unwrap_or(url);
    let w: Vec<&str> = words.split_whitespace().collect();
    if w.is_empty() {
        return base.to_string();
    }
    let t = if w.len() > 8 { format!("{},{}", fragment_part(&w[..4].join(" ")), fragment_part(&w[w.len() - 4..].join(" "))) } else { fragment_part(&w.join(" ")) };
    format!("{base}#:~:text={t}")
}

/// Words copied from a web page with a neat link to their place on it (he asked, Oct 30: the
/// capture box dropped where they came from): "words [site](address#:~:text=…)". Just the words
/// without an address, when they're empty, or when they already hold the address.
pub fn with_source(words: &str, url: Option<&str>) -> String {
    match url {
        Some(u) if !words.trim().is_empty() && !words.contains(u.split('#').next().unwrap_or(u)) => {
            format!("{} {}", words.trim_end(), md_link(&text_fragment(u, words), "", ""))
        }
        _ => words.to_string(),
    }
}

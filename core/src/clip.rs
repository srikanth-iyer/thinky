//! Highlights from the browser extension, filed on the article's own page (Build 32).
//!
//! The extension (`browser/`) collects passages highlighted on a web page and sends them in one go
//! through Edge's native messaging (src-tauri `native_host.rs`). Here they're filed, the way he
//! files his quick captures by hand: one page per article, found again by its `source::`,
//!
//! ```text
//! tags:: [[quick capture]]
//! source:: [How Bread Rises · Kitchen Weekly](https://www.kitchenweekly.org/…)
//!
//! - [[October 29th, 2026]]
//!     - First highlighted passage… [↗](https://…#:~:text=First%20highlighted)
//!     - Second highlighted passage… [↗](…)
//! ```
//!
//! Each day he sends highlights gets one date bullet (in the journal's title format, so the day's
//! journal lists the page under its linked references); a second batch the same day joins that
//! day's bullet. A passage already on the page isn't added again. The page's other notes are
//! written back byte for byte (`doc.rs`), and the file is replaced only if nobody saved it
//! meanwhile (`write_atomic_checked`; else read again and redone, 3 tries).

use crate::app::{write_atomic_checked, App, Expect};
use crate::date::Date;
use crate::{join_doc, split_doc, DocBlock};
use serde::{Deserialize, Serialize};

/// What the extension sends: the article and its highlights, in reading order.
#[derive(Debug, Clone, Deserialize)]
pub struct Clip {
    /// the article's address (its canonical one when the page names it)
    pub url: String,
    #[serde(default)]
    pub title: String,
    /// the site's own name (`og:site_name`), when the page gives one
    #[serde(default)]
    pub site: String,
    pub highlights: Vec<Highlight>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Highlight {
    /// the passage as Markdown (the extension turns links, bold, maths… into Markdown)
    pub text: String,
    /// an address that opens the article at this passage (`#:~:text=…`), if any
    #[serde(default)]
    pub link: String,
}

/// What filing did, for the extension's message.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Filed {
    /// the article's page, as the app names it
    pub page: String,
    /// its file, vault-relative
    pub rel: String,
    /// highlights added, and ones left out because the page has them already
    pub added: usize,
    pub skipped: usize,
    /// the page was made now
    pub new_page: bool,
}

/// The same article's address however it's written: no `#…`, no tracking parameters (utm_…,
/// fbclid, gclid…), no `www.`, no default port, no final "/", the site's name in small letters.
pub fn normalize_url(u: &str) -> String {
    let u = u.trim();
    let u = u.split('#').next().unwrap_or(u);
    let (scheme, rest) = match u.split_once("://") {
        Some((s, r)) => (s.to_lowercase(), r),
        None => return u.to_string(),
    };
    let (hostport, after) = match rest.find(['/', '?']) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let mut host = hostport.to_lowercase();
    if let Some(h) = host.strip_prefix("www.") {
        host = h.to_string();
    }
    for port in [":80", ":443"] {
        if let Some(h) = host.strip_suffix(port) {
            host = h.to_string();
        }
    }
    let (path, query) = after.split_once('?').unwrap_or((after, ""));
    let path = path.trim_end_matches('/');
    let keep: Vec<&str> = query
        .split('&')
        .filter(|p| {
            let k = p.split('=').next().unwrap_or("").to_lowercase();
            !p.is_empty() && !k.starts_with("utm_") && !["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "ref_src", "_hsenc", "_hsmi", "mkt_tok"].contains(&k.as_str())
        })
        .collect();
    let scheme = if scheme == "http" { "https".to_string() } else { scheme };
    if keep.is_empty() {
        format!("{scheme}://{host}{path}")
    } else {
        format!("{scheme}://{host}{path}?{}", keep.join("&"))
    }
}

/// The web address in a `source::` value: a Markdown link's, or a bare one.
pub fn source_url(value: &str) -> Option<String> {
    let (_, u) = crate::capture::split_url(value);
    if u.is_empty() {
        return None;
    }
    let u = match u.rfind("](") {
        Some(i) if u.starts_with('[') && u.ends_with(')') => u[i + 2..u.len() - 1].to_string(),
        _ => u,
    };
    Some(u.replace("%28", "(").replace("%29", ")").replace("%20", " "))
}

/// A passage's words, safe to put in a note: no line can start a new note, a property or a code
/// block (an invisible zero-width space goes in front), at most one empty line in a row, no
/// spaces at line ends.
pub fn guard(text: &str) -> String {
    let mut out: Vec<String> = vec![];
    for line in text.replace("\r\n", "\n").replace('\r', "\n").split('\n') {
        let l = line.trim_end();
        if l.trim().is_empty() {
            if out.last().is_some_and(|p| !p.is_empty()) {
                out.push(String::new());
            }
            continue;
        }
        let t = l.trim_start();
        let risky = crate::doc::bullet(t).is_some()
            || t.starts_with("```")
            || t.starts_with("#+")
            || crate::parse::property(t).is_some();
        out.push(if risky { format!("\u{200b}{t}") } else { t.to_string() });
    }
    while out.last().is_some_and(|l| l.is_empty()) {
        out.pop();
    }
    out.join("\n")
}

/// The note for one highlight: its words, then a small link to the passage in the article.
pub fn highlight_note(h: &Highlight) -> String {
    let text = guard(&h.text);
    let link = h.link.trim();
    if link.is_empty() || !(link.starts_with("https://") || link.starts_with("http://")) {
        return text;
    }
    let addr = link.replace(' ', "%20").replace('(', "%28").replace(')', "%29");
    format!("{text} [↗]({addr})")
}

/// The words of a highlight note without its link, to tell whether a passage is on the page.
fn words_of(note: &str) -> String {
    let t = note.trim();
    let t = match t.rfind(" [↗](") {
        Some(i) if t.ends_with(')') => &t[..i],
        _ => t,
    };
    t.replace('\u{200b}', "").split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// The article's page name: its cleaned title (no site name at the end), without what can't be in
/// a page name; the site's address when there's no title.
fn page_name(clip: &Clip) -> String {
    let site = if clip.site.trim().is_empty() { crate::capture::host(&clip.url) } else { clip.site.trim().to_string() };
    let t = crate::capture::clean_title(&clip.title, &site, &clip.url);
    let t = t.replace("[[", "(").replace("]]", ")").replace(['[', ']'], "").replace('#', "").replace(['\n', '\r'], " ");
    let t = t.trim().trim_end_matches('.').trim().to_string();
    if t.is_empty() {
        crate::capture::host(&clip.url)
    } else {
        t
    }
}

/// File the highlights of `clip` on its article's page in the notes folder `app` has open; `today`
/// names the date bullet. The page: the one whose `source::` is this article (however its
/// address is written, `normalize_url`), else the page named like the article if it has no
/// `source::` of another article (he may have filed it by hand), else a new page (named with the
/// site after it, "Title (Kitchen Weekly)", when another article has the name).
pub fn file_clip(app: &mut App, clip: &Clip, today: Date) -> Result<Filed, String> {
    let notes: Vec<String> = clip.highlights.iter().map(highlight_note).filter(|n| !n.trim().is_empty()).collect();
    if notes.is_empty() {
        return Err("No highlights to add.".into());
    }
    if !(clip.url.starts_with("https://") || clip.url.starts_with("http://")) {
        return Err("Only highlights from web pages (http or https) can be added.".into());
    }
    let want = normalize_url(&clip.url);
    for _ in 0..3 {
        app.rescan();
        let day = format!("[[{}]]", app.vault.config.journal_title(today));
        let (name, rel, exists, title) = find_page(app, clip, &want)?;
        let path = app.root.join(&rel);
        if !exists {
            let mut start = String::new();
            if let Some(t) = &title {
                start.push_str(&format!("title:: {t}\n"));
            }
            start.push_str("tags:: [[quick capture]]\n");
            start.push_str(&format!("source:: {}\n", crate::capture::md_link(&clip.url, &clip.title, &clip.site)));
            let mut doc = split_doc(&start);
            doc.preamble.push('\n');
            let added = add_under_day(&mut doc.blocks, &day, &notes);
            let text = join_doc(&doc);
            if write_atomic_checked(&path, &text, Expect::Missing)? {
                app.rescan();
                return Ok(Filed { page: name, rel, added, skipped: notes.len() - added, new_page: true });
            }
            continue; // a file turned up there meanwhile: look again
        }
        let before = std::fs::read(&path).map_err(|e| format!("Couldn't read {rel} ({e}), so nothing was added. If it's on Google Drive, check it's available offline."))?;
        let cur = std::str::from_utf8(&before).map_err(|_| format!("{rel} isn't plain UTF-8 text, so nothing was added."))?;
        let mut doc = split_doc(cur);
        let added = add_under_day(&mut doc.blocks, &day, &notes);
        if added == 0 {
            return Ok(Filed { page: name, rel, added: 0, skipped: notes.len(), new_page: false });
        }
        let mut text = join_doc(&doc);
        if cur.starts_with('\u{feff}') {
            text.insert(0, '\u{feff}');
        }
        if write_atomic_checked(&path, &text, Expect::Bytes(&before))? {
            app.rescan();
            return Ok(Filed { page: name, rel, added, skipped: notes.len() - added, new_page: false });
        }
    }
    Err("The article's page kept changing while the highlights were being added (another program is saving it), so nothing was added. Try again in a moment.".into())
}

/// (page name, file, file there?, a `title::` its new file needs)
fn find_page(app: &App, clip: &Clip, want: &str) -> Result<(String, String, bool, Option<String>), String> {
    // 1. the page whose source:: is this article
    let mut by_source: Vec<String> = app
        .vault
        .pages_with_page_prop("source")
        .into_iter()
        .filter(|(_, v)| source_url(v).is_some_and(|u| normalize_url(&u) == want))
        .map(|(n, _)| n)
        .collect();
    by_source.sort_by_key(|n| n.to_lowercase());
    if let Some(n) = by_source.first() {
        let t = app.page_target(n)?;
        if !t.journal {
            return Ok((t.name, t.rel, t.exists, t.title));
        }
    }
    // 2. the page named like the article, unless it's another article's (or a journal day)
    let base = page_name(clip);
    let site = if clip.site.trim().is_empty() { crate::capture::host(&clip.url) } else { clip.site.trim().to_string() };
    let mut names = vec![base.clone(), format!("{base} ({site})")];
    for i in 2..=9 {
        names.push(format!("{base} ({site}) ({i})"));
    }
    for n in names {
        let t = match app.page_target(&n) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if t.journal {
            continue;
        }
        if !t.exists {
            return Ok((t.name, t.rel, false, t.title));
        }
        let other = app
            .vault
            .pages_with_page_prop("source")
            .into_iter()
            .find(|(p, _)| p.eq_ignore_ascii_case(&t.name))
            .and_then(|(_, v)| source_url(&v))
            .is_some_and(|u| normalize_url(&u) != want);
        if !other {
            return Ok((t.name, t.rel, true, t.title));
        }
    }
    Err(format!("Couldn't find a free page name for “{base}”, so nothing was added."))
}

/// Put `notes` under the top-level `day` bullet (made at the page's end if it isn't there), after
/// what that bullet already holds. Passages the page has anywhere already are left out. Returns
/// how many were added.
fn add_under_day(blocks: &mut Vec<DocBlock>, day: &str, notes: &[String]) -> usize {
    let mut seen: std::collections::HashSet<String> = blocks.iter().map(|b| words_of(&b.text)).collect();
    let fresh: Vec<&String> = notes.iter().filter(|n| seen.insert(words_of(n))).collect();
    if fresh.is_empty() {
        return 0;
    }
    let at = blocks.iter().position(|b| b.depth == 0 && !b.plain && b.text.trim().eq_ignore_ascii_case(day));
    let (insert, depth) = match at {
        Some(i) => {
            // after the date bullet's last sub-note
            let mut end = i + 1;
            while end < blocks.len() && blocks[end].depth > 0 {
                end += 1;
            }
            (end, 1)
        }
        None => {
            // a fresh journal-style empty last bullet ("-") makes way
            if blocks.last().is_some_and(|b| b.depth == 0 && b.text.trim().is_empty()) {
                blocks.pop();
            }
            blocks.push(DocBlock { depth: 0, text: day.to_string(), raw: None, plain: false });
            (blocks.len(), 1)
        }
    };
    let n = fresh.len();
    for (k, note) in fresh.into_iter().enumerate() {
        blocks.insert(insert + k, DocBlock { depth, text: note.clone(), raw: None, plain: false });
    }
    n
}

// ---------------------------------------------------------------- talking to the extension

/// The name Edge knows the receiver by (its native messaging host), and the only extension it
/// answers: the one in `browser/`, whose fixed id comes from the public key in its manifest.
pub const HOST_NAME: &str = "com.srikanth.leanoutliner";
pub const EXTENSION_ID: &str = "fjgdgmpheeihnlbpmbajkmoapjfieggg";

/// The host manifest Edge reads (named in the registry): this program, for that extension only.
pub fn host_manifest(exe: &str) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "name": HOST_NAME,
        "description": "thinky: adds highlights from the browser to your notes",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    }))
    .unwrap_or_default()
}

/// Largest message read from the extension (Edge allows 64 MB; highlights are far smaller).
pub const MAX_MESSAGE: usize = 8 * 1024 * 1024;

/// One message as Edge sends it: 4 bytes of length (this computer's byte order), then that much
/// JSON. None: nothing (more) to read, or a length over MAX_MESSAGE.
pub fn read_message(r: &mut impl std::io::Read) -> Option<serde_json::Value> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len).ok()?;
    let n = u32::from_ne_bytes(len) as usize;
    if n > MAX_MESSAGE {
        return None;
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

/// One answer, framed the same way.
pub fn message_bytes(v: &serde_json::Value) -> Vec<u8> {
    let body = serde_json::to_vec(v).unwrap_or_default();
    let mut out = (body.len() as u32).to_ne_bytes().to_vec();
    out.extend(body);
    out
}

/// The answer to one message from the extension. `root`: the notes folder (the one last opened in
/// the app), or why there's none; `today`/`time`: this computer's clock.
///   {"cmd":"hello"}                                   → {ok, folder}
///   {"cmd":"clip", url, title, site, highlights:[{text, link}]}  → {ok, page, rel, added, skipped, new_page}
///   {"cmd":"journal", text, url, title, site}         → {ok, rel}  (the usual quick capture)
/// Errors: {ok: false, error: words for him}.
pub fn answer(msg: &serde_json::Value, root: Result<std::path::PathBuf, String>, today: Date, time: &str) -> serde_json::Value {
    use serde_json::json;
    let res = (|| -> Result<serde_json::Value, String> {
        let root = root?;
        let s = |k: &str| msg.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        match msg.get("cmd").and_then(|v| v.as_str()).unwrap_or("") {
            "hello" => Ok(json!({ "folder": root.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default() })),
            "clip" => {
                let clip: Clip = serde_json::from_value(msg.clone()).map_err(|_| "The extension sent something this version doesn't understand. Update thinky or the extension.".to_string())?;
                let mut app = App::open_read_only(&root).map_err(|e| format!("{e} So nothing was added."))?;
                Ok(serde_json::to_value(file_clip(&mut app, &clip, today)?).unwrap_or_default())
            }
            "journal" => {
                let url = s("url");
                let link = if url.starts_with("https://") || url.starts_with("http://") { crate::capture::md_link(&url, &s("title"), &s("site")) } else { String::new() };
                let rel = crate::capture::capture_to_usual(&root, &s("text"), &link, false, today, time)?;
                Ok(json!({ "rel": rel }))
            }
            other => Err(format!("Unknown request “{other}”.")),
        }
    })();
    match res {
        Ok(mut v) => {
            if let Some(o) = v.as_object_mut() {
                o.insert("ok".into(), json!(true));
            }
            v
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

/// The receiver's whole conversation with Edge: answer each message until Edge closes the pipe
/// (a one-off `sendNativeMessage` sends one). `root` and `now` are asked per message, so each
/// answer uses the notes folder and the clock as they are then.
pub fn serve(r: &mut impl std::io::Read, w: &mut impl std::io::Write, root: impl Fn() -> Result<std::path::PathBuf, String>, now: impl Fn() -> (Date, String)) {
    while let Some(msg) = read_message(r) {
        let (today, time) = now();
        let a = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| answer(&msg, root(), today, &time)))
            .unwrap_or_else(|_| serde_json::json!({ "ok": false, "error": "thinky ran into a problem; nothing was added." }));
        if w.write_all(&message_bytes(&a)).and_then(|_| w.flush()).is_err() {
            return;
        }
    }
}

//! `leanoutliner://` links: what a link asks the app to do, and the links the app copies.
//!   leanoutliner://page/<name>        open the app (or its open window) at that page
//!   leanoutliner://note/<id>          … at the note with that `id::` (zoomed in, as Logseq's block links)
//!   leanoutliner://capture?text=…&url=…&title=…&site=…&box=1   the old browser bookmarklet's: still
//!                                     read (words made inert), but the app does nothing with it since
//!                                     Build 34, because any web page can send one (src-tauri main.rs)
//! A name is written as JavaScript's `encodeURIComponent` writes it (the app copies links so), and
//! read back by decoding `%xx`; a `+` stays a `+`. Any other `leanoutliner:` link is a capture, as
//! before page and note links existed.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Link {
    /// Add a note: its words, the web page it came from (a Markdown link), and whether to open the box first.
    Capture { text: String, url: String, boxed: bool },
    /// Open the page with this name.
    Page { name: String },
    /// Open the note with this `id::` (small letters).
    Note { id: String },
    /// A page or note link that names nothing usable (empty, or not an id): just open the app.
    App,
}

/// What a link asks for; None when it isn't a `leanoutliner:` link at all.
pub fn parse(link: &str) -> Option<Link> {
    let link = link.trim();
    let scheme = "leanoutliner:";
    if link.len() < scheme.len() || !link.is_char_boundary(scheme.len()) || !link[..scheme.len()].eq_ignore_ascii_case(scheme) {
        return None;
    }
    let rest = link[scheme.len()..].trim_start_matches('/');
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    // (a raw "?" or "#" ends the name: encodeURIComponent writes those inside a name as %3F, %23)
    let path = path.split(['?', '#']).next().unwrap_or("");
    if host.eq_ignore_ascii_case("page") {
        let name = decode(path, false);
        let name = name.trim();
        let ok = !name.is_empty() && !name.contains(['\n', '\r']) && !name.contains("[[") && !name.contains("]]");
        return Some(if ok { Link::Page { name: name.to_string() } } else { Link::App });
    }
    if host.eq_ignore_ascii_case("note") {
        let id = decode(path, false).trim().to_ascii_lowercase();
        let ok = (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
        return Some(if ok { Link::Note { id } } else { Link::App });
    }
    let query = rest.split_once('?').map_or("", |(_, q)| q);
    let (mut text, mut url, mut title, mut site, mut boxed) = (String::new(), String::new(), String::new(), String::new(), false);
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "text" => text = decode(v, true),
            "url" => url = decode(v, true),
            "title" => title = decode(v, true),
            "site" => site = decode(v, true),
            "box" => boxed = v != "0",
            _ => {}
        }
    }
    // the page's address as "[Title · Site](address)"; a selection is the note's words, and
    // without one the link is (capture::bullet)
    // Any web page can open such a link, so what it brings is only words: a web address only
    // when it is http(s), the words made inert as the extension's highlights are (clip::guard,
    // clip::defuse: no links, tags, properties, macros, boxes or to-dos), at most 8,000 letters.
    let web = url.trim().get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://")) || url.trim().get(..7).is_some_and(|s| s.eq_ignore_ascii_case("http://"));
    let url = if !web { String::new() } else { crate::capture::md_link(&url, &title, &site) };
    let text = if text.trim().is_empty() && url.is_empty() { title } else { text };
    let text: String = text.chars().take(8000).collect();
    let text = crate::clip::guard(&crate::clip::defuse(&text));
    Some(Link::Capture { text, url, boxed })
}

/// `%xx` decoded (a broken one is kept as written); `plus`: a `+` is a space (query values).
fn decode(s: &str, plus: bool) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' if plus => out.push(b' '),
            b'%' if i + 2 < b.len() => match std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                Some(v) => {
                    out.push(v);
                    i += 2;
                }
                None => out.push(b'%'),
            },
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// May the app's window go to this address? Only the app's own page: Tauri serves it at
/// `http(s)://tauri.localhost` (Windows, Android) or `tauri://localhost` (macOS, Linux); also
/// `about:blank`, and a `blob:` of the app's own page (a file the page made, e.g. "Save as file").
/// Anything else (a web page, a file, another app's address) is refused, so no outside page can
/// ever sit in the app's window and reach its commands or Android's `LeanAndroid` bridge
/// (src-tauri lib.rs, a navigation guard on every window).
pub fn is_app_page(url: &str) -> bool {
    let u = url.trim();
    if u.eq_ignore_ascii_case("about:blank") {
        return true;
    }
    let u = match u.get(..5) {
        Some(b) if b.eq_ignore_ascii_case("blob:") => &u[5..],
        _ => u,
    };
    ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"].iter().any(|own| {
        u.get(..own.len()).is_some_and(|p| p.eq_ignore_ascii_case(own)) && matches!(u[own.len()..].chars().next(), None | Some('/' | '?' | '#'))
    })
}

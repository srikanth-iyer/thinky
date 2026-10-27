//! `leanoutliner://` links: what a link asks the app to do, and the links the app copies.
//!   leanoutliner://page/<name>        open the app (or its open window) at that page
//!   leanoutliner://note/<id>          … at the note with that `id::` (zoomed in, as Logseq's block links)
//!   leanoutliner://capture?text=…&url=…&title=…&box=1   add a note (the browser bookmarklet)
//! A name is written as JavaScript's `encodeURIComponent` writes it (the app copies links so), and
//! read back by decoding `%xx`; a `+` stays a `+`. Any other `leanoutliner:` link is a capture, as
//! before page and note links existed.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Link {
    /// Add a note: its words, the web page it came from, and whether to open the box first.
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
    let (mut text, mut url, mut title, mut boxed) = (String::new(), String::new(), String::new(), false);
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "text" => text = decode(v, true),
            "url" => url = decode(v, true),
            "title" => title = decode(v, true),
            "box" => boxed = v != "0",
            _ => {}
        }
    }
    // a selection is the note; without one, the page title is
    let text = if text.trim().is_empty() { title } else { text };
    Some(Link::Capture { text, url, boxed })
}

/// The link that opens the app at page `name`.
pub fn page_link(name: &str) -> String {
    format!("leanoutliner://page/{}", encode(name.trim()))
}

/// The link that opens the app at the note with this `id::`.
pub fn note_link(id: &str) -> String {
    format!("leanoutliner://note/{}", encode(&id.trim().to_ascii_lowercase()))
}

/// As JavaScript's encodeURIComponent: everything but letters, digits and `-_.!~*'()` as %XX of
/// its UTF-8 bytes.
pub fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
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

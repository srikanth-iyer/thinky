//! Scanning block text for renames and unlinked references: where the links, tags, code and
//! URLs are, so plain mentions can be found and links rewritten without touching anything else.

use crate::key;

/// Lines that carry data rather than prose: properties, SCHEDULED/DEADLINE, drawers, fences.
struct LineKinds {
    in_fence: bool,
    in_drawer: bool,
}

#[derive(PartialEq)]
enum Kind {
    Prose,
    Property,
    Other,
}

impl LineKinds {
    fn new() -> Self {
        LineKinds { in_fence: false, in_drawer: false }
    }
    fn kind(&mut self, line: &str) -> Kind {
        let t = line.trim();
        if t.starts_with("```") {
            self.in_fence = !self.in_fence;
            return Kind::Other;
        }
        if self.in_fence {
            return Kind::Other;
        }
        if self.in_drawer {
            if t.eq_ignore_ascii_case(":END:") {
                self.in_drawer = false;
            }
            return Kind::Other;
        }
        if t.len() > 2 && t.starts_with(':') && t.ends_with(':') && !t.contains(' ') {
            self.in_drawer = true; // :LOGBOOK: … :END:
            return Kind::Other;
        }
        if t.starts_with("SCHEDULED:") || t.starts_with("DEADLINE:") {
            return Kind::Other;
        }
        if crate::parse::property(t).is_some() {
            return Kind::Property;
        }
        Kind::Prose
    }
}

fn boundary_before(s: &str, i: usize) -> bool {
    s[..i].chars().next_back().map_or(true, |p| p.is_whitespace() || p == '(' || p == ',')
}

/// End of `[[…]]` starting at byte `i` (nesting aware), exclusive.
fn close_brackets(s: &str, i: usize) -> Option<usize> {
    let b = s.as_bytes();
    let mut depth = 0;
    let mut j = i;
    while j + 1 < b.len() {
        if b[j] == b'[' && b[j + 1] == b'[' {
            depth += 1;
            j += 2;
        } else if b[j] == b']' && b[j + 1] == b']' {
            depth -= 1;
            j += 2;
            if depth == 0 {
                return Some(j);
            }
        } else {
            j += 1;
        }
    }
    None
}

/// End of a `#tag` starting at byte `i` (pointing at '#'), with trailing '.'/':' left out.
fn tag_end(s: &str, i: usize) -> usize {
    let start = i + 1;
    let mut j = start;
    for (off, ch) in s[start..].char_indices() {
        if ch.is_whitespace() || ",;!?\"'()[]{}<>`#".contains(ch) {
            break;
        }
        j = start + off + ch.len_utf8();
    }
    start + s[start..j].trim_end_matches(['.', ':']).len()
}

/// One piece of a line: plain text, or something that must not be treated as prose.
enum Piece<'a> {
    Plain(&'a str),
    /// `[[name]]` (`hash` = written `#[[name]]`).
    Link { name: &'a str, hash: bool, raw: &'a str },
    Tag { name: &'a str, raw: &'a str },
    /// Code, URLs, markdown links, macros, block refs: kept as they are.
    Fixed(&'a str),
}

fn pieces<'a>(s: &'a str) -> Vec<Piece<'a>> {
    let b = s.as_bytes();
    let mut out = vec![];
    let mut plain = 0;
    let mut i = 0;
    let push_plain = |out: &mut Vec<Piece<'a>>, from: usize, to: usize| {
        if to > from {
            out.push(Piece::Plain(&s[from..to]));
        }
    };
    while i < b.len() {
        let c = b[i];
        let mut end = None;
        let mut piece = None;
        if c == b'`' {
            let run = b[i..].iter().take_while(|&&x| x == b'`').count();
            let ticks = &s[i..i + run];
            let e = s[i + run..].find(ticks).map_or(i + run, |e| i + run + e + run);
            end = Some(e);
            piece = Some(Piece::Fixed(&s[i..e]));
        } else if c == b'[' && b.get(i + 1) == Some(&b'[') {
            if let Some(e) = close_brackets(s, i) {
                end = Some(e);
                piece = Some(Piece::Link { name: &s[i + 2..e - 2], hash: false, raw: &s[i..e] });
            }
        } else if c == b'#' && boundary_before(s, i) {
            if b.get(i + 1) == Some(&b'[') && b.get(i + 2) == Some(&b'[') {
                if let Some(e) = close_brackets(s, i + 1) {
                    end = Some(e);
                    piece = Some(Piece::Link { name: &s[i + 3..e - 2], hash: true, raw: &s[i..e] });
                }
            } else {
                let e = tag_end(s, i);
                if e > i + 1 {
                    end = Some(e);
                    piece = Some(Piece::Tag { name: &s[i + 1..e], raw: &s[i..e] });
                }
            }
        } else if c == b'{' && b.get(i + 1) == Some(&b'{') {
            if let Some(e) = s[i..].find("}}") {
                end = Some(i + e + 2);
                piece = Some(Piece::Fixed(&s[i..i + e + 2]));
            }
        } else if c == b'(' && b.get(i + 1) == Some(&b'(') {
            if let Some(e) = s[i..].find("))") {
                end = Some(i + e + 2);
                piece = Some(Piece::Fixed(&s[i..i + e + 2]));
            }
        } else if c == b'[' || (c == b'!' && b.get(i + 1) == Some(&b'[')) {
            // markdown link or image: [text](url)
            let open = if c == b'!' { i + 1 } else { i };
            if let Some(close) = s[open..].find(']').map(|x| open + x) {
                if s[close..].starts_with("](") {
                    if let Some(e) = s[close..].find(')') {
                        let mut stop = close + e + 1;
                        // a picture's size right after it, as Logseq writes it: {:height 200, :width 300}
                        if s[stop..].starts_with('{') && s[stop + 1..].trim_start().starts_with(':') {
                            if let Some(k) = s[stop..].find('}').filter(|&k| !s[stop..stop + k].contains('\n')) {
                                stop += k + 1;
                            }
                        }
                        end = Some(stop);
                        piece = Some(Piece::Fixed(&s[i..stop]));
                    }
                }
            }
        } else if (c == b'h' || c == b'H') && (s[i..].starts_with("http://") || s[i..].starts_with("https://")) {
            let e = s[i..].find(char::is_whitespace).map_or(s.len(), |e| i + e);
            end = Some(e);
            piece = Some(Piece::Fixed(&s[i..e]));
        }
        match (end, piece) {
            (Some(e), Some(p)) => {
                push_plain(&mut out, plain, i);
                out.push(p);
                i = e;
                plain = e;
            }
            _ => i += s[i..].chars().next().map_or(1, char::len_utf8),
        }
    }
    push_plain(&mut out, plain, b.len());
    out
}

/// Link form of a page name: `[[name]]`, or for a tag `#name` / `#[[name with spaces]]`.
fn tag_form(name: &str) -> String {
    if name.chars().any(|c| c.is_whitespace() || ",;!?\"'()[]{}<>`#".contains(c)) {
        format!("#[[{name}]]")
    } else {
        format!("#{name}")
    }
}

fn rename_inline(s: &str, old: &[String], new: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for p in pieces(s) {
        match p {
            Piece::Link { name, hash, raw } => {
                if old.contains(&key(name)) {
                    out.push_str(if hash { "#[[" } else { "[[" });
                    out.push_str(new);
                    out.push_str("]]");
                } else {
                    out.push_str(raw);
                }
            }
            Piece::Tag { name, raw } => {
                if old.contains(&key(name)) {
                    out.push_str(&tag_form(new));
                } else {
                    out.push_str(raw);
                }
            }
            Piece::Plain(t) | Piece::Fixed(t) => out.push_str(t),
        }
    }
    out
}

/// Rewrite every link to one of `old` (lowercase keys) as a link to `new`, in a block's or
/// preamble's text. Property values of tags/alias and `comma_keys` also match plain names.
/// Returns None when nothing changed.
pub fn rename_refs(text: &str, old: &[String], new: &str, comma_keys: &[String]) -> Option<String> {
    let mut kinds = LineKinds::new();
    let mut out = String::with_capacity(text.len() + 16);
    for (n, line) in text.split('\n').enumerate() {
        if n > 0 {
            out.push('\n');
        }
        match kinds.kind(line) {
            Kind::Other => out.push_str(line),
            Kind::Prose => out.push_str(&rename_inline(line, old, new)),
            Kind::Property => {
                let i = line.find("::").unwrap_or(0);
                let k = line[..i].trim().to_lowercase();
                let (head, value) = line.split_at(i + 2);
                out.push_str(head);
                let listy = ["tags", "tag", "alias", "aliases"].contains(&k.as_str()) || comma_keys.contains(&k);
                if !listy {
                    out.push_str(&rename_inline(value, old, new));
                    continue;
                }
                // comma list: replace plain items that name the page, links inside items as usual
                let mut depth = 0i32;
                let mut item_start = 0;
                let vb = value.as_bytes();
                let mut items: Vec<&str> = vec![];
                let mut j = 0;
                while j < vb.len() {
                    if vb[j] == b'[' && vb.get(j + 1) == Some(&b'[') {
                        depth += 1;
                        j += 2;
                        continue;
                    }
                    if vb[j] == b']' && vb.get(j + 1) == Some(&b']') {
                        depth -= 1;
                        j += 2;
                        continue;
                    }
                    if vb[j] == b',' && depth <= 0 {
                        items.push(&value[item_start..j]);
                        item_start = j + 1;
                    }
                    j += 1;
                }
                items.push(&value[item_start..]);
                for (m, item) in items.iter().enumerate() {
                    if m > 0 {
                        out.push(',');
                    }
                    let t = item.trim();
                    let plain = !t.is_empty() && !t.contains("[[") && !t.starts_with('#');
                    if plain && old.contains(&key(t)) {
                        let lead = &item[..item.len() - item.trim_start().len()];
                        let trail = &item[item.trim_end().len()..];
                        let name = if new.contains(',') { format!("[[{new}]]") } else { new.to_string() };
                        out.push_str(lead);
                        out.push_str(&name);
                        out.push_str(trail);
                    } else {
                        out.push_str(&rename_inline(item, old, new));
                    }
                }
            }
        }
    }
    (out != text).then_some(out)
}

/// Lowercased copy of `s` plus, for each byte of the copy, the byte range of the original
/// character it came from (lowercasing can change lengths, e.g. 'İ').
fn fold(s: &str) -> (String, Vec<(usize, usize)>) {
    let mut out = String::with_capacity(s.len());
    let mut map = Vec::with_capacity(s.len());
    for (i, c) in s.char_indices() {
        let end = i + c.len_utf8();
        for lc in c.to_lowercase() {
            for _ in 0..lc.len_utf8() {
                map.push((i, end));
            }
            out.push(lc);
        }
    }
    (out, map)
}

/// Byte ranges of whole-word, case-insensitive mentions of any of `names` (lowercase) in
/// prose: not inside links, tags, code, URLs, properties, dates or drawers.
pub fn mentions(text: &str, names: &[String]) -> Vec<(usize, usize)> {
    let mut found = vec![];
    let mut kinds = LineKinds::new();
    let mut line_start = 0;
    for line in text.split('\n') {
        if kinds.kind(line) == Kind::Prose {
            let mut off = 0;
            for p in pieces(line) {
                let len = match &p {
                    Piece::Plain(t) | Piece::Fixed(t) => t.len(),
                    Piece::Link { raw, .. } | Piece::Tag { raw, .. } => raw.len(),
                };
                if let Piece::Plain(t) = p {
                    let (folded, map) = fold(t);
                    for name in names {
                        if name.is_empty() {
                            continue;
                        }
                        for (pos, _) in folded.match_indices(name.as_str()) {
                            let (s, _) = map[pos];
                            let (_, e) = map[pos + name.len() - 1];
                            let before = t[..s].chars().next_back();
                            let after = t[e..].chars().next();
                            let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
                            if !word(before) && !word(after) {
                                found.push((line_start + off + s, line_start + off + e));
                            }
                        }
                    }
                }
                off += len;
            }
        }
        line_start += line.len() + 1;
    }
    found.sort();
    found.dedup();
    // drop overlaps (e.g. "machine learning" and "learning" both match): keep the earliest/longest
    let mut out: Vec<(usize, usize)> = vec![];
    for r in found {
        match out.last_mut() {
            Some(last) if r.0 < last.1 => {
                if r.0 == last.0 && r.1 > last.1 {
                    *last = r;
                }
            }
            _ => out.push(r),
        }
    }
    out
}

/// Wrap the first plain mention of `names` in `[[ ]]`. None if there is none.
pub fn link_first_mention(text: &str, names: &[String]) -> Option<String> {
    let (s, e) = *mentions(text, names).first()?;
    Some(format!("{}[[{}]]{}", &text[..s], &text[s..e], &text[e..]))
}

/// Does the text contain any (unlinked) mention of these names? Cheap pre-check first.
pub fn has_mention(text: &str, lower: &str, names: &[String]) -> bool {
    names.iter().any(|n| !n.is_empty() && lower.contains(n.as_str())) && !mentions(text, names).is_empty()
}

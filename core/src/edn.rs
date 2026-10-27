//! Tiny EDN reader for `logseq/config.edn`: enough to read settings, and to rewrite one
//! value in place without touching the rest of the file (comments, spacing, order).

#[derive(Debug, Clone, PartialEq)]
pub enum Edn {
    Nil,
    Bool(bool),
    Str(String),
    /// Keyword without the leading ':' (e.g. "journal/page-title-format").
    Kw(String),
    Sym(String),
    Num(String),
    Vec(Vec<Node>),
    List(Vec<Node>),
    Set(Vec<Node>),
    Map(Vec<(Node, Node)>),
    /// `#tag form`, e.g. `#js {}`; also regex literals `#"..."` (tag "regex").
    Tagged(String, Box<Node>),
}

/// A value plus where it sits in the text (byte offsets), so it can be replaced.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub v: Edn,
    pub start: usize,
    pub end: usize,
}

struct P<'a> {
    s: &'a str,
    b: &'a [u8],
    i: usize,
    depth: usize,
}

fn is_delim(c: u8) -> bool {
    c.is_ascii_whitespace() || b"()[]{}\",;".contains(&c)
}

impl<'a> P<'a> {
    fn skip_ws(&mut self) {
        while self.i < self.b.len() {
            let c = self.b[self.i];
            if c.is_ascii_whitespace() || c == b',' {
                self.i += 1;
            } else if c == b';' {
                while self.i < self.b.len() && self.b[self.i] != b'\n' {
                    self.i += 1;
                }
            } else {
                break;
            }
        }
    }

    fn token(&mut self) -> &'a str {
        let st = self.i;
        while self.i < self.b.len() && !is_delim(self.b[self.i]) {
            self.i += 1;
        }
        &self.s[st..self.i]
    }

    fn string(&mut self) -> Option<String> {
        // at the opening quote
        self.i += 1;
        let mut out = String::new();
        let mut run = self.i;
        while self.i < self.b.len() {
            match self.b[self.i] {
                b'"' => {
                    out.push_str(&self.s[run..self.i]);
                    self.i += 1;
                    return Some(out);
                }
                b'\\' if self.i + 1 < self.b.len() => {
                    out.push_str(&self.s[run..self.i]);
                    let e = self.b[self.i + 1];
                    self.i += 2;
                    match e {
                        b'n' => out.push('\n'),
                        b't' => out.push('\t'),
                        b'r' => out.push('\r'),
                        b'u' => {
                            let hex = self.s.get(self.i..self.i + 4)?;
                            if let Some(c) = u32::from_str_radix(hex, 16).ok().and_then(char::from_u32) {
                                out.push(c);
                            }
                            self.i += 4;
                        }
                        _ => {
                            // `\"`, `\\` and anything else: the character itself (may be multi-byte)
                            let start = self.i - 1;
                            let ch = self.s.get(start..)?.chars().next()?;
                            out.push(ch);
                            self.i = start + ch.len_utf8();
                        }
                    }
                    run = self.i;
                }
                _ => self.i += 1,
            }
        }
        None
    }

    fn seq(&mut self, close: u8) -> Option<Vec<Node>> {
        self.i += 1;
        let mut v = vec![];
        loop {
            self.skip_ws();
            if self.i >= self.b.len() {
                return None;
            }
            if self.b[self.i] == close {
                self.i += 1;
                return Some(v);
            }
            if let Some(n) = self.form()? {
                v.push(n);
            }
        }
    }

    /// One form; Ok(None) for a discarded `#_ form`.
    fn form(&mut self) -> Option<Option<Node>> {
        self.skip_ws();
        if self.i >= self.b.len() || self.depth > 200 {
            return None;
        }
        self.depth += 1;
        let start = self.i;
        let c = self.b[self.i];
        let v = match c {
            b'"' => Edn::Str(self.string()?),
            b'[' => Edn::Vec(self.seq(b']')?),
            b'(' => Edn::List(self.seq(b')')?),
            b'{' => {
                let items = self.seq(b'}')?;
                let mut it = items.into_iter();
                let mut pairs = vec![];
                while let Some(k) = it.next() {
                    let Some(v) = it.next() else { break };
                    pairs.push((k, v));
                }
                Edn::Map(pairs)
            }
            b'#' => {
                let next = self.b.get(self.i + 1).copied().unwrap_or(b' ');
                match next {
                    b'{' => {
                        self.i += 1;
                        Edn::Set(self.seq(b'}')?)
                    }
                    b'_' => {
                        self.i += 2;
                        self.form()?;
                        self.depth -= 1;
                        return Some(None);
                    }
                    b'"' => {
                        self.i += 1;
                        let s = self.string()?;
                        Edn::Tagged("regex".into(), Box::new(Node { v: Edn::Str(s), start: start + 1, end: self.i }))
                    }
                    _ => {
                        self.i += 1;
                        let tag = self.token().to_string();
                        let inner = loop {
                            match self.form()? {
                                Some(n) => break n,
                                None => continue,
                            }
                        };
                        Edn::Tagged(tag, Box::new(inner))
                    }
                }
            }
            b')' | b']' | b'}' => return None, // unbalanced
            b':' => {
                self.i += 1;
                Edn::Kw(self.token().to_string())
            }
            b'\\' => {
                // character literal like \a or \newline
                self.i += 1;
                let t = self.token();
                if t.is_empty() {
                    // a delimiter character such as \( : take one char
                    let ch = self.s.get(self.i..)?.chars().next()?;
                    self.i += ch.len_utf8();
                }
                Edn::Sym(self.s[start..self.i].to_string())
            }
            _ => {
                let t = self.token();
                if t.is_empty() {
                    // a stray delimiter we don't understand: skip it
                    self.i += 1;
                    Edn::Sym(String::new())
                } else if t == "nil" {
                    Edn::Nil
                } else if t == "true" || t == "false" {
                    Edn::Bool(t == "true")
                } else if t.as_bytes()[0].is_ascii_digit()
                    || (t.len() > 1 && (t.starts_with('-') || t.starts_with('+')) && t.as_bytes()[1].is_ascii_digit())
                {
                    Edn::Num(t.to_string())
                } else {
                    Edn::Sym(t.to_string())
                }
            }
        };
        self.depth -= 1;
        Some(Some(Node { v, start, end: self.i }))
    }
}

/// Parse the first form in `text` (the config map). None if the text isn't readable EDN.
pub fn parse(text: &str) -> Option<Node> {
    let mut p = P { s: text, b: text.as_bytes(), i: 0, depth: 0 };
    loop {
        match p.form()? {
            Some(n) => return Some(n),
            None => continue,
        }
    }
}

impl Node {
    /// Map lookup by keyword name, e.g. `get("journals-directory")`.
    pub fn get(&self, key: &str) -> Option<&Node> {
        match &self.v {
            Edn::Map(pairs) => pairs.iter().find(|(k, _)| matches!(&k.v, Edn::Kw(x) if x == key)).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match &self.v {
            Edn::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match &self.v {
            Edn::Bool(b) => Some(*b),
            Edn::Nil => Some(false),
            _ => None,
        }
    }
    pub fn as_num(&self) -> Option<f64> {
        match &self.v {
            Edn::Num(s) => s.parse().ok(),
            _ => None,
        }
    }
    pub fn as_kw(&self) -> Option<&str> {
        match &self.v {
            Edn::Kw(s) => Some(s),
            _ => None,
        }
    }
    /// Items of a vector, list or set (empty for anything else).
    pub fn items(&self) -> &[Node] {
        match &self.v {
            Edn::Vec(v) | Edn::List(v) | Edn::Set(v) => v,
            _ => &[],
        }
    }
    pub fn pairs(&self) -> &[(Node, Node)] {
        match &self.v {
            Edn::Map(p) => p,
            _ => &[],
        }
    }
}

/// EDN string literal for `s`.
pub fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Set `path` (keywords, outermost first) inside the top-level map to the EDN text `value`.
/// Replaces an existing value in place, or adds the missing key(s) just before the map's
/// closing brace. Everything else in the file is kept byte-for-byte.
pub fn set_path(text: &str, path: &[&str], value: &str) -> Option<String> {
    let root = parse(text)?;
    if !matches!(root.v, Edn::Map(_)) || path.is_empty() {
        return None;
    }
    let mut node = &root;
    for (depth, key) in path.iter().enumerate() {
        match node.get(key) {
            Some(child) if depth + 1 == path.len() => {
                return Some(format!("{}{}{}", &text[..child.start], value, &text[child.end..]));
            }
            Some(child) if matches!(child.v, Edn::Map(_)) => node = child,
            Some(child) => {
                // exists but isn't a map: replace it with a map holding the rest of the path
                let built = nested(&path[depth + 1..], value);
                return Some(format!("{}{}{}", &text[..child.start], built, &text[child.end..]));
            }
            None => {
                let built = format!(":{} {}", key, nested(&path[depth + 1..], value));
                // insert before the closing brace, after the last non-blank character
                let close = node.end - 1;
                let body = &text[node.start..close];
                let at = node.start + body.trim_end().len();
                let sep = if depth == 0 { "\n " } else { " " };
                let lead = if body.trim_end().ends_with('{') { "" } else { sep };
                return Some(format!("{}{}{}{}", &text[..at], lead, built, &text[at..]));
            }
        }
    }
    None
}

/// Put the items of the vector (or list, or set) at top-level `key` in another order, in place: the
/// item at place k afterwards is the one that was at `order[k]`. Only the items' own texts move;
/// everything between them (spaces, commas, line breaks, comments, `#_` forms) stays where it was,
/// byte for byte, and so does the rest of the file. None if `key` isn't a sequence, or `order` isn't
/// a reordering of all its items.
pub fn reorder_items(text: &str, key: &str, order: &[usize]) -> Option<String> {
    let root = parse(text)?;
    let items = match &root.get(key)?.v {
        Edn::Vec(v) | Edn::List(v) | Edn::Set(v) => v,
        _ => return None,
    };
    if order.len() != items.len() {
        return None;
    }
    let mut seen = vec![false; items.len()];
    for &k in order {
        if k >= items.len() || std::mem::replace(&mut seen[k], true) {
            return None;
        }
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for (slot, item) in items.iter().enumerate() {
        let from = &items[order[slot]];
        out.push_str(&text[at..item.start]);
        out.push_str(&text[from.start..from.end]);
        at = item.end;
    }
    out.push_str(&text[at..]);
    Some(out)
}

fn nested(path: &[&str], value: &str) -> String {
    match path.split_first() {
        None => value.to_string(),
        Some((k, rest)) => format!("{{:{} {}}}", k, nested(rest, value)),
    }
}

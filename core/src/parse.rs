//! Text → blocks, properties and references. No allocation-heavy regex; one pass per line.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Block {
    /// 0-based line number of the bullet line in the file.
    pub line: usize,
    pub depth: usize,
    /// The block's editable text, exactly as the editor sees it (property lines included).
    pub text: String,
    pub props: Vec<(String, String)>,
    /// Referenced page names, display form, deduplicated case-insensitively.
    pub refs: Vec<String>,
    /// To-do details when the block starts with a marker (TODO, DONE, …).
    pub task: Option<crate::task::Task>,
    /// Written as Logseq writes notes: a `- ` bullet. Not a plain paragraph before the first bullet
    /// or a `* `/`+ ` bullet (Obsidian…), which the editor writes as `- ` once that note changes.
    #[serde(skip)]
    pub dash: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ParsedPage {
    pub props: Vec<(String, String)>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub title: Option<String>,
    /// References made by page-level properties (tags, alias excluded; those are separate).
    pub prop_refs: Vec<String>,
    pub blocks: Vec<Block>,
}

/// Parse one page. `comma_props`: keys whose plain comma-separated values are page refs.
/// Block structure comes from `doc::split_doc`, so the index and the editor always agree.
pub fn parse_page(content: &str, comma_props: &[String]) -> ParsedPage {
    let doc = crate::doc::split_doc(content);
    let mut page = ParsedPage::default();
    let pre: Vec<&str> = doc.preamble.split_inclusive('\n').collect();
    let fm = crate::doc::front_matter_len(&pre).unwrap_or(0);
    let yaml = yaml_props(&pre[..fm]);
    let yaml_keys = yaml.len();
    page.props.extend(yaml);
    for l in &pre[fm..] {
        if let Some(kv) = property(l.trim_end_matches(['\n', '\r'])) {
            page.props.push(kv);
        }
    }
    let lines = crate::doc::block_lines(&doc);
    let mut props_only_first = false;
    for (n, db) in doc.blocks.iter().enumerate() {
        let dash = !db.plain
            && db.raw.as_deref().is_some_and(|r| {
                let l = r.trim_start_matches([' ', '\t']);
                l.starts_with("- ") || l == "-" || l.starts_with("-\n") || l.starts_with("-\r")
            });
        let mut b = Block { line: lines[n], depth: db.depth, text: db.text.clone(), props: vec![], refs: vec![], task: None, dash };
        let mut in_fence = false;
        let mut kept: Vec<&str> = vec![];
        for l in db.text.split('\n') {
            let t = l.trim_start().trim_end_matches('\r');
            let fence = t.starts_with("```");
            if !in_fence && !fence {
                if let Some(kv) = property(t) {
                    b.props.push(kv);
                    continue;
                }
            }
            if fence {
                in_fence = !in_fence;
            }
            kept.push(l);
        }
        let content = kept.join("\n");
        if n == 0 {
            props_only_first = db.depth == 0 && content.trim().is_empty() && !b.props.is_empty();
        }
        b.task = crate::task::parse(&b.text);
        finish_block(&mut page, b, content.trim(), comma_props);
    }

    // Logseq also writes page properties as the first block when it holds only properties.
    if page.props.is_empty() && props_only_first {
        let first = page.blocks.remove(0);
        page.props = first.props;
    }

    for (n, (k, v)) in page.props.clone().into_iter().enumerate() {
        let from_yaml = n < yaml_keys;
        match k.as_str() {
            "tags" | "tag" => page.tags.extend(split_list(&v)),
            "alias" | "aliases" => page.aliases.extend(split_list(&v)),
            // a YAML title (Obsidian) is shown but never renames the page
            "title" if !from_yaml => page.title = Some(v.trim().to_string()),
            "title" => {}
            _ => {
                let mut r = vec![];
                prop_value_refs(&k, &v, comma_props, &mut r);
                page.prop_refs.extend(r);
            }
        }
    }
    dedup_ci(&mut page.tags);
    dedup_ci(&mut page.aliases);
    dedup_ci(&mut page.prop_refs);
    page
}

/// Minimal YAML front matter reader: `key: value`, `key: [a, b]`, and `key:` followed by
/// `- item` lines. Values become comma-separated text, like Logseq property values.
pub(crate) fn yaml_props(lines: &[&str]) -> Vec<(String, String)> {
    fn unquote(v: &str) -> &str {
        let v = v.trim();
        for q in ['"', '\''] {
            if v.len() >= 2 && v.starts_with(q) && v.ends_with(q) {
                return &v[1..v.len() - 1];
            }
        }
        v
    }
    let mut out: Vec<(String, String)> = vec![];
    let mut list_key: Option<String> = None;
    let mut items: Vec<String> = vec![];
    let flush = |out: &mut Vec<(String, String)>, key: &mut Option<String>, items: &mut Vec<String>| {
        if let Some(k) = key.take() {
            out.push((k, items.join(", ")));
        }
        items.clear();
    };
    for l in lines.iter().skip(1) {
        let t = l.trim_end_matches(['\n', '\r']);
        if t.trim_end() == "---" || t.trim_end() == "..." {
            break;
        }
        if t.trim().is_empty() || t.starts_with('#') {
            continue;
        }
        if list_key.is_some() && (t.starts_with(' ') || t.starts_with('\t') || t.starts_with("- ")) {
            let item = t.trim().trim_start_matches("- ").trim();
            if !item.is_empty() {
                items.push(unquote(item).to_string());
            }
            continue;
        }
        if let Some((k, v)) = crate::doc::yaml_key(t) {
            flush(&mut out, &mut list_key, &mut items);
            let v = v.trim();
            if v.is_empty() {
                list_key = Some(k.to_lowercase());
            } else if v.starts_with('[') && v.ends_with(']') && !v.starts_with("[[") {
                let inner = &v[1..v.len() - 1];
                let vals: Vec<&str> = inner.split(',').map(unquote).filter(|x| !x.is_empty()).collect();
                out.push((k.to_lowercase(), vals.join(", ")));
            } else {
                out.push((k.to_lowercase(), unquote(v).to_string()));
            }
        }
    }
    flush(&mut out, &mut list_key, &mut items);
    out
}

/// `content`: the block's text without its property lines (where its links are read from).
fn finish_block(page: &mut ParsedPage, mut b: Block, content: &str, comma_props: &[String]) {
    let mut refs = vec![];
    text_refs(content, &mut refs);
    for (k, v) in &b.props {
        if k == "tags" || k == "alias" {
            refs.extend(split_list(v));
        } else {
            prop_value_refs(k, v, comma_props, &mut refs);
        }
    }
    dedup_ci(&mut refs);
    b.refs = refs;
    page.blocks.push(b);
}

/// `key:: value` → (lowercased key, value). Key: letters, digits, '-', '_', '.', '/'.
pub fn property(s: &str) -> Option<(String, String)> {
    let i = s.find("::")?;
    let k = &s[..i];
    if k.is_empty() || !k.chars().all(|c| c.is_alphanumeric() || "-_./".contains(c)) {
        return None;
    }
    let v = &s[i + 2..];
    if !(v.is_empty() || v.starts_with(' ')) {
        return None;
    }
    Some((k.to_lowercase(), v.trim().to_string()))
}

/// Comma-separated list where items may be `[[x]]`, `#x`, `#[[x]]` or plain.
pub fn split_list(v: &str) -> Vec<String> {
    let mut out = vec![];
    let mut depth = 0i32;
    let mut cur = String::new();
    let mut chars = v.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' && chars.peek() == Some(&'[') {
            depth += 1;
            chars.next();
            cur.push_str("[[");
        } else if c == ']' && chars.peek() == Some(&']') {
            depth -= 1;
            chars.next();
            cur.push_str("]]");
        } else if c == ',' && depth <= 0 {
            push_item(&mut out, &cur);
            cur.clear();
        } else {
            cur.push(c);
        }
    }
    push_item(&mut out, &cur);
    out
}

/// Items of a comma-separated value as written (links kept as links), for suggestions.
pub fn split_items(v: &str) -> Vec<String> {
    let mut out = vec![];
    let mut depth = 0i32;
    let mut start = 0;
    let b = v.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'[' && b.get(i + 1) == Some(&b'[') {
            depth += 1;
            i += 2;
            continue;
        }
        if b[i] == b']' && b.get(i + 1) == Some(&b']') {
            depth -= 1;
            i += 2;
            continue;
        }
        if b[i] == b',' && depth <= 0 {
            out.push(v[start..i].trim().to_string());
            start = i + 1;
        }
        i += 1;
    }
    out.push(v[start..].trim().to_string());
    out.retain(|x| !x.is_empty());
    out
}

fn push_item(out: &mut Vec<String>, s: &str) {
    let mut s = s.trim();
    s = s.strip_prefix('#').unwrap_or(s);
    if let Some(inner) = s.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) {
        s = inner;
    }
    let s = s.trim();
    if !s.is_empty() {
        out.push(s.to_string());
    }
}

/// Logseq (0.8.9+): property values link only via `[[x]]` / `#x`, except keys listed in
/// `:property/separated-by-commas`, whose plain comma-separated values are pages.
fn prop_value_refs(key: &str, v: &str, comma_props: &[String], out: &mut Vec<String>) {
    if comma_props.iter().any(|k| k == key) {
        out.extend(split_list(v));
    } else {
        text_refs(v, out);
    }
}

/// Extract `[[x]]`, `#[[x]]`, `#x` from free text, skipping inline code spans.
pub fn text_refs(text: &str, out: &mut Vec<String>) {
    let b = text.as_bytes();
    let mut i = 0;
    let n = b.len();
    let mut prev: Option<char> = None;
    while i < n {
        let c = b[i];
        if c == b'`' {
            // skip inline code (or a fence marker line already filtered by caller)
            let run = b[i..].iter().take_while(|&&x| x == b'`').count();
            let ticks = &text[i..i + run];
            if let Some(end) = text[i + run..].find(ticks) {
                i = i + run + end + run;
            } else {
                i += run;
            }
            prev = Some('`');
            continue;
        }
        if c == b'[' && i + 1 < n && b[i + 1] == b'[' {
            if let Some((name, end)) = bracket_ref(text, i) {
                if !name.is_empty() {
                    out.push(name);
                }
                i = end;
                prev = Some(']');
                continue;
            }
        }
        if c == b'#' && prev.map_or(true, |p| p.is_whitespace() || p == '(' || p == ',') {
            if i + 2 < n && b[i + 1] == b'[' && b[i + 2] == b'[' {
                if let Some((name, end)) = bracket_ref(text, i + 1) {
                    if !name.is_empty() {
                        out.push(name);
                    }
                    i = end;
                    prev = Some(']');
                    continue;
                }
            }
            let start = i + 1;
            let mut j = start;
            for (off, ch) in text[start..].char_indices() {
                if ch.is_whitespace() || ",;!?\"'()[]{}<>`#".contains(ch) {
                    j = start + off;
                    break;
                }
                j = start + off + ch.len_utf8();
            }
            let tag = text[start..j].trim_end_matches(['.', ':']);
            if !tag.is_empty() {
                out.push(tag.to_string());
                i = j;
                prev = text[..j].chars().last();
                continue;
            }
        }
        let ch = text[i..].chars().next().unwrap();
        prev = Some(ch);
        i += ch.len_utf8();
    }
}

/// `[[ ... ]]` starting at byte `i` (pointing at the first '['), nesting aware.
/// Returns (inner text, byte index after the closing brackets).
fn bracket_ref(text: &str, i: usize) -> Option<(String, usize)> {
    let b = text.as_bytes();
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
                let inner = text[i + 2..j - 2].trim().to_string();
                return Some((inner, j));
            }
        } else {
            j += 1;
        }
    }
    None
}

pub fn dedup_ci(v: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    v.retain(|s| seen.insert(s.to_lowercase()));
}

//! Editing model: a page split into blocks that the UI edits, then joined back.
//! Rule: a block the user did not touch is written back byte-for-byte (`raw`),
//! so opening and saving a page never reformats it.
//!
//! File shape (Logseq, plus notes written elsewhere, e.g. Obsidian):
//!   preamble   leading `key:: value` lines and blank lines (page properties)
//!   plain      text before the first bullet, one block per paragraph (blank-line separated)
//!   bullets    `- `, `* ` or `+ ` lines; following non-bullet lines continue the block
//! A plain paragraph is only valid before the first bullet (after one it would read as a
//! continuation line), so once a bullet has been written, plain blocks are written as bullets.

use crate::parse::property;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocBlock {
    pub depth: usize,
    /// Editable text: first line without its marker, continuation lines without their indent.
    /// Property lines (`key:: value`) are part of the text.
    pub text: String,
    /// Exact original lines (with line breaks). `None` for new blocks.
    #[serde(default)]
    pub raw: Option<String>,
    /// A paragraph without a bullet marker (text before the file's first bullet).
    #[serde(default)]
    pub plain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Doc {
    /// Raw leading lines (page properties and blank lines), kept verbatim.
    pub preamble: String,
    pub blocks: Vec<DocBlock>,
    /// "\t" or "  ": the file's indent unit, reused for edited blocks.
    pub indent: String,
    pub crlf: bool,
}

fn split_lines_keep(s: &str) -> Vec<&str> {
    s.split_inclusive('\n').collect()
}

fn strip_eol(l: &str) -> &str {
    l.trim_end_matches('\n').trim_end_matches('\r')
}

/// (depth, text after the marker) if the line is a bullet: `- x`, `* x`, `+ x` or a lone `-`.
pub fn bullet(line: &str) -> Option<(usize, &str)> {
    let l = strip_eol(line);
    let ws = l.len() - l.trim_start_matches([' ', '\t']).len();
    let lead = &l[..ws];
    let rest = &l[ws..];
    let body = if let Some(b) = rest.strip_prefix("- ").or_else(|| rest.strip_prefix("* ")).or_else(|| rest.strip_prefix("+ ")) {
        b
    } else if rest == "-" {
        ""
    } else {
        return None;
    };
    let depth = lead.matches('\t').count() + lead.matches(' ').count() / 2;
    Some((depth, body))
}

fn is_fence(line: &str) -> bool {
    let t = strip_eol(line).trim_start();
    let t = bullet(line).map(|(_, b)| b.trim_start()).unwrap_or(t);
    t.starts_with("```")
}

fn is_blank(line: &str) -> bool {
    strip_eol(line).trim().is_empty()
}

pub fn split_doc(content: &str) -> Doc {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let crlf = content.contains("\r\n");
    let lines = split_lines_keep(content);
    let mut i = 0;

    // 1. preamble: YAML front matter (Obsidian style), then leading property lines and blank lines
    let mut preamble = String::new();
    if let Some(n) = front_matter_len(&lines) {
        preamble.extend(lines[..n].iter().copied());
        i = n;
    }
    while i < lines.len() && bullet(lines[i]).is_none() && (is_blank(lines[i]) || property(strip_eol(lines[i])).is_some()) {
        preamble.push_str(lines[i]);
        i += 1;
    }

    let mut blocks: Vec<DocBlock> = vec![];
    let mut in_fence = false;

    // 2. plain paragraphs before the first bullet
    let mut para: Vec<&str> = vec![];
    let flush = |para: &mut Vec<&str>, blocks: &mut Vec<DocBlock>| {
        if !para.is_empty() {
            blocks.push(DocBlock { depth: 0, text: plain_text(para), raw: Some(para.concat()), plain: true });
            para.clear();
        }
    };
    while i < lines.len() {
        let line = lines[i];
        if !in_fence && bullet(line).is_some() {
            break;
        }
        // a non-blank line after blank lines starts a new paragraph
        if !in_fence && !is_blank(line) && para.last().is_some_and(|l| is_blank(l)) {
            flush(&mut para, &mut blocks);
        }
        para.push(line);
        if is_fence(line) {
            in_fence = !in_fence;
        }
        i += 1;
    }
    flush(&mut para, &mut blocks);

    // 3. bullets (non-bullet lines continue the current one)
    let mut indent = String::from("\t");
    let mut cur: Vec<&str> = vec![];
    let mut cur_depth = 0;
    let push = |cur: &mut Vec<&str>, depth: usize, blocks: &mut Vec<DocBlock>| {
        if !cur.is_empty() {
            blocks.push(DocBlock { depth, text: block_text(cur), raw: Some(cur.concat()), plain: false });
            cur.clear();
        }
    };
    while i < lines.len() {
        let line = lines[i];
        let b = if in_fence { None } else { bullet(line) };
        if let Some((d, _)) = b {
            push(&mut cur, cur_depth, &mut blocks);
            if d > 0 && line.starts_with(' ') {
                indent = "  ".into();
            }
            cur_depth = d;
        }
        cur.push(line);
        if is_fence(line) {
            in_fence = !in_fence;
        }
        i += 1;
    }
    push(&mut cur, cur_depth, &mut blocks);
    Doc { preamble, blocks, indent, crlf }
}

/// Lines in a `---` … `---` block at the very top that looks like YAML front matter.
pub fn front_matter_len(lines: &[&str]) -> Option<usize> {
    if strip_eol(lines.first()?).trim_end() != "---" {
        return None;
    }
    for (j, l) in lines.iter().enumerate().skip(1).take(300) {
        let t = strip_eol(l);
        if t.trim_end() == "---" || t.trim_end() == "..." {
            return Some(j + 1);
        }
        let yaml_like = t.trim().is_empty()
            || t.starts_with('#')
            || t.starts_with(' ')
            || t.starts_with('\t')
            || t.starts_with("- ")
            || yaml_key(t).is_some();
        if !yaml_like {
            return None;
        }
    }
    None
}

/// `key: value` (YAML) → (key, value). Not `key:: value` (that is a Logseq property).
pub fn yaml_key(t: &str) -> Option<(&str, &str)> {
    let (k, v) = t.split_once(':')?;
    let ok_key = !k.is_empty() && k.chars().all(|c| c.is_alphanumeric() || "-_.".contains(c));
    (ok_key && (v.is_empty() || v.starts_with(' '))).then_some((k, v))
}

/// Paragraph text: lines without line breaks; trailing blank lines stay in `raw` only.
fn plain_text(lines: &[&str]) -> String {
    let mut v: Vec<&str> = lines.iter().map(|l| strip_eol(l)).collect();
    while v.last().is_some_and(|l| l.trim().is_empty()) {
        v.pop();
    }
    v.join("\n")
}

fn block_text(lines: &[&str]) -> String {
    let first = strip_eol(lines[0]);
    let first_ws = first.len() - first.trim_start_matches([' ', '\t']).len();
    let lead = &first[..first_ws];
    let (_, body) = bullet(lines[0]).unwrap_or((0, first));
    let mut out = body.to_string();
    let cont_prefix = format!("{lead}  ");
    for l in &lines[1..] {
        let l = strip_eol(l);
        out.push('\n');
        if let Some(r) = l.strip_prefix(cont_prefix.as_str()) {
            out.push_str(r);
        } else if let Some(r) = l.strip_prefix(lead) {
            out.push_str(r.trim_start_matches([' ', '\t']));
        } else {
            out.push_str(l.trim_start());
        }
    }
    // trailing blank lines belong to the raw only
    while out.ends_with('\n') {
        out.pop();
    }
    out
}

fn render_block(b: &DocBlock, indent: &str, nl: &str) -> String {
    let ind = indent.repeat(b.depth);
    let mut s = String::new();
    for (i, line) in b.text.split('\n').enumerate() {
        let line = line.trim_end_matches('\r');
        if i == 0 {
            if line.is_empty() {
                s.push_str(&format!("{ind}-{nl}"));
            } else {
                s.push_str(&format!("{ind}- {line}{nl}"));
            }
        } else if line.is_empty() {
            s.push_str(nl);
        } else {
            s.push_str(&format!("{ind}  {line}{nl}"));
        }
    }
    s
}

/// Is this block unchanged since it was read (so its raw lines can be written back)?
fn unchanged(b: &DocBlock, bullet_written: bool) -> bool {
    let Some(raw) = &b.raw else { return false };
    let lines = split_lines_keep(raw);
    if lines.is_empty() {
        return false;
    }
    if b.plain {
        !bullet_written && b.depth == 0 && bullet(lines[0]).is_none() && plain_text(&lines) == b.text
    } else {
        bullet(lines[0]).map(|x| x.0) == Some(b.depth) && block_text(&lines) == b.text
    }
}

/// Join blocks back into file text. Unchanged blocks are written verbatim; anything else
/// is re-rendered as a `- ` bullet with the file's indent and line endings.
pub fn join_doc(doc: &Doc) -> String {
    let nl = if doc.crlf { "\r\n" } else { "\n" };
    let mut out = doc.preamble.clone();
    let mut bullet_written = false;
    for b in &doc.blocks {
        // only the file's last line may lack a line break; anything after it needs one
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(nl);
        }
        if unchanged(b, bullet_written) {
            out.push_str(b.raw.as_deref().unwrap_or(""));
            if !b.plain {
                bullet_written = true;
            }
        } else {
            out.push_str(&render_block(b, &doc.indent, nl));
            bullet_written = true;
        }
    }
    out
}

/// Stable 64-bit FNV-1a hash (hex) of file content, used to detect outside changes.
pub fn content_hash(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

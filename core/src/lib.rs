//! outline_core — reads a Logseq-format Markdown vault and indexes it.
//!
//! Vault layout (Logseq OG): `pages/*.md`, `journals/YYYY_MM_DD.md`.
//! Supported syntax: `- ` bullets (tab or 2-space indent), `[[Page]]`, `#tag`,
//! `#[[multi word]]`, `key:: value` properties (page-level and block-level),
//! `tags::` / `alias::` page properties, to-do markers with scheduled/deadline dates.
//! Code fences and inline code are ignored. Not supported on purpose: block references,
//! queries, graph.

pub mod app;
pub mod capture;
pub mod capture_box;
mod config;
mod doc;
pub mod date;
pub mod edn;
pub mod log;
pub mod merge;
mod parse;
pub mod task;
pub mod text;
pub mod update;
mod vault;

pub use parse::{parse_page, Block, ParsedPage};
pub use config::Config;
pub use doc::{block_lines, content_hash, join_doc, split_doc, Doc, DocBlock};
pub use vault::{file_stem_for, page_name_from_stem, PageInfo, RefGroup, RefHit, SearchHit, TaskHit, Vault};

/// Lowercased lookup key for a page name (Logseq page names are case-insensitive).
pub fn key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Append a new top-level bullet to a page's text. Used by quick capture / the widget.
/// Multi-line input becomes one bullet with continuation lines indented under it.
/// Keeps the file's shape, as the editor does: its line endings (CRLF stays CRLF), a leading
/// byte-order mark, and a missing final line break (a new file gets one).
pub fn append_bullet(content: &str, text: &str) -> String {
    let (bom, body) = match content.strip_prefix('\u{feff}') {
        Some(b) => ("\u{feff}", b),
        None => ("", content),
    };
    let nl = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let final_nl = body.is_empty() || body.ends_with('\n');
    // drop trailing line breaks and blank (whitespace-only) last lines, nothing else
    let mut out = body;
    loop {
        let t = out.trim_end_matches(['\n', '\r']);
        let last = &t[t.rfind('\n').map_or(0, |i| i + 1)..];
        if !t.is_empty() && last.trim().is_empty() {
            out = &t[..t.len() - last.len()];
        } else {
            out = t;
            break;
        }
    }
    let mut out = out.to_string();
    // A fresh Logseq journal is often just "-" or "- " : replace that empty bullet.
    if out.trim() == "-" {
        out.clear();
    }
    if !out.is_empty() {
        out.push_str(nl);
    }
    let text = text.replace("\r\n", "\n");
    let mut lines = text.trim_end_matches('\n').split('\n');
    out.push_str("- ");
    out.push_str(lines.next().unwrap_or(""));
    for l in lines {
        out.push_str(nl);
        if !l.is_empty() {
            out.push_str("  ");
            out.push_str(l);
        }
    }
    if final_nl {
        out.push_str(nl);
    }
    format!("{bom}{out}")
}

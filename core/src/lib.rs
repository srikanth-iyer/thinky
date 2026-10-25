//! outline_core — reads a Logseq-format Markdown vault and indexes it.
//!
//! Vault layout (Logseq OG): `pages/*.md`, `journals/YYYY_MM_DD.md`.
//! Supported syntax: `- ` bullets (tab or 2-space indent), `[[Page]]`, `#tag`,
//! `#[[multi word]]`, `key:: value` properties (page-level and block-level),
//! `tags::` / `alias::` page properties. Code fences and inline code are ignored.
//! Not supported on purpose: block references, queries, graph.

pub mod app;
mod config;
mod doc;
pub mod date;
mod parse;
mod vault;

pub use parse::{parse_page, Block, ParsedPage};
pub use config::Config;
pub use doc::{content_hash, join_doc, split_doc, Doc, DocBlock};
pub use vault::{file_stem_for, PageInfo, RefGroup, RefHit, SearchHit, Vault};

/// Lowercased lookup key for a page name (Logseq page names are case-insensitive).
pub fn key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Append a new top-level bullet to a page's text. Used by quick capture / the widget.
/// Multi-line input becomes one bullet with continuation lines indented under it.
pub fn append_bullet(content: &str, text: &str) -> String {
    let text = text.trim_end_matches(['\n', '\r']);
    let mut out = content.trim_end_matches(['\n', '\r', ' ', '\t']).to_string();
    // A fresh Logseq journal is often just "-" or "- " : replace that empty bullet.
    if out.trim() == "-" {
        out.clear();
    }
    if !out.is_empty() {
        out.push('\n');
    }
    let mut lines = text.lines();
    out.push_str("- ");
    out.push_str(lines.next().unwrap_or(""));
    for l in lines {
        out.push_str("\n  ");
        out.push_str(l);
    }
    out.push('\n');
    out
}

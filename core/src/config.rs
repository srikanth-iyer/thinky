//! The few Logseq `logseq/config.edn` settings that change how files are read.

use crate::date::{self, Date};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Config {
    pub pages_dir: String,
    pub journals_dir: String,
    /// Title shown and linked, e.g. "MMM do, yyyy" → "Oct 25th, 2026".
    pub journal_title_format: String,
    /// File stem of journal files, e.g. "yyyy_MM_dd".
    pub journal_file_format: String,
    /// Property keys whose plain comma-separated values are page references
    /// (Logseq `:property/separated-by-commas`). `tags` and `alias` always are.
    pub comma_props: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            pages_dir: "pages".into(),
            journals_dir: "journals".into(),
            journal_title_format: "MMM do, yyyy".into(),
            journal_file_format: "yyyy_MM_dd".into(),
            comma_props: vec![],
        }
    }
}

impl Config {
    /// Read settings from the text of `logseq/config.edn`. Unknown/missing keys keep defaults.
    pub fn from_edn(text: &str) -> Self {
        let mut c = Config::default();
        // drop comments (`;` to end of line, outside strings)
        let clean: String = text
            .lines()
            .map(|l| {
                let mut in_str = false;
                let mut end = l.len();
                for (i, ch) in l.char_indices() {
                    match ch {
                        '"' => in_str = !in_str,
                        ';' if !in_str => {
                            end = i;
                            break;
                        }
                        _ => {}
                    }
                }
                &l[..end]
            })
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(v) = edn_string(&clean, ":pages-directory") {
            c.pages_dir = v;
        }
        if let Some(v) = edn_string(&clean, ":journals-directory") {
            c.journals_dir = v;
        }
        if let Some(v) = edn_string(&clean, ":journal/page-title-format") {
            c.journal_title_format = v;
        }
        if let Some(v) = edn_string(&clean, ":journal/file-name-format") {
            c.journal_file_format = v;
        }
        if let Some(i) = clean.find(":property/separated-by-commas") {
            let rest = &clean[i..];
            if let (Some(a), Some(b)) = (rest.find('#'), rest.find('}')) {
                if a < b {
                    c.comma_props = rest[a + 2..b]
                        .split_whitespace()
                        .map(|k| k.trim_start_matches(':').to_lowercase())
                        .collect();
                }
            }
        }
        c
    }

    pub fn journal_title(&self, d: Date) -> String {
        date::format(&self.journal_title_format, d)
    }

    pub fn journal_rel_path(&self, d: Date) -> String {
        format!("{}/{}.md", self.journals_dir, date::format(&self.journal_file_format, d))
    }

    /// Date from a journal file stem; also accepts the default `yyyy_MM_dd`.
    pub fn journal_from_file(&self, stem: &str) -> Option<Date> {
        date::parse(&self.journal_file_format, stem).or_else(|| date::parse("yyyy_MM_dd", stem))
    }

    /// Date from a page title, if the title is a journal title.
    pub fn journal_from_title(&self, title: &str) -> Option<Date> {
        date::parse(&self.journal_title_format, title)
    }
}

fn edn_string(text: &str, key: &str) -> Option<String> {
    let i = text.find(key)?;
    let rest = text[i + key.len()..].trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

//! The Logseq `logseq/config.edn` settings this app follows.

use crate::date::{self, Date};
use crate::edn;
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
    /// `:favorites` page names, in order.
    pub favorites: Vec<String>,
    /// `:preferred-workflow`: "todo" (TODO/DOING) or "now" (LATER/NOW).
    pub workflow: String,
    /// `:default-templates {:journals "name"}`: template for a new journal day ("" = none).
    pub journal_template: String,
    /// `:quick-capture-templates` for shared text and shared images/files.
    pub capture_text: String,
    pub capture_media: String,
    /// `:quick-capture-options`.
    pub capture_today: bool,
    pub capture_redirect: bool,
    pub capture_page: String,
    /// `:shortcuts`: Logseq action id → key strings (empty = turned off).
    pub shortcuts: Vec<(String, Vec<String>)>,
    /// `:scheduled/future-days`: how many days ahead today's "Scheduled & deadline" box looks.
    pub future_days: u32,
    /// `:ref/default-open-blocks-level`: how many levels of a linked reference start open (1 = the
    /// note itself, 2 = and its sub-notes; deeper ones are folded).
    pub ref_open_level: u32,
}

pub const DEFAULT_CAPTURE_TEXT: &str = "[[quick capture]] **{time}**: {text} from {url}";
pub const DEFAULT_CAPTURE_MEDIA: &str = "[[quick capture]] **{time}**: {url}";

impl Default for Config {
    fn default() -> Self {
        Config {
            pages_dir: "pages".into(),
            journals_dir: "journals".into(),
            journal_title_format: "MMM do, yyyy".into(),
            journal_file_format: "yyyy_MM_dd".into(),
            comma_props: vec![],
            favorites: vec![],
            workflow: "todo".into(),
            journal_template: String::new(),
            capture_text: DEFAULT_CAPTURE_TEXT.into(),
            capture_media: DEFAULT_CAPTURE_MEDIA.into(),
            capture_today: false,
            capture_redirect: false,
            capture_page: "quick capture".into(),
            shortcuts: vec![],
            future_days: 7,
            ref_open_level: 2,
        }
    }
}

impl Config {
    /// Read settings from the text of `logseq/config.edn`. Unknown/missing keys keep defaults;
    /// a file that isn't readable EDN gives the defaults.
    pub fn from_edn(text: &str) -> Self {
        let mut c = Config::default();
        let Some(root) = edn::parse(text) else { return c };
        let s = |k: &str| root.get(k).and_then(|n| n.as_str()).map(str::to_string);
        if let Some(v) = s("pages-directory") {
            c.pages_dir = v;
        }
        if let Some(v) = s("journals-directory") {
            c.journals_dir = v;
        }
        if let Some(v) = s("journal/page-title-format") {
            c.journal_title_format = v;
        }
        if let Some(v) = s("journal/file-name-format") {
            c.journal_file_format = v;
        }
        if let Some(n) = root.get("property/separated-by-commas") {
            c.comma_props = n.items().iter().filter_map(|x| x.as_kw().or(x.as_str())).map(|k| k.to_lowercase()).collect();
        }
        if let Some(n) = root.get("favorites") {
            c.favorites = n.items().iter().filter_map(|x| x.as_str()).map(str::to_string).collect();
        }
        if let Some(w) = root.get("preferred-workflow").and_then(|n| n.as_kw()) {
            c.workflow = if w == "now" { "now".into() } else { "todo".into() };
        }
        if let Some(t) = root.get("default-templates").and_then(|n| n.get("journals")).and_then(|n| n.as_str()) {
            c.journal_template = t.trim().to_string();
        }
        if let Some(q) = root.get("quick-capture-templates") {
            if let Some(t) = q.get("text").and_then(|n| n.as_str()) {
                c.capture_text = t.to_string();
            }
            if let Some(t) = q.get("media").and_then(|n| n.as_str()) {
                c.capture_media = t.to_string();
            }
        }
        if let Some(o) = root.get("quick-capture-options") {
            if let Some(b) = o.get("insert-today?").and_then(|n| n.as_bool()) {
                c.capture_today = b;
            }
            if let Some(b) = o.get("redirect-page?").and_then(|n| n.as_bool()) {
                c.capture_redirect = b;
            }
            if let Some(p) = o.get("default-page").and_then(|n| n.as_str()) {
                if !p.trim().is_empty() {
                    c.capture_page = p.trim().to_string();
                }
            }
        }
        if let Some(n) = root.get("scheduled/future-days").and_then(|n| n.as_num()) {
            if n >= 0.0 {
                c.future_days = n.min(365.0) as u32;
            }
        }
        if let Some(n) = root.get("ref/default-open-blocks-level").and_then(|n| n.as_num()) {
            if n >= 0.0 {
                c.ref_open_level = n.min(100.0) as u32;
            }
        }
        if let Some(sc) = root.get("shortcuts") {
            for (k, v) in sc.pairs() {
                let Some(action) = k.as_kw() else { continue };
                let keys: Vec<String> = match &v.v {
                    edn::Edn::Str(s) => vec![s.clone()],
                    _ => v.items().iter().filter_map(|x| x.as_str()).map(str::to_string).collect(),
                };
                c.shortcuts.push((action.to_string(), keys));
            }
        }
        c
    }

    /// The marker a new to-do starts with: LATER with `:preferred-workflow :now`, else TODO.
    pub fn todo_marker(&self) -> &'static str {
        if self.workflow == "now" {
            "LATER"
        } else {
            "TODO"
        }
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

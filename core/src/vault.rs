//! In-memory index over all pages: names, aliases, incoming references, tags, properties.

use crate::config::Config;
use crate::date::Date;
use crate::parse::{dedup_ci, parse_page, ParsedPage};
use crate::key;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// Marks a reference made by page-level properties rather than a block.
const PAGE_LEVEL: usize = usize::MAX;


#[derive(Debug, Clone)]
struct Page {
    name: String,
    path: String,
    journal: Option<Date>,
    parsed: ParsedPage,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageInfo {
    pub name: String,
    pub path: Option<String>,
    pub journal: Option<Date>,
    pub exists: bool,
    pub props: Vec<(String, String)>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefHit {
    /// Line of the bullet in the source file; `None` = the page's own properties.
    pub line: Option<usize>,
    pub depth: usize,
    pub text: String,
    pub props: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefGroup {
    pub page: String,
    pub journal: Option<Date>,
    pub hits: Vec<RefHit>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub page: String,
    pub line: Option<usize>,
    pub snippet: String,
}

#[derive(Default)]
pub struct Vault {
    pub config: Config,
    pages: HashMap<String, Page>,
    by_path: HashMap<String, String>,
    alias: HashMap<String, String>,
    /// raw target key → (source page key, block index or PAGE_LEVEL)
    incoming: HashMap<String, Vec<(String, usize)>>,
    /// display form for names that are referenced but may have no file
    display: HashMap<String, String>,
    /// Files whose page name is already taken by another file: rel → (key, content).
    /// Not indexed; promoted if the owning file goes away.
    shadowed: HashMap<String, (String, String)>,
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && s.is_char_boundary(i + 3) {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

impl Vault {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_config(config: Config) -> Self {
        Vault { config, ..Default::default() }
    }

    /// Page title from a vault-relative path, following Logseq's file-name rules
    /// (`___` = namespace slash, legacy `%2F`-style url-encoding) and journal settings.
    pub fn title_from_path(&self, rel: &str) -> (String, Option<Date>) {
        let rel = rel.replace('\\', "/");
        let file = rel.rsplit('/').next().unwrap_or(&rel);
        let stem = file.strip_suffix(".md").unwrap_or(file);
        if rel.starts_with(&format!("{}/", self.config.journals_dir)) {
            if let Some(d) = self.config.journal_from_file(stem) {
                return (self.config.journal_title(d), Some(d));
            }
        }
        (percent_decode(&stem.replace("___", "/")), None)
    }

    /// Read `logseq/config.edn` (if present) then every page and journal file.
    pub fn open(root: &Path) -> std::io::Result<Self> {
        let cfg = std::fs::read_to_string(root.join("logseq").join("config.edn"))
            .map(|t| Config::from_edn(&t))
            .unwrap_or_default();
        let mut v = Vault::with_config(cfg);
        v.load_dir(root)?;
        Ok(v)
    }

    /// Load every `.md` under `pages/` and `journals/`. Returns the number of files read.
    pub fn load_dir(&mut self, root: &Path) -> std::io::Result<usize> {
        let mut n = 0;
        for sub in [self.config.pages_dir.clone(), self.config.journals_dir.clone()] {
            let dir = root.join(&sub);
            if !dir.is_dir() {
                continue;
            }
            let mut stack = vec![dir];
            while let Some(d) = stack.pop() {
                for e in std::fs::read_dir(&d)? {
                    let e = e?;
                    let p = e.path();
                    if e.file_type()?.is_dir() {
                        stack.push(p);
                    } else if p.extension().is_some_and(|x| x == "md") {
                        let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                        let text = std::fs::read_to_string(&p).unwrap_or_default();
                        self.upsert(&rel, &text);
                        n += 1;
                    }
                }
            }
        }
        Ok(n)
    }

    /// Add or replace one file. Cheap enough to call on every save.
    pub fn upsert(&mut self, rel_path: &str, content: &str) {
        let rel = rel_path.replace('\\', "/");
        self.remove(&rel);
        let parsed = parse_page(content, &self.config.comma_props);
        let (mut name, journal) = self.title_from_path(&rel);
        if journal.is_none() {
            if let Some(t) = &parsed.title {
                name = t.clone();
            }
        }
        let k = key(&name);
        if self.pages.get(&k).is_some_and(|p| p.path != rel) {
            self.shadowed.insert(rel, (k, content.to_string()));
            return;
        }
        // page-level references
        let mut page_refs: Vec<String> = parsed.tags.clone();
        page_refs.extend(parsed.prop_refs.iter().cloned());
        dedup_ci(&mut page_refs);
        for r in page_refs {
            self.add_ref(&r, &k, PAGE_LEVEL);
        }
        for (i, b) in parsed.blocks.iter().enumerate() {
            for r in &b.refs {
                self.add_ref(r, &k, i);
            }
        }
        for a in &parsed.aliases {
            self.alias.insert(key(a), k.clone());
        }
        self.display.insert(k.clone(), name.clone());
        self.by_path.insert(rel.clone(), k.clone());
        self.pages.insert(k, Page { name, path: rel, journal, parsed });
    }

    pub fn remove(&mut self, rel_path: &str) {
        let rel = rel_path.replace('\\', "/");
        if self.shadowed.remove(&rel).is_some() {
            return;
        }
        let Some(k) = self.by_path.remove(&rel) else { return };
        let Some(p) = self.pages.remove(&k) else { return };
        self.unindex(&k, &p);
        // a file that was waiting for this name takes over
        let next = self.shadowed.iter().filter(|(_, (sk, _))| *sk == k).map(|(r, _)| r.clone()).min();
        if let Some(r) = next {
            let (_, content) = self.shadowed.remove(&r).unwrap();
            self.upsert(&r, &content);
        }
    }

    fn unindex(&mut self, k: &str, p: &Page) {
        let mut targets: Vec<String> = p.parsed.tags.iter().chain(&p.parsed.prop_refs).cloned().collect();
        for b in &p.parsed.blocks {
            targets.extend(b.refs.iter().cloned());
        }
        for t in targets {
            if let Some(v) = self.incoming.get_mut(&key(&t)) {
                v.retain(|(src, _)| src != k);
            }
        }
        for a in &p.parsed.aliases {
            if self.alias.get(&key(a)).is_some_and(|x| x == k) {
                self.alias.remove(&key(a));
            }
        }
    }

    /// Page names claimed by more than one file: (name, [owning file, other files…]).
    pub fn duplicates(&self) -> Vec<(String, Vec<String>)> {
        let mut by_key: HashMap<&str, Vec<String>> = HashMap::new();
        for (rel, (k, _)) in &self.shadowed {
            by_key.entry(k.as_str()).or_default().push(rel.clone());
        }
        let mut out: Vec<(String, Vec<String>)> = by_key
            .into_iter()
            .filter_map(|(k, mut others)| {
                let p = self.pages.get(k)?;
                others.sort();
                let mut paths = vec![p.path.clone()];
                paths.extend(others);
                Some((p.name.clone(), paths))
            })
            .collect();
        out.sort();
        out
    }

    fn add_ref(&mut self, target: &str, src: &str, idx: usize) {
        let t = key(target);
        if t.is_empty() {
            return;
        }
        self.display.entry(t.clone()).or_insert_with(|| target.trim().to_string());
        // (src, idx) pairs are unique by construction: refs are deduped per block / page.
        self.incoming.entry(t).or_default().push((src.to_string(), idx));
    }

    /// Resolve a name or alias to the canonical page key.
    pub fn resolve(&self, name: &str) -> String {
        let k = key(name);
        if self.pages.contains_key(&k) {
            return k;
        }
        self.alias.get(&k).cloned().unwrap_or(k)
    }

    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    pub fn page_info(&self, name: &str) -> PageInfo {
        let k = self.resolve(name);
        match self.pages.get(&k) {
            Some(p) => PageInfo {
                name: p.name.clone(),
                path: Some(p.path.clone()),
                journal: p.journal,
                exists: true,
                props: p.parsed.props.clone(),
                tags: p.parsed.tags.clone(),
                aliases: p.parsed.aliases.clone(),
            },
            None => {
                let display = self.display.get(&k).cloned().unwrap_or_else(|| name.trim().to_string());
                let journal = self.config.journal_from_title(&display);
                PageInfo {
                    path: Some(match journal {
                        Some(d) => self.config.journal_rel_path(d),
                        None => format!("{}/{}.md", self.config.pages_dir, file_stem_for(&display)),
                    }),
                    name: display,
                    journal,
                    exists: false,
                    props: vec![],
                    tags: vec![],
                    aliases: vec![],
                }
            }
        }
    }

    /// All names for a page: canonical + aliases (keys).
    fn names_of(&self, k: &str) -> Vec<String> {
        let mut v = vec![k.to_string()];
        if let Some(p) = self.pages.get(k) {
            v.extend(p.parsed.aliases.iter().map(|a| key(a)));
        }
        v.extend(self.alias.iter().filter(|(_, t)| t.as_str() == k).map(|(a, _)| a.clone()));
        v.sort();
        v.dedup();
        v
    }

    /// Linked references: every block (or page-property line) in other pages that mentions this page.
    /// Journals newest first, then other pages alphabetically.
    pub fn linked_refs(&self, name: &str) -> Vec<RefGroup> {
        let k = self.resolve(name);
        let mut by_src: HashMap<&str, Vec<usize>> = HashMap::new();
        for n in self.names_of(&k) {
            if let Some(v) = self.incoming.get(&n) {
                for (src, i) in v {
                    if src != &k {
                        by_src.entry(src.as_str()).or_default().push(*i);
                    }
                }
            }
        }
        let mut groups: Vec<RefGroup> = by_src
            .into_iter()
            .filter_map(|(src, mut idxs)| {
                let p = self.pages.get(src)?;
                idxs.sort();
                idxs.dedup();
                let hits = idxs
                    .into_iter()
                    .filter_map(|i| {
                        if i == PAGE_LEVEL {
                            Some(RefHit { line: None, depth: 0, text: String::new(), props: p.parsed.props.clone() })
                        } else {
                            let b = p.parsed.blocks.get(i)?;
                            Some(RefHit { line: Some(b.line), depth: b.depth, text: b.text.clone(), props: b.props.clone() })
                        }
                    })
                    .collect::<Vec<_>>();
                if hits.is_empty() {
                    return None;
                }
                Some(RefGroup { page: p.name.clone(), journal: p.journal, hits })
            })
            .collect();
        groups.sort_by(|a, b| match (a.journal, b.journal) {
            (Some(x), Some(y)) => y.cmp(&x),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.page.to_lowercase().cmp(&b.page.to_lowercase()),
        });
        groups
    }

    /// Pages whose `tags::` property includes this tag (or one of its aliases).
    pub fn pages_tagged(&self, tag: &str) -> Vec<String> {
        let names = self.names_of(&self.resolve(tag));
        let mut v: Vec<String> = self
            .pages
            .values()
            .filter(|p| p.parsed.tags.iter().any(|t| names.contains(&self.resolve(t))))
            .map(|p| p.name.clone())
            .collect();
        v.sort_by_key(|s| s.to_lowercase());
        v
    }

    /// Every block or page that has property `key`, optionally whose value contains `value`.
    pub fn with_property(&self, prop: &str, value: Option<&str>) -> Vec<RefGroup> {
        let pk = prop.to_lowercase();
        let val = value.map(|v| v.to_lowercase());
        let matches = |props: &[(String, String)]| {
            props.iter().any(|(k, v)| k == &pk && val.as_ref().map_or(true, |x| v.to_lowercase().contains(x)))
        };
        let mut groups: Vec<RefGroup> = vec![];
        for p in self.pages.values() {
            let mut hits = vec![];
            if matches(&p.parsed.props) {
                hits.push(RefHit { line: None, depth: 0, text: String::new(), props: p.parsed.props.clone() });
            }
            for b in &p.parsed.blocks {
                if matches(&b.props) {
                    hits.push(RefHit { line: Some(b.line), depth: b.depth, text: b.text.clone(), props: b.props.clone() });
                }
            }
            if !hits.is_empty() {
                groups.push(RefGroup { page: p.name.clone(), journal: p.journal, hits });
            }
        }
        groups.sort_by_key(|g| g.page.to_lowercase());
        groups
    }

    /// Page names (existing files first by match quality), then text matches inside blocks.
    pub fn search(&self, q: &str, limit: usize) -> Vec<SearchHit> {
        let ql = q.trim().to_lowercase();
        if ql.is_empty() {
            return vec![];
        }
        let mut names: Vec<(u8, &str)> = self
            .display
            .iter()
            .filter(|(k, _)| k.contains(&ql))
            .map(|(k, d)| (if k == &ql { 0 } else if k.starts_with(&ql) { 1 } else { 2 }, d.as_str()))
            .collect();
        names.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.len().cmp(&b.1.len())));
        let mut out: Vec<SearchHit> =
            names.into_iter().take(limit).map(|(_, d)| SearchHit { page: d.to_string(), line: None, snippet: String::new() }).collect();
        'outer: for p in self.pages.values() {
            for b in &p.parsed.blocks {
                if out.len() >= limit {
                    break 'outer;
                }
                if b.text.to_lowercase().contains(&ql) {
                    out.push(SearchHit { page: p.name.clone(), line: Some(b.line), snippet: snippet(&b.text, &ql) });
                }
            }
        }
        out
    }

    /// Every known page name (files + names only referenced), with journal dates.
    pub fn all_pages(&self) -> Vec<(String, Option<Date>, bool)> {
        let mut v: Vec<(String, Option<Date>, bool)> = self
            .display
            .iter()
            .filter(|(k, _)| !self.alias.contains_key(*k) || self.pages.contains_key(*k))
            .map(|(k, d)| match self.pages.get(k) {
                Some(p) => (p.name.clone(), p.journal, true),
                None => (d.clone(), self.config.journal_from_title(d), false),
            })
            .collect();
        v.sort_by_key(|x| x.0.to_lowercase());
        v
    }

    /// Tag name → number of pages tagged with it via `tags::`.
    pub fn all_tags(&self) -> Vec<(String, usize)> {
        let mut m: HashMap<String, (String, usize)> = HashMap::new();
        for p in self.pages.values() {
            for t in &p.parsed.tags {
                m.entry(key(t)).or_insert_with(|| (t.clone(), 0)).1 += 1;
            }
        }
        let mut v: Vec<(String, usize)> = m.into_values().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.to_lowercase().cmp(&b.0.to_lowercase())));
        v
    }

    /// Distinct property keys used anywhere, with counts.
    pub fn all_property_keys(&self) -> Vec<(String, usize)> {
        let mut m: HashMap<&str, usize> = HashMap::new();
        for p in self.pages.values() {
            for (k, _) in p.parsed.props.iter().chain(p.parsed.blocks.iter().flat_map(|b| b.props.iter())) {
                *m.entry(k.as_str()).or_default() += 1;
            }
        }
        let mut v: Vec<(String, usize)> = m.into_iter().map(|(k, n)| (k.to_string(), n)).collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v
    }
}

/// File name for a new page, following Logseq's triple-lowbar format.
pub fn file_stem_for(name: &str) -> String {
    name.replace('/', "___").chars().map(|c| if "<>:\"\\|?*".contains(c) { '_' } else { c }).collect()
}

fn snippet(text: &str, ql: &str) -> String {
    let lower = text.to_lowercase();
    let pos = lower.find(ql).unwrap_or(0);
    // char-safe window around the match
    let start = text.char_indices().map(|(i, _)| i).filter(|&i| i <= pos).rev().nth(40).unwrap_or(0);
    let s: String = text[start..].chars().take(120).collect();
    let s = s.replace('\n', " ");
    if start > 0 { format!("…{s}") } else { s }
}

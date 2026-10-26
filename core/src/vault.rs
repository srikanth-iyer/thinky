//! In-memory index over all pages: names, aliases, incoming references, tags, properties.

use crate::config::Config;
use crate::date::Date;
use crate::parse::{dedup_ci, parse_page, ParsedPage};
use crate::task::Task;
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
pub struct TaskHit {
    pub page: String,
    pub journal: Option<Date>,
    pub line: usize,
    pub depth: usize,
    /// The block's editable text (marker, dates and properties included).
    pub text: String,
    #[serde(flatten)]
    pub task: Task,
}

/// One entry of the All pages list.
#[derive(Debug, Clone, Serialize)]
pub struct PageEntry {
    pub name: String,
    pub journal: Option<Date>,
    /// Has a file (false: only linked or tagged so far).
    pub exists: bool,
    /// How many blocks/pages link to it.
    pub refs: usize,
    /// The page's `icon::` (an emoji, shown before its name), if it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// A page's `icon::` property: short (an emoji or two), else none.
pub fn page_icon(props: &[(String, String)]) -> Option<String> {
    let v = props.iter().find(|(k, _)| k == "icon")?.1.trim();
    (!v.is_empty() && v.chars().count() <= 8).then(|| v.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct TemplateInfo {
    pub name: String,
    pub page: String,
    pub line: usize,
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
    /// Every file above (both kinds), by its path in small letters, with how many have it (names
    /// that differ only in capitals are one file on Windows and Android): see `free_rel`.
    lc_paths: HashMap<String, u32>,
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
        (page_name_from_stem(stem), None)
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
    /// Add or replace one file. Cheap enough to call on every save.
    /// A file that already owns its page name keeps it (another file with the same name
    /// never takes over just because this one was re-read).
    pub fn upsert(&mut self, rel_path: &str, content: &str) {
        let rel = rel_path.replace('\\', "/");
        let old_key = self.take(&rel);
        let parsed = parse_page(content, &self.config.comma_props);
        let (mut name, journal) = self.title_from_path(&rel);
        if journal.is_none() {
            if let Some(t) = &parsed.title {
                name = t.clone();
            }
        }
        let k = key(&name);
        self.lc_add(&rel);
        if self.pages.get(&k).is_some_and(|p| p.path != rel) {
            self.shadowed.insert(rel, (k, content.to_string()));
        } else {
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
        // the name this file had before may be free now
        if let Some(ok) = old_key {
            self.promote(&ok);
        }
    }

    /// The file is gone: forget it, and let a file waiting for its name take over.
    pub fn remove(&mut self, rel_path: &str) {
        let rel = rel_path.replace('\\', "/");
        if let Some(k) = self.take(&rel) {
            self.promote(&k);
        }
    }

    /// Unindex a file without promoting anyone. Returns the name key it owned.
    fn take(&mut self, rel: &str) -> Option<String> {
        if self.shadowed.remove(rel).is_some() {
            self.lc_del(rel);
            return None;
        }
        let k = self.by_path.remove(rel)?;
        self.lc_del(rel);
        let p = self.pages.remove(&k)?;
        self.unindex(&k, &p);
        Some(k)
    }

    /// If no file owns `k`, the first waiting file (by path) takes the name.
    fn promote(&mut self, k: &str) {
        if self.pages.contains_key(k) {
            return;
        }
        let next = self.shadowed.iter().filter(|(_, (sk, _))| sk == k).map(|(r, _)| r.clone()).min();
        if let Some(r) = next {
            if let Some((_, content)) = self.shadowed.remove(&r) {
                self.lc_del(&r);
                self.upsert(&r, &content);
            }
        }
    }

    fn unindex(&mut self, k: &str, p: &Page) {
        let mut targets: Vec<String> = p.parsed.tags.iter().chain(&p.parsed.prop_refs).cloned().collect();
        for b in &p.parsed.blocks {
            targets.extend(b.refs.iter().cloned());
        }
        for t in targets {
            let tk = key(&t);
            if let Some(v) = self.incoming.get_mut(&tk) {
                v.retain(|(src, _)| src != k);
                if v.is_empty() {
                    // nobody links to this name any more: forget it unless it has a file
                    self.incoming.remove(&tk);
                    if !self.pages.contains_key(&tk) {
                        self.display.remove(&tk);
                    }
                }
            }
        }
        for a in &p.parsed.aliases {
            if self.alias.get(&key(a)).is_some_and(|x| x == k) {
                self.alias.remove(&key(a));
            }
        }
        if !self.incoming.contains_key(k) {
            self.display.remove(k);
        }
    }

    fn lc_add(&mut self, rel: &str) {
        *self.lc_paths.entry(rel.to_lowercase()).or_insert(0) += 1;
    }

    fn lc_del(&mut self, rel: &str) {
        let l = rel.to_lowercase();
        if let Some(n) = self.lc_paths.get_mut(&l) {
            *n -= 1;
            if *n == 0 {
                self.lc_paths.remove(&l);
            }
        }
    }

    /// The file a new page gets: `rel` when no file has that name (in any capitals: Windows and
    /// Android ignore them), else the first free `<stem> (2).md`, `<stem> (3).md`… next to it, so a
    /// new page never takes another page's file (one named by its `title::`). `own`: the page's own
    /// file (a rename), which doesn't count.
    pub fn free_rel(&self, rel: &str, own: Option<&str>) -> String {
        let own = own.map(str::to_lowercase);
        let taken = |r: &str| {
            let l = r.to_lowercase();
            own.as_deref() != Some(l.as_str()) && self.lc_paths.contains_key(&l)
        };
        if !taken(rel) {
            return rel.to_string();
        }
        let stem = rel.strip_suffix(".md").unwrap_or(rel);
        (2..).map(|k| format!("{stem} ({k}).md")).find(|r| !taken(r)).unwrap_or_default()
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
                        // a file of its own, never another page's
                        None => self.free_rel(&format!("{}/{}.md", self.config.pages_dir, file_stem_for(&display)), None),
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

    /// Every known page name (files + names only referenced), with journal dates and how
    /// many places link to it (aliases included).
    pub fn all_pages(&self) -> Vec<PageEntry> {
        let count = |k: &str| -> usize {
            let mut srcs: Vec<(&str, usize)> = vec![];
            for n in self.names_of(k) {
                if let Some(v) = self.incoming.get(&n) {
                    srcs.extend(v.iter().filter(|(s, _)| s != k).map(|(s, i)| (s.as_str(), *i)));
                }
            }
            srcs.sort();
            srcs.dedup();
            srcs.len()
        };
        let mut v: Vec<PageEntry> = self
            .display
            .iter()
            .filter(|(k, _)| !self.alias.contains_key(*k) || self.pages.contains_key(*k))
            .filter(|(k, _)| self.pages.contains_key(*k) || self.incoming.get(*k).is_some_and(|v| !v.is_empty()))
            .map(|(k, d)| match self.pages.get(k) {
                Some(p) => PageEntry { name: p.name.clone(), journal: p.journal, exists: true, refs: count(k), icon: page_icon(&p.parsed.props) },
                None => PageEntry { name: d.clone(), journal: self.config.journal_from_title(d), exists: false, refs: count(k), icon: None },
            })
            .collect();
        v.sort_by_key(|x| x.name.to_lowercase());
        v
    }

    /// Dates of every journal page that has a file.
    pub fn journal_dates(&self) -> Vec<Date> {
        let mut v: Vec<Date> = self.pages.values().filter_map(|p| p.journal).collect();
        v.sort();
        v
    }

    /// Every to-do in the vault (open ones only unless `done`).
    pub fn tasks(&self, done: bool) -> Vec<TaskHit> {
        let mut out = vec![];
        for p in self.pages.values() {
            for b in &p.parsed.blocks {
                if let Some(t) = &b.task {
                    if done || t.is_open() {
                        out.push(TaskHit {
                            page: p.name.clone(),
                            journal: p.journal,
                            line: b.line,
                            depth: b.depth,
                            text: b.text.clone(),
                            task: t.clone(),
                        });
                    }
                }
            }
        }
        out.sort_by(|a, b| b.journal.cmp(&a.journal).then(a.page.to_lowercase().cmp(&b.page.to_lowercase())).then(a.line.cmp(&b.line)));
        out
    }

    /// Lowercased names a page goes by (its name and aliases), for finding plain mentions.
    pub fn mention_names(&self, name: &str) -> Vec<String> {
        let k = self.resolve(name);
        let mut v: Vec<String> = self.names_of(&k);
        if let Some(p) = self.pages.get(&k) {
            v.push(key(&p.name));
        }
        v.retain(|n| !n.is_empty());
        v.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
        v.dedup();
        v
    }

    /// Unlinked references: blocks in other pages that mention this page's name (or an alias)
    /// as plain text, without linking it. At most `limit` blocks; the flag says if there were more.
    pub fn unlinked_refs(&self, name: &str, limit: usize) -> (Vec<RefGroup>, bool) {
        let k = self.resolve(name);
        let names = self.mention_names(name);
        let linked: Vec<String> = self.names_of(&k);
        let mut groups: Vec<RefGroup> = vec![];
        let mut total = 0;
        let mut more = false;
        for (pk, p) in &self.pages {
            if *pk == k {
                continue;
            }
            let mut hits = vec![];
            for b in &p.parsed.blocks {
                if b.refs.iter().any(|r| linked.contains(&self.resolve(r)) || linked.contains(&key(r))) {
                    continue; // already links to the page
                }
                let lower = b.text.to_lowercase();
                if crate::text::has_mention(&b.text, &lower, &names) {
                    if total >= limit {
                        more = true;
                        break;
                    }
                    total += 1;
                    hits.push(RefHit { line: Some(b.line), depth: b.depth, text: b.text.clone(), props: b.props.clone() });
                }
            }
            if !hits.is_empty() {
                groups.push(RefGroup { page: p.name.clone(), journal: p.journal, hits });
            }
        }
        groups.sort_by(|a, b| match (a.journal, b.journal) {
            (Some(x), Some(y)) => y.cmp(&x),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.page.to_lowercase().cmp(&b.page.to_lowercase()),
        });
        (groups, more)
    }

    /// For each page name: is there at least one unlinked reference to it (a plain mention in
    /// another page)? One pass over all notes for the lot, and a page stops being looked for once
    /// found, so the journals list can ask for a few days at once and show "Unlinked references"
    /// only for days that have some.
    pub fn has_unlinked(&self, names: &[String]) -> Vec<bool> {
        let targets: Vec<(String, Vec<String>, Vec<String>)> = names
            .iter()
            .map(|n| {
                let k = self.resolve(n);
                let linked = self.names_of(&k);
                (k, self.mention_names(n), linked)
            })
            .collect();
        let mut found = vec![false; names.len()];
        let mut left = found.len();
        if left == 0 {
            return found;
        }
        'pages: for (pk, p) in &self.pages {
            for b in &p.parsed.blocks {
                let lower = b.text.to_lowercase(); // once per note, for all the names
                for (i, (k, mention, linked)) in targets.iter().enumerate() {
                    if found[i] || pk == k || !mention.iter().any(|m| lower.contains(m.as_str())) {
                        continue;
                    }
                    if b.refs.iter().any(|r| linked.contains(&self.resolve(r)) || linked.contains(&key(r))) {
                        continue; // already links to the page
                    }
                    if crate::text::has_mention(&b.text, &lower, mention) {
                        found[i] = true;
                        left -= 1;
                        if left == 0 {
                            break 'pages;
                        }
                    }
                }
            }
        }
        found
    }

    /// Pages (keys) whose files link to this page by its own name (not via an alias).
    pub fn linking_pages(&self, name: &str) -> Vec<String> {
        let k = self.resolve(name);
        let mut v: Vec<String> = self.incoming.get(&k).map(|v| v.iter().map(|(s, _)| s.clone()).collect()).unwrap_or_default();
        v.sort();
        v.dedup();
        v
    }

    /// File of a page key, if it has one.
    pub fn path_of_key(&self, k: &str) -> Option<String> {
        self.pages.get(k).map(|p| p.path.clone())
    }

    /// Blocks with a `template::` property.
    pub fn templates(&self) -> Vec<TemplateInfo> {
        let mut v: Vec<TemplateInfo> = vec![];
        for p in self.pages.values() {
            for b in &p.parsed.blocks {
                if let Some((_, name)) = b.props.iter().find(|(k, _)| k == "template") {
                    if !name.trim().is_empty() {
                        v.push(TemplateInfo { name: name.trim().to_string(), page: p.name.clone(), line: b.line });
                    }
                }
            }
        }
        v.sort_by_key(|t| t.name.to_lowercase());
        v
    }

    /// A template's blocks as (depth relative to the template, text). The template block
    /// itself is included (without its template properties) unless
    /// `template-including-parent:: false`.
    pub fn template_blocks(&self, name: &str) -> Option<Vec<(usize, String)>> {
        let want = key(name);
        for p in self.pages.values() {
            let blocks = &p.parsed.blocks;
            for (i, b) in blocks.iter().enumerate() {
                if !b.props.iter().any(|(k, v)| k == "template" && key(v) == want) {
                    continue;
                }
                let parent = !b.props.iter().any(|(k, v)| k == "template-including-parent" && v.trim() == "false");
                let mut out = vec![];
                let base = if parent { b.depth } else { b.depth + 1 };
                if parent {
                    let text: Vec<&str> = b
                        .text
                        .split('\n')
                        .filter(|l| {
                            let t = l.trim();
                            !(t.starts_with("template::") || t.starts_with("template-including-parent::"))
                        })
                        .collect();
                    out.push((0, text.join("\n")));
                }
                for c in &blocks[i + 1..] {
                    if c.depth <= b.depth {
                        break;
                    }
                    out.push((c.depth - base, c.text.clone()));
                }
                return Some(out);
            }
        }
        None
    }

    /// Distinct values used for a property (comma lists split), most used first.
    pub fn prop_values(&self, prop: &str) -> Vec<(String, usize)> {
        let pk = prop.to_lowercase();
        let mut m: HashMap<String, (String, usize)> = HashMap::new();
        for p in self.pages.values() {
            for (k, v) in p.parsed.props.iter().chain(p.parsed.blocks.iter().flat_map(|b| b.props.iter())) {
                if *k != pk {
                    continue;
                }
                for item in crate::parse::split_items(v) {
                    m.entry(item.to_lowercase()).or_insert_with(|| (item.clone(), 0)).1 += 1;
                }
            }
        }
        let mut v: Vec<(String, usize)> = m.into_values().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.to_lowercase().cmp(&b.0.to_lowercase())));
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

/// Page name from a page file's name (without `.md`): the inverse of `file_stem_for`
/// (`___` = namespace slash, `%3F`-style escapes; older `%2F` names read the same way).
pub fn page_name_from_stem(stem: &str) -> String {
    percent_decode(&stem.replace("___", "/"))
}

/// File name for a new page, following Logseq's triple-lowbar format.
/// Same rules as Logseq's `:triple-lowbar` format (frontend.util.fs/tri-lb-file-name-sanity):
/// `/` becomes `___`, characters files can't hold are percent-encoded (`Why?` → `Why%3F`),
/// so the name reads back exactly from the file name.
pub fn file_stem_for(name: &str) -> String {
    let mut s = name.strip_prefix('/').unwrap_or(name);
    s = s.strip_suffix('/').unwrap_or(s);
    // a "%" that looks like an escape is escaped itself
    let b = s.as_bytes();
    let mut t = String::with_capacity(s.len() + 8);
    for (i, c) in s.char_indices() {
        if c == '%' && b.get(i + 1).is_some_and(u8::is_ascii_hexdigit) && b.get(i + 2).is_some_and(u8::is_ascii_hexdigit) {
            t.push_str("%25");
        } else if ":*?\"<>|#\\".contains(c) {
            t.push_str(&format!("%{:02X}", c as u32));
        } else {
            t.push(c);
        }
    }
    if let Some(rest) = t.strip_prefix('.') {
        t = format!("%2E{rest}");
    }
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
        "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    // Windows' reserved names, in any case (con, Nul, COM1…), as Logseq does
    if RESERVED.contains(&t.to_ascii_uppercase().as_str()) || t.ends_with('.') {
        t.push('/');
    }
    t.replace("___", "%5F%5F%5F").replace("_/", "%5F/").replace("/_", "/%5F").replace('/', "___")
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

//! Quick capture, the Logseq way: fill `:quick-capture-templates` ({time} {date} {text} {url})
//! and add the result as a new bullet to today's journal or the default page.
//! Used by the app, by `lean-outliner --capture` on Windows; the Android widget mirrors it.

use crate::config::Config;
use crate::date::Date;

/// First web address in `s`, and the rest of the text without it.
pub fn split_url(s: &str) -> (String, String) {
    let start = ["https://", "http://"].iter().filter_map(|p| s.find(p)).min();
    match start {
        None => (s.trim().to_string(), String::new()),
        Some(i) => {
            let end = s[i..].find(char::is_whitespace).map_or(s.len(), |e| i + e);
            let url = s[i..end].trim_end_matches(['.', ',', ';', ')', '"', '\'']).to_string();
            let rest = format!("{}{}", &s[..i], &s[i + url.len()..]);
            let rest = rest.trim().trim_end_matches([':', '-', '—', '|']).trim().to_string();
            (rest, url)
        }
    }
}

/// Words that only join a value to the text before it ("… from {url}"): they go when the
/// value is empty, so a note without a web address doesn't end in "from".
const JOINERS: [&str; 9] = ["from", "via", "at", "on", "-", "–", "—", "|", "·"];

/// Fill a capture template. Empty values take one neighbouring space with them (and a
/// joining word in front, see JOINERS).
pub fn fill(template: &str, text: &str, url: &str, time: &str, date: &str) -> String {
    let mut out = template.to_string();
    for (k, v) in [("{time}", time), ("{date}", date), ("{text}", text.trim()), ("{url}", url.trim())] {
        if v.is_empty() {
            for j in JOINERS {
                out = out.replace(&format!(" {j} {k}"), "");
            }
            out = out.replace(&format!(" {k}"), "").replace(&format!("{k} "), "").replace(k, "");
        }
    }
    // values go in last, so text that happens to contain "{url}" stays as typed
    let mut res = String::with_capacity(out.len() + text.len() + url.len());
    let mut rest = out.as_str();
    while let Some(i) = rest.find('{') {
        res.push_str(&rest[..i]);
        let tail = &rest[i..];
        let hit = [("{time}", time), ("{date}", date), ("{text}", text.trim()), ("{url}", url.trim())]
            .into_iter()
            .find(|(k, _)| tail.starts_with(k));
        match hit {
            Some((k, v)) => {
                res.push_str(v);
                rest = &tail[k.len()..];
            }
            None => {
                res.push('{');
                rest = &tail[1..];
            }
        }
    }
    res.push_str(rest);
    res.trim().to_string()
}

/// "14:05" from hours and minutes.
pub fn hhmm(h: u32, m: u32) -> String {
    format!("{h:02}:{m:02}")
}

/// Vault-relative file a capture goes to (today's journal, or the default page).
pub fn target(cfg: &Config, today: Date) -> String {
    if cfg.capture_today {
        cfg.journal_rel_path(today)
    } else {
        format!("{}/{}.md", cfg.pages_dir, crate::file_stem_for(&cfg.capture_page))
    }
}

/// The bullet text for shared content.
pub fn bullet(cfg: &Config, text: &str, url: &str, media: bool, today: Date, time: &str) -> String {
    let (t, u) = if url.is_empty() && !media { split_url(text) } else { (text.trim().to_string(), url.to_string()) };
    let tpl = if media { &cfg.capture_media } else { &cfg.capture_text };
    fill(tpl, &t, &u, time, &cfg.journal_title(today))
}

/// Add a capture to a vault without loading its index (used by `--capture`): reads
/// config.edn, appends to the right file with a temp-file-then-rename write.
/// Returns the vault-relative path written.
pub fn capture_to_vault(root: &std::path::Path, text: &str, url: &str, today: Date, time: &str) -> Result<String, String> {
    // only a missing config.edn means "Logseq's defaults"; any other read problem stops the capture
    let cfg = match std::fs::read_to_string(root.join("logseq").join("config.edn")) {
        Ok(t) => Config::from_edn(&t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Config::default(),
        Err(e) => return Err(format!("Couldn't read logseq/config.edn ({e}), so nothing was added.")),
    };
    let mut rel = target(&cfg, today);
    if !cfg.capture_today {
        // reuse an existing page file whose name differs only in case
        let dir = root.join(&cfg.pages_dir);
        let want = crate::key(&crate::file_stem_for(&cfg.capture_page));
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.strip_suffix(".md").is_some_and(|s| crate::key(s) == want) {
                    rel = format!("{}/{}", cfg.pages_dir, n);
                    break;
                }
            }
        }
    }
    let line = bullet(&cfg, text, url, false, today, time);
    if line.is_empty() {
        return Err("Nothing to add.".into());
    }
    let path = root.join(&rel);
    // Only a file that isn't there yet starts empty. Any other read problem (e.g. Google Drive
    // can't fetch the file right now) must never turn into "write just this one line over it".
    let cur = match std::fs::read(&path) {
        Ok(b) => String::from_utf8(b).map_err(|_| "That file isn't plain UTF-8 text, so nothing was added.".to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("Couldn't read {rel} ({e}), so nothing was added. Try again in a moment.")),
    };
    let out = crate::append_bullet(&cur, &line);
    crate::app::write_atomic(&path, &out)?;
    Ok(rel)
}

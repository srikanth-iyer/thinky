//! A small problems log the user can read and copy in Settings. Capped, so it never grows.

use std::sync::Mutex;

const FILE: &str = "problems.log";
const MAX: usize = 64 * 1024;
/// Kept in memory too, for the dev server / tests (no cache folder there).
static MEM: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// "2026-10-26 00:41:03 UTC" for now.
pub fn now_utc() -> String {
    let secs = crate::app::now_secs() as i64;
    let (y, m, d) = crate::date::civil_from_days(secs.div_euclid(86400));
    let t = secs.rem_euclid(86400);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC", t / 3600, t / 60 % 60, t % 60)
}

/// Add one line to the log.
pub fn record(msg: &str) {
    let line = format!("{}  {}\n", now_utc(), msg.replace('\n', " ⏎ "));
    let mut mem = MEM.lock().unwrap_or_else(|p| p.into_inner());
    mem.push(line.clone());
    if mem.len() > 200 {
        mem.remove(0);
    }
    let Some(dir) = crate::app::cache_dir() else { return };
    let p = dir.join(FILE);
    let mut text = std::fs::read_to_string(&p).unwrap_or_default();
    text.push_str(&line);
    if text.len() > MAX {
        // keep the newer half, starting at a line
        let mut cut = text.len() - MAX / 2;
        while !text.is_char_boundary(cut) {
            cut += 1;
        }
        let from = text[cut..].find('\n').map_or(cut, |i| cut + i + 1);
        text = text[from..].to_string();
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&p, text);
}

pub fn read() -> String {
    match crate::app::cache_dir() {
        Some(dir) => std::fs::read_to_string(dir.join(FILE)).unwrap_or_default(),
        None => MEM.lock().unwrap_or_else(|p| p.into_inner()).concat(),
    }
}

pub fn clear() {
    MEM.lock().unwrap_or_else(|p| p.into_inner()).clear();
    if let Some(dir) = crate::app::cache_dir() {
        let _ = std::fs::remove_file(dir.join(FILE));
    }
}

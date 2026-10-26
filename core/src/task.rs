//! Logseq to-dos: `TODO`/`DOING`/`LATER`/`NOW`/`WAITING`/`DONE`/`CANCELED` markers,
//! `[#A]` priorities, and `SCHEDULED: <2026-10-26 Mon>` / `DEADLINE: <…>` dates
//! (optionally with a time and a repeater such as `.+1d`, `++1w`, `+1m`).

use crate::date::{self, Date};
use serde::Serialize;

pub const MARKERS: [&str; 11] =
    ["TODO", "DOING", "DONE", "LATER", "NOW", "WAITING", "WAIT", "CANCELED", "CANCELLED", "IN-PROGRESS", "STARTED"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct When {
    pub date: Date,
    /// "10:00" when the timestamp has a time.
    pub time: Option<String>,
    /// Repeater, e.g. ".+1d", "++1w", "+2m".
    pub repeat: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Task {
    pub marker: String,
    /// 'A', 'B' or 'C'.
    pub priority: Option<char>,
    pub scheduled: Option<When>,
    pub deadline: Option<When>,
}

impl Task {
    pub fn is_open(&self) -> bool {
        !matches!(self.marker.as_str(), "DONE" | "CANCELED" | "CANCELLED")
    }
}

/// The marker at the start of a block's text, if any ("TODO", …).
pub fn marker(text: &str) -> Option<&'static str> {
    MARKERS.iter().copied().find(|m| {
        text.strip_prefix(m).is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '\n', '\r', '\t']))
    })
}

/// To-do details of a block (its editable text, property lines included), or None.
pub fn parse(text: &str) -> Option<Task> {
    let m = marker(text)?;
    let first = text.split('\n').next().unwrap_or("");
    let priority = first.find("[#").and_then(|i| {
        let b = first.as_bytes();
        let p = *b.get(i + 2)?;
        (b.get(i + 3) == Some(&b']') && p.is_ascii_alphabetic()).then(|| p.to_ascii_uppercase() as char)
    });
    let mut t = Task { marker: m.to_string(), priority, scheduled: None, deadline: None };
    for l in text.split('\n').skip(1) {
        let l = l.trim();
        if let Some(r) = l.strip_prefix("SCHEDULED:") {
            t.scheduled = timestamp(r);
        } else if let Some(r) = l.strip_prefix("DEADLINE:") {
            t.deadline = timestamp(r);
        }
    }
    Some(t)
}

/// `<2026-10-26 Mon 10:00 .+1d>` → When.
pub fn timestamp(s: &str) -> Option<When> {
    let s = s.trim();
    let inner = s.strip_prefix('<')?;
    let inner = &inner[..inner.find('>')?];
    let mut parts = inner.split_whitespace();
    let d = parts.next()?;
    let mut nums = d.splitn(3, '-');
    let y: i32 = nums.next()?.parse().ok()?;
    let m: u32 = nums.next()?.parse().ok()?;
    let dd: u32 = nums.next()?.parse().ok()?;
    if !date::valid((y, m, dd)) {
        return None;
    }
    let mut w = When { date: (y, m, dd), time: None, repeat: None };
    for p in parts {
        if p.contains(':') && p.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            w.time = Some(p.to_string());
        } else if p.starts_with('+') || p.starts_with(".+") {
            w.repeat = Some(p.to_string());
        }
    }
    Some(w)
}

/// Logseq timestamp text for a When.
pub fn timestamp_text(w: &When) -> String {
    let mut s = format!("<{}", date::stamp(w.date));
    if let Some(t) = &w.time {
        s.push(' ');
        s.push_str(t);
    }
    if let Some(r) = &w.repeat {
        s.push(' ');
        s.push_str(r);
    }
    s.push('>');
    s
}

/// Next date of a repeating timestamp after it was done on `today`:
/// `+n` adds once, `++n` adds until after today, `.+n` counts from today.
pub fn next_repeat(w: &When, today: Date) -> Option<Date> {
    let r = w.repeat.as_deref()?;
    let (kind, rest) = if let Some(x) = r.strip_prefix(".+") {
        ('.', x)
    } else if let Some(x) = r.strip_prefix("++") {
        ('+', x)
    } else {
        ('1', r.strip_prefix('+')?)
    };
    let unit = rest.chars().last()?;
    let n: i64 = rest[..rest.len() - unit.len_utf8()].parse().ok()?;
    if n <= 0 {
        return None;
    }
    // k steps from `from` (months are counted from the start date, so Jan 31 stays the 31st)
    let steps = |from: Date, k: i64| -> Option<Date> {
        Some(match unit {
            'h' => from, // hours: the date doesn't move
            'd' => date::add_days(from, n * k),
            'w' => date::add_days(from, 7 * n * k),
            'm' => date::add_months(from, n * k),
            'y' => date::add_months(from, 12 * n * k),
            _ => return None,
        })
    };
    match kind {
        '.' => steps(today, 1),
        '+' => {
            let mut k = 1;
            let mut d = steps(w.date, k)?;
            while date::days_from_civil(d) <= date::days_from_civil(today) && k < 100_000 && unit != 'h' {
                k += 1;
                d = steps(w.date, k)?;
            }
            Some(d)
        }
        _ => steps(w.date, 1),
    }
}

/// Mark a block's text done (or cycle a repeating task): returns the new text.
/// A repeating task goes back to its open marker with its dates moved on, like Logseq.
pub fn complete(text: &str, today: Date) -> String {
    let Some(t) = parse(text) else { return text.to_string() };
    let rest = &text[t.marker.len()..];
    let repeating = [&t.scheduled, &t.deadline].iter().any(|w| w.as_ref().is_some_and(|w| w.repeat.is_some()));
    if !repeating {
        return format!("DONE{rest}");
    }
    let open = if matches!(t.marker.as_str(), "LATER" | "NOW") { "LATER" } else { "TODO" };
    let mut out: Vec<String> = vec![];
    for (i, l) in format!("{open}{rest}").split('\n').enumerate() {
        let trimmed = l.trim_start();
        let lead = &l[..l.len() - trimmed.len()];
        let moved = ["SCHEDULED:", "DEADLINE:"].iter().find_map(|k| {
            let r = trimmed.strip_prefix(k)?;
            let mut w = timestamp(r)?;
            w.date = next_repeat(&w, today)?;
            Some(format!("{lead}{k} {}", timestamp_text(&w)))
        });
        out.push(if i > 0 { moved.unwrap_or_else(|| l.to_string()) } else { l.to_string() });
    }
    out.join("\n")
}

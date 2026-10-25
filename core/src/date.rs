//! Minimal date-fns-style formatting/parsing for journal titles and file names.
//! Tokens: yyyy yy MMMM MMM MM M do dd d EEEE EEE EE E. Anything else is literal;
//! text in single quotes is literal too.

pub type Date = (i32, u32, u32);

const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];
const DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKENS: [&str; 13] = ["yyyy", "yy", "MMMM", "MMM", "MM", "M", "do", "dd", "d", "EEEE", "EEE", "EE", "E"];

#[derive(Debug, PartialEq)]
enum Tok {
    T(&'static str),
    Lit(String),
}

fn tokenize(fmt: &str) -> Vec<Tok> {
    let mut out = vec![];
    let mut i = 0;
    let b = fmt.as_bytes();
    while i < b.len() {
        if b[i] == b'\'' {
            let end = fmt[i + 1..].find('\'').map(|e| i + 1 + e).unwrap_or(b.len());
            out.push(Tok::Lit(fmt[i + 1..end].to_string()));
            i = end + 1;
            continue;
        }
        if let Some(t) = TOKENS.iter().find(|t| fmt[i..].starts_with(**t)) {
            out.push(Tok::T(t));
            i += t.len();
            continue;
        }
        let ch = fmt[i..].chars().next().unwrap();
        match out.last_mut() {
            Some(Tok::Lit(s)) => s.push(ch),
            _ => out.push(Tok::Lit(ch.to_string())),
        }
        i += ch.len_utf8();
    }
    out
}

pub fn ordinal(d: u32) -> String {
    let suf = match (d % 10, d % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("{d}{suf}")
}

/// 0 = Sunday (Sakamoto's method).
pub fn weekday((y, m, d): Date) -> usize {
    const T: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    ((y + y / 4 - y / 100 + y / 400 + T[(m - 1) as usize] + d as i32).rem_euclid(7)) as usize
}

pub fn format(fmt: &str, date: Date) -> String {
    let (y, m, d) = date;
    let mi = (m.clamp(1, 12) - 1) as usize;
    let mut s = String::new();
    for t in tokenize(fmt) {
        match t {
            Tok::Lit(l) => s.push_str(&l),
            Tok::T("yyyy") => s.push_str(&format!("{y:04}")),
            Tok::T("yy") => s.push_str(&format!("{:02}", y % 100)),
            Tok::T("MMMM") => s.push_str(MONTHS[mi]),
            Tok::T("MMM") => s.push_str(&MONTHS[mi][..3]),
            Tok::T("MM") => s.push_str(&format!("{m:02}")),
            Tok::T("M") => s.push_str(&m.to_string()),
            Tok::T("do") => s.push_str(&ordinal(d)),
            Tok::T("dd") => s.push_str(&format!("{d:02}")),
            Tok::T("d") => s.push_str(&d.to_string()),
            Tok::T("EEEE") => s.push_str(DAYS[weekday(date)]),
            Tok::T(_) => s.push_str(&DAYS[weekday(date)][..3]),
        }
    }
    s
}

fn digits(s: &str, min: usize, max: usize) -> Option<(u32, usize)> {
    let n = s.bytes().take(max).take_while(u8::is_ascii_digit).count();
    (n >= min).then(|| (s[..n].parse().unwrap(), n))
}

fn name<'a>(s: &str, names: impl Iterator<Item = &'a str>, abbrev: bool) -> Option<(usize, usize)> {
    for (i, n) in names.enumerate() {
        let n = if abbrev { &n[..3] } else { n };
        // `get` (not `[..]`): the cut may fall inside a multi-byte character, e.g. "📚 Pantry".
        if s.get(..n.len()).is_some_and(|head| head.eq_ignore_ascii_case(n)) {
            return Some((i, n.len()));
        }
    }
    None
}

/// Parse `s` with `fmt`; the whole string must match.
pub fn parse(fmt: &str, s: &str) -> Option<Date> {
    let (mut y, mut m, mut d) = (None, None, None);
    let mut rest = s.trim();
    for t in tokenize(fmt) {
        match t {
            Tok::Lit(l) => rest = rest.strip_prefix(l.as_str())?,
            Tok::T("yyyy") => {
                let (v, n) = digits(rest, 4, 4)?;
                y = Some(v as i32);
                rest = &rest[n..];
            }
            Tok::T("yy") => {
                let (v, n) = digits(rest, 2, 2)?;
                y = Some(2000 + v as i32);
                rest = &rest[n..];
            }
            Tok::T("MMMM") => {
                let (i, n) = name(rest, MONTHS.iter().copied(), false)?;
                m = Some(i as u32 + 1);
                rest = &rest[n..];
            }
            Tok::T("MMM") => {
                let (i, n) = name(rest, MONTHS.iter().copied(), true)?;
                m = Some(i as u32 + 1);
                rest = &rest[n..];
            }
            Tok::T("MM") | Tok::T("M") => {
                let (v, n) = digits(rest, 1, 2)?;
                m = Some(v);
                rest = &rest[n..];
            }
            Tok::T("do") => {
                let (v, n) = digits(rest, 1, 2)?;
                d = Some(v);
                rest = &rest[n..];
                let suf: String = rest.chars().take(2).collect();
                if ["st", "nd", "rd", "th"].contains(&suf.to_lowercase().as_str()) {
                    rest = &rest[2..];
                }
            }
            Tok::T("dd") | Tok::T("d") => {
                let (v, n) = digits(rest, 1, 2)?;
                d = Some(v);
                rest = &rest[n..];
            }
            Tok::T("EEEE") => rest = &rest[name(rest, DAYS.iter().copied(), false)?.1..],
            Tok::T(_) => rest = &rest[name(rest, DAYS.iter().copied(), true)?.1..],
        }
    }
    let date = (y?, m?, d?);
    (rest.is_empty() && (1..=12).contains(&date.1) && (1..=31).contains(&date.2)).then_some(date)
}

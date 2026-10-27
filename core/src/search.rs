//! Search rules (the Ctrl+K box), as Logseq does it: the words of a search may come in any order
//! ("recipe dumplings" finds "Dumplings recipe"), capitals and accents don't count ("cremerie" finds
//! "Crémerie"), and in page names a letter or two off is forgiven ("dmplings recpie" finds
//! "Dumplings recipe"). Pure functions; `Vault::search` runs them over the index.
//!
//! The app's window marks the words it finds the same way (`fold` in ui/search.js mirrors `fold`).

/// What each of U+00E0..=U+00FF (small Latin-1 letters) becomes without its accent ('-' = itself).
const LATIN1: &[u8; 32] = b"aaaaaa-ceeeeiiii-nooooo-ouuuuy-y";
/// The same for U+0100..=U+017F (Latin Extended-A, capitals and small letters in pairs).
const LATIN_A: &[u8; 128] =
    b"aaaaaaccccccccddddeeeeeeeeeegggggggghhhhiiiiiiiiii--jjkkkllllllllllnnnnnnnnnoooooo--rrrrrrssssssssttttttuuuuuuuuuuuuwwyyyzzzzzzs";

/// One small letter without its accent; None for a combining accent (dropped).
fn plain(c: char) -> Option<char> {
    let n = c as u32;
    let from = |t: &[u8], i: u32| match t[i as usize] {
        b'-' => c,
        b => b as char,
    };
    match n {
        0x300..=0x36F => None,
        0xE0..=0xFF => Some(from(LATIN1, n - 0xE0)),
        0x100..=0x17F => Some(from(LATIN_A, n - 0x100)),
        _ => Some(c),
    }
}

/// Each char of `c` folded (small letters, no accents): none, one or more chars.
fn fold_char(c: char, mut out: impl FnMut(char)) {
    if c.is_ascii() {
        out(c.to_ascii_lowercase());
        return;
    }
    for l in c.to_lowercase() {
        if let Some(p) = plain(l) {
            out(p);
        }
    }
}

/// Small letters, accents dropped: "Crémerie" → "cremerie".
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        fold_char(c, |f| out.push(f));
    }
    out
}

/// `fold`, as chars, with the place (in chars) in `s` each folded char came from.
pub fn fold_map(s: &str) -> (Vec<char>, Vec<usize>) {
    let (mut chars, mut from) = (vec![], vec![]);
    for (k, c) in s.chars().enumerate() {
        fold_char(c, |f| {
            chars.push(f);
            from.push(k);
        });
    }
    (chars, from)
}

/// A note's words as searched: folded, without the lines the app never shows (`id::`, `collapsed::`).
pub fn fold_note(text: &str) -> Box<str> {
    let mut out = String::with_capacity(text.len());
    for line in text.split('\n') {
        let t = line.trim_start();
        if t.starts_with("id::") || t.starts_with("collapsed::") {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        for c in line.chars() {
            fold_char(c, |f| out.push(f));
        }
    }
    out.into_boxed_str()
}

/// The words of a search, folded, each once, in the order typed.
pub fn query_words(q: &str) -> Vec<String> {
    let mut v: Vec<String> = vec![];
    for w in fold(q).split_whitespace() {
        if !v.iter().any(|x| x == w) {
            v.push(w.to_string());
        }
    }
    v
}

/// How many letters may be off in a word of `n` letters (page names only): none in short words,
/// one from 5 letters, two from 8.
pub fn allowed_typos(n: usize) -> usize {
    match n {
        0..=4 => 0,
        5..=7 => 1,
        _ => 2,
    }
}

/// The fewest edits (a letter added, dropped or changed, or two side by side swapped) that turn
/// `w` into the start of `word`, if at most `max`: (edits, how many letters of `word` that start
/// has). The start may be the whole word; a word still being typed matches the start of a longer one.
pub fn prefix_distance(w: &[char], word: &[char], max: usize) -> Option<(usize, usize)> {
    let (n, m) = (w.len(), word.len());
    if n == 0 || n > 40 || m > 60 || m + max < n {
        return None;
    }
    let cols = m + 1;
    let mut d = vec![0usize; (n + 1) * cols];
    for j in 0..=m {
        d[j] = j;
    }
    for i in 1..=n {
        d[i * cols] = i;
        let mut row_min = i;
        for j in 1..=m {
            let cost = usize::from(w[i - 1] != word[j - 1]);
            let mut v = (d[(i - 1) * cols + j] + 1).min(d[i * cols + j - 1] + 1).min(d[(i - 1) * cols + j - 1] + cost);
            if i > 1 && j > 1 && w[i - 1] == word[j - 2] && w[i - 2] == word[j - 1] {
                v = v.min(d[(i - 2) * cols + j - 2] + 1);
            }
            d[i * cols + j] = v;
            row_min = row_min.min(v);
        }
        if row_min > max {
            return None; // (every way on is worse)
        }
    }
    let lo = n.saturating_sub(max);
    let hi = m.min(n + max);
    let mut best: Option<(usize, usize)> = None;
    for j in lo..=hi {
        let v = d[n * cols + j];
        // fewest edits; of those, the longest start (it marks more of the word)
        if v <= max && best.map_or(true, |(b, _)| v <= b) {
            best = Some((v, j));
        }
    }
    best
}

/// How well a page name matches: lower is better (sort by it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct NameRank {
    /// 0 the name is the search; 1 it starts with it; 2 it has the words together, in order;
    /// 3 it has every word, in any order; 4 some only with a typo.
    pub tier: u8,
    /// Letters off, over all words.
    pub typos: usize,
    /// Words found only inside a word of the name (not at its start).
    pub inside: usize,
}

/// Does page name `name` match the search (`words` from `query_words`, `phrase` = them joined by
/// spaces)? Every word must be in the name (any order), or, from 5 letters, at the start of one of
/// its words with a letter or two off. Returns the rank and the places to mark in `name` (in chars,
/// start and end, in order, not overlapping).
pub fn match_name(name: &str, words: &[String], phrase: &str) -> Option<(NameRank, Vec<(usize, usize)>)> {
    let (s, from) = fold_map(name);
    let at_start = |i: usize| i == 0 || !s[i - 1].is_alphanumeric();
    let find = |w: &[char]| -> Option<usize> {
        // the first place at the start of a word, else the first place at all
        let mut first = None;
        for i in 0..s.len().saturating_sub(w.len() - 1) {
            if s[i..i + w.len()] == *w {
                if at_start(i) {
                    return Some(i);
                }
                first.get_or_insert(i);
            }
        }
        first
    };
    let mut marks: Vec<(usize, usize)> = vec![];
    let ph: Vec<char> = phrase.chars().collect();
    let tier;
    let (mut typos, mut inside) = (0, 0);
    if s == ph {
        tier = 0;
        marks.push((0, s.len()));
    } else if s.starts_with(&ph) {
        tier = 1;
        marks.push((0, ph.len()));
    } else if let Some(i) = find(&ph) {
        tier = 2;
        inside = usize::from(!at_start(i));
        marks.push((i, i + ph.len()));
    } else {
        // the name's words, for typos: (start, end) of each run of letters and digits
        let mut runs: Vec<(usize, usize)> = vec![];
        let mut k = 0;
        while k < s.len() {
            if s[k].is_alphanumeric() {
                let a = k;
                while k < s.len() && s[k].is_alphanumeric() {
                    k += 1;
                }
                runs.push((a, k));
            } else {
                k += 1;
            }
        }
        for w in words {
            let w: Vec<char> = w.chars().collect();
            if let Some(i) = find(&w) {
                inside += usize::from(!at_start(i));
                marks.push((i, i + w.len()));
                continue;
            }
            let max = allowed_typos(w.len());
            if max == 0 {
                return None;
            }
            let best = runs
                .iter()
                .filter_map(|&(a, b)| prefix_distance(&w, &s[a..b], max).map(|(e, len)| (e, a, a + len)))
                .min_by_key(|&(e, a, _)| (e, a))?;
            typos += best.0;
            marks.push((best.1, best.2));
        }
        tier = if typos > 0 { 4 } else { 3 };
    }
    // back to places in the name as written (folding may have dropped or added a char)
    let mut out: Vec<(usize, usize)> = marks
        .into_iter()
        .filter(|&(a, b)| b > a)
        .map(|(a, b)| (from[a], from[b - 1] + 1))
        .collect();
    out.sort();
    let mut merged: Vec<(usize, usize)> = vec![];
    for (a, b) in out {
        match merged.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ => merged.push((a, b)),
        }
    }
    Some((NameRank { tier, typos, inside }, merged))
}

/// Does a note match: is every word in its folded text (`fold_note`)? Higher is better: the words
/// together in the order typed count most, then each word found at the start of a word.
pub fn note_score(text: &str, words: &[String], phrase: &str) -> Option<u32> {
    let mut starts = 0;
    for w in words {
        let mut found = false;
        let mut start = false;
        for (i, _) in text.match_indices(w.as_str()).take(16) {
            found = true;
            if text[..i].chars().next_back().map_or(true, |c| !c.is_alphanumeric()) {
                start = true;
                break;
            }
        }
        if !found {
            return None;
        }
        starts += u32::from(start);
    }
    let together = words.len() > 1 && text.contains(phrase);
    Some(u32::from(together) * 100 + starts)
}

/// A note's text for its search result: all of it when short, else the lines around the first
/// line with a word of the search (whole lines, so links and formatting stay whole), and if that is
/// one very long line, the part of it around the word ("…" where cut).
pub fn note_excerpt(text: &str, words: &[String]) -> String {
    const MAX: usize = 600;
    if text.len() <= MAX {
        return text.to_string();
    }
    let lines: Vec<&str> = text.split('\n').collect();
    let has = |l: &str| {
        let f = fold(l);
        words.iter().any(|w| f.contains(w.as_str()))
    };
    let at = lines.iter().position(|l| has(l)).unwrap_or(0);
    let from = if at > 0 && lines[at - 1].len() < 200 { at - 1 } else { at };
    let mut out = String::new();
    for l in &lines[from..] {
        if !out.is_empty() && out.len() + l.len() > MAX {
            break;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(l);
    }
    if out.len() <= MAX * 2 {
        return out;
    }
    // one long line: about 150 letters before the word and 450 after it
    let (s, map) = fold_map(&out);
    let pos = words
        .iter()
        .filter_map(|w| {
            let w: Vec<char> = w.chars().collect();
            (0..s.len().saturating_sub(w.len().saturating_sub(1))).find(|&i| s[i..].starts_with(&w))
        })
        .min()
        .map_or(0, |i| map[i]);
    let chars: Vec<char> = out.chars().collect();
    let a = pos.saturating_sub(150);
    let b = (a + MAX).min(chars.len());
    let mut cut: String = chars[a..b].iter().collect();
    if a > 0 {
        cut.insert(0, '…');
    }
    if b < chars.len() {
        cut.push('…');
    }
    cut
}

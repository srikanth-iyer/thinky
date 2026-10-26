//! The "Add to journal" box's rules, without any drawing: what it starts with, when Enter adds a
//! note and when the box may close, the look's colours it is painted in, its sizes, the order of
//! the page list, and the few smooth shapes it paints. On Windows the box is a native window
//! (src-tauri/src/capture_box), which follows these rules; they are tested on any computer
//! (core/tests/capture_box.rs). The web box (ui/capture.js) has the same rules.

use serde_json::Value;
use std::path::Path;

// ----- the look's colours -----

/// The look's colours for the box, as 0xRRGGBB. The app saves them in its cache folder
/// (`look.txt`, the `save_look` command) whenever the look changes, as the box can't read the
/// app's CSS; without that file the box has the Calm look's light colours.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoxColors {
    pub surface: u32,
    pub surface2: u32,
    pub ink: u32,
    pub ink_soft: u32,
    pub ink_faint: u32,
    pub accent: u32,
    pub accent_ink: u32,
    pub line: u32,
    pub line_soft: u32,
    pub danger: u32,
}

/// The CSS tokens (without `--`) the box uses, in the file's order.
pub const COLOR_KEYS: [&str; 10] = ["surface", "surface-2", "ink", "ink-soft", "ink-faint", "accent", "accent-ink", "line", "line-soft", "danger"];
pub const LOOK_FILE: &str = "look.txt";

impl Default for BoxColors {
    /// Calm, the app's first look.
    fn default() -> Self {
        BoxColors {
            surface: 0xFFFFFF,
            surface2: 0xF7F8F6,
            ink: 0x1A2130,
            ink_soft: 0x535D6E,
            ink_faint: 0x8A93A2,
            accent: 0x0B7B66,
            accent_ink: 0xFFFFFF,
            line: 0xDFE3E0,
            line_soft: 0xECEFEC,
            danger: 0xB3412A,
        }
    }
}

impl BoxColors {
    fn slot(&mut self, key: &str) -> Option<&mut u32> {
        Some(match key {
            "surface" => &mut self.surface,
            "surface-2" => &mut self.surface2,
            "ink" => &mut self.ink,
            "ink-soft" => &mut self.ink_soft,
            "ink-faint" => &mut self.ink_faint,
            "accent" => &mut self.accent,
            "accent-ink" => &mut self.accent_ink,
            "line" => &mut self.line,
            "line-soft" => &mut self.line_soft,
            "danger" => &mut self.danger,
            _ => return None,
        })
    }

    /// Read `look.txt` (`key=#rrggbb` lines). Anything missing or unreadable keeps Calm's colour.
    pub fn parse(text: &str) -> BoxColors {
        let mut c = BoxColors::default();
        for l in text.lines() {
            let Some((k, v)) = l.split_once('=') else { continue };
            if let (Some(slot), Some(v)) = (c.slot(k.trim()), parse_hex(v.trim())) {
                *slot = v;
            }
        }
        c
    }

    pub fn to_text(&self, look: &str) -> String {
        let mut c = *self;
        let mut out = format!("# The look's colours for the Windows \"Add to journal\" box (written by Lean Outliner)\nlook={look}\n");
        for k in COLOR_KEYS {
            out.push_str(&format!("{k}=#{:06X}\n", c.slot(k).map_or(0, |v| *v)));
        }
        out
    }

    /// A dark look (light words on a dark page).
    pub fn dark(&self) -> bool {
        let (r, g, b) = ((self.surface >> 16) & 255, (self.surface >> 8) & 255, self.surface & 255);
        0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32 <= 128.0
    }
}

/// "#1a2b3c" or "#abc" → 0x1A2B3C.
pub fn parse_hex(s: &str) -> Option<u32> {
    let h = s.strip_prefix('#')?;
    if !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    match h.len() {
        6 => u32::from_str_radix(h, 16).ok(),
        3 => {
            let v = u32::from_str_radix(h, 16).ok()?;
            let (r, g, b) = ((v >> 8) & 15, (v >> 4) & 15, v & 15);
            Some(((r * 17) << 16) | ((g * 17) << 8) | (b * 17))
        }
        _ => None,
    }
}

/// The `save_look` command: keep the look's colours for the box in the cache folder. Writes only
/// when they changed (the app calls this at every start). `false` when there is no cache folder
/// (the dev server).
pub fn save_look(dir: Option<&Path>, look: &str, colors: &Value) -> Result<bool, String> {
    let Some(dir) = dir else { return Ok(false) };
    let mut c = BoxColors::default();
    for k in COLOR_KEYS {
        let v = colors.get(k).and_then(Value::as_str).and_then(parse_hex).ok_or_else(|| format!("missing or unreadable colour: {k}"))?;
        if let Some(slot) = c.slot(k) {
            *slot = v;
        }
    }
    let look: String = look.chars().filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-').take(40).collect();
    let text = c.to_text(&look);
    let path = dir.join(LOOK_FILE);
    if std::fs::read_to_string(&path).ok().as_deref() == Some(text.as_str()) {
        return Ok(true);
    }
    crate::app::write_atomic(&path, &text)?;
    Ok(true)
}

/// The colours saved by the app (Calm's when there are none).
pub fn load_colors(dir: Option<&Path>) -> BoxColors {
    dir.and_then(|d| std::fs::read_to_string(d.join(LOOK_FILE)).ok()).map_or_else(BoxColors::default, |t| BoxColors::parse(&t))
}

// ----- the words in the box -----

/// What the box starts with: the words from a browser link (its text and address, joined by a
/// space), or else the clipboard's text, with line breaks as `\n`. The second value says it came
/// from the clipboard (then clicking elsewhere with it untouched closes the box: it's still there).
pub fn prefill(link: Option<(&str, &str)>, clipboard: impl FnOnce() -> String) -> (String, bool) {
    match link {
        Some((text, url)) => ([text, url].into_iter().filter(|x| !x.trim().is_empty()).collect::<Vec<_>>().join(" ").replace("\r\n", "\n").replace('\r', "\n"), false),
        None => {
            let c = clipboard();
            (if c.trim().is_empty() { String::new() } else { from_crlf(&c) }, true)
        }
    }
}

/// Line breaks as `\n` (the Windows text box gives `\r\n`).
pub fn from_crlf(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

/// Line breaks as `\r\n` (what the Windows text box needs to show them).
pub fn to_crlf(s: &str) -> String {
    from_crlf(s).replace('\n', "\r\n")
}

#[derive(PartialEq, Clone, Copy)]
enum Kind {
    Space,
    Word,
    Mark,
}

fn kind(c: char) -> Kind {
    if c.is_whitespace() {
        Kind::Space
    } else if c.is_alphanumeric() || c == '_' || c == '\'' || c == '’' {
        Kind::Word
    } else {
        Kind::Mark
    }
}

fn chars16(t: &[u16]) -> Vec<(usize, char)> {
    let mut at = 0;
    char::decode_utf16(t.iter().copied())
        .map(|r| {
            let c = r.unwrap_or('\u{FFFD}');
            let here = at;
            at += c.len_utf16();
            (here, c)
        })
        .collect()
}

/// Ctrl+Backspace: where the word before `at` starts (UTF-16 positions, as the text box counts):
/// spaces first, then one word (or a run of punctuation).
pub fn word_before(t: &[u16], at: usize) -> usize {
    let cs = chars16(t);
    let mut i = cs.iter().position(|&(o, _)| o >= at).unwrap_or(cs.len());
    while i > 0 && kind(cs[i - 1].1) == Kind::Space {
        i -= 1;
    }
    if i > 0 {
        let k = kind(cs[i - 1].1);
        while i > 0 && kind(cs[i - 1].1) == k {
            i -= 1;
        }
    }
    cs.get(i).map_or(t.len(), |&(o, _)| o)
}

/// Ctrl+Delete: where the word after `at` ends (one word or punctuation run, then its spaces).
pub fn word_after(t: &[u16], at: usize) -> usize {
    let cs = chars16(t);
    let mut i = cs.iter().position(|&(o, _)| o >= at).unwrap_or(cs.len());
    if i < cs.len() && kind(cs[i].1) != Kind::Space {
        let k = kind(cs[i].1);
        while i < cs.len() && kind(cs[i].1) == k {
            i += 1;
        }
    }
    while i < cs.len() && kind(cs[i].1) == Kind::Space && cs[i].1 != '\n' && cs[i].1 != '\r' {
        i += 1;
    }
    cs.get(i).map_or(t.len(), |&(o, _)| o)
}

// ----- when it adds and when it closes -----

/// Enter is ignored this long after the box is ready: it takes the keyboard when it pops up, so
/// an Enter meant for another window must not add a note (this really happened).
pub const GUARD_MS: u64 = 500;
/// The box closes this long after showing "✓ Added to …".
pub const CLOSE_AFTER_ADD_MS: u32 = 650;
/// The text box grows to this many lines, then scrolls.
pub const MAX_LINES: i32 = 6;
/// Rows of the page list shown at once.
pub const LIST_ROWS: i32 = 7;

/// What Enter does.
#[derive(Debug, PartialEq, Eq)]
pub enum Enter {
    /// nothing (too soon after it appeared, or a note is already being added)
    Ignore,
    /// nothing typed: close the box
    Close,
    /// add this note (trimmed); the box waits for it
    Add(String),
}

/// The box's moments: ready (shown, its words filled in), had the keyboard, adding a note, added.
#[derive(Debug, Default)]
pub struct Rules {
    ready_at: Option<u64>,
    had_focus: bool,
    busy: bool,
    added: bool,
    from_clipboard: Option<String>,
}

impl Rules {
    /// `prefill` as `prefill()` gave it.
    pub fn new(prefill: &str, from_clipboard: bool) -> Rules {
        Rules { from_clipboard: from_clipboard.then(|| prefill.to_string()), ..Default::default() }
    }
    /// Shown, with its words in (milliseconds on any steady clock).
    pub fn ready(&mut self, now_ms: u64) {
        self.ready_at = Some(now_ms);
    }
    pub fn is_ready(&self) -> bool {
        self.ready_at.is_some()
    }
    /// It had the keyboard at least once (only then does losing it mean "clicked elsewhere").
    pub fn focused(&mut self) {
        self.had_focus = true;
    }
    /// Not ready, or within half a second of being ready or brought forward (`ready` again): an
    /// Enter now was meant for another window (the browser's "Open Lean Outliner?" prompt).
    pub fn too_soon(&self, now_ms: u64) -> bool {
        self.ready_at.is_none_or(|t| now_ms.saturating_sub(t) < GUARD_MS)
    }
    /// Enter pressed with `text` in the box (line breaks as `\n`).
    pub fn enter(&mut self, now_ms: u64, text: &str) -> Enter {
        if self.too_soon(now_ms) {
            return Enter::Ignore;
        }
        if self.busy {
            return Enter::Ignore;
        }
        let t = text.trim();
        if t.is_empty() {
            return Enter::Close;
        }
        self.busy = true;
        Enter::Add(t.to_string())
    }
    /// The note is in: the box closes by itself soon (and stays busy until then).
    pub fn added(&mut self) {
        self.added = true;
    }
    /// The note couldn't be added: the text is editable again and Enter tries again.
    pub fn failed(&mut self) {
        self.busy = false;
    }
    /// A note is being added (or was just added): the text can't change and nothing closes it.
    pub fn busy(&self) -> bool {
        self.busy
    }
    pub fn is_added(&self) -> bool {
        self.added
    }
    /// Esc, × and Alt+F4 close it, but not while a note is being added (that would cut the
    /// writing short).
    pub fn may_close(&self) -> bool {
        !self.busy
    }
    /// Nothing new in the box: it's empty, or still just the clipboard's text (which is still on
    /// the clipboard).
    pub fn untouched(&self, text: &str) -> bool {
        text.trim().is_empty() || self.from_clipboard.as_deref() == Some(text)
    }
    /// Clicked somewhere else: only a box with nothing new in it goes away (`untouched`). One with
    /// typing, or with words from a web page, stays, so nothing is lost. Not before it was ready
    /// and had the keyboard.
    pub fn close_on_blur(&self, text: &str) -> bool {
        self.ready_at.is_some() && self.had_focus && !self.busy && self.untouched(text)
    }
    /// Words from a second press of the shortcut or the browser button while the box is open (it
    /// is brought forward instead of a second box opening): they take the place of a box with
    /// nothing new in it (all selected, as when it opens), else go on a line of their own at the
    /// end. Returns the new text and whether it's all selected; None: nothing changes.
    pub fn more_words(&mut self, text: &str, words: &str) -> Option<(String, bool)> {
        let words = from_crlf(words);
        if words.trim().is_empty() || self.busy {
            return None;
        }
        if self.untouched(text) {
            self.from_clipboard = None; // words from a web page now: they stay
            return Some((words, true));
        }
        Some((format!("{}\n{words}", text.trim_end()), false))
    }
}

/// How long a second box waits for the open one to take its words (milliseconds).
pub const HANDOVER_MS: u32 = 2000;

/// The words a second box hands to the open one, with when they were sent (a system-wide clock
/// in milliseconds): the open box drops words that come after the sender stopped waiting (it
/// opened a box of its own by then).
pub fn pack_words(sent_ms: u64, words: &str) -> Vec<u8> {
    let mut b = sent_ms.to_le_bytes().to_vec();
    for u in words.encode_utf16() {
        b.extend_from_slice(&u.to_le_bytes());
    }
    b
}

/// The words in `pack_words`'s bytes, if they're whole and came in time (`now_ms` on the same
/// clock); None: drop them (the sender gave up, or they're damaged).
pub fn unpack_words(b: &[u8], now_ms: u64) -> Option<String> {
    if b.len() < 8 || !b.len().is_multiple_of(2) {
        return None;
    }
    let sent = u64::from_le_bytes(b[..8].try_into().ok()?);
    if now_ms.saturating_sub(sent) >= (HANDOVER_MS - 300) as u64 {
        return None;
    }
    let units: Vec<u16> = b[8..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    Some(String::from_utf16_lossy(&units))
}

/// `text` with each `from` replaced by its `to`, all in one go (a `to` that is another pair's
/// `from` isn't replaced again): the capture box's links once their files are saved, when a
/// planned name was taken meanwhile.
pub fn swap_all(text: &str, pairs: &[(String, String)]) -> String {
    let pairs: Vec<&(String, String)> = pairs.iter().filter(|(f, t)| !f.is_empty() && f != t).collect();
    if pairs.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    'next: while let Some(c) = rest.chars().next() {
        for (from, to) in &pairs {
            if let Some(after) = rest.strip_prefix(from.as_str()) {
                out.push_str(to);
                rest = after;
                continue 'next;
            }
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

// ----- sizes -----

/// A rectangle in device pixels (right and bottom edges outside).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rect {
    pub l: i32,
    pub t: i32,
    pub r: i32,
    pub b: i32,
}

impl Rect {
    pub fn new(l: i32, t: i32, r: i32, b: i32) -> Rect {
        Rect { l, t, r, b }
    }
    pub fn w(&self) -> i32 {
        self.r - self.l
    }
    pub fn h(&self) -> i32 {
        self.b - self.t
    }
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.l && x < self.r && y >= self.t && y < self.b
    }
    pub fn is_empty(&self) -> bool {
        self.r <= self.l || self.b <= self.t
    }
}

/// What the layout depends on, in device pixels unless said otherwise.
#[derive(Debug, Clone, Copy)]
pub struct Metrics {
    /// the screen's scale (DPI / 96)
    pub scale: f32,
    /// one line of the note's text box (its font)
    pub line_h: i32,
    /// lines of text in the note (shown up to MAX_LINES, then it scrolls)
    pub lines: i32,
    /// width of the to-do mark (0: not a to-do)
    pub pill_w: i32,
    /// rows of the page list (0: the list is closed)
    pub rows: i32,
    /// one line of the page list's text (its font)
    pub list_line_h: i32,
    /// height of the footer's message (one line, or an error over several)
    pub foot_h: i32,
}

/// Where everything goes, in device pixels from the box's top left corner. Sizes are those of the
/// web box (ui/capture.html) in CSS pixels, times the scale: 640 wide, 98 tall with one line.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Layout {
    pub w: i32,
    pub h: i32,
    /// the "+" button
    pub tile: Rect,
    /// the to-do mark (empty when off)
    pub pill: Rect,
    /// the note's text box
    pub note: Rect,
    /// the page list's search field (its frame) and the text box in it (empty when closed)
    pub search: Rect,
    pub search_text: Rect,
    /// the page list's rows
    pub rows: Rect,
    pub row_h: i32,
    /// the bottom strip (its top line included) and its × button
    pub foot: Rect,
    pub close: Rect,
}

pub fn layout(m: &Metrics) -> Layout {
    let s = if m.scale.is_finite() && m.scale > 0.0 { m.scale } else { 1.0 };
    let px = |v: f32| (v * s).round() as i32;
    let w = px(640.0);
    let tile = Rect::new(px(16.0), px(15.0), px(16.0) + px(32.0), px(15.0) + px(32.0));
    let mid = (tile.t + tile.b) / 2;
    let mut x = tile.r + px(13.0);
    let mut pill = Rect::default();
    if m.pill_w > 0 {
        pill = Rect::new(x, mid - px(11.0), x + m.pill_w, mid - px(11.0) + px(22.0));
        x = pill.r + px(8.0);
    }
    let line_h = m.line_h.max(1);
    // the first line sits level with the + button
    let top = if line_h < tile.h() { mid - line_h / 2 } else { tile.t };
    let note = Rect::new(x, top, w - px(18.0), top + line_h * m.lines.clamp(1, MAX_LINES));
    let mut y = tile.b.max(note.b) + px(12.0);
    let (mut search, mut search_text, mut rows) = (Rect::default(), Rect::default(), Rect::default());
    let row_h = px(30.0).max(m.list_line_h + px(10.0));
    if m.rows > 0 {
        let sh = px(36.0).max(m.list_line_h + px(14.0));
        search = Rect::new(px(16.0), y, w - px(18.0), y + sh);
        let th = m.list_line_h.max(1);
        let tt = search.t + (sh - th) / 2;
        search_text = Rect::new(search.l + px(12.0), tt, search.r - px(12.0), tt + th);
        rows = Rect::new(px(16.0), search.b + px(6.0), w - px(18.0), search.b + px(6.0) + row_h * m.rows);
        y = rows.b + px(10.0);
    }
    let line = px(1.0).max(1);
    let inner = px(26.0).max(m.foot_h);
    let foot = Rect::new(0, y, w, y + line + px(6.0) + inner + px(6.0));
    let ct = foot.t + line + px(6.0) + (inner - px(26.0)) / 2;
    let close = Rect::new(w - px(8.0) - px(26.0), ct, w - px(8.0), ct + px(26.0));
    Layout { w, h: foot.b, tile, pill, note, search, search_text, rows, row_h, foot, close }
}

// ----- the page list -----

/// The page list for what's typed in its search field, as indexes into `pages` ((name, change
/// time) as `App::page_list` gives them): with nothing typed, the pages changed most
/// recently; else the names holding every typed word, best first: the name itself, names
/// starting with it, a word starting with it, then the rest (shorter names first).
pub fn rank_pages(pages: &[(String, u64)], query: &str, limit: usize) -> Vec<usize> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        let mut all: Vec<usize> = (0..pages.len()).collect();
        all.sort_by(|&a, &b| pages[b].1.cmp(&pages[a].1).then_with(|| pages[a].0.to_lowercase().cmp(&pages[b].0.to_lowercase())));
        all.truncate(limit);
        return all;
    }
    let words: Vec<&str> = q.split_whitespace().collect();
    let mut hits: Vec<(u8, usize, String, usize)> = Vec::new();
    for (i, (name, _)) in pages.iter().enumerate() {
        let n = name.to_lowercase();
        if !words.iter().all(|w| n.contains(w)) {
            continue;
        }
        let word_start = n.match_indices(q.as_str()).any(|(at, _)| n[..at].chars().last().is_none_or(|c| !c.is_alphanumeric()));
        let rank = if n == q {
            0
        } else if n.starts_with(&q) {
            1
        } else if word_start {
            2
        } else if n.contains(&q) {
            3
        } else {
            4
        };
        hits.push((rank, n.chars().count(), n, i));
    }
    hits.sort();
    hits.into_iter().take(limit).map(|h| h.3).collect()
}

// ----- smooth shapes -----

/// Mix two 0xRRGGBB colours: `t` = 0 gives `a`, 1 gives `b`.
pub fn mix(a: u32, b: u32, t: f32) -> u32 {
    let t = t.clamp(0.0, 1.0);
    let ch = |sh: u32| {
        let (x, y) = (((a >> sh) & 255) as f32, ((b >> sh) & 255) as f32);
        ((x + (y - x) * t).round() as u32) << sh
    };
    ch(16) | ch(8) | ch(0)
}

/// 0xRRGGBB → Windows' COLORREF (0x00BBGGRR).
pub fn colorref(rgb: u32) -> u32 {
    ((rgb & 0xFF) << 16) | (rgb & 0xFF00) | ((rgb >> 16) & 0xFF)
}

/// Shapes with smooth (anti-aliased) edges, painted straight into 32-bit pixels (0x00RRGGBB,
/// rows top to bottom), for the few the box draws: rounded rectangles and round-ended lines.
pub struct Canvas<'a> {
    pub px: &'a mut [u32],
    pub w: i32,
    pub h: i32,
}

impl Canvas<'_> {
    fn blend(&mut self, x: i32, y: i32, c: u32, a: f32) {
        if a <= 0.0 || x < 0 || y < 0 || x >= self.w || y >= self.h {
            return;
        }
        let i = (y * self.w + x) as usize;
        if let Some(p) = self.px.get_mut(i) {
            *p = if a >= 1.0 { c } else { mix(*p, c, a) };
        }
    }

    /// Fill whole pixels.
    pub fn fill(&mut self, r: Rect, c: u32) {
        for y in r.t.max(0)..r.b.min(self.h) {
            for x in r.l.max(0)..r.r.min(self.w) {
                self.px[(y * self.w + x) as usize] = c;
            }
        }
    }

    /// Paint where `cover(x, y)` (at pixel centres) says, inside a box.
    fn shape(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, c: u32, dist: impl Fn(f32, f32) -> f32) {
        let (xa, ya) = ((x0.floor() as i32 - 1).max(0), (y0.floor() as i32 - 1).max(0));
        let (xb, yb) = ((x1.ceil() as i32 + 1).min(self.w), (y1.ceil() as i32 + 1).min(self.h));
        for y in ya..yb {
            for x in xa..xb {
                let a = (0.5 - dist(x as f32 + 0.5, y as f32 + 0.5)).clamp(0.0, 1.0);
                self.blend(x, y, c, a);
            }
        }
    }

    /// A rectangle from (x0, y0) to (x1, y1) (pixel edges) with corners rounded by `r`.
    pub fn round_rect(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, r: f32, c: u32) {
        let (cx, cy, hx, hy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (x1 - x0) / 2.0, (y1 - y0) / 2.0);
        if hx <= 0.0 || hy <= 0.0 {
            return;
        }
        let r = r.clamp(0.0, hx.min(hy));
        self.shape(x0, y0, x1, y1, c, |px, py| {
            let (qx, qy) = ((px - cx).abs() - (hx - r), (py - cy).abs() - (hy - r));
            let out = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
            out + qx.max(qy).min(0.0) - r
        });
    }

    /// A line from a to b, `width` wide, with round ends.
    pub fn line(&mut self, ax: f32, ay: f32, bx: f32, by: f32, width: f32, c: u32) {
        let half = width / 2.0;
        let (dx, dy) = (bx - ax, by - ay);
        let len2 = (dx * dx + dy * dy).max(1e-6);
        self.shape(ax.min(bx) - half, ay.min(by) - half, ax.max(bx) + half, ay.max(by) + half, c, |px, py| {
            let (pa_x, pa_y) = (px - ax, py - ay);
            let h = ((pa_x * dx + pa_y * dy) / len2).clamp(0.0, 1.0);
            ((pa_x - dx * h).powi(2) + (pa_y - dy * h).powi(2)).sqrt() - half
        });
    }
}

/// The length of the PNG picture at the start of `b` (through its IEND chunk), if it is one
/// (a picture in memory may have room to spare after it).
pub fn png_len(b: &[u8]) -> Option<usize> {
    if !b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    let mut i = 8usize;
    loop {
        let len = u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?) as usize;
        let kind = b.get(i + 4..i + 8)?;
        let end = i.checked_add(12)?.checked_add(len)?;
        if end > b.len() {
            return None;
        }
        if kind == b"IEND" {
            return Some(end);
        }
        i = end;
    }
}

//! The capture box's shortcut key ("Ctrl+Shift+L") as Windows takes it: the words Settings saves,
//! read into Windows' modifier flags and a key, and written back in one spelling; and the key an
//! older Start-menu shortcut (.lnk) holds, so it can move to the shortcut-key helper
//! (src-tauri/src/hotkey.rs). Platform-free, tested in core/tests/hotkey.rs. A key that isn't a
//! letter, digit, F-key or named key (";", "é") is found in the keyboard layout by the helper.

/// RegisterHotKey's modifier flags.
pub const MOD_ALT: u32 = 1;
pub const MOD_CONTROL: u32 = 2;
pub const MOD_SHIFT: u32 = 4;
pub const MOD_WIN: u32 = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    /// a Windows virtual-key code: letters, digits, F1–F24 and the named keys (Space, Home…)
    Vk(u16),
    /// another character (a capital, for a letter), found in the keyboard layout when the key is
    /// registered
    Char(char),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hotkey {
    /// MOD_ALT | MOD_CONTROL | MOD_SHIFT | MOD_WIN
    pub mods: u32,
    pub key: Key,
}

/// Keys with names, as Windows numbers them.
const NAMED: [(&str, u16); 14] = [
    ("Space", 0x20),
    ("PageUp", 0x21),
    ("PageDown", 0x22),
    ("End", 0x23),
    ("Home", 0x24),
    ("Left", 0x25),
    ("Up", 0x26),
    ("Right", 0x27),
    ("Down", 0x28),
    ("Insert", 0x2D),
    ("Delete", 0x2E),
    ("Pause", 0x13),
    ("Enter", 0x0D),
    ("Backspace", 0x08),
];

const TWO: &str = "Use two of Ctrl, Alt and Shift with a key, e.g. Ctrl+Alt+N (an F-key may be on its own).";

/// The words for virtual-key code `vk` ("L", "7", "F9", "Space"); None for a key with no name here.
pub fn vk_name(vk: u16) -> Option<String> {
    match vk {
        0x30..=0x39 | 0x41..=0x5A => Some(char::from(vk as u8).to_string()),
        0x70..=0x87 => Some(format!("F{}", vk - 0x6F)),
        _ => NAMED.iter().find(|(_, v)| *v == vk).map(|(n, _)| n.to_string()),
    }
}

/// The key part of a shortcut's words.
fn key_of(word: &str) -> Option<Key> {
    // a space typed as the key (Settings once wrote it so)
    if !word.is_empty() && word.trim().is_empty() {
        return Some(Key::Vk(0x20));
    }
    let w = word.trim();
    let mut chars = w.chars();
    if let (Some(c), None) = (chars.next(), chars.clone().next()) {
        if c.is_ascii_alphanumeric() {
            return Some(Key::Vk(c.to_ascii_uppercase() as u16));
        }
        // one spelling for a letter (Settings writes capitals); the helper also tries the small one
        let mut up = c.to_uppercase();
        return Some(Key::Char(match (up.next(), up.next()) {
            (Some(u), None) => u,
            _ => c,
        }));
    }
    let lower = w.to_ascii_lowercase();
    if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u16>().ok()).filter(|n| (1..=24).contains(n)) {
        if !lower[1..].starts_with('0') && !lower[1..].starts_with('+') {
            return Some(Key::Vk(0x6F + n));
        }
    }
    let alias = match lower.as_str() {
        "spacebar" => "space",
        "pgup" => "pageup",
        "pgdn" => "pagedown",
        "ins" => "insert",
        "del" => "delete",
        "return" => "enter",
        x => x,
    };
    NAMED.iter().find(|(n, _)| n.to_ascii_lowercase() == alias).map(|(_, v)| Key::Vk(*v))
}

fn mod_of(word: &str) -> Option<u32> {
    match word.trim().to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Some(MOD_CONTROL),
        "alt" => Some(MOD_ALT),
        "shift" => Some(MOD_SHIFT),
        "win" | "windows" => Some(MOD_WIN),
        _ => None,
    }
}

/// "Ctrl+Shift+L", "CTRL+ALT+N", "ctrl + alt + f7", "F9", "Ctrl+Alt++" → the key. Refused (with why,
/// in his words): no key, two keys, unknown words, and a key that would get in the way of typing
/// (a letter or sign needs two modifiers, as Settings asks; an F-key may be on its own, but not
/// F12, which Windows keeps for debuggers).
pub fn parse(s: &str) -> Result<Hotkey, String> {
    if s.trim().is_empty() {
        return Err("No key was given.".into());
    }
    let trimmed = s.trim_start();
    // the "+" key itself: "Ctrl+Alt++" (or a lone "+")
    let (mods_part, key_word) = if trimmed.trim_end() == "+" {
        ("", "+")
    } else if let Some(rest) = trimmed.trim_end().strip_suffix("++") {
        (rest, "+")
    } else {
        match trimmed.rsplit_once('+') {
            Some((m, k)) => (m, k),
            None => ("", trimmed),
        }
    };
    let mut mods = 0;
    if !mods_part.trim().is_empty() {
        for w in mods_part.split('+') {
            match mod_of(w) {
                Some(m) => mods |= m,
                None if key_of(w).is_some() => return Err(format!("“{}” has more than one key. {TWO}", s.trim())),
                None => return Err(format!("“{}” isn’t a key Windows knows.", w.trim())),
            }
        }
    }
    if mod_of(key_word).is_some() {
        return Err(format!("“{}” has no key besides Ctrl, Alt and Shift. {TWO}", s.trim()));
    }
    let key = key_of(key_word).ok_or_else(|| format!("“{}” isn’t a key Windows knows.", key_word.trim()))?;
    let f_key = matches!(key, Key::Vk(0x70..=0x87));
    if !f_key && mods.count_ones() < 2 {
        return Err(TWO.into());
    }
    if key == Key::Vk(0x7B) && mods == 0 {
        return Err("Windows keeps F12 on its own for debuggers: add Ctrl, Alt or Shift.".into());
    }
    Ok(Hotkey { mods, key })
}

impl Hotkey {
    /// One spelling: "Ctrl+Alt+Shift+Win+K".
    pub fn text(&self) -> String {
        let mut parts: Vec<String> = Vec::new();
        for (flag, name) in [(MOD_CONTROL, "Ctrl"), (MOD_ALT, "Alt"), (MOD_SHIFT, "Shift"), (MOD_WIN, "Win")] {
            if self.mods & flag != 0 {
                parts.push(name.into());
            }
        }
        parts.push(match self.key {
            Key::Vk(v) => vk_name(v).unwrap_or_else(|| format!("{v:#04x}")),
            Key::Char(c) => c.to_string(),
        });
        parts.join("+")
    }
}

/// A Windows shortcut file's class id ({00021401-0000-0000-C000-000000000046}), as stored.
const LNK_CLSID: [u8; 16] = [0x01, 0x14, 0x02, 0x00, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46];
/// Where a shortcut file's key is: [MS-SHLLINK] 2.1, the header's HotKey (low byte: the key's
/// virtual-key code; high byte: HOTKEYF_SHIFT 1, HOTKEYF_CONTROL 2, HOTKEYF_ALT 4).
const LNK_HOTKEY_AT: usize = 0x40;

/// The key a shortcut file (.lnk) opens with, in Settings' words ("Ctrl+Shift+L"). None: not a
/// shortcut file, no key, or a key with no name here.
pub fn lnk_key(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 0x4C || bytes[0..4] != [0x4C, 0, 0, 0] || bytes[4..20] != LNK_CLSID {
        return None;
    }
    let (vk, flags) = (bytes[LNK_HOTKEY_AT], bytes[LNK_HOTKEY_AT + 1]);
    if vk == 0 {
        return None;
    }
    vk_name(vk as u16)?;
    let mut mods = 0;
    for (flag, m) in [(1u8, MOD_SHIFT), (2, MOD_CONTROL), (4, MOD_ALT)] {
        if flags & flag != 0 {
            mods |= m;
        }
    }
    Some(Hotkey { mods, key: Key::Vk(vk as u16) }.text())
}

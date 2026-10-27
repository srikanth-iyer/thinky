//! The capture box's shortcut key: the words Settings saves, as the helper reads them
//! (src-tauri/src/hotkey.rs), and the key an older Start-menu shortcut holds.
use outline_core::hotkey::*;

fn ok(s: &str) -> Hotkey {
    parse(s).unwrap_or_else(|e| panic!("{s:?}: {e}"))
}

#[test]
fn settings_words_are_read() {
    assert_eq!(ok("Ctrl+Shift+L"), Hotkey { mods: MOD_CONTROL | MOD_SHIFT, key: Key::Vk(0x4C) });
    // as Settings wrote them before (capitals), and loosely typed
    assert_eq!(ok("CTRL+SHIFT+L"), ok("Ctrl+Shift+L"));
    assert_eq!(ok(" ctrl + shift + l "), ok("Ctrl+Shift+L"));
    assert_eq!(ok("Shift+Control+l"), ok("Ctrl+Shift+L"));
    assert_eq!(ok("CTRL+ALT+N"), Hotkey { mods: MOD_CONTROL | MOD_ALT, key: Key::Vk(0x4E) });
    assert_eq!(ok("Ctrl+Alt+7"), Hotkey { mods: MOD_CONTROL | MOD_ALT, key: Key::Vk(0x37) });
    assert_eq!(ok("Win+Shift+K").mods, MOD_WIN | MOD_SHIFT);
    // F-keys, alone or not
    assert_eq!(ok("F9"), Hotkey { mods: 0, key: Key::Vk(0x78) });
    assert_eq!(ok("f1").key, Key::Vk(0x70));
    assert_eq!(ok("F24").key, Key::Vk(0x87));
    assert_eq!(ok("Ctrl+Alt+Shift+F7"), Hotkey { mods: MOD_CONTROL | MOD_ALT | MOD_SHIFT, key: Key::Vk(0x76) });
    assert_eq!(ok("Shift+F12").key, Key::Vk(0x7B));
    // named keys, the space bar (which Settings once wrote as a space) and the "+" key
    assert_eq!(ok("Ctrl+Alt+Space").key, Key::Vk(0x20));
    assert_eq!(ok("CTRL+ALT+ ").key, Key::Vk(0x20));
    assert_eq!(ok("Ctrl+Alt+PgDn").key, Key::Vk(0x22));
    assert_eq!(ok("Ctrl+Alt++"), Hotkey { mods: MOD_CONTROL | MOD_ALT, key: Key::Char('+') });
    // other signs are found in the keyboard layout by the helper
    assert_eq!(ok("CTRL+SHIFT+;").key, Key::Char(';'));
    assert_eq!(ok("Ctrl+Alt+é").key, Key::Char('É'));
    assert_eq!(ok("Ctrl+Alt+É"), ok("Ctrl+Alt+é"));
}

#[test]
fn keys_that_would_get_in_the_way_are_refused() {
    for bad in ["", "  ", "L", "Shift+L", "Ctrl+L", "Alt+7", "+", "Ctrl++", "F12", "Ctrl+Shift", "Ctrl+Alt+Shift", "Ctrl+Shift+L+K", "Ctrl+Shift+ABC", "Hyper+Shift+L", "Ctrl+Shift+F25", "Ctrl+Shift+F0", "Ctrl+Shift+F07", "Ctrl+Shift+F+3"] {
        assert!(parse(bad).is_err(), "{bad:?} should be refused");
    }
    assert!(parse("Ctrl+L").unwrap_err().contains("two of Ctrl, Alt and Shift"));
    assert!(parse("F12").unwrap_err().contains("F12"));
}

#[test]
fn one_spelling() {
    for (given, saved) in [
        ("CTRL+SHIFT+L", "Ctrl+Shift+L"),
        ("shift+alt+ctrl+k", "Ctrl+Alt+Shift+K"),
        ("f9", "F9"),
        ("SHIFT+F12", "Shift+F12"),
        ("CTRL+ALT+ ", "Ctrl+Alt+Space"),
        ("ctrl+alt+pgup", "Ctrl+Alt+PageUp"),
        ("Ctrl+Alt++", "Ctrl+Alt++"),
        ("ctrl+alt+é", "Ctrl+Alt+É"),
        ("Win+Ctrl+3", "Ctrl+Win+3"),
    ] {
        let k = ok(given);
        assert_eq!(k.text(), saved, "{given:?}");
        assert_eq!(ok(&k.text()), k, "{saved:?} reads back as the same key");
    }
}

#[test]
fn key_names() {
    assert_eq!(vk_name(0x4C).as_deref(), Some("L"));
    assert_eq!(vk_name(0x30).as_deref(), Some("0"));
    assert_eq!(vk_name(0x70).as_deref(), Some("F1"));
    assert_eq!(vk_name(0x87).as_deref(), Some("F24"));
    assert_eq!(vk_name(0x20).as_deref(), Some("Space"));
    assert_eq!(vk_name(0xBA), None); // ";" on a US keyboard: depends on the layout
    assert_eq!(vk_name(0), None);
}

/// A shortcut file's fixed header (76 bytes) with key `hotkey`, then some of the rest.
fn lnk(hotkey: u16) -> Vec<u8> {
    let mut b = vec![0u8; 0x4C];
    b[0] = 0x4C;
    b[4..20].copy_from_slice(&[0x01, 0x14, 0x02, 0x00, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
    b[0x40..0x42].copy_from_slice(&hotkey.to_le_bytes());
    b.extend_from_slice(b"\x14\x00rest of the shortcut");
    b
}

#[test]
fn an_older_start_menu_shortcuts_key() {
    // HOTKEYF_SHIFT 1 | HOTKEYF_CONTROL 2 in the high byte, the key in the low byte
    assert_eq!(lnk_key(&lnk(0x0300 | 0x4C)).as_deref(), Some("Ctrl+Shift+L"));
    assert_eq!(lnk_key(&lnk(0x0600 | 0x4E)).as_deref(), Some("Ctrl+Alt+N"));
    assert_eq!(lnk_key(&lnk(0x0700 | 0x76)).as_deref(), Some("Ctrl+Alt+Shift+F7"));
    assert_eq!(lnk_key(&lnk(0x78)).as_deref(), Some("F9"));
    // what it gives reads back as the same key
    assert_eq!(parse(&lnk_key(&lnk(0x0300 | 0x4C)).unwrap()), parse("CTRL+SHIFT+L"));
    // no key, a key with no name here, not a shortcut file
    assert_eq!(lnk_key(&lnk(0)), None);
    assert_eq!(lnk_key(&lnk(0x0300 | 0xBA)), None);
    assert_eq!(lnk_key(&lnk(0x0300 | 0x4C)[..0x4B]), None);
    let mut other = lnk(0x0300 | 0x4C);
    other[4] = 0x02;
    assert_eq!(lnk_key(&other), None);
    let mut other = lnk(0x0300 | 0x4C);
    other[0] = 0x50;
    assert_eq!(lnk_key(&other), None);
    assert_eq!(lnk_key(b""), None);
}

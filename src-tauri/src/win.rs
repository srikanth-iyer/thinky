//! Windows-only helpers for capturing notes from anywhere: the `leanoutliner://` link
//! (page and note links), the clipboard, the local time, and the Start-menu shortcut
//! with a key combination that opens the capture box (the portable copy's way; the installed
//! copy's key is answered by its helper, hotkey.rs).

#[cfg(windows)]
mod imp {
    // the Windows functions, declared once for the whole app (capture_box/ffi.rs)
    use crate::capture_box::ffi::{
        system_dir, wide, CloseClipboard, GetClipboardData, GetLocalTime, GlobalLock, GlobalSize, GlobalUnlock, OpenClipboard, RegCloseKey, RegCreateKeyExW, RegGetValueW, RegSetValueExW, CF_UNICODETEXT,
        HKEY_CURRENT_USER, KEY_WRITE, REG_SZ, RRF_RT_REG_SZ, SYSTEMTIME,
    };
    use std::ffi::c_void;

    /// Windows' own PowerShell: <system folder>\WindowsPowerShell\v1.0\powershell.exe.
    fn powershell() -> std::path::PathBuf {
        system_dir().join("WindowsPowerShell").join("v1.0").join("powershell.exe")
    }

    /// (date, "HH:mm") on this computer's clock.
    pub fn local_now() -> ((i32, u32, u32), String) {
        let mut st = SYSTEMTIME::default();
        unsafe { GetLocalTime(&mut st) };
        ((st.year as i32, st.month as u32, st.day as u32), format!("{:02}:{:02}", st.hour, st.minute))
    }

    /// The clipboard, opened: another program may hold it for a moment, so tried a few times
    /// (also the capture box's way, capture_box/files.rs). Closed again with CloseClipboard.
    pub fn open_clipboard(owner: isize) -> bool {
        crate::shell_rules::retry(10, std::time::Duration::from_millis(15), || (unsafe { OpenClipboard(owner as *mut c_void) } != 0).then_some(())).is_some()
    }

    pub fn clipboard_text() -> String {
        unsafe {
            if !open_clipboard(0) {
                return String::new();
            }
            let mut out = String::new();
            let h = GetClipboardData(CF_UNICODETEXT);
            if !h.is_null() {
                let p = GlobalLock(h) as *const u16;
                if !p.is_null() {
                    // never past the clipboard's block, even if its text has no end marker
                    let max = (GlobalSize(h) / 2).min(4_000_000);
                    let mut n = 0;
                    while n < max && *p.add(n) != 0 {
                        n += 1;
                    }
                    out = String::from_utf16_lossy(std::slice::from_raw_parts(p, n));
                    GlobalUnlock(h);
                }
            }
            CloseClipboard();
            out
        }
    }

    /// The text value `name` of the registry key `sub` under HKEY_CURRENT_USER ("": the key's
    /// default value). None if the key or value isn't there, isn't text, or is longer than 2047
    /// characters. Also hotkey.rs's way to read the start-at-sign-in entry.
    pub fn get(sub: &str, name: &str) -> Option<String> {
        let (sub, name) = (wide(sub), wide(name));
        let mut buf = vec![0u16; 2048];
        let mut len = (buf.len() * 2) as u32; // in bytes; Windows sets it to the bytes it wrote
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, sub.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        // (the bytes Windows wrote, as UTF-16 units, less the end marker)
        (r == 0).then(|| String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]))
    }

    /// Set the text value `name` ("": the default value) of the key `sub` under
    /// HKEY_CURRENT_USER, making the key if it's missing; false if Windows refused.
    pub fn set(sub: &str, name: &str, value: &str) -> bool {
        let mut key = 0isize;
        let s = wide(sub);
        if unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, s.as_ptr(), 0, std::ptr::null(), 0, KEY_WRITE, std::ptr::null(), &mut key, std::ptr::null_mut()) } != 0 {
            return false;
        }
        let (n, v) = (wide(name), wide(value));
        let ok = unsafe { RegSetValueExW(key, n.as_ptr(), 0, REG_SZ, v.as_ptr().cast(), (v.len() * 2) as u32) } == 0;
        unsafe { RegCloseKey(key) };
        ok
    }

    /// A registry key's default value under HKEY_CURRENT_USER (native_host.rs).
    pub fn reg_default(sub: &str) -> Option<String> {
        get(sub, "")
    }
    /// Set a key's default value under HKEY_CURRENT_USER (made if missing); false if refused.
    pub fn set_reg_default(sub: &str, value: &str) -> bool {
        set(sub, "", value)
    }

    /// Make `leanoutliner://…` links open this program (per user, no admin rights needed).
    /// Cheap when already set up: one registry read.
    pub fn register_link_handler() {
        let Ok(exe) = std::env::current_exe() else { return };
        let cmd = format!("\"{}\" \"%1\"", exe.display());
        const KEY: &str = "Software\\Classes\\leanoutliner";
        if get(&format!("{KEY}\\shell\\open\\command"), "").as_deref() == Some(cmd.as_str()) {
            return;
        }
        set(KEY, "", "URL:thinky");
        set(KEY, "URL Protocol", "");
        set(&format!("{KEY}\\shell\\open\\command"), "", &cmd);
    }

    /// The Start-menu shortcut "Lean Outliner capture": the portable copy's shortcut key, and the
    /// installed copy's older one (hotkey.rs moves its key to the helper and removes it).
    pub fn capture_shortcut_path() -> Option<std::path::PathBuf> {
        let appdata = std::env::var_os("APPDATA")?;
        Some(std::path::PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs\Lean Outliner capture.lnk"))
    }

    /// A Windows shortcut at `lnk` that starts `target args`, opened by the key combination
    /// `hotkey` (Windows' words, "CTRL+ALT+N"; empty: none), made with WScript.Shell (PowerShell).
    pub fn make_shortcut(lnk: &std::path::Path, target: &std::path::Path, args: &str, hotkey: &str, what: &str) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        // inside '…' PowerShell also ends the text at ‘ ’ ‚ ‛ (curly quotes, e.g. in a folder's name):
        // each is doubled, as ' is
        let q = |s: &str| s.chars().flat_map(|c| if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') { vec![c, c] } else { vec![c] }).collect::<String>();
        let script = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.Arguments='{}';$s.Hotkey='{}';$s.Description='{}';$s.Save()",
            q(&lnk.display().to_string()),
            q(&target.display().to_string()),
            q(args),
            q(hotkey),
            q(what)
        );
        // PowerShell by its full path (never one found beside a portable exe or on PATH)
        let out = std::process::Command::new(powershell())
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000) // no console window
            .output()
            .map_err(|e| format!("Couldn't run PowerShell: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    /// The portable copy's shortcut key: a Start-menu shortcut that opens the capture box, with a
    /// key combination such as "CTRL+ALT+N" (Windows' own shortcut keys, which can take a few
    /// seconds; the installed copy uses its helper instead, hotkey.rs). An empty key removes it.
    pub fn set_capture_shortcut(hotkey: &str) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let lnk = capture_shortcut_path().ok_or("Windows didn't say where the Start menu is.")?;
        if hotkey.is_empty() {
            return match std::fs::remove_file(&lnk) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            };
        }
        make_shortcut(&lnk, &exe, "--capture-box", hotkey, "Add a note to today's journal")
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn local_now() -> ((i32, u32, u32), String) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
        let t = secs.rem_euclid(86400);
        (outline_core::date::civil_from_days(secs.div_euclid(86400)), format!("{:02}:{:02}", t / 3600, t / 60 % 60))
    }
    pub fn clipboard_text() -> String {
        String::new()
    }
    pub fn register_link_handler() {}
    pub fn reg_default(_sub: &str) -> Option<String> {
        None
    }
    pub fn set_reg_default(_sub: &str, _value: &str) -> bool {
        false
    }
    pub fn capture_shortcut_path() -> Option<std::path::PathBuf> {
        None
    }
    pub fn set_capture_shortcut(_hotkey: &str) -> Result<(), String> {
        Err("Shortcut keys are only for Windows.".into())
    }
}

pub use imp::*;

/// The shared Windows helpers (audit finding 18: one registry reader and writer, one system
/// folder, one text converter for the whole app). Windows only: GitHub's Windows job runs them
/// (`cargo test -p lean-outliner --lib`).
#[cfg(all(test, windows))]
mod tests {
    use super::{get, set};
    use crate::capture_box::ffi::{system_dir, wide, wide_os, RegDeleteTreeW, HKEY_CURRENT_USER};

    /// A registry key of this test's own under HKEY_CURRENT_USER, removed with all its values when
    /// the test ends (even if it fails).
    struct TestKey(String);
    impl TestKey {
        fn new(what: &str) -> TestKey {
            TestKey(format!(r"Software\thinky-test-{}-{what}", std::process::id()))
        }
    }
    impl Drop for TestKey {
        fn drop(&mut self) {
            let k = wide(&self.0);
            unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, k.as_ptr()) };
        }
    }

    #[test]
    fn a_named_value_and_the_default_value_are_kept_apart() {
        let k = TestKey::new("named");
        assert_eq!(get(&k.0, "Lean Outliner hotkey"), None, "nothing there yet");
        // the start-at-sign-in entry's way (hotkey.rs): a named value
        assert!(set(&k.0, "Lean Outliner hotkey", r#""C:\Program Files\thinky\lean-outliner.exe" --hotkey"#));
        assert_eq!(get(&k.0, "Lean Outliner hotkey").as_deref(), Some(r#""C:\Program Files\thinky\lean-outliner.exe" --hotkey"#));
        assert_eq!(get(&k.0, ""), None, "a named value isn't the key's default value");
        // the link handler's way (win.rs, native_host.rs): the default value
        assert!(set(&k.0, "", "URL:thinky"));
        assert_eq!(get(&k.0, "").as_deref(), Some("URL:thinky"));
        assert_eq!(super::reg_default(&k.0).as_deref(), Some("URL:thinky"));
        assert_eq!(get(&k.0, "Lean Outliner hotkey").as_deref(), Some(r#""C:\Program Files\thinky\lean-outliner.exe" --hotkey"#), "the named one is unchanged");
        // set again: replaced, not added to
        assert!(set(&k.0, "Lean Outliner hotkey", "x"));
        assert_eq!(get(&k.0, "Lean Outliner hotkey").as_deref(), Some("x"));
    }

    #[test]
    fn empty_and_non_english_values_come_back_as_they_were() {
        let k = TestKey::new("text");
        assert!(set(&k.0, "URL Protocol", ""));
        assert_eq!(get(&k.0, "URL Protocol").as_deref(), Some(""), "an empty value is there, and empty");
        assert!(set(&k.0, "Notizen – Übersicht", "C:\\Users\\Zoë\\笔记"));
        assert_eq!(get(&k.0, "Notizen – Übersicht").as_deref(), Some("C:\\Users\\Zoë\\笔记"));
        assert_eq!(get(&k.0, "notizen – übersicht").as_deref(), Some("C:\\Users\\Zoë\\笔记"), "Windows' value names ignore case");
        assert_eq!(get(r"Software\thinky-test-no-such-key", ""), None, "a missing key: None, not an error");
    }

    #[test]
    fn the_system_folder_is_windows_own() {
        let d = system_dir();
        assert!(d.is_absolute() && d.is_dir(), "{d:?}");
        assert!(d.ends_with("System32") || d.ends_with("system32"), "{d:?}");
        // the programs the app starts from it by full path
        assert!(d.join("WindowsPowerShell").join("v1.0").join("powershell.exe").is_file());
        assert!(d.join("curl.exe").is_file(), "Windows 10 1803 and later have curl.exe");
        assert_eq!(crate::update::imp::curl(), d.join("curl.exe"));
    }

    #[test]
    fn text_for_windows_ends_with_its_marker() {
        assert_eq!(wide(""), vec![0]);
        assert_eq!(wide("aé笔"), vec![b'a' as u16, 0xE9, 0x7B14, 0]);
        assert_eq!(wide("😀"), vec![0xD83D, 0xDE00, 0], "outside the first plane: two units");
        // a path is copied as Windows gave it, even one that isn't valid Unicode (a lone half of a pair)
        use std::os::windows::ffi::OsStringExt;
        let odd = std::ffi::OsString::from_wide(&[b'a' as u16, 0xD800, b'b' as u16]);
        assert_eq!(wide_os(&odd), vec![b'a' as u16, 0xD800, b'b' as u16, 0]);
        assert_eq!(wide_os(std::ffi::OsStr::new("aé笔")), wide("aé笔"), "for plain text the two agree");
    }
}

// (`leanoutliner://` links are read by outline_core::link, used by main.rs)

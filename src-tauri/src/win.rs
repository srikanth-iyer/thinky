//! Windows-only helpers for capturing notes from anywhere: the `leanoutliner://` link
//! (for the browser bookmarklet), the clipboard, the local time, and a Start-menu shortcut
//! with a key combination that opens the capture box. Nothing here runs in the background.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    #[derive(Default)]
    struct SystemTime {
        year: u16,
        month: u16,
        weekday: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        ms: u16,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLocalTime(st: *mut SystemTime);
        fn GlobalLock(h: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(h: *mut c_void) -> i32;
        fn GlobalSize(h: *mut c_void) -> usize;
    }
    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(owner: *mut c_void) -> i32;
        fn GetClipboardData(format: u32) -> *mut c_void;
        fn CloseClipboard() -> i32;
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn RegCreateKeyExW(key: isize, sub: *const u16, res: u32, class: *const u16, opts: u32, sam: u32, sa: *const c_void, out: *mut isize, disp: *mut u32) -> i32;
        fn RegSetValueExW(key: isize, name: *const u16, res: u32, kind: u32, data: *const u8, len: u32) -> i32;
        fn RegGetValueW(key: isize, sub: *const u16, name: *const u16, flags: u32, kind: *mut u32, data: *mut c_void, len: *mut u32) -> i32;
        fn RegCloseKey(key: isize) -> i32;
    }
    const HKCU: isize = 0x8000_0001u32 as i32 as isize;
    const KEY_WRITE: u32 = 0x20006;
    const REG_SZ: u32 = 1;
    const RRF_RT_REG_SZ: u32 = 2;
    const CF_UNICODETEXT: u32 = 13;

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    /// (date, "HH:mm") on this computer's clock.
    pub fn local_now() -> ((i32, u32, u32), String) {
        let mut st = SystemTime::default();
        unsafe { GetLocalTime(&mut st) };
        ((st.year as i32, st.month as u32, st.day as u32), format!("{:02}:{:02}", st.hour, st.minute))
    }

    pub fn clipboard_text() -> String {
        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
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

    fn get(sub: &str) -> Option<String> {
        let (sub, name) = (wide(sub), wide(""));
        let mut buf = vec![0u16; 2048];
        let mut len = (buf.len() * 2) as u32;
        let r = unsafe { RegGetValueW(HKCU, sub.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        (r == 0).then(|| String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]))
    }

    fn set(sub: &str, name: &str, value: &str) -> bool {
        let mut key = 0isize;
        let s = wide(sub);
        if unsafe { RegCreateKeyExW(HKCU, s.as_ptr(), 0, std::ptr::null(), 0, KEY_WRITE, std::ptr::null(), &mut key, std::ptr::null_mut()) } != 0 {
            return false;
        }
        let (n, v) = (wide(name), wide(value));
        let ok = unsafe { RegSetValueExW(key, n.as_ptr(), 0, REG_SZ, v.as_ptr().cast(), (v.len() * 2) as u32) } == 0;
        unsafe { RegCloseKey(key) };
        ok
    }

    /// Make `leanoutliner://…` links open this program (per user, no admin rights needed).
    /// Cheap when already set up: one registry read.
    pub fn register_link_handler() {
        let Ok(exe) = std::env::current_exe() else { return };
        let cmd = format!("\"{}\" \"%1\"", exe.display());
        const KEY: &str = "Software\\Classes\\leanoutliner";
        if get(&format!("{KEY}\\shell\\open\\command")).as_deref() == Some(cmd.as_str()) {
            return;
        }
        set(KEY, "", "URL:Lean Outliner");
        set(KEY, "URL Protocol", "");
        set(&format!("{KEY}\\shell\\open\\command"), "", &cmd);
    }

    /// Start-menu shortcut that opens the capture box, with a key combination such as
    /// "CTRL+ALT+N" (Windows' own shortcut keys: nothing of ours runs in the background).
    /// An empty key removes the shortcut.
    pub fn set_capture_shortcut(hotkey: &str) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
        let lnk = format!("{appdata}\\Microsoft\\Windows\\Start Menu\\Programs\\Lean Outliner capture.lnk");
        let q = |s: &str| s.replace('\'', "''");
        let script = if hotkey.is_empty() {
            format!("Remove-Item -LiteralPath '{}' -ErrorAction SilentlyContinue", q(&lnk))
        } else {
            format!(
                "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.Arguments='--capture-box';$s.Hotkey='{}';$s.Description='Add a note to today''s journal';$s.Save()",
                q(&lnk),
                q(&exe.display().to_string()),
                q(hotkey)
            )
        };
        let out = std::process::Command::new("powershell")
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
    pub fn set_capture_shortcut(_hotkey: &str) -> Result<(), String> {
        Err("Shortcut keys are only for Windows.".into())
    }
}

pub use imp::*;

/// Decode `%xx` and `+` in a link's query value.
fn unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                match std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        out.push(v);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `leanoutliner://capture?text=…&url=…&title=…` → (text, url, open the box?)
pub fn parse_link(link: &str) -> Option<(String, String, bool)> {
    let rest = link.strip_prefix("leanoutliner:")?.trim_start_matches('/');
    let query = rest.split_once('?').map_or("", |(_, q)| q);
    let (mut text, mut url, mut title, mut boxed) = (String::new(), String::new(), String::new(), false);
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "text" => text = unescape(v),
            "url" => url = unescape(v),
            "title" => title = unescape(v),
            "box" => boxed = v != "0",
            _ => {}
        }
    }
    // a selection is the note; without one, the page title is
    let text = if text.trim().is_empty() { title } else { text };
    Some((text, url, boxed))
}

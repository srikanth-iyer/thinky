//! Windows-only helpers for capturing notes from anywhere: the `leanoutliner://` link
//! (for the browser bookmarklet), the clipboard, the local time, and the Start-menu shortcut
//! with a key combination that opens the capture box (the portable copy's way; the installed
//! copy's key is answered by its helper, hotkey.rs).

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

    /// A registry key's default value under HKEY_CURRENT_USER (native_host.rs).
    pub fn reg_default(sub: &str) -> Option<String> {
        get(sub)
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
        if get(&format!("{KEY}\\shell\\open\\command")).as_deref() == Some(cmd.as_str()) {
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
        let q = |s: &str| s.replace('\'', "''");
        let script = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.Arguments='{}';$s.Hotkey='{}';$s.Description='{}';$s.Save()",
            q(&lnk.display().to_string()),
            q(&target.display().to_string()),
            q(args),
            q(hotkey),
            q(what)
        );
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

// (`leanoutliner://` links are read by outline_core::link, used by main.rs)

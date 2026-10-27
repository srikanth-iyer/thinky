//! The capture box's shortcut key on Windows, answered at once. Windows' own way, a Start-menu
//! shortcut with a key, took about 3 s on a typical laptop (Explorer first asks every open window whether
//! the key is theirs and waits for one that doesn't answer). So a tiny helper,
//! `lean-outliner.exe --hotkey`, started with Windows (HKCU\…\Run, value `RUN_VALUE`), listens for
//! the key itself (RegisterHotKey) and starts `lean-outliner.exe --capture-box` when it's pressed,
//! a program of its own (the box's one-shot design is unchanged; a box already open is brought
//! forward by it). The helper has no window to see, no timers, never polls (it sleeps in
//! GetMessage until the key or "quit"), never starts Tauri or the web engine, and gives its memory
//! back after starting and after each box (EmptyWorkingSet). Measured by CI (Oct 27, 2026): 52 KB in
//! RAM while waiting, 1.5 MB its own, no CPU; the box on screen 40–120 ms after the key.
//!
//! - The key: `<cache>/hotkey.txt` ("Ctrl+Shift+L", outline_core::hotkey's spelling; empty = off),
//!   read when the helper starts. Settings → Capture's Save/Remove (`set`) writes it.
//! - One helper at a time: starts take turns (a named mutex); a new one takes its key first, so if
//!   it can't (another program has it) the old one keeps working; it asks the old one to quit
//!   (WM_CLOSE to its message-only window, class `CLASS`, title "… : <key>"), first if that one
//!   holds the same key. Its window is there from its first moment, titled "… (starting)" until it
//!   holds its key, so a helper still starting is known too (an update doesn't take it for another
//!   open copy; asked to quit, it does at once). Can't take the key → the problems log and
//!   `<cache>/hotkey-status.txt` say why (Settings shows it, with Try again) and it quits.
//! - The older Start-menu shortcut (`Lean Outliner capture.lnk`, win.rs) goes once the helper holds
//!   the key. Explorer holds that shortcut's key, so with the same key it's removed first and put
//!   back, key and all, if the helper can't take it. The app's first start after the update moves
//!   its key here (`ensure`).
//! - Only the installed copy (update::installed): the portable copy keeps the Start-menu shortcut
//!   way (its program can be moved, which Windows' Run entry wouldn't follow).
//! - The app's start (`at_start`) makes sure the helper runs with the saved key; an update stops it
//!   first (`stop`; update.rs, whose "other copies" check leaves it out: `helper_pids`) and the
//!   updated app starts it again; the installer and uninstaller stop it too (windows/hooks.nsh,
//!   which also removes the Run entry on uninstall).
//! - `--hotkey-selftest <dir>`: CI's check (hotkey/selftest.rs). Never on a computer you use: it presses keys.
#![cfg_attr(not(windows), allow(dead_code))]

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// The helper's hidden window class (windows/hooks.nsh looks for it too).
pub const CLASS: &str = "LeanOutlinerHotkey";
/// Its title: this, ": ", the key it holds.
const TITLE: &str = "Lean Outliner shortcut key";
/// The value in HKCU\Software\Microsoft\Windows\CurrentVersion\Run that starts it with Windows
/// (windows/hooks.nsh removes it on uninstall).
pub const RUN_VALUE: &str = "Lean Outliner shortcut key";
/// In the app's cache folder: the key ("Ctrl+Shift+L"; empty: off).
const KEY_FILE: &str = "hotkey.txt";
/// …and why the last helper couldn't take the key, in his words (none: it could).
const STATUS_FILE: &str = "hotkey-status.txt";
/// A helper's window title until it holds its key.
const STARTING: &str = "Lean Outliner shortcut key (starting)";
/// The helper's exit codes: another program has the key; Windows can't use the key.
const EXIT_KEY_TAKEN: i32 = 3;
const EXIT_BAD_KEY: i32 = 4;

/// Where the key's pieces are: the app's own, or the self-test's.
pub struct Place {
    /// the app's cache folder (hotkey.txt; the helper finds it by LOCALAPPDATA, as main.rs does)
    pub cache: PathBuf,
    /// the older Start-menu shortcut
    pub lnk: Option<PathBuf>,
    /// the Run value's name
    pub run_value: String,
}

impl Place {
    pub fn real() -> Option<Place> {
        Some(Place { cache: outline_core::app::cache_dir()?, lnk: crate::win::capture_shortcut_path(), run_value: RUN_VALUE.into() })
    }
}

/// The saved key: None when there's no file (before the helper was ever used), "" when off.
fn read_key(cache: &Path) -> Option<String> {
    std::fs::read_to_string(cache.join(KEY_FILE)).ok().map(|s| s.trim().to_string())
}

fn write_key(cache: &Path, key: &str) -> Result<(), String> {
    std::fs::create_dir_all(cache).map_err(|e| format!("Couldn’t keep the key ({e})."))?;
    outline_core::app::write_atomic(&cache.join(KEY_FILE), key)
}

/// Settings → Capture: the key Settings shows ("" for none), whether the helper is used here, and
/// whether it's working now (`running`, `starting`, `fallback`, `why`).
pub fn state() -> Value {
    imp::state()
}

/// Settings → Capture's Save (a key) and Remove (""): Ok(the key as saved).
pub fn set(key: &str) -> Result<String, String> {
    imp::set(key)
}

/// When the app starts (the installed copy on Windows): the helper runs with the saved key; on the
/// first start after this update, an older Start-menu shortcut's key moves to it.
pub fn at_start() {
    imp::at_start()
}

/// Ask the helper to quit and wait until it has (an update is about to replace the program).
/// true: one was running.
pub fn stop() -> bool {
    imp::stop()
}

/// The helpers' process ids (update.rs leaves them out of "another copy is open").
pub fn helper_pids() -> Vec<u32> {
    imp::helpers().into_iter().map(|(_, pid)| pid).collect()
}

/// `--hotkey`: the helper itself. Returns the exit code.
pub fn helper_main() -> i32 {
    imp::helper_main()
}

/// `--hotkey-selftest <dir>`: CI's check; returns how many checks failed.
pub fn selftest(dir: &Path) -> i32 {
    #[cfg(windows)]
    return selftest::selftest(dir);
    #[cfg(not(windows))]
    {
        let _ = dir;
        2
    }
}

#[cfg(windows)]
mod selftest;

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::capture_box::ffi::*;
    use outline_core::hotkey::{self as rules, Hotkey, Key};
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    const ID: i32 = 1;
    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    /// How long a new helper keeps trying for its key while Windows lets go of it (Explorer, for
    /// an older Start-menu shortcut just removed).
    const KEY_WAIT: Duration = Duration::from_secs(4);
    /// How long the app waits for a new helper to say it holds its key.
    const ANSWER_WAIT: Duration = Duration::from_secs(15);
    /// The app's changes to the key take turns (Settings, the start-up check, an update).
    static BUSY: Mutex<()> = Mutex::new(());

    fn busy() -> std::sync::MutexGuard<'static, ()> {
        BUSY.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub(super) fn wide_os(s: &std::ffi::OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    pub(super) fn close(h: isize) {
        if h != 0 && h != -1 {
            unsafe { CloseHandle(h as *mut c_void) };
        }
    }

    fn log(msg: &str) {
        outline_core::log::record(msg);
    }

    /// Windows' system folder (NUL-ended): where the helper and the boxes it starts stand, so none
    /// ever holds a folder an update or uninstall removes.
    fn system_dir() -> Vec<u16> {
        let mut buf = [0u16; 260];
        let n = unsafe { GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
        if n == 0 || n >= buf.len() {
            return wide(r"C:\Windows\System32");
        }
        buf[..n].iter().copied().chain(Some(0)).collect()
    }

    /// The key as RegisterHotKey takes it: (modifiers, virtual-key code). None: a sign that isn't
    /// on this keyboard.
    pub(super) fn vk_of(k: &Hotkey) -> Option<(u32, u32)> {
        let scan = |c: char| -> Option<u32> {
            let mut buf = [0u16; 2];
            let units = c.encode_utf16(&mut buf);
            if units.len() != 1 {
                return None;
            }
            let r = unsafe { VkKeyScanW(units[0]) } as u16;
            (r & 0xFF != 0xFF).then_some((r & 0xFF) as u32)
        };
        let vk = match k.key {
            Key::Vk(v) => v as u32,
            Key::Char(c) => scan(c).or_else(|| c.to_lowercase().next().and_then(scan))?,
        };
        Some((k.mods, vk))
    }

    /// A program started by `start_self`: its handles, closed when dropped.
    pub(super) struct Started {
        pub process: isize,
        pub thread: isize,
        pub pid: u32,
    }
    impl Drop for Started {
        fn drop(&mut self) {
            close(self.thread);
            close(self.process);
        }
    }

    /// Start this program again with `args`, on its own: none of our handles, no console window,
    /// in the system folder, and outside any job this program runs in when Windows allows (else
    /// it would end with it). `suspended`: it waits until its thread is resumed.
    pub(super) fn start_self(args: &str, suspended: bool) -> Result<Started, String> {
        let exe = std::env::current_exe().map_err(|e| format!("this program’s place isn’t known ({e})"))?;
        let app = wide_os(exe.as_os_str());
        let dir = system_dir();
        let base = CREATE_NO_WINDOW | if suspended { CREATE_SUSPENDED } else { 0 };
        let mut last = 0;
        for flags in [base | CREATE_BREAKAWAY_FROM_JOB, base] {
            let mut cmd: Vec<u16> = Some(b'"' as u16).into_iter().chain(exe.as_os_str().encode_wide()).chain(format!("\" {args}").encode_utf16()).chain(Some(0)).collect();
            // SAFETY: plain numbers and null pointers; zeroed is valid
            let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
            si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
            let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
            let ok = unsafe { CreateProcessW(app.as_ptr(), cmd.as_mut_ptr(), std::ptr::null(), std::ptr::null(), 0, flags, std::ptr::null(), dir.as_ptr(), &si, &mut pi) };
            if ok != 0 {
                return Ok(Started { process: pi.process, thread: pi.thread, pid: pi.pid });
            }
            last = unsafe { GetLastError() };
            if last != ERROR_ACCESS_DENIED {
                break; // (access denied: a job that doesn't allow leaving it; then without)
            }
        }
        Err(format!("Windows didn’t start it (error {last})"))
    }

    /// The helpers running now: (window, process id), this process's own left out.
    pub(super) fn helpers() -> Vec<(isize, u32)> {
        let class = wide(CLASS);
        let me = std::process::id();
        let mut out = Vec::new();
        let mut h = 0;
        for _ in 0..32 {
            h = unsafe { FindWindowExW(HWND_MESSAGE, h, class.as_ptr(), std::ptr::null()) };
            if h == 0 {
                break;
            }
            let mut pid = 0;
            unsafe { GetWindowThreadProcessId(h, &mut pid) };
            if pid != me {
                out.push((h, pid));
            }
        }
        out
    }

    /// The key a running helper holds (its window's title says).
    pub(super) fn held_key(h: isize) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { InternalGetWindowText(h, buf.as_mut_ptr(), buf.len() as i32) };
        let t = String::from_utf16_lossy(&buf[..n.clamp(0, 128) as usize]);
        t.strip_prefix(TITLE).and_then(|r| r.strip_prefix(": ")).unwrap_or("").to_string()
    }

    /// The helpers that hold a key: (process id, key).
    pub(super) fn running() -> Vec<(u32, String)> {
        helpers().into_iter().map(|(h, pid)| (pid, held_key(h))).filter(|(_, k)| !k.is_empty()).collect()
    }

    /// Ask these helpers to quit and wait (3 s at most, in all) until they have. true: all gone.
    pub(super) fn close_and_wait(list: &[(isize, u32)]) -> bool {
        // opened first, so a process id used again meanwhile is never waited on
        let procs: Vec<isize> = list.iter().map(|&(_, pid)| unsafe { OpenProcess(SYNCHRONIZE, 0, pid) }).collect();
        for &(h, _) in list {
            unsafe { PostMessageW(h, WM_CLOSE, 0, 0) };
        }
        let until = Instant::now() + Duration::from_secs(3);
        let mut all = true;
        for p in procs {
            if p == 0 {
                all = false;
                continue;
            }
            let left = until.saturating_duration_since(Instant::now()).as_millis() as u32;
            if unsafe { WaitForSingleObject(p, left) } != WAIT_OBJECT_0 {
                all = false;
            }
            close(p);
        }
        all
    }

    pub fn stop() -> bool {
        let _b = busy();
        let list = helpers();
        if list.is_empty() {
            return false;
        }
        if !close_and_wait(&list) {
            log("The shortcut key’s helper didn’t quit when asked.");
        }
        true
    }

    // ----- the helper -----

    /// Helpers' starts take turns (a named mutex): two started at once (Windows' Run entry and the
    /// app) neither both stay nor close each other.
    struct Turn(isize);
    impl Turn {
        fn take() -> Turn {
            let name = wide("Local\\LeanOutlinerHotkeyStart");
            let h = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
            if h != 0 {
                let w = unsafe { WaitForSingleObject(h, 20_000) };
                if w == WAIT_OBJECT_0 || w == WAIT_ABANDONED {
                    return Turn(h);
                }
                close(h);
            }
            Turn(0)
        }
    }
    impl Drop for Turn {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe { ReleaseMutex(self.0) };
                close(self.0);
            }
        }
    }

    unsafe extern "system" fn helper_proc(h: isize, m: u32, w: usize, l: isize) -> isize {
        // WM_CLOSE (from the app, a newer helper, the installer): Windows destroys the window
        if m == WM_DESTROY {
            PostQuitMessage(0);
            return 0;
        }
        DefWindowProcW(h, m, w, l)
    }

    /// The helper's hidden (message-only) window, made first thing (titled `STARTING`, then with
    /// its key): how the app, a newer helper and the installer find it and ask it to quit.
    fn make_window() -> Option<isize> {
        let class = wide(CLASS);
        unsafe {
            let inst = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSEXW {
                size: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: 0,
                wndproc: Some(helper_proc),
                cls_extra: 0,
                wnd_extra: 0,
                instance: inst,
                icon: 0,
                cursor: 0,
                background: 0,
                menu_name: std::ptr::null(),
                class_name: class.as_ptr(),
                icon_sm: 0,
            };
            if RegisterClassExW(&wc) == 0 {
                return None;
            }
            let title = wide(STARTING);
            let h = CreateWindowExW(0, class.as_ptr(), title.as_ptr(), 0, 0, 0, 0, 0, HWND_MESSAGE, 0, inst, std::ptr::null_mut());
            (h != 0).then_some(h)
        }
    }

    /// The key was pressed: start the box (`--capture-box`), allowed to come to the front (the
    /// key press gave the helper that right; it passes it on before the box's program runs).
    fn open_box() {
        match start_self("--capture-box", true) {
            Ok(p) => unsafe {
                AllowSetForegroundWindow(p.pid);
                ResumeThread(p.thread);
            },
            Err(e) => log(&format!("The shortcut key couldn’t open the Add to journal box: {e}.")),
        }
    }

    /// Asked to quit (WM_CLOSE) while still starting?
    fn asked_to_quit(window: isize) -> bool {
        let mut msg: MSG = unsafe { std::mem::zeroed() };
        unsafe { PeekMessageW(&mut msg, window, WM_CLOSE, WM_CLOSE, PM_REMOVE) != 0 }
    }

    /// The helper couldn't take its key: the problems log and the status file (Settings) say why.
    fn failed(cache: &Path, code: i32, key: &str, detail: &str) -> i32 {
        log(&format!("The shortcut key {key} can’t be used: {detail}"));
        let _ = outline_core::app::write_atomic(&cache.join(STATUS_FILE), &why(code, key));
        code
    }

    pub fn helper_main() -> i32 {
        let Some(cache) = outline_core::app::cache_dir() else { return 2 };
        unsafe { SetCurrentDirectoryW(system_dir().as_ptr()) };
        // first thing: from now on the app, a newer helper and the installer know it's a helper
        let Some(window) = make_window() else {
            log("The shortcut key’s helper couldn’t make its window.");
            return 2;
        };
        let turn = Turn::take();
        if asked_to_quit(window) {
            return 0;
        }
        let text = read_key(&cache).unwrap_or_default();
        if text.is_empty() {
            close_and_wait(&helpers()); // off: no helper at all
            return 0;
        }
        let hk = match rules::parse(&text) {
            Ok(k) => k,
            Err(e) => return failed(&cache, EXIT_BAD_KEY, &text, &e),
        };
        let Some((mods, vk)) = vk_of(&hk) else { return failed(&cache, EXIT_BAD_KEY, &text, "it isn’t on this keyboard.") };
        let text = hk.text();
        let mut err = 0;
        let mut take = || {
            let ok = unsafe { RegisterHotKey(0, ID, mods | MOD_NOREPEAT, vk) } != 0;
            if !ok {
                err = unsafe { GetLastError() };
            }
            ok
        };
        // first while an older helper still runs: if this key can't be had, that one keeps its own
        // (only helpers that hold a key: one still starting waits for its turn after this one)
        let mut others: Vec<(isize, u32)> = helpers().into_iter().filter(|&(h, _)| !held_key(h).is_empty()).collect();
        let mut ok = take();
        if !ok {
            let (same, rest): (Vec<_>, Vec<_>) = others.iter().copied().partition(|&(h, _)| held_key(h) == text);
            if !same.is_empty() {
                close_and_wait(&same); // the same key: the older one lets go of it first
                others = rest;
                ok = take();
            }
        }
        // Windows may still be letting go of it (Explorer, for a Start-menu shortcut just removed)
        let t = Instant::now();
        while !ok && t.elapsed() < KEY_WAIT {
            if asked_to_quit(window) {
                return 0;
            }
            std::thread::sleep(Duration::from_millis(100));
            ok = take();
        }
        if !ok {
            return failed(&cache, EXIT_KEY_TAKEN, &text, &format!("another program already uses it (Windows error {err})."));
        }
        close_and_wait(&others);
        let _ = std::fs::remove_file(cache.join(STATUS_FILE));
        let title = wide(&format!("{TITLE}: {text}"));
        unsafe { SetWindowTextW(window, title.as_ptr()) };
        drop(turn);
        unsafe {
            K32EmptyWorkingSet(GetCurrentProcess());
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                // the key (RegisterHotKey with no window: it comes to the thread)
                if msg.message == WM_HOTKEY && msg.hwnd == 0 && msg.wparam == ID as usize {
                    open_box();
                    K32EmptyWorkingSet(GetCurrentProcess());
                } else {
                    DispatchMessageW(&msg);
                }
            }
            UnregisterHotKey(0, ID);
        }
        0
    }

    // ----- the app's side -----

    /// The answer of a helper just started: Ok once it holds its key (its window says so), else
    /// its exit code (-1: no answer in time; it's stopped then).
    fn answer(p: &Started) -> Result<(), i32> {
        let t = Instant::now();
        loop {
            if helpers().iter().any(|&(h, pid)| pid == p.pid && !held_key(h).is_empty()) {
                return Ok(());
            }
            if unsafe { WaitForSingleObject(p.process, 50) } == WAIT_OBJECT_0 {
                let mut code = 0u32;
                unsafe { GetExitCodeProcess(p.process, &mut code) };
                return Err(code as i32);
            }
            if t.elapsed() > ANSWER_WAIT {
                unsafe { TerminateProcess(p.process, 1) };
                return Err(-1);
            }
        }
    }

    fn why(code: i32, key: &str) -> String {
        match code {
            EXIT_KEY_TAKEN => format!("Another program already uses {key}, so it can’t open the box. Try another key."),
            EXIT_BAD_KEY => format!("Windows can’t use {key} on this keyboard. Try another key."),
            -1 => "The shortcut key’s helper didn’t answer in time. Try again.".into(),
            c => format!("The shortcut key’s helper stopped (code {c}). The problems log may say why."),
        }
    }

    pub(super) fn run_command() -> Option<String> {
        let exe = std::env::current_exe().ok()?;
        Some(format!("\"{}\" --hotkey", exe.display()))
    }

    pub(super) fn run_get(name: &str) -> Option<String> {
        let (sub, name) = (wide(RUN_KEY), wide(name));
        let mut buf = vec![0u16; 2048];
        let mut len = (buf.len() * 2) as u32;
        let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, sub.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        (r == 0).then(|| String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]))
    }

    fn run_set(name: &str, value: &str) -> bool {
        let mut key = 0isize;
        let sub = wide(RUN_KEY);
        if unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, sub.as_ptr(), 0, std::ptr::null(), 0, KEY_WRITE, std::ptr::null(), &mut key, std::ptr::null_mut()) } != 0 {
            return false;
        }
        let (n, v) = (wide(name), wide(value));
        let ok = unsafe { RegSetValueExW(key, n.as_ptr(), 0, REG_SZ, v.as_ptr().cast(), (v.len() * 2) as u32) } == 0;
        unsafe { RegCloseKey(key) };
        ok
    }

    pub(super) fn run_remove(name: &str) -> bool {
        let (sub, name) = (wide(RUN_KEY), wide(name));
        let r = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, sub.as_ptr(), name.as_ptr()) };
        r == 0 || r == ERROR_FILE_NOT_FOUND
    }

    /// The older Start-menu shortcut: its place and bytes, if it's there.
    fn shortcut(place: &Place) -> Option<(PathBuf, Vec<u8>)> {
        let p = place.lnk.clone()?;
        let b = std::fs::read(&p).ok()?;
        Some((p, b))
    }

    /// Tell Explorer at once (it holds the shortcut's key).
    fn notify(event: i32, path: &Path) {
        let w = wide_os(path.as_os_str());
        unsafe { SHChangeNotify(event, SHCNF_PATHW, w.as_ptr().cast(), std::ptr::null()) };
    }

    fn remove_shortcut(p: &Path) {
        if std::fs::remove_file(p).is_ok() {
            notify(SHCNE_DELETE, p);
        }
    }

    fn put_back_shortcut(p: &Path, bytes: &[u8]) {
        if std::fs::write(p, bytes).is_ok() {
            notify(SHCNE_CREATE, p);
        }
    }

    /// After key `tried` didn't work: the key as it was before (its file, Run entry, helper; not a
    /// helper for the very key that just failed, which would only fail again).
    fn restore(place: &Place, before: &Option<String>, tried: &str) {
        match before.as_deref() {
            Some(k) if !k.is_empty() => {
                let _ = write_key(&place.cache, k);
                if helpers().is_empty() && k != tried {
                    let _ = start_self("--hotkey", false);
                }
            }
            Some(_) => {
                let _ = write_key(&place.cache, "");
                run_remove(&place.run_value);
            }
            None => {
                let _ = std::fs::remove_file(place.cache.join(KEY_FILE));
                run_remove(&place.run_value);
            }
        }
    }

    /// Hand the key to the helper: saved, started with Windows, the helper (re)started and its
    /// answer waited for; then the older Start-menu shortcut goes. If the helper can't take the
    /// key, everything is as it was (the shortcut put back with its key) and Err says why.
    pub(super) fn turn_on(place: &Place, key: &str) -> Result<String, String> {
        let hk = rules::parse(key)?;
        let text = hk.text();
        if vk_of(&hk).is_none() {
            return Err(why(EXIT_BAD_KEY, &text));
        }
        let before = read_key(&place.cache);
        let lnk = shortcut(place);
        // Explorer holds the shortcut's key: with the same key it goes first, or the helper can't have it
        let same = lnk.as_ref().is_some_and(|(_, b)| rules::lnk_key(b).and_then(|k| rules::parse(&k).ok()) == Some(hk));
        if same {
            if let Some((p, _)) = &lnk {
                remove_shortcut(p);
            }
        }
        let tried = text.clone();
        let fail = |e: String| -> String {
            if same {
                if let Some((p, b)) = &lnk {
                    put_back_shortcut(p, b);
                }
            }
            restore(place, &before, &tried);
            e
        };
        write_key(&place.cache, &text).map_err(fail)?;
        let cmd = run_command().ok_or_else(|| fail("This program’s place isn’t known.".into()))?;
        if !run_set(&place.run_value, &cmd) {
            return Err(fail("Windows didn’t let the app start the shortcut key’s helper with Windows.".into()));
        }
        let started = start_self("--hotkey", false).map_err(|e| fail(format!("The shortcut key’s helper didn’t start: {e}.")))?;
        match answer(&started) {
            Ok(()) => {
                if let Some((p, _)) = &lnk {
                    remove_shortcut(p); // not needed any more
                }
                Ok(text)
            }
            Err(code) => Err(fail(why(code, &text))),
        }
    }

    /// Remove: no helper, no Run entry, no Start-menu shortcut; hotkey.txt says "off".
    pub(super) fn turn_off(place: &Place) -> Result<String, String> {
        write_key(&place.cache, "")?;
        run_remove(&place.run_value);
        if !close_and_wait(&helpers()) {
            log("The shortcut key’s helper didn’t quit when asked.");
        }
        if let Some(p) = &place.lnk {
            if p.exists() {
                remove_shortcut(p);
            }
        }
        Ok(String::new())
    }

    /// The helper runs with the saved key, and nothing else answers it. Before the helper was ever
    /// used (no hotkey.txt), an older Start-menu shortcut's key moves to it.
    pub(super) fn ensure(place: &Place) -> Result<(), String> {
        match read_key(&place.cache) {
            None => {
                let Some(key) = shortcut(place).and_then(|(_, b)| rules::lnk_key(&b)) else { return Ok(()) };
                turn_on(place, &key).map(|_| ()).map_err(|e| format!("The shortcut key {key} stays with the Start-menu shortcut for now: {e}"))
            }
            Some(k) if k.is_empty() => {
                run_remove(&place.run_value);
                Ok(())
            }
            Some(k) => {
                let fine = matches!(running().as_slice(), [(_, held)] if *held == k) && shortcut(place).is_none();
                if !fine {
                    return turn_on(place, &k).map(|_| ());
                }
                // Windows' Run entry: this program (again)
                if let Some(cmd) = run_command() {
                    if run_get(&place.run_value).as_deref() != Some(cmd.as_str()) {
                        run_set(&place.run_value, &cmd);
                    }
                }
                Ok(())
            }
        }
    }

    pub fn at_start() {
        if !crate::update::installed() {
            return;
        }
        let Some(place) = Place::real() else { return };
        let _b = busy();
        match std::panic::catch_unwind(|| ensure(&place)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => log(&e),
            Err(_) => log("The shortcut key’s start-up check crashed."),
        }
    }

    pub fn set(key: &str) -> Result<String, String> {
        if !crate::update::installed() {
            // the portable copy: Windows' own shortcut keys (slower), as before
            let k = if key.trim().is_empty() { String::new() } else { rules::parse(key)?.text() };
            crate::win::set_capture_shortcut(&k.to_uppercase())?;
            return Ok(k);
        }
        let place = Place::real().ok_or("The app’s own folder isn’t known.")?;
        let _b = busy();
        if key.trim().is_empty() {
            turn_off(&place)
        } else {
            turn_on(&place, key)
        }
    }

    /// What Settings shows for `place`: the key; whether this copy uses the helper; whether a
    /// helper holds the key now; whether one is on its way (the app handing it the key, or one
    /// still starting); whether the older Start-menu shortcut still answers it (a key that couldn't
    /// move yet: the slow way, but working); and why no helper holds it (the last one's answer).
    pub(super) fn status(place: &Place, installed: bool) -> Value {
        let lnk_key = shortcut(place).and_then(|(_, b)| rules::lnk_key(&b));
        if !installed {
            return json!({ "key": lnk_key.unwrap_or_default(), "helper": false, "running": false, "starting": false, "fallback": false, "why": "" });
        }
        let saved = read_key(&place.cache);
        let key = saved.clone().or(lnk_key.clone()).unwrap_or_default();
        let running = !key.is_empty() && running().iter().any(|(_, k)| *k == key);
        let busy = matches!(BUSY.try_lock(), Err(std::sync::TryLockError::WouldBlock));
        let starting = !running && !key.is_empty() && (busy || helpers().iter().any(|&(h, _)| held_key(h).is_empty()));
        let fallback = !running && saved.is_none() && lnk_key.is_some();
        let why = if running || starting { String::new() } else { std::fs::read_to_string(place.cache.join(STATUS_FILE)).unwrap_or_default().trim().to_string() };
        json!({ "key": key, "helper": true, "running": running, "starting": starting, "fallback": fallback, "why": why })
    }

    pub fn state() -> Value {
        let installed = crate::update::installed();
        match Place::real() {
            Some(p) => status(&p, installed),
            None => json!({ "key": "", "helper": installed, "running": false, "starting": false, "fallback": false, "why": "" }),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn state() -> Value {
        json!({ "key": "", "helper": false, "running": false, "starting": false, "fallback": false, "why": "" })
    }
    pub fn set(_key: &str) -> Result<String, String> {
        Err("Shortcut keys are only for Windows.".into())
    }
    pub fn at_start() {}
    pub fn stop() -> bool {
        false
    }
    pub fn helpers() -> Vec<(isize, u32)> {
        Vec::new()
    }
    pub fn helper_main() -> i32 {
        2
    }
}

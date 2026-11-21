//! `leanoutliner://page/<name>` and `leanoutliner://note/<id>` (outline_core::link): Windows starts
//! a new copy of the program for each link clicked (win::register_link_handler). If the app is
//! open, that copy hands the link to it (`send_to_running`: WM_COPYDATA to a hidden message-only
//! window of the open app, class `CLASS`, made by `listen`) and quits; the open window comes to the
//! front and shows the page (the "lean-link" event, App.openLink in app.js). Otherwise the app
//! starts as usual and its page takes the link once its notes are open (`set_start`, the
//! "start_link" command). Android: the manifest's VIEW filter, MainActivity.takeIntent.
//! Only between copies of this same program: a link goes only to a window whose program is this
//! one (`same_program`), and the open app takes only page and note links (`handed_link`), so a
//! stray message from elsewhere neither shows anything nor brings the window forward.
#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::Mutex;

/// The link the app was started with, until the page takes it.
static START: Mutex<Option<String>> = Mutex::new(None);

pub fn set_start(link: &str) {
    *START.lock().unwrap_or_else(|p| p.into_inner()) = Some(link.to_string());
}

/// The link the app was started with (once).
pub fn take_start() -> Option<String> {
    START.lock().unwrap_or_else(|p| p.into_inner()).take()
}

/// Hand `link` to the app if it's open (Windows): true when it took it.
pub fn send_to_running(link: &str) -> bool {
    imp::send(link)
}

/// The open app's side (its main window only): links from other copies arrive as "lean-link", and
/// the window comes to the front.
pub fn listen(app: tauri::AppHandle) {
    imp::listen(app)
}

#[cfg(windows)]
mod imp {
    use crate::capture_box::ffi::*;
    use std::sync::OnceLock;
    use tauri::{Emitter, Manager};

    /// The hidden window's class (one per open app).
    const CLASS: &str = "LeanOutlinerLinks";
    /// WM_COPYDATA's `data`, so a stray message from elsewhere is ignored.
    const TAG: usize = 0x4C4E_4B31; // "LNK1"
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub fn listen(app: tauri::AppHandle) {
        if APP.set(app).is_err() {
            return;
        }
        std::thread::spawn(|| unsafe {
            let class = wide(CLASS);
            let inst = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSEXW {
                size: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: 0,
                wndproc: Some(link_proc),
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
                return;
            }
            let title = wide("Lean Outliner links");
            if CreateWindowExW(0, class.as_ptr(), title.as_ptr(), 0, 0, 0, 0, 0, HWND_MESSAGE, 0, inst, std::ptr::null_mut()) == 0 {
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                DispatchMessageW(&msg);
            }
        });
    }

    unsafe extern "system" fn link_proc(h: isize, m: u32, w: usize, l: isize) -> isize {
        // a panic must never unwind into Windows (that would end the program)
        let took = std::panic::catch_unwind(|| m == WM_COPYDATA && l != 0 && take(&*(l as *const COPYDATASTRUCT))).unwrap_or(false);
        if took {
            return 1;
        }
        DefWindowProcW(h, m, w, l)
    }

    /// A link from another copy: shown, and the window brought forward, only for a page or note link.
    unsafe fn take(cd: &COPYDATASTRUCT) -> bool {
        if cd.data != TAG || cd.ptr.is_null() || cd.size == 0 || cd.size > 64 * 1024 {
            return false;
        }
        let bytes = std::slice::from_raw_parts(cd.ptr as *const u8, cd.size as usize);
        let (Some(link), Some(app)) = (crate::shell_rules::handed_link(bytes), APP.get()) else { return false };
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
        let _ = app.emit("lean-link", link);
        true
    }

    /// The program a process runs, by its full path ("" if Windows doesn't say).
    fn program_of(pid: u32) -> String {
        #[link(name = "kernel32")]
        extern "system" {
            fn QueryFullProcessImageNameW(process: isize, flags: u32, name: *mut u16, size: *mut u32) -> i32;
        }
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        unsafe {
            let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if p == 0 {
                return String::new();
            }
            let mut buf = vec![0u16; 32768];
            let mut n = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(p, 0, buf.as_mut_ptr(), &mut n) != 0;
            CloseHandle(p as *mut std::ffi::c_void);
            if ok {
                String::from_utf16_lossy(&buf[..(n as usize).min(buf.len())])
            } else {
                String::new()
            }
        }
    }

    pub fn send(link: &str) -> bool {
        let class = wide(CLASS);
        let h = unsafe { FindWindowExW(HWND_MESSAGE, 0, class.as_ptr(), std::ptr::null()) };
        if h == 0 {
            return false;
        }
        // only to this same program (another one may have made a window of the same class)
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(h, &mut pid) };
        let me = std::env::current_exe().map(|e| e.display().to_string()).unwrap_or_default();
        if pid == 0 || !crate::shell_rules::same_program(&me, &program_of(pid)) {
            return false;
        }
        // (clicking the link gave this copy the right to bring a window forward: pass it on)
        unsafe { AllowSetForegroundWindow(pid) };
        let cd = COPYDATASTRUCT { data: TAG, size: link.len() as u32, ptr: link.as_ptr().cast() };
        let mut answer = 0usize;
        let sent = unsafe { SendMessageTimeoutW(h, WM_COPYDATA, 0, &cd as *const COPYDATASTRUCT as isize, SMTO_ABORTIFHUNG, 5000, &mut answer) };
        sent != 0 && answer == 1
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn send(_link: &str) -> bool {
        false
    }
    pub fn listen(_app: tauri::AppHandle) {}
}
